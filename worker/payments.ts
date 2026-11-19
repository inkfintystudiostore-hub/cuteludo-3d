import { getCoinPack } from '../src/engine/shopCatalog';
import { extractBearerToken, verifySessionToken } from './authHelpers';
import { FIREBASE_PROJECT_ID, verifyFirebaseIdToken } from './firebaseAuth';

export interface WalletNamespaceLike {
  idFromName(name: string): never;
  get(id: never): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

export interface PaymentEnv {
  AUTH_SECRET?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  PLAYER_WALLET?: {
    idFromName(name: string): any;
    get(id: any): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  };
}

async function resolveAuthenticatedPlayerId(request: Request, env: PaymentEnv): Promise<string | null> {
  const token = extractBearerToken(request);
  if (!token) return null;
  const fbClaims = await verifyFirebaseIdToken(token, FIREBASE_PROJECT_ID);
  if (fbClaims?.uid) return `acct:${fbClaims.uid}`;
  const session = await verifySessionToken(token, env.AUTH_SECRET);
  return session?.walletId ?? null;
}

async function claimPaymentTxGlobally(
  env: PaymentEnv,
  txId: string,
  playerId: string,
  packId: string,
): Promise<'claimed' | 'duplicate' | 'error'> {
  if (!env.PLAYER_WALLET || !txId) return 'error';
  try {
    const lockStub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(`tx-lock:${txId}`));
    const res = await lockStub.fetch('https://internal/claim-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, packId }),
    });
    if (res.status === 409) return 'duplicate';
    return res.ok ? 'claimed' : 'error';
  } catch {
    return 'error';
  }
}

