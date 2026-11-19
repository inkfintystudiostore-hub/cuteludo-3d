import { useEffect, useRef, useState } from 'react';
import { registerAdFallbackHandler, registerInterstitialFallbackHandler } from '../engine/adAdapter';

const INK_BOX = 'border-[3px] border-ink shadow-ink';

/**
 * Global fallback overlay for rewarded & interstitial ads when not running inside Poki/CrazyGames/H5 AdSense.
 */
export function RewardedAdOverlay() {
  const [adState, setAdState] = useState<{
    mode: 'rewarded' | 'interstitial';
    totalSeconds: number;
    secondsLeft: number;
  } | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    registerAdFallbackHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolverRef.current = resolve;
          setAdState({ mode: 'rewarded', totalSeconds: 3, secondsLeft: 3 });
        }),
    );
    registerInterstitialFallbackHandler(
      (durationSec) =>
        new Promise<boolean>((resolve) => {
          const total = Math.max(1, Math.round(durationSec));
          resolverRef.current = resolve;
          setAdState({ mode: 'interstitial', totalSeconds: total, secondsLeft: total });
        }),
    );
    return () => {
      registerAdFallbackHandler(null);
      registerInterstitialFallbackHandler(null);
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!adState) return;
    if (adState.secondsLeft <= 0) {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      setAdState(null);
      resolve?.(true);
      return;
    }
    const timer = setTimeout(
      () => setAdState((s) => (s ? { ...s, secondsLeft: s.secondsLeft - 1 } : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [adState]);

  if (!adState) return null;

  const progress = ((adState.totalSeconds - adState.secondsLeft) / adState.totalSeconds) * 100;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={adState.mode === 'interstitial' ? 'Sponsored Break' : 'Rewarded Ad Preview'}
        className={`flex w-full max-w-xs flex-col items-center gap-3 rounded-3xl bg-[#fff8f5] p-5 text-center ${INK_BOX}`}
      >
        <span className="rounded-full border-2 border-ink bg-[#ffd875] px-3 py-0.5 text-[11px] font-bold uppercase">
          {adState.mode === 'interstitial' ? 'Sponsored Break' : 'Sponsored Reward'}
        </span>
        {adState.mode === 'interstitial' ? (
          <>
            <p className="text-base font-bold text-ink">
              Continuing in {adState.secondsLeft}s…
            </p>
            <a
              href="https://inkfinitystudio.store"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full rounded-2xl border-2 border-ink bg-[#ffe0ea] px-3 py-2.5 text-xs font-bold text-ink transition hover:bg-[#ffccd9]"
            >
              INKFINITY STUDIO — Custom 8K 3D Miniatures &amp; Gifts ↗
            </a>
          </>
        ) : (
          <p className="text-base font-bold text-ink">
            Reward unlocking in {adState.secondsLeft}s…
          </p>
        )}
        <div className="h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-white">
          <div
            className="h-full bg-[#80ed99] transition-all duration-700"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const resolve = resolverRef.current;
            resolverRef.current = null;
            setAdState(null);
            resolve?.(adState.mode === 'interstitial');
          }}
          className="cursor-pointer text-xs font-bold text-ink/60 underline hover:text-ink"
        >
          {adState.mode === 'interstitial' ? 'Skip' : 'Cancel (no reward)'}
        </button>
      </div>
    </div>
  );
}
