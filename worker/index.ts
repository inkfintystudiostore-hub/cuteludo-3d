/**
 * Cloudflare Worker + Hibernatable SQLite Durable Object room server for Chibi Ludo 3D.
 * Serves the static Vite build via env.ASSETS and routes WebSocket rooms on /ws/room/:code.
 */
import { DurableObject } from 'cloudflare:workers';
import { type ClientMessage, type ServerMessage } from '../src/engine/multiplayerProtocol';
import type { GameMode } from '../src/engine/ludoRules';
import { handlePaymentRequest, type PaymentEnv } from './payments';
import { MatchmakerDO, PlayerWalletDO } from './walletDO';
import {
  AccountDO,
  createSessionToken,
  extractBearerToken,
  validateUsername,
  verifySessionToken,
  type PublicAccount,
} from './auth';
import { FIREBASE_PROJECT_ID, verifyFirebaseIdToken } from './firebaseAuth';
import { isValidStakeTier } from '../src/engine/walletStore';
import { MODE_TEAMS } from '../src/engine/ludoRules';

export { AccountDO, MatchmakerDO, PlayerWalletDO };
import {
  EMPTY_ROOM_CLOSE_MS,
  ROOM_IDLE_TTL_MS,
  computeTurnDeadlineAt,
  createRoomRecord,
  disconnectPlayer,
  handleRoomAction,
  handleTurnTimeout,
  hasConnectedHuman,
  isRoomClosedAfterGameOver,
  isRoomCodeOccupied,
  isRoomExpired,
  joinRoom,
  markDisconnectedIfMissingSockets,
  snapshotForPlayer,
  type RoomRecord,
} from './roomLogic';

interface Env extends PaymentEnv {
  ASSETS: Fetcher;
  LUDO_ROOM: DurableObjectNamespace<LudoRoomDO>;
  PLAYER_WALLET: DurableObjectNamespace<PlayerWalletDO>;
  MATCHMAKER: DurableObjectNamespace<MatchmakerDO>;
  PLAYER_ACCOUNT: DurableObjectNamespace<AccountDO>;
  AUTH_SECRET?: string;
}

interface SocketAttachment {
  playerId: string;
  leftExplicitly?: boolean;
}

const VALID_MODES = new Set<GameMode>(['2P_COUPLES', '3P_FFA', '4P_FFA', '2V2_TEAM']);
const MAX_WS_PAYLOAD_BYTES = 4096;
const FRAME_ANCESTORS_CSP =
  "frame-ancestors 'self' https://inkfinitystudio.store https://www.inkfinitystudio.store http://localhost:* http://127.0.0.1:*";

function randomRoomCode(): string {
  const min = 100_000_000;
  const max = 999_999_999;
  const span = max - min + 1;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(min + (buf[0] % span));
}

function withCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const roomMatch = url.pathname.match(/^\/ws\/room\/(\d{9})$/);

    if (roomMatch) {
      const upgrade = request.headers.get('Upgrade');
      if (upgrade?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const wsToken = url.searchParams.get('token')?.trim() ?? '';
      const claims = wsToken ? await verifyFirebaseIdToken(wsToken, FIREBASE_PROJECT_ID) : null;
      if (!claims) {
        return new Response('Sign in with Google to create or join a room', { status: 401 });
      }
      const code = roomMatch[1];
      const stub = env.LUDO_ROOM.get(env.LUDO_ROOM.idFromName(code));
      return stub.fetch(request);
    }

    if (url.pathname === '/api/rooms/reserve') {
      if (request.method === 'OPTIONS') {
        return withCorsHeaders(new Response(null, { status: 204 }));
      }
      if (request.method !== 'POST') {
        return withCorsHeaders(Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 }));
      }
      const reserveToken = extractBearerToken(request);
      const claims = reserveToken ? await verifyFirebaseIdToken(reserveToken, FIREBASE_PROJECT_ID) : null;
      if (!claims) {
        return withCorsHeaders(Response.json({ ok: false, error: 'Please sign in with Google to create a room.' }, { status: 401 }));
      }
      let requestedMode: GameMode = '4P_FFA';
      let candidate: string | null = null;
      try {
        const body = (await request.json()) as { mode?: GameMode; code?: string };
        if (body.mode && VALID_MODES.has(body.mode)) requestedMode = body.mode;
        if (body.code && /^\d{9}$/.test(body.code)) candidate = body.code;
      } catch {
        // Empty JSON body uses random code & default mode.
      }

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const code = attempt === 0 && candidate ? candidate : randomRoomCode();
        const stub = env.LUDO_ROOM.get(env.LUDO_ROOM.idFromName(code));
        const res = await stub.fetch(
          `https://internal/reserve?code=${code}&mode=${encodeURIComponent(requestedMode)}`,
          { method: 'POST' },
        );
        if (res.status === 200) {
          return withCorsHeaders(Response.json({ ok: true, code }));
        }
      }
      return withCorsHeaders(Response.json({ ok: false, error: 'Could not allocate unique room code' }, { status: 503 }));
    }

    if (url.pathname === '/api/health') {
      return withCorsHeaders(Response.json({ ok: true, service: 'chibi-ludo-do' }));
    }

    if (url.pathname === '/api/voice/blocks') {
      if (request.method === 'OPTIONS') {
        return withCorsHeaders(new Response(null, { status: 204 }));
      }
      const token = extractBearerToken(request);
      let walletId: string | null = null;
      if (token) {
        const session = await verifySessionToken(token, env.AUTH_SECRET);
        if (session?.walletId) {
          walletId = session.walletId;
        } else {
          const fbClaims = await verifyFirebaseIdToken(token, FIREBASE_PROJECT_ID);
          if (fbClaims?.uid) walletId = `acct:${fbClaims.uid}`;
        }
      }
      if (!walletId) {
        return withCorsHeaders(Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 }));
      }
      const voiceStub = env.PLAYER_ACCOUNT.get(env.PLAYER_ACCOUNT.idFromName(`voice:${walletId}`));
      if (request.method === 'GET') {
        const res = await voiceStub.fetch('https://internal/voice-blocks');
        return withCorsHeaders(Response.json(await res.json(), { status: res.status }));
      }
      if (request.method === 'POST') {
        const res = await voiceStub.fetch('https://internal/voice-blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await request.text(),
        });
        return withCorsHeaders(Response.json(await res.json(), { status: res.status }));
      }
      return withCorsHeaders(Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 }));
    }

    if (url.pathname.startsWith('/api/payments/')) {
      if (request.method === 'OPTIONS') {
        return withCorsHeaders(new Response(null, { status: 204 }));
      }
      const paymentRes = await handlePaymentRequest(request, url, env);
      if (paymentRes) return withCorsHeaders(paymentRes);
    }

    if (url.pathname.startsWith('/api/auth/')) {
      if (request.method === 'OPTIONS') {
        return withCorsHeaders(new Response(null, { status: 204 }));
      }
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const token = extractBearerToken(request);
        const session = token ? await verifySessionToken(token, env.AUTH_SECRET) : null;
        if (!session) {
          return withCorsHeaders(Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 }));
        }
        const walletStub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(session.walletId));
        const walletRes = await walletStub.fetch('https://internal/state');
        const walletJson = (await walletRes.json()) as { ok?: boolean; wallet?: unknown };
        return withCorsHeaders(
          Response.json({
            ok: true,
            account: {
              accountId: session.accountId,
              username: session.username,
              displayName: session.displayName,
              walletId: session.walletId,
            },
            wallet: walletJson.wallet,
          }),
        );
      }

      if (request.method !== 'POST') {
        return withCorsHeaders(Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 }));
      }

      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return withCorsHeaders(Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }));
      }

      if (url.pathname === '/api/auth/firebase-sync') {
        const token = extractBearerToken(request);
        const claims = token ? await verifyFirebaseIdToken(token, FIREBASE_PROJECT_ID) : null;
        if (!claims) {
          return withCorsHeaders(Response.json({ ok: false, error: 'Invalid Firebase session' }, { status: 401 }));
        }
        const walletId = `acct:${claims.uid}`;
        const accountWalletStub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(walletId));

        const guestId = typeof body.guestPlayerId === 'string' ? body.guestPlayerId.trim() : '';
        if (guestId && guestId.length <= 64 && !guestId.startsWith('acct:')) {
          const guestStub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(guestId));
          const guestStateRes = await guestStub.fetch('https://internal/state');
          const guestStateJson = (await guestStateRes.json()) as { ok?: boolean; wallet?: Record<string, unknown> };
          if (guestStateRes.ok && guestStateJson.ok && guestStateJson.wallet) {
            const importRes = await accountWalletStub.fetch('https://internal/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ wallet: guestStateJson.wallet }),
            });
            const importJson = (await importRes.json()) as { alreadyExists?: boolean };
            if (!importJson.alreadyExists) {
              await guestStub.fetch('https://internal/migrate-out', { method: 'POST' });
            }
          }
        }

        const walletRes = await accountWalletStub.fetch('https://internal/state');
        const walletJson = (await walletRes.json()) as { ok?: boolean; wallet?: unknown };
        return withCorsHeaders(Response.json({ ok: true, walletId, wallet: walletJson.wallet }));
      }

      const userCheck = validateUsername(String(body.username ?? ''));
      if (!userCheck.ok) {
        return withCorsHeaders(Response.json({ ok: false, error: userCheck.error }, { status: 400 }));
      }

      const accountStub = env.PLAYER_ACCOUNT.get(env.PLAYER_ACCOUNT.idFromName(userCheck.normalized));

      if (url.pathname === '/api/auth/register') {
        const regRes = await accountStub.fetch('https://internal/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: userCheck.username,
            password: body.password,
            displayName: body.displayName,
          }),
        });
        const regJson = (await regRes.json()) as { ok?: boolean; error?: string; account?: PublicAccount };
        if (!regRes.ok || !regJson.ok || !regJson.account) {
          return withCorsHeaders(Response.json(regJson, { status: regRes.status }));
        }

        const account = regJson.account;
        const accountWalletStub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(account.walletId));

        // Carry over current guest wallet once on account creation if provided.
        const guestId = typeof body.guestPlayerId === 'string' ? body.guestPlayerId.trim() : '';
        if (guestId && guestId.length <= 64 && !guestId.startsWith('acct:')) {
          const guestStub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(guestId));
          const guestStateRes = await guestStub.fetch('https://internal/state');
          const guestStateJson = (await guestStateRes.json()) as { ok?: boolean; wallet?: Record<string, unknown> };
          if (guestStateRes.ok && guestStateJson.ok && guestStateJson.wallet) {
            await accountWalletStub.fetch('https://internal/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ wallet: guestStateJson.wallet }),
            });
            await guestStub.fetch('https://internal/migrate-out', { method: 'POST' });
          }
        }

        const walletRes = await accountWalletStub.fetch('https://internal/state');
        const walletJson = (await walletRes.json()) as { ok?: boolean; wallet?: unknown };
        const token = await createSessionToken(account, env.AUTH_SECRET);
        return withCorsHeaders(Response.json({ ok: true, token, account, wallet: walletJson.wallet }));
      }

      if (url.pathname === '/api/auth/login') {
        const loginRes = await accountStub.fetch('https://internal/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: body.password }),
        });
        const loginJson = (await loginRes.json()) as { ok?: boolean; error?: string; account?: PublicAccount };
        if (!loginRes.ok || !loginJson.ok || !loginJson.account) {
          return withCorsHeaders(Response.json(loginJson, { status: loginRes.status }));
        }
        const account = loginJson.account;
        const accountWalletStub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(account.walletId));
        const walletRes = await accountWalletStub.fetch('https://internal/state');
        const walletJson = (await walletRes.json()) as { ok?: boolean; wallet?: unknown };
        const token = await createSessionToken(account, env.AUTH_SECRET);
        return withCorsHeaders(Response.json({ ok: true, token, account, wallet: walletJson.wallet }));
      }

      return withCorsHeaders(Response.json({ ok: false, error: 'Unknown auth route' }, { status: 404 }));
    }

    if (url.pathname.startsWith('/api/wallet')) {
      if (request.method === 'OPTIONS') {
        return withCorsHeaders(new Response(null, { status: 204 }));
      }
      const playerId = url.searchParams.get('playerId')?.trim();
      if (!playerId || playerId.length > 64) {
        return withCorsHeaders(Response.json({ ok: false, error: 'Missing playerId' }, { status: 400 }));
      }
      const subPath = url.pathname === '/api/wallet' ? '/state' : url.pathname.replace('/api/wallet', '');
      if (subPath === '/import' || subPath === '/migrate-out') {
        return withCorsHeaders(Response.json({ ok: false, error: 'Forbidden' }, { status: 403 }));
      }
      if ((subPath === '/spin' || subPath === '/claim-streak') && !playerId.startsWith('acct:')) {
        return withCorsHeaders(
          Response.json({ ok: false, error: 'Please sign in with Google to access Spin & Streak.' }, { status: 401 }),
        );
      }
      if (playerId.startsWith('acct:')) {
        const token = extractBearerToken(request);
        let authorized = false;
        if (token) {
          const fbClaims = await verifyFirebaseIdToken(token, FIREBASE_PROJECT_ID);
          if (fbClaims && `acct:${fbClaims.uid}` === playerId) {
            authorized = true;
          } else {
            const session = await verifySessionToken(token, env.AUTH_SECRET);
            if (session && session.walletId === playerId) {
              authorized = true;
            }
          }
        }
        if (!authorized) {
          return withCorsHeaders(Response.json({ ok: false, error: 'Unauthorized wallet access' }, { status: 401 }));
        }
      }
      const stub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(playerId));
      const doRes = await stub.fetch(
        new Request(`https://internal${subPath}`, {
          method: request.method,
          headers: request.headers,
          body: request.method === 'GET' ? undefined : request.body,
        }),
      );
      return withCorsHeaders(doRes);
    }

    if (url.pathname === '/api/matchmake') {
      if (request.method === 'OPTIONS') {
        return withCorsHeaders(new Response(null, { status: 204 }));
      }
      if (request.method !== 'POST') {
        return withCorsHeaders(Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 }));
      }
      let body: { mode?: GameMode; stake?: number } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        // Use defaults.
      }
      const mode: GameMode = body.mode && VALID_MODES.has(body.mode) ? body.mode : '4P_FFA';
      const stake = typeof body.stake === 'number' && isValidStakeTier(body.stake) ? body.stake : 0;
      const capacity = MODE_TEAMS[mode].length;
      const newCode = randomRoomCode();
      const mmStub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global-queue'));
      const mmRes = await mmStub.fetch('https://internal/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: `${mode}:${stake}`, capacity, newCode }),
      });
      const match = (await mmRes.json()) as { ok?: boolean; code?: string; role?: 'host' | 'guest' };
      if (!match.ok || !match.code) {
        return withCorsHeaders(Response.json({ ok: false, error: 'Matchmaking unavailable' }, { status: 503 }));
      }
      if (match.role === 'host') {
        const roomStub = env.LUDO_ROOM.get(env.LUDO_ROOM.idFromName(match.code));
        await roomStub.fetch(
          `https://internal/reserve?code=${match.code}&mode=${encodeURIComponent(mode)}`,
          { method: 'POST' },
        );
      }
      return withCorsHeaders(Response.json({ ok: true, code: match.code, role: match.role, mode, stake }));
    }

    const assetRes = await env.ASSETS.fetch(request);
    const contentType = assetRes.headers.get('Content-Type') ?? '';
    if (!contentType.includes('text/html')) return assetRes;

    const headers = new Headers(assetRes.headers);
    headers.delete('X-Frame-Options');
    headers.set('Content-Security-Policy', FRAME_ANCESTORS_CSP);
    return new Response(assetRes.body, {
      status: assetRes.status,
      statusText: assetRes.statusText,
      headers,
    });
  },
};

