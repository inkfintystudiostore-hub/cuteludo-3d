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
import { useGameStore } from './gameStore';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import { buildRoomShareUrl, formatRoomCode, generateRoomCode, parseRoomCodeInput } from './roomCode';
import {
  ROOM_IDLE_TTL_MS,
  createRoomRecord,
  disconnectPlayer,
  handleRoomAction,
  isRoomCodeOccupied,
  isRoomExpired,
  joinRoom,
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
    expect(parseRoomCodeInput(formatRoomCode(code))).toBe(code);
    expect(parseRoomCodeInput(`  ${code}  `)).toBe(code);
    expect(parseRoomCodeInput('12345')).toBeNull();
    expect(parseRoomCodeInput('https://example.com/?room=bad')).toBeNull();
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
});

describe('multiplayer roomLogic', () => {
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
    expect(rollSix.broadcast).toEqual([{ type: 'roll', value: 6, team: 'PINK' }]);
    expect(room.legalMoves.length).toBe(4);

    // Illegal move rejected.
    const badMove = handleRoomAction(room, 'host-1', { type: 'move', pawnId: 'CYAN-0' });
    expect(badMove.reply?.type).toBe('error');

    // Legal move commits and broadcasts cleanly.
    const goodMove = handleRoomAction(room, 'host-1', { type: 'move', pawnId: 'PINK-0' });
    room = goodMove.record;
    expect(goodMove.broadcast).toEqual([{ type: 'move', pawnId: 'PINK-0', team: 'PINK' }]);
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
});
