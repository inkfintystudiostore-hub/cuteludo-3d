/**
 * Client WebSocket adapter connecting to Cloudflare Durable Objects (/ws/room/:code)
 * with automatic reconnection, keepalive pings, and explicit room-leave semantics.
 */
import { registerRoomTransport, useGameStore } from './gameStore';
import {
  getWalletMutationEpoch,
  registerWalletServerSync,
  useWalletStore,
  type WalletPersisted,
  type WalletServerAction,
} from './walletStore';
import type { GameMode } from './ludoRules';
import type { TeamId } from './boardMap';
import type { ClientMessage, RoomEmoteId, ServerMessage } from './multiplayerProtocol';
import { clearRoomFromBrowserUrl, resolveEmbeddedParentUrl } from './roomCode';
import { registerVoiceTransport, useVoiceStore } from './voiceStore';

interface ActiveConnectionParams {
  code: string;
  role: 'host' | 'guest';
  mode: GameMode;
  playerName?: string;
}

const HEARTBEAT_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;
const REJECTED_CLOSE_CODES = new Set([4003, 4004]);

let socket: WebSocket | null = null;
let activeCode: string | null = null;
let activeParams: ActiveConnectionParams | null = null;
let intentionalClose = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let pongTimer: ReturnType<typeof setTimeout> | undefined;
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

