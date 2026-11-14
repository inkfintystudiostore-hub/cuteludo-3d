/**
 * Pure Ludo rules. Every function takes a GameState and returns a new one; nothing here touches
 * React, timers, or the 3D scene.
 */
import {
  HOME_PROGRESS,
  LAST_TRACK_PROGRESS,
  PAWNS_PER_TEAM,
  TEAM_IDS,
  YARD_PROGRESS,
  getHomePicnicPosition,
  getProgressPosition,
  getTileMates,
  getTrackIndex,
  isSafeTrackIndex,
  type Pawn,
  type TeamId,
  type WorldPoint,
} from './boardMap';

export type GameMode = '2P_COUPLES' | '3P_FFA' | '4P_FFA' | '2V2_TEAM';
export type Phase = 'ROLL' | 'MOVE' | 'GAME_OVER';

export interface GameState {
  mode: GameMode;
  /** Teams in play, in turn order. */
  activeTeams: TeamId[];
  pawns: Pawn[];
  currentTeam: TeamId;
  phase: Phase;
  /** Last rolled value; only actionable while phase is 'MOVE'. */
  dice: number | null;
  /** Consecutive sixes rolled by the current team this turn. */
  sixStreak: number;
  /** Empty until the game ends. Two teams in 2V2_TEAM, otherwise the 1st-place team. */
  winners: TeamId[];
  /** Ordered placements (1st, 2nd, 3rd, 4th) as teams finish; complete once GAME_OVER. */
  rankings: TeamId[];
}

export const MODE_TEAMS: Record<GameMode, TeamId[]> = {
  '2P_COUPLES': ['PINK', 'YELLOW'], // diagonal corners
  '3P_FFA': ['PINK', 'CYAN', 'YELLOW'],
  '4P_FFA': [...TEAM_IDS],
  '2V2_TEAM': [...TEAM_IDS],
};

/** Diagonal partner in 2v2. */
const PARTNER: Record<TeamId, TeamId> = { PINK: 'YELLOW', YELLOW: 'PINK', CYAN: 'MINT', MINT: 'CYAN' };

export function areAllies(mode: GameMode, a: TeamId, b: TeamId): boolean {
  return a === b || (mode === '2V2_TEAM' && PARTNER[a] === b);
}

export function createGame(mode: GameMode): GameState {
  const activeTeams = [...MODE_TEAMS[mode]];
  const pawns = activeTeams.flatMap((team) =>
    Array.from({ length: PAWNS_PER_TEAM }, (_, slot): Pawn => ({ id: `${team}-${slot}`, team, slot, progress: YARD_PROGRESS })),
  );
  return {
    mode,
    activeTeams,
    pawns,
    currentTeam: activeTeams[0],
    phase: 'ROLL',
    dice: null,
    sixStreak: 0,
    winners: [],
    rankings: [],
  };
}

export function rollDie(random: () => number = Math.random): number {
  return Math.floor(random() * 6) + 1;
}

/** Progress a pawn would land on with this roll, or null if it cannot move. */
export function getMoveTarget(pawn: Pawn, dice: number): number | null {
  if (pawn.progress === YARD_PROGRESS) return dice === 6 ? 0 : null;
  if (pawn.progress === HOME_PROGRESS) return null;
  const target = pawn.progress + dice;
  return target <= HOME_PROGRESS ? target : null; // exact roll needed to enter Home
}

/** Ids of the current team's pawns that may move with `dice`. */
export function getLegalMoves(state: GameState, dice: number): string[] {
  return state.pawns
    .filter((p) => p.team === state.currentTeam && getMoveTarget(p, dice) !== null)
    .map((p) => p.id);
}

function isTeamFinished(pawns: readonly Pawn[], team: TeamId): boolean {
  return pawns.filter((p) => p.team === team).every((p) => p.progress === HOME_PROGRESS);
}

/** Next team in turn order that still has pawns to bring home. */
function nextTeam(state: GameState, pawns: readonly Pawn[]): TeamId {
  const order = state.activeTeams;
  const from = order.indexOf(state.currentTeam);
  for (let i = 1; i <= order.length; i++) {
    const team = order[(from + i) % order.length];
    if (!isTeamFinished(pawns, team)) return team;
  }
  return state.currentTeam;
}

