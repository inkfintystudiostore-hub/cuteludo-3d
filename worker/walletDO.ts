import { DurableObject } from 'cloudflare:workers';
import {
  FREE_SPIN_COOLDOWN_MS,
  MAX_AD_SPINS_PER_DAY,
  MAX_RESCUES_PER_DAY,
  RESCUE_COINS,
  STARTING_COINS,
  STREAK_REWARDS,
  type WalletPersisted,
} from '../src/engine/walletStore';

interface StoredWallet extends WalletPersisted {
  creditedTxs: string[];
}

function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function defaultWallet(now = Date.now()): StoredWallet {
  const day = todayKey(now);
  return {
    balance: STARTING_COINS,
    lastFreeSpinAt: 0,
    adSpinsUsedToday: 0,
    adSpinsDayKey: day,
    lastStreakClaimAt: 0,
    streakDay: 0,
    rescueUsedToday: 0,
    rescueDayKey: day,
    creditedTxs: [],
  };
}

function publicWallet(w: StoredWallet): WalletPersisted {
  return {
    balance: w.balance,
    lastFreeSpinAt: w.lastFreeSpinAt,
    adSpinsUsedToday: w.adSpinsUsedToday,
    adSpinsDayKey: w.adSpinsDayKey,
    lastStreakClaimAt: w.lastStreakClaimAt,
    streakDay: w.streakDay,
    rescueUsedToday: w.rescueUsedToday,
    rescueDayKey: w.rescueDayKey,
  };
}

