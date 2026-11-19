import { useState } from 'react';
import { getHttpOrigin, getWalletAuthHeaders, getWalletPlayerId } from '../engine/multiplayerClient';
import { COIN_PACKS, type CoinPack } from '../engine/shopCatalog';
import { useWalletStore } from '../engine/walletStore';
import { soundManager } from '../utils/soundManager';

const INK_BOX = 'border-[3px] border-ink shadow-ink';
const INK_BTN =
  'cursor-pointer border-[3px] border-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink';
const CREDITED_TX_KEY = 'chibi_ludo_credited_txs';

interface RazorpayCheckoutInstance {
  open(): void;
}

interface RazorpayWindow extends Window {
  Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckoutInstance;
}

export function claimCreditedTxOnce(txId: string, coins: number): boolean {
  if (!txId || coins <= 0) return false;
  try {
    const raw = window.localStorage.getItem(CREDITED_TX_KEY);
    const seen = raw ? (JSON.parse(raw) as string[]) : [];
    if (seen.includes(txId)) return false;
    seen.push(txId);
    window.localStorage.setItem(CREDITED_TX_KEY, JSON.stringify(seen.slice(-50)));
  } catch {
    // Proceed if storage is unavailable.
  }
  useWalletStore.getState().credit(coins, txId);
  soundManager.playStarChime();
  return true;
}

function loadRazorpayScript(): Promise<boolean> {
  const win = window as RazorpayWindow;
  if (win.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(Boolean((window as RazorpayWindow).Razorpay));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export function CoinShopModal({ onClose }: { onClose: () => void }) {
  const balance = useWalletStore((s) => s.balance);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const handleRazorpayCheckout = async (pack: CoinPack) => {
    setBusyPackId(pack.id);
    setNotice(null);
    try {
      const origin = getHttpOrigin();
      const authHeaders = await getWalletAuthHeaders();
      const orderRes = await fetch(`${origin}/api/payments/razorpay/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ packId: pack.id, playerId: getWalletPlayerId() }),
      });
      const order = (await orderRes.json()) as {
        ok?: boolean;
        orderId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
        error?: string;
      };
      if (!orderRes.ok || !order.ok || !order.orderId || !order.keyId) {
        setNotice({ tone: 'err', text: order.error ?? 'Could not create Razorpay order.' });
        return;
      }

      const loaded = await loadRazorpayScript();
      const RazorpayCtor = (window as RazorpayWindow).Razorpay;
      if (!loaded || !RazorpayCtor) {
        setNotice({ tone: 'err', text: 'Failed to load Razorpay checkout script.' });
        return;
      }

      const rzp = new RazorpayCtor({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Chibi Ludo 3D',
        description: `${pack.coins.toLocaleString()} Coins`,
        order_id: order.orderId,
        theme: { color: '#ff8fab' },
        handler: async (resp: {
          razorpay_order_id?: string;
          razorpay_payment_id?: string;
          razorpay_signature?: string;
        }) => {
          const verifyAuthHeaders = await getWalletAuthHeaders();
          const verifyRes = await fetch(`${origin}/api/payments/razorpay/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...verifyAuthHeaders },
            body: JSON.stringify({
              packId: pack.id,
              playerId: getWalletPlayerId(),
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            }),
          });
          const verified = (await verifyRes.json()) as { ok?: boolean; txId?: string; coins?: number; error?: string };
          if (verifyRes.ok && verified.ok && verified.txId && typeof verified.coins === 'number') {
            claimCreditedTxOnce(verified.txId, verified.coins);
            setNotice({ tone: 'ok', text: `Added +${verified.coins.toLocaleString()} coins!` });
          } else {
            setNotice({ tone: 'err', text: verified.error ?? 'Payment verification failed.' });
          }
        },
      });
      rzp.open();
    } catch {
      setNotice({ tone: 'err', text: 'Payment server unreachable. Try again shortly.' });
    } finally {
      setBusyPackId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-3 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coin-shop-title"
        className={`flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-3xl bg-[#fff8f5] p-5 motion-safe:animate-[pop-in_0.3s_ease-out] ${INK_BOX}`}
      >
        <div className="flex items-center justify-between">
          <span className="rounded-full border-2 border-ink bg-[#ffd875] px-3 py-0.5 text-xs font-bold">
            🪙 {balance.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-full bg-white px-3 py-0.5 text-xs font-bold uppercase ${INK_BTN}`}
          >
            Close
          </button>
        </div>

        <div className="text-center">
          <h2 id="coin-shop-title" className="text-xl font-bold tracking-wide uppercase">
            Coin Shop
          </h2>
          <p className="text-[11px] font-semibold text-ink/70">
            Top up coins for high-stake tables &amp; animated GIF reactions.
          </p>
        </div>

        {notice && (
          <p
            role="status"
            className={`rounded-2xl border-2 border-ink px-3 py-2 text-center text-xs font-bold ${
              notice.tone === 'ok' ? 'bg-[#80ed99] text-ink' : 'bg-[#ffe0ea] text-[#9b0020]'
            }`}
          >
            {notice.text}
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          {COIN_PACKS.map((pack) => (
            <div
              key={pack.id}
              className="flex items-center justify-between gap-3 rounded-2xl border-[3px] border-ink bg-white p-3 shadow-ink-sm"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-ink text-lg"
                  style={{ backgroundColor: pack.accent }}
                >
                  🪙
                </span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-extrabold">{pack.coins.toLocaleString()}</span>
                    {pack.badge && (
                      <span className="rounded-full border border-ink bg-[#ff8fab] px-1.5 py-0.5 text-[9px] font-extrabold uppercase">
                        {pack.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-ink/65">UPI / Card / NetBanking</span>
                </div>
              </div>

              <button
                type="button"
                disabled={busyPackId !== null}
                onClick={() => handleRazorpayCheckout(pack)}
                className={`min-h-10 shrink-0 rounded-xl bg-[#ffd875] px-4 text-xs font-extrabold uppercase disabled:opacity-60 ${INK_BTN}`}
              >
                {busyPackId === pack.id ? 'Opening…' : `Buy ${pack.inrLabel}`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
