/**
 * Lightweight mobile haptic feedback helpers backed by the Web Vibration API.
 * Silently no-ops on unsupported browsers/platforms or when reduced motion is preferred.
 */

export const HAPTIC_PATTERNS = {
  /** Distinct double pulse when the local player's turn arrives. */
  MY_TURN: [60, 45, 80],
  /** Punchy double impact when a pawn captures an opponent (replaces camera shake). */
  CAPTURE: [35, 35, 85],
  /** Crisp single tap when a pawn spawns out of the yard on a 6. */
  SPAWN_6: 35,
  /** Cheerful double tap when a pawn reaches the center home picnic. */
  REACH_HOME: [35, 30, 55],
} as const satisfies Record<string, number | readonly number[]>;

export type HapticKind = keyof typeof HAPTIC_PATTERNS;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Triggers a safe, reduced-motion-aware vibration pattern if `navigator.vibrate` is supported. */
export function triggerHaptic(kind: HapticKind): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function' || prefersReducedMotion()) {
    return false;
  }
  const raw = HAPTIC_PATTERNS[kind];
  const pattern = typeof raw === 'number' ? raw : [...raw];
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}
