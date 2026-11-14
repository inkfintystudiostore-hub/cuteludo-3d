/**
 * Zustand store bridging the pure rules, the animated 3D scene, and optional live
 * Cloudflare Durable Object WebSocket multiplayer rooms.
 */
import { create } from 'zustand';
import {
  HOME_PROGRESS,
  TEAM_LABELS,
  YARD_SLOT_POSITIONS,
  getHomePicnicPosition,
  getPawnWorldPosition,
  getProgressPosition,
  type PawnWorldPosition,
  type SharedState,
  type TeamId,
  type WorldPoint,
} from './boardMap';
import { applyMove, applyRoll, areAllies, createGame, rollSmartDie, type GameMode, type GameState } from './ludoRules';
import type { ChatMessage, RoomEmoteId, RoomSnapshot, SeatInfo } from './multiplayerProtocol';

export type GameEventType = 'SPAWN_6' | 'HOP' | 'CAPTURE' | 'REACH_HOME' | 'SHARED_STAR';

interface EventBase {
  /** Unique per event; pass it back to `completeEvent`. */
  id: number;
}

export type GameEvent =
  | (EventBase & { type: 'SPAWN_6'; pawnId: string; from: WorldPoint; pathWaypoints: WorldPoint[] })
  | (EventBase & { type: 'HOP'; pawnId: string; pathWaypoints: WorldPoint[] })
  | (EventBase & { type: 'CAPTURE'; attackerId: string; victimId: string; pathWaypoints: WorldPoint[] })
  | (EventBase & { type: 'REACH_HOME'; pawnId: string })
  | (EventBase & {
      type: 'SHARED_STAR';
      pawnId: string;
      pawnIds: string[];
      sharedState: SharedState;
      placements: Record<string, PawnWorldPosition>;
    });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface MatchStats {
  turns: number;
  captures: number;
  sixes: number;
}

export interface EventBanner {
  id: number;
  text: string;
  tone: 'capture' | 'home' | 'six' | 'forfeit';
}

export type ScreenMode = 'home' | 'playing';
export type RoomConnectionStatus = 'idle' | 'connecting' | 'connected' | 'offline';

export interface RoomSession {
  code: string;
  role: 'host' | 'guest';
  peers: number;
  online: boolean;
  status: RoomConnectionStatus;
  statusNote?: string;
  isHost: boolean;
  myTeam: TeamId | null;
  started: boolean;
  seats: SeatInfo[];
}

export const YARD_EMOTE_DURATION_MS = 4500;

export interface YardEmoteOverlay {
  id: number;
  emote: RoomEmoteId;
  startedAt: number;
  expiresAt: number;
}

export interface RoomTransport {
  roll: () => void;
  move: (pawnId: string) => void;
  reset: () => void;
  emote: (emote: RoomEmoteId) => void;
  chat: (text: string) => void;
  disconnect: () => void;
}

export interface StartMatchOptions {
  mode?: GameMode;
  vsAi?: boolean;
  simulation?: boolean;
  room?: Partial<RoomSession> & { code: string; role: 'host' | 'guest' } | null;
}

