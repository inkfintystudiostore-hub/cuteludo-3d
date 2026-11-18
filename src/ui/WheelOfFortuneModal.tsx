import { useEffect, useRef, useState } from 'react';
import {
  registerAdFallbackHandler,
  registerInterstitialFallbackHandler,
  showRewardedAd,
} from '../engine/adAdapter';
import { RESCUE_COINS, STREAK_REWARDS, useWalletStore } from '../engine/walletStore';
import { soundManager } from '../utils/soundManager';

const WHEEL_SEGMENTS = [
  { label: '50', coins: 50, color: '#ffe0ea' },
  { label: '250', coins: 250, color: '#a9f0ff' },
  { label: '100', coins: 100, color: '#ffd875' },
  { label: '500', coins: 500, color: '#80ed99' },
  { label: '75', coins: 75, color: '#ff8fab' },
  { label: '150', coins: 150, color: '#bde0fe' },
  { label: '25', coins: 25, color: '#fff0b3' },
  { label: '1000', coins: 1000, color: '#c8f7dc' },
] as const;

const SLICE_DEG = 360 / WHEEL_SEGMENTS.length;
const INK_BOX = 'border-[3px] border-ink shadow-ink';
const INK_BTN =
  'cursor-pointer border-[3px] border-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink';

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

