/**
 * Portal-agnostic rewarded & interstitial video ad adapter.
 * Uses PokiSDK, CrazyGames SDK, or Google H5 Games Ads (adBreak) when available;
 * falls back to an in-app preview callback for standalone web/dev.
 */

interface H5RewardedConfig {
  type: 'reward';
  name: string;
  beforeReward: (showAdFn: () => void) => void;
  adDismissed: () => void;
  adViewed: () => void;
  adBreakDone?: (placementInfo: { breakStatus?: string }) => void;
}

interface H5InterstitialConfig {
  type: 'next' | 'start' | 'browse';
  name: string;
  beforeAd?: () => void;
  afterAd?: () => void;
  adBreakDone?: (placementInfo: { breakStatus?: string }) => void;
}

type H5AdBreakConfig = H5RewardedConfig | H5InterstitialConfig;

interface PortalWindow extends Window {
  PokiSDK?: {
    rewardedBreak?: () => Promise<boolean>;
    commercialBreak?: () => Promise<void>;
  };
  CrazyGames?: {
    SDK?: {
      ad?: {
        requestAd?: (type: 'midgame' | 'rewarded') => Promise<void>;
      };
    };
  };
  adBreak?: (config: H5AdBreakConfig) => void;
}

export type AdFallbackHandler = () => Promise<boolean>;
export type InterstitialFallbackHandler = (durationSec: number) => Promise<boolean>;

let fallbackHandler: AdFallbackHandler | null = null;
let interstitialFallbackHandler: InterstitialFallbackHandler | null = null;

export function registerAdFallbackHandler(handler: AdFallbackHandler | null): void {
  fallbackHandler = handler;
}

export function registerInterstitialFallbackHandler(handler: InterstitialFallbackHandler | null): void {
  interstitialFallbackHandler = handler;
}

function showH5RewardedAd(adBreak: (config: H5AdBreakConfig) => void): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 3000);
    try {
      adBreak({
        type: 'reward',
        name: 'rewarded_coins',
        beforeReward: (showAdFn) => {
          clearTimeout(timer);
          showAdFn();
        },
        adDismissed: () => finish(false),
        adViewed: () => finish(true),
        adBreakDone: (info) => {
          clearTimeout(timer);
          if (info?.breakStatus && info.breakStatus !== 'viewed') {
            finish(false);
          }
        },
      });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

export async function showRewardedAd(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const win = window as PortalWindow;

  if (win.PokiSDK?.rewardedBreak) {
    try {
      return await win.PokiSDK.rewardedBreak();
    } catch {
      return false;
    }
  }

  if (win.CrazyGames?.SDK?.ad?.requestAd) {
    try {
      await win.CrazyGames.SDK.ad.requestAd('rewarded');
      return true;
    } catch {
      return false;
    }
  }

  if (win.adBreak) {
    const ok = await showH5RewardedAd(win.adBreak);
    if (ok) return true;
  }

  if (fallbackHandler) {
    return await fallbackHandler();
  }

  // shortcut: headless/fallback without UI overlay resolves true for dev testing; swap with real ad SDK in production
  return true;
}

function showH5InterstitialAd(
  adBreak: (config: H5AdBreakConfig) => void,
  placementName: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 3000);
    try {
      adBreak({
        type: 'next',
        name: placementName,
        beforeAd: () => clearTimeout(timer),
        afterAd: () => finish(true),
        adBreakDone: (info) => {
          clearTimeout(timer);
          finish(info?.breakStatus === 'viewed' || info?.breakStatus === 'dismissed');
        },
      });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

export async function showInterstitialAd(
  placementName = 'create_private_room',
  fallbackDurationSec = 5,
): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  const win = window as PortalWindow;

  if (win.PokiSDK?.commercialBreak) {
    try {
      await win.PokiSDK.commercialBreak();
      return true;
    } catch {
      return true;
    }
  }

  if (win.CrazyGames?.SDK?.ad?.requestAd) {
    try {
      await win.CrazyGames.SDK.ad.requestAd('midgame');
      return true;
    } catch {
      return true;
    }
  }

  if (win.adBreak) {
    const shown = await showH5InterstitialAd(win.adBreak, placementName);
    if (shown) return true;
  }

  if (interstitialFallbackHandler) {
    return await interstitialFallbackHandler(fallbackDurationSec);
  }

  return true;
}
