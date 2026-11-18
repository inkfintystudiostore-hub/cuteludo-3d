import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPeerAllowed,
  registerVoiceTransport,
  shouldInitiateOffer,
  useVoiceStore,
} from './voiceStore';

describe('voiceStore permissions & signaling rules', () => {
  beforeEach(() => {
    registerVoiceTransport(null);
    useVoiceStore.setState({
      enabled: false,
      connecting: false,
      error: null,
      micMode: 'open',
      micMuted: false,
      pttActive: false,
      privacyMode: 'open',
      blockedIds: [],
      allowedIds: [],
      blockedByPeerIds: [],
      localMutedIds: [],
      peerVolumes: {},
      peerStates: {},
      speakingIds: {},
      myPlayerId: 'player-a',
      roomHumanPeerIds: ['player-b', 'player-c'],
    });
  });

  it('allows peers in open mode unless blocked by self or peer', () => {
    expect(isPeerAllowed('player-b', 'open', [], [], [])).toBe(true);
    expect(isPeerAllowed('player-b', 'open', ['player-b'], [], [])).toBe(false);
    expect(isPeerAllowed('player-b', 'open', [], [], ['player-b'])).toBe(false);
    expect(isPeerAllowed('', 'open', [], [], [])).toBe(false);
  });

  it('denies peers in allow_only mode unless explicitly allowed and unblocked', () => {
    expect(isPeerAllowed('player-b', 'allow_only', [], [], [])).toBe(false);
    expect(isPeerAllowed('player-b', 'allow_only', [], ['player-b'], [])).toBe(true);
    expect(isPeerAllowed('player-b', 'allow_only', ['player-b'], ['player-b'], [])).toBe(false);
    expect(isPeerAllowed('player-b', 'allow_only', [], ['player-b'], ['player-b'])).toBe(false);
  });

  it('uses deterministic offer initiation ordering to avoid glare', () => {
    expect(shouldInitiateOffer('player-a', 'player-b')).toBe(true);
    expect(shouldInitiateOffer('player-b', 'player-a')).toBe(false);
  });

  it('notifies transport on 2-way block and unblock', () => {
    const sendBlock = vi.fn();
    registerVoiceTransport({
      sendSignal: vi.fn(),
      sendBlock,
      sendState: vi.fn(),
    });

    useVoiceStore.getState().setPeerBlocked('player-b', true);
    expect(useVoiceStore.getState().blockedIds).toContain('player-b');
    expect(sendBlock).toHaveBeenCalledWith('player-b', true);

    useVoiceStore.getState().setPeerBlocked('player-b', false);
    expect(useVoiceStore.getState().blockedIds).not.toContain('player-b');
    expect(sendBlock).toHaveBeenCalledWith('player-b', false);
  });

  it('enforces allow_only mode via server blocks until explicitly allowed', () => {
    const sendBlock = vi.fn();
    registerVoiceTransport({
      sendSignal: vi.fn(),
      sendBlock,
      sendState: vi.fn(),
    });

    useVoiceStore.getState().setPrivacyMode('allow_only');
    expect(sendBlock).toHaveBeenCalledWith('player-b', true);
    expect(sendBlock).toHaveBeenCalledWith('player-c', true);

    sendBlock.mockClear();
    useVoiceStore.getState().setPeerAllowed('player-b', true);
    expect(useVoiceStore.getState().allowedIds).toContain('player-b');
    expect(sendBlock).toHaveBeenCalledWith('player-b', false);

    sendBlock.mockClear();
    useVoiceStore.getState().setPeerAllowed('player-b', false);
    expect(useVoiceStore.getState().allowedIds).not.toContain('player-b');
    expect(sendBlock).toHaveBeenCalledWith('player-b', true);
  });

  it('tracks when another peer blocks us and resets per-room state on leave', () => {
    useVoiceStore.getState().handlePeerBlockedNotice('player-c', true);
    expect(useVoiceStore.getState().blockedByPeerIds).toContain('player-c');

    useVoiceStore.getState().setPeerAllowed('player-b', true);
    useVoiceStore.getState().leaveRoomVoice();
    expect(useVoiceStore.getState().allowedIds).toEqual([]);
    expect(useVoiceStore.getState().blockedByPeerIds).toEqual([]);
    expect(useVoiceStore.getState().roomHumanPeerIds).toEqual([]);
  });
});
