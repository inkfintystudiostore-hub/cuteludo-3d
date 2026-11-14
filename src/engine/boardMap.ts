/**
 * Static geometry of the 15x15 Ludo board.
 *
 * Grid cells are addressed as (row, col) with row 0 at the far edge and col 0 on the left.
 * World coordinates follow Three.js conventions on the ground plane: x = col - 7, z = row - 7.
 *
 * A pawn's place on the board is a single `progress` number relative to its own team:
 *   -1        waiting in the yard
 *   0..50     on the shared main track (0 = the team's start tile)
 *   51..55    in the team's private home column
 *   56        inside the central Home goal
 */

export type TeamId = 'PINK' | 'CYAN' | 'YELLOW' | 'MINT';

/** Clockwise seating order, which is also the turn order. Diagonal pairs: PINK/YELLOW and CYAN/MINT. */
export const TEAM_IDS: readonly TeamId[] = ['PINK', 'CYAN', 'YELLOW', 'MINT'];

export const TEAM_COLORS: Record<TeamId, string> = {
  PINK: '#ff8fab',
  CYAN: '#72efdd',
  YELLOW: '#ffd166',
  MINT: '#80ed99',
};

export const TEAM_LABELS: Record<TeamId, string> = {
  PINK: 'Pink',
  CYAN: 'Cyan',
  YELLOW: 'Yellow',
  MINT: 'Mint',
};

export interface Pawn {
  /** Stable id, e.g. "PINK-2". */
  id: string;
  team: TeamId;
  /** Yard slot index 0..3 this pawn returns to when captured. */
  slot: number;
  progress: number;
}

export interface GridCell {
  row: number;
  col: number;
}

export interface WorldPoint {
  x: number;
  z: number;
}

export type SharedState = 'solo' | 'coffee' | 'squabble';

export interface PawnWorldPosition extends WorldPoint {
  scale: number;
  rotationY: number;
  sharedState: SharedState;
}

export const BOARD_SIZE = 15;
export const TRACK_LENGTH = 52;
export const YARD_PROGRESS = -1;
/** Last main-track progress value before a pawn turns into its home column. */
export const LAST_TRACK_PROGRESS = 50;
export const HOME_COLUMN_LENGTH = 5;
export const HOME_PROGRESS = 56;
export const PAWNS_PER_TEAM = 4;
/** Height of the walkable tile surface above the world origin. */
export const TILE_SURFACE_Y = 0.1;

export function cellToWorld(cell: GridCell): WorldPoint {
  return { x: cell.col - 7, z: cell.row - 7 };
}

function line(row: number, col: number, dRow: number, dCol: number, count: number): GridCell[] {
  return Array.from({ length: count }, (_, i) => ({ row: row + dRow * i, col: col + dCol * i }));
}

/** The 52 main-track cells, clockwise, starting at PINK's start tile. */
export const TRACK_CELLS: readonly GridCell[] = [
  ...line(6, 1, 0, 1, 5), //   0..4   left arm, upper lane, heading right
  ...line(5, 6, -1, 0, 6), //  5..10  top arm, left lane, heading up
  ...line(0, 7, 0, 0, 1), //   11     top arm turn (CYAN home-column entrance)
  ...line(0, 8, 1, 0, 6), //   12..17 top arm, right lane, heading down
  ...line(6, 9, 0, 1, 6), //   18..23 right arm, upper lane, heading right
  ...line(7, 14, 0, 0, 1), //  24     right arm turn (YELLOW home-column entrance)
  ...line(8, 14, 0, -1, 6), // 25..30 right arm, lower lane, heading left
  ...line(9, 8, 1, 0, 6), //   31..36 bottom arm, right lane, heading down
  ...line(14, 7, 0, 0, 1), //  37     bottom arm turn (MINT home-column entrance)
  ...line(14, 6, -1, 0, 6), // 38..43 bottom arm, left lane, heading up
  ...line(8, 5, 0, -1, 6), //  44..49 left arm, lower lane, heading left
  ...line(7, 0, 0, 0, 1), //   50     left arm turn (PINK home-column entrance)
  ...line(6, 0, 0, 0, 1), //   51
];

/** Main-track index of each team's start tile. */
export const START_INDEX: Record<TeamId, number> = { PINK: 0, CYAN: 13, YELLOW: 26, MINT: 39 };

