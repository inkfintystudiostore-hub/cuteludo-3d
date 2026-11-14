/**
 * Client WebSocket adapter connecting to Cloudflare Durable Objects (/ws/room/:code)
 * with automatic reconnection, keepalive pings, and explicit room-leave semantics.
 */
import { registerRoomTransport, useGameStore } from './gameStore';
import type { GameMode } from './ludoRules';
import type { TeamId } from './boardMap';
import type { ClientMessage, RoomEmoteId, ServerMessage } from './multiplayerProtocol';
import { clearRoomFromBrowserUrl, resolveEmbeddedParentUrl } from './roomCode';

interface ActiveConnectionParams {
  code: string;
  role: 'host' | 'guest';
  mode: GameMode;
  playerName?: string;
}

const HEARTBEAT_INTERVAL_MS = 25_000;
const REJECTED_CLOSE_CODES = new Set([4003, 4004]);

let socket: WebSocket | null = null;
let activeCode: string | null = null;
let activeParams: ActiveConnectionParams | null = null;
let intentionalClose = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let reconnectAttempt = 0;
let hasConnectedOnce = false;
let lastServerError: string | null = null;
let lifecycleListenersAttached = false;

export type ReserveRoomResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

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

function getWsOrigin(): string {
  const custom = import.meta.env.VITE_WS_URL as string | undefined;
  if (custom && custom.trim()) return custom.trim().replace(/\/+$/, '');
  if (typeof window === 'undefined') return 'ws://127.0.0.1:8787';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

function getHttpOrigin(): string {
  const custom = import.meta.env.VITE_WS_URL as string | undefined;
  if (custom && custom.trim()) {
    return custom
      .trim()
      .replace(/\/+$/, '')
      .replace(/^wss:/i, 'https:')
      .replace(/^ws:/i, 'http:');
  }
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://127.0.0.1:8787';
}

/** Requests a server-verified unused 9-digit room code from the live Worker. */
export async function reserveUniqueRoomCode(mode: GameMode): Promise<ReserveRoomResult> {
  try {
    const res = await fetch(`${getHttpOrigin()}/api/rooms/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as { ok?: boolean; code?: string; error?: string };
        if (data.ok && data.code && /^\d{9}$/.test(data.code)) {
          return { ok: true, code: data.code };
        }
        if (data.error) return { ok: false, error: data.error };
      }
    }
  } catch {
    // Network / offline error handled below.
  }
  return {
    ok: false,
    error: 'Could not reach the live room server. Check your connection and try again.',
  };
}

const NAME_STORAGE_KEY = 'chibi-ludo-name';

export function loadPlayerDisplayName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlayerDisplayName(name: string): void {
  try {
    const trimmed = name.trim().slice(0, 18);
    if (trimmed) localStorage.setItem(NAME_STORAGE_KEY, trimmed);
    else localStorage.removeItem(NAME_STORAGE_KEY);
  } catch {
    // Ignore storage unavailability.
  }
}

let cachedPlayerId: string | null = null;

function getPlayerId(): string {
  if (cachedPlayerId) return cachedPlayerId;
  const key = 'chibi-ludo-pid';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) {
      cachedPlayerId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(key, fresh);
    cachedPlayerId = fresh;
    return fresh;
  } catch {
    cachedPlayerId = `tab-${Math.random().toString(36).slice(2, 10)}`;
    return cachedPlayerId;
  }
}

function send(msg: ClientMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function clearTimers(): void {
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

function attachLifecycleListeners(): void {
  if (lifecycleListenersAttached || typeof window === 'undefined') return;
  lifecycleListenersAttached = true;

  const tryResume = () => {
    if (intentionalClose || !activeParams) return;
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    reconnectAttempt = 0;
    openSocket(activeParams);
  };

  window.addEventListener('online', tryResume);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tryResume();
    });
  }
}

function closeActiveSocket(sendLeave: boolean): void {
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
  registerRoomTransport(null);
  if (!socket) return;
  const old = socket;
  socket = null;
  try {
    if (sendLeave && old.readyState === WebSocket.OPEN) {
      old.send(JSON.stringify({ type: 'leave' } satisfies ClientMessage));
    }
    old.close(1000, 'Client left room');
  } catch {
    // Ignore already-closed sockets.
  }
}

function teardownMultiplayerRoom(): void {
  intentionalClose = true;
  activeCode = null;
  activeParams = null;
  reconnectAttempt = 0;
  hasConnectedOnce = false;
  lastServerError = null;
  clearTimers();
  closeActiveSocket(true);
}

export function disconnectMultiplayerRoom(): void {
  teardownMultiplayerRoom();
  notifyParentRoomCode(null);
  clearRoomFromBrowserUrl();
}

export function retryMultiplayerConnection(): void {
  if (!activeParams) return;
  intentionalClose = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  reconnectAttempt = 0;
  closeActiveSocket(false);
  openSocket(activeParams);
}

function openSocket(params: ActiveConnectionParams): void {
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
  closeActiveSocket(false);

  lastServerError = null;
  const cleanName = (params.playerName ?? loadPlayerDisplayName()).trim().slice(0, 18);
  const playerId = getPlayerId();
  const nameParam = cleanName ? `&name=${encodeURIComponent(cleanName)}` : '';
  const intent = params.role === 'host' ? 'create' : 'join';
  const url = `${getWsOrigin()}/ws/room/${params.code}?pid=${encodeURIComponent(playerId)}&mode=${encodeURIComponent(params.mode)}&intent=${intent}${nameParam}`;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    useGameStore.getState().setRoomConnectionStatus('offline', 'Live room server unavailable — check connection');
    return;
  }
  socket = ws;

  registerRoomTransport({
    roll: () => send({ type: 'roll' }),
    move: (pawnId) => send({ type: 'move', pawnId }),
    reset: () => send({ type: 'reset' }),
    resync: () => {
      const latestName = (activeParams?.playerName ?? loadPlayerDisplayName()).trim().slice(0, 18);
      send({ type: 'join', playerId, name: latestName || undefined });
    },
    emote: (emote: RoomEmoteId) => send({ type: 'emote', emote }),
    chat: (text: string) => send({ type: 'chat', text }),
    disconnect: disconnectMultiplayerRoom,
  });

  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    reconnectAttempt = 0;
    hasConnectedOnce = true;
    useGameStore.getState().setRoomConnectionStatus('connected', 'Connected to live Cloudflare room');
    const latestName = (activeParams?.playerName ?? loadPlayerDisplayName()).trim().slice(0, 18);
    send({ type: 'join', playerId, name: latestName || undefined });
    heartbeatTimer = setInterval(() => {
      send({ type: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
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
      case 'pong':
        break;
      case 'snapshot':
        if (activeParams) {
          activeParams = {
            ...activeParams,
            role: data.snapshot.isHost ? 'host' : 'guest',
            mode: data.snapshot.mode,
          };
        }
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
      case 'chat':
        state.pushChatMessage(data.chat);
        break;
      case 'emote': {
        const team = data.fromTeam ?? state.room?.myTeam ?? state.game.currentTeam;
        const existing = state.yardEmotes[team];
        if (state.room?.myTeam === team && existing?.emote === data.emote && Date.now() - existing.startedAt < 600) {
          break;
        }
        state.triggerYardEmote(team, data.emote);
        break;
      }
      case 'error':
        lastServerError = data.message;
        useGameStore.getState().setRoomAlert(data.message);
        useGameStore.setState({ notice: data.message });
        break;
    }
  });

  ws.addEventListener('close', (event) => {
    if (socket !== ws) return;
    socket = null;
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    registerRoomTransport(null);

    if (intentionalClose || !activeParams) return;

    if (REJECTED_CLOSE_CODES.has(event.code)) {
      const msg = lastServerError || event.reason || 'Room not found or has ended.';
      activeCode = null;
      activeParams = null;
      reconnectAttempt = 0;
      notifyParentRoomCode(null);
      clearRoomFromBrowserUrl();
      useGameStore.getState().setRoomAlert(msg);
      useGameStore.setState({ room: null, notice: msg });
      return;
    }

    // Unexpected drop (e.g. mobile app switch to share link): keep room state & auto-reconnect.
    if (!hasConnectedOnce && reconnectAttempt >= 2) {
      useGameStore
        .getState()
        .setRoomConnectionStatus('offline', 'Could not connect to the live room server. Please retry.');
      return;
    }

    const delay = Math.min(8000, 1000 * 2 ** Math.min(reconnectAttempt, 3));
    reconnectAttempt += 1;
    useGameStore
      .getState()
      .setRoomConnectionStatus('connecting', 'Connection lost — reconnecting to live room…');
    clearTimeout(reconnectTimer);
    const nextParams = activeParams;
    reconnectTimer = setTimeout(() => {
      if (!intentionalClose && activeParams && activeParams.code === nextParams.code) {
        openSocket(activeParams);
      }
    }, delay);
  });
}

export function connectMultiplayerRoom(code: string, role: 'host' | 'guest', mode: GameMode, playerName?: string): void {
  if (socket && activeCode === code && socket.readyState <= WebSocket.OPEN) return;

  teardownMultiplayerRoom();
  attachLifecycleListeners();

  intentionalClose = false;
  activeCode = code;
  activeParams = { code, role, mode, playerName };
  notifyParentRoomCode(code);

  const store = useGameStore.getState();
  store.setRoomAlert(null);
  store.initRoomSession({
    code,
    mode,
    role,
    online: false,
    status: 'connecting',
    statusNote: role === 'host' ? 'Creating live room…' : 'Joining live room…',
  });

  openSocket(activeParams);
}

export function sendRoomMode(mode: GameMode): void {
  if (activeParams) activeParams = { ...activeParams, mode };
  send({ type: 'set_mode', mode });
}

export function sendRoomName(name: string): void {
  savePlayerDisplayName(name);
  const trimmed = name.trim().slice(0, 18);
  if (activeParams) activeParams = { ...activeParams, playerName: trimmed };
  send({ type: 'set_name', name: trimmed });
}

export function sendRoomSelectTeam(team: TeamId): void {
  useGameStore.getState().setRoomAlert(null);
  send({ type: 'select_team', team });
}

export function sendRoomStart(mode: GameMode): void {
  send({ type: 'start', mode });
}
