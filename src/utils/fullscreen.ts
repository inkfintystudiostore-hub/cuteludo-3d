/**
 * Cross-browser helpers for entering, exiting, and observing browser fullscreen mode.
 */

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

let userExitedFullscreen = false;

export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDocument;
  const root = document.documentElement as FullscreenElement | null;
  return Boolean(
    doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      typeof root?.requestFullscreen === 'function' ||
      typeof root?.webkitRequestFullscreen === 'function',
  );
}

export function isInFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export async function requestGameFullscreen(force = false): Promise<boolean> {
  if (typeof document === 'undefined' || !isFullscreenSupported()) return false;
  if (isInFullscreen()) return true;
  if (!force && userExitedFullscreen) return false;
  userExitedFullscreen = false;
  const root = document.documentElement as FullscreenElement;
  try {
    if (typeof root.requestFullscreen === 'function') {
      await root.requestFullscreen({ navigationUI: 'hide' });
      return true;
    }
    if (typeof root.webkitRequestFullscreen === 'function') {
      await root.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // Gesture/browser policy blocked fullscreen; fail silently.
  }
  return false;
}

export async function exitGameFullscreen(): Promise<void> {
  if (typeof document === 'undefined' || !isInFullscreen()) return;
  userExitedFullscreen = true;
  const doc = document as FullscreenDocument;
  try {
    if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen();
    } else if (typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen();
    }
  } catch {
    // Ignore fullscreen exit errors.
  }
}

export async function toggleGameFullscreen(): Promise<void> {
  if (isInFullscreen()) await exitGameFullscreen();
  else await requestGameFullscreen(true);
}

export function subscribeFullscreenChange(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
  return () => {
    document.removeEventListener('fullscreenchange', listener);
    document.removeEventListener('webkitfullscreenchange', listener);
  };
}