export function WheelOfFortuneModal({ onClose }: { onClose: () => void }) {
  const balance = useWalletStore((s) => s.balance);
  const canFreeSpin = useWalletStore((s) => s.canFreeSpin());
  const remainingAdSpins = useWalletStore((s) => s.remainingAdSpins());
  const recordSpin = useWalletStore((s) => s.recordSpin);
  const streakDay = useWalletStore((s) => s.streakDay);
  const canClaimStreak = useWalletStore((s) => s.canClaimStreak());
  const claimStreak = useWalletStore((s) => s.claimStreak);
  const remainingRescues = useWalletStore((s) => s.remainingRescues());
  const claimRescue = useWalletStore((s) => s.claimRescue);

  const [spinning, setSpinning] = useState(false);
  const [adLoading, setAdLoading] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [wonCoins, setWonCoins] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    };
  }, []);

  const conicGradient = WHEEL_SEGMENTS.map(
    (seg, idx) => `${seg.color} ${idx * SLICE_DEG}deg ${(idx + 1) * SLICE_DEG}deg`,
  ).join(', ');

  const startSpin = async (isFree: boolean) => {
    if (spinning || adLoading) return;
    setWonCoins(null);
    setStatusMsg(null);

    if (!isFree) {
      setAdLoading(true);
      const watched = await showRewardedAd();
      setAdLoading(false);
      if (!watched) {
        setStatusMsg('Ad skipped — watch full ad to spin!');
        return;
      }
    }

    const winIndex = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
    const prize = WHEEL_SEGMENTS[winIndex].coins;
    // Pointer is at 0deg (top). Segment i spans [i*SLICE_DEG, (i+1)*SLICE_DEG].
    // Rotating clockwise by targetAngle puts segment center under 0deg.
    const segmentCenter = winIndex * SLICE_DEG + SLICE_DEG / 2;
    const desiredMod = (360 - segmentCenter) % 360;
    const currentMod = ((rotation % 360) + 360) % 360;
    const delta = (desiredMod - currentMod + 360) % 360;
    const nextRotation = rotation + 5 * 360 + delta;

    setSpinning(true);
    setRotation(nextRotation);
    soundManager.playDiceTap();

    spinTimerRef.current = setTimeout(() => {
      recordSpin(isFree, prize);
      setSpinning(false);
      setWonCoins(prize);
      soundManager.playStarChime();
    }, 3400);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-3 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wheel-title"
        className={`flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-[#fff8f5] p-5 text-center motion-safe:animate-[pop-in_0.3s_ease-out] ${INK_BOX}`}
      >
        <div className="flex w-full items-center justify-between">
          <span className="rounded-full border-2 border-ink bg-[#ffd875] px-3 py-0.5 text-xs font-bold">
            🪙 {balance.toLocaleString()}
          </span>
          <button
            type="button"
            disabled={spinning}
            onClick={onClose}
            className={`rounded-full bg-white px-3 py-0.5 text-xs font-bold uppercase disabled:opacity-50 ${INK_BTN}`}
          >
            Close
          </button>
        </div>

        <div>
          <h2 id="wheel-title" className="text-xl font-bold tracking-wide uppercase">
            Wheel of Fortune
          </h2>
          <p className="text-[11px] font-semibold text-ink/70">
            1 Free daily spin + up to 3 rewarded ad spins!
          </p>
        </div>

        {/* Wheel Container */}
        <div className="relative my-1 grid size-56 place-items-center">
          {/* Top Pointer */}
          <div
            aria-hidden
            className="absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 border-x-[10px] border-t-[18px] border-x-transparent border-t-ink drop-shadow-[0_2px_0_#fff]"
          />
          <div
            className="relative size-full rounded-full border-[4px] border-ink shadow-ink"
            style={{
              background: `conic-gradient(${conicGradient})`,
              transform: `rotate(${rotation}deg)`,
              transition: spinning ? 'transform 3.3s cubic-bezier(0.15, 0.85, 0.25, 1)' : 'none',
            }}
          >
            {WHEEL_SEGMENTS.map((seg, idx) => {
              const angle = idx * SLICE_DEG + SLICE_DEG / 2;
              return (
                <div
                  key={seg.label + idx}
                  className="absolute inset-0 flex justify-center pt-3.5"
                  style={{ transform: `rotate(${angle}deg)` }}
                >
                  <span className="text-xs font-extrabold text-ink">{seg.label}</span>
                </div>
              );
            })}
            <div className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-ink bg-[#fff8f5] text-base shadow-ink-sm">
              🪙
            </div>
          </div>
        </div>

        {wonCoins !== null && (
          <div className="rounded-2xl border-2 border-ink bg-[#80ed99] px-4 py-1.5 text-sm font-bold text-ink">
            🎉 You won +{wonCoins} Coins!
          </div>
        )}
        {statusMsg && <p className="text-xs font-bold text-[#d90429]">{statusMsg}</p>}

        <div className="flex w-full flex-col gap-2">
          {canFreeSpin ? (
            <button
              type="button"
              disabled={spinning || adLoading}
              onClick={() => startSpin(true)}
              className={`min-h-11 w-full rounded-2xl bg-[#80ed99] px-4 text-sm font-bold uppercase disabled:opacity-60 ${INK_BTN}`}
            >
              {spinning ? 'Spinning…' : 'Spin Free Daily Wheel'}
            </button>
          ) : (
            <button
              type="button"
              disabled={spinning || adLoading || remainingAdSpins <= 0}
              onClick={() => startSpin(false)}
              className={`min-h-11 w-full rounded-2xl bg-[#ffd875] px-4 text-sm font-bold uppercase disabled:cursor-not-allowed disabled:opacity-55 ${INK_BTN}`}
            >
              {adLoading
                ? 'Loading Ad…'
                : spinning
                  ? 'Spinning…'
                  : remainingAdSpins > 0
                    ? `Watch Ad & Spin (${remainingAdSpins} left today)`
                    : 'No Spins Left Today'}
            </button>
          )}

          {balance < 50 && remainingRescues > 0 && (
            <button
              type="button"
              disabled={spinning || adLoading}
              onClick={async () => {
                setAdLoading(true);
                const ok = await showRewardedAd();
                setAdLoading(false);
                if (ok) {
                  const got = claimRescue();
                  if (got > 0) {
                    setWonCoins(got);
                    soundManager.playStarChime();
                  }
                }
              }}
              className={`min-h-10 w-full rounded-2xl bg-[#a9f0ff] px-3 text-xs font-bold uppercase ${INK_BTN}`}
            >
              🆘 Low Coins! Watch Ad for +{RESCUE_COINS} 🪙 ({remainingRescues} left)
            </button>
          )}

          {/* 7-Day Login Streak */}
          <div className="mt-1 flex flex-col gap-1.5 rounded-2xl border-2 border-ink bg-white p-2.5">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase">
              <span>7-Day Streak</span>
              {canClaimStreak ? (
                <button
                  type="button"
                  onClick={() => {
                    const got = claimStreak();
                    if (got > 0) {
                      setWonCoins(got);
                      soundManager.playStarChime();
                    }
                  }}
                  className="cursor-pointer rounded-full border border-ink bg-[#80ed99] px-2 py-0.5 text-[10px] font-extrabold hover:brightness-95"
                >
                  Claim +{STREAK_REWARDS[streakDay % STREAK_REWARDS.length]} 🪙
                </button>
              ) : (
                <span className="text-ink/55">Claimed Today ✓</span>
              )}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {STREAK_REWARDS.map((reward, idx) => {
                const isNext = idx === streakDay % STREAK_REWARDS.length;
                const claimed = idx < streakDay;
                return (
                  <div
                    key={idx}
                    className={`flex flex-col items-center rounded-lg border border-ink py-1 text-[9px] font-bold ${
                      claimed
                        ? 'bg-[#80ed99]/60 text-ink/65'
                        : isNext && canClaimStreak
                          ? 'bg-[#ffd875] ring-2 ring-ink/30'
                          : 'bg-[#fff8f5]'
                    }`}
                  >
                    <span>D{idx + 1}</span>
                    <span>{reward >= 1000 ? '1K' : reward}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
