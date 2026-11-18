import { create } from 'zustand';
import type { RoomEmoteId } from './multiplayerProtocol';

export const STAKE_TIERS = [0, 50, 100, 250, 500, 1000] as const;
export type StakeTier = (typeof STAKE_TIERS)[number];
export const MIN_FRIENDS_STAKE = 100;
export const FRIENDS_STAKE_TIERS = [100, 250, 500, 1000] as const;
export type FriendsStakeTier = (typeof FRIENDS_STAKE_TIERS)[number];

export const STARTING_COINS = 500;
export const MAX_AD_SPINS_PER_DAY = 3;
export const FREE_SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const HOUSE_RAKE_RATE = 0.1;
export const STREAK_REWARDS = [100, 150, 250, 350, 500, 750, 1000] as const;
export const RESCUE_COINS = 100;
export const MAX_RESCUES_PER_DAY = 3;

const FREE_EMOTES = new Set<RoomEmoteId>(['laugh', 'loading', 'wave', 'grumpy', 'angry']);
const PREMIUM_EMOTE_COST = 15;
const STORAGE_KEY = 'chibi_ludo_wallet_v1';

export function getEmoteCost(emoteId: RoomEmoteId): number {
  return FREE_EMOTES.has(emoteId) ? 0 : PREMIUM_EMOTE_COST;
}

export function isValidStakeTier(value: number): value is StakeTier {
  return (STAKE_TIERS as readonly number[]).includes(value);
}

export function isValidFriendsStakeTier(value: number): value is FriendsStakeTier {
  return (FRIENDS_STAKE_TIERS as readonly number[]).includes(value);
}

/**
 * Computes each winner's coin payout from the match pot after a 10% coin sink.
 * Returns 0 for free/friendly matches.
 */
export function calculateMatchPayout(
  stakePerPlayer: number,
  playerCount: number,
  winnerCount = 1,
): number {
  if (stakePerPlayer <= 0 || playerCount <= 0 || winnerCount <= 0) return 0;
  const pot = stakePerPlayer * playerCount;
  const netPot = pot - Math.floor(pot * HOUSE_RAKE_RATE);
  return Math.floor(netPot / winnerCount);
}

/**
 * Computes placement payout:
 * - 2P or 2v2: 1st place / winning team takes 100% of net pot (split among winners).
 * - 3P / 4P FFA: 1st place takes 65% of net pot, 2nd place takes 35% of net pot.
 */
export function calculatePlacementPayout(
  stakePerPlayer: number,
  playerCount: number,
  rank: number,
  winnerCount = 1,
  is2v2 = false,
): number {
  if (stakePerPlayer <= 0 || playerCount <= 0 || rank < 1) return 0;
  const pot = stakePerPlayer * playerCount;
  const netPot = pot - Math.floor(pot * HOUSE_RAKE_RATE);
  if (is2v2 || playerCount <= 2) {
    return rank === 1 ? Math.floor(netPot / Math.max(1, winnerCount)) : 0;
  }
  if (rank === 1) return Math.floor((netPot * 65) / 100);
  if (rank === 2) return netPot - Math.floor((netPot * 65) / 100);
  return 0;
}

export interface WalletPersisted {
  balance: number;
  lastFreeSpinAt: number;
  adSpinsUsedToday: number;
  adSpinsDayKey: string;
  lastStreakClaimAt: number;
  streakDay: number;
  rescueUsedToday: number;
  rescueDayKey: string;
}

function getDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function getStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } | null {
  const g = globalThis as { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } };
  return g.localStorage ?? null;
}

