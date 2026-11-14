/**
 * Client WebSocket adapter connecting to Cloudflare Durable Objects (/ws/room/:code)
 * with graceful offline fallback when running Vite without a live worker server.
 */
import { emitEffect } from '../scene/effects/AnimeEffects';
import { registerRoomTransport, useGameStore } from './gameStore';
import type { GameMode } from './ludoRules';
import type { ClientMessage, RoomEmoteId, ServerMessage } from './multiplayerProtocol';
import { generateRoomCode, resolveEmbeddedParentUrl } from './roomCode';

let socket: WebSocket | null = null;
let activeCode: string | null = null;
let intentionalClose = false;

export function notifyParentRoomCode(code: string | null): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  const parent = resolveEmbeddedParentUrl();
  if (!parent) return;
  try {
    window.parent.postMessage({ type: 'chibi-ludo:room', code }, parent.origin);
  } catch {
    // Ignore cross-origin frame messaging restrictions.
  }
}

/** Requests a server-verified unused 9-digit room code; falls back locally when offline. */
export async function reserveUniqueRoomCode(mode: GameMode): Promise<string> {
  try {
    const httpOrigin =
      typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8787';
    const res = await fetch(`${httpOrigin}/api/rooms/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; code?: string };
      if (data.ok && data.code && /^\d{9}$/.test(data.code)) {
        return data.code;
      }
    }
  } catch {
    // Offline local preview without Wrangler worker.
  }
  return generateRoomCode();
}

function getPlayerId(): string {
  const key = 'chibi-ludo-pid';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return `tab-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getWsOrigin(): string {
  const custom = import.meta.env.VITE_WS_URL as string | undefined;
  if (custom && custom.trim()) return custom.trim().replace(/\/+$/, '');
  if (typeof window === 'undefined') return 'ws://127.0.0.1:8787';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

function send(msg: ClientMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export function disconnectMultiplayerRoom(): void {
  intentionalClose = true;
  activeCode = null;
  registerRoomTransport(null);
  if (socket) {
    try {
      socket.close(1000, 'Client left room');
    } catch {
      // Ignore already-closed sockets.
    }
    socket = null;
  }
}

export function connectMultiplayerRoom(code: string, role: 'host' | 'guest', mode: GameMode): void {
  if (socket && activeCode === code && socket.readyState <= WebSocket.OPEN) return;

  disconnectMultiplayerRoom();
  intentionalClose = false;
  activeCode = code;
  notifyParentRoomCode(code);

  const store = useGameStore.getState();
  store.initRoomSession({ code, role, online: false, status: 'connecting', statusNote: 'Connecting to live server…' });

  const playerId = getPlayerId();
  const url = `${getWsOrigin()}/ws/room/${code}?pid=${encodeURIComponent(playerId)}&mode=${encodeURIComponent(mode)}`;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    useGameStore.getState().setRoomConnectionStatus('offline', 'Live room server unavailable — local preview active');
    return;
  }
  socket = ws;

  registerRoomTransport({
    roll: () => send({ type: 'roll' }),
    move: (pawnId) => send({ type: 'move', pawnId }),
    reset: () => send({ type: 'reset' }),
    emote: (emote: RoomEmoteId) => send({ type: 'emote', emote }),
    disconnect: disconnectMultiplayerRoom,
  });

  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    useGameStore.getState().setRoomConnectionStatus('connected', 'Connected to live Cloudflare room');
    send({ type: 'join', playerId });
  });

  ws.addEventListener('message', (event) => {
    if (socket !== ws) return;
    let data: ServerMessage;
    try {
      data = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      return;
    }
    const state = useGameStore.getState();
    switch (data.type) {
      case 'snapshot':
        state.syncRoomSnapshot(data.snapshot);
        break;
      case 'roll':
        state.playRemoteRoll(data.value);
        break;
      case 'move':
        state.playRemoteMove(data.pawnId);
        break;
      case 'reset':
        state.syncRemoteReset(data.mode);
        break;
      case 'emote':
        emitEffect({ type: 'emote', emote: data.emote });
        break;
      case 'error':
        useGameStore.setState({ notice: data.message });
        break;
    }
  });

  ws.addEventListener('close', () => {
    if (socket !== ws) return;
    socket = null;
    registerRoomTransport(null);
    if (!intentionalClose) {
      useGameStore
        .getState()
        .setRoomConnectionStatus('offline', 'Live server offline — run "npm run worker:dev" or deploy to Cloudflare');
    }
  });
}

export function sendRoomMode(mode: GameMode): void {
  send({ type: 'set_mode', mode });
}

export function sendRoomStart(mode: GameMode): void {
  send({ type: 'start', mode });
}
