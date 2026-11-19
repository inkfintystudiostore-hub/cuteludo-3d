import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_COLUMN_CELLS,
  SAFE_TRACK_INDICES,
  TEAM_IDS,
  TRACK_CELLS,
  YARD_SLOT_POSITIONS,
  getBoardYawForTeam,
  getCornerSlotForTeam,
  getPawnWorldPosition,
  getProgressPosition,
  getTrackIndex,
  type Pawn,
} from './boardMap';
import {
  applyMove,
  applyRoll,
  areAllies,
  createGame,
  getMovePreview,
  getSmartDiceWeights,
  pickSmartBotMove,
  rollDie,
  rollSmartDie,
  type GameState,
} from './ludoRules';
import { EMOTE_COOLDOWN_MS, SIMULATION_SPEEDS, useGameStore } from './gameStore';
import {
  BOT_TURN_FALLBACK_MS,
  DISCONNECTED_TURN_WAIT_MS,
  GAME_OVER_ROOM_CLOSE_MS,
  ROOM_EMOTE_IDS,
  TURN_TIMEOUT_MS,
} from './multiplayerProtocol';
import { EMOTES, getEmoteAspect } from '../scene/emoteMedia';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import {
  buildRoomShareUrl,
  buildStandaloneAppUrl,
  formatRoomCode,
  generateRoomCode,
  isEmbeddedInIframe,
  parseRoomCodeInput,
  resolveShareBaseUrl,
} from './roomCode';
import {
  EMPTY_ROOM_CLOSE_MS,
  LOBBY_RECLAIM_STALE_MS,
  LOBBY_RECONNECT_GRACE_MS,
  ROOM_IDLE_TTL_MS,
  createRoomRecord,
  disconnectPlayer,
  handleRoomAction,
  handleTurnTimeout,
  isRoomClosedAfterGameOver,
  isRoomClosedWhenEmpty,
  isRoomCodeOccupied,
  isRoomExpired,
  joinRoom,
  leaveRoom,
  markDisconnectedIfMissingSockets,
  pruneExpiredLobbySeats,
  snapshotForPlayer,
} from '../../worker/roomLogic';

const place = (state: GameState, positions: Record<string, number>): GameState => ({
  ...state,
  pawns: state.pawns.map((p) => (p.id in positions ? { ...p, progress: positions[p.id] } : p)),
});

describe('boardMap', () => {
  it('has 52 unique, edge-adjacent track tiles forming a loop', () => {
    expect(TRACK_CELLS).toHaveLength(52);
    expect(new Set(TRACK_CELLS.map((c) => `${c.row},${c.col}`)).size).toBe(52);
    TRACK_CELLS.forEach((c, i) => {
      const n = TRACK_CELLS[(i + 1) % 52];
      // Neighbours touch by edge, or by corner where the track turns around the centre.
      expect(Math.max(Math.abs(c.row - n.row), Math.abs(c.col - n.col))).toBe(1);
    });
  });

  it('home columns lead from the track into the centre without overlapping the track', () => {
    const track = new Set(TRACK_CELLS.map((c) => `${c.row},${c.col}`));
    for (const team of TEAM_IDS) {
      expect(HOME_COLUMN_CELLS[team]).toHaveLength(5);
      HOME_COLUMN_CELLS[team].forEach((c) => expect(track.has(`${c.row},${c.col}`)).toBe(false));
      const entrance = getProgressPosition(team, 50);
      const first = getProgressPosition(team, 51);
      expect(Math.abs(entrance.x - first.x) + Math.abs(entrance.z - first.z)).toBe(1);
      expect(YARD_SLOT_POSITIONS[team]).toHaveLength(4);
    }
    expect(SAFE_TRACK_INDICES).toEqual([0, 8, 13, 21, 26, 34, 39, 47]);
  });

  it('shrinks and classifies pawns sharing a tile', () => {
    const pawns: Pawn[] = [
      { id: 'PINK-0', team: 'PINK', slot: 0, progress: 13 }, // Cyan's start star
      { id: 'PINK-1', team: 'PINK', slot: 1, progress: 4 },
      { id: 'PINK-2', team: 'PINK', slot: 2, progress: 4 },
      { id: 'CYAN-0', team: 'CYAN', slot: 0, progress: 0 },
    ];
    const rival = getPawnWorldPosition(pawns[0], pawns);
    expect(rival).toMatchObject({ scale: 0.68, sharedState: 'squabble' });
    expect(getPawnWorldPosition(pawns[1], pawns)).toMatchObject({ scale: 0.68, sharedState: 'coffee' });
    const a = getPawnWorldPosition(pawns[1], pawns);
    const b = getPawnWorldPosition(pawns[2], pawns);
    expect(a.x === b.x && a.z === b.z).toBe(false);
    expect(getPawnWorldPosition({ ...pawns[1], progress: 7 }, pawns)).toMatchObject({ scale: 1, sharedState: 'solo' });
  });

  it('shrinks both pawns by 15% when they share a box border along X or Z', () => {
    // Progress 5 is (row 5, col 6) and progress 6 is (row 4, col 6): 1 tile apart along Z.
    // Progress 0 is (row 6, col 1) and progress 1 is (row 6, col 2): 1 tile apart along X.
    const pawns: Pawn[] = [
      { id: 'PINK-0', team: 'PINK', slot: 0, progress: 5 },
      { id: 'PINK-1', team: 'PINK', slot: 1, progress: 6 },
      { id: 'CYAN-0', team: 'CYAN', slot: 0, progress: 37 }, // track index 50 -> (7,0)
      { id: 'PINK-2', team: 'PINK', slot: 2, progress: 0 }, // track index 0 -> (6,1)
      { id: 'PINK-3', team: 'PINK', slot: 3, progress: 1 }, // track index 1 -> (6,2): shares X border with PINK-2
      { id: 'YELLOW-0', team: 'YELLOW', slot: 0, progress: -1 },
    ];
    expect(getPawnWorldPosition(pawns[0], pawns).scale).toBeCloseTo(0.85, 5);
    expect(getPawnWorldPosition(pawns[1], pawns).scale).toBeCloseTo(0.85, 5);
    expect(getPawnWorldPosition(pawns[3], pawns).scale).toBeCloseTo(0.85, 5);
    expect(getPawnWorldPosition(pawns[4], pawns).scale).toBeCloseTo(0.85, 5);
    // Yard pawns stay full size.
    expect(getPawnWorldPosition(pawns[5], pawns).scale).toBe(1);
    // Lone pawn far away stays full size.
    expect(getPawnWorldPosition({ ...pawns[0], progress: 16 }, pawns).scale).toBe(1);
  });

  it('places finished pawns at compact non-overlapping picnic seats around the central bonfire', () => {
    const allHome: Pawn[] = TEAM_IDS.flatMap((team) =>
      [0, 1, 2, 3].map((slot) => ({ id: `${team}-${slot}`, team, slot, progress: 56 })),
    );
    const positions = allHome.map((p) => getPawnWorldPosition(p, allHome));
    for (const pos of positions) {
      expect(pos.scale).toBeLessThan(0.5);
      expect(Math.hypot(pos.x, pos.z)).toBeGreaterThan(0.5);
      expect(Math.hypot(pos.x, pos.z)).toBeLessThan(1.4);
    }
    // All 16 picnic seats are distinct and well separated.
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z);
        expect(dist).toBeGreaterThan(0.35);
      }
    }
  });
});

