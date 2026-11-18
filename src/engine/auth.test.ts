import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  hashPassword,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifySessionToken,
} from '../../worker/authHelpers';
import { FIREBASE_PROJECT_ID, validateFirebaseClaims } from '../../worker/firebaseAuth';

describe('auth helpers', () => {
  it('validates usernames and normalizes casing', () => {
    expect(validateUsername('ab')).toEqual({ ok: false, error: 'Username must be 3 to 20 characters.' });
    expect(validateUsername('bad name!')).toEqual({
      ok: false,
      error: 'Username can only use letters, numbers, _, -, or .',
    });
    expect(validateUsername('  Lucky_Panda99  ')).toEqual({
      ok: true,
      username: 'Lucky_Panda99',
      normalized: 'lucky_panda99',
    });
  });

  it('validates password length', () => {
    expect(validatePassword('12345').ok).toBe(false);
    expect(validatePassword('secret123').ok).toBe(true);
  });

  it('hashes and verifies passwords with PBKDF2', async () => {
    const { hash, salt } = await hashPassword('my-secret-pw');
    expect(hash).toHaveLength(64);
    expect(salt).toHaveLength(32);
    expect(await verifyPassword('my-secret-pw', salt, hash)).toBe(true);
    expect(await verifyPassword('wrong-pw', salt, hash)).toBe(false);
  });

  it('creates and verifies HMAC session tokens and rejects tampered or expired ones', async () => {
    const account = {
      accountId: 'acc-123',
      username: 'LuckyPanda',
      displayName: 'Lucky Panda',
      walletId: 'acct:acc-123',
      createdAt: 1000,
    };
    const secret = 'test-auth-secret';
    const now = 1_700_000_000_000;
    const token = await createSessionToken(account, secret, now);

    const verified = await verifySessionToken(token, secret, now + 1000);
    expect(verified).toMatchObject({
      accountId: 'acc-123',
      username: 'LuckyPanda',
      walletId: 'acct:acc-123',
    });

    // Tampered token
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    expect(await verifySessionToken(tampered, secret, now + 1000)).toBeNull();

    // Wrong secret
    expect(await verifySessionToken(token, 'other-secret', now + 1000)).toBeNull();

    // Expired token
    expect(await verifySessionToken(token, secret, now + 31 * 24 * 60 * 60 * 1000)).toBeNull();

    // Works with fallback secret when secret is omitted
    const fallbackToken = await createSessionToken(account, undefined, now);
    const verifiedFallback = await verifySessionToken(fallbackToken, undefined, now + 1000);
    expect(verifiedFallback?.accountId).toBe(account.accountId);
  });

  it('validates Firebase ID token claims against projectId and expiration', () => {
    const nowSec = 1_700_000_000;
    const valid = validateFirebaseClaims(
      {
        aud: FIREBASE_PROJECT_ID,
        iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
        sub: 'firebase-uid-123',
        email: 'player@inkfinitystudio.store',
        exp: nowSec + 3600,
        iat: nowSec - 10,
      },
      FIREBASE_PROJECT_ID,
      nowSec,
    );
    expect(valid).toMatchObject({
      uid: 'firebase-uid-123',
      email: 'player@inkfinitystudio.store',
    });

    // Wrong audience
    expect(
      validateFirebaseClaims(
        {
          aud: 'other-project',
          iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
          sub: 'firebase-uid-123',
          exp: nowSec + 3600,
          iat: nowSec - 10,
        },
        FIREBASE_PROJECT_ID,
        nowSec,
      ),
    ).toBeNull();

    // Expired
    expect(
      validateFirebaseClaims(
        {
          aud: FIREBASE_PROJECT_ID,
          iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
          sub: 'firebase-uid-123',
          exp: nowSec - 1,
          iat: nowSec - 3600,
        },
        FIREBASE_PROJECT_ID,
        nowSec,
      ),
    ).toBeNull();
  });
});
