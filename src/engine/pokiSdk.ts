import { soundManager } from '../utils/soundManager';

export interface PokiSDKApi {
  init?: () => Promise<void>;
  gameLoadingFinished?: () => void;
  gameplayStart?: () => void;
  gameplayStop?: () => void;
  commercialBreak?: (fn?: () => void) => Promise<void>;
  rewardedBreak?: (fn?: () => void) => Promise<boolean>;
  setDebug?: (debug: boolean) => void;
}

interface PokiWindow extends Window {
  PokiSDK?: PokiSDKApi;
}

let initPromise: Promise<void> | null = null;
let loadingFinishedSent = false;
let gameplayActive = false;

function getPokiSdk(): PokiSDKApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as PokiWindow).PokiSDK;
}

/** Initializes PokiSDK once if present. Swallows errors so adblockers never block boot. */
export function initPokiSdk(): Promise<void> {
  if (initPromise) return initPromise;
  const sdk = getPokiSdk();
  if (!sdk?.init) {
    initPromise = Promise.resolve();
    return initPromise;
  }
  try {
    initPromise = Promise.resolve(sdk.init()).catch(() => undefined);
  } catch {
    initPromise = Promise.resolve();
  }
  return initPromise;
}

/** Notifies Poki that the initial interactive menu/game has finished loading (idempotent). */
export function notifyPokiLoadingFinished(): void {
  if (loadingFinishedSent) return;
  loadingFinishedSent = true;
  const sdk = getPokiSdk();
  try {
    sdk?.gameLoadingFinished?.();
  } catch {
    // Ignore SDK errors in non-portal or blocked environments.
  }
}

/** Tracks active gameplay state and emits Poki gameplayStart / gameplayStop only on transitions. */
export function setPokiGameplayActive(active: boolean): void {
  if (active === gameplayActive) return;
  gameplayActive = active;
  const sdk = getPokiSdk();
  try {
    if (active) {
      sdk?.gameplayStart?.();
    } else {
      sdk?.gameplayStop?.();
    }
  } catch {
    // Ignore SDK errors.
  }
}

/**
 * Runs a Poki ad break while muting game audio and pausing gameplay tracking.
 * Restores the previous mute and gameplay state when the ad finishes or throws.
 */
export async function runWithPokiAdLifecycle<T>(fn: () => Promise<T>): Promise<T> {
  const sdk = getPokiSdk();
  const wasMuted = soundManager.isMuted();
  const wasGameplayActive = gameplayActive;

  if (!wasMuted) {
    soundManager.setMuted(true);
  }
  if (wasGameplayActive) {
    try {
      sdk?.gameplayStop?.();
    } catch {
      // Ignore SDK errors.
    }
  }

  try {
    return await fn();
  } finally {
    if (!wasMuted) {
      soundManager.setMuted(false);
    }
    if (wasGameplayActive && gameplayActive) {
      try {
        sdk?.gameplayStart?.();
      } catch {
        // Ignore SDK errors.
      }
    }
  }
}

/** Resets module state for unit tests. */
export function resetPokiSdkStateForTest(): void {
  initPromise = null;
  loadingFinishedSent = false;
  gameplayActive = false;
}
