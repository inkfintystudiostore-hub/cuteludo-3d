/**
 * Helpers for 9-digit friend room codes and shareable ?room= invite links.
 */

export const ROOM_CODE_LENGTH = 9;

/** Generates a random 9-digit numeric room code (zero-padded only after non-zero lead). */
export function generateRoomCode(): string {
  const min = 100_000_000;
  const max = 999_999_999;
  const span = max - min + 1;
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return String(min + (buf[0] % span));
  }
  return String(min + Math.floor(Math.random() * span));
}

/** Groups a 9-digit code into readable 3-3-3 triplets (e.g. 482-910-375). */
export function formatRoomCode(code: string): string {
  const clean = code.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
  if (clean.length !== ROOM_CODE_LENGTH) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6, 9)}`;
}

/** Extracts a valid 9-digit room code from either raw/hyphenated digits or a shared ?room= URL. */
export function parseRoomCodeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try parsing as a full URL or query string with ?room= (handles URL-encoded hyphens/spaces).
  const queryStart = trimmed.indexOf('?');
  if (queryStart >= 0 || /^room=/i.test(trimmed)) {
    const queryStr = queryStart >= 0 ? trimmed.slice(queryStart + 1).split('#')[0] : trimmed;
    try {
      const params = new URLSearchParams(queryStr);
      const roomParam = params.get('room');
      if (roomParam) {
        const digits = roomParam.replace(/\D/g, '');
        return digits.length === ROOM_CODE_LENGTH ? digits : null;
      }
    } catch {
      // Fall through to regex/digit extraction.
    }
  }

  const roomQueryMatch = trimmed.match(/[?&]room=([^&#]+)/i);
  if (roomQueryMatch) {
    let decoded = roomQueryMatch[1];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Keep raw match if malformed URI sequence.
    }
    const digits = decoded.replace(/\D/g, '');
    return digits.length === ROOM_CODE_LENGTH ? digits : null;
  }

  // Otherwise strip spaces/hyphens and verify exact 9 numeric digits.
  const digitsOnly = trimmed.replace(/[\s\-]/g, '');
  return /^\d{9}$/.test(digitsOnly) ? digitsOnly : null;
}

const TRUSTED_EMBED_ORIGINS = new Set([
  'https://inkfinitystudio.store',
  'https://www.inkfinitystudio.store',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

/** Returns validated parent page URL when embedded inside a trusted host iframe (e.g. inkfinitystudio.store/game-room). */
export function resolveEmbeddedParentUrl(): { baseUrl: string; origin: string } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('parentUrl')?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!TRUSTED_EMBED_ORIGINS.has(parsed.origin)) return null;
    const cleanPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
    return { baseUrl: `${parsed.origin}${cleanPath}`, origin: parsed.origin };
  } catch {
    return null;
  }
}

/** Resolves the public base URL used for invite links (supports VITE_PUBLIC_APP_URL, iframe parent, & subpaths). */
export function resolveShareBaseUrl(): string {
  const configured = (import.meta.env?.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const embeddedParent = resolveEmbeddedParentUrl();
  if (embeddedParent) return embeddedParent.baseUrl;
  if (typeof window !== 'undefined') {
    const path = window.location.pathname && window.location.pathname !== '/'
      ? window.location.pathname.replace(/\/+$/, '')
      : '';
    return `${window.location.origin}${path}`;
  }
  return 'https://chibi-ludo.app';
}

/** Builds a shareable invite link containing ?room=<code>. */
export function buildRoomShareUrl(baseUrl: string, code: string): string {
  const cleanCode = code.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
  const url = new URL(baseUrl);
  url.searchParams.set('room', cleanCode);
  return url.toString();
}