/** The 8 star tiles: the 4 start tiles plus the star 8 steps after each. No captures happen here. */
export const SAFE_TRACK_INDICES: readonly number[] = [0, 8, 13, 21, 26, 34, 39, 47];
const SAFE_SET = new Set(SAFE_TRACK_INDICES);

export function isSafeTrackIndex(trackIndex: number): boolean {
  return SAFE_SET.has(trackIndex);
}

/** The 5 home-column cells per team, ordered from the track towards the centre. */
export const HOME_COLUMN_CELLS: Record<TeamId, readonly GridCell[]> = {
  PINK: line(7, 1, 0, 1, HOME_COLUMN_LENGTH),
  CYAN: line(1, 7, 1, 0, HOME_COLUMN_LENGTH),
  YELLOW: line(7, 13, 0, -1, HOME_COLUMN_LENGTH),
  MINT: line(13, 7, -1, 0, HOME_COLUMN_LENGTH),
};

/** Where finished pawns stand: each team's wedge of the central pavilion. */
export const HOME_GOAL_POSITIONS: Record<TeamId, WorldPoint> = {
  PINK: { x: -0.85, z: 0 },
  CYAN: { x: 0, z: -0.85 },
  YELLOW: { x: 0.85, z: 0 },
  MINT: { x: 0, z: 0.85 },
};

/** Top-left grid cell of each team's 6x6 corner yard. */
export const YARD_ORIGINS: Record<TeamId, GridCell> = {
  PINK: { row: 0, col: 0 },
  CYAN: { row: 0, col: 9 },
  YELLOW: { row: 9, col: 9 },
  MINT: { row: 9, col: 0 },
};

const YARD_SLOT_OFFSETS: readonly GridCell[] = [
  { row: 1.5, col: 1.5 },
  { row: 1.5, col: 3.5 },
  { row: 3.5, col: 1.5 },
  { row: 3.5, col: 3.5 },
];

/** The 4 spawn slots per team, in world coordinates. */
export const YARD_SLOT_POSITIONS: Record<TeamId, readonly WorldPoint[]> = {
  PINK: yardSlots('PINK'),
  CYAN: yardSlots('CYAN'),
  YELLOW: yardSlots('YELLOW'),
  MINT: yardSlots('MINT'),
};

function yardSlots(team: TeamId): WorldPoint[] {
  const origin = YARD_ORIGINS[team];
  return YARD_SLOT_OFFSETS.map((o) => cellToWorld({ row: origin.row + o.row, col: origin.col + o.col }));
}

/** Main-track index (0..51) for a pawn that is on the shared track, otherwise null. */
export function getTrackIndex(team: TeamId, progress: number): number | null {
  if (progress < 0 || progress > LAST_TRACK_PROGRESS) return null;
  return (START_INDEX[team] + progress) % TRACK_LENGTH;
}

/** World centre of the tile a team's pawn stands on at `progress` (0..56). */
export function getProgressPosition(team: TeamId, progress: number): WorldPoint {
  const trackIndex = getTrackIndex(team, progress);
  if (trackIndex !== null) return cellToWorld(TRACK_CELLS[trackIndex]);
  if (progress > LAST_TRACK_PROGRESS && progress < HOME_PROGRESS) {
    return cellToWorld(HOME_COLUMN_CELLS[team][progress - LAST_TRACK_PROGRESS - 1]);
  }
  if (progress === HOME_PROGRESS) return HOME_GOAL_POSITIONS[team];
  throw new RangeError(`No board tile for progress ${progress}`);
}

/**
 * Identifies the physical tile a pawn occupies, so pawns from different teams on the same
 * main-track tile compare equal. Yard pawns each own their slot and return null.
 */
export function getTileKey(pawn: Pawn): string | null {
  if (pawn.progress === YARD_PROGRESS) return null;
  const trackIndex = getTrackIndex(pawn.team, pawn.progress);
  if (trackIndex !== null) return `T${trackIndex}`;
  if (pawn.progress === HOME_PROGRESS) return `G-${pawn.team}`;
  return `H-${pawn.team}-${pawn.progress}`;
}

/** Other pawns standing on the same tile as `pawn`. */
export function getTileMates(pawn: Pawn, allPawns: readonly Pawn[]): Pawn[] {
  const key = getTileKey(pawn);
  if (key === null) return [];
  return allPawns.filter((p) => p.id !== pawn.id && getTileKey(p) === key);
}

