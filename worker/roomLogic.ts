/**
 * Authoritative multiplayer room state machine shared by LudoRoomDO and unit tests.
 * Validates turn ownership, rolls server-authoritative dice, enforces legal moves,
 * and emits compact events so connected devices animate in lockstep.
 */
import { TEAM_LABELS, type TeamId } from '../src/engine/boardMap';
import { applyMove, applyRoll, createGame, getLegalMoves, pickSmartBotMove, rollSmartDie, skipTurn, type GameMode, type GameState } from '../src/engine/ludoRules';
import { isValidFriendsStakeTier, MIN_FRIENDS_STAKE } from '../src/engine/walletStore';
import {
  BOT_TURN_FALLBACK_MS,
  DISCONNECTED_TURN_WAIT_MS,
  GAME_OVER_ROOM_CLOSE_MS,
  ROOM_EMOTE_IDS,
  TURN_TIMEOUT_MS,
  type ClientMessage,
  type RoomSnapshot,
  type SeatInfo,
  type ServerMessage,
} from '../src/engine/multiplayerProtocol';

const VALID_EMOTES = new Set<string>(ROOM_EMOTE_IDS);

export function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x1_0000_0000;
}

export const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
export const LOBBY_RECONNECT_GRACE_MS = 5 * 60 * 1000;
export const EMPTY_ROOM_CLOSE_MS = LOBBY_RECONNECT_GRACE_MS;
export const LOBBY_RECLAIM_STALE_MS = 8 * 1000;
const MIN_DISCONNECT_WAIT_MS = 10_000;

export interface RoomRecord {
  code: string;
  mode: GameMode;
  stake?: number;
  hostId: string;
  started: boolean;
  seats: SeatInfo[];
  game: GameState;
  legalMoves: string[];
  seq?: number;
  lastActiveAt?: number;
  turnDeadlineAt?: number;
  closeAt?: number;
  /** Server-only map of team -> persistent browser deviceId for closed-tab rejoin. */
  seatDeviceIds?: Partial<Record<TeamId, string>>;
}

export function hasConnectedHuman(record: RoomRecord | null): boolean {
  return Boolean(record?.seats.some((s) => s.occupant === 'human' && s.connected));
}

export function shouldCloseRoomOnLeave(record: RoomRecord): boolean {
  if (!record.started) {
    return record.seats.every((s) => s.occupant === 'open');
  }
  return !hasConnectedHuman(record);
}

export function isRoomClosedWhenEmpty(record: RoomRecord | null, now = Date.now()): boolean {
  if (!record) return false;
  if (hasConnectedHuman(record)) return false;
  if (!record.lastActiveAt) return false;
  return now - record.lastActiveAt >= EMPTY_ROOM_CLOSE_MS;
}

export function isRoomClosedAfterGameOver(record: RoomRecord | null, now = Date.now()): boolean {
  return Boolean(
    record?.started &&
      record.game.phase === 'GAME_OVER' &&
      typeof record.closeAt === 'number' &&
      now >= record.closeAt,
  );
}

export function isRoomExpired(record: RoomRecord | null, now = Date.now()): boolean {
  if (!record) return false;
  if (isRoomClosedAfterGameOver(record, now)) return true;
  if (isRoomClosedWhenEmpty(record, now)) return true;
  if (!record.lastActiveAt) return false;
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
    stake: MIN_FRIENDS_STAKE,
    hostId: '',
    started: false,
    seats: makeSeats(mode),
    game,
    legalMoves: [],
    seq: 0,
  };
}

export function snapshotForPlayer(record: RoomRecord, playerId: string, now = Date.now()): RoomSnapshot {
  const mySeat = record.seats.find((s) => s.playerId === playerId && s.occupant === 'human');
  const turnRemainingMs =
    record.started && record.game.phase !== 'GAME_OVER' && typeof record.turnDeadlineAt === 'number'
      ? Math.max(0, record.turnDeadlineAt - now)
      : undefined;
  const roomCloseRemainingMs =
    record.started && record.game.phase === 'GAME_OVER' && typeof record.closeAt === 'number'
      ? Math.max(0, record.closeAt - now)
      : undefined;
  return {
    code: record.code,
    mode: record.mode,
    stake: record.stake ?? MIN_FRIENDS_STAKE,
    hostId: record.hostId,
    started: record.started,
    seats: record.seats,
    game: record.game,
    legalMoves: record.legalMoves,
    seq: record.seq ?? 0,
    turnRemainingMs,
    roomCloseRemainingMs,
    yourPlayerId: playerId,
    yourTeam: mySeat?.team ?? null,
    isHost: record.hostId === playerId,
  };
}

