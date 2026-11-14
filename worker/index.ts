/**
 * Cloudflare Worker + Hibernatable SQLite Durable Object room server for Chibi Ludo 3D.
 * Serves the static Vite build via env.ASSETS and routes WebSocket rooms on /ws/room/:code.
 */
import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, ServerMessage } from '../src/engine/multiplayerProtocol';
import type { GameMode } from '../src/engine/ludoRules';
import {
  ROOM_IDLE_TTL_MS,
  createRoomRecord,
  disconnectPlayer,
  handleRoomAction,
  isRoomCodeOccupied,
  isRoomExpired,
  joinRoom,
  snapshotForPlayer,
  type RoomRecord,
} from './roomLogic';

interface Env {
  ASSETS: Fetcher;
  LUDO_ROOM: DurableObjectNamespace<LudoRoomDO>;
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
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
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

  private async saveRoom(next: RoomRecord) {
    const touched: RoomRecord = { ...next, lastActiveAt: Date.now() };
    this.room = touched;
    await this.ctx.storage.put('room', touched);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
  }

  async alarm() {
    for (const sock of this.ctx.getWebSockets()) {
      try {
        sock.close(1000, 'Room expired after inactivity');
      } catch {
        // Ignore already-closed sockets.
      }
    }
    this.room = null;
    await this.ctx.storage.deleteAll();
  }

  private broadcastMessage(msg: ServerMessage) {
    const raw = JSON.stringify(msg);
    for (const sock of this.ctx.getWebSockets()) {
      if (sock.readyState === WebSocket.OPEN) sock.send(raw);
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

    const updated = joinRoom(this.room, playerId, playerName);
    if (!updated.started && !updated.seats.some((s) => s.playerId === playerId)) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send(
        JSON.stringify({
          type: 'error',
          message: 'This room is already full.',
        } satisfies ServerMessage),
      );
      server.close(4003, 'Room is full');
      return new Response(null, { status: 101, webSocket: client });
    }

    await this.saveRoom(updated);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation-safe socket acceptance with playerId attachment preserved across sleeps.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId } satisfies SocketAttachment);

    // Send personalized snapshot to joining socket and notify existing peers.
    queueMicrotask(() => {
      this.broadcastPersonalizedSnapshots(updated);
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

    if (parsed.type === 'leave') {
      ws.serializeAttachment({ playerId, leftExplicitly: true } satisfies SocketAttachment);
    }

    const result = handleRoomAction(this.room, playerId, parsed);
    if (parsed.type === 'leave' && !result.record.started && result.record.seats.every((s) => s.occupant === 'open')) {
      this.room = null;
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
