/**
 * Zustand store bridging the pure rules, the animated 3D scene, and optional live
 * Cloudflare Durable Object WebSocket multiplayer rooms.
 */
import { create } from 'zustand';
import { getBotPersonality, pickBotChatReply, pickBotEmote, pickBotGossipStory, pickRandomBotEmote, type BotEmoteMood } from './botNames';
import { useWalletStore } from './walletStore';
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
import { TURN_TIMEOUT_MS, type ChatMessage, type RoomEmoteId, type RoomSnapshot, type SeatInfo } from './multiplayerProtocol';
import { getEmoteDurationMs } from '../scene/emoteMedia';
import {
  CAPTURE_DIZZY_DURATION,
  CAPTURE_FLIGHT_DURATION,
  CAPTURE_GRAB_DURATION,
  CAPTURE_TWIRL_DURATION,
} from '../scene/animationTiming';

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
  mode?: GameMode;
  stake?: number;
  role: 'host' | 'guest';
  peers: number;
  online: boolean;
  status: RoomConnectionStatus;
  statusNote?: string;
  isHost: boolean;
  myTeam: TeamId | null;
  started: boolean;
  seats: SeatInfo[];
  closeAt?: number | null;
}

export const EMOTE_COOLDOWN_MS = 5000;

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
  resync?: () => void;
  emote: (emote: RoomEmoteId) => void;
  chat: (text: string) => void;
  disconnect: () => void;
}

export const SIMULATION_SPEEDS = [1, 1.25, 1.5, 2] as const;
export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number];

export interface StartMatchOptions {
  mode?: GameMode;
  stake?: number;
  vsAi?: boolean;
  simulation?: boolean;
  simulationSpeed?: SimulationSpeed;
  botNames?: Partial<Record<TeamId, string>>;
  room?: Partial<RoomSession> & { code: string; role: 'host' | 'guest' } | null;
}

export interface RemoteActionMeta {
  team?: TeamId;
  seq?: number;
  game?: GameState;
  legalMoves?: string[];
  turnRemainingMs?: number;
}

