import { create } from 'zustand';
import type { SeatInfo, VoiceSignal } from './multiplayerProtocol';

export type VoicePrivacyMode = 'open' | 'allow_only';
export type VoiceMicMode = 'open' | 'ptt';

const LS_BLOCKED_KEY = 'ludo_voice_blocked_ids_v1';
const LS_PRIVACY_KEY = 'ludo_voice_privacy_mode_v1';
const LS_MIC_MODE_KEY = 'ludo_voice_mic_mode_v1';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export interface VoiceTransport {
  sendSignal: (targetPlayerId: string, signal: VoiceSignal) => void;
  sendBlock: (targetPlayerId: string, blocked: boolean) => void;
  sendState: (enabled: boolean, muted: boolean) => void;
  getAuthToken?: () => Promise<string | null>;
  getHttpOrigin?: () => string;
}

let transport: VoiceTransport | null = null;

export function registerVoiceTransport(next: VoiceTransport | null): void {
  transport = next;
}

export function isPeerAllowed(
  peerId: string,
  privacyMode: VoicePrivacyMode,
  blockedIds: string[],
  allowedIds: string[],
  blockedByPeerIds: string[],
): boolean {
  if (!peerId) return false;
  if (blockedIds.includes(peerId) || blockedByPeerIds.includes(peerId)) return false;
  if (privacyMode === 'allow_only') {
    return allowedIds.includes(peerId);
  }
  return true;
}

export function shouldInitiateOffer(myPlayerId: string, peerPlayerId: string): boolean {
  return myPlayerId < peerPlayerId;
}

function loadJsonArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  } catch {
    return [];
  }
}

function loadPrivacyMode(): VoicePrivacyMode {
  try {
    return localStorage.getItem(LS_PRIVACY_KEY) === 'allow_only' ? 'allow_only' : 'open';
  } catch {
    return 'open';
  }
}

function loadMicMode(): VoiceMicMode {
  try {
    return localStorage.getItem(LS_MIC_MODE_KEY) === 'ptt' ? 'ptt' : 'open';
  } catch {
    return 'open';
  }
}