function loadWallet(): WalletPersisted {
  const today = getDayKey();
  const defaults: WalletPersisted = {
    balance: STARTING_COINS,
    lastFreeSpinAt: 0,
    adSpinsUsedToday: 0,
    adSpinsDayKey: today,
    lastStreakClaimAt: 0,
    streakDay: 0,
    rescueUsedToday: 0,
    rescueDayKey: today,
  };
  const storage = getStorage();
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<WalletPersisted>;
    return {
      balance: typeof parsed.balance === 'number' && Number.isFinite(parsed.balance) && parsed.balance >= 0
        ? Math.floor(parsed.balance)
        : STARTING_COINS,
      lastFreeSpinAt: typeof parsed.lastFreeSpinAt === 'number' && Number.isFinite(parsed.lastFreeSpinAt)
        ? parsed.lastFreeSpinAt
        : 0,
      adSpinsUsedToday:
        parsed.adSpinsDayKey === today && typeof parsed.adSpinsUsedToday === 'number'
          ? Math.max(0, Math.floor(parsed.adSpinsUsedToday))
          : 0,
      adSpinsDayKey: today,
      lastStreakClaimAt: typeof parsed.lastStreakClaimAt === 'number' && Number.isFinite(parsed.lastStreakClaimAt)
        ? parsed.lastStreakClaimAt
        : 0,
      streakDay: typeof parsed.streakDay === 'number' && Number.isFinite(parsed.streakDay)
        ? Math.max(0, Math.min(6, Math.floor(parsed.streakDay)))
        : 0,
      rescueUsedToday:
        parsed.rescueDayKey === today && typeof parsed.rescueUsedToday === 'number'
          ? Math.max(0, Math.floor(parsed.rescueUsedToday))
          : 0,
      rescueDayKey: today,
    };
  } catch {
    return defaults;
  }
}

function saveWallet(state: WalletPersisted): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota / private mode errors.
  }
}

function pickPersisted(s: WalletPersisted): WalletPersisted {
  return {
    balance: s.balance,
    lastFreeSpinAt: s.lastFreeSpinAt,
    adSpinsUsedToday: s.adSpinsUsedToday,
    adSpinsDayKey: s.adSpinsDayKey,
    lastStreakClaimAt: s.lastStreakClaimAt,
    streakDay: s.streakDay,
    rescueUsedToday: s.rescueUsedToday,
    rescueDayKey: s.rescueDayKey,
  };
}

export interface WalletStore extends WalletPersisted {
  lastDelta: { id: number; amount: number } | null;
  canAfford: (amount: number) => boolean;
  deduct: (amount: number) => boolean;
  credit: (amount: number, txId?: string) => void;
  canFreeSpin: (now?: number) => boolean;
  remainingAdSpins: (now?: number) => number;
  recordSpin: (isFree: boolean, rewardCoins: number, now?: number) => void;
  canClaimStreak: (now?: number) => boolean;
  claimStreak: (now?: number) => number;
  remainingRescues: (now?: number) => number;
  claimRescue: (now?: number) => number;
  applyServerSnapshot: (server: Partial<WalletPersisted>) => void;
  resetForTest: (balance?: number) => void;
}

export type WalletServerAction = 'credit' | 'deduct' | 'spin' | 'claim-streak' | 'rescue';
export type WalletServerSyncHandler = (
  action: WalletServerAction,
  payload?: Record<string, unknown>,
) => void;

let serverSyncHandler: WalletServerSyncHandler | null = null;
let mutationEpoch = 0;

export function registerWalletServerSync(handler: WalletServerSyncHandler | null): void {
  serverSyncHandler = handler;
}

export function getWalletMutationEpoch(): number {
  return mutationEpoch;
}

const initial = loadWallet();
let deltaCounter = 1;