export class LudoRoomDO extends DurableObject<Env> {
  private room: RoomRecord | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<RoomRecord>('room');
      if (saved && !isRoomExpired(saved)) {
        this.room = saved;
      } else if (saved) {
        await this.ctx.storage.deleteAll();
      }
    });
  }

  private getActivePlayerIds(excludeSocket?: WebSocket): Set<string> {
    const activePlayerIds = new Set<string>();
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === excludeSocket || sock.readyState !== WebSocket.OPEN) continue;
      const meta = sock.deserializeAttachment() as SocketAttachment | null;
      if (meta?.playerId && !meta.leftExplicitly) activePlayerIds.add(meta.playerId);
    }
    return activePlayerIds;
  }

  private async saveRoom(next: RoomRecord, { touchActivity = true }: { touchActivity?: boolean } = {}) {
    const now = Date.now();
    const lastActiveAt = touchActivity ? now : (next.lastActiveAt ?? now);
    const touched: RoomRecord = { ...next, lastActiveAt };
    this.room = touched;
    await this.ctx.storage.put('room', touched);

    const idleAt = lastActiveAt + ROOM_IDLE_TTL_MS;
    const hasConnectedHumanPlayer = hasConnectedHuman(touched);
    const hasOpenSockets = this.ctx.getWebSockets().some((s) => s.readyState === WebSocket.OPEN);
    let nextAlarm = idleAt;
    if (touched.started && touched.game.phase === 'GAME_OVER' && typeof touched.closeAt === 'number') {
      nextAlarm = Math.min(idleAt, Math.max(now + 50, touched.closeAt));
    } else if (!hasConnectedHumanPlayer && !hasOpenSockets) {
      nextAlarm = Math.min(idleAt, Math.max(now + 50, lastActiveAt + EMPTY_ROOM_CLOSE_MS));
    } else if (
      (hasOpenSockets || hasConnectedHumanPlayer) &&
      touched.started &&
      touched.game.phase !== 'GAME_OVER' &&
      typeof touched.turnDeadlineAt === 'number'
    ) {
      nextAlarm = Math.min(idleAt, Math.max(now + 50, touched.turnDeadlineAt));
    }
    await this.ctx.storage.setAlarm(nextAlarm);
  }

  async alarm() {
    const now = Date.now();
    if (isRoomClosedAfterGameOver(this.room, now)) {
      const closeMsg = 'Match ended — room closed automatically.';
      this.broadcastMessage({ type: 'room_closed', message: closeMsg });
      for (const sock of this.ctx.getWebSockets()) {
        try {
          sock.close(4004, closeMsg);
        } catch {
          // Ignore already-closed sockets.
        }
      }
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }

    if (!this.room || isRoomExpired(this.room, now)) {
      for (const sock of this.ctx.getWebSockets()) {
        try {
          sock.close(1000, 'Room expired after inactivity');
        } catch {
          // Ignore already-closed sockets.
        }
      }
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }

    const activePlayerIds = this.getActivePlayerIds();
    const swept = markDisconnectedIfMissingSockets(this.room, activePlayerIds, now);
    let current = swept;
    const snapshotsNeeded = swept !== this.room;

    if (activePlayerIds.size > 0 && current.started && current.game.phase !== 'GAME_OVER') {
      const timeoutResult = handleTurnTimeout(current, now);
      if (timeoutResult) {
        current = timeoutResult.record;
        await this.saveRoom(current, { touchActivity: false });
        for (const msg of timeoutResult.broadcast) {
          this.broadcastMessage(msg);
        }
        if (snapshotsNeeded || timeoutResult.broadcastSnapshots) {
          this.broadcastPersonalizedSnapshots(current);
        }
        return;
      }
    }

    await this.saveRoom(current, { touchActivity: false });
    if (snapshotsNeeded) {
      this.broadcastPersonalizedSnapshots(current);
    }
  }

  private broadcastMessage(msg: ServerMessage) {
    const raw = JSON.stringify(msg);
    for (const sock of this.ctx.getWebSockets()) {
      if (sock.readyState === WebSocket.OPEN) sock.send(raw);
    }
  }

  private voiceBlocksCache: Record<string, string[]> | null = null;
  private voiceStates = new Map<string, { enabled: boolean; muted: boolean }>();

  private async getVoiceBlocks(): Promise<Record<string, string[]>> {
    if (!this.voiceBlocksCache) {
      this.voiceBlocksCache = (await this.ctx.storage.get<Record<string, string[]>>('voiceBlocks')) ?? {};
    }
    return this.voiceBlocksCache;
  }

  private async setVoiceBlock(blockerId: string, targetId: string, blocked: boolean): Promise<boolean> {
    const map = { ...(await this.getVoiceBlocks()) };
    const current = new Set(map[blockerId] ?? []);
    const wasBlocked = current.has(targetId);
    if (wasBlocked === blocked) return false;
    if (blocked) current.add(targetId);
    else current.delete(targetId);
    if (current.size === 0) delete map[blockerId];
    else map[blockerId] = [...current];
    this.voiceBlocksCache = map;
    await this.ctx.storage.put('voiceBlocks', map);
    return true;
  }

  private isVoiceBlockedPair(blocks: Record<string, string[]>, a: string, b: string): boolean {
    return Boolean(blocks[a]?.includes(b) || blocks[b]?.includes(a));
  }

  private sendToPlayer(targetPlayerId: string, msg: ServerMessage) {
    const raw = JSON.stringify(msg);
    for (const sock of this.ctx.getWebSockets()) {
      if (sock.readyState !== WebSocket.OPEN) continue;
      const meta = sock.deserializeAttachment() as SocketAttachment | null;
      if (meta?.playerId === targetPlayerId) {
        sock.send(raw);
      }
    }
  }

  private broadcastPersonalizedSnapshots(record: RoomRecord) {
    for (const sock of this.ctx.getWebSockets()) {
      if (sock.readyState !== WebSocket.OPEN) continue;
      const meta = sock.deserializeAttachment() as SocketAttachment | null;
      const pid = meta?.playerId ?? '';
      const msg: ServerMessage = { type: 'snapshot', snapshot: snapshotForPlayer(record, pid) };
      sock.send(JSON.stringify(msg));
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const rawMode = url.searchParams.get('mode') as GameMode | null;
    const mode: GameMode = rawMode && VALID_MODES.has(rawMode) ? rawMode : '4P_FFA';

    if (this.room && isRoomExpired(this.room)) {
      this.room = null;
      await this.ctx.storage.deleteAll();
    }

    if (url.pathname === '/reserve') {
      const code = url.searchParams.get('code') ?? '000000000';
      if (isRoomCodeOccupied(this.room)) {
        return Response.json({ ok: false, error: 'code_in_use' }, { status: 409 });
      }
      await this.saveRoom(createRoomRecord(code, mode));
      return Response.json({ ok: true, code });
    }

    const codeMatch = url.pathname.match(/(\d{9})$/);
    const code = codeMatch?.[1] ?? '000000000';
    const playerId = url.searchParams.get('pid')?.trim() || crypto.randomUUID();
    const deviceId = url.searchParams.get('did')?.trim() || undefined;
    const playerName = url.searchParams.get('name') ?? undefined;
    const intent = url.searchParams.get('intent');

    if (!this.room && intent === 'join') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send(
        JSON.stringify({
          type: 'error',
          message: 'Room not found or has ended. Ask your friend for a fresh room code or link.',
        } satisfies ServerMessage),
      );
      server.close(4004, 'Room not found or has ended');
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!this.room) {
      this.room = createRoomRecord(code, mode);
    }

    const now = Date.now();
    const activePlayerIds = this.getActivePlayerIds();
    activePlayerIds.add(playerId);
    const sweptRoom = markDisconnectedIfMissingSockets(this.room, activePlayerIds, now);
    let updated = joinRoom(sweptRoom, playerId, playerName, now, deviceId);
    if (!updated.seats.some((s) => s.playerId === playerId)) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const message = updated.started
        ? 'This match is already full and in progress. Ask your friend to host a new room.'
        : 'This room is already full.';
      const reason = updated.started ? 'Match is full' : 'Room is full';
      server.accept();
      server.send(JSON.stringify({ type: 'error', message } satisfies ServerMessage));
      server.close(4003, reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (updated.started && updated.game.phase !== 'GAME_OVER' && (!updated.turnDeadlineAt || updated.turnDeadlineAt <= now)) {
      updated = { ...updated, turnDeadlineAt: computeTurnDeadlineAt(updated, now) };
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation-safe socket acceptance with playerId attachment preserved across sleeps.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId } satisfies SocketAttachment);

    await this.saveRoom(updated);

    // Send personalized snapshot to joining socket and notify existing peers.
    queueMicrotask(async () => {
      this.broadcastPersonalizedSnapshots(updated);
      for (const [pid, vState] of this.voiceStates.entries()) {
        if (pid !== playerId && server.readyState === WebSocket.OPEN) {
          server.send(
            JSON.stringify({
              type: 'voice_peer_state',
              playerId: pid,
              enabled: vState.enabled,
              muted: vState.muted,
            } satisfies ServerMessage),
          );
        }
      }
      const blocks = await this.getVoiceBlocks();
      for (const [blockerId, blockedList] of Object.entries(blocks)) {
        if (blockerId !== playerId && blockedList.includes(playerId) && server.readyState === WebSocket.OPEN) {
          server.send(
            JSON.stringify({
              type: 'voice_blocked',
              byPlayerId: blockerId,
              blocked: true,
            } satisfies ServerMessage),
          );
        }
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer) {
    if (!this.room) return;
    if (isRoomExpired(this.room)) {
      await this.alarm();
      return;
    }
    const text = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
    if (text.length > MAX_WS_PAYLOAD_BYTES) {
      ws.send(JSON.stringify({ type: 'error', message: 'Payload too large.' } satisfies ServerMessage));
      return;
    }
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(text) as ClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload.' } satisfies ServerMessage));
      return;
    }

    const meta = ws.deserializeAttachment() as SocketAttachment | null;
    const playerId = parsed.type === 'join' ? parsed.playerId : (meta?.playerId ?? '');
    if (!playerId) return;

    if (parsed.type === 'ping') {
      const now = Date.now();
      const activePlayerIds = this.getActivePlayerIds();
      activePlayerIds.add(playerId);
      const swept = markDisconnectedIfMissingSockets(this.room, activePlayerIds, now);
      if (swept !== this.room) {
        await this.saveRoom(swept, { touchActivity: false });
        this.broadcastPersonalizedSnapshots(swept);
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage));
      }
      return;
    }

    if (parsed.type === 'voice_block') {
      const targetId = typeof parsed.targetPlayerId === 'string' ? parsed.targetPlayerId.trim() : '';
      if (targetId && targetId !== playerId) {
        const changed = await this.setVoiceBlock(playerId, targetId, Boolean(parsed.blocked));
        if (changed) {
          this.sendToPlayer(targetId, {
            type: 'voice_blocked',
            byPlayerId: playerId,
            blocked: Boolean(parsed.blocked),
          });
        }
      }
      return;
    }

    if (parsed.type === 'voice_state') {
      const nextState = { enabled: Boolean(parsed.enabled), muted: Boolean(parsed.muted) };
      this.voiceStates.set(playerId, nextState);
      this.broadcastMessage({
        type: 'voice_peer_state',
        playerId,
        enabled: nextState.enabled,
        muted: nextState.muted,
      });
      return;
    }

    if (parsed.type === 'voice_signal') {
      const targetId = typeof parsed.targetPlayerId === 'string' ? parsed.targetPlayerId.trim() : '';
      if (!targetId || targetId === playerId) return;
      const isTargetInRoom = this.room.seats.some((s) => s.occupant === 'human' && s.playerId === targetId);
      const isSenderInRoom = this.room.seats.some((s) => s.occupant === 'human' && s.playerId === playerId);
      if (!isTargetInRoom || !isSenderInRoom) return;
      const blocks = await this.getVoiceBlocks();
      if (this.isVoiceBlockedPair(blocks, playerId, targetId)) return;
      this.sendToPlayer(targetId, {
        type: 'voice_signal',
        fromPlayerId: playerId,
        signal: parsed.signal,
      });
      return;
    }

    if (parsed.type === 'leave') {
      this.voiceStates.delete(playerId);
      ws.serializeAttachment({ playerId, leftExplicitly: true } satisfies SocketAttachment);
    }

    const result = handleRoomAction(this.room, playerId, parsed, Math.random, Date.now());
    if (result.closeRoom) {
      const closeMsg = 'All players left — room closed.';
      for (const sock of this.ctx.getWebSockets()) {
        if (sock === ws) continue;
        try {
          sock.close(4004, closeMsg);
        } catch {
          // Ignore already-closed sockets.
        }
      }
      this.room = null;
      this.voiceBlocksCache = null;
      this.voiceStates.clear();
      await this.ctx.storage.deleteAll();
      return;
    }

    if (result.persist) await this.saveRoom(result.record);
    else this.room = result.record;

    if (result.reply && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(result.reply));
    }
    for (const msg of result.broadcast) {
      this.broadcastMessage(msg);
    }
    if (result.broadcastSnapshots) {
      this.broadcastPersonalizedSnapshots(result.record);
    }
  }

  private async handleDisconnectSocket(ws: WebSocket) {
    const meta = ws.deserializeAttachment() as SocketAttachment | null;
    if (!meta?.playerId || !this.room || meta.leftExplicitly) return;
    // Ignore close events from a superseded socket if the player already reconnected on another live socket.
    const activePlayerIds = this.getActivePlayerIds(ws);
    if (activePlayerIds.has(meta.playerId)) return;
    this.voiceStates.delete(meta.playerId);
    this.broadcastMessage({ type: 'voice_peer_state', playerId: meta.playerId, enabled: false, muted: true });
    const next = disconnectPlayer(this.room, meta.playerId);
    await this.saveRoom(next);
    this.broadcastPersonalizedSnapshots(next);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    await this.handleDisconnectSocket(ws);
    if (code === 1000 || (code >= 3000 && code <= 4999)) {
      try {
        ws.close(code, reason);
      } catch {
        // Ignore already-closed socket errors.
      }
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error('LudoRoomDO WebSocket error:', error);
    await this.handleDisconnectSocket(ws);
  }
}
