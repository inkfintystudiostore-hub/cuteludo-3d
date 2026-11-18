import { DurableObject } from 'cloudflare:workers';
import {
  hashPassword,
  validatePassword,
  validateUsername,
  verifyPassword,
  type PublicAccount,
} from './authHelpers';

export {
  createSessionToken,
  extractBearerToken,
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifySessionToken,
  type PublicAccount,
  type SessionPayload,
} from './authHelpers';

interface StoredAccount extends PublicAccount {
  passwordHash: string;
  salt: string;
}

function toPublicAccount(acc: StoredAccount): PublicAccount {
  return {
    accountId: acc.accountId,
    username: acc.username,
    displayName: acc.displayName,
    walletId: acc.walletId,
    createdAt: acc.createdAt,
  };
}

export class AccountDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const existing = await this.ctx.storage.get<StoredAccount>('account');

    if (url.pathname === '/me' && request.method === 'GET') {
      if (!existing) {
        return Response.json({ ok: false, error: 'Account not found' }, { status: 404 });
      }
      return Response.json({ ok: true, account: toPublicAccount(existing) });
    }

    if (url.pathname === '/voice-blocks' && request.method === 'GET') {
      const blockedIds = (await this.ctx.storage.get<string[]>('voiceBlockedIds')) ?? [];
      return Response.json({ ok: true, blockedIds });
    }

    if (request.method !== 'POST') {
      return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    if (url.pathname === '/voice-blocks') {
      const raw = Array.isArray(body.blockedIds) ? body.blockedIds : [];
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (!trimmed || trimmed.length > 80 || seen.has(trimmed)) continue;
        seen.add(trimmed);
        cleaned.push(trimmed);
        if (cleaned.length >= 200) break;
      }
      await this.ctx.storage.put('voiceBlockedIds', cleaned);
      return Response.json({ ok: true, blockedIds: cleaned });
    }

    if (url.pathname === '/register') {
      if (existing) {
        return Response.json({ ok: false, error: 'That username is already taken.' }, { status: 409 });
      }
      const userCheck = validateUsername(String(body.username ?? ''));
      if (!userCheck.ok) {
        return Response.json({ ok: false, error: userCheck.error }, { status: 400 });
      }
      const passCheck = validatePassword(String(body.password ?? ''));
      if (!passCheck.ok) {
        return Response.json({ ok: false, error: passCheck.error }, { status: 400 });
      }
      const rawDisplay = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 18) : '';
      const displayName = rawDisplay || userCheck.username.slice(0, 18);
      const accountId = crypto.randomUUID();
      const { hash, salt } = await hashPassword(passCheck.password);
      const created: StoredAccount = {
        accountId,
        username: userCheck.username,
        displayName,
        walletId: `acct:${accountId}`,
        passwordHash: hash,
        salt,
        createdAt: Date.now(),
      };
      await this.ctx.storage.put('account', created);
      return Response.json({ ok: true, account: toPublicAccount(created) });
    }

    if (url.pathname === '/login') {
      if (!existing) {
        return Response.json({ ok: false, error: 'Invalid username or password.' }, { status: 401 });
      }
      const password = String(body.password ?? '');
      if (!password) {
        return Response.json({ ok: false, error: 'Password is required.' }, { status: 400 });
      }
      const valid = await verifyPassword(password, existing.salt, existing.passwordHash);
      if (!valid) {
        return Response.json({ ok: false, error: 'Invalid username or password.' }, { status: 401 });
      }
      return Response.json({ ok: true, account: toPublicAccount(existing) });
    }

    return Response.json({ ok: false, error: 'Unknown account route' }, { status: 404 });
  }
}