export function isSeatBotControlled(seat: SeatInfo | undefined): boolean {
  return Boolean(seat && (seat.occupant === 'bot' || (seat.occupant === 'human' && seat.botTakeover)));
}

export function computeTurnDeadlineAt(
  record: Pick<RoomRecord, 'started' | 'seats' | 'game'>,
  now = Date.now(),
): number | undefined {
  if (!record.started || record.game.phase === 'GAME_OVER') return undefined;
  const seat = record.seats.find((s) => s.team === record.game.currentTeam);
  if (isSeatBotControlled(seat)) return now + BOT_TURN_FALLBACK_MS;
  if (seat?.occupant === 'human' && !seat.connected) return now + DISCONNECTED_TURN_WAIT_MS;
  return now + TURN_TIMEOUT_MS;
}

function computeDisconnectTurnDeadline(existingDeadline: number | undefined, now: number): number {
  if (typeof existingDeadline !== 'number') return now + DISCONNECTED_TURN_WAIT_MS;
  const remaining = existingDeadline - now;
  return now + Math.min(DISCONNECTED_TURN_WAIT_MS, Math.max(MIN_DISCONNECT_WAIT_MS, remaining));
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

export function markDisconnectedIfMissingSockets(
  record: RoomRecord,
  activePlayerIds: Set<string>,
  now = Date.now(),
): RoomRecord {
  let changed = false;
  let currentTurnDisconnected = false;
  const seats = record.seats.map((s) => {
    if (s.occupant === 'human' && s.playerId && s.connected && !activePlayerIds.has(s.playerId)) {
      changed = true;
      if (record.started && record.game.currentTeam === s.team && !s.botTakeover) {
        currentTurnDisconnected = true;
      }
      return {
        ...s,
        connected: false,
        disconnectedAt: s.disconnectedAt ?? now - LOBBY_RECLAIM_STALE_MS,
        missedTurns: s.missedTurns ?? 0,
        botTakeover: s.botTakeover ?? false,
      };
    }
    return s;
  });
  if (!changed) return record;

  let hostId = record.hostId;
  if (record.started && hostId) {
    const hostSeat = seats.find((s) => s.playerId === hostId);
    if (!hostSeat || !hostSeat.connected) {
      const nextIdx = seats.findIndex((s) => s.occupant === 'human' && s.connected && s.playerId);
      if (nextIdx >= 0 && seats[nextIdx].playerId) {
        hostId = seats[nextIdx].playerId!;
        seats[nextIdx] = {
          ...seats[nextIdx],
          label: formatHumanLabel(seats[nextIdx].team, nextIdx, true, seats[nextIdx].playerName),
        };
      }
    }
  }

  const turnDeadlineAt =
    currentTurnDisconnected && record.game.phase !== 'GAME_OVER'
      ? computeDisconnectTurnDeadline(record.turnDeadlineAt, now)
      : record.turnDeadlineAt;

  return { ...record, hostId, seats, turnDeadlineAt };
}

export function joinRoom(
  record: RoomRecord,
  playerId: string,
  name?: string,
  now = Date.now(),
  deviceId?: string,
): RoomRecord {
  const pruned = pruneExpiredLobbySeats(record, now);
  const seats = pruned.seats.map((s) => ({ ...s }));
  const seatDeviceIds: Partial<Record<TeamId, string>> = { ...(pruned.seatDeviceIds ?? {}) };
  const cleanName = sanitizePlayerName(name);
  const existingIdx = seats.findIndex((s) => s.playerId === playerId);
  if (existingIdx >= 0) {
    const existing = seats[existingIdx];
    const wasDisconnected = !existing.connected || Boolean(existing.botTakeover);
    existing.connected = true;
    delete existing.disconnectedAt;
    delete existing.botTakeover;
    delete existing.missedTurns;
    const hostId = pruned.hostId || playerId;
    if (cleanName !== undefined) existing.playerName = cleanName;
    existing.label = formatHumanLabel(existing.team, existingIdx, hostId === playerId, existing.playerName);
    if (deviceId) seatDeviceIds[existing.team] = deviceId;
    const turnDeadlineAt =
      pruned.started && pruned.game.phase !== 'GAME_OVER' && pruned.game.currentTeam === existing.team && wasDisconnected
        ? now + TURN_TIMEOUT_MS
        : pruned.turnDeadlineAt;
    return { ...pruned, hostId, seats, seatDeviceIds, turnDeadlineAt };
  }

  let hostId = pruned.hostId;
  if (!pruned.started) {
    let targetIdx = seats.findIndex((s) => s.occupant === 'open');
    if (targetIdx < 0) {
      // Reclaim a stale disconnected lobby seat (e.g. player switched from WhatsApp WebView to Chrome).
      const isStale = (s: SeatInfo) =>
        s.occupant === 'human' && !s.connected && typeof s.disconnectedAt === 'number' && now - s.disconnectedAt >= LOBBY_RECLAIM_STALE_MS;
      const staleGuestIdx = seats.findIndex((s) => isStale(s) && s.playerId !== hostId);
      targetIdx = staleGuestIdx >= 0 ? staleGuestIdx : seats.findIndex((s) => isStale(s));
      if (targetIdx >= 0 && seats[targetIdx].playerId === hostId) {
        const remainingIdx = seats.findIndex((s, i) => i !== targetIdx && s.occupant === 'human' && s.playerId);
        hostId = remainingIdx >= 0 ? seats[remainingIdx].playerId! : '';
      }
    }
    if (targetIdx >= 0) {
      const target = seats[targetIdx];
      const takenCount = seats.filter((s, i) => i !== targetIdx && s.occupant === 'human').length;
      if (!hostId) hostId = playerId;
      const isHost = hostId === playerId;
      target.occupant = 'human';
      target.playerId = playerId;
      target.playerName = cleanName;
      target.connected = true;
      delete target.disconnectedAt;
      delete target.botTakeover;
      delete target.missedTurns;
      target.label = formatHumanLabel(target.team, takenCount, isHost, cleanName);
      if (deviceId) seatDeviceIds[target.team] = deviceId;
    }
    return { ...pruned, hostId, seats, seatDeviceIds };
  }

  // Reclaim a disconnected human seat when returning via the room link (same device, matching name, or sole disconnected player).
  const reclaimSeat = (reclaimIdx: number): RoomRecord => {
    const seat = seats[reclaimIdx];
    const oldPlayerId = seat.playerId;
    if (!hostId || hostId === oldPlayerId) hostId = playerId;
    const isHost = hostId === playerId;
    seat.playerId = playerId;
    if (cleanName !== undefined) seat.playerName = cleanName;
    seat.connected = true;
    delete seat.disconnectedAt;
    delete seat.botTakeover;
    delete seat.missedTurns;
    seat.label = formatHumanLabel(seat.team, reclaimIdx, isHost, seat.playerName);
    if (deviceId) seatDeviceIds[seat.team] = deviceId;
    const turnDeadlineAt =
      pruned.game.phase !== 'GAME_OVER' && pruned.game.currentTeam === seat.team
        ? now + TURN_TIMEOUT_MS
        : pruned.turnDeadlineAt;
    return { ...pruned, hostId, seats, seatDeviceIds, turnDeadlineAt };
  };

  // Authenticated seats (`acct:...`) are bound to their verified account ID and cannot be reclaimed by name/device/fallback.
  const isAuthenticatedJoiner = playerId.startsWith('acct:');

  if (deviceId && !isAuthenticatedJoiner) {
    const deviceIdx = seats.findIndex(
      (s) => s.occupant === 'human' && !s.connected && !s.playerId?.startsWith('acct:') && seatDeviceIds[s.team] === deviceId,
    );
    if (deviceIdx >= 0) return reclaimSeat(deviceIdx);
  }

  if (cleanName && !isAuthenticatedJoiner) {
    const normalizedName = cleanName.toLowerCase();
    const nameIdx = seats.findIndex(
      (s) =>
        s.occupant === 'human' &&
        !s.connected &&
        !s.playerId?.startsWith('acct:') &&
        s.playerName?.trim().toLowerCase() === normalizedName,
    );
    if (nameIdx >= 0) return reclaimSeat(nameIdx);
  }

  if (!isAuthenticatedJoiner) {
    const disconnectedHumanIndices = seats
      .map((s, idx) => (s.occupant === 'human' && !s.connected && !s.playerId?.startsWith('acct:') ? idx : -1))
      .filter((idx) => idx >= 0);
    if (disconnectedHumanIndices.length === 1) {
      return reclaimSeat(disconnectedHumanIndices[0]);
    }
  }

  // If the host launched early and left AI bot seat(s), let an invited friend take over a bot seat live.
  const botIdx = seats.findIndex((s) => s.occupant === 'bot');
  if (botIdx >= 0) {
    const botSeat = seats[botIdx];
    const takenCount = seats.filter((s) => s.occupant === 'human').length;
    if (!hostId) hostId = playerId;
    const isHost = hostId === playerId;
    botSeat.occupant = 'human';
    botSeat.playerId = playerId;
    botSeat.playerName = cleanName;
    botSeat.connected = true;
    delete botSeat.disconnectedAt;
    delete botSeat.botTakeover;
    delete botSeat.missedTurns;
    botSeat.label = formatHumanLabel(botSeat.team, takenCount, isHost, cleanName);
    if (deviceId) seatDeviceIds[botSeat.team] = deviceId;
  }

  return { ...pruned, hostId, seats, seatDeviceIds };
}

export function disconnectPlayer(record: RoomRecord, playerId: string, now = Date.now()): RoomRecord {
  const seats = record.seats.map((s) => ({ ...s }));
  const target = seats.find((s) => s.playerId === playerId);
  if (!target) return record;

  // Keep lobby seats reserved across brief network drops / mobile app switches (e.g. sharing link in WhatsApp).
  target.connected = false;
  target.disconnectedAt = now;
  target.missedTurns = 0;
  target.botTakeover = false;

  let hostId = record.hostId;
  if (record.started && hostId === playerId) {
    const nextIdx = seats.findIndex((s) => s.occupant === 'human' && s.connected && s.playerId);
    if (nextIdx >= 0 && seats[nextIdx].playerId) {
      hostId = seats[nextIdx].playerId!;
      seats[nextIdx].label = formatHumanLabel(seats[nextIdx].team, nextIdx, true, seats[nextIdx].playerName);
    }
  }

  const turnDeadlineAt =
    record.started && record.game.phase !== 'GAME_OVER' && record.game.currentTeam === target.team
      ? computeDisconnectTurnDeadline(record.turnDeadlineAt, now)
      : record.turnDeadlineAt;

  return { ...record, hostId, seats, turnDeadlineAt };
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
  if (isSeatBotControlled(seat)) return record.hostId === playerId;
  if (seat.occupant === 'human') return seat.playerId === playerId;
  return false;
}

export interface RoomActionResult {
  record: RoomRecord;
  broadcast: ServerMessage[];
  reply?: ServerMessage;
  broadcastSnapshots?: boolean;
  persist: boolean;
  closeRoom?: boolean;
}

function executeAuthoritativeRoll(record: RoomRecord, random: () => number, now: number): RoomActionResult {
  const team = record.game.currentTeam;
  const value = rollSmartDie(record.game, random);
  const rolled = applyRoll(record.game, value);
  const legalMoves = rolled.outcome === 'MOVE' ? rolled.legalMoves : [];
  const seq = (record.seq ?? 0) + 1;
  const turnDeadlineAt = computeTurnDeadlineAt({ started: record.started, seats: record.seats, game: rolled.state }, now);
  const turnRemainingMs = turnDeadlineAt !== undefined ? Math.max(0, turnDeadlineAt - now) : undefined;
  const next: RoomRecord = {
    ...record,
    game: rolled.state,
    legalMoves,
    seq,
    turnDeadlineAt,
  };
  return {
    record: next,
    broadcast: [{ type: 'roll', value, team, seq, game: rolled.state, legalMoves, turnRemainingMs }],
    persist: true,
  };
}

function executeAuthoritativeMove(record: RoomRecord, pawnId: string, now: number): RoomActionResult {
  const team = record.game.currentTeam;
  const moved = applyMove(record.game, pawnId);
  const seq = (record.seq ?? 0) + 1;
  const turnDeadlineAt = computeTurnDeadlineAt({ started: record.started, seats: record.seats, game: moved.state }, now);
  const turnRemainingMs = turnDeadlineAt !== undefined ? Math.max(0, turnDeadlineAt - now) : undefined;
  const closeAt = moved.state.phase === 'GAME_OVER' ? now + GAME_OVER_ROOM_CLOSE_MS : undefined;
  const next: RoomRecord = {
    ...record,
    game: moved.state,
    legalMoves: [],
    seq,
    turnDeadlineAt,
    closeAt,
  };
  return {
    record: next,
    broadcast: [{ type: 'move', pawnId, team, seq, game: moved.state, legalMoves: [], turnRemainingMs }],
    broadcastSnapshots: moved.state.phase === 'GAME_OVER',
    persist: true,
  };
}

/**
 * Handles turn expiration:
 * - For disconnected humans on their 1st chance, waits 10–15s, skips that 1st chance,
 *   and enables AI bot takeover from their 2nd chance onward until they reconnect.
 * - For connected humans (20s) or bot-controlled seats, auto-rolls or picks a smart move.
 */
export function handleTurnTimeout(
  record: RoomRecord,
  now = Date.now(),
  random: () => number = cryptoRandom,
): RoomActionResult | null {
  if (!record.started || record.game.phase === 'GAME_OVER') return null;
  if (typeof record.turnDeadlineAt !== 'number' || now < record.turnDeadlineAt) return null;

  const currentIdx = record.seats.findIndex((s) => s.team === record.game.currentTeam);
  const currentSeat = currentIdx >= 0 ? record.seats[currentIdx] : undefined;
  if (currentSeat && currentSeat.occupant === 'human' && !currentSeat.connected && !currentSeat.botTakeover) {
    const seats = record.seats.map((s) => ({ ...s }));
    seats[currentIdx] = {
      ...seats[currentIdx],
      missedTurns: (seats[currentIdx].missedTurns ?? 0) + 1,
      botTakeover: true,
    };
    const nextGame = skipTurn(record.game);
    const seq = (record.seq ?? 0) + 1;
    const turnDeadlineAt = computeTurnDeadlineAt({ started: record.started, seats, game: nextGame }, now);
    const next: RoomRecord = {
      ...record,
      seats,
      game: nextGame,
      legalMoves: [],
      seq,
      turnDeadlineAt,
    };
    return {
      record: next,
      broadcast: [],
      broadcastSnapshots: true,
      persist: true,
    };
  }

  if (record.game.phase === 'ROLL') {
    return executeAuthoritativeRoll(record, random, now);
  }
  if (record.game.phase === 'MOVE') {
    const legalMoves =
      record.legalMoves.length > 0
        ? record.legalMoves
        : record.game.dice !== null
          ? getLegalMoves(record.game, record.game.dice)
          : [];
    if (legalMoves.length > 0) {
      const pawnId = pickSmartBotMove(record.game, legalMoves);
      return executeAuthoritativeMove({ ...record, legalMoves }, pawnId, now);
    }
    const nextGame = skipTurn(record.game);
    const seq = (record.seq ?? 0) + 1;
    const turnDeadlineAt = computeTurnDeadlineAt({ started: record.started, seats: record.seats, game: nextGame }, now);
    return {
      record: { ...record, game: nextGame, legalMoves: [], seq, turnDeadlineAt },
      broadcast: [],
      broadcastSnapshots: true,
      persist: true,
    };
  }
  return null;
}

export function handleRoomAction(
  record: RoomRecord,
  playerId: string,
  msg: ClientMessage,
  random: () => number = cryptoRandom,
  now = Date.now(),
): RoomActionResult {
  switch (msg.type) {
    case 'ping': {
      return { record, broadcast: [], reply: { type: 'pong' }, persist: false };
    }

    case 'join': {
      const existingSeat = record.seats.find((s) => s.playerId === playerId && s.occupant === 'human');
      const cleanName = sanitizePlayerName(msg.name);
      const isAlreadyConnectedResync =
        record.started &&
        Boolean(existingSeat?.connected) &&
        !existingSeat?.botTakeover &&
        (cleanName === undefined || cleanName === existingSeat?.playerName);
      const next = joinRoom(record, playerId, msg.name, now, msg.deviceId);
      if (isAlreadyConnectedResync) {
        return {
          record: next,
          broadcast: [],
          reply: { type: 'snapshot', snapshot: snapshotForPlayer(next, playerId, now) },
          broadcastSnapshots: false,
          persist: false,
        };
      }
      return { record: next, broadcast: [], broadcastSnapshots: true, persist: true };
    }

    case 'leave': {
      const next = leaveRoom(record, playerId, now);
      const closeRoom = shouldCloseRoomOnLeave(next);
      return {
        record: next,
        broadcast: [],
        broadcastSnapshots: !closeRoom,
        persist: !closeRoom,
        closeRoom,
      };
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
      const seatDeviceIds: Partial<Record<TeamId, string>> = { ...(record.seatDeviceIds ?? {}) };
      if (seatDeviceIds[moving.team]) {
        seatDeviceIds[seats[targetIdx].team] = seatDeviceIds[moving.team];
        delete seatDeviceIds[moving.team];
      }
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
      return { record: { ...record, seats, seatDeviceIds }, broadcast: [], broadcastSnapshots: true, persist: true };
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

    case 'set_stake': {
      if (playerId !== record.hostId || record.started || !isValidFriendsStakeTier(msg.stake)) {
        return { record, broadcast: [], persist: false };
      }
      const next: RoomRecord = {
        ...record,
        stake: msg.stake,
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
      const seq = (record.seq ?? 0) + 1;
      const nextGame = createGame(msg.mode);
      const turnDeadlineAt = computeTurnDeadlineAt({ started: true, seats: filledSeats, game: nextGame }, now);
      const nextStake =
        typeof msg.stake === 'number' && isValidFriendsStakeTier(msg.stake)
          ? msg.stake
          : Math.max(MIN_FRIENDS_STAKE, record.stake ?? MIN_FRIENDS_STAKE);
      const next: RoomRecord = {
        ...record,
        mode: msg.mode,
        stake: nextStake,
        started: true,
        seats: filledSeats,
        game: nextGame,
        legalMoves: [],
        seq,
        turnDeadlineAt,
        closeAt: undefined,
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
      return executeAuthoritativeRoll(record, random, now);
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
      return executeAuthoritativeMove(record, msg.pawnId, now);
    }

    case 'reset': {
      if (playerId !== record.hostId) {
        return { record, broadcast: [], persist: false };
      }
      const seq = (record.seq ?? 0) + 1;
      const nextGame = createGame(record.mode);
      const resetSeats = record.seats.map((s) => {
        if (s.occupant !== 'human' || s.connected) return s;
        return { ...s, missedTurns: 0, botTakeover: false };
      });
      const turnDeadlineAt = computeTurnDeadlineAt({ started: record.started, seats: resetSeats, game: nextGame }, now);
      const turnRemainingMs = turnDeadlineAt !== undefined ? Math.max(0, turnDeadlineAt - now) : undefined;
      const next: RoomRecord = {
        ...record,
        seats: resetSeats,
        game: nextGame,
        legalMoves: [],
        seq,
        turnDeadlineAt,
        closeAt: undefined,
      };
      return {
        record: next,
        broadcast: [{ type: 'reset', mode: record.mode, seq, game: nextGame, turnRemainingMs }],
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
              ts: now,
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

    case 'voice_signal':
    case 'voice_block':
    case 'voice_state':
      return { record, broadcast: [], persist: false };
  }
}