function passTurn(state: GameState): GameState {
  return { ...state, currentTeam: nextTeam(state, state.pawns), phase: 'ROLL', sixStreak: 0 };
}

export type RollOutcome = 'MOVE' | 'NO_MOVES' | 'THREE_SIXES';

export interface RollResult {
  state: GameState;
  outcome: RollOutcome;
  legalMoves: string[];
}

/** Applies a dice value for the current team. */
export function applyRoll(state: GameState, value: number): RollResult {
  if (state.phase !== 'ROLL') throw new Error(`Cannot roll during phase ${state.phase}`);
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new RangeError(`Invalid dice value ${value}`);

  const sixStreak = value === 6 ? state.sixStreak + 1 : 0;
  const rolled: GameState = { ...state, dice: value, sixStreak };

  if (sixStreak === 3) return { state: passTurn(rolled), outcome: 'THREE_SIXES', legalMoves: [] };

  const legalMoves = getLegalMoves(rolled, value);
  if (legalMoves.length === 0) {
    // A six still earns its bonus roll even when nothing can move.
    const next = value === 6 ? { ...rolled, phase: 'ROLL' as const } : passTurn(rolled);
    return { state: next, outcome: 'NO_MOVES', legalMoves };
  }
  return { state: { ...rolled, phase: 'MOVE' }, outcome: 'MOVE', legalMoves };
}

export interface MoveResult {
  state: GameState;
  pawnId: string;
  kind: 'SPAWN' | 'MOVE';
  from: number;
  to: number;
  /** Every progress value stepped onto, ending with `to`. */
  path: number[];
  /** Ids of opposing pawns sent back to their yard. */
  captured: string[];
  reachedHome: boolean;
  bonusRoll: boolean;
  /** 1-based placement if this move finished all 4 pawns of the mover's team, else null. */
  finishedRank: number | null;
  /** Ids of pawns the mover now shares its tile with (excluding the Home goal). */
  sharedWith: string[];
}

export interface MovePreview {
  pawnId: string;
  kind: 'SPAWN' | 'MOVE';
  from: number;
  to: number;
  path: number[];
  waypoints: WorldPoint[];
  destination: WorldPoint;
  willCapture: string[];
  isSafeLanding: boolean;
  reachesHome: boolean;
}

function findCapturesAt(state: GameState, pawn: Pawn, targetProgress: number): string[] {
  const trackIndex = getTrackIndex(pawn.team, targetProgress);
  if (trackIndex === null || isSafeTrackIndex(trackIndex)) return [];
  const probe: Pawn = { ...pawn, progress: targetProgress };
  return getTileMates(probe, state.pawns)
    .filter((p) => !areAllies(state.mode, pawn.team, p.team))
    .map((p) => p.id);
}

/** Computes destination, path waypoints, and tactical outcome for a legal move without mutating state. */
export function getMovePreview(state: GameState, pawnId: string): MovePreview | null {
  if (state.phase !== 'MOVE' || state.dice === null) return null;
  const pawn = state.pawns.find((p) => p.id === pawnId);
  if (!pawn || pawn.team !== state.currentTeam) return null;
  const to = getMoveTarget(pawn, state.dice);
  if (to === null) return null;

  const from = pawn.progress;
  const kind = from === YARD_PROGRESS ? 'SPAWN' : 'MOVE';
  const path = kind === 'SPAWN' ? [0] : Array.from({ length: state.dice }, (_, i) => from + i + 1);
  const waypoints = path.map((p) => (p === HOME_PROGRESS ? getHomePicnicPosition(pawn.team, pawn.slot) : getProgressPosition(pawn.team, p)));
  const trackIndex = getTrackIndex(pawn.team, to);
  const willCapture = findCapturesAt(state, pawn, to);
  const isSafeLanding = to > LAST_TRACK_PROGRESS || (trackIndex !== null && isSafeTrackIndex(trackIndex));

  return {
    pawnId,
    kind,
    from,
    to,
    path,
    waypoints,
    destination: waypoints[waypoints.length - 1],
    willCapture,
    isSafeLanding,
    reachesHome: to === HOME_PROGRESS,
  };
}