export function getHttpOrigin(): string {
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
    const authHeaders = await getWalletAuthHeaders();
    const res = await fetch(`${getHttpOrigin()}/api/rooms/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ mode }),
    });
    if (res.status === 401) {
      return { ok: false, error: 'Please sign in with Google to create a room.' };
    }
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
let cachedDeviceId: string | null = null;

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

function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  const key = 'chibi-ludo-did';
  try {
    const existing = localStorage.getItem(key);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    localStorage.setItem(key, fresh);
    cachedDeviceId = fresh;
    return fresh;
  } catch {
    cachedDeviceId = getPlayerId();
    return cachedDeviceId;
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
  clearTimeout(pongTimer);
  pongTimer = undefined;
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
  clearTimeout(pongTimer);
  pongTimer = undefined;
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
  useVoiceStore.getState().leaveRoomVoice();
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

async function openSocket(params: ActiveConnectionParams): Promise<void> {
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
  clearTimeout(pongTimer);
  pongTimer = undefined;
  closeActiveSocket(false);

  lastServerError = null;
  const cleanName = (params.playerName ?? loadPlayerDisplayName()).trim().slice(0, 18);
  const playerId = getPlayerId();
  const deviceId = getDeviceId();
  const info = walletAuthProvider?.();
  const token = info?.getToken ? await info.getToken() : info?.token;
  const nameParam = cleanName ? `&name=${encodeURIComponent(cleanName)}` : '';
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const intent = params.role === 'host' ? 'create' : 'join';
  const url = `${getWsOrigin()}/ws/room/${params.code}?pid=${encodeURIComponent(playerId)}&did=${encodeURIComponent(deviceId)}&mode=${encodeURIComponent(params.mode)}&intent=${intent}${nameParam}${tokenParam}`;

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
      send({ type: 'join', playerId, name: latestName || undefined, deviceId });
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
    send({ type: 'join', playerId, name: latestName || undefined, deviceId });
    heartbeatTimer = setInterval(() => {
      if (socket !== ws || ws.readyState !== WebSocket.OPEN) return;
      send({ type: 'ping' });
      clearTimeout(pongTimer);
      pongTimer = setTimeout(() => {
        if (socket !== ws || intentionalClose) return;
        retryMultiplayerConnection();
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.addEventListener('message', (event) => {
    if (socket !== ws) return;
    clearTimeout(pongTimer);
    pongTimer = undefined;
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
        useVoiceStore.getState().syncRoomPeers(data.snapshot.yourPlayerId, data.snapshot.seats);
        break;
      case 'roll':
        state.playRemoteRoll(data.value, {
          team: data.team,
          seq: data.seq,
          game: data.game,
          legalMoves: data.legalMoves,
          turnRemainingMs: data.turnRemainingMs,
        });
        break;
      case 'move':
        state.playRemoteMove(data.pawnId, {
          team: data.team,
          seq: data.seq,
          game: data.game,
          legalMoves: data.legalMoves,
          turnRemainingMs: data.turnRemainingMs,
        });
        break;
      case 'reset':
        state.syncRemoteReset(data.mode, {
          seq: data.seq,
          game: data.game,
          turnRemainingMs: data.turnRemainingMs,
        });
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
      case 'voice_signal':
        void useVoiceStore.getState().handleIncomingSignal(data.fromPlayerId, data.signal);
        break;
      case 'voice_blocked':
        useVoiceStore.getState().handlePeerBlockedNotice(data.byPlayerId, data.blocked);
        break;
      case 'voice_peer_state':
        useVoiceStore.getState().handlePeerVoiceState(data.playerId, data.enabled, data.muted);
        break;
      case 'room_closed':
        useVoiceStore.getState().leaveRoomVoice();
        intentionalClose = true;
        activeCode = null;
        activeParams = null;
        reconnectAttempt = 0;
        clearTimers();
        notifyParentRoomCode(null);
        clearRoomFromBrowserUrl();
        socket = null;
        try {
          ws.close(4004, data.message);
        } catch {
          // Ignore already-closed socket.
        }
        state.closeOnlineRoom(data.message);
        break;
      case 'error':
        lastServerError = data.message;
        useGameStore.getState().setRoomAlert(data.message);
        useGameStore.setState({ notice: data.message });
        if (data.message.includes('Not your turn') || data.message.includes('Illegal pawn')) {
          const latestName = (activeParams?.playerName ?? loadPlayerDisplayName()).trim().slice(0, 18);
          send({ type: 'join', playerId, name: latestName || undefined, deviceId });
        }
        break;
    }
  });

  ws.addEventListener('close', (event) => {
    if (socket !== ws) return;
    socket = null;
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    clearTimeout(pongTimer);
    pongTimer = undefined;
    registerRoomTransport(null);

    if (intentionalClose || !activeParams) return;

    if (REJECTED_CLOSE_CODES.has(event.code)) {
      const msg = lastServerError || event.reason || 'Room not found or has ended.';
      activeCode = null;
      activeParams = null;
      reconnectAttempt = 0;
      notifyParentRoomCode(null);
      clearRoomFromBrowserUrl();
      useGameStore.getState().closeOnlineRoom(msg);
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

export function sendRoomStake(stake: number): void {
  send({ type: 'set_stake', stake });
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

export interface WalletAuthInfo {
  token?: string | null;
  getToken?: () => Promise<string | null>;
  walletId: string | null;
  onUnauthorized?: () => void;
}

let walletAuthProvider: (() => WalletAuthInfo) | null = null;

export function registerWalletAuthProvider(provider: (() => WalletAuthInfo) | null): void {
  walletAuthProvider = provider;
  if (provider) {
    void useVoiceStore.getState().syncBlockedFromAccount();
  }
}

registerVoiceTransport({
  sendSignal: (targetPlayerId, signal) => send({ type: 'voice_signal', targetPlayerId, signal }),
  sendBlock: (targetPlayerId, blocked) => send({ type: 'voice_block', targetPlayerId, blocked }),
  sendState: (enabled, muted) => send({ type: 'voice_state', enabled, muted }),
  getAuthToken: async () => {
    const auth = walletAuthProvider?.();
    if (!auth) return null;
    if (auth.getToken) return auth.getToken();
    return auth.token ?? null;
  },
  getHttpOrigin,
});

export function getGuestDeviceId(): string {
  return getDeviceId();
}

export function getWalletPlayerId(): string {
  return walletAuthProvider?.().walletId ?? getDeviceId();
}

async function getWalletAuthHeaders(): Promise<Record<string, string>> {
  const info = walletAuthProvider?.();
  if (!info) return {};
  const token = info.getToken ? await info.getToken() : info.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function syncWalletFromServer(): Promise<void> {
  const epochBefore = getWalletMutationEpoch();
  try {
    const playerId = getWalletPlayerId();
    const authHeaders = await getWalletAuthHeaders();
    const res = await fetch(`${getHttpOrigin()}/api/wallet?playerId=${encodeURIComponent(playerId)}`, {
      headers: authHeaders,
    });
    if (res.status === 401 && playerId.startsWith('acct:')) {
      walletAuthProvider?.().onUnauthorized?.();
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { ok?: boolean; wallet?: Partial<WalletPersisted> };
    if (data.ok && data.wallet && getWalletMutationEpoch() === epochBefore) {
      useWalletStore.getState().applyServerSnapshot(data.wallet);
    }
  } catch {
    // Offline fallback keeps localStorage wallet.
  }
}

async function postWalletAction(action: WalletServerAction, payload?: Record<string, unknown>): Promise<void> {
  const epochBefore = getWalletMutationEpoch();
  try {
    const playerId = getWalletPlayerId();
    const authHeaders = await getWalletAuthHeaders();
    const res = await fetch(
      `${getHttpOrigin()}/api/wallet/${action}?playerId=${encodeURIComponent(playerId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload ?? {}),
      },
    );
    if (res.status === 401 && playerId.startsWith('acct:')) {
      walletAuthProvider?.().onUnauthorized?.();
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { ok?: boolean; wallet?: Partial<WalletPersisted> };
    if (data.ok && data.wallet && getWalletMutationEpoch() === epochBefore) {
      useWalletStore.getState().applyServerSnapshot(data.wallet);
    }
  } catch {
    // Offline fallback keeps localStorage wallet.
  }
}

if (typeof window !== 'undefined') {
  registerWalletServerSync((action, payload) => {
    void postWalletAction(action, payload);
  });
}

export async function findQuickMatch(
  mode: GameMode,
  stake: number,
): Promise<{ ok: true; code: string; role: 'host' | 'guest' } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${getHttpOrigin()}/api/matchmake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, stake }),
    });
    const data = (await res.json()) as { ok?: boolean; code?: string; role?: 'host' | 'guest'; error?: string };
    if (!res.ok || !data.ok || !data.code || !data.role) {
      return { ok: false, error: data.error ?? 'Could not find a public match.' };
    }
    return { ok: true, code: data.code, role: data.role };
  } catch {
    return { ok: false, error: 'Matchmaking server unreachable.' };
  }
}

export function sendRoomStart(mode: GameMode, stake?: number): void {
  send({ type: 'start', mode, stake });
}