export interface GameStore {
  game: GameState;
  screen: ScreenMode;
  paused: boolean;
  room: RoomSession | null;
  legalMoves: string[];
  hoveredPawnId: string | null;
  isAnimating: boolean;
  waitingRollAck: boolean;
  activeRoll: { id: number; value: number } | null;
  lastEvent: GameEvent | null;
  eventQueue: GameEvent[];
  pendingGame: GameState | null;
  notice: string;
  lastBanner: EventBanner | null;
  simulation: boolean;
  simulationSpeed: SimulationSpeed;
  vsAi: boolean;
  botNames: Partial<Record<TeamId, string>>;
  cameraResetTick: number;
  stats: MatchStats;
  matchStake: number;
  matchSettled: boolean;
  turnDeadlineAt: number | null;
  yardEmotes: Partial<Record<TeamId, YardEmoteOverlay>>;
  emoteCooldownUntil: number;
  chatMessages: ChatMessage[];
  unreadChat: number;
  chatOpen: boolean;
  roomAlert: string | null;
  lastActiveRoomCode: string | null;
  setSimulation: (on: boolean) => void;
  setSimulationSpeed: (speed: SimulationSpeed) => void;
  setVsAi: (on: boolean) => void;
  setPaused: (paused: boolean) => void;
  setRoomPeers: (peers: number) => void;
  setRoomAlert: (alert: string | null) => void;
  closeOnlineRoom: (message: string) => void;
  clearLastActiveRoomCode: () => void;
  setChatOpen: (open: boolean) => void;
  pushChatMessage: (chat: ChatMessage) => void;
  sendChat: (text: string) => boolean;
  initRoomSession: (room: Partial<RoomSession> & { code: string; role: 'host' | 'guest' }) => void;
  setRoomConnectionStatus: (status: RoomConnectionStatus, statusNote?: string) => void;
  syncRoomSnapshot: (snapshot: RoomSnapshot) => void;
  playRemoteRoll: (value: number, meta?: RemoteActionMeta) => void;
  playRemoteMove: (pawnId: string, meta?: RemoteActionMeta) => void;
  syncRemoteReset: (mode: GameMode, meta?: { seq?: number; game?: GameState; turnRemainingMs?: number }) => void;
  triggerYardEmote: (team: TeamId, emote: RoomEmoteId) => void;
  clearYardEmote: (team: TeamId, emoteId: number) => void;
  sendEmote: (emote: RoomEmoteId) => boolean;
  startMatch: (options?: StartMatchOptions) => void;
  markMatchSettled: () => void;
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

const NO_MOVE_DISPLAY_MS = 560;
const AUTO_MOVE_DELAY_MS = 260;
const ROLL_WATCHDOG_MS = 1800;
const EVENT_WATCHDOG_MIN_MS = 2700;
const SERVER_ACK_TIMEOUT_MS = 2500;
let nextEventId = 1;
let passTimer: ReturnType<typeof setTimeout> | undefined;
let autoMoveTimer: ReturnType<typeof setTimeout> | undefined;
let rollWatchdogTimer: ReturnType<typeof setTimeout> | undefined;
let eventWatchdogTimer: ReturnType<typeof setTimeout> | undefined;
let serverAckTimer: ReturnType<typeof setTimeout> | undefined;
let pendingServerAck = false;
let hasPendingPass = false;
let roomTransport: RoomTransport | null = null;

type QueuedRemoteAction =
  | ({ kind: 'roll'; value: number; turnDeadlineAt?: number | null } & RemoteActionMeta)
  | ({ kind: 'move'; pawnId: string; turnDeadlineAt?: number | null } & RemoteActionMeta);

interface AuthoritativePostState {
  seq?: number;
  game?: GameState;
  legalMoves?: string[];
  turnDeadlineAt?: number | null;
}

let remoteActionQueue: QueuedRemoteAction[] = [];
let pendingSnapshot: RoomSnapshot | null = null;
let lastAppliedSeq = 0;
let activeRollAuthoritative: AuthoritativePostState | null = null;
let pendingEventAuthoritative: AuthoritativePostState | null = null;
let activeBotChatTimers: Array<ReturnType<typeof setTimeout>> = [];
let lastBotChatTimestamp = 0;
let isBotGossipActive = false;

function clearBotChatTimers(): void {
  activeBotChatTimers.forEach(clearTimeout);
  activeBotChatTimers = [];
  isBotGossipActive = false;
}

function clearPendingTimers(): void {
  clearTimeout(passTimer);
  clearTimeout(autoMoveTimer);
  clearTimeout(rollWatchdogTimer);
  clearTimeout(eventWatchdogTimer);
  clearTimeout(serverAckTimer);
  clearBotChatTimers();
  passTimer = undefined;
  autoMoveTimer = undefined;
  rollWatchdogTimer = undefined;
  eventWatchdogTimer = undefined;
  serverAckTimer = undefined;
  pendingServerAck = false;
  hasPendingPass = false;
  remoteActionQueue = [];
  pendingSnapshot = null;
  lastAppliedSeq = 0;
  activeRollAuthoritative = null;
  pendingEventAuthoritative = null;
}

function clearServerAck(): void {
  clearTimeout(serverAckTimer);
  serverAckTimer = undefined;
  pendingServerAck = false;
}

function isBusyAnimating(s: Pick<GameStore, 'isAnimating' | 'activeRoll' | 'lastEvent'>): boolean {
  return s.isAnimating || s.activeRoll !== null || s.lastEvent !== null || hasPendingPass;
}

function computeLegalMoves(game: GameState, provided?: string[]): string[] {
  if (provided) return provided;
  if (game.phase === 'MOVE' && game.dice !== null) {
    return applyRoll({ ...game, phase: 'ROLL' }, game.dice).legalMoves;
  }
  return [];
}

function scheduleRollWatchdog(rollId: number, get: () => GameStore): void {
  clearTimeout(rollWatchdogTimer);
  rollWatchdogTimer = setTimeout(() => {
    const cur = get();
    if ((!cur.paused || cur.room?.online) && cur.activeRoll?.id === rollId) {
      cur.completeRoll(rollId);
    }
  }, ROLL_WATCHDOG_MS);
}

function scheduleEventWatchdog(ev: GameEvent, get: () => GameStore): void {
  clearTimeout(eventWatchdogTimer);
  const hopBudget = ev.type === 'HOP' ? ev.pathWaypoints.length * 240 + 1400 : EVENT_WATCHDOG_MIN_MS;
  const captureBudget =
    ev.type === 'CAPTURE'
      ? (CAPTURE_GRAB_DURATION + CAPTURE_TWIRL_DURATION + CAPTURE_FLIGHT_DURATION + CAPTURE_DIZZY_DURATION) * 1000 + 800
      : 0;
  const timeoutMs = Math.max(EVENT_WATCHDOG_MIN_MS, hopBudget, captureBudget);
  eventWatchdogTimer = setTimeout(() => {
    const cur = get();
    if ((!cur.paused || cur.room?.online) && cur.lastEvent?.id === ev.id) {
      cur.completeEvent(ev.id);
    }
  }, timeoutMs);
}

export function registerRoomTransport(transport: RoomTransport | null): void {
  roomTransport = transport;
}

/** True when the local human user is allowed to roll or click a pawn right now. */
export function canLocalPlayerAct(s: Pick<GameStore, 'screen' | 'paused' | 'simulation' | 'vsAi' | 'isAnimating' | 'game' | 'room'>): boolean {
  if (s.screen !== 'playing' || s.paused || s.simulation || s.isAnimating) return false;
  if (s.room?.online) {
    const activeSeat = s.room.seats.find((seat) => seat.team === s.game.currentTeam);
    return s.room.myTeam !== null && s.room.myTeam === s.game.currentTeam && !activeSeat?.botTakeover;
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

function computeLocalTurnDeadline(
  game: GameState,
  simulation: boolean,
  vsAi: boolean,
  room: RoomSession | null,
): number | null {
  if (room?.online || simulation || game.phase === 'GAME_OVER') return null;
  if (vsAi && game.currentTeam !== 'PINK') return null;
  return Date.now() + TURN_TIMEOUT_MS;
}

function turnNotice(team: TeamId): string {
  return `${TEAM_LABELS[team]}'s turn — click the dice!`;
}

function normalizeRoom(input: Partial<RoomSession> & { code: string; role: 'host' | 'guest' }): RoomSession {
  return {
    code: input.code,
    mode: input.mode,
    role: input.role,
    peers: input.peers ?? 1,
    online: input.online ?? false,
    status: input.status ?? 'idle',
    statusNote: input.statusNote,
    isHost: input.isHost ?? input.role === 'host',
    myTeam: input.myTeam ?? null,
    started: input.started ?? false,
    seats: input.seats ?? [],
    closeAt: input.closeAt ?? null,
    stake: input.stake ?? 0,
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
    matchSettled: false,
    turnDeadlineAt: null as number | null,
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
  };
}

export const useGameStore = create<GameStore>((set, get) => {
  const applySnapshotToStore = (snapshot: RoomSnapshot, nextRoom: RoomSession) => {
    clearServerAck();
    pendingSnapshot = null;
    if (snapshot.seq !== undefined) lastAppliedSeq = Math.max(lastAppliedSeq, snapshot.seq);
    const legal = computeLegalMoves(snapshot.game, snapshot.legalMoves);
    const prev = get();
    const prevSeats = prev.room?.code === nextRoom.code ? prev.room.seats : [];

    let nextBanner = prev.lastBanner;
    let presenceNotice: string | null = null;
    if (snapshot.started && prev.room?.started && prevSeats.length > 0) {
      for (const nextSeat of nextRoom.seats) {
        if (nextSeat.occupant !== 'human') continue;
        const prevSeat = prevSeats.find((s) => s.team === nextSeat.team);
        if (!prevSeat || prevSeat.occupant !== 'human') continue;
        const name = nextSeat.playerName || TEAM_LABELS[nextSeat.team];
        if (!prevSeat.botTakeover && nextSeat.botTakeover) {
          nextBanner = { id: nextEventId++, text: `${name} MISSED TURN • AI BOT ACTIVE`, tone: 'forfeit' };
          presenceNotice = `${name} missed 1st turn — AI bot will play until they reconnect.`;
        } else if (!prevSeat.connected && nextSeat.connected && nextSeat.team !== nextRoom.myTeam) {
          nextBanner = { id: nextEventId++, text: `${name} RECONNECTED!`, tone: 'home' };
        }
      }
    }

    const turnOrPhaseChanged =
      prev.game.currentTeam !== snapshot.game.currentTeam || prev.game.phase !== snapshot.game.phase;
    const syncedNotice = !snapshot.started
      ? turnNotice(snapshot.game.currentTeam)
      : presenceNotice
        ? presenceNotice
        : turnOrPhaseChanged
          ? snapshot.game.phase === 'MOVE'
            ? 'Pick a glowing pawn.'
            : turnNotice(snapshot.game.currentTeam)
          : prev.notice;
    const turnDeadlineAt =
      snapshot.started && snapshot.game.phase !== 'GAME_OVER' && typeof snapshot.turnRemainingMs === 'number'
        ? Date.now() + snapshot.turnRemainingMs
        : null;
    const nextLastActiveRoomCode =
      snapshot.started && snapshot.game.phase !== 'GAME_OVER'
        ? snapshot.code
        : snapshot.game.phase === 'GAME_OVER'
          ? null
          : prev.lastActiveRoomCode;
    set({
      room: nextRoom,
      game: snapshot.game,
      legalMoves: legal,
      isAnimating: false,
      waitingRollAck: false,
      activeRoll: null,
      lastEvent: null,
      eventQueue: [],
      pendingGame: null,
      roomAlert: null,
      lastBanner: nextBanner,
      notice: syncedNotice,
      turnDeadlineAt,
      lastActiveRoomCode: nextLastActiveRoomCode,
    });
  };

  const executeRemoteRoll = (action: Extract<QueuedRemoteAction, { kind: 'roll' }>): boolean => {
    const cur = get();
    if (cur.game.phase !== 'ROLL' || (action.team && cur.game.currentTeam !== action.team)) {
      if (action.game) {
        if (action.seq !== undefined) lastAppliedSeq = Math.max(lastAppliedSeq, action.seq);
        const legal = computeLegalMoves(action.game, action.legalMoves);
        set({
          game: action.game,
          legalMoves: legal,
          activeRoll: null,
          lastEvent: null,
          eventQueue: [],
          pendingGame: null,
          isAnimating: false,
          waitingRollAck: false,
          hoveredPawnId: null,
          turnDeadlineAt: action.turnDeadlineAt ?? null,
          notice: action.game.phase === 'MOVE' ? 'Pick a glowing pawn.' : turnNotice(action.game.currentTeam),
        });
        return false;
      }
      remoteActionQueue = [];
      set({ waitingRollAck: false });
      roomTransport?.resync?.();
      return false;
    }

    activeRollAuthoritative =
      action.game || action.turnDeadlineAt !== undefined
        ? {
            seq: action.seq,
            game: action.game,
            legalMoves: action.legalMoves,
            turnDeadlineAt: action.turnDeadlineAt,
          }
        : null;
    const id = nextEventId++;
    set({
      activeRoll: { id, value: action.value },
      isAnimating: true,
      waitingRollAck: false,
      legalMoves: [],
      hoveredPawnId: null,
      turnDeadlineAt: null,
      notice: 'Rolling…',
    });
    if (!get().paused || get().room?.online) scheduleRollWatchdog(id, get);
    return true;
  };

  const executeRemoteMove = (action: Extract<QueuedRemoteAction, { kind: 'move' }>): boolean => {
    const cur = get();
    const teamMatches = !action.team || cur.game.currentTeam === action.team;
    const patch = teamMatches ? buildMovePatch(cur, action.pawnId) : null;
    if (!patch) {
      if (action.game) {
        if (action.seq !== undefined) lastAppliedSeq = Math.max(lastAppliedSeq, action.seq);
        const legal = computeLegalMoves(action.game, action.legalMoves);
        set({
          game: action.game,
          legalMoves: legal,
          activeRoll: null,
          lastEvent: null,
          eventQueue: [],
          pendingGame: null,
          isAnimating: false,
          waitingRollAck: false,
          hoveredPawnId: null,
          turnDeadlineAt: action.turnDeadlineAt ?? null,
          notice: action.game.phase === 'MOVE' ? 'Pick a glowing pawn.' : turnNotice(action.game.currentTeam),
        });
        return false;
      }
      remoteActionQueue = [];
      set({ waitingRollAck: false });
      roomTransport?.resync?.();
      return false;
    }

    pendingEventAuthoritative =
      action.game || action.turnDeadlineAt !== undefined
        ? {
            seq: action.seq,
            game: action.game,
            legalMoves: action.legalMoves,
            turnDeadlineAt: action.turnDeadlineAt,
          }
        : null;
    set({ ...patch, turnDeadlineAt: null });
    if (!get().paused || get().room?.online) scheduleEventWatchdog(patch.lastEvent, get);
    return true;
  };

  const drainRemoteQueueOrReconcile = () => {
    while (remoteActionQueue.length > 0 && !isBusyAnimating(get())) {
      const next = remoteActionQueue.shift()!;
      if (next.seq !== undefined && next.seq <= lastAppliedSeq) continue;
      const startedAnimation = next.kind === 'roll' ? executeRemoteRoll(next) : executeRemoteMove(next);
      if (startedAnimation) return;
    }

    if (remoteActionQueue.length === 0 && pendingSnapshot && !isBusyAnimating(get())) {
      const snap = pendingSnapshot;
      pendingSnapshot = null;
      const curRoom = get().room;
      if (curRoom && (snap.seq === undefined || snap.seq >= lastAppliedSeq)) {
        applySnapshotToStore(snap, curRoom);
      }
    }
  };

  return {
    ...freshState('2P_COUPLES'),
    screen: 'home',
    paused: false,
    room: null,
    waitingRollAck: false,
    simulation: false,
    simulationSpeed: 1,
    vsAi: false,
    botNames: {},
    cameraResetTick: 0,
    matchStake: 0,
    emoteCooldownUntil: 0,
    chatMessages: [],
    unreadChat: 0,
    chatOpen: false,
    roomAlert: null,
    lastActiveRoomCode: null,

    setSimulation: (on) => set({ simulation: on }),
    setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),
    setVsAi: (on) => set({ vsAi: on }),
    setPaused: (paused) => {
      const prev = get();
      if (paused) {
        set({ paused: true, turnDeadlineAt: prev.room?.online ? prev.turnDeadlineAt : null });
        return;
      }
      const nextDeadline =
        prev.room?.online
          ? prev.turnDeadlineAt
          : !prev.isAnimating
            ? computeLocalTurnDeadline(prev.game, prev.simulation, prev.vsAi, prev.room)
            : null;
      set({ paused: false, turnDeadlineAt: nextDeadline });
      const cur = get();
      if (cur.activeRoll) scheduleRollWatchdog(cur.activeRoll.id, get);
      if (cur.lastEvent) scheduleEventWatchdog(cur.lastEvent, get);
    },
    setRoomPeers: (peers) => set((s) => (s.room ? { room: { ...s.room, peers } } : {})),
    setRoomAlert: (roomAlert) => {
      clearServerAck();
      set({ roomAlert, waitingRollAck: false });
    },
    closeOnlineRoom: (message) => {
      clearPendingTimers();
      roomTransport?.disconnect();
      set({
        screen: 'home',
        paused: false,
        waitingRollAck: false,
        simulation: false,
        room: null,
        lastActiveRoomCode: null,
        turnDeadlineAt: null,
        emoteCooldownUntil: 0,
        chatMessages: [],
        unreadChat: 0,
        chatOpen: false,
        roomAlert: message,
        notice: message,
      });
    },
    clearLastActiveRoomCode: () => set({ lastActiveRoomCode: null }),
    setChatOpen: (chatOpen) =>
      set((s) => ({
        chatOpen,
        unreadChat: chatOpen ? 0 : s.unreadChat,
        cameraResetTick: !chatOpen && s.chatOpen ? s.cameraResetTick + 1 : s.cameraResetTick,
      })),

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
      if (state.vsAi && Object.keys(state.botNames).length > 0) {
        state.pushChatMessage({
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          team: 'PINK',
          senderName: state.botNames.PINK || 'You',
          text: clean,
          ts: Date.now(),
        });
        const botTeams = state.game.activeTeams.filter((t) => t !== 'PINK');
        if (botTeams.length > 0) {
          const replyCount = Math.random() < 0.35 ? 2 : 1;
          let delayCursor = 0;
          for (let i = 0; i < replyCount; i++) {
            const botTeam = botTeams[Math.floor(Math.random() * botTeams.length)];
            delayCursor += 7000 + Math.random() * 8000;
            const timer = setTimeout(() => {
              const cur = get();
              if (cur.screen !== 'playing' || !cur.vsAi) return;
              const name = cur.botNames[botTeam] || TEAM_LABELS[botTeam];
              const text = pickBotChatReply(clean, getBotPersonality(name));
              if (!text) return;
              cur.pushChatMessage({
                id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                team: botTeam,
                senderName: name,
                text,
                ts: Date.now(),
              });
              lastBotChatTimestamp = Date.now();
            }, delayCursor);
            activeBotChatTimers.push(timer);
          }
        }
        return true;
      }
      return false;
    },

    initRoomSession: (room) => {
      clearPendingTimers();
      set({
        room: normalizeRoom(room),
        notice: room.statusNote ?? 'Connecting to live room…',
        roomAlert: null,
        waitingRollAck: false,
      });
    },

    setRoomConnectionStatus: (status, statusNote) => {
      if (status !== 'connected') {
        clearServerAck();
      }
      set((s) =>
        s.room
          ? {
              room: {
                ...s.room,
                status,
                statusNote,
                online: status === 'connected',
              },
              waitingRollAck: status === 'connected' ? s.waitingRollAck : false,
            }
          : {},
      );
    },

    syncRoomSnapshot: (snapshot) => {
      const connectedCount = snapshot.seats.filter((s) => s.occupant === 'human' && s.connected).length;
      const prev = get();
      if (prev.room?.code && prev.room.code !== snapshot.code) {
        clearPendingTimers();
      }
      const shouldEnterPlaying = snapshot.started && (prev.screen !== 'playing' || prev.room?.code !== snapshot.code);
      const closeAt =
        snapshot.started && snapshot.game.phase === 'GAME_OVER' && typeof snapshot.roomCloseRemainingMs === 'number'
          ? Date.now() + snapshot.roomCloseRemainingMs
          : null;
      const nextRoom: RoomSession = {
        code: snapshot.code,
        mode: snapshot.mode,
        stake: snapshot.stake ?? 0,
        role: snapshot.isHost ? 'host' : 'guest',
        peers: Math.max(1, connectedCount),
        online: true,
        status: 'connected',
        isHost: snapshot.isHost,
        myTeam: snapshot.yourTeam,
        started: snapshot.started,
        seats: snapshot.seats,
        closeAt,
      };

      if (shouldEnterPlaying) {
        clearPendingTimers();
        lastAppliedSeq = snapshot.seq ?? 0;
        const stake = snapshot.stake ?? 0;
        if (stake > 0 && snapshot.game.phase !== 'GAME_OVER' && typeof window !== 'undefined') {
          try {
            const chargeKey = `${snapshot.code}:${snapshot.seq ?? 0}`;
            const prevKey = window.sessionStorage.getItem('chibi_ludo_charged_room');
            if (prevKey !== snapshot.code && prevKey !== chargeKey) {
              useWalletStore.getState().deduct(stake);
              window.sessionStorage.setItem('chibi_ludo_charged_room', snapshot.code);
            }
          } catch {
            // Ignore sessionStorage errors.
          }
        }
        const legal = computeLegalMoves(snapshot.game, snapshot.legalMoves);
        const turnDeadlineAt =
          snapshot.started && snapshot.game.phase !== 'GAME_OVER' && typeof snapshot.turnRemainingMs === 'number'
            ? Date.now() + snapshot.turnRemainingMs
            : null;
        set({
          ...freshState(snapshot.mode, snapshot.game),
          legalMoves: legal,
          screen: 'playing',
          paused: false,
          vsAi: false,
          simulation: false,
          waitingRollAck: false,
          room: nextRoom,
          matchStake: snapshot.stake ?? 0,
          turnDeadlineAt,
          lastActiveRoomCode: snapshot.game.phase === 'GAME_OVER' ? null : snapshot.code,
          notice: snapshot.game.phase === 'MOVE' ? 'Pick a glowing pawn.' : turnNotice(snapshot.game.currentTeam),
        });
        return;
      }

      if (prev.screen === 'playing' || !snapshot.started) {
        if (!isBusyAnimating(prev)) {
          remoteActionQueue = remoteActionQueue.filter(
            (item) => item.seq !== undefined && snapshot.seq !== undefined && item.seq > snapshot.seq,
          );
          if (remoteActionQueue.length === 0) {
            if (snapshot.seq !== undefined && snapshot.seq < lastAppliedSeq) {
              set({ room: nextRoom });
              return;
            }
            applySnapshotToStore(snapshot, nextRoom);
            return;
          }
        }
        // An animation is currently playing: preserve snapshot to reconcile once animation finishes.
        if (!pendingSnapshot || (snapshot.seq ?? 0) >= (pendingSnapshot.seq ?? 0)) {
          pendingSnapshot = snapshot;
        }
      }

      set({ room: nextRoom });
    },

    playRemoteRoll: (value, meta) => {
      clearServerAck();
      if (meta?.seq !== undefined && meta.seq <= lastAppliedSeq) {
        set({ waitingRollAck: false });
        return;
      }
      const turnDeadlineAt =
        typeof meta?.turnRemainingMs === 'number' ? Date.now() + meta.turnRemainingMs : undefined;
      const action: QueuedRemoteAction = { kind: 'roll', value, ...meta, turnDeadlineAt };
      if (isBusyAnimating(get()) || remoteActionQueue.length > 0) {
        set({ waitingRollAck: false });
        remoteActionQueue.push(action);
        return;
      }
      executeRemoteRoll(action);
    },

    playRemoteMove: (pawnId, meta) => {
      clearServerAck();
      if (meta?.seq !== undefined && meta.seq <= lastAppliedSeq) return;
      const turnDeadlineAt =
        typeof meta?.turnRemainingMs === 'number' ? Date.now() + meta.turnRemainingMs : undefined;
      const action: QueuedRemoteAction = { kind: 'move', pawnId, ...meta, turnDeadlineAt };
      if (isBusyAnimating(get()) || remoteActionQueue.length > 0) {
        remoteActionQueue.push(action);
        return;
      }
      executeRemoteMove(action);
    },

    syncRemoteReset: (mode, meta) => {
      clearPendingTimers();
      if (meta?.seq !== undefined) lastAppliedSeq = meta.seq;
      const turnDeadlineAt =
        typeof meta?.turnRemainingMs === 'number' ? Date.now() + meta.turnRemainingMs : null;
      const roomStake = get().room?.stake ?? 0;
      const nextStake = roomStake > 0 && useWalletStore.getState().deduct(roomStake) ? roomStake : 0;
      set((s) => ({
        ...freshState(mode, meta?.game),
        matchStake: nextStake,
        paused: false,
        waitingRollAck: false,
        turnDeadlineAt,
        room: s.room ? { ...s.room, closeAt: null } : null,
      }));
    },

    triggerYardEmote: (team, emote) => {
      const startedAt = Date.now();
      const id = nextEventId++;
      const durationMs = getEmoteDurationMs(emote);
      set((s) => ({
        yardEmotes: {
          ...s.yardEmotes,
          [team]: { id, emote, startedAt, expiresAt: startedAt + durationMs },
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
      const now = Date.now();
      const state = get();
      if (now < state.emoteCooldownUntil) return false;
      const nextCooldown = now + EMOTE_COOLDOWN_MS;
      if (state.room?.online && roomTransport) {
        set({ emoteCooldownUntil: nextCooldown });
        roomTransport.emote(emote);
        if (state.room.myTeam) state.triggerYardEmote(state.room.myTeam, emote);
        return true;
      }
      set({ emoteCooldownUntil: nextCooldown });
      const localTeam: TeamId = state.vsAi ? 'PINK' : state.game.currentTeam;
      state.triggerYardEmote(localTeam, emote);

      // In fake matchmaking, bots reply with 4-7 random GIFs spread naturally over time
      if (state.vsAi && Object.keys(state.botNames).length > 0 && !state.simulation) {
        const botTeams = state.game.activeTeams.filter((t) => t !== 'PINK');
        if (botTeams.length > 0) {
          const burstCount = 4 + Math.floor(Math.random() * 4);
          let cursorMs = 600;
          for (let i = 0; i < burstCount; i++) {
            cursorMs += 700 + Math.random() * 1200;
            const botTeam = botTeams[Math.floor(Math.random() * botTeams.length)];
            setTimeout(() => {
              const cur = get();
              if (cur.screen !== 'playing' || cur.paused) return;
              cur.triggerYardEmote(botTeam, pickRandomBotEmote());
            }, cursorMs);
          }
        }
      }
      return true;
    },

    startMatch: (options) => {
      clearPendingTimers();
      const nextMode = options?.mode ?? get().game.mode;
      const nextVsAi = options?.vsAi ?? get().vsAi;
      const nextSim = options?.simulation ?? false;
      const nextSimSpeed = options?.simulationSpeed ?? get().simulationSpeed;
      const nextStake = options?.stake ?? 0;
      const nextRoom = options?.room === undefined || options.room === null ? null : normalizeRoom(options.room);
      const initial = freshState(nextMode);
      set({
        ...initial,
        turnDeadlineAt: computeLocalTurnDeadline(initial.game, nextSim, nextVsAi, nextRoom),
        screen: 'playing',
        paused: false,
        waitingRollAck: false,
        vsAi: nextVsAi,
        simulation: nextSim,
        simulationSpeed: nextSimSpeed,
        botNames: options?.botNames ?? {},
        matchStake: nextStake,
        room: nextRoom,
        lastActiveRoomCode: nextRoom?.online ? nextRoom.code : null,
        emoteCooldownUntil: 0,
        chatMessages: nextRoom?.code && nextRoom.code === get().room?.code ? get().chatMessages : [],
        unreadChat: 0,
        chatOpen: false,
        roomAlert: null,
      });
    },

    markMatchSettled: () => set({ matchSettled: true }),

    exitToHome: () => {
      const prev = get();
      const preserveRejoinCode =
        prev.room?.online && prev.room.started && prev.game.phase !== 'GAME_OVER'
          ? prev.room.code
          : null;
      clearPendingTimers();
      roomTransport?.disconnect();
      set({
        screen: 'home',
        paused: false,
        waitingRollAck: false,
        simulation: false,
        room: null,
        lastActiveRoomCode: preserveRejoinCode,
        turnDeadlineAt: null,
        emoteCooldownUntil: 0,
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
      const { game, isAnimating, paused, room, waitingRollAck } = state;
      if (paused || isAnimating || waitingRollAck || game.phase !== 'ROLL') return;

      if (room?.online && roomTransport) {
        const seat = room.seats.find((s) => s.team === game.currentTeam);
        const isBotControlled = seat?.occupant === 'bot' || Boolean(seat?.botTakeover);
        const allowed = (room.myTeam === game.currentTeam && !seat?.botTakeover) || (room.isHost && isBotControlled);
        if (!allowed || pendingServerAck) return;
        pendingServerAck = true;
        set({ waitingRollAck: true, notice: 'Rolling…' });
        clearTimeout(serverAckTimer);
        serverAckTimer = setTimeout(() => {
          pendingServerAck = false;
          if (get().waitingRollAck) {
            set({ waitingRollAck: false, notice: turnNotice(get().game.currentTeam) });
          }
          roomTransport?.resync?.();
        }, SERVER_ACK_TIMEOUT_MS);
        roomTransport.roll();
        return;
      }

      const id = nextEventId++;
      set({
        activeRoll: { id, value: rollSmartDie(game) },
        isAnimating: true,
        waitingRollAck: false,
        legalMoves: [],
        hoveredPawnId: null,
        turnDeadlineAt: null,
        notice: 'Rolling…',
      });
      scheduleRollWatchdog(id, get);
    },

    completeRoll: (rollId) => {
      const { game, activeRoll, stats, simulation, vsAi, room, screen } = get();
      if (!activeRoll || activeRoll.id !== rollId) return;
      clearTimeout(rollWatchdogTimer);
      rollWatchdogTimer = undefined;
      const value = activeRoll.value;
      const result = applyRoll(game, value);
      const auth = activeRollAuthoritative;
      activeRollAuthoritative = null;
      const nextStats: MatchStats = {
        ...stats,
        turns: stats.turns + 1,
        sixes: stats.sixes + (value === 6 ? 1 : 0),
      };

      if (result.outcome === 'MOVE') {
        const finalGame = auth?.game ?? result.state;
        const finalLegal = auth?.legalMoves ?? result.legalMoves;
        if (auth?.seq !== undefined) lastAppliedSeq = Math.max(lastAppliedSeq, auth.seq);

        const sixBanner: EventBanner | null =
          value === 6
            ? {
                id: nextEventId++,
                text: finalGame.sixStreak === 2 ? 'DOUBLE 6! Careful—one more forfeits!' : 'LUCKY 6! Bonus roll earned',
                tone: 'six',
              }
            : get().lastBanner;
        const activeSeat = room?.seats.find((s) => s.team === finalGame.currentTeam);
        const isHumanTurn =
          !simulation &&
          (room?.online
            ? room.myTeam === finalGame.currentTeam && !activeSeat?.botTakeover
            : !vsAi || finalGame.currentTeam === 'PINK');
        const shouldAutoMove =
          screen === 'playing' && finalLegal.length === 1 && isHumanTurn && remoteActionQueue.length === 0;
        const nextDeadline =
          auth?.turnDeadlineAt !== undefined
            ? auth.turnDeadlineAt
            : shouldAutoMove
              ? null
              : computeLocalTurnDeadline(finalGame, simulation, vsAi, room);
        set({
          game: finalGame,
          legalMoves: finalLegal,
          hoveredPawnId: null,
          activeRoll: null,
          isAnimating: false,
          waitingRollAck: false,
          stats: nextStats,
          lastBanner: sixBanner,
          turnDeadlineAt: nextDeadline,
          notice: shouldAutoMove ? `Rolled ${value}! Auto-moving…` : `Rolled ${value}! Pick a glowing pawn.`,
        });
        if (remoteActionQueue.length > 0 || pendingSnapshot) {
          drainRemoteQueueOrReconcile();
          return;
        }
        if (shouldAutoMove) {
          clearTimeout(autoMoveTimer);
          const onlyPawn = finalLegal[0];
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
        waitingRollAck: false,
        hoveredPawnId: null,
        stats: nextStats,
        turnDeadlineAt: null,
        lastBanner:
          result.outcome === 'THREE_SIXES'
            ? { id: nextEventId++, text: '3× SIXES! Turn forfeited', tone: 'forfeit' }
            : get().lastBanner,
        notice,
      });
      hasPendingPass = true;
      clearTimeout(passTimer);
      const passDelay = get().simulation
        ? Math.round(NO_MOVE_DISPLAY_MS / Math.max(1, get().simulationSpeed))
        : remoteActionQueue.length > 0
          ? 120
          : NO_MOVE_DISPLAY_MS;
      passTimer = setTimeout(() => {
        hasPendingPass = false;
        passTimer = undefined;
        const curState = get();
        const finalGame = auth?.game ?? result.state;
        if (auth?.seq !== undefined) lastAppliedSeq = Math.max(lastAppliedSeq, auth.seq);
        const nextDeadline =
          auth?.turnDeadlineAt !== undefined
            ? auth.turnDeadlineAt
            : computeLocalTurnDeadline(finalGame, curState.simulation, curState.vsAi, curState.room);
        set({
          game: finalGame,
          legalMoves: auth?.legalMoves ?? [],
          isAnimating: false,
          turnDeadlineAt: nextDeadline,
          notice: turnNotice(finalGame.currentTeam),
        });
        drainRemoteQueueOrReconcile();
      }, passDelay);
    },

    selectPawn: (pawnId) => {
      clearTimeout(autoMoveTimer);
      const state = get();
      const { game, isAnimating, paused, legalMoves, room } = state;
      if (paused || isAnimating || game.phase !== 'MOVE' || !legalMoves.includes(pawnId)) return;

      if (room?.online && roomTransport) {
        const seat = room.seats.find((s) => s.team === game.currentTeam);
        const isBotControlled = seat?.occupant === 'bot' || Boolean(seat?.botTakeover);
        const allowed = (room.myTeam === game.currentTeam && !seat?.botTakeover) || (room.isHost && isBotControlled);
        if (!allowed || pendingServerAck) return;
        pendingServerAck = true;
        clearTimeout(serverAckTimer);
        serverAckTimer = setTimeout(() => {
          pendingServerAck = false;
          roomTransport?.resync?.();
        }, SERVER_ACK_TIMEOUT_MS);
        roomTransport.move(pawnId);
        return;
      }

      const patch = buildMovePatch(state, pawnId);
      if (patch) {
        set({ ...patch, turnDeadlineAt: null });
        scheduleEventWatchdog(patch.lastEvent, get);
      }
    },

    completeEvent: (eventId) => {
      const { lastEvent, eventQueue, pendingGame } = get();
      if (!lastEvent || lastEvent.id !== eventId) return;
      clearTimeout(eventWatchdogTimer);
      eventWatchdogTimer = undefined;
      const sNow = get();
      if (sNow.vsAi && !sNow.room?.online && !sNow.simulation) {
        const teamFromPawn = (pid: string) => sNow.game.pawns.find((p) => p.id === pid)?.team;
        const botTeams = sNow.game.activeTeams.filter((t) => t !== 'PINK');
        const pickRandomBot = (exclude?: TeamId) => {
          const pool = exclude ? botTeams.filter((t) => t !== exclude) : botTeams;
          return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
        };
        const triggerBot = (team: TeamId | undefined, mood: BotEmoteMood, chance: number) => {
          if (!team || team === 'PINK' || Math.random() > chance) return;
          const prev = sNow.yardEmotes[team];
          const isMandatory = mood === 'capture' || mood === 'captured' || mood === 'home' || mood === 'win';
          if (!isMandatory && prev && Date.now() < prev.expiresAt + 2000) return;
          const delayMs = 350 + Math.random() * 600;
          setTimeout(() => {
            const cur = get();
            if (cur.screen !== 'playing' || cur.paused) return;
            cur.triggerYardEmote(team, pickBotEmote(mood));
          }, delayMs);
        };
        const maybeBotChat = (team: TeamId | undefined, chance: number) => {
          if (!team || team === 'PINK' || Object.keys(sNow.botNames).length === 0) return;
          if (isBotGossipActive) return;
          if (Date.now() - lastBotChatTimestamp < 25_000) return;
          if (Math.random() > chance) return;
          const delayMs = 9000 + Math.random() * 11000;
          const timer = setTimeout(() => {
            const cur = get();
            if (cur.screen !== 'playing' || cur.paused || isBotGossipActive) return;
            const name = cur.botNames[team] || TEAM_LABELS[team];
            const text = pickBotChatReply(undefined, getBotPersonality(name));
            if (!text) return;
            cur.pushChatMessage({
              id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              team,
              senderName: name,
              text,
              ts: Date.now(),
            });
            lastBotChatTimestamp = Date.now();
          }, delayMs);
          activeBotChatTimers.push(timer);
        };
        const maybeBotGossip = () => {
          if (botTeams.length < 2 || Object.keys(sNow.botNames).length === 0) return;
          if (isBotGossipActive) return;
          if (Date.now() - lastBotChatTimestamp < 35_000) return;
          const existingGossip = sNow.chatMessages.filter((m) => m.id.startsWith('gossip-')).length;
          if (existingGossip >= 12 || Math.random() > 0.45) return;

          const botA = botTeams[0];
          const botB = botTeams[1];
          const nameA = sNow.botNames[botA] || TEAM_LABELS[botA];
          const nameB = sNow.botNames[botB] || TEAM_LABELS[botB];
          const story = pickBotGossipStory();
          isBotGossipActive = true;

          // Human reading & typing delay: 8-14s for opening message
          let delayCursor = 8000 + Math.random() * 6000;
          story.lines.forEach((line, idx) => {
            const speakerTeam = line.speaker === 'A' ? botA : botB;
            const speakerName = line.speaker === 'A' ? nameA : nameB;
            const timer = setTimeout(() => {
              const cur = get();
              if (cur.screen !== 'playing' || cur.paused) {
                isBotGossipActive = false;
                return;
              }
              cur.pushChatMessage({
                id: `gossip-${Date.now()}-${idx}`,
                team: speakerTeam,
                senderName: speakerName,
                text: line.text,
                ts: Date.now(),
              });
              lastBotChatTimestamp = Date.now();
              if (idx === story.lines.length - 1) {
                isBotGossipActive = false;
              }
            }, delayCursor);
            activeBotChatTimers.push(timer);
            // Realistic reading & typing gap: 11-20s between turns!
            delayCursor += 11000 + Math.random() * 9000;
          });
        };
        if (lastEvent.type === 'CAPTURE') {
          const attacker = teamFromPawn(lastEvent.attackerId);
          const victim = teamFromPawn(lastEvent.victimId);
          // Hard user rule: Attacker bot ALWAYS laughing GIF!
          triggerBot(attacker, 'capture', 1.0);
          // Hard user rule: Victim bot whose piece was captured ALWAYS crying GIF (sadhamster)!
          triggerBot(victim, 'captured', 1.0);
          triggerBot(pickRandomBot(attacker === 'PINK' ? victim : attacker), 'user_lucky', 0.45);
          maybeBotChat(attacker !== 'PINK' ? attacker : victim, 0.25);
          maybeBotGossip();
        } else if (lastEvent.type === 'REACH_HOME') {
          const mover = teamFromPawn(lastEvent.pawnId);
          if (mover === 'PINK') {
            const reactor = pickRandomBot();
            triggerBot(reactor, 'user_home', 0.6);
            maybeBotChat(reactor, 0.25);
          } else {
            // Hard user rule: Winning situation ALWAYS laughing GIF!
            triggerBot(mover, 'home', 1.0);
            triggerBot(pickRandomBot(mover), 'user_home', 0.4);
          }
          maybeBotGossip();
        } else if (lastEvent.type === 'SPAWN_6') {
          const mover = teamFromPawn(lastEvent.pawnId);
          if (mover === 'PINK') triggerBot(pickRandomBot(), 'user_lucky', 0.35);
          else {
            triggerBot(mover, 'six', 0.45);
            triggerBot(pickRandomBot(mover), 'user_lucky', 0.3);
          }
        }
      }
      if (eventQueue.length > 0) {
        const next = eventQueue[0];
        set({ lastEvent: next, eventQueue: eventQueue.slice(1) });
        if (!get().paused || get().room?.online) scheduleEventWatchdog(next, get);
        return;
      }
      const auth = pendingEventAuthoritative;
      pendingEventAuthoritative = null;
      const curState = get();
      const finalGame = auth?.game ?? pendingGame ?? curState.game;
      if (auth?.seq !== undefined) lastAppliedSeq = Math.max(lastAppliedSeq, auth.seq);
      const nextDeadline =
        auth?.turnDeadlineAt !== undefined
          ? auth.turnDeadlineAt
          : computeLocalTurnDeadline(finalGame, curState.simulation, curState.vsAi, curState.room);
      set({
        game: finalGame,
        legalMoves: auth?.legalMoves ?? [],
        pendingGame: null,
        lastEvent: null,
        isAnimating: false,
        turnDeadlineAt: nextDeadline,
      });
      if (finalGame.phase === 'GAME_OVER' && curState.vsAi && !curState.room?.online && !curState.simulation) {
        finalGame.winners.forEach((winTeam) => {
          if (winTeam !== 'PINK') {
            setTimeout(() => {
              const cur = get();
              if (cur.screen === 'playing') cur.triggerYardEmote(winTeam, pickBotEmote('win'));
            }, 400);
          }
        });
        finalGame.activeTeams.forEach((t) => {
          if (t !== 'PINK' && !finalGame.winners.includes(t)) {
            setTimeout(() => {
              const cur = get();
              if (cur.screen === 'playing') cur.triggerYardEmote(t, pickBotEmote('captured'));
            }, 650);
          }
        });
      }
      drainRemoteQueueOrReconcile();
    },

    setMode: (mode) => {
      clearPendingTimers();
      const cur = get();
      const initial = freshState(mode);
      set({
        ...initial,
        turnDeadlineAt: computeLocalTurnDeadline(initial.game, cur.simulation, cur.vsAi, cur.room),
        paused: false,
        waitingRollAck: false,
      });
    },

    resetGame: () => {
      const { room, game, simulation, vsAi, matchStake } = get();
      if (room?.online && roomTransport) {
        if (room.isHost) roomTransport.reset();
        return;
      }
      clearPendingTimers();
      const nextStake = matchStake > 0 && !simulation && vsAi && useWalletStore.getState().deduct(matchStake) ? matchStake : 0;
      const initial = freshState(game.mode);
      set({
        ...initial,
        matchStake: nextStake,
        turnDeadlineAt: computeLocalTurnDeadline(initial.game, simulation, vsAi, room),
        paused: false,
        waitingRollAck: false,
      });
    },
  };
});
