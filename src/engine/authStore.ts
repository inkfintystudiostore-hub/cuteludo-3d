import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { create } from 'zustand';
import { firebaseAuth, googleProvider } from './firebase';
import {
  getGuestDeviceId,
  getHttpOrigin,
  loadPlayerDisplayName,
  registerWalletAuthProvider,
  savePlayerDisplayName,
  syncWalletFromServer,
} from './multiplayerClient';
import { useWalletStore, type WalletPersisted } from './walletStore';

export interface AuthAccount {
  accountId: string;
  username: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  walletId: string;
}

function toAuthAccount(user: User): AuthAccount {
  const emailName = user.email ? user.email.split('@')[0] : '';
  const displayName = (user.displayName || emailName || 'Player').trim().slice(0, 18);
  return {
    accountId: user.uid,
    username: user.email || displayName,
    displayName,
    email: user.email,
    photoURL: user.photoURL,
    walletId: `acct:${user.uid}`,
  };
}

function friendlyFirebaseError(err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: string }).code) : '';
  switch (code) {
    case 'auth/user-disabled':
      return 'This Google account has been disabled.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups to sign in with Google.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Console (Authentication → Settings → Authorized domains).';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled in Firebase Console (Authentication → Sign-in method).';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection.';
    default:
      return err instanceof Error && err.message ? err.message : 'Google sign-in failed. Please try again.';
  }
}

async function syncFirebaseWallet(user: User): Promise<void> {
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${getHttpOrigin()}/api/auth/firebase-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ guestPlayerId: getGuestDeviceId() }),
    });
    if (!res.ok) {
      await syncWalletFromServer();
      return;
    }
    const data = (await res.json()) as { ok?: boolean; wallet?: Partial<WalletPersisted> };
    if (data.ok && data.wallet) {
      useWalletStore.getState().applyServerSnapshot(data.wallet);
    }
  } catch {
    // Offline fallback keeps localStorage wallet.
  }
}

export interface AuthStore {
  account: AuthAccount | null;
  authReady: boolean;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  cancelPendingLogin: () => void;
  loginWithGoogle: () => Promise<boolean>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

let activeLoginAttempt = 0;

export const useAuthStore = create<AuthStore>((set) => ({
  account: null,
  authReady: false,
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  cancelPendingLogin: () => {
    activeLoginAttempt += 1;
    set({ loading: false });
  },

  loginWithGoogle: async () => {
    const attemptId = ++activeLoginAttempt;
    set({ loading: true, error: null });

    try {
      const cred = await signInWithPopup(firebaseAuth, googleProvider);
      if (activeLoginAttempt !== attemptId) {
        return Boolean(firebaseAuth.currentUser);
      }
      const account = toAuthAccount(cred.user);
      if (!loadPlayerDisplayName().trim()) {
        savePlayerDisplayName(account.displayName);
      }
      set({ account, loading: false, error: null });
      void syncFirebaseWallet(cred.user);
      return true;
    } catch (err) {
      if (activeLoginAttempt !== attemptId) return false;
      set({ loading: false, error: friendlyFirebaseError(err) });
      return false;
    }
  },

  logout: async () => {
    try {
      await signOut(firebaseAuth);
    } catch {
      // Ignore sign-out errors.
    }
    set({ account: null, error: null, loading: false });
    void syncWalletFromServer();
  },

  checkSession: async () => {
    try {
      await firebaseAuth.authStateReady();
    } catch {
      // Ignore auth initialization errors.
    }
  },
}));

if (typeof window !== 'undefined') {
  registerWalletAuthProvider(() => ({
    getToken: async () => (await firebaseAuth.currentUser?.getIdToken()) ?? null,
    walletId: useAuthStore.getState().account?.walletId ?? null,
    onUnauthorized: () => {
      void useAuthStore.getState().logout();
    },
  }));

  onAuthStateChanged(firebaseAuth, (user) => {
    if (user) {
      const account = toAuthAccount(user);
      if (!loadPlayerDisplayName().trim()) {
        savePlayerDisplayName(account.displayName);
      }
      useAuthStore.setState({ account, authReady: true });
      void syncFirebaseWallet(user);
    } else {
      useAuthStore.setState({ account: null, authReady: true });
    }
  });
}
