import { beforeEach, describe, expect, it } from 'vitest';
import {
  FREE_SPIN_COOLDOWN_MS,
  FRIENDS_STAKE_TIERS,
  MAX_AD_SPINS_PER_DAY,
  MIN_FRIENDS_STAKE,
  STARTING_COINS,
  calculateMatchPayout,
  calculatePlacementPayout,
  getEmoteCost,
  isValidFriendsStakeTier,
  isValidStakeTier,
  registerWalletServerSync,
  useWalletStore,
} from './walletStore';
import { createRoomRecord, handleRoomAction, type RoomRecord } from '../../worker/roomLogic';
import { TOTAL_NAME_COMBINATIONS, pickBotChatReply, pickBotEmote, pickRandomBotEmote, pickUniqueBotNames, pickBotGossipStory, BOT_GOSSIP_STORIES } from './botNames';
import { createGame } from './ludoRules';

describe('walletStore & economy math', () => {
  beforeEach(() => {
    useWalletStore.getState().resetForTest(STARTING_COINS);
  });

  it('deducts and credits coins safely without going negative', () => {
    const wallet = useWalletStore.getState();
    expect(wallet.balance).toBe(STARTING_COINS);
    expect(wallet.deduct(100)).toBe(true);
    expect(useWalletStore.getState().balance).toBe(400);
    expect(wallet.deduct(500)).toBe(false);
    expect(useWalletStore.getState().balance).toBe(400);
    wallet.credit(250);
    expect(useWalletStore.getState().balance).toBe(650);
  });

  it('computes match payouts with 10% rake and team split', () => {
    expect(calculateMatchPayout(0, 4, 1)).toBe(0);
    expect(calculateMatchPayout(100, 2, 1)).toBe(180);
    expect(calculateMatchPayout(100, 4, 1)).toBe(360);
    expect(calculateMatchPayout(100, 4, 2)).toBe(180);
  });

  it('charges less for premium GIF emotes than minimum wager and keeps basic emotes free', () => {
    expect(getEmoteCost('laugh')).toBe(0);
    expect(getEmoteCost('dogdance')).toBe(15);
    expect(getEmoteCost('dogdance')).toBeLessThan(50);
  });

  it('enforces daily free spin cooldown and 3 ad spins per day', () => {
    const t0 = Date.UTC(2026, 10, 18, 10, 0, 0);
    expect(useWalletStore.getState().canFreeSpin(t0)).toBe(true);
    useWalletStore.getState().recordSpin(true, 100, t0);
    expect(useWalletStore.getState().balance).toBe(600);
    expect(useWalletStore.getState().canFreeSpin(t0 + 1000)).toBe(false);
    expect(useWalletStore.getState().canFreeSpin(t0 + FREE_SPIN_COOLDOWN_MS)).toBe(true);

    for (let i = 0; i < MAX_AD_SPINS_PER_DAY; i++) {
      useWalletStore.getState().recordSpin(false, 50, t0 + i * 1000);
    }
    expect(useWalletStore.getState().remainingAdSpins(t0 + 5000)).toBe(0);
    expect(useWalletStore.getState().remainingAdSpins(t0 + FREE_SPIN_COOLDOWN_MS)).toBe(MAX_AD_SPINS_PER_DAY);
  });

  it('validates stake tiers and host set_stake in worker roomLogic', () => {
    expect(isValidStakeTier(100)).toBe(true);
    expect(isValidStakeTier(999)).toBe(false);

    const record: RoomRecord = {
      code: '123456789',
      mode: '2P_COUPLES',
      stake: 0,
      hostId: 'host-1',
      started: false,
      seats: [
        { team: 'PINK', occupant: 'human', playerId: 'host-1', label: 'Host', connected: true },
        { team: 'YELLOW', occupant: 'open', playerId: null, label: 'Waiting…', connected: false },
      ],
      game: createGame('2P_COUPLES'),
      legalMoves: [],
    };

    const guestAttempt = handleRoomAction(record, 'guest-1', { type: 'set_stake', stake: 250 });
    expect(guestAttempt.record.stake).toBe(0);

    const hostAttempt = handleRoomAction(record, 'host-1', { type: 'set_stake', stake: 250 });
    expect(hostAttempt.record.stake).toBe(250);
    expect(hostAttempt.broadcastSnapshots).toBe(true);

    // Friends rooms disallow free (0) and 50-coin stakes; minimum is 100 coins.
    expect(MIN_FRIENDS_STAKE).toBe(100);
    expect(FRIENDS_STAKE_TIERS).toEqual([100, 250, 500, 1000]);
    expect(isValidFriendsStakeTier(0)).toBe(false);
    expect(isValidFriendsStakeTier(50)).toBe(false);
    expect(isValidFriendsStakeTier(100)).toBe(true);

    const freshRoom = createRoomRecord('987654321', '2P_COUPLES');
    expect(freshRoom.stake).toBe(100);

    const freeReject = handleRoomAction(hostAttempt.record, 'host-1', { type: 'set_stake', stake: 0 });
    expect(freeReject.record.stake).toBe(250);
    const lowReject = handleRoomAction(hostAttempt.record, 'host-1', { type: 'set_stake', stake: 50 });
    expect(lowReject.record.stake).toBe(250);

    const startClamp = handleRoomAction(record, 'host-1', { type: 'start', mode: '2P_COUPLES', stake: 0 });
    expect(startClamp.record.stake).toBe(100);
  });

  it('splits 4P FFA payouts 65/35 and enforces daily streak and low-coin rescue', () => {
    expect(calculatePlacementPayout(100, 4, 1, 1, false)).toBe(234);
    expect(calculatePlacementPayout(100, 4, 2, 1, false)).toBe(126);
    expect(calculatePlacementPayout(100, 4, 3, 1, false)).toBe(0);
    expect(calculatePlacementPayout(100, 4, 1, 2, true)).toBe(180);

    const day1 = Date.UTC(2026, 10, 18, 9, 0, 0);
    expect(useWalletStore.getState().claimStreak(day1)).toBe(100);
    expect(useWalletStore.getState().claimStreak(day1 + 1000)).toBe(0);
    expect(useWalletStore.getState().claimStreak(day1 + 25 * 60 * 60 * 1000)).toBe(150);

    useWalletStore.getState().resetForTest(30);
    expect(useWalletStore.getState().claimRescue(day1)).toBe(100);
    expect(useWalletStore.getState().balance).toBe(130);
    expect(useWalletStore.getState().claimRescue(day1 + 1000)).toBe(0);
  });

  it('generates 10,000+ unique Asian/European bot names and contextual emotes', () => {
    expect(TOTAL_NAME_COMBINATIONS).toBeGreaterThanOrEqual(10_000);
    const names = pickUniqueBotNames(3, 'Aarav Sharma');
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names).not.toContain('Aarav Sharma');

    // Hard requirement: Winning situation & capture MUST ALWAYS use laughing GIF
    for (let i = 0; i < 20; i++) {
      expect(pickBotEmote('capture')).toBe('laugh');
      expect(pickBotEmote('home')).toBe('laugh');
      expect(pickBotEmote('win')).toBe('laugh');
      // Hard requirement: Piece captured MUST ALWAYS use crying GIF (sadhamster)
      expect(pickBotEmote('captured')).toBe('sadhamster');
    }

    expect(pickRandomBotEmote()).toBeTruthy();
    const reply = pickBotChatReply('hello bro', 'extrovert');
    expect(reply === null || reply.length > 2).toBe(true);

    // Gossip stories verification
    expect(BOT_GOSSIP_STORIES.length).toBeGreaterThanOrEqual(10);
    const story = pickBotGossipStory();
    expect(story.lines.length).toBeGreaterThanOrEqual(4);
    expect(story.lines.some((l) => l.speaker === 'A')).toBe(true);
    expect(story.lines.some((l) => l.speaker === 'B')).toBe(true);

    // Verify every gossip story concludes with voice chat / mic transition
    for (const s of BOT_GOSSIP_STORIES) {
      const lastLine = s.lines[s.lines.length - 1].text.toLowerCase();
      const secondLastLine = s.lines[s.lines.length - 2].text.toLowerCase();
      const mentionsVoiceOrMic =
        lastLine.includes('voice') ||
        lastLine.includes('mic') ||
        secondLastLine.includes('voice') ||
        secondLastLine.includes('mic');
      expect(mentionsVoiceOrMic).toBe(true);
    }
  });

  it('notifies registered server sync handler for wallet mutations', () => {
    const events: Array<{ action: string; payload?: Record<string, unknown> }> = [];
    registerWalletServerSync((action, payload) => events.push({ action, payload }));

    useWalletStore.getState().deduct(50);
    useWalletStore.getState().credit(250, 'pay_123');
    useWalletStore.getState().recordSpin(true, 100, Date.UTC(2026, 10, 18, 10, 0, 0));
    useWalletStore.getState().claimStreak(Date.UTC(2026, 10, 18, 10, 0, 0));
    useWalletStore.getState().resetForTest(20);
    useWalletStore.getState().claimRescue(Date.UTC(2026, 10, 18, 10, 0, 0));

    registerWalletServerSync(null);

    expect(events).toEqual([
      { action: 'deduct', payload: { amount: 50 } },
      { action: 'credit', payload: { amount: 250, txId: 'pay_123' } },
      { action: 'spin', payload: { isFree: true, reward: 100 } },
      { action: 'claim-streak', payload: undefined },
      { action: 'rescue', payload: undefined },
    ]);
  });
});
