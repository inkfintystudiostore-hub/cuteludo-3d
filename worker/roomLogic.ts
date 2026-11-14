/**
 * Authoritative multiplayer room state machine shared by LudoRoomDO and unit tests.
 * Validates turn ownership, rolls server-authoritative dice, enforces legal moves,
 * and emits compact events so connected devices animate in lockstep.
 */
import { TEAM_LABELS, type TeamId } from '../src/engine/boardMap';
import { applyMove, applyRoll, createGame, rollSmartDie, type GameMode, type GameState } from '../src/engine/ludoRules';
import { ROOM_EMOTE_IDS, type ClientMessage, type RoomSnapshot, type SeatInfo, type ServerMessage } from '../src/engine/multiplayerProtocol';

const VALID_EMOTES = new Set<string>(ROOM_EMOTE_IDS);

export const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
export const LOBBY_RECONNECT_GRACE_MS = 5 * 60 * 1000;

export interface RoomRecord {
  code: string;
  mode: GameMode;
  hostId: string;
  started: boolean;
  seats: SeatInfo[];
  game: GameState;
  legalMoves: string[];
  lastActiveAt?: number;
}

export function isRoomExpired(record: RoomRecord | null, now = Date.now()): boolean {
  if (!record || !record.lastActiveAt) return false;
  return now - record.lastActiveAt > ROOM_IDLE_TTL_MS;
}

export function isRoomCodeOccupied(record: RoomRecord | null, now = Date.now()): boolean {
  if (!record || isRoomExpired(record, now)) return false;
  return true;
}

interface JoinedPlayerRef {
  playerId: string;
  playerName?: string;
  preferredTeam?: TeamId;
}

function sanitizePlayerName(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 18);
  return cleaned.length > 0 ? cleaned : undefined;
}