const QUADRANT = 0.24;
const QUADRANT_OFFSETS: Record<number, readonly WorldPoint[]> = {
  2: [
    { x: -QUADRANT, z: -QUADRANT },
    { x: QUADRANT, z: QUADRANT },
  ],
  3: [
    { x: -QUADRANT, z: -QUADRANT },
    { x: QUADRANT, z: -QUADRANT },
    { x: 0, z: QUADRANT },
  ],
  4: [
    { x: -QUADRANT, z: -QUADRANT },
    { x: QUADRANT, z: -QUADRANT },
    { x: -QUADRANT, z: QUADRANT },
    { x: QUADRANT, z: QUADRANT },
  ],
};

function sharedScale(count: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 0.68;
  if (count === 3) return 0.6;
  return 0.55;
}

function sharedOffset(index: number, count: number): WorldPoint {
  const quadrants = QUADRANT_OFFSETS[count];
  if (quadrants) return quadrants[index];
  // More than four pawns on one tile: spread them evenly around a ring.
  const angle = (index / count) * Math.PI * 2;
  return { x: Math.cos(angle) * 0.33, z: Math.sin(angle) * 0.33 };
}

/** Yaw that makes a figure whose face points along +Z look along (dx, dz). */
function facing(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Shrinks both pieces by 15% (>= 10%) when one stands directly behind another along Z. */
const DEPTH_NEIGHBOR_SCALE = 0.85;

function hasDepthNeighbor(pawn: Pawn, centre: WorldPoint, allPawns: readonly Pawn[]): boolean {
  if (pawn.progress < 0 || pawn.progress >= HOME_PROGRESS) return false;
  for (const other of allPawns) {
    if (other.id === pawn.id || other.progress < 0 || other.progress >= HOME_PROGRESS) continue;
    const otherCentre = getProgressPosition(other.team, other.progress);
    const dx = Math.abs(otherCentre.x - centre.x);
    const dz = Math.abs(otherCentre.z - centre.z);
    if (dx <= 0.45 && dz > 0.1 && dz <= 1.15) return true;
  }
  return false;
}

/**
 * Resolves where a pawn should stand in the 3D scene.
 *
 * Pawns sharing a tile shrink and move into sub-tile quadrants facing each other. Pawns with
 * another active piece directly in front or behind them along Z shrink by 15% so both stay
 * clearly visible. `sharedState` is 'coffee' when everyone on the tile is friendly and
 * 'squabble' when rivals share it (only possible on star tiles).
 */
export function getPawnWorldPosition(
  pawn: Pawn,
  allPawns: readonly Pawn[],
  areAllies: (a: TeamId, b: TeamId) => boolean = (a, b) => a === b,
): PawnWorldPosition {
  if (pawn.progress === YARD_PROGRESS) {
    const slot = YARD_SLOT_POSITIONS[pawn.team][pawn.slot];
    return { ...slot, scale: 1, rotationY: 0, sharedState: 'solo' }; // waiting pawns face the camera
  }

  const centre = getProgressPosition(pawn.team, pawn.progress);
  const mates = getTileMates(pawn, allPawns);
  const depthFactor = hasDepthNeighbor(pawn, centre, allPawns) ? DEPTH_NEIGHBOR_SCALE : 1;

  if (mates.length === 0) {
    let rotationY = 0; // Finished pawns face the camera.
    if (pawn.progress < HOME_PROGRESS) {
      const next = getProgressPosition(pawn.team, pawn.progress + 1);
      rotationY = facing(next.x - centre.x, next.z - centre.z);
    }
    return { ...centre, scale: depthFactor, rotationY, sharedState: 'solo' };
  }

  const occupants = [pawn, ...mates].sort((a, b) => a.id.localeCompare(b.id));
  const offset = sharedOffset(occupants.indexOf(pawn), occupants.length);
  const friendly = mates.every((m) => areAllies(pawn.team, m.team));
  return {
    x: centre.x + offset.x,
    z: centre.z + offset.z,
    scale: sharedScale(occupants.length) * depthFactor,
    rotationY: facing(-offset.x, -offset.z),
    sharedState: friendly ? 'coffee' : 'squabble',
  };
}