describe('ludoRules', () => {
  it('2P couples seats Pink and Yellow, and 3P FFA seats Pink, Cyan, and Yellow', () => {
    expect(createGame('2P_COUPLES').activeTeams).toEqual(['PINK', 'YELLOW']);
    expect(createGame('3P_FFA').activeTeams).toEqual(['PINK', 'CYAN', 'YELLOW']);
  });

  it('needs a six to spawn, and a six grants a bonus roll', () => {
    const start = createGame('4P_FFA');
    const miss = applyRoll(start, 3);
    expect(miss.outcome).toBe('NO_MOVES');
    expect(miss.state.currentTeam).toBe('CYAN');

    const six = applyRoll(start, 6);
    expect(six.legalMoves).toHaveLength(4);
    const spawned = applyMove(six.state, 'PINK-0');
    expect(spawned).toMatchObject({ kind: 'SPAWN', to: 0, bonusRoll: true });
    expect(spawned.state).toMatchObject({ currentTeam: 'PINK', phase: 'ROLL' });
  });

  it('forfeits the turn on the third consecutive six', () => {
    let state = createGame('4P_FFA');
    for (let i = 0; i < 2; i++) state = applyMove(applyRoll(state, 6).state, 'PINK-0').state;
    const third = applyRoll(state, 6);
    expect(third.outcome).toBe('THREE_SIXES');
    expect(third.state).toMatchObject({ currentTeam: 'CYAN', phase: 'ROLL', sixStreak: 0 });
  });

  it('captures on a plain tile, grants a bonus roll, and spares pawns on stars', () => {
    // Cyan progress 2 sits on track index 15; Pink at progress 12 lands there with a 3.
    const state = place(createGame('4P_FFA'), { 'PINK-0': 12, 'CYAN-0': 2 });
    const hit = applyMove(applyRoll(state, 3).state, 'PINK-0');
    expect(hit.captured).toEqual(['CYAN-0']);
    expect(hit.bonusRoll).toBe(true);
    expect(hit.state.pawns.find((p) => p.id === 'CYAN-0')!.progress).toBe(-1);
    expect(hit.state.currentTeam).toBe('PINK');

    // Cyan progress 0 is its start star (index 13): no capture, they share the tile.
    const safe = place(createGame('4P_FFA'), { 'PINK-0': 10, 'CYAN-0': 0 });
    const share = applyMove(applyRoll(safe, 3).state, 'PINK-0');
    expect(share.captured).toEqual([]);
    expect(share.sharedWith).toEqual(['CYAN-0']);
    expect(share.state.currentTeam).toBe('CYAN');
  });

  it('never captures a 2v2 partner', () => {
    // Yellow progress 2 is track index 28; Pink progress 28 is the same tile.
    const state = place(createGame('2V2_TEAM'), { 'PINK-0': 25, 'YELLOW-0': 2 });
    expect(applyMove(applyRoll(state, 3).state, 'PINK-0').captured).toEqual([]);
  });

  it('requires an exact roll to enter Home, grants a bonus roll for non-final pawns, and ends 2P when all home', () => {
    // 1st pawn reaching Home grants Pink an extra chance while other pawns remain!
    const mid = place(createGame('2P_COUPLES'), { 'PINK-0': 54 });
    const bonusHome = applyMove(applyRoll(mid, 2).state, 'PINK-0');
    expect(bonusHome.reachedHome).toBe(true);
    expect(bonusHome.finishedRank).toBeNull();
    expect(bonusHome.bonusRoll).toBe(true);
    expect(bonusHome.state).toMatchObject({ currentTeam: 'PINK', phase: 'ROLL' });

    const state = place(createGame('2P_COUPLES'), { 'PINK-0': 54, 'PINK-1': 56, 'PINK-2': 56, 'PINK-3': 56 });
    expect(applyRoll(state, 3).outcome).toBe('NO_MOVES');
    const home = applyMove(applyRoll(state, 2).state, 'PINK-0');
    expect(home.reachedHome).toBe(true);
    expect(home.finishedRank).toBe(1);
    expect(home.bonusRoll).toBe(false);
    expect(home.state).toMatchObject({ phase: 'GAME_OVER', winners: ['PINK'], rankings: ['PINK', 'YELLOW'] });
  });

  it('continues 4P and 3P matches until the last player remains, tracking 1st, 2nd, 3rd, and 4th', () => {
    let state = place(createGame('4P_FFA'), {
      'PINK-0': 55, 'PINK-1': 56, 'PINK-2': 56, 'PINK-3': 56,
      'CYAN-0': 55, 'CYAN-1': 56, 'CYAN-2': 56, 'CYAN-3': 56,
      'YELLOW-0': 55, 'YELLOW-1': 56, 'YELLOW-2': 56, 'YELLOW-3': 56,
    });

    // Pink finishes 1st -> game keeps going!
    const first = applyMove(applyRoll(state, 1).state, 'PINK-0');
    expect(first.finishedRank).toBe(1);
    expect(first.state.phase).toBe('ROLL');
    expect(first.state.winners).toEqual([]);
    expect(first.state.rankings).toEqual(['PINK']);
    expect(first.state.currentTeam).toBe('CYAN');

    // Cyan finishes 2nd -> game still keeps going for 3rd/4th!
    const second = applyMove(applyRoll(first.state, 1).state, 'CYAN-0');
    expect(second.finishedRank).toBe(2);
    expect(second.state.phase).toBe('ROLL');
    expect(second.state.rankings).toEqual(['PINK', 'CYAN']);
    expect(second.state.currentTeam).toBe('YELLOW');

    // Yellow finishes 3rd -> only Mint left, so Mint is 4th and game ends!
    const third = applyMove(applyRoll(second.state, 1).state, 'YELLOW-0');
    expect(third.finishedRank).toBe(3);
    expect(third.state.phase).toBe('GAME_OVER');
    expect(third.state.winners).toEqual(['PINK']);
    expect(third.state.rankings).toEqual(['PINK', 'CYAN', 'YELLOW', 'MINT']);
  });
});

describe('dice', () => {
  it('is fair: every face comes up about one time in six', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    const rolls = 120_000;
    for (let i = 0; i < rolls; i++) counts[rollDie() - 1]++;
    // Expected 20,000 each; 600 is more than four standard deviations of slack.
    for (const count of counts) expect(Math.abs(count - rolls / 6)).toBeLessThan(600);
  });

  it('revamps probabilities dynamically for yard spawns, captures, chases, and escapes while preserving bounds', () => {
    // 1. Yard rescue: 0 active pawns boosts 6 probability.
    const yardEmpty = createGame('4P_FFA');
    const yardWeights = getSmartDiceWeights(yardEmpty);
    expect(yardWeights[5]).toBeGreaterThan(yardWeights[0]);
    expect(rollSmartDie(yardEmpty, () => 0.99)).toBe(6);

    let sixCount = 0;
    for (let i = 0; i < 6000; i++) if (rollSmartDie(yardEmpty) === 6) sixCount++;
    expect(sixCount).toBeGreaterThan(1350); // > 22.5% (well above baseline 16.7%)

    // 2. Capture boost: Cyan-0 is on track 15 (progress 2), Pink-0 at 12 needs a 3 to capture.
    const captureState = place(createGame('4P_FFA'), { 'PINK-0': 12, 'CYAN-0': 2 });
    const captureWeights = getSmartDiceWeights(captureState);
    expect(captureWeights[2]).toBeGreaterThan(captureWeights[0]); // face 3 > face 1

    // 3. Chase boost: Pink-0 at 12 can roll 1 to sit 2 steps behind Cyan-0 (at progress 2 => track 15).
    expect(captureWeights[0]).toBeGreaterThan(1);

    // 4. Escape boost: Pink-0 at 10 (unsafe track 10) hunted by Cyan-0 at progress 50? No, let Cyan-0 sit at 48 (track 9, 1 step behind Pink-0!).
    // Wait: Pink progress 15 (track 15) hunted by Cyan progress 1 (track 14, 1 behind); Pink rolling 6 lands at 21 (safe star!)
    const huntedState = place(createGame('4P_FFA'), { 'PINK-0': 15, 'CYAN-0': 1 });
    const huntedWeights = getSmartDiceWeights(huntedState);
    expect(huntedWeights[5]).toBeGreaterThan(1.5); // rolling 6 reaches safe star 21

    // Every face remains positively weighted so all outcomes remain possible.
    for (const w of huntedWeights) expect(w).toBeGreaterThanOrEqual(0.45);
  });
});

describe('full-game simulation', () => {
  /** Small deterministic PRNG so a failing game can be replayed. */
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  it.each(['2P_COUPLES', '3P_FFA', '4P_FFA', '2V2_TEAM'] as const)('plays 40 random %s games without breaking a rule', (mode) => {
    for (let game = 0; game < 40; game++) {
      const random = seeded(game * 7919 + mode.length);
      let state = createGame(mode);
      let turns = 0;
      while (state.phase !== 'GAME_OVER') {
        expect(++turns).toBeLessThan(20000); // every game must end
        const value = rollSmartDie(state, random);
        const roller = state.currentTeam;
        const streakBefore = state.sixStreak;
        const roll = applyRoll(state, value);
        if (roll.outcome === 'THREE_SIXES') {
          expect(value).toBe(6);
          expect(streakBefore).toBe(2);
          expect(roll.state.currentTeam).not.toBe(roller);
        }
        if (roll.outcome !== 'MOVE') {
          expect(roll.state.pawns).toEqual(state.pawns); // nothing moves without a legal move
          state = roll.state;
          continue;
        }
        const before = roll.state.pawns;
        const pawnId = roll.legalMoves[Math.floor(random() * roll.legalMoves.length)];
        const move = applyMove(roll.state, pawnId);
        const mover = before.find((p) => p.id === pawnId)!;
        expect(mover.team).toBe(roller);

        // Only a six leaves the yard; every other move advances exactly the rolled number.
        if (mover.progress === -1) {
          expect(value).toBe(6);
          expect(move.to).toBe(0);
        } else {
          expect(move.to - mover.progress).toBe(value);
          expect(move.path).toHaveLength(value);
        }
        expect(move.to).toBeLessThanOrEqual(56);

        for (const pawn of move.state.pawns) {
          const old = before.find((p) => p.id === pawn.id)!;
          if (pawn.id === pawnId) continue;
          if (move.captured.includes(pawn.id)) {
            expect(pawn.progress).toBe(-1);
            expect(areAllies(mode, pawn.team, mover.team)).toBe(false);
            expect(SAFE_TRACK_INDICES).not.toContain(getTrackIndex(old.team, old.progress));
          } else {
            expect(pawn.progress).toBe(old.progress); // nobody else moves
          }
        }
        if (move.state.phase !== 'GAME_OVER') {
          const keepsTurn = move.state.currentTeam === roller;
          if (move.reachedHome && !isDone(move.state, roller)) expect(move.bonusRoll).toBe(true);
          if (move.bonusRoll) expect(keepsTurn).toBe(true);
          else if (move.state.activeTeams.length > 1) expect(keepsTurn && value !== 6 && move.captured.length === 0 && !move.reachedHome && !isDone(move.state, roller)).toBe(false);
        }
        state = move.state;
      }
      const winners = state.winners;
      expect(winners.length).toBe(mode === '2V2_TEAM' ? 2 : 1);
      for (const team of winners) expect(isDone(state, team)).toBe(true);
      expect(state.rankings).toHaveLength(state.activeTeams.length);
      expect(new Set(state.rankings).size).toBe(state.activeTeams.length);
    }
  }, 30_000);
});