function sanitizeChatText(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function formatHumanLabel(team: TeamId, idx: number, isHost: boolean, playerName?: string): string {
  if (playerName) return isHost ? `${playerName} (Host)` : playerName;
  return isHost ? `${TEAM_LABELS[team]} (Host)` : `${TEAM_LABELS[team]} (P${idx + 1})`;
}

function makeSeats(mode: GameMode, existingHumans: JoinedPlayerRef[] = [], hostId = ''): SeatInfo[] {
  const active = createGame(mode).activeTeams;
  const seats: SeatInfo[] = active.map((team) => ({
    team,
    occupant: 'open',
    playerId: null,
    playerName: undefined,
    label: 'Waiting…',
    connected: false,
  }));

  const unplaced: JoinedPlayerRef[] = [];
  for (const ref of existingHumans) {
    const idx = ref.preferredTeam ? seats.findIndex((s) => s.team === ref.preferredTeam && s.occupant === 'open') : -1;
    if (idx >= 0) {
      const isHost = Boolean(hostId ? ref.playerId === hostId : idx === 0);
      seats[idx] = {
        team: seats[idx].team,
        occupant: 'human',
        playerId: ref.playerId,
        playerName: ref.playerName,
        label: formatHumanLabel(seats[idx].team, idx, isHost, ref.playerName),
        connected: true,
      };
    } else {
      unplaced.push(ref);
    }
  }

  for (const ref of unplaced) {
    const idx = seats.findIndex((s) => s.occupant === 'open');
    if (idx < 0) break;
    const isHost = Boolean(hostId ? ref.playerId === hostId : idx === 0);
    seats[idx] = {
      team: seats[idx].team,
      occupant: 'human',
      playerId: ref.playerId,
      playerName: ref.playerName,
      label: formatHumanLabel(seats[idx].team, idx, isHost, ref.playerName),
      connected: true,
    };
  }

  return seats;
}

export function createRoomRecord(code: string, mode: GameMode = '4P_FFA'): RoomRecord {
  const game = createGame(mode);
  return {
    code,
    mode,
    hostId: '',
    started: false,
    seats: makeSeats(mode),
    game,
    legalMoves: [],
  };
}

export function snapshotForPlayer(record: RoomRecord, playerId: string): RoomSnapshot {
  const mySeat = record.seats.find((s) => s.playerId === playerId && s.occupant === 'human');
  return {
    code: record.code,
    mode: record.mode,
    hostId: record.hostId,
    started: record.started,
    seats: record.seats,
    game: record.game,
    yourPlayerId: playerId,
    yourTeam: mySeat?.team ?? null,
    isHost: record.hostId === playerId,
  };
}

function clearSeat(seat: SeatInfo): SeatInfo {
  return {
    team: seat.team,
    occupant: 'open',
    playerId: null,
    playerName: undefined,
    label: 'Waiting…',
    connected: false,
  };
}

export function pruneExpiredLobbySeats(record: RoomRecord, now = Date.now()): RoomRecord {
  if (record.started) return record;
  let changed = false;
  const seats = record.seats.map((s) => {
    if (
      s.occupant === 'human' &&
      !s.connected &&
      typeof s.disconnectedAt === 'number' &&
      now - s.disconnectedAt > LOBBY_RECONNECT_GRACE_MS
    ) {
      changed = true;
      return clearSeat(s);
    }
    return s;
  });
  if (!changed) return record;

  let hostId = record.hostId;
  if (hostId && !seats.some((s) => s.occupant === 'human' && s.playerId === hostId)) {
    const nextIdx = seats.findIndex((s) => s.occupant === 'human' && s.connected && s.playerId);
    const fallbackIdx = nextIdx >= 0 ? nextIdx : seats.findIndex((s) => s.occupant === 'human' && s.playerId);
    if (fallbackIdx >= 0 && seats[fallbackIdx].playerId) {
      hostId = seats[fallbackIdx].playerId!;
      seats[fallbackIdx] = {
        ...seats[fallbackIdx],
        label: formatHumanLabel(seats[fallbackIdx].team, fallbackIdx, true, seats[fallbackIdx].playerName),
      };
    } else {
      hostId = '';
    }
  }
  return { ...record, hostId, seats };
}

export function joinRoom(record: RoomRecord, playerId: string, name?: string, now = Date.now()): RoomRecord {
  const pruned = pruneExpiredLobbySeats(record, now);
  const seats = pruned.seats.map((s) => ({ ...s }));
  const cleanName = sanitizePlayerName(name);
  const existingIdx = seats.findIndex((s) => s.playerId === playerId);
  if (existingIdx >= 0) {
    const existing = seats[existingIdx];
    existing.connected = true;
    delete existing.disconnectedAt;
    const hostId = pruned.hostId || playerId;
    if (cleanName !== undefined) existing.playerName = cleanName;
    existing.label = formatHumanLabel(existing.team, existingIdx, hostId === playerId, existing.playerName);
    return { ...pruned, hostId, seats };
  }

  let hostId = pruned.hostId;
  if (!pruned.started) {
    const openIdx = seats.findIndex((s) => s.occupant === 'open');
    if (openIdx >= 0) {
      const open = seats[openIdx];
      const takenCount = seats.filter((s) => s.occupant === 'human').length;
      if (!hostId) hostId = playerId;
      const isHost = hostId === playerId;
      open.occupant = 'human';
      open.playerId = playerId;
      open.playerName = cleanName;
      open.connected = true;
      delete open.disconnectedAt;
      open.label = formatHumanLabel(open.team, takenCount, isHost, cleanName);
    }
  }

  return { ...pruned, hostId, seats };
}

export function disconnectPlayer(record: RoomRecord, playerId: string, now = Date.now()): RoomRecord {
  const seats = record.seats.map((s) => ({ ...s }));
  const target = seats.find((s) => s.playerId === playerId);
  if (!target) return record;

  // Keep lobby seats reserved across brief network drops / mobile app switches (e.g. sharing link in WhatsApp).
  target.connected = false;
  target.disconnectedAt = now;

  let hostId = record.hostId;
  if (record.started && hostId === playerId) {
    const nextIdx = seats.findIndex((s) => s.occupant === 'human' && s.connected && s.playerId);
    if (nextIdx >= 0 && seats[nextIdx].playerId) {
      hostId = seats[nextIdx].playerId!;
      seats[nextIdx].label = formatHumanLabel(seats[nextIdx].team, nextIdx, true, seats[nextIdx].playerName);
    }
  }

  return { ...record, hostId, seats };
}

export function leaveRoom(record: RoomRecord, playerId: string, now = Date.now()): RoomRecord {
  if (record.started) {
    return disconnectPlayer(record, playerId, now);
  }
  const seats = record.seats.map((s) => ({ ...s }));
  const idx = seats.findIndex((s) => s.playerId === playerId && s.occupant === 'human');
  if (idx < 0) return record;

  seats[idx] = clearSeat(seats[idx]);

  let hostId = record.hostId;
  if (hostId === playerId) {
    const nextIdx = seats.findIndex((s) => s.occupant === 'human' && s.connected && s.playerId);
    const fallbackIdx = nextIdx >= 0 ? nextIdx : seats.findIndex((s) => s.occupant === 'human' && s.playerId);
    if (fallbackIdx >= 0 && seats[fallbackIdx].playerId) {
      hostId = seats[fallbackIdx].playerId!;
      seats[fallbackIdx].label = formatHumanLabel(seats[fallbackIdx].team, fallbackIdx, true, seats[fallbackIdx].playerName);
    } else {
      hostId = '';
    }
  }

  return { ...record, hostId, seats };
}

function canControlCurrentTurn(record: RoomRecord, playerId: string): boolean {
  const seat = record.seats.find((s) => s.team === record.game.currentTeam);
  if (!seat) return false;
  if (seat.occupant === 'human') return seat.playerId === playerId;
  if (seat.occupant === 'bot') return record.hostId === playerId;
  return false;
}

export interface RoomActionResult {
  record: RoomRecord;
  broadcast: ServerMessage[];
  reply?: ServerMessage;
  broadcastSnapshots?: boolean;
  persist: boolean;
}

export function handleRoomAction(
  record: RoomRecord,
  playerId: string,
  msg: ClientMessage,
  random: () => number = Math.random,
): RoomActionResult {
  switch (msg.type) {
    case 'ping': {
      return { record, broadcast: [], reply: { type: 'pong' }, persist: false };
    }

    case 'join': {
      const next = joinRoom(record, playerId, msg.name);
      return { record: next, broadcast: [], broadcastSnapshots: true, persist: true };
    }

    case 'leave': {
      const next = leaveRoom(record, playerId);
      return { record: next, broadcast: [], broadcastSnapshots: true, persist: true };
    }

    case 'set_name': {
      const seats = record.seats.map((s) => ({ ...s }));
      const idx = seats.findIndex((s) => s.playerId === playerId && s.occupant === 'human');
      if (idx < 0) return { record, broadcast: [], persist: false };
      const cleanName = sanitizePlayerName(msg.name);
      seats[idx].playerName = cleanName;
      seats[idx].label = formatHumanLabel(seats[idx].team, idx, record.hostId === playerId, cleanName);
      return { record: { ...record, seats }, broadcast: [], broadcastSnapshots: true, persist: true };
    }

    case 'select_team': {
      if (record.started) {
        return { record, broadcast: [], reply: { type: 'error', message: 'Match already started.' }, persist: false };
      }
      const seats = record.seats.map((s) => ({ ...s }));
      const currentIdx = seats.findIndex((s) => s.playerId === playerId && s.occupant === 'human');
      const targetIdx = seats.findIndex((s) => s.team === msg.team);
      if (currentIdx < 0 || targetIdx < 0) return { record, broadcast: [], persist: false };
      if (currentIdx === targetIdx) return { record, broadcast: [], persist: false };
      if (seats[targetIdx].occupant !== 'open') {
        return {
          record,
          broadcast: [],
          reply: { type: 'error', message: `${TEAM_LABELS[msg.team]} is already taken!` },
          persist: false,
        };
      }
      const moving = seats[currentIdx];
      seats[targetIdx] = {
        team: seats[targetIdx].team,
        occupant: 'human',
        playerId,
        playerName: moving.playerName,
        connected: moving.connected,
        label: formatHumanLabel(seats[targetIdx].team, targetIdx, record.hostId === playerId, moving.playerName),
      };
      seats[currentIdx] = {
        team: moving.team,
        occupant: 'open',
        playerId: null,
        playerName: undefined,
        connected: false,
        label: 'Waiting…',
      };
      return { record: { ...record, seats }, broadcast: [], broadcastSnapshots: true, persist: true };
    }

    case 'set_mode': {
      if (playerId !== record.hostId || record.started) {
        return { record, broadcast: [], persist: false };
      }
      const humans: JoinedPlayerRef[] = record.seats
        .filter((s) => s.occupant === 'human' && s.playerId)
        .map((s) => ({ playerId: s.playerId!, playerName: s.playerName, preferredTeam: s.team }));
      const next: RoomRecord = {
        ...record,
        mode: msg.mode,
        seats: makeSeats(msg.mode, humans, record.hostId),
        game: createGame(msg.mode),
        legalMoves: [],
      };
      return { record: next, broadcast: [], broadcastSnapshots: true, persist: true };
    }

    case 'start': {
      if (playerId !== record.hostId) {
        return { record, broadcast: [], persist: false };
      }
      const modeChanged = msg.mode !== record.mode;
      const baseHumans: JoinedPlayerRef[] = record.seats
        .filter((s) => s.occupant === 'human' && s.playerId)
        .map((s) => ({ playerId: s.playerId!, playerName: s.playerName, preferredTeam: s.team }));
      const baseSeats = modeChanged ? makeSeats(msg.mode, baseHumans, record.hostId) : record.seats.map((s) => ({ ...s }));
      const filledSeats: SeatInfo[] = baseSeats.map((s) =>
        s.occupant === 'open' ? { ...s, occupant: 'bot', label: `${TEAM_LABELS[s.team]} (AI)`, connected: true } : s,
      );
      const next: RoomRecord = {
        ...record,
        mode: msg.mode,
        started: true,
        seats: filledSeats,
        game: createGame(msg.mode),
        legalMoves: [],
      };
      return { record: next, broadcast: [], broadcastSnapshots: true, persist: true };
    }

    case 'roll': {
      if (!record.started || record.game.phase !== 'ROLL' || !canControlCurrentTurn(record, playerId)) {
        return {
          record,
          broadcast: [],
          reply: { type: 'error', message: 'Not your turn to roll.' },
          persist: false,
        };
      }
      const team = record.game.currentTeam;
      const value = rollSmartDie(record.game, random);
      const rolled = applyRoll(record.game, value);
      const next: RoomRecord = {
        ...record,
        game: rolled.state,
        legalMoves: rolled.outcome === 'MOVE' ? rolled.legalMoves : [],
      };
      return {
        record: next,
        broadcast: [{ type: 'roll', value, team }],
        persist: true,
      };
    }

    case 'move': {
      if (!record.started || record.game.phase !== 'MOVE' || !canControlCurrentTurn(record, playerId)) {
        return {
          record,
          broadcast: [],
          reply: { type: 'error', message: 'Not your turn to move.' },
          persist: false,
        };
      }
      if (!record.legalMoves.includes(msg.pawnId)) {
        return {
          record,
          broadcast: [],
          reply: { type: 'error', message: 'Illegal pawn selection.' },
          persist: false,
        };
      }
      const team = record.game.currentTeam;
      const moved = applyMove(record.game, msg.pawnId);
      const next: RoomRecord = {
        ...record,
        game: moved.state,
        legalMoves: [],
      };
      return {
        record: next,
        broadcast: [{ type: 'move', pawnId: msg.pawnId, team }],
        persist: true,
      };
    }

    case 'reset': {
      if (playerId !== record.hostId) {
        return { record, broadcast: [], persist: false };
      }
      const next: RoomRecord = {
        ...record,
        game: createGame(record.mode),
        legalMoves: [],
      };
      return {
        record: next,
        broadcast: [{ type: 'reset', mode: record.mode }],
        broadcastSnapshots: true,
        persist: true,
      };
    }

    case 'chat': {
      const text = sanitizeChatText(msg.text);
      if (!text) return { record, broadcast: [], persist: false };
      const seat = record.seats.find((s) => s.playerId === playerId && s.occupant === 'human');
      const senderName = seat?.playerName || (seat ? TEAM_LABELS[seat.team] : 'Guest');
      return {
        record,
        broadcast: [
          {
            type: 'chat',
            chat: {
              id: crypto.randomUUID(),
              team: (seat?.team ?? null) as TeamId | null,
              senderName,
              text,
              ts: Date.now(),
            },
          },
        ],
        persist: false,
      };
    }

    case 'emote': {
      if (!VALID_EMOTES.has(msg.emote)) return { record, broadcast: [], persist: false };
      const seat = record.seats.find((s) => s.playerId === playerId && s.occupant === 'human');
      return {
        record,
        broadcast: [{ type: 'emote', emote: msg.emote, fromTeam: (seat?.team ?? null) as TeamId | null }],
        persist: false,
      };
    }
  }
}
