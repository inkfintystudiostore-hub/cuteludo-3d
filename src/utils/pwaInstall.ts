import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallPlatform = 'ios' | 'android' | 'desktop';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

export function getInstallPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  const isTouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || isTouchMac) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function initPwaInstall(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyListeners();
  });
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Service worker registration is progressive enhancement; ignore errors.
    });
  });
}

export function usePwaInstall() {
  const [standalone, setStandalone] = useState(() => isRunningStandalone());
  const [hasNativePrompt, setHasNativePrompt] = useState(() => Boolean(deferredPrompt));
  const platform = getInstallPlatform();

  useEffect(() => {
    const sync = () => {
      setStandalone(isRunningStandalone());
      setHasNativePrompt(Boolean(deferredPrompt));
    };
    listeners.add(sync);
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', sync);
    sync();
    return () => {
      listeners.delete(sync);
      mq.removeEventListener?.('change', sync);
    };
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    notifyListeners();
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    return outcome;
  };

  return {
    showInstallButton: !standalone,
    hasNativePrompt,
    platform,
    promptInstall,
  };
}
