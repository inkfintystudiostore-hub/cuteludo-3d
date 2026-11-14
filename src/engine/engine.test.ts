import { describe, expect, it } from 'vitest';
import {
  HOME_COLUMN_CELLS,
  SAFE_TRACK_INDICES,
  TEAM_IDS,
  TRACK_CELLS,
  YARD_SLOT_POSITIONS,
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
  pickSmartBotMove,
  rollDie,
  type GameState,
} from './ludoRules';
import { useGameStore } from './gameStore';
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

  it('requires an exact roll to enter Home and ends 2P when a team is all home', () => {
    const state = place(createGame('2P_COUPLES'), { 'PINK-0': 54, 'PINK-1': 56, 'PINK-2': 56, 'PINK-3': 56 });
    expect(applyRoll(state, 3).outcome).toBe('NO_MOVES');
    const home = applyMove(applyRoll(state, 2).state, 'PINK-0');
    expect(home.reachedHome).toBe(true);
    expect(home.finishedRank).toBe(1);
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
        const value = rollDie(random);
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
          if (move.bonusRoll) expect(keepsTurn).toBe(true);
          else if (move.state.activeTeams.length > 1) expect(keepsTurn && value !== 6 && move.captured.length === 0 && !isDone(move.state, roller)).toBe(false);
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
});

describe('multiplayer roomLogic', () => {
  it('assigns seats, prevents out-of-turn rolls, and runs authoritative moves', () => {
    let room = createRoomRecord('482910375', '4P_FFA');
    room = joinRoom(room, 'host-1');
    room = joinRoom(room, 'guest-2');

    const hostSnap = snapshotForPlayer(room, 'host-1');
    const guestSnap = snapshotForPlayer(room, 'guest-2');
    expect(hostSnap.yourTeam).toBe('PINK');
    expect(hostSnap.isHost).toBe(true);
    expect(guestSnap.yourTeam).toBe('CYAN');
    expect(guestSnap.isHost).toBe(false);

    // Host starts the game; empty Yellow & Mint seats become smart bots.
    const started = handleRoomAction(room, 'host-1', { type: 'start', mode: '4P_FFA' });
    room = started.record;
    expect(room.started).toBe(true);
    expect(room.seats.filter((s) => s.occupant === 'bot').map((s) => s.team)).toEqual(['YELLOW', 'MINT']);

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
});
