import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// ── localStorage shim backed by expo-secure-store ──
// Firebase Auth's browserLocalPersistence reads/writes localStorage synchronously.
// On React Native there's no localStorage, so we shim it with SecureStore's sync
// getItem/setItem. Auth state survives app restarts without native Firebase modules.
if (Platform.OS !== 'web' && typeof global.localStorage === 'undefined') {
  const cache: Record<string, string | null> = {};
  global.localStorage = {
    getItem: (key: string) => {
      if (key in cache) return cache[key];
      try {
        const value = SecureStore.getItem(key);
        cache[key] = value;
        return value;
      } catch {
        return cache[key] ?? null;
      }
    },
    setItem: (key: string, value: string) => {
      cache[key] = value;
      try { SecureStore.setItemAsync(key, value).catch(() => {}); } catch { /* best-effort */ }
    },
    removeItem: (key: string) => {
      delete cache[key];
      try { SecureStore.deleteItemAsync(key).catch(() => {}); } catch { /* best-effort */ }
    },
    clear: () => {
      for (const k of Object.keys(cache)) delete cache[k];
    },
    get length() {
      return Object.keys(cache).length;
    },
    key: (index: number) => Object.keys(cache)[index] ?? null,
  } as Storage;
}

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

let app: any;
let auth: any;
let db: any;
const googleProvider = new GoogleAuthProvider();

try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
} catch (e) {
  console.error("🔥 Firebase initialization failed on startup:", e);
}

export { auth, db, googleProvider, app };