/** Picks the highest-value tactical move for an AI player among `legalMoves`. */
export function pickSmartBotMove(state: GameState, legalMoves: readonly string[]): string {
  let bestId = legalMoves[0];
  let bestScore = -Infinity;

  for (const id of legalMoves) {
    const preview = getMovePreview(state, id);
    if (!preview) continue;
    let score = preview.to * 0.5;
    if (preview.willCapture.length > 0) score += 1000 + preview.willCapture.length * 100;
    if (preview.reachesHome) score += 800;
    if (preview.kind === 'SPAWN') score += 450;
    if (preview.to > LAST_TRACK_PROGRESS && preview.from <= LAST_TRACK_PROGRESS) score += 350;
    if (preview.isSafeLanding) score += 180;
    const startIndex = getTrackIndex(state.currentTeam, preview.from);
    if (startIndex !== null && isSafeTrackIndex(startIndex) && !preview.isSafeLanding) score -= 90;
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

/** Moves one of the current team's pawns by the rolled dice value. */
export function applyMove(state: GameState, pawnId: string): MoveResult {
  if (state.phase !== 'MOVE' || state.dice === null) throw new Error(`Cannot move during phase ${state.phase}`);
  const pawn = state.pawns.find((p) => p.id === pawnId);
  if (!pawn || pawn.team !== state.currentTeam) throw new Error(`Pawn ${pawnId} does not belong to ${state.currentTeam}`);
  const dice = state.dice;
  const to = getMoveTarget(pawn, dice);
  if (to === null) throw new Error(`Pawn ${pawnId} cannot move ${dice}`);

  const from = pawn.progress;
  const kind = from === YARD_PROGRESS ? 'SPAWN' : 'MOVE';
  const path = kind === 'SPAWN' ? [0] : Array.from({ length: dice }, (_, i) => from + i + 1);
  const moved: Pawn = { ...pawn, progress: to };
  const captured = findCapturesAt(state, pawn, to);

  const pawns = state.pawns.map((p) => {
    if (p.id === pawnId) return moved;
    if (captured.includes(p.id)) return { ...p, progress: YARD_PROGRESS };
    return p;
  });

  const reachedHome = to === HOME_PROGRESS;
  const sharedWith = reachedHome ? [] : getTileMates(moved, pawns).map((p) => p.id);
  const team = pawn.team;
  const teamDone = isTeamFinished(pawns, team);

  const rankings = [...state.rankings];
  let finishedRank: number | null = null;
  if (teamDone && !rankings.includes(team)) {
    rankings.push(team);
    finishedRank = rankings.length;
  }

  let winners: TeamId[] = [];
  if (state.mode === '2V2_TEAM') {
    if (teamDone && isTeamFinished(pawns, PARTNER[team])) {
      winners = [team, PARTNER[team]];
      for (const t of state.activeTeams) {
        if (!rankings.includes(t)) rankings.push(t);
      }
    }
  } else {
    const unfinished = state.activeTeams.filter((t) => !isTeamFinished(pawns, t));
    if (unfinished.length <= 1) {
      for (const t of unfinished) {
        if (!rankings.includes(t)) rankings.push(t);
      }
      if (rankings.length > 0) winners = [rankings[0]];
    }
  }

  const bonusRoll = winners.length === 0 && !teamDone && (dice === 6 || captured.length > 0);
  const base: GameState = { ...state, pawns, rankings };
  let next: GameState;
  if (winners.length > 0) next = { ...base, phase: 'GAME_OVER', winners };
  else if (bonusRoll) next = { ...base, phase: 'ROLL', sixStreak: dice === 6 ? state.sixStreak : 0 };
  else next = passTurn(base);

  return { state: next, pawnId, kind, from, to, path, captured, reachedHome, bonusRoll, finishedRank, sharedWith };
}
