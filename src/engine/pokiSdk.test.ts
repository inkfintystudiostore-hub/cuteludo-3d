import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showInterstitialAd, showRewardedAd } from './adAdapter';
import {
  initPokiSdk,
  notifyPokiLoadingFinished,
  resetPokiSdkStateForTest,
  setPokiGameplayActive,
  type PokiSDKApi,
} from './pokiSdk';
import { soundManager } from '../utils/soundManager';

describe('pokiSdk lifecycle & adAdapter integration', () => {
  let mockSdk: Required<PokiSDKApi>;

  beforeEach(() => {
    resetPokiSdkStateForTest();
    soundManager.setMuted(false);
    mockSdk = {
      init: vi.fn(async () => undefined),
      gameLoadingFinished: vi.fn(),
      gameplayStart: vi.fn(),
      gameplayStop: vi.fn(),
      commercialBreak: vi.fn(async () => undefined),
      rewardedBreak: vi.fn(async () => true),
      setDebug: vi.fn(),
    };
    vi.stubGlobal('window', { PokiSDK: mockSdk });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    soundManager.setMuted(false);
    resetPokiSdkStateForTest();
  });

  it('initializes PokiSDK once and swallows init failures', async () => {
    mockSdk.init = vi.fn(async () => {
      throw new Error('blocked');
    });
    await expect(initPokiSdk()).resolves.toBeUndefined();
    await expect(initPokiSdk()).resolves.toBeUndefined();
    expect(mockSdk.init).toHaveBeenCalledTimes(1);
  });

  it('fires gameLoadingFinished only once', () => {
    notifyPokiLoadingFinished();
    notifyPokiLoadingFinished();
    expect(mockSdk.gameLoadingFinished).toHaveBeenCalledTimes(1);
  });

  it('fires gameplayStart and gameplayStop only on state transitions', () => {
    setPokiGameplayActive(false);
    expect(mockSdk.gameplayStart).not.toHaveBeenCalled();
    expect(mockSdk.gameplayStop).not.toHaveBeenCalled();

    setPokiGameplayActive(true);
    setPokiGameplayActive(true);
    expect(mockSdk.gameplayStart).toHaveBeenCalledTimes(1);
    expect(mockSdk.gameplayStop).not.toHaveBeenCalled();

    setPokiGameplayActive(false);
    setPokiGameplayActive(false);
    expect(mockSdk.gameplayStop).toHaveBeenCalledTimes(1);
  });

  it('mutes sound and pauses gameplay during Poki rewardedBreak, then restores both', async () => {
    setPokiGameplayActive(true);
    let mutedDuringAd = false;
    mockSdk.rewardedBreak = vi.fn(async () => {
      mutedDuringAd = soundManager.isMuted();
      return true;
    });

    const ok = await showRewardedAd();
    expect(ok).toBe(true);
    expect(mutedDuringAd).toBe(true);
    expect(soundManager.isMuted()).toBe(false);
    expect(mockSdk.gameplayStop).toHaveBeenCalledTimes(1);
    expect(mockSdk.gameplayStart).toHaveBeenCalledTimes(2);
  });

  it('preserves user mute state after commercialBreak even if the ad rejects', async () => {
    soundManager.setMuted(true);
    mockSdk.commercialBreak = vi.fn(async () => {
      throw new Error('network error');
    });

    const ok = await showInterstitialAd('match_complete');
    expect(ok).toBe(true);
    expect(soundManager.isMuted()).toBe(true);
  });
});