export interface GameStore {
  game: GameState;
  screen: ScreenMode;
  paused: boolean;
  room: RoomSession | null;
  legalMoves: string[];
  hoveredPawnId: string | null;
  isAnimating: boolean;
  activeRoll: { id: number; value: number } | null;
  lastEvent: GameEvent | null;
  eventQueue: GameEvent[];
  pendingGame: GameState | null;
  notice: string;
  lastBanner: EventBanner | null;
  simulation: boolean;
  vsAi: boolean;
  cameraResetTick: number;
  stats: MatchStats;
  log: string[];
  yardEmotes: Partial<Record<TeamId, YardEmoteOverlay>>;
  chatMessages: ChatMessage[];
  unreadChat: number;
  chatOpen: boolean;
  roomAlert: string | null;
  setSimulation: (on: boolean) => void;
  setVsAi: (on: boolean) => void;
  setPaused: (paused: boolean) => void;
  setRoomPeers: (peers: number) => void;
  setRoomAlert: (alert: string | null) => void;
  setChatOpen: (open: boolean) => void;
  pushChatMessage: (chat: ChatMessage) => void;
  sendChat: (text: string) => boolean;
  initRoomSession: (room: Partial<RoomSession> & { code: string; role: 'host' | 'guest' }) => void;
  setRoomConnectionStatus: (status: RoomConnectionStatus, statusNote?: string) => void;
  syncRoomSnapshot: (snapshot: RoomSnapshot) => void;
  playRemoteRoll: (value: number) => void;
  playRemoteMove: (pawnId: string) => void;
  syncRemoteReset: (mode: GameMode) => void;
  triggerYardEmote: (team: TeamId, emote: RoomEmoteId) => void;
  clearYardEmote: (team: TeamId, emoteId: number) => void;
  sendEmote: (emote: RoomEmoteId) => boolean;
  startMatch: (options?: StartMatchOptions) => void;
  exitToHome: () => void;
  setHoveredPawn: (pawnId: string | null) => void;
  triggerCameraReset: () => void;
  rollDice: () => void;
  completeRoll: (rollId: number) => void;
  selectPawn: (pawnId: string) => void;
  completeEvent: (eventId: number) => void;
  setMode: (mode: GameMode) => void;
  resetGame: () => void;
}

const NO_MOVE_DISPLAY_MS = 480;
const NO_MOVE_SIMULATION_MS = 100;
const AUTO_MOVE_DELAY_MS = 200;
const LOG_LIMIT = 40;
let nextEventId = 1;
let passTimer: ReturnType<typeof setTimeout> | undefined;
let autoMoveTimer: ReturnType<typeof setTimeout> | undefined;
let roomTransport: RoomTransport | null = null;

function clearPendingTimers(): void {
  clearTimeout(passTimer);
  clearTimeout(autoMoveTimer);
}

export function registerRoomTransport(transport: RoomTransport | null): void {
  roomTransport = transport;
}

/** True when the local human user is allowed to roll or click a pawn right now. */
export function canLocalPlayerAct(s: Pick<GameStore, 'screen' | 'paused' | 'simulation' | 'vsAi' | 'isAnimating' | 'game' | 'room'>): boolean {
  if (s.screen !== 'playing' || s.paused || s.simulation || s.isAnimating) return false;
  if (s.room?.online) {
    return s.room.myTeam !== null && s.room.myTeam === s.game.currentTeam;
  }
  if (s.vsAi) return s.game.currentTeam === 'PINK';
  return true;
}

/** Which team's Home Yard is oriented closest to the viewer (bottom-left of screen). */
export function getLocalAnchorTeam(s: Pick<GameStore, 'room' | 'vsAi' | 'game'>): TeamId {
  if (s.room?.myTeam) return s.room.myTeam;
  if (s.vsAi) return 'PINK';
  return s.game.activeTeams[0] ?? 'PINK';
}

function appendLog(log: string[], entry: string): string[] {
  return [...log, entry].slice(-LOG_LIMIT);
}

function turnNotice(team: TeamId): string {
  return `${TEAM_LABELS[team]}'s turn — click the dice!`;
}

function normalizeRoom(input: Partial<RoomSession> & { code: string; role: 'host' | 'guest' }): RoomSession {
  return {
    code: input.code,
    role: input.role,
    peers: input.peers ?? 1,
    online: input.online ?? false,
    status: input.status ?? 'idle',
    statusNote: input.statusNote,
    isHost: input.isHost ?? input.role === 'host',
    myTeam: input.myTeam ?? null,
    started: input.started ?? false,
    seats: input.seats ?? [],
  };
}

function freshState(mode: GameMode, overrideGame?: GameState) {
  const game = overrideGame ?? createGame(mode);
  return {
    game,
    legalMoves: [] as string[],
    hoveredPawnId: null as string | null,
    isAnimating: false,
    activeRoll: null,
    lastEvent: null,
    eventQueue: [] as GameEvent[],
    pendingGame: null,
    notice: turnNotice(game.currentTeam),
    lastBanner: null as EventBanner | null,
    stats: { turns: 0, captures: 0, sixes: 0 },
    log: [] as string[],
    yardEmotes: {} as Partial<Record<TeamId, YardEmoteOverlay>>,
  };
}

