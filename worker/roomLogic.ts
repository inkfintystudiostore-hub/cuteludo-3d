/**
 * Authoritative multiplayer room state machine shared by LudoRoomDO and unit tests.
 * Validates turn ownership, rolls server-authoritative dice, enforces legal moves,
 * and emits compact events so connected devices animate in lockstep.
 */
import { TEAM_LABELS, type TeamId } from '../src/engine/boardMap';
import { applyMove, applyRoll, createGame, rollDie, type GameMode, type GameState } from '../src/engine/ludoRules';
import type { ClientMessage, RoomSnapshot, SeatInfo, ServerMessage } from '../src/engine/multiplayerProtocol';

export interface RoomRecord {
  code: string;
  mode: GameMode;
  hostId: string;
  started: boolean;
  seats: SeatInfo[];
  game: GameState;
  legalMoves: string[];
}

function makeSeats(mode: GameMode, existingHumanIds: string[] = []): SeatInfo[] {
  const active = createGame(mode).activeTeams;
  return active.map((team, idx) => {
    const pid = existingHumanIds[idx] ?? null;
    return {
      team,
      occupant: pid ? 'human' : 'open',
      playerId: pid,
      label: pid ? (idx === 0 ? `${TEAM_LABELS[team]} (Host)` : `${TEAM_LABELS[team]} (P${idx + 1})`) : 'Waiting…',
      connected: Boolean(pid),
    };
  });
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

export function joinRoom(record: RoomRecord, playerId: string): RoomRecord {
  const seats = record.seats.map((s) => ({ ...s }));
  const existing = seats.find((s) => s.playerId === playerId);
  if (existing) {
    existing.connected = true;
    const hostId = record.hostId || playerId;
    return { ...record, hostId, seats };
  }

  let hostId = record.hostId;
  if (!record.started) {
    const open = seats.find((s) => s.occupant === 'open');
    if (open) {
      const takenCount = seats.filter((s) => s.occupant === 'human').length;
      if (!hostId) hostId = playerId;
      const isHost = hostId === playerId;
      open.occupant = 'human';
      open.playerId = playerId;
      open.connected = true;
      open.label = isHost ? `${TEAM_LABELS[open.team]} (Host)` : `${TEAM_LABELS[open.team]} (P${takenCount + 1})`;
    }
  }

  return { ...record, hostId, seats };
}

export function disconnectPlayer(record: RoomRecord, playerId: string): RoomRecord {
  const seats = record.seats.map((s) => ({ ...s }));
  const target = seats.find((s) => s.playerId === playerId);
  if (!target) return record;

  if (!record.started) {
    target.occupant = 'open';
    target.playerId = null;
    target.connected = false;
    target.label = 'Waiting…';
  } else {
    target.connected = false;
  }

  let hostId = record.hostId;
  if (hostId === playerId) {
    const nextHost = seats.find((s) => s.occupant === 'human' && s.connected && s.playerId);
    if (nextHost?.playerId) hostId = nextHost.playerId;
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
    case 'join': {
      const next = joinRoom(record, playerId);
      return { record: next, broadcast: [], broadcastSnapshots: true, persist: true };
    }

    case 'set_mode': {
      if (playerId !== record.hostId || record.started) {
        return { record, broadcast: [], persist: false };
      }
      const humanIds = record.seats.filter((s) => s.occupant === 'human' && s.playerId).map((s) => s.playerId!);
      const next: RoomRecord = {
        ...record,
        mode: msg.mode,
        seats: makeSeats(msg.mode, humanIds),
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
      const baseHumans = record.seats.filter((s) => s.occupant === 'human' && s.playerId).map((s) => s.playerId!);
      const baseSeats = modeChanged ? makeSeats(msg.mode, baseHumans) : record.seats.map((s) => ({ ...s }));
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
      const value = rollDie(random);
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

    case 'emote': {
      const seat = record.seats.find((s) => s.playerId === playerId && s.occupant === 'human');
      return {
        record,
        broadcast: [{ type: 'emote', emote: msg.emote, fromTeam: (seat?.team ?? null) as TeamId | null }],
        persist: false,
      };
    }
  }
}