async function creditServerWallet(
  env: PaymentEnv,
  playerId: string | undefined,
  coins: number,
  txId: string,
): Promise<boolean> {
  if (!env.PLAYER_WALLET || !playerId || coins <= 0) return false;
  try {
    const stub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(playerId));
    const res = await stub.fetch('https://internal/credit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: coins, txId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  if (!orderId || !paymentId || !signatureHex || !secret) return false;
  const expectedHex = await hmacSha256Hex(`${orderId}|${paymentId}`, secret);
  return timingSafeEqualHex(expectedHex, signatureHex.toLowerCase());
}

export async function verifyRazorpayWebhookSignature(
  rawBody: string,
  signatureHex: string,
  webhookSecret: string,
): Promise<boolean> {
  if (!rawBody || !signatureHex || !webhookSecret) return false;
  const expectedHex = await hmacSha256Hex(rawBody, webhookSecret);
  return timingSafeEqualHex(expectedHex, signatureHex.toLowerCase());
}

export async function handlePaymentRequest(
  request: Request,
  url: URL,
  env: PaymentEnv,
): Promise<Response | null> {
  if (url.pathname === '/api/payments/razorpay/order' && request.method === 'POST') {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return Response.json(
        { ok: false, configured: false, error: 'Razorpay is not configured on this server (missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).' },
        { status: 501 },
      );
    }
    const playerId = await resolveAuthenticatedPlayerId(request, env);
    if (!playerId) {
      return Response.json({ ok: false, error: 'Please sign in with Google before purchasing coins.' }, { status: 401 });
    }
    let body: { packId?: string };
    try {
      body = (await request.json()) as { packId?: string };
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    const pack = getCoinPack(body.packId);
    if (!pack) {
      return Response.json({ ok: false, error: 'Unknown coin pack' }, { status: 400 });
    }

    const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: pack.inrPaise,
        currency: 'INR',
        notes: {
          packId: pack.id,
          coins: String(pack.coins),
          playerId: playerId.slice(0, 64),
        },
      }),
    });
    const order = (await rzpRes.json()) as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
    if (!rzpRes.ok || !order.id) {
      return Response.json(
        { ok: false, error: order.error?.description ?? 'Razorpay order creation failed' },
        { status: 502 },
      );
    }
    return Response.json({
      ok: true,
      orderId: order.id,
      amount: order.amount ?? pack.inrPaise,
      currency: order.currency ?? 'INR',
      keyId: env.RAZORPAY_KEY_ID,
      packId: pack.id,
      coins: pack.coins,
    });
  }

  if (url.pathname === '/api/payments/razorpay/verify' && request.method === 'POST') {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return Response.json({ ok: false, configured: false, error: 'Razorpay not configured' }, { status: 501 });
    }
    const playerId = await resolveAuthenticatedPlayerId(request, env);
    if (!playerId) {
      return Response.json({ ok: false, error: 'Unauthorized payment verification' }, { status: 401 });
    }
    let body: {
      packId?: string;
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body.razorpay_order_id || !body.razorpay_payment_id || !body.razorpay_signature) {
      return Response.json({ ok: false, error: 'Missing payment verification fields' }, { status: 400 });
    }

    const valid = await verifyRazorpaySignature(
      body.razorpay_order_id,
      body.razorpay_payment_id,
      body.razorpay_signature,
      env.RAZORPAY_KEY_SECRET,
    );
    if (!valid) {
      return Response.json({ ok: false, error: 'Invalid Razorpay signature' }, { status: 400 });
    }

    // Authoritatively fetch order & payment from Razorpay to prevent pack-swap / amount tampering.
    const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const [orderRes, payRes] = await Promise.all([
      fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(body.razorpay_order_id)}`, {
        headers: { Authorization: `Basic ${auth}` },
      }),
      fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(body.razorpay_payment_id)}`, {
        headers: { Authorization: `Basic ${auth}` },
      }),
    ]);
    if (!orderRes.ok || !payRes.ok) {
      return Response.json({ ok: false, error: 'Could not verify payment with Razorpay' }, { status: 502 });
    }
    const rzpOrder = (await orderRes.json()) as {
      id?: string;
      amount?: number;
      currency?: string;
      notes?: { packId?: string; playerId?: string };
    };
    const rzpPayment = (await payRes.json()) as {
      id?: string;
      order_id?: string;
      amount?: number;
      currency?: string;
      status?: string;
    };
    const authoritativePack = getCoinPack(rzpOrder.notes?.packId);
    if (
      !authoritativePack ||
      rzpOrder.amount !== authoritativePack.inrPaise ||
      rzpOrder.currency !== 'INR' ||
      (rzpOrder.notes?.playerId && rzpOrder.notes.playerId !== playerId) ||
      rzpPayment.order_id !== body.razorpay_order_id ||
      rzpPayment.amount !== authoritativePack.inrPaise ||
      rzpPayment.currency !== 'INR' ||
      (rzpPayment.status !== 'captured' && rzpPayment.status !== 'authorized')
    ) {
      return Response.json({ ok: false, error: 'Payment amount or order details mismatch' }, { status: 400 });
    }

    const claimState = await claimPaymentTxGlobally(env, body.razorpay_payment_id, playerId, authoritativePack.id);
    if (claimState === 'duplicate') {
      return Response.json({ ok: false, error: 'Payment already redeemed' }, { status: 409 });
    }
    if (claimState === 'error') {
      return Response.json({ ok: false, error: 'Could not lock payment transaction' }, { status: 500 });
    }

    const credited = await creditServerWallet(env, playerId, authoritativePack.coins, body.razorpay_payment_id);
    if (!credited) {
      return Response.json({ ok: false, error: 'Failed to credit wallet; contact support with payment ID.' }, { status: 500 });
    }
    return Response.json({ ok: true, txId: body.razorpay_payment_id, packId: authoritativePack.id, coins: authoritativePack.coins });
  }

  if (url.pathname === '/api/payments/razorpay/webhook' && request.method === 'POST') {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      return Response.json({ ok: false, configured: false, error: 'RAZORPAY_WEBHOOK_SECRET not configured' }, { status: 501 });
    }
    const signature = request.headers.get('x-razorpay-signature') ?? '';
    const rawBody = await request.text();
    const valid = await verifyRazorpayWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
    if (!valid) {
      return Response.json({ ok: false, error: 'Invalid webhook signature' }, { status: 400 });
    }
    let eventName = 'unknown';
    try {
      const parsed = JSON.parse(rawBody) as {
        event?: string;
        payload?: { payment?: { entity?: { id?: string; notes?: { packId?: string; playerId?: string } } } };
      };
      if (parsed.event) eventName = parsed.event;
      const entity = parsed.payload?.payment?.entity;
      if ((eventName === 'payment.captured' || eventName === 'order.paid') && entity?.id) {
        const pack = getCoinPack(entity.notes?.packId);
        if (pack && entity.notes?.playerId) {
          const claimState = await claimPaymentTxGlobally(env, entity.id, entity.notes.playerId, pack.id);
          if (claimState === 'claimed') {
            await creditServerWallet(env, entity.notes.playerId, pack.coins, entity.id);
          }
        }
      }
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
    }
    return Response.json({ ok: true, received: eventName });
  }

  return null;
}
