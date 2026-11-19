import { describe, expect, it } from 'vitest';
import { getCoinPack } from './shopCatalog';
import { handlePaymentRequest, verifyRazorpaySignature, verifyRazorpayWebhookSignature } from '../../worker/payments';

describe('payments & shopCatalog', () => {
  it('resolves known coin packs and rejects unknown IDs', () => {
    expect(getCoinPack('starter')?.coins).toBe(2500);
    expect(getCoinPack('popular')?.inrPaise).toBe(39900);
    expect(getCoinPack('unknown')).toBeUndefined();
  });

  it('verifies Razorpay HMAC-SHA256 signatures accurately', async () => {
    const secret = 'test_rzp_secret_123';
    const orderId = 'order_ABC';
    const paymentId = 'pay_XYZ';

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${orderId}|${paymentId}`));
    const validHex = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    expect(await verifyRazorpaySignature(orderId, paymentId, validHex, secret)).toBe(true);
    expect(await verifyRazorpaySignature(orderId, paymentId, '0'.repeat(64), secret)).toBe(false);
  });

  it('returns 501 when Razorpay secrets are unconfigured', async () => {
    const rzpReq = new Request('https://example.com/api/payments/razorpay/order', {
      method: 'POST',
      body: JSON.stringify({ packId: 'starter' }),
    });
    const rzpRes = await handlePaymentRequest(rzpReq, new URL(rzpReq.url), {});
    expect(rzpRes?.status).toBe(501);
  });

  it('verifies Razorpay webhook HMAC-SHA256 signature and rejects invalid signatures', async () => {
    const secret = 'whsec_test_123';
    const rawBody = JSON.stringify({ event: 'payment.captured' });
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const validHex = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    expect(await verifyRazorpayWebhookSignature(rawBody, validHex, secret)).toBe(true);

    const okReq = new Request('https://example.com/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': validHex },
      body: rawBody,
    });
    const okRes = await handlePaymentRequest(okReq, new URL(okReq.url), { RAZORPAY_WEBHOOK_SECRET: secret });
    expect(okRes?.status).toBe(200);

    const badReq = new Request('https://example.com/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': '0'.repeat(64) },
      body: rawBody,
    });
    const badRes = await handlePaymentRequest(badReq, new URL(badReq.url), { RAZORPAY_WEBHOOK_SECRET: secret });
    expect(badRes?.status).toBe(400);
  });

  it('rejects unauthenticated order and verify requests with 401 when Razorpay is configured', async () => {
    const env = { RAZORPAY_KEY_ID: 'rzp_test_123', RAZORPAY_KEY_SECRET: 'rzp_secret_123' };
    const orderReq = new Request('https://example.com/api/payments/razorpay/order', {
      method: 'POST',
      body: JSON.stringify({ packId: 'starter' }),
    });
    const orderRes = await handlePaymentRequest(orderReq, new URL(orderReq.url), env);
    expect(orderRes?.status).toBe(401);

    const verifyReq = new Request('https://example.com/api/payments/razorpay/verify', {
      method: 'POST',
      body: JSON.stringify({
        packId: 'starter',
        razorpay_order_id: 'order_123',
        razorpay_payment_id: 'pay_123',
        razorpay_signature: '0'.repeat(64),
      }),
    });
    const verifyRes = await handlePaymentRequest(verifyReq, new URL(verifyReq.url), env);
    expect(verifyRes?.status).toBe(401);
  });
});
