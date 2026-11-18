export interface PublicAccount {
  accountId: string;
  username: string;
  displayName: string;
  walletId: string;
  createdAt: number;
}

export interface SessionPayload {
  accountId: string;
  username: string;
  displayName: string;
  walletId: string;
  exp: number;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;

// Ephemeral in-memory fallback generated once per worker/process instance.
// Never uses a predictable static secret, preventing cross-instance or forged offline token attacks
// if AUTH_SECRET is omitted in development. In production, configure AUTH_SECRET via `wrangler secret put AUTH_SECRET`.
let devAuthSecretCache: string | null = null;
function getDevAuthSecret(): string {
  if (!devAuthSecretCache) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    devAuthSecretCache = bytesToHex(randomBytes);
  }
  return devAuthSecretCache;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): { ok: true; username: string; normalized: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 20) {
    return { ok: false, error: 'Username must be 3 to 20 characters.' };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return { ok: false, error: 'Username can only use letters, numbers, _, -, or .' };
  }
  return { ok: true, username: trimmed, normalized: trimmed.toLowerCase() };
}

export function validatePassword(raw: string): { ok: true; password: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  if (raw.length > 128) {
    return { ok: false, error: 'Password is too long.' };
  }
  return { ok: true, password: raw };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = saltHex
    ? new Uint8Array(saltHex.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const salt = saltHex ?? bytesToHex(saltBytes);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  return timingSafeEqualStr(hash, expectedHash);
}

async function signHmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(sig));
}

export async function createSessionToken(
  account: PublicAccount,
  secret?: string,
  now = Date.now(),
): Promise<string> {
  const payload: SessionPayload = {
    accountId: account.accountId,
    username: account.username,
    displayName: account.displayName,
    walletId: account.walletId,
    exp: now + SESSION_TTL_MS,
  };
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await signHmac(encoded, secret || getDevAuthSecret());
  return `${encoded}.${sig}`;
}

export async function verifySessionToken(
  token: string,
  secret?: string,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = await signHmac(encoded, secret || getDevAuthSecret());
  if (!timingSafeEqualStr(sig, expectedSig)) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(encoded));
    const parsed = JSON.parse(json) as Partial<SessionPayload>;
    if (
      typeof parsed.accountId !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.walletId !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (parsed.exp <= now) return null;
    return {
      accountId: parsed.accountId,
      username: parsed.username,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : parsed.username,
      walletId: parsed.walletId,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