export class PlayerWalletDO extends DurableObject {
  private async load(now = Date.now()): Promise<StoredWallet> {
    const saved = await this.ctx.storage.get<StoredWallet>('wallet');
    const day = todayKey(now);
    if (!saved) {
      const fresh = defaultWallet(now);
      await this.ctx.storage.put('wallet', fresh);
      return fresh;
    }
    if (saved.adSpinsDayKey !== day) {
      saved.adSpinsDayKey = day;
      saved.adSpinsUsedToday = 0;
    }
    if (saved.rescueDayKey !== day) {
      saved.rescueDayKey = day;
      saved.rescueUsedToday = 0;
    }
    return saved;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    if (url.pathname === '/import' && request.method === 'POST') {
      const existing = await this.ctx.storage.get<StoredWallet>('wallet');
      if (existing) {
        return Response.json({ ok: true, alreadyExists: true, wallet: publicWallet(existing) });
      }
      let body: { wallet?: Partial<WalletPersisted> } = {};
      try {
        body = (await request.json()) as { wallet?: Partial<WalletPersisted> };
      } catch {
        // Ignore invalid JSON and fall back to default wallet.
      }
      const fresh = defaultWallet(now);
      const src = body.wallet;
      if (src && typeof src.balance === 'number' && Number.isFinite(src.balance) && src.balance >= 0) {
        fresh.balance = Math.floor(src.balance);
        if (typeof src.lastFreeSpinAt === 'number' && Number.isFinite(src.lastFreeSpinAt)) {
          fresh.lastFreeSpinAt = src.lastFreeSpinAt;
        }
        if (typeof src.adSpinsDayKey === 'string') {
          fresh.adSpinsDayKey = src.adSpinsDayKey;
        }
        if (typeof src.adSpinsUsedToday === 'number' && Number.isFinite(src.adSpinsUsedToday)) {
          fresh.adSpinsUsedToday = Math.max(0, Math.floor(src.adSpinsUsedToday));
        }
        if (typeof src.lastStreakClaimAt === 'number' && Number.isFinite(src.lastStreakClaimAt)) {
          fresh.lastStreakClaimAt = src.lastStreakClaimAt;
        }
        if (typeof src.streakDay === 'number' && Number.isFinite(src.streakDay)) {
          fresh.streakDay = Math.max(0, Math.min(6, Math.floor(src.streakDay)));
        }
        if (typeof src.rescueDayKey === 'string') {
          fresh.rescueDayKey = src.rescueDayKey;
        }
        if (typeof src.rescueUsedToday === 'number' && Number.isFinite(src.rescueUsedToday)) {
          fresh.rescueUsedToday = Math.max(0, Math.floor(src.rescueUsedToday));
        }
      }
      await this.ctx.storage.put('wallet', fresh);
      return Response.json({ ok: true, wallet: publicWallet(fresh) });
    }

    const wallet = await this.load(now);

    if (url.pathname === '/state' && request.method === 'GET') {
      return Response.json({ ok: true, wallet: publicWallet(wallet) });
    }

    if (request.method !== 'POST') {
      return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
    }

    if (url.pathname === '/migrate-out') {
      wallet.balance = 0;
      await this.ctx.storage.put('wallet', wallet);
      return Response.json({ ok: true, wallet: publicWallet(wallet) });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // Empty body allowed for actions without payload.
    }

    if (url.pathname === '/credit') {
      const amount = Math.floor(Number(body.amount ?? 0));
      const txId = typeof body.txId === 'string' ? body.txId.trim() : '';
      if (!Number.isFinite(amount) || amount <= 0) {
        return Response.json({ ok: false, error: 'Invalid credit amount' }, { status: 400 });
      }
      if (txId && wallet.creditedTxs.includes(txId)) {
        return Response.json({ ok: true, duplicate: true, wallet: publicWallet(wallet) });
      }
      wallet.balance += amount;
      if (txId) {
        wallet.creditedTxs = [...wallet.creditedTxs.slice(-99), txId];
      }
      await this.ctx.storage.put('wallet', wallet);
      return Response.json({ ok: true, wallet: publicWallet(wallet) });
    }

    if (url.pathname === '/deduct') {
      const amount = Math.floor(Number(body.amount ?? 0));
      if (!Number.isFinite(amount) || amount < 0) {
        return Response.json({ ok: false, error: 'Invalid deduct amount' }, { status: 400 });
      }
      if (wallet.balance < amount) {
        return Response.json({ ok: false, error: 'Insufficient coins', wallet: publicWallet(wallet) }, { status: 400 });
      }
      wallet.balance -= amount;
      await this.ctx.storage.put('wallet', wallet);
      return Response.json({ ok: true, wallet: publicWallet(wallet) });
    }

    if (url.pathname === '/spin') {
      const isFree = Boolean(body.isFree);
      const reward = Math.max(0, Math.min(1000, Math.floor(Number(body.reward ?? 0))));
      if (isFree) {
        if (now - wallet.lastFreeSpinAt < FREE_SPIN_COOLDOWN_MS) {
          return Response.json({ ok: false, error: 'Free spin not ready yet' }, { status: 400 });
        }
        wallet.lastFreeSpinAt = now;
      } else {
        if (wallet.adSpinsUsedToday >= MAX_AD_SPINS_PER_DAY) {
          return Response.json({ ok: false, error: 'Daily ad spins exhausted' }, { status: 400 });
        }
        wallet.adSpinsUsedToday += 1;
      }
      wallet.balance += reward;
      await this.ctx.storage.put('wallet', wallet);
      return Response.json({ ok: true, reward, wallet: publicWallet(wallet) });
    }

    if (url.pathname === '/claim-streak') {
      const day = todayKey(now);
      if (wallet.lastStreakClaimAt > 0 && todayKey(wallet.lastStreakClaimAt) === day) {
        return Response.json({ ok: false, error: 'Already claimed today' }, { status: 400 });
      }
      const missedDay = wallet.lastStreakClaimAt > 0 && now - wallet.lastStreakClaimAt > 48 * 60 * 60 * 1000;
      const idx = missedDay ? 0 : wallet.streakDay % STREAK_REWARDS.length;
      const reward = STREAK_REWARDS[idx];
      wallet.balance += reward;
      wallet.lastStreakClaimAt = now;
      wallet.streakDay = (idx + 1) % STREAK_REWARDS.length;
      await this.ctx.storage.put('wallet', wallet);
      return Response.json({ ok: true, reward, wallet: publicWallet(wallet) });
    }

    if (url.pathname === '/rescue') {
      if (wallet.balance >= 50) {
        return Response.json({ ok: false, error: 'Balance not low enough for rescue' }, { status: 400 });
      }
      if (wallet.rescueUsedToday >= MAX_RESCUES_PER_DAY) {
        return Response.json({ ok: false, error: 'Daily rescue limit reached' }, { status: 400 });
      }
      wallet.balance += RESCUE_COINS;
      wallet.rescueUsedToday += 1;
      await this.ctx.storage.put('wallet', wallet);
      return Response.json({ ok: true, reward: RESCUE_COINS, wallet: publicWallet(wallet) });
    }

    return Response.json({ ok: false, error: 'Unknown wallet route' }, { status: 404 });
  }
}

interface QueueSlot {
  code: string;
  createdAt: number;
  playersJoined: number;
  capacity: number;
}

export class MatchmakerDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
    }
    let body: { key?: string; capacity?: number; newCode?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    const key = body.key ?? '4P_FFA:0';
    const capacity = Math.max(2, Math.min(4, Number(body.capacity ?? 4)));
    const now = Date.now();
    const existing = await this.ctx.storage.get<QueueSlot>(key);

    if (existing && now - existing.createdAt < 90_000 && existing.playersJoined < existing.capacity) {
      existing.playersJoined += 1;
      if (existing.playersJoined >= existing.capacity) {
        await this.ctx.storage.delete(key);
      } else {
        await this.ctx.storage.put(key, existing);
      }
      return Response.json({ ok: true, code: existing.code, role: 'guest' as const });
    }

    const code = body.newCode;
    if (!code || !/^\d{9}$/.test(code)) {
      return Response.json({ ok: false, error: 'Missing room code' }, { status: 400 });
    }
    await this.ctx.storage.put(key, {
      code,
      createdAt: now,
      playersJoined: 1,
      capacity,
    } satisfies QueueSlot);
    return Response.json({ ok: true, code, role: 'host' as const });
  }
}