function saveBlockedToLocal(ids: string[]): void {
  try {
    localStorage.setItem(LS_BLOCKED_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage errors
  }
}

async function persistBlockedToServer(ids: string[]): Promise<void> {
  if (!transport?.getAuthToken || !transport.getHttpOrigin) return;
  try {
    const token = await transport.getAuthToken();
    if (!token) return;
    await fetch(`${transport.getHttpOrigin()}/api/voice/blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ blockedIds: ids }),
    });
  } catch {
    // ignore network errors; localStorage already has the update
  }
}

export interface PeerVoiceMeta {
  enabled: boolean;
  muted: boolean;
}

export interface VoiceState {
  enabled: boolean;
  connecting: boolean;
  error: string | null;
  micMode: VoiceMicMode;
  micMuted: boolean;
  pttActive: boolean;
  privacyMode: VoicePrivacyMode;
  blockedIds: string[];
  allowedIds: string[];
  blockedByPeerIds: string[];
  localMutedIds: string[];
  peerVolumes: Record<string, number>;
  peerStates: Record<string, PeerVoiceMeta>;
  speakingIds: Record<string, boolean>;
  myPlayerId: string | null;
  roomHumanPeerIds: string[];

  enableVoice: () => Promise<void>;
  disableVoice: () => void;
  setMicMuted: (muted: boolean) => void;
  toggleMicMuted: () => void;
  setMicMode: (mode: VoiceMicMode) => void;
  setPttActive: (active: boolean) => void;
  setPrivacyMode: (mode: VoicePrivacyMode) => void;
  setPeerBlocked: (peerId: string, blocked: boolean) => void;
  setPeerAllowed: (peerId: string, allowed: boolean) => void;
  setPeerLocalMuted: (peerId: string, muted: boolean) => void;
  setPeerVolume: (peerId: string, volume: number) => void;

  syncRoomPeers: (myPlayerId: string, seats: SeatInfo[]) => void;
  handleIncomingSignal: (fromPlayerId: string, signal: VoiceSignal) => Promise<void>;
  handlePeerBlockedNotice: (byPlayerId: string, blocked: boolean) => void;
  handlePeerVoiceState: (playerId: string, enabled: boolean, muted: boolean) => void;
  syncBlockedFromAccount: () => Promise<void>;
  leaveRoomVoice: () => void;
}

interface ActivePeer {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement | null;
  pendingIce: RTCIceCandidateInit[];
  remoteDescSet: boolean;
  makingOffer: boolean;
  stopAnalyser: (() => void) | null;
}

let localStream: MediaStream | null = null;
let stopLocalAnalyser: (() => void) | null = null;
const activePeers = new Map<string, ActivePeer>();
const lastSentServerBlocks = new Map<string, boolean>();

function startSpeakingAnalyser(stream: MediaStream, onSpeaking: (speaking: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return () => {};

  let ctx: AudioContext | null = null;
  let rafId = 0;
  let timerId: number | null = null;
  let lastSpeaking = false;

  try {
    ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i];
      const avg = sum / data.length;
      const speaking = avg > 14;
      if (speaking !== lastSpeaking) {
        lastSpeaking = speaking;
        onSpeaking(speaking);
      }
      timerId = window.setTimeout(() => {
        rafId = window.requestAnimationFrame(tick);
      }, 120);
    };
    rafId = window.requestAnimationFrame(tick);
  } catch {
    return () => {};
  }

  return () => {
    if (timerId !== null) window.clearTimeout(timerId);
    if (rafId) window.cancelAnimationFrame(rafId);
    onSpeaking(false);
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
  };
}

function isEffectivelyMuted(state: Pick<VoiceState, 'enabled' | 'micMode' | 'micMuted' | 'pttActive'>): boolean {
  if (!state.enabled) return true;
  if (state.micMode === 'ptt') return !state.pttActive;
  return state.micMuted;
}

function updateLocalTrackEnabled(): void {
  const state = useVoiceStore.getState();
  const muted = isEffectivelyMuted(state);
  if (localStream) {
    for (const track of localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }
  if (state.enabled && state.myPlayerId) {
    transport?.sendState(true, muted);
  }
  if (muted && state.myPlayerId && state.speakingIds[state.myPlayerId]) {
    useVoiceStore.setState((s) => ({
      speakingIds: { ...s.speakingIds, [state.myPlayerId!]: false },
    }));
  }
}

function closePeer(peerId: string): void {
  const peer = activePeers.get(peerId);
  if (!peer) return;
  activePeers.delete(peerId);
  try {
    peer.stopAnalyser?.();
  } catch {
    // ignore
  }
  try {
    if (peer.audioEl) {
      peer.audioEl.pause();
      peer.audioEl.srcObject = null;
    }
  } catch {
    // ignore
  }
  try {
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
  } catch {
    // ignore
  }
  useVoiceStore.setState((s) => {
    if (!s.speakingIds[peerId]) return s;
    const next = { ...s.speakingIds };
    delete next[peerId];
    return { speakingIds: next };
  });
}

function applyAudioElementVolume(peerId: string, audioEl: HTMLAudioElement | null): void {
  if (!audioEl) return;
  const s = useVoiceStore.getState();
  const locallyMuted = s.localMutedIds.includes(peerId);
  const vol = s.peerVolumes[peerId] ?? 1;
  audioEl.muted = locallyMuted;
  audioEl.volume = Math.max(0, Math.min(1, vol));
}

function createPeerConnection(myPlayerId: string, peerId: string): ActivePeer {
  const existing = activePeers.get(peerId);
  if (existing) return existing;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const entry: ActivePeer = {
    pc,
    audioEl: null,
    pendingIce: [],
    remoteDescSet: false,
    makingOffer: false,
    stopAnalyser: null,
  };
  activePeers.set(peerId, entry);

  if (localStream) {
    for (const track of localStream.getAudioTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    transport?.sendSignal(peerId, {
      kind: 'ice',
      candidate: ev.candidate.candidate,
      sdpMid: ev.candidate.sdpMid,
      sdpMLineIndex: ev.candidate.sdpMLineIndex,
      usernameFragment: ev.candidate.usernameFragment,
    });
  };

  pc.ontrack = (ev) => {
    const stream = ev.streams[0] ?? new MediaStream([ev.track]);
    if (!entry.audioEl && typeof Audio !== 'undefined') {
      entry.audioEl = new Audio();
      entry.audioEl.autoplay = true;
    }
    if (entry.audioEl) {
      entry.audioEl.srcObject = stream;
      applyAudioElementVolume(peerId, entry.audioEl);
      void entry.audioEl.play().catch(() => {
        // Autoplay may wait for gesture; voice toggle itself is a user gesture.
      });
    }
    entry.stopAnalyser?.();
    entry.stopAnalyser = startSpeakingAnalyser(stream, (speaking) => {
      const s = useVoiceStore.getState();
      const allowed = isPeerAllowed(peerId, s.privacyMode, s.blockedIds, s.allowedIds, s.blockedByPeerIds);
      const val = allowed && !s.localMutedIds.includes(peerId) && speaking;
      useVoiceStore.setState((prev) => ({
        speakingIds: { ...prev.speakingIds, [peerId]: val },
      }));
    });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      closePeer(peerId);
    }
  };

  if (shouldInitiateOffer(myPlayerId, peerId)) {
    entry.makingOffer = true;
    void pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        if (pc.localDescription?.sdp) {
          transport?.sendSignal(peerId, { kind: 'offer', sdp: pc.localDescription.sdp });
        }
      })
      .catch(() => {})
      .finally(() => {
        entry.makingOffer = false;
      });
  }

  return entry;
}

function reconcilePeers(): void {
  const s = useVoiceStore.getState();
  const myId = s.myPlayerId;
  if (!s.enabled || !myId) {
    for (const peerId of [...activePeers.keys()]) {
      closePeer(peerId);
    }
    return;
  }

  const allowedSet = new Set<string>();
  for (const peerId of s.roomHumanPeerIds) {
    if (peerId === myId) continue;
    if (isPeerAllowed(peerId, s.privacyMode, s.blockedIds, s.allowedIds, s.blockedByPeerIds)) {
      allowedSet.add(peerId);
    }
  }

  for (const peerId of [...activePeers.keys()]) {
    if (!allowedSet.has(peerId)) {
      closePeer(peerId);
    }
  }

  for (const peerId of allowedSet) {
    if (!activePeers.has(peerId)) {
      createPeerConnection(myId, peerId);
    }
  }
}

function syncServerBlocksForPrivacyMode(): void {
  const s = useVoiceStore.getState();
  if (!s.myPlayerId) return;
  const currentPeers = new Set(s.roomHumanPeerIds);
  for (const cachedId of [...lastSentServerBlocks.keys()]) {
    if (!currentPeers.has(cachedId)) lastSentServerBlocks.delete(cachedId);
  }
  for (const peerId of s.roomHumanPeerIds) {
    if (peerId === s.myPlayerId) continue;
    const isBlockedByPolicy =
      s.blockedIds.includes(peerId) || (s.privacyMode === 'allow_only' && !s.allowedIds.includes(peerId));
    if (lastSentServerBlocks.get(peerId) !== isBlockedByPolicy) {
      lastSentServerBlocks.set(peerId, isBlockedByPolicy);
      transport?.sendBlock(peerId, isBlockedByPolicy);
    }
  }
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  enabled: false,
  connecting: false,
  error: null,
  micMode: loadMicMode(),
  micMuted: false,
  pttActive: false,
  privacyMode: loadPrivacyMode(),
  blockedIds: loadJsonArray(LS_BLOCKED_KEY),
  allowedIds: [],
  blockedByPeerIds: [],
  localMutedIds: [],
  peerVolumes: {},
  peerStates: {},
  speakingIds: {},
  myPlayerId: null,
  roomHumanPeerIds: [],

  enableVoice: async () => {
    if (get().enabled || get().connecting) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      set({ error: 'Voice chat is not supported in this browser.' });
      return;
    }
    set({ connecting: true, error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStream = stream;
      stopLocalAnalyser?.();
      stopLocalAnalyser = startSpeakingAnalyser(stream, (speaking) => {
        const st = get();
        if (!st.myPlayerId) return;
        const val = !isEffectivelyMuted(st) && speaking;
        set((prev) => ({ speakingIds: { ...prev.speakingIds, [st.myPlayerId!]: val } }));
      });
      set({ enabled: true, connecting: false, error: null });
      updateLocalTrackEnabled();
      syncServerBlocksForPrivacyMode();
      reconcilePeers();
    } catch (err) {
      const msg = err instanceof Error && err.name === 'NotAllowedError'
        ? 'Microphone permission denied. Allow mic access in your browser.'
        : 'Could not access microphone.';
      set({ enabled: false, connecting: false, error: msg });
    }
  },

  disableVoice: () => {
    for (const peerId of [...activePeers.keys()]) {
      closePeer(peerId);
    }
    stopLocalAnalyser?.();
    stopLocalAnalyser = null;
    if (localStream) {
      for (const track of localStream.getTracks()) track.stop();
      localStream = null;
    }
    set({ enabled: false, connecting: false, pttActive: false, speakingIds: {} });
    transport?.sendState(false, true);
  },

  setMicMuted: (muted) => {
    set({ micMuted: muted });
    updateLocalTrackEnabled();
  },

  toggleMicMuted: () => {
    set((s) => ({ micMuted: !s.micMuted }));
    updateLocalTrackEnabled();
  },

  setMicMode: (mode) => {
    try {
      localStorage.setItem(LS_MIC_MODE_KEY, mode);
    } catch {
      // ignore
    }
    set({ micMode: mode, pttActive: false });
    updateLocalTrackEnabled();
  },

  setPttActive: (active) => {
    if (get().pttActive === active) return;
    set({ pttActive: active });
    updateLocalTrackEnabled();
  },

  setPrivacyMode: (mode) => {
    try {
      localStorage.setItem(LS_PRIVACY_KEY, mode);
    } catch {
      // ignore
    }
    set({ privacyMode: mode });
    syncServerBlocksForPrivacyMode();
    reconcilePeers();
  },

  setPeerBlocked: (peerId, blocked) => {
    const current = get().blockedIds;
    const next = blocked
      ? current.includes(peerId) ? current : [...current, peerId]
      : current.filter((id) => id !== peerId);
    saveBlockedToLocal(next);
    void persistBlockedToServer(next);
    set((s) => ({
      blockedIds: next,
      allowedIds: blocked ? s.allowedIds.filter((id) => id !== peerId) : s.allowedIds,
    }));
    const st = get();
    const shouldServerBlock = blocked || (st.privacyMode === 'allow_only' && !st.allowedIds.includes(peerId));
    transport?.sendBlock(peerId, shouldServerBlock);
    reconcilePeers();
  },

  setPeerAllowed: (peerId, allowed) => {
    set((s) => {
      const nextAllowed = allowed
        ? s.allowedIds.includes(peerId) ? s.allowedIds : [...s.allowedIds, peerId]
        : s.allowedIds.filter((id) => id !== peerId);
      const nextBlocked = allowed ? s.blockedIds.filter((id) => id !== peerId) : s.blockedIds;
      if (allowed && nextBlocked.length !== s.blockedIds.length) {
        saveBlockedToLocal(nextBlocked);
        void persistBlockedToServer(nextBlocked);
      }
      return { allowedIds: nextAllowed, blockedIds: nextBlocked };
    });
    const st = get();
    const shouldServerBlock = st.blockedIds.includes(peerId) || (st.privacyMode === 'allow_only' && !allowed);
    transport?.sendBlock(peerId, shouldServerBlock);
    reconcilePeers();
  },

  setPeerLocalMuted: (peerId, muted) => {
    set((s) => ({
      localMutedIds: muted
        ? s.localMutedIds.includes(peerId) ? s.localMutedIds : [...s.localMutedIds, peerId]
        : s.localMutedIds.filter((id) => id !== peerId),
    }));
    const peer = activePeers.get(peerId);
    if (peer) applyAudioElementVolume(peerId, peer.audioEl);
  },

  setPeerVolume: (peerId, volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    set((s) => ({ peerVolumes: { ...s.peerVolumes, [peerId]: clamped } }));
    const peer = activePeers.get(peerId);
    if (peer) applyAudioElementVolume(peerId, peer.audioEl);
  },

  syncRoomPeers: (myPlayerId, seats) => {
    const humanIds = seats
      .filter((s) => s.occupant === 'human' && s.connected && s.playerId && s.playerId !== myPlayerId)
      .map((s) => s.playerId as string);
    set({ myPlayerId, roomHumanPeerIds: humanIds });
    syncServerBlocksForPrivacyMode();
    reconcilePeers();
  },

  handleIncomingSignal: async (fromPlayerId, signal) => {
    const s = get();
    if (!s.enabled || !s.myPlayerId) return;
    if (!isPeerAllowed(fromPlayerId, s.privacyMode, s.blockedIds, s.allowedIds, s.blockedByPeerIds)) {
      return;
    }

    const peer = createPeerConnection(s.myPlayerId, fromPlayerId);
    try {
      if (signal.kind === 'offer') {
        const polite = !shouldInitiateOffer(s.myPlayerId, fromPlayerId);
        if (peer.pc.signalingState !== 'stable') {
          if (!polite) return;
          await peer.pc.setLocalDescription({ type: 'rollback' });
        }
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        peer.remoteDescSet = true;
        for (const cand of peer.pendingIce.splice(0)) {
          await peer.pc.addIceCandidate(cand);
        }
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        if (peer.pc.localDescription?.sdp) {
          transport?.sendSignal(fromPlayerId, { kind: 'answer', sdp: peer.pc.localDescription.sdp });
        }
      } else if (signal.kind === 'answer') {
        if (peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          peer.remoteDescSet = true;
          for (const cand of peer.pendingIce.splice(0)) {
            await peer.pc.addIceCandidate(cand);
          }
        }
      } else if (signal.kind === 'ice') {
        const cand: RTCIceCandidateInit = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid ?? undefined,
          sdpMLineIndex: signal.sdpMLineIndex ?? undefined,
          usernameFragment: signal.usernameFragment ?? undefined,
        };
        if (peer.remoteDescSet) {
          await peer.pc.addIceCandidate(cand);
        } else {
          peer.pendingIce.push(cand);
        }
      }
    } catch {
      // Ignore transient WebRTC negotiation errors.
    }
  },

  handlePeerBlockedNotice: (byPlayerId, blocked) => {
    set((s) => ({
      blockedByPeerIds: blocked
        ? s.blockedByPeerIds.includes(byPlayerId) ? s.blockedByPeerIds : [...s.blockedByPeerIds, byPlayerId]
        : s.blockedByPeerIds.filter((id) => id !== byPlayerId),
    }));
    reconcilePeers();
  },

  handlePeerVoiceState: (playerId, enabled, muted) => {
    set((s) => ({
      peerStates: { ...s.peerStates, [playerId]: { enabled, muted } },
    }));
  },

  syncBlockedFromAccount: async () => {
    if (!transport?.getAuthToken || !transport.getHttpOrigin) return;
    try {
      const token = await transport.getAuthToken();
      if (!token) return;
      const res = await fetch(`${transport.getHttpOrigin()}/api/voice/blocks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean; blockedIds?: string[] };
      if (!data.ok || !Array.isArray(data.blockedIds)) return;
      const merged = Array.from(new Set([...get().blockedIds, ...data.blockedIds]));
      saveBlockedToLocal(merged);
      set({ blockedIds: merged });
      if (merged.length !== data.blockedIds.length) {
        void persistBlockedToServer(merged);
      }
      reconcilePeers();
    } catch {
      // ignore
    }
  },

  leaveRoomVoice: () => {
    lastSentServerBlocks.clear();
    get().disableVoice();
    set({
      allowedIds: [],
      blockedByPeerIds: [],
      localMutedIds: [],
      peerStates: {},
      speakingIds: {},
      myPlayerId: null,
      roomHumanPeerIds: [],
    });
  },
}));