function ordinal(rank: number): string {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

function buildMovePatch(state: GameStore, pawnId: string) {
  const { game, legalMoves, stats } = state;
  const effectiveLegal = legalMoves.length > 0 ? legalMoves : game.dice ? applyRoll({ ...game, phase: 'ROLL' }, game.dice).legalMoves : [];
  if (game.phase !== 'MOVE' || !effectiveLegal.includes(pawnId)) return null;

  const result = applyMove(game, pawnId);
  const mover = game.pawns.find((p) => p.id === pawnId)!;
  const team = mover.team;
  const events: DistributiveOmit<GameEvent, 'id'>[] = [];

  if (result.kind === 'SPAWN') {
    events.push({
      type: 'SPAWN_6',
      pawnId,
      from: YARD_SLOT_POSITIONS[team][mover.slot],
      pathWaypoints: [getProgressPosition(team, 0)],
    });
  } else {
    events.push({
      type: 'HOP',
      pawnId,
      pathWaypoints: result.path.map((p) => (p === HOME_PROGRESS ? getHomePicnicPosition(team, mover.slot) : getProgressPosition(team, p))),
    });
  }

  for (const victimId of result.captured) {
    const victim = game.pawns.find((p) => p.id === victimId)!;
    events.push({
      type: 'CAPTURE',
      attackerId: pawnId,
      victimId,
      pathWaypoints: [getProgressPosition(team, result.to), YARD_SLOT_POSITIONS[victim.team][victim.slot]],
    });
  }

  if (result.reachedHome) events.push({ type: 'REACH_HOME', pawnId });

  if (result.sharedWith.length > 0) {
    const pawns = result.state.pawns;
    const allies = (a: TeamId, b: TeamId) => areAllies(game.mode, a, b);
    const pawnIds = [pawnId, ...result.sharedWith];
    const placements: Record<string, PawnWorldPosition> = {};
    for (const id of pawnIds) {
      placements[id] = getPawnWorldPosition(pawns.find((p) => p.id === id)!, pawns, allies);
    }
    events.push({ type: 'SHARED_STAR', pawnId, pawnIds, sharedState: placements[pawnId].sharedState, placements });
  }

  const [first, ...rest] = events.map((e) => ({ ...e, id: nextEventId++ }) as GameEvent);
  let notice = turnNotice(result.state.currentTeam);
  if (result.state.phase === 'GAME_OVER') notice = `${result.state.winners.map((t) => TEAM_LABELS[t]).join(' & ')} win!`;
  else if (result.finishedRank !== null) notice = `${TEAM_LABELS[team]} finished ${ordinal(result.finishedRank)}! ${turnNotice(result.state.currentTeam)}`;
  else if (result.captured.length > 0) notice = `Captured! ${TEAM_LABELS[team]} rolls again.`;
  else if (result.reachedHome && result.bonusRoll) notice = `Home! ${TEAM_LABELS[team]} gets a bonus roll!`;
  else if (result.bonusRoll) notice = `A six! ${TEAM_LABELS[team]} rolls again.`;

  let lastBanner = state.lastBanner;
  if (result.finishedRank !== null && result.state.phase !== 'GAME_OVER') {
    lastBanner = { id: nextEventId++, text: `${TEAM_LABELS[team]} FINISHED ${ordinal(result.finishedRank).toUpperCase()}! Battle continues!`, tone: 'home' };
  } else if (result.captured.length > 0) {
    lastBanner = { id: nextEventId++, text: `${TEAM_LABELS[team]} CAPTURED! +1 Bonus Roll`, tone: 'capture' };
  } else if (result.reachedHome) {
    lastBanner = {
      id: nextEventId++,
      text: result.bonusRoll ? `${TEAM_LABELS[team]} HOME! +1 Bonus Roll` : `${TEAM_LABELS[team]} JOINED THE PICNIC!`,
      tone: 'home',
    };
  }

  const steps = result.kind === 'SPAWN' ? 'leaves the yard' : `moves ${result.to - result.from} (${result.from} to ${result.to})`;
  const extras = [
    ...result.captured.map((victimId) => `captures ${victimId}`),
    ...(result.reachedHome ? ['reaches Home'] : []),
  ];
  const entry = [`${TEAM_LABELS[team]} pawn ${mover.slot + 1} ${steps}`, ...extras].join(', ');

  return {
    isAnimating: true,
    legalMoves: [] as string[],
    hoveredPawnId: null as string | null,
    lastEvent: first,
    eventQueue: rest,
    pendingGame: result.state,
    stats: { ...stats, captures: stats.captures + result.captured.length },
    lastBanner,
    notice,
    log: appendLog(state.log, entry),
  };
}

export const useGameStore = create<GameStore>((set, get) => ({
  ...freshState('2P_COUPLES'),
  screen: 'home',
  paused: false,
  room: null,
  simulation: false,
  vsAi: false,
  cameraResetTick: 0,
  chatMessages: [],
  unreadChat: 0,
  chatOpen: false,
  roomAlert: null,

  setSimulation: (on) => set({ simulation: on }),
  setVsAi: (on) => set({ vsAi: on }),
  setPaused: (paused) => set({ paused }),
  setRoomPeers: (peers) => set((s) => (s.room ? { room: { ...s.room, peers } } : {})),
  setRoomAlert: (roomAlert) => set({ roomAlert }),
  setChatOpen: (chatOpen) => set((s) => ({ chatOpen, unreadChat: chatOpen ? 0 : s.unreadChat })),

  pushChatMessage: (chat) =>
    set((s) => ({
      chatMessages: [...s.chatMessages, chat].slice(-40),
      unreadChat: s.chatOpen ? 0 : s.unreadChat + 1,
    })),

  sendChat: (rawText) => {
    const clean = rawText.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!clean) return false;
    const state = get();
    if (state.room?.online && roomTransport) {
      roomTransport.chat(clean);
      return true;
    }
    return false;
  },

  initRoomSession: (room) => set({ room: normalizeRoom(room) }),

  setRoomConnectionStatus: (status, statusNote) =>
    set((s) =>
      s.room
        ? {
            room: {
              ...s.room,
              status,
              statusNote,
              online: status === 'connected',
            },
          }
        : {},
    ),

  syncRoomSnapshot: (snapshot) => {
    const connectedCount = snapshot.seats.filter((s) => s.occupant === 'human' && s.connected).length;
    const prev = get();
    const shouldEnterPlaying = snapshot.started && prev.screen !== 'playing';
    const nextRoom: RoomSession = {
      code: snapshot.code,
      role: snapshot.isHost ? 'host' : 'guest',
      peers: Math.max(1, connectedCount),
      online: true,
      status: 'connected',
      isHost: snapshot.isHost,
      myTeam: snapshot.yourTeam,
      started: snapshot.started,
      seats: snapshot.seats,
    };

    if (shouldEnterPlaying) {
      clearPendingTimers();
      set({
        ...freshState(snapshot.mode, snapshot.game),
        screen: 'playing',
        paused: false,
        vsAi: false,
        simulation: false,
        room: nextRoom,
        notice: turnNotice(snapshot.game.currentTeam),
      });
      return;
    }

    // If not currently mid-animation, keep board aligned cleanly (useful on initial mid-match join).
    if (!prev.isAnimating && prev.screen === 'playing') {
      const legal = snapshot.game.phase === 'MOVE' && snapshot.game.dice
        ? applyRoll({ ...snapshot.game, phase: 'ROLL' }, snapshot.game.dice).legalMoves
        : [];
      set({
        room: nextRoom,
        game: snapshot.game,
        legalMoves: legal,
      });
      return;
    }

    set({ room: nextRoom });
  },

  playRemoteRoll: (value) => {
    const { game } = get();
    if (game.phase !== 'ROLL') return;
    set({
      activeRoll: { id: nextEventId++, value },
      isAnimating: true,
      legalMoves: [],
      hoveredPawnId: null,
      notice: 'Rolling…',
    });
  },

  playRemoteMove: (pawnId) => {
    const patch = buildMovePatch(get(), pawnId);
    if (patch) set(patch);
  },

  syncRemoteReset: (mode) => {
    clearPendingTimers();
    set({ ...freshState(mode), paused: false });
  },

  triggerYardEmote: (team, emote) => {
    const startedAt = Date.now();
    const id = nextEventId++;
    set((s) => ({
      yardEmotes: {
        ...s.yardEmotes,
        [team]: { id, emote, startedAt, expiresAt: startedAt + YARD_EMOTE_DURATION_MS },
      },
    }));
  },

  clearYardEmote: (team, emoteId) => {
    const existing = get().yardEmotes[team];
    if (!existing || existing.id !== emoteId) return;
    set((s) => {
      const next = { ...s.yardEmotes };
      delete next[team];
      return { yardEmotes: next };
    });
  },

  sendEmote: (emote) => {
    const state = get();
    if (state.room?.online && roomTransport) {
      roomTransport.emote(emote);
      if (state.room.myTeam) state.triggerYardEmote(state.room.myTeam, emote);
      return true;
    }
    const localTeam: TeamId = state.vsAi ? 'PINK' : state.game.currentTeam;
    state.triggerYardEmote(localTeam, emote);
    return false;
  },

  startMatch: (options) => {
    clearPendingTimers();
    const nextMode = options?.mode ?? get().game.mode;
    const nextVsAi = options?.vsAi ?? get().vsAi;
    const nextSim = options?.simulation ?? false;
    const nextRoom = options?.room === undefined || options.room === null ? null : normalizeRoom(options.room);
    set({
      ...freshState(nextMode),
      screen: 'playing',
      paused: false,
      vsAi: nextVsAi,
      simulation: nextSim,
      room: nextRoom,
      chatMessages: nextRoom?.code && nextRoom.code === get().room?.code ? get().chatMessages : [],
      unreadChat: 0,
      chatOpen: false,
      roomAlert: null,
    });
  },

  exitToHome: () => {
    clearPendingTimers();
    roomTransport?.disconnect();
    set({
      screen: 'home',
      paused: false,
      simulation: false,
      room: null,
      chatMessages: [],
      unreadChat: 0,
      chatOpen: false,
      roomAlert: null,
    });
  },

  setHoveredPawn: (pawnId) => set({ hoveredPawnId: pawnId }),
  triggerCameraReset: () => set((s) => ({ cameraResetTick: s.cameraResetTick + 1 })),

  rollDice: () => {
    const state = get();
    const { game, isAnimating, paused, room } = state;
    if (paused || isAnimating || game.phase !== 'ROLL') return;

    if (room?.online && roomTransport) {
      const seat = room.seats.find((s) => s.team === game.currentTeam);
      const allowed = room.myTeam === game.currentTeam || (room.isHost && seat?.occupant === 'bot');
      if (!allowed) return;
      roomTransport.roll();
      return;
    }

    set({
      activeRoll: { id: nextEventId++, value: rollSmartDie(game) },
      isAnimating: true,
      legalMoves: [],
      hoveredPawnId: null,
      notice: 'Rolling…',
    });
  },

  completeRoll: (rollId) => {
    const { game, activeRoll, stats, simulation, vsAi, room, screen } = get();
    if (!activeRoll || activeRoll.id !== rollId) return;
    const value = activeRoll.value;
    const result = applyRoll(game, value);
    const roller = TEAM_LABELS[game.currentTeam];
    const nextStats: MatchStats = {
      ...stats,
      turns: stats.turns + 1,
      sixes: stats.sixes + (value === 6 ? 1 : 0),
    };

    if (result.outcome === 'MOVE') {
      const sixBanner: EventBanner | null =
        value === 6
          ? {
              id: nextEventId++,
              text: result.state.sixStreak === 2 ? 'DOUBLE 6! Careful—one more forfeits!' : 'LUCKY 6! Bonus roll earned',
              tone: 'six',
            }
          : get().lastBanner;
      const isHumanTurn =
        !simulation && (room?.online ? room.myTeam === result.state.currentTeam : !vsAi || result.state.currentTeam === 'PINK');
      const shouldAutoMove = screen === 'playing' && result.legalMoves.length === 1 && isHumanTurn;
      set({
        game: result.state,
        legalMoves: result.legalMoves,
        hoveredPawnId: null,
        activeRoll: null,
        isAnimating: false,
        stats: nextStats,
        lastBanner: sixBanner,
        notice: shouldAutoMove ? `Rolled ${value}! Auto-moving…` : `Rolled ${value}! Pick a glowing pawn.`,
        log: appendLog(get().log, `${roller} rolled ${value}`),
      });
      if (shouldAutoMove) {
        clearTimeout(autoMoveTimer);
        const onlyPawn = result.legalMoves[0];
        autoMoveTimer = setTimeout(() => {
          const cur = get();
          if (cur.screen === 'playing' && !cur.paused && !cur.isAnimating && cur.game.phase === 'MOVE' && cur.legalMoves.includes(onlyPawn)) {
            cur.selectPawn(onlyPawn);
          }
        }, AUTO_MOVE_DELAY_MS);
      }
      return;
    }

    const notice =
      result.outcome === 'THREE_SIXES'
        ? 'Three sixes in a row — turn forfeited!'
        : value === 6
          ? 'Rolled 6 but nothing can move. Roll again!'
          : `Rolled ${value} — no moves.`;
    set({
      game: { ...game, dice: value },
      activeRoll: null,
      hoveredPawnId: null,
      stats: nextStats,
      lastBanner:
        result.outcome === 'THREE_SIXES'
          ? { id: nextEventId++, text: '3× SIXES! Turn forfeited', tone: 'forfeit' }
          : get().lastBanner,
      notice,
      log: appendLog(get().log, `${roller} rolled ${value}: ${result.outcome === 'THREE_SIXES' ? 'third six, turn lost' : 'no move'}`),
    });
    passTimer = setTimeout(() => {
      set({ game: result.state, isAnimating: false, notice: turnNotice(result.state.currentTeam) });
    }, get().simulation ? NO_MOVE_SIMULATION_MS : NO_MOVE_DISPLAY_MS);
  },

  selectPawn: (pawnId) => {
    clearTimeout(autoMoveTimer);
    const state = get();
    const { game, isAnimating, paused, legalMoves, room } = state;
    if (paused || isAnimating || game.phase !== 'MOVE' || !legalMoves.includes(pawnId)) return;

    if (room?.online && roomTransport) {
      const seat = room.seats.find((s) => s.team === game.currentTeam);
      const allowed = room.myTeam === game.currentTeam || (room.isHost && seat?.occupant === 'bot');
      if (!allowed) return;
      roomTransport.move(pawnId);
      return;
    }

    const patch = buildMovePatch(state, pawnId);
    if (patch) set(patch);
  },

  completeEvent: (eventId) => {
    const { lastEvent, eventQueue, pendingGame } = get();
    if (!lastEvent || lastEvent.id !== eventId) return;
    if (eventQueue.length > 0) {
      set({ lastEvent: eventQueue[0], eventQueue: eventQueue.slice(1) });
      return;
    }
    set({ game: pendingGame ?? get().game, pendingGame: null, lastEvent: null, isAnimating: false });
  },

  setMode: (mode) => {
    clearPendingTimers();
    set({ ...freshState(mode), paused: false });
  },

  resetGame: () => {
    const { room } = get();
    if (room?.online && roomTransport) {
      if (room.isHost) roomTransport.reset();
      return;
    }
    clearPendingTimers();
    set({ ...freshState(get().game.mode), paused: false });
  },
}));
