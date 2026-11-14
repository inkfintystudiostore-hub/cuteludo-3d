/**
 * Cloudflare Worker + Hibernatable SQLite Durable Object room server for Chibi Ludo 3D.
 * Serves the static Vite build via env.ASSETS and routes WebSocket rooms on /ws/room/:code.
 */
import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, ServerMessage } from '../src/engine/multiplayerProtocol';
import type { GameMode } from '../src/engine/ludoRules';
import {
  createRoomRecord,
  disconnectPlayer,
  handleRoomAction,
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
}

const VALID_MODES = new Set<GameMode>(['2P_COUPLES', '4P_FFA', '2V2_TEAM']);

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

    if (url.pathname === '/api/health') {
      return Response.json(
        { ok: true, service: 'chibi-ludo-do' },
        { headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }

    return env.ASSETS.fetch(request);
  },
};

export class LudoRoomDO extends DurableObject<Env> {
  private room: RoomRecord | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<RoomRecord>('room');
      if (saved) this.room = saved;
    });
  }

  private async saveRoom(next: RoomRecord) {
    this.room = next;
    await this.ctx.storage.put('room', next);
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
    const codeMatch = url.pathname.match(/(\d{9})$/);
    const code = codeMatch?.[1] ?? '000000000';
    const rawMode = url.searchParams.get('mode') as GameMode | null;
    const mode: GameMode = rawMode && VALID_MODES.has(rawMode) ? rawMode : '4P_FFA';
    const playerId = url.searchParams.get('pid')?.trim() || crypto.randomUUID();

    if (!this.room) {
      this.room = createRoomRecord(code, mode);
    }

    const updated = joinRoom(this.room, playerId);
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
    const text = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
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

    const result = handleRoomAction(this.room, playerId, parsed);
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

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const meta = ws.deserializeAttachment() as SocketAttachment | null;
    if (meta?.playerId && this.room) {
      const next = disconnectPlayer(this.room, meta.playerId);
      await this.saveRoom(next);
      this.broadcastPersonalizedSnapshots(next);
    }
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error('LudoRoomDO WebSocket error:', error);
    const meta = ws.deserializeAttachment() as SocketAttachment | null;
    if (meta?.playerId && this.room) {
      const next = disconnectPlayer(this.room, meta.playerId);
      await this.saveRoom(next);
      this.broadcastPersonalizedSnapshots(next);
    }
  }
}
