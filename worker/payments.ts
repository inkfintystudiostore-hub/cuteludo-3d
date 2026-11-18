import { getCoinPack } from '../src/engine/shopCatalog';

export interface WalletNamespaceLike {
  idFromName(name: string): never;
  get(id: never): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

export interface PaymentEnv {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  PLAYER_WALLET?: {
    idFromName(name: string): any;
    get(id: any): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  };
}

async function creditServerWallet(
  env: PaymentEnv,
  playerId: string | undefined,
  coins: number,
  txId: string,
): Promise<void> {
  if (!env.PLAYER_WALLET || !playerId || coins <= 0) return;
  try {
    const stub = env.PLAYER_WALLET.get(env.PLAYER_WALLET.idFromName(playerId));
    await stub.fetch('https://internal/credit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: coins, txId }),
    });
  } catch {
    // Non-fatal; client verification still returns verified txId.
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
    let body: { packId?: string; playerId?: string };
    try {
      body = (await request.json()) as { packId?: string; playerId?: string };
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
          ...(body.playerId ? { playerId: body.playerId.slice(0, 64) } : {}),
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
    if (!env.RAZORPAY_KEY_SECRET) {
      return Response.json({ ok: false, configured: false, error: 'Razorpay not configured' }, { status: 501 });
    }
    let body: {
      packId?: string;
      playerId?: string;
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    const pack = getCoinPack(body.packId);
    if (!pack || !body.razorpay_order_id || !body.razorpay_payment_id || !body.razorpay_signature) {
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
    await creditServerWallet(env, body.playerId, pack.coins, body.razorpay_payment_id);
    return Response.json({ ok: true, txId: body.razorpay_payment_id, packId: pack.id, coins: pack.coins });
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
          await creditServerWallet(env, entity.notes.playerId, pack.coins, entity.id);
        }
      }
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
    }
    return Response.json({ ok: true, received: eventName });
  }

  return null;
}