export const useWalletStore = create<WalletStore>((set, get) => ({
  ...initial,
  lastDelta: null,

  canAfford: (amount) => amount <= 0 || get().balance >= amount,

  deduct: (amount) => {
    const clean = Math.floor(amount);
    if (!Number.isFinite(clean) || clean < 0) return false;
    if (clean === 0) return true;
    const cur = get();
    if (cur.balance < clean) return false;
    const next: WalletPersisted = { ...pickPersisted(cur), balance: cur.balance - clean };
    mutationEpoch += 1;
    saveWallet(next);
    set({ ...next, lastDelta: { id: deltaCounter++, amount: -clean } });
    serverSyncHandler?.('deduct', { amount: clean });
    return true;
  },

  credit: (amount, txId) => {
    const clean = Math.floor(amount);
    if (!Number.isFinite(clean) || clean <= 0) return;
    const cur = get();
    const next: WalletPersisted = { ...pickPersisted(cur), balance: cur.balance + clean };
    mutationEpoch += 1;
    saveWallet(next);
    set({ ...next, lastDelta: { id: deltaCounter++, amount: clean } });
    serverSyncHandler?.('credit', txId ? { amount: clean, txId } : { amount: clean });
  },

  canFreeSpin: (now = Date.now()) => now - get().lastFreeSpinAt >= FREE_SPIN_COOLDOWN_MS,

  remainingAdSpins: (now = Date.now()) => {
    const today = getDayKey(now);
    const cur = get();
    const used = cur.adSpinsDayKey === today ? cur.adSpinsUsedToday : 0;
    return Math.max(0, MAX_AD_SPINS_PER_DAY - used);
  },

  recordSpin: (isFree, rewardCoins, now = Date.now()) => {
    const today = getDayKey(now);
    const cur = get();
    const used = cur.adSpinsDayKey === today ? cur.adSpinsUsedToday : 0;
    const reward = Math.max(0, Math.floor(rewardCoins));
    const next: WalletPersisted = {
      ...pickPersisted(cur),
      balance: cur.balance + reward,
      lastFreeSpinAt: isFree ? now : cur.lastFreeSpinAt,
      adSpinsUsedToday: isFree ? used : used + 1,
      adSpinsDayKey: today,
    };
    mutationEpoch += 1;
    saveWallet(next);
    set({ ...next, lastDelta: reward > 0 ? { id: deltaCounter++, amount: reward } : cur.lastDelta });
    serverSyncHandler?.('spin', { isFree, reward });
  },

  canClaimStreak: (now = Date.now()) => {
    const cur = get();
    if (cur.lastStreakClaimAt === 0) return true;
    return getDayKey(cur.lastStreakClaimAt) !== getDayKey(now);
  },

  claimStreak: (now = Date.now()) => {
    const cur = get();
    if (!get().canClaimStreak(now)) return 0;
    const missedDay = cur.lastStreakClaimAt > 0 && now - cur.lastStreakClaimAt > 48 * 60 * 60 * 1000;
    const dayIndex = missedDay ? 0 : cur.streakDay % STREAK_REWARDS.length;
    const reward = STREAK_REWARDS[dayIndex];
    const next: WalletPersisted = {
      ...pickPersisted(cur),
      balance: cur.balance + reward,
      lastStreakClaimAt: now,
      streakDay: (dayIndex + 1) % STREAK_REWARDS.length,
    };
    mutationEpoch += 1;
    saveWallet(next);
    set({ ...next, lastDelta: { id: deltaCounter++, amount: reward } });
    serverSyncHandler?.('claim-streak');
    return reward;
  },

  remainingRescues: (now = Date.now()) => {
    const today = getDayKey(now);
    const cur = get();
    const used = cur.rescueDayKey === today ? cur.rescueUsedToday : 0;
    return Math.max(0, MAX_RESCUES_PER_DAY - used);
  },

  claimRescue: (now = Date.now()) => {
    const cur = get();
    if (cur.balance >= 50 || get().remainingRescues(now) <= 0) return 0;
    const today = getDayKey(now);
    const used = cur.rescueDayKey === today ? cur.rescueUsedToday : 0;
    const next: WalletPersisted = {
      ...pickPersisted(cur),
      balance: cur.balance + RESCUE_COINS,
      rescueUsedToday: used + 1,
      rescueDayKey: today,
    };
    mutationEpoch += 1;
    saveWallet(next);
    set({ ...next, lastDelta: { id: deltaCounter++, amount: RESCUE_COINS } });
    serverSyncHandler?.('rescue');
    return RESCUE_COINS;
  },

  applyServerSnapshot: (server) => {
    const cur = get();
    const next: WalletPersisted = {
      ...pickPersisted(cur),
      ...server,
    };
    saveWallet(next);
    set(next);
  },

  resetForTest: (balance = STARTING_COINS) => {
    const today = getDayKey();
    const next: WalletPersisted = {
      balance,
      lastFreeSpinAt: 0,
      adSpinsUsedToday: 0,
      adSpinsDayKey: today,
      lastStreakClaimAt: 0,
      streakDay: 0,
      rescueUsedToday: 0,
      rescueDayKey: today,
    };
    saveWallet(next);
    set({ ...next, lastDelta: null });
  },
}));