function isDone(state: GameState, team: string): boolean {
  return state.pawns.filter((p) => p.team === team).every((p) => p.progress === 56);
}

describe('getMovePreview & pickSmartBotMove', () => {
  it('computes accurate move previews including captures, safe tiles, and home entry', () => {
    const start = createGame('4P_FFA');
    expect(getMovePreview(start, 'PINK-0')).toBeNull();

    const rolledSix = applyRoll(start, 6).state;
    const spawnPreview = getMovePreview(rolledSix, 'PINK-0');
    expect(spawnPreview).toMatchObject({
      pawnId: 'PINK-0',
      kind: 'SPAWN',
      from: -1,
      to: 0,
      path: [0],
      willCapture: [],
      isSafeLanding: true,
      reachesHome: false,
    });

    const captureSetup = place(createGame('4P_FFA'), { 'PINK-0': 12, 'CYAN-0': 2 });
    const captureRoll = applyRoll(captureSetup, 3).state;
    const capturePreview = getMovePreview(captureRoll, 'PINK-0');
    expect(capturePreview).toMatchObject({
      pawnId: 'PINK-0',
      kind: 'MOVE',
      from: 12,
      to: 15,
      path: [13, 14, 15],
      willCapture: ['CYAN-0'],
      isSafeLanding: false,
      reachesHome: false,
    });
    expect(capturePreview?.waypoints).toHaveLength(3);

    const homeSetup = place(createGame('2P_COUPLES'), { 'PINK-0': 54 });
    const homeRoll = applyRoll(homeSetup, 2).state;
    expect(getMovePreview(homeRoll, 'PINK-0')).toMatchObject({
      to: 56,
      isSafeLanding: true,
      reachesHome: true,
    });
  });

  it('prefers capture and home moves in pickSmartBotMove', () => {
    const setup = place(createGame('4P_FFA'), { 'PINK-0': 12, 'PINK-1': 5, 'CYAN-0': 2 });
    const rolled = applyRoll(setup, 3);
    expect(pickSmartBotMove(rolled.state, rolled.legalMoves)).toBe('PINK-0');

    const homeSetup = place(createGame('4P_FFA'), { 'PINK-0': 53, 'PINK-1': 10 });
    const homeRolled = applyRoll(homeSetup, 3);
    expect(pickSmartBotMove(homeRolled.state, homeRolled.legalMoves)).toBe('PINK-0');
  });
});

