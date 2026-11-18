import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../engine/authStore';
import { useWalletStore } from '../engine/walletStore';

interface AuthModalProps {
  open: boolean;
  reason?: string | null;
  playerName: string;
  onSavePlayerName: (name: string) => void;
  onClose: () => void;
  onAuthenticated?: (displayName: string) => void;
}

const INK_BOX = 'border-[3px] border-ink shadow-ink';
const INK_BTN =
  'border-[2.5px] border-ink shadow-ink-sm transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none cursor-pointer';

export function AuthModal({ open, reason, playerName, onSavePlayerName, onClose, onAuthenticated }: AuthModalProps) {
  const account = useAuthStore((s) => s.account);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const cancelPendingLogin = useAuthStore((s) => s.cancelPendingLogin);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const logout = useAuthStore((s) => s.logout);
  const balance = useWalletStore((s) => s.balance);
  const wasSignedOutRef = useRef(false);
  const [draftName, setDraftName] = useState(playerName);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!open) {
      wasSignedOutRef.current = false;
      cancelPendingLogin();
      return;
    }
    setDraftName(playerName);
    setSavedNotice(false);
    wasSignedOutRef.current = !useAuthStore.getState().account;
    clearError();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelPendingLogin();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, playerName, onClose, clearError, cancelPendingLogin]);

  useEffect(() => {
    if (open && account && wasSignedOutRef.current) {
      wasSignedOutRef.current = false;
      onAuthenticated?.(account.displayName);
      onClose();
    }
  }, [open, account, onAuthenticated, onClose]);

  if (!open) return null;

  const handleGoogle = async () => {
    const ok = await loginWithGoogle();
    if (ok && wasSignedOutRef.current) {
      wasSignedOutRef.current = false;
      const acc = useAuthStore.getState().account;
      if (acc && onAuthenticated) {
        onAuthenticated(acc.displayName);
      }
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-3 backdrop-blur-xs sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className={`relative flex w-full max-w-md flex-col gap-3 rounded-3xl bg-[#fff8f5] p-5 motion-safe:animate-[pop-in_0.25s_ease-out] ${INK_BOX}`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2
            id="auth-modal-title"
            className={`-skew-x-6 rounded-xl bg-[#a9f0ff] px-3 py-0.5 text-lg font-bold tracking-wider uppercase ${INK_BOX}`}
          >
            Player Profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile modal"
            className={`grid size-8 place-items-center rounded-xl bg-white text-sm font-bold ${INK_BTN}`}
          >
            ✕
          </button>
        </div>

        {/* Display Name Editor (inside Profile) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSavePlayerName(draftName.trim().slice(0, 18));
            setSavedNotice(true);
            setTimeout(() => setSavedNotice(false), 1600);
          }}
          className="flex flex-col gap-1.5 rounded-2xl border-[2.5px] border-ink bg-white p-3 shadow-ink-sm"
        >
          <label htmlFor="profile-display-name" className="text-[11px] font-bold tracking-wider text-ink/70 uppercase">
            Display Name
          </label>
          <div className="flex gap-2">
            <input
              id="profile-display-name"
              type="text"
              maxLength={18}
              placeholder="Enter your name"
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value);
                if (savedNotice) setSavedNotice(false);
              }}
              className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-[#fff8f5] px-2.5 py-1.5 text-[16px] leading-5 font-bold text-ink placeholder:font-medium placeholder:text-ink/45 focus:outline-none sm:text-xs"
            />
            <button
              type="submit"
              className={`shrink-0 rounded-xl bg-[#80ed99] px-3 py-1.5 text-xs font-bold uppercase ${INK_BTN}`}
            >
              {savedNotice ? 'Saved!' : 'Save'}
            </button>
          </div>
          <p className="text-[10px] font-semibold text-ink/65">
            Shown in Quick Match, Solo games, and Friend Rooms (max 18 chars).
          </p>
        </form>

        {account ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border-[2.5px] border-ink bg-white p-3.5 shadow-ink-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold tracking-wider text-ink/60 uppercase">Signed In With Google</div>
                  <div className="truncate text-base font-bold text-ink">{account.displayName}</div>
                  {account.email && (
                    <div className="truncate text-xs font-semibold text-ink/75">{account.email}</div>
                  )}
                </div>
                <span className="shrink-0 rounded-full border-2 border-ink bg-[#ffd875] px-3 py-1 text-xs font-bold shadow-ink-sm">
                  🪙 {balance.toLocaleString()}
                </span>
              </div>
              <div className="mt-2.5 rounded-xl border-2 border-ink bg-[#80ed99]/40 px-3 py-2 text-xs font-semibold text-ink">
                Your coins, daily streak, and purchases are synced to your Google account across all browsers &amp; devices.
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void logout();
                  onClose();
                }}
                className={`flex-1 rounded-2xl bg-[#ffe0ea] px-4 py-2.5 text-sm font-bold uppercase ${INK_BTN}`}
              >
                Log Out
              </button>
              <button
                type="button"
                onClick={onClose}
                className={`flex-1 rounded-2xl bg-[#ffd875] px-4 py-2.5 text-sm font-bold uppercase ${INK_BTN}`}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {reason ? (
              <div className="rounded-xl border-2 border-ink bg-[#ffd875]/60 px-3 py-2 text-xs leading-snug font-bold text-ink">
                {reason}
              </div>
            ) : null}
            <p className="text-xs leading-snug font-semibold text-ink/80">
              Sign in with the <span className="font-bold">Google account</span> already logged into your browser so your{' '}
              <span className="font-bold">🪙 {balance.toLocaleString()} coins</span> and daily streak stay synced everywhere.
            </p>

            <button
              type="button"
              disabled={loading}
              onClick={handleGoogle}
              className={`flex min-h-12 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#a9f0ff] px-4 py-2.5 text-sm font-bold text-ink disabled:cursor-wait disabled:opacity-70 ${INK_BTN}`}
            >
              <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.09.73-2.48 1.16-4.22 1.16-3.24 0-5.99-2.19-6.97-5.13H1.03v3.14C3.05 21.18 7.21 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.03 14.02c-.25-.73-.39-1.51-.39-2.32s.14-1.59.39-2.32V6.24H1.03A11.98 11.98 0 0 0 0 11.7c0 1.94.46 3.77 1.03 5.46l4-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.8 0 3.41.62 4.68 1.84l3.51-3.51C18.07 1.19 15.3 0 12 0 7.21 0 3.05 2.82 1.03 6.84l4 3.14c.98-2.94 3.73-5.23 6.97-5.23Z"
                />
              </svg>
              {loading ? 'Signing in…' : 'Continue with Google'}
            </button>

            {loading && (
              <button
                type="button"
                onClick={cancelPendingLogin}
                className="cursor-pointer self-center text-xs font-bold text-ink/65 underline underline-offset-2 hover:text-ink"
              >
                Cancel sign-in
              </button>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-xl border-2 border-ink bg-[#ffccd5] px-3 py-2 text-xs font-bold text-ink"
              >
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