describe('roomCode helpers', () => {
  it('generates, formats, and parses 9-digit room codes and invite URLs', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^\d{9}$/);
    expect(formatRoomCode(code)).toMatch(/^\d{3}-\d{3}-\d{3}$/);

    const url = buildRoomShareUrl('https://chibi-ludo.app/', code);
    expect(url).toBe(`https://chibi-ludo.app/?room=${code}`);
    expect(buildRoomShareUrl('https://infinitystudio.store/ludo', code)).toBe(
      `https://infinitystudio.store/ludo?room=${code}`,
    );
    expect(parseRoomCodeInput(url)).toBe(code);
    expect(parseRoomCodeInput(`https://inkfinitystudio.store/game-room?parentUrl=https%3A%2F%2Finkfinitystudio.store&room=${formatRoomCode(code).replace(/-/g, '%2D')}&ref=wa`)).toBe(code);
    expect(parseRoomCodeInput(`Join my Ludo room! https://inkfinitystudio.store/game-room?room=${code} at 8pm`)).toBe(code);
    expect(parseRoomCodeInput(`Room code is ${formatRoomCode(code)} come fast!`)).toBe(code);
    expect(parseRoomCodeInput(formatRoomCode(code))).toBe(code);
    expect(parseRoomCodeInput(`  ${code}  `)).toBe(code);
    expect(parseRoomCodeInput('12345')).toBeNull();
    expect(parseRoomCodeInput('https://example.com/?room=bad')).toBeNull();
  });

  it('shares direct full-screen game URLs even when embedded with parentUrl', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://chibi-ludo-3d.inkfintystudio-store.workers.dev',
        pathname: '/',
        search: '?embed=1&parentUrl=https%3A%2F%2Finkfinitystudio.store%2Fgame-room',
      },
    });
    try {
      expect(resolveShareBaseUrl()).toBe('https://chibi-ludo-3d.inkfintystudio-store.workers.dev');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('gameStore enhancements', () => {
  afterEach(() => {
    vi.useRealTimers();
    useGameStore.getState().exitToHome();
  });

  it('supports home/playing lifecycle, pause, room state, hoveredPawnId, and resetGame', () => {
    expect(useGameStore.getState().screen).toBe('home');

    const store = useGameStore.getState();
    store.startMatch({
      mode: '4P_FFA',
      vsAi: true,
      room: { code: '482910375', role: 'host', peers: 1 },
    });
    store.setHoveredPawn('PINK-0');

    expect(useGameStore.getState().screen).toBe('playing');
    expect(useGameStore.getState().vsAi).toBe(true);
    expect(useGameStore.getState().room?.code).toBe('482910375');
    expect(useGameStore.getState().hoveredPawnId).toBe('PINK-0');

    // Pausing blocks dice rolls cleanly.
    store.setPaused(true);
    store.rollDice();
    expect(useGameStore.getState().activeRoll).toBeNull();

    store.resetGame();
    const after = useGameStore.getState();
    expect(after.screen).toBe('playing');
    expect(after.paused).toBe(false);
    expect(after.game.mode).toBe('4P_FFA');
    expect(after.vsAi).toBe(true);
    expect(after.hoveredPawnId).toBeNull();
    expect(after.stats).toEqual({ turns: 0, captures: 0, sixes: 0 });

    store.exitToHome();
    expect(useGameStore.getState().screen).toBe('home');
  });

  it('auto-moves when only one pawn is movable on the board and waits when rolling a 6 with yard choices', () => {
    vi.useFakeTimers();
    const store = useGameStore.getState();
    store.startMatch({ mode: '2P_COUPLES', vsAi: false, simulation: false, room: null });

    // Place only PINK-0 on the board (progress 4); others stay in yard (-1).
    useGameStore.setState((s) => ({
      game: place(s.game, { 'PINK-0': 4 }),
      activeRoll: { id: 9001, value: 3 },
      isAnimating: true,
    }));

    useGameStore.getState().completeRoll(9001);
    expect(useGameStore.getState().legalMoves).toEqual(['PINK-0']);
    expect(useGameStore.getState().notice).toContain('Auto-moving');

    // Advance timer -> pawn automatically moves!
    vi.advanceTimersByTime(300);
    expect(useGameStore.getState().pendingGame?.pawns.find((p) => p.id === 'PINK-0')?.progress).toBe(7);

    // Complete pending event and test a 6 with yard choices -> should NOT auto-move.
    const ev = useGameStore.getState().lastEvent!;
    useGameStore.getState().completeEvent(ev.id);
    useGameStore.setState((s) => ({
      game: { ...place(s.game, { 'PINK-0': 4 }), currentTeam: 'PINK', phase: 'ROLL' },
      activeRoll: { id: 9002, value: 6 },
      isAnimating: true,
    }));
    useGameStore.getState().completeRoll(9002);
    vi.advanceTimersByTime(500);
    expect(useGameStore.getState().game.phase).toBe('MOVE');
    expect(useGameStore.getState().legalMoves).toHaveLength(4);
    expect(useGameStore.getState().pendingGame).toBeNull();
  });

  it('recovers via roll and event watchdogs if 3D animation callbacks fail to fire', () => {
    vi.useFakeTimers();
    const store = useGameStore.getState();
    store.startMatch({ mode: '2P_COUPLES', vsAi: false, simulation: false, room: null });

    // Stalled roll recovers cleanly without leaving isAnimating stuck true.
    store.rollDice();
    expect(useGameStore.getState().isAnimating).toBe(true);
    expect(useGameStore.getState().activeRoll).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(useGameStore.getState().activeRoll).toBeNull();

    // If a pawn move animation never calls completeEvent, watchdog unlocks turns cleanly.
    useGameStore.setState((s) => ({
      game: { ...place(s.game, { 'PINK-0': 4 }), currentTeam: 'PINK', phase: 'MOVE', dice: 2 },
      legalMoves: ['PINK-0', 'PINK-1'],
      isAnimating: false,
      activeRoll: null,
    }));
    useGameStore.getState().selectPawn('PINK-0');
    expect(useGameStore.getState().isAnimating).toBe(true);
    expect(useGameStore.getState().lastEvent).not.toBeNull();
    vi.advanceTimersByTime(3500);
    expect(useGameStore.getState().isAnimating).toBe(false);
    expect(useGameStore.getState().lastEvent).toBeNull();
  });
});

describe('multiplayer roomLogic', () => {
  afterEach(() => {
    vi.useRealTimers();
    useGameStore.getState().exitToHome();
  });

  it('assigns seats with player names, updates names/modes, prevents out-of-turn rolls, and runs authoritative moves', () => {
    let room = createRoomRecord('482910375', '4P_FFA');
    room = joinRoom(room, 'host-1', 'Aman');
    room = joinRoom(room, 'guest-2', 'Priya');

    let hostSnap = snapshotForPlayer(room, 'host-1');
    let guestSnap = snapshotForPlayer(room, 'guest-2');
    expect(hostSnap.yourTeam).toBe('PINK');
    expect(hostSnap.isHost).toBe(true);
    expect(guestSnap.yourTeam).toBe('CYAN');
    expect(guestSnap.isHost).toBe(false);
    expect(hostSnap.seats[0]).toMatchObject({ playerName: 'Aman', label: 'Aman (Host)' });
    expect(hostSnap.seats[1]).toMatchObject({ playerName: 'Priya', label: 'Priya' });

    // Live rename & mode switch preserve joined player names.
    room = handleRoomAction(room, 'guest-2', { type: 'set_name', name: 'PriyaK' }).record;
    room = handleRoomAction(room, 'host-1', { type: 'set_mode', mode: '3P_FFA' }).record;
    hostSnap = snapshotForPlayer(room, 'host-1');
    guestSnap = snapshotForPlayer(room, 'guest-2');
    expect(hostSnap.seats).toHaveLength(3);
    expect(hostSnap.seats[1]).toMatchObject({ playerName: 'PriyaK', label: 'PriyaK' });

    // Host starts the game; empty Yellow seat becomes a smart bot.
    const started = handleRoomAction(room, 'host-1', { type: 'start', mode: '3P_FFA' });
    room = started.record;
    expect(room.started).toBe(true);
    expect(room.seats.filter((s) => s.occupant === 'bot').map((s) => s.team)).toEqual(['YELLOW']);

    // Guest cannot roll during Pink's turn.
    const spoofRoll = handleRoomAction(room, 'guest-2', { type: 'roll' });
    expect(spoofRoll.reply).toEqual({ type: 'error', message: 'Not your turn to roll.' });
    expect(spoofRoll.persist).toBe(false);

    // Host rolls an authoritative 6 (random = 0.99 -> floor(0.99 * 6) + 1 = 6).
    const rollSix = handleRoomAction(room, 'host-1', { type: 'roll' }, () => 0.99);
    room = rollSix.record;
    expect(rollSix.broadcast).toMatchObject([{ type: 'roll', value: 6, team: 'PINK' }]);
    expect(room.legalMoves.length).toBe(4);

    // Illegal move rejected.
    const badMove = handleRoomAction(room, 'host-1', { type: 'move', pawnId: 'CYAN-0' });
    expect(badMove.reply?.type).toBe('error');

    // Legal move commits and broadcasts cleanly.
    const goodMove = handleRoomAction(room, 'host-1', { type: 'move', pawnId: 'PINK-0' });
    room = goodMove.record;
    expect(goodMove.broadcast).toMatchObject([{ type: 'move', pawnId: 'PINK-0', team: 'PINK' }]);
    expect(room.game.pawns.find((p) => p.id === 'PINK-0')?.progress).toBe(0);

    // Disconnecting after match start preserves seat for reconnect.
    room = disconnectPlayer(room, 'guest-2');
    expect(room.seats.find((s) => s.team === 'CYAN')?.connected).toBe(false);
    room = joinRoom(room, 'guest-2');
    expect(room.seats.find((s) => s.team === 'CYAN')?.connected).toBe(true);

    // Room occupancy & idle TTL expiration checks for unique room code allocation.
    const now = 1_700_000_000_000;
    const touched = { ...room, lastActiveAt: now };
    expect(isRoomExpired(touched, now + 1000)).toBe(false);
    expect(isRoomCodeOccupied(touched, now + 1000)).toBe(true);
    expect(isRoomExpired(touched, now + ROOM_IDLE_TTL_MS + 1)).toBe(true);
    expect(isRoomCodeOccupied(touched, now + ROOM_IDLE_TTL_MS + 1)).toBe(false);
  });

  it('enforces first-come first-served color picking, transient live chat, and nearest-player orientation', () => {
    let room = createRoomRecord('987654321', '4P_FFA');
    room = joinRoom(room, 'p1', 'Riya');
    room = joinRoom(room, 'p2', 'Kabir');

    // First-come, first-served color claiming in lobby.
    const p2PickYellow = handleRoomAction(room, 'p2', { type: 'select_team', team: 'YELLOW' });
    room = p2PickYellow.record;
    expect(snapshotForPlayer(room, 'p2').yourTeam).toBe('YELLOW');
    expect(room.seats.find((s) => s.team === 'CYAN')?.occupant).toBe('open');

    // Trying to take an already-claimed color fails.
    const collision = handleRoomAction(room, 'p1', { type: 'select_team', team: 'YELLOW' });
    expect(collision.reply).toEqual({ type: 'error', message: 'Yellow is already taken!' });
    expect(snapshotForPlayer(collision.record, 'p1').yourTeam).toBe('PINK');

    // Switching mode keeps claimed colors when present in new mode.
    room = handleRoomAction(room, 'p1', { type: 'set_mode', mode: '2P_COUPLES' }).record;
    expect(snapshotForPlayer(room, 'p1').yourTeam).toBe('PINK');
    expect(snapshotForPlayer(room, 'p2').yourTeam).toBe('YELLOW');

    // Live chat broadcasts transiently (zero DO storage write) and ignores empty strings.
    const emptyChat = handleRoomAction(room, 'p1', { type: 'chat', text: '   \n\t  ' });
    expect(emptyChat.broadcast).toEqual([]);
    const chatRes = handleRoomAction(room, 'p2', { type: 'chat', text: 'Let us play!' });
    expect(chatRes.persist).toBe(false);
    expect(chatRes.broadcast).toHaveLength(1);
    expect(chatRes.broadcast[0]).toMatchObject({
      type: 'chat',
      chat: { team: 'YELLOW', senderName: 'Kabir', text: 'Let us play!' },
    });

    // Nearest-player board orientation places every player's own corner at bottom-left ('bl').
    for (const team of TEAM_IDS) {
      expect(getCornerSlotForTeam(team, team)).toBe('bl');
      const corners = TEAM_IDS.map((t) => getCornerSlotForTeam(t, team));
      expect(new Set(corners).size).toBe(4);
      expect(Number.isFinite(getBoardYawForTeam(team))).toBe(true);
    }
  });

  it('preserves lobby host & seats across temporary disconnects, handles explicit leave, and prunes expired seats', () => {
    const t0 = 1_700_000_000_000;
    let room = createRoomRecord('555111999', '2P_COUPLES');
    room = joinRoom(room, 'host-1', 'Aman', t0);

    // Host switches apps (WS drops) while sharing link -> seat & hostId stay reserved!
    room = disconnectPlayer(room, 'host-1', t0 + 1000);
    expect(room.hostId).toBe('host-1');
    expect(room.seats[0]).toMatchObject({ occupant: 'human', playerId: 'host-1', connected: false });

    // Friend opens link while host is briefly disconnected -> joins the SAME room on next seat!
    room = joinRoom(room, 'guest-2', 'Priya', t0 + 2000);
    expect(room.hostId).toBe('host-1');
    expect(snapshotForPlayer(room, 'guest-2').yourTeam).toBe('YELLOW');
    expect(snapshotForPlayer(room, 'guest-2').isHost).toBe(false);

    // Host switches back & reconnects -> restores connected status with both players visible!
    room = joinRoom(room, 'host-1', 'Aman', t0 + 3000);
    const hostSnap = snapshotForPlayer(room, 'host-1');
    expect(hostSnap.isHost).toBe(true);
    expect(hostSnap.seats.filter((s) => s.occupant === 'human' && s.connected)).toHaveLength(2);

    // Explicit leave removes lobby seat and promotes remaining player to host.
    room = leaveRoom(room, 'host-1', t0 + 4000);
    expect(room.hostId).toBe('guest-2');
    expect(room.seats[0].occupant).toBe('open');

    // Unexpected disconnect beyond LOBBY_RECONNECT_GRACE_MS prunes stale seat.
    room = disconnectPlayer(room, 'guest-2', t0 + 5000);
    room = pruneExpiredLobbySeats(room, t0 + 5000 + LOBBY_RECONNECT_GRACE_MS + 1);
    expect(room.seats.every((s) => s.occupant === 'open')).toBe(true);
    expect(room.hostId).toBe('');
  });

  it('synchronizes room mode in gameStore lobby snapshot', () => {
    const store = useGameStore.getState();
    store.initRoomSession({ code: '123456789', mode: '4P_FFA', role: 'guest', status: 'connecting' });
    let room = createRoomRecord('123456789', '2P_COUPLES');
    room = joinRoom(room, 'host-1', 'Aman');
    room = joinRoom(room, 'guest-2', 'Priya');

    store.syncRoomSnapshot(snapshotForPlayer(room, 'guest-2'));
    const next = useGameStore.getState();
    expect(next.room?.mode).toBe('2P_COUPLES');
    expect(next.game.mode).toBe('2P_COUPLES');
    expect(next.room?.myTeam).toBe('YELLOW');
  });

  it('triggers mobile vibration patterns safely when supported and skips silently otherwise', () => {
    const vibrateMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { vibrate: vibrateMock });
    try {
      expect(triggerHaptic('MY_TURN')).toBe(true);
      expect(vibrateMock).toHaveBeenCalledWith([...HAPTIC_PATTERNS.MY_TURN]);
      expect(triggerHaptic('CAPTURE')).toBe(true);
      expect(vibrateMock).toHaveBeenCalledWith([...HAPTIC_PATTERNS.CAPTURE]);
      expect(triggerHaptic('SPAWN_6')).toBe(true);
      expect(vibrateMock).toHaveBeenCalledWith(HAPTIC_PATTERNS.SPAWN_6);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(triggerHaptic('MY_TURN')).toBe(false);
  });

  it('reclaims stale disconnected 2P lobby seats and lets late friends take over bot seats after early start', () => {
    const t0 = 1_700_000_000_000;
    let room = createRoomRecord('777888999', '2P_COUPLES');
    room = joinRoom(room, 'host-1', 'Aman', t0);
    room = joinRoom(room, 'guest-old-webview', 'Priya', t0 + 1000);

    // Friend switches from WhatsApp in-app browser to Chrome; old socket drops.
    room = disconnectPlayer(room, 'guest-old-webview', t0 + 2000);
    room = joinRoom(room, 'guest-chrome', 'Priya', t0 + 2000 + LOBBY_RECLAIM_STALE_MS + 100);
    expect(snapshotForPlayer(room, 'guest-chrome').yourTeam).toBe('YELLOW');
    expect(room.seats.filter((s) => s.occupant === 'human')).toHaveLength(2);

    // Ghost connected seats missing live sockets are marked disconnected before joining.
    room = markDisconnectedIfMissingSockets(room, new Set(['host-1']), t0 + 20000);
    expect(room.seats.find((s) => s.playerId === 'guest-chrome')?.connected).toBe(false);

    // Host starts early with 1/2 humans; second seat starts as AI bot -> late friend takes it over live.
    let earlyRoom = createRoomRecord('111222333', '2P_COUPLES');
    earlyRoom = joinRoom(earlyRoom, 'host-1', 'Aman', t0);
    earlyRoom = handleRoomAction(earlyRoom, 'host-1', { type: 'start', mode: '2P_COUPLES' }).record;
    expect(earlyRoom.started).toBe(true);
    expect(earlyRoom.seats.find((s) => s.team === 'YELLOW')?.occupant).toBe('bot');

    earlyRoom = joinRoom(earlyRoom, 'late-friend', 'Priya', t0 + 3000);
    const lateSnap = snapshotForPlayer(earlyRoom, 'late-friend');
    expect(lateSnap.yourTeam).toBe('YELLOW');
    expect(lateSnap.seats.find((s) => s.team === 'YELLOW')?.occupant).toBe('human');

    // Once all human seats are occupied, a 3rd player is still rejected from 2P.
    const thirdTry = joinRoom(earlyRoom, 'stranger-3', 'Other', t0 + 4000);
    expect(thirdTry.seats.some((s) => s.playerId === 'stranger-3')).toBe(false);
  });

  it('simulates multi-turn 2-human + 2-bot multiplayer lockstep and recovers cleanly from dropped events', () => {
    vi.useFakeTimers();
    let room = createRoomRecord('445566778', '4P_FFA');
    room = joinRoom(room, 'host-mobile', 'Aman');
    room = joinRoom(room, 'guest-mobile', 'Priya');
    room = handleRoomAction(room, 'host-mobile', { type: 'start', mode: '4P_FFA' }).record;

    const store = useGameStore.getState();
    store.syncRoomSnapshot(snapshotForPlayer(room, 'guest-mobile'));
    expect(useGameStore.getState().screen).toBe('playing');
    expect(useGameStore.getState().room?.myTeam).toBe('CYAN');

    // Simulate 16 alternating server turns (humans + bots), including one forced watchdog recovery.
    for (let step = 0; step < 16; step++) {
      const currentTeam = room.game.currentTeam;
      const seat = room.seats.find((s) => s.team === currentTeam)!;
      const actorId = seat.occupant === 'human' ? seat.playerId! : room.hostId;
      const rollAction = handleRoomAction(room, actorId, { type: 'roll' }, () => 0.99);
      room = rollAction.record;
      const rollMsg = rollAction.broadcast[0];
      if (rollMsg?.type === 'roll') {
        store.playRemoteRoll(rollMsg.value);
        // Advance watchdog timer instead of manual completeRoll on odd turns to simulate throttled mobile WebGL.
        if (step % 2 === 1) {
          vi.advanceTimersByTime(2000);
        } else {
          const activeRoll = useGameStore.getState().activeRoll;
          if (activeRoll) store.completeRoll(activeRoll.id);
        }
        vi.advanceTimersByTime(700);
      }

      if (room.game.phase === 'MOVE' && room.legalMoves.length > 0) {
        const chosen = room.legalMoves[0];
        const moveAction = handleRoomAction(room, actorId, { type: 'move', pawnId: chosen });
        room = moveAction.record;
        store.playRemoteMove(chosen);
        while (useGameStore.getState().lastEvent) {
          vi.advanceTimersByTime(4000);
        }
      }
      expect(useGameStore.getState().isAnimating).toBe(false);
    }

    // Even if client falls out of sync (e.g. missed WS frame), snapshot resync aligns exact board state.
    const staleBefore = useGameStore.getState().game;
    useGameStore.setState({ isAnimating: false, activeRoll: null, lastEvent: null, game: createGame('4P_FFA') });
    store.syncRoomSnapshot(snapshotForPlayer(room, 'guest-mobile'));
    expect(useGameStore.getState().game.currentTeam).toBe(room.game.currentTeam);
    expect(useGameStore.getState().game.phase).toBe(room.game.phase);
    expect(useGameStore.getState().game.pawns).toEqual(staleBefore.pawns);
  });

  it('resets the board camera tick whenever the live chat drawer closes', () => {
    useGameStore.getState().setChatOpen(false);
    const baselineTick = useGameStore.getState().cameraResetTick;
    useGameStore.getState().setChatOpen(true);
    expect(useGameStore.getState().cameraResetTick).toBe(baselineTick);
    useGameStore.getState().setChatOpen(false);
    expect(useGameStore.getState().cameraResetTick).toBe(baselineTick + 1);
    useGameStore.getState().setChatOpen(false);
    expect(useGameStore.getState().cameraResetTick).toBe(baselineTick + 1);
  });

  it('queues out-of-phase 2P remote rolls, moves, and snapshots without desyncing Yellow/Pink turns', () => {
    vi.useFakeTimers();
    let room = createRoomRecord('246813579', '2P_COUPLES');
    room = joinRoom(room, 'host-pink', 'Aman');
    room = joinRoom(room, 'guest-yellow', 'Priya');
    room = handleRoomAction(room, 'host-pink', { type: 'start', mode: '2P_COUPLES' }).record;

    const store = useGameStore.getState();
    store.syncRoomSnapshot(snapshotForPlayer(room, 'guest-yellow'));
    expect(useGameStore.getState().game.currentTeam).toBe('PINK');

    // Pink rolls a 2 (NO_MOVES -> server advances immediately to YELLOW).
    const pinkMiss = handleRoomAction(room, 'host-pink', { type: 'roll' }, () => 0.2);
    room = pinkMiss.record;
    const pinkRollMsg = pinkMiss.broadcast[0];
    expect(pinkRollMsg.type).toBe('roll');
    if (pinkRollMsg.type !== 'roll') return;
    expect(room.game.currentTeam).toBe('YELLOW');

    // Guest client plays Pink's roll, enters NO_MOVES passTimer; BEFORE passTimer fires, Yellow rolls 6 and spawns YELLOW-0!
    store.playRemoteRoll(pinkRollMsg.value, {
      team: pinkRollMsg.team,
      seq: pinkRollMsg.seq,
      game: pinkRollMsg.game,
      legalMoves: pinkRollMsg.legalMoves,
    });
    const rollId1 = useGameStore.getState().activeRoll!.id;
    store.completeRoll(rollId1); // Now inside NO_MOVES passTimer (hasPendingPass = true, currentTeam still PINK!)

    const yellowSix = handleRoomAction(room, 'guest-yellow', { type: 'roll' }, () => 0.99);
    room = yellowSix.record;
    const yellowRollMsg = yellowSix.broadcast[0];
    if (yellowRollMsg.type !== 'roll') return;

    const yellowMove = handleRoomAction(room, 'guest-yellow', { type: 'move', pawnId: 'YELLOW-0' });
    room = yellowMove.record;
    const yellowMoveMsg = yellowMove.broadcast[0];
    if (yellowMoveMsg.type !== 'move') return;

    // Both Yellow's roll and move arrive while client is still in passTimer / activeRoll!
    store.playRemoteRoll(yellowRollMsg.value, {
      team: yellowRollMsg.team,
      seq: yellowRollMsg.seq,
      game: yellowRollMsg.game,
      legalMoves: yellowRollMsg.legalMoves,
    });
    store.playRemoteMove(yellowMoveMsg.pawnId, {
      team: yellowMoveMsg.team,
      seq: yellowMoveMsg.seq,
      game: yellowMoveMsg.game,
      legalMoves: yellowMoveMsg.legalMoves,
    });

    // Advance timers through passTimer (560ms) -> queued roll watchdog -> queued move watchdog.
    vi.advanceTimersByTime(600);
    expect(useGameStore.getState().activeRoll?.value).toBe(6);
    vi.advanceTimersByTime(2000);
    expect(useGameStore.getState().lastEvent).not.toBeNull();
    vi.advanceTimersByTime(3000);

    // Client converges cleanly to exact server state: YELLOW's bonus roll after spawning YELLOW-0!
    expect(useGameStore.getState().isAnimating).toBe(false);
    expect(useGameStore.getState().game.currentTeam).toBe(room.game.currentTeam);
    expect(useGameStore.getState().game.phase).toBe(room.game.phase);
    expect(useGameStore.getState().game.pawns.find((p) => p.id === 'YELLOW-0')?.progress).toBe(0);

    // Also verify a snapshot arriving mid-animation is deferred and applied once animation completes.
    const nextRoll = handleRoomAction(room, 'guest-yellow', { type: 'roll' }, () => 0.2);
    room = nextRoll.record;
    const nextRollMsg = nextRoll.broadcast[0];
    if (nextRollMsg.type !== 'roll') return;

    store.playRemoteRoll(nextRollMsg.value, {
      team: nextRollMsg.team,
      seq: nextRollMsg.seq,
      game: nextRollMsg.game,
      legalMoves: nextRollMsg.legalMoves,
    });
    expect(useGameStore.getState().isAnimating).toBe(true);

    // Advance server: Yellow finishes moving YELLOW-0 (turn -> PINK), then Pink rolls 6 while client is still animating!
    room = handleRoomAction(room, 'guest-yellow', { type: 'move', pawnId: 'YELLOW-0' }).record;
    const pinkNext = handleRoomAction(room, 'host-pink', { type: 'roll' }, () => 0.99);
    room = pinkNext.record;
    store.syncRoomSnapshot(snapshotForPlayer(room, 'guest-yellow'));

    // Finish local timers -> deferred snapshot reconciles exact server state (PINK MOVE with 6).
    vi.advanceTimersByTime(4000);
    expect(useGameStore.getState().isAnimating).toBe(false);
    expect(useGameStore.getState().game.currentTeam).toBe('PINK');
    expect(useGameStore.getState().game.phase).toBe('MOVE');
    expect(useGameStore.getState().legalMoves).toHaveLength(4);
  });

  it('detects iframe embeds and builds clean standalone fullscreen launch URLs', () => {
    vi.stubGlobal('window', {
      self: { id: 'child' },
      top: { id: 'parent' },
      location: {
        origin: 'https://chibi-ludo-3d.inkfintystudio-store.workers.dev',
        pathname: '/',
        search: '?embed=1&parentUrl=https%3A%2F%2Finkfinitystudio.store%2Fgame-room&room=482-910-375',
        href: 'https://chibi-ludo-3d.inkfintystudio-store.workers.dev/?embed=1&parentUrl=https%3A%2F%2Finkfinitystudio.store%2Fgame-room&room=482-910-375',
      },
    });
    try {
      expect(isEmbeddedInIframe()).toBe(true);
      expect(buildStandaloneAppUrl()).toBe('https://chibi-ludo-3d.inkfintystudio-store.workers.dev/?room=482910375');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('supports selectable simulation speeds (1x, 1.25x, 1.5x, 2x)', () => {
    expect(SIMULATION_SPEEDS).toEqual([1, 1.25, 1.5, 2]);
    const store = useGameStore.getState();
    store.startMatch({ mode: '4P_FFA', simulation: true, simulationSpeed: 1.5, room: null });
    expect(useGameStore.getState().simulation).toBe(true);
    expect(useGameStore.getState().simulationSpeed).toBe(1.5);

    store.setSimulationSpeed(2);
    expect(useGameStore.getState().simulationSpeed).toBe(2);
    store.setSimulationSpeed(1);
    expect(useGameStore.getState().simulationSpeed).toBe(1);
  });

  it('enforces a 5-second cooldown and lets each GIF play its full timeline without a duration cap', () => {
    vi.useFakeTimers();
    const store = useGameStore.getState();
    store.startMatch({ mode: '2P_COUPLES', vsAi: true, room: null });

    expect(EMOTE_COOLDOWN_MS).toBe(5000);
    expect(store.sendEmote('dogdance')).toBe(true);
    const firstOverlay = useGameStore.getState().yardEmotes.PINK;
    expect(firstOverlay?.emote).toBe('dogdance');
    // Full 12s GIF duration is preserved with no artificial 3s cap.
    expect(firstOverlay!.expiresAt - firstOverlay!.startedAt).toBe(12000);

    // Second send within 5s cooldown is blocked.
    vi.advanceTimersByTime(3000);
    expect(store.sendEmote('angry')).toBe(false);
    expect(useGameStore.getState().yardEmotes.PINK?.emote).toBe('dogdance');

    // After full 5000ms cooldown, another GIF can be sent cleanly.
    vi.advanceTimersByTime(2000);
    expect(store.sendEmote('dogsuspect')).toBe(true);
    const secondOverlay = useGameStore.getState().yardEmotes.PINK;
    expect(secondOverlay?.emote).toBe('dogsuspect');
    expect(secondOverlay!.expiresAt - secondOverlay!.startedAt).toBe(7400);
  });

  it('registers all 16 reaction emotes in protocol, media list, and room emote validation', () => {
    expect(ROOM_EMOTE_IDS).toHaveLength(16);
    expect(EMOTES.map((e) => e.id)).toEqual([...ROOM_EMOTE_IDS]);

    let room = createRoomRecord('333444555', '2P_COUPLES');
    room = joinRoom(room, 'host-1', 'Aman');
    for (const id of ROOM_EMOTE_IDS) {
      const res = handleRoomAction(room, 'host-1', { type: 'emote', emote: id });
      expect(res.broadcast).toEqual([{ type: 'emote', emote: id, fromTeam: 'PINK' }]);
    }
  });

  it('auto-rolls after 20s of inactivity (and auto-moves if stalled in MOVE) while syncing presence', () => {
    const t0 = 1_700_000_000_000;
    expect(TURN_TIMEOUT_MS).toBe(20_000);

    let room = createRoomRecord('666777888', '2P_COUPLES');
    room = joinRoom(room, 'host-1', 'Aman', t0);
    room = joinRoom(room, 'guest-2', 'Priya', t0 + 500);
    room = handleRoomAction(room, 'host-1', { type: 'start', mode: '2P_COUPLES' }, Math.random, t0 + 1000).record;

    // Presence is tracked on every seat throughout the game.
    expect(snapshotForPlayer(room, 'host-1', t0 + 1000).seats.every((s) => s.connected)).toBe(true);
    room = disconnectPlayer(room, 'guest-2', t0 + 2000);
    expect(snapshotForPlayer(room, 'host-1', t0 + 2000).seats.find((s) => s.team === 'YELLOW')?.connected).toBe(false);
    room = joinRoom(room, 'guest-2', 'Priya', t0 + 3000);
    expect(snapshotForPlayer(room, 'host-1', t0 + 3000).seats.find((s) => s.team === 'YELLOW')?.connected).toBe(true);

    // Before 20s deadline, handleTurnTimeout does nothing.
    expect(handleTurnTimeout(room, t0 + 1000 + TURN_TIMEOUT_MS - 1)).toBeNull();

    // At 20s deadline in ROLL phase, server auto-rolls a 6 (random=0.99) -> enters MOVE phase with a fresh 20s deadline.
    const autoRoll = handleTurnTimeout(room, t0 + 1000 + TURN_TIMEOUT_MS, () => 0.99);
    expect(autoRoll).not.toBeNull();
    room = autoRoll!.record;
    expect(autoRoll!.broadcast[0]).toMatchObject({
      type: 'roll',
      value: 6,
      team: 'PINK',
      turnRemainingMs: TURN_TIMEOUT_MS,
    });
    expect(room.game.phase).toBe('MOVE');

    // If the player still doesn't pick a pawn for another 20s, handleTurnTimeout picks a legal move automatically.
    const autoMove = handleTurnTimeout(room, t0 + 1000 + TURN_TIMEOUT_MS * 2);
    expect(autoMove).not.toBeNull();
    room = autoMove!.record;
    expect(autoMove!.broadcast[0]).toMatchObject({
      type: 'move',
      team: 'PINK',
      turnRemainingMs: TURN_TIMEOUT_MS,
    });
    expect(room.game.phase).toBe('ROLL');
  });

  it('tracks turnDeadlineAt in gameStore for both local matches and remote snapshots', () => {
    vi.useFakeTimers();
    const t0 = 1_700_000_000_000;
    vi.setSystemTime(t0);

    const store = useGameStore.getState();
    store.startMatch({ mode: '2P_COUPLES', vsAi: true, room: null });
    expect(useGameStore.getState().turnDeadlineAt).toBe(t0 + TURN_TIMEOUT_MS);

    // Pausing clears local deadline; resuming restores a fresh 20s deadline.
    store.setPaused(true);
    expect(useGameStore.getState().turnDeadlineAt).toBeNull();
    vi.advanceTimersByTime(5000);
    store.setPaused(false);
    expect(useGameStore.getState().turnDeadlineAt).toBe(t0 + 5000 + TURN_TIMEOUT_MS);

    // Remote snapshot with turnRemainingMs syncs client deadline cleanly.
    let room = createRoomRecord('999000111', '2P_COUPLES');
    room = joinRoom(room, 'host-1', 'Aman', t0);
    room = joinRoom(room, 'guest-2', 'Priya', t0);
    room = handleRoomAction(room, 'host-1', { type: 'start', mode: '2P_COUPLES' }, Math.random, t0).record;
    store.syncRoomSnapshot(snapshotForPlayer(room, 'host-1', t0 + 4000));
    expect(useGameStore.getState().turnDeadlineAt).toBe(t0 + 5000 + (TURN_TIMEOUT_MS - 4000));
  });

  it('preserves full uncropped natural aspect ratios for all reaction GIFs', () => {
    expect(getEmoteAspect('minionkiss')).toBeCloseTo(200 / 112, 4);
    expect(getEmoteAspect('dogbeach')).toBeCloseTo(192 / 128, 4);
    expect(getEmoteAspect('grumpy')).toBeCloseTo(200 / 266, 4);
    expect(getEmoteAspect('dogdance')).toBeCloseTo(192 / 240, 4);
    expect(getEmoteAspect('laugh')).toBe(1);
    expect(getEmoteAspect('doghands')).toBe(1);
    expect(getEmoteAspect('dogshock')).toBeCloseTo(200 / 170, 4);
    expect(getEmoteAspect('sadhamster')).toBe(1);
    expect(getEmoteAspect('huskydance')).toBeCloseTo(498 / 332, 4);
  });

  it('waits 15s on disconnected player 1st chance, activates AI bot on 2nd chance, and resumes from bot state on reconnect', () => {
    const t0 = 1_700_000_000_000;
    expect(DISCONNECTED_TURN_WAIT_MS).toBe(15_000);

    let room = createRoomRecord('555666777', '2P_COUPLES');
    room = joinRoom(room, 'host-1', 'Aman', t0, 'device-host');
    room = joinRoom(room, 'guest-2', 'Priya', t0 + 200, 'device-guest');
    room = handleRoomAction(room, 'host-1', { type: 'start', mode: '2P_COUPLES' }, Math.random, t0 + 500).record;

    // Guest leaves/disconnects during Host's turn.
    room = disconnectPlayer(room, 'guest-2', t0 + 1000);
    expect(room.seats.find((s) => s.team === 'YELLOW')?.connected).toBe(false);
    expect(room.seats.find((s) => s.team === 'YELLOW')?.botTakeover).toBe(false);

    // Host rolls a 2 (NO_MOVES) -> turn passes to disconnected Guest (1st chance).
    const hostRoll = handleRoomAction(room, 'host-1', { type: 'roll' }, () => 0.2, t0 + 2000);
    room = hostRoll.record;
    expect(room.game.currentTeam).toBe('YELLOW');
    // Server waits 15s for Guest's 1st chance before missing it.
    expect(room.turnDeadlineAt).toBe(t0 + 2000 + DISCONNECTED_TURN_WAIT_MS);
    expect(handleTurnTimeout(room, t0 + 2000 + DISCONNECTED_TURN_WAIT_MS - 1)).toBeNull();

    // At 15s, Guest misses 1st chance: turn skips back to Host and AI bot takeover activates for 2nd+ chances.
    const missedFirst = handleTurnTimeout(room, t0 + 2000 + DISCONNECTED_TURN_WAIT_MS);
    expect(missedFirst).not.toBeNull();
    expect(missedFirst!.broadcastSnapshots).toBe(true);
    room = missedFirst!.record;
    expect(room.game.currentTeam).toBe('PINK');
    expect(room.game.phase).toBe('ROLL');
    expect(room.seats.find((s) => s.team === 'YELLOW')).toMatchObject({
      occupant: 'human',
      connected: false,
      missedTurns: 1,
      botTakeover: true,
    });

    // Host rolls a 2 (NO_MOVES) -> turn returns to Guest (2nd chance!).
    room = handleRoomAction(room, 'host-1', { type: 'roll' }, () => 0.2, t0 + 20_000).record;
    expect(room.game.currentTeam).toBe('YELLOW');
    expect(room.turnDeadlineAt).toBe(t0 + 20_000 + BOT_TURN_FALLBACK_MS);

    // Host now drives Guest's AI bot turn (rolls 6 and spawns YELLOW-0).
    const botRoll = handleRoomAction(room, 'host-1', { type: 'roll' }, () => 0.99, t0 + 20_500);
    expect(botRoll.broadcast[0]).toMatchObject({ type: 'roll', value: 6, team: 'YELLOW' });
    room = botRoll.record;
    expect(room.game.phase).toBe('MOVE');

    const botMove = handleRoomAction(room, 'host-1', { type: 'move', pawnId: 'YELLOW-0' }, Math.random, t0 + 21_000);
    expect(botMove.broadcast[0]).toMatchObject({ type: 'move', pawnId: 'YELLOW-0', team: 'YELLOW' });
    room = botMove.record;
    // Bot earned bonus roll on 6 and YELLOW-0 is now on the track (progress 0).
    expect(room.game.currentTeam).toBe('YELLOW');
    expect(room.game.phase).toBe('ROLL');
    expect(room.game.pawns.find((p) => p.id === 'YELLOW-0')?.progress).toBe(0);

    // Guest reconnects (even from a fresh tab using same deviceId): AI bot stops and Guest resumes from bot's state!
    const rejoin = handleRoomAction(
      room,
      'guest-2-newtab',
      { type: 'join', playerId: 'guest-2-newtab', name: 'Priya', deviceId: 'device-guest' },
      Math.random,
      t0 + 25_000,
    );
    room = rejoin.record;
    const yellowSeat = room.seats.find((s) => s.team === 'YELLOW');
    expect(yellowSeat).toMatchObject({
      occupant: 'human',
      playerId: 'guest-2-newtab',
      connected: true,
    });
    expect(yellowSeat?.botTakeover).toBeUndefined();
    expect(yellowSeat?.missedTurns).toBeUndefined();
    // Exact progress left by AI bot is preserved and Guest gets full turn timer to continue.
    expect(room.game.pawns.find((p) => p.id === 'YELLOW-0')?.progress).toBe(0);
    expect(room.turnDeadlineAt).toBe(t0 + 25_000 + TURN_TIMEOUT_MS);

    // Host can no longer act for Guest once Guest reconnected; Guest controls their own turn again.
    const hostBlocked = handleRoomAction(room, 'host-1', { type: 'roll' }, () => 0.5, t0 + 25_500);
    expect(hostBlocked.reply).toEqual({ type: 'error', message: 'Not your turn to roll.' });
    const guestRoll = handleRoomAction(room, 'guest-2-newtab', { type: 'roll' }, () => 0.2, t0 + 26_000);
    expect(guestRoll.broadcast[0]).toMatchObject({ type: 'roll', team: 'YELLOW' });
  });

  it('allows a player in a 4-player match to leave mid-game and rejoin via link from any browser to resume after AI takeover', () => {
    const t0 = 1_700_100_000_000;
    let room = createRoomRecord('777888999', '4P_FFA');
    room = joinRoom(room, 'p1', 'Aman', t0, 'dev-1');
    room = joinRoom(room, 'p2', 'Neha', t0 + 100, 'dev-2');
    room = joinRoom(room, 'p3', 'Rohan', t0 + 200, 'dev-3');
    room = joinRoom(room, 'p4', 'Kiran', t0 + 300, 'dev-4');
    room = handleRoomAction(room, 'p1', { type: 'start', mode: '4P_FFA' }, Math.random, t0 + 400).record;

    // Player 2 (CYAN / Neha) leaves mid-game -> AI takeover activates cleanly.
    room = handleRoomAction(room, 'p2', { type: 'leave' }, Math.random, t0 + 1000).record;
    expect(room.seats.find((s) => s.team === 'CYAN')?.connected).toBe(false);
    // Simulate AI having already played CYAN's piece onto track (progress 12).
    room = {
      ...room,
      seats: room.seats.map((s) => (s.team === 'CYAN' ? { ...s, botTakeover: true, missedTurns: 1 } : s)),
      game: place(room.game, { 'CYAN-0': 12 }),
    };

    // Player opens the room link in another browser (different playerId & deviceId) and reclaims their exact seat.
    room = joinRoom(room, 'p2-mobile-chrome', 'neha', t0 + 5000, 'dev-different');
    const cyanSeat = room.seats.find((s) => s.team === 'CYAN');
    expect(cyanSeat).toMatchObject({
      occupant: 'human',
      playerId: 'p2-mobile-chrome',
      connected: true,
    });
    expect(cyanSeat?.botTakeover).toBeUndefined();
    expect(room.game.pawns.find((p) => p.id === 'CYAN-0')?.progress).toBe(12);

    // Even if only 1 human is disconnected and rejoins with a blank/default name, they still reclaim their seat.
    room = leaveRoom(room, 'p2-mobile-chrome', t0 + 6000);
    room = joinRoom(room, 'p2-webview', undefined, t0 + 7000, 'dev-webview');
    expect(room.seats.find((s) => s.team === 'CYAN')).toMatchObject({
      playerId: 'p2-webview',
      connected: true,
    });
  });

  it('prevents an authenticated account from hijacking another authenticated player seat by name', () => {
    const t0 = 1_700_150_000_000;
    let room = createRoomRecord('555666777', '2P_COUPLES');
    room = joinRoom(room, 'acct:host-uid', 'Aman', t0, 'dev-1');
    room = joinRoom(room, 'acct:victim-uid', 'Neha', t0 + 100, 'dev-2');
    room = handleRoomAction(room, 'acct:host-uid', { type: 'start', mode: '2P_COUPLES' }, Math.random, t0 + 200).record;

    // Victim disconnects; attacker joins with the exact same display name.
    room = disconnectPlayer(room, 'acct:victim-uid', t0 + 500);
    room = joinRoom(room, 'acct:attacker-uid', 'Neha', t0 + 1000, 'dev-2');

    // Victim's seat must remain bound to acct:victim-uid and NOT be given to acct:attacker-uid.
    expect(room.seats.find((s) => s.team === 'YELLOW')?.playerId).toBe('acct:victim-uid');
    expect(snapshotForPlayer(room, 'acct:attacker-uid').yourTeam).toBeNull();

    // Victim reconnecting with their own verified account reclaims their seat cleanly.
    room = joinRoom(room, 'acct:victim-uid', 'Neha', t0 + 1500, 'dev-other');
    expect(room.seats.find((s) => s.team === 'YELLOW')).toMatchObject({
      playerId: 'acct:victim-uid',
      connected: true,
    });
  });

  it('auto-closes finished Play With Friends rooms after 1 minute unless reset beforehand', () => {
    const t0 = 1_700_200_000_000;
    expect(GAME_OVER_ROOM_CLOSE_MS).toBe(60_000);

    let room = createRoomRecord('999000111', '2P_COUPLES');
    room = joinRoom(room, 'host-1', 'Aman', t0, 'dev-host');
    room = joinRoom(room, 'guest-2', 'Priya', t0 + 100, 'dev-guest');
    room = handleRoomAction(room, 'host-1', { type: 'start', mode: '2P_COUPLES' }, Math.random, t0 + 200).record;

    // Put PINK 1 step away from finishing all 4 pawns in Home.
    room = {
      ...room,
      game: {
        ...place(room.game, { 'PINK-0': 56, 'PINK-1': 56, 'PINK-2': 56, 'PINK-3': 55 }),
        currentTeam: 'PINK',
        phase: 'MOVE',
        dice: 1,
      },
      legalMoves: ['PINK-3'],
    };

    const winAction = handleRoomAction(room, 'host-1', { type: 'move', pawnId: 'PINK-3' }, Math.random, t0 + 1000);
    room = winAction.record;
    expect(winAction.broadcastSnapshots).toBe(true);
    expect(room.game.phase).toBe('GAME_OVER');
    expect(room.closeAt).toBe(t0 + 1000 + 60_000);
    expect(snapshotForPlayer(room, 'host-1', t0 + 11_000).roomCloseRemainingMs).toBe(50_000);

    expect(isRoomClosedAfterGameOver(room, t0 + 60_999)).toBe(false);
    expect(isRoomExpired(room, t0 + 60_999)).toBe(false);
    expect(isRoomClosedAfterGameOver(room, t0 + 61_000)).toBe(true);
    expect(isRoomExpired(room, t0 + 61_000)).toBe(true);

    // Host hitting Play Again before 1 minute expires clears the pending auto-close timer.
    const resetRes = handleRoomAction(room, 'host-1', { type: 'reset' }, Math.random, t0 + 15_000);
    expect(resetRes.record.closeAt).toBeUndefined();
    expect(resetRes.record.game.phase).toBe('ROLL');
    expect(isRoomClosedAfterGameOver(resetRes.record, t0 + 90_000)).toBe(false);
  });

  it('recovers cleanly when a remote roll mismatches phase without leaving the queue or dice stuck', () => {
    const store = useGameStore.getState();
    const baseGame = createGame('2P_COUPLES');
    store.syncRoomSnapshot({
      code: '123456789',
      mode: '2P_COUPLES',
      hostId: 'host-1',
      started: true,
      seats: [
        { team: 'PINK', occupant: 'human', playerId: 'host-1', connected: true, label: 'Pink (Host)' },
        { team: 'YELLOW', occupant: 'human', playerId: 'guest-2', connected: true, label: 'Yellow' },
      ],
      game: baseGame,
      legalMoves: [],
      seq: 1,
      turnRemainingMs: 18_000,
      yourPlayerId: 'host-1',
      yourTeam: 'PINK',
      isHost: true,
    });

    // Inject a mismatched remote roll without embedded game snapshot (wrong team for seq 2).
    useGameStore.getState().playRemoteRoll(4, { team: 'YELLOW', seq: 2 });
    expect(useGameStore.getState().waitingRollAck).toBe(false);
    expect(useGameStore.getState().isAnimating).toBe(false);

    // Subsequent authoritative snapshot at seq 3 must apply immediately and not remain blocked by stale queue items.
    const yellowTurnGame: GameState = { ...baseGame, currentTeam: 'YELLOW', phase: 'ROLL', dice: 2 };
    useGameStore.getState().syncRoomSnapshot({
      code: '123456789',
      mode: '2P_COUPLES',
      hostId: 'host-1',
      started: true,
      seats: [
        { team: 'PINK', occupant: 'human', playerId: 'host-1', connected: true, label: 'Pink (Host)' },
        { team: 'YELLOW', occupant: 'human', playerId: 'guest-2', connected: true, label: 'Yellow' },
      ],
      game: yellowTurnGame,
      legalMoves: [],
      seq: 3,
      turnRemainingMs: 19_000,
      yourPlayerId: 'host-1',
      yourTeam: 'PINK',
      isHost: true,
    });

    expect(useGameStore.getState().game.currentTeam).toBe('YELLOW');
    expect(useGameStore.getState().isAnimating).toBe(false);
    useGameStore.getState().exitToHome();
  });

  it('closes private rooms automatically when all players leave the game or disconnect', () => {
    const t0 = 1_700_300_000_000;

    // 1. Lobby: stays open while at least one player remains, closes when the last player leaves.
    let lobby = createRoomRecord('111222333', '4P_FFA');
    lobby = joinRoom(lobby, 'host-1', 'Aman', t0, 'dev-host');
    lobby = joinRoom(lobby, 'guest-2', 'Priya', t0 + 100, 'dev-guest');

    const firstLobbyLeave = handleRoomAction(lobby, 'guest-2', { type: 'leave' }, Math.random, t0 + 200);
    expect(firstLobbyLeave.closeRoom).toBe(false);
    expect(firstLobbyLeave.persist).toBe(true);

    const lastLobbyLeave = handleRoomAction(firstLobbyLeave.record, 'host-1', { type: 'leave' }, Math.random, t0 + 300);
    expect(lastLobbyLeave.closeRoom).toBe(true);
    expect(lastLobbyLeave.persist).toBe(false);

    // 2. Started game with multiple humans: stays open while one human remains, closes when the last human leaves.
    let started = createRoomRecord('444555666', '4P_FFA');
    started = joinRoom(started, 'host-1', 'Aman', t0, 'dev-host');
    started = joinRoom(started, 'guest-2', 'Priya', t0 + 100, 'dev-guest');
    started = handleRoomAction(started, 'host-1', { type: 'start', mode: '4P_FFA' }, Math.random, t0 + 200).record;

    const firstGameLeave = handleRoomAction(started, 'guest-2', { type: 'leave' }, Math.random, t0 + 300);
    expect(firstGameLeave.closeRoom).toBe(false);
    expect(firstGameLeave.persist).toBe(true);
    expect(firstGameLeave.broadcastSnapshots).toBe(true);

    const lastGameLeave = handleRoomAction(firstGameLeave.record, 'host-1', { type: 'leave' }, Math.random, t0 + 400);
    expect(lastGameLeave.closeRoom).toBe(true);
    expect(lastGameLeave.persist).toBe(false);
    expect(lastGameLeave.broadcastSnapshots).toBe(false);

    // 3. Started game with 1 human + AI bots: closes immediately when that human leaves.
    let soloStarted = createRoomRecord('777888999', '4P_FFA');
    soloStarted = joinRoom(soloStarted, 'host-1', 'Aman', t0, 'dev-host');
    soloStarted = handleRoomAction(soloStarted, 'host-1', { type: 'start', mode: '4P_FFA' }, Math.random, t0 + 200).record;

    const soloLeave = handleRoomAction(soloStarted, 'host-1', { type: 'leave' }, Math.random, t0 + 300);
    expect(soloLeave.closeRoom).toBe(true);
    expect(soloLeave.persist).toBe(false);

    // 4. Unexpected disconnects (closing tabs without clicking Leave): room stays open for reconnect grace, then expires.
    let abandoned = disconnectPlayer(started, 'host-1', t0 + 500);
    abandoned = disconnectPlayer(abandoned, 'guest-2', t0 + 600);
    abandoned = { ...abandoned, lastActiveAt: t0 + 600 };

    expect(isRoomClosedWhenEmpty(abandoned, t0 + 600 + EMPTY_ROOM_CLOSE_MS - 1)).toBe(false);
    expect(isRoomExpired(abandoned, t0 + 600 + EMPTY_ROOM_CLOSE_MS - 1)).toBe(false);
    expect(isRoomClosedWhenEmpty(abandoned, t0 + 600 + EMPTY_ROOM_CLOSE_MS)).toBe(true);
    expect(isRoomExpired(abandoned, t0 + 600 + EMPTY_ROOM_CLOSE_MS)).toBe(true);
    expect(isRoomCodeOccupied(abandoned, t0 + 600 + EMPTY_ROOM_CLOSE_MS)).toBe(false);
  });
});
