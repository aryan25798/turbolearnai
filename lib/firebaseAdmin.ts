// lib/firebaseAdmin.ts
import 'server-only';
import admin from 'firebase-admin';

// 1. Initialize only if not already initialized
if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    try {
      // 🛡️ ROBUST KEY PARSING START
      // 1. Remove outer quotes if they exist (some env parsers leave them)
      let formattedKey = privateKey.replace(/^"|"$/g, '');
      
      // 2. Handle literal "\n" strings (common in .env files)
      if (formattedKey.includes('\\n')) {
          formattedKey = formattedKey.replace(/\\n/g, '\n');
      }
      // 🛡️ ROBUST KEY PARSING END

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: formattedKey,
        }),
      });
      console.log("✅ Firebase Admin Initialized Successfully");
    } catch (error) {
      console.error('🔥 Firebase Admin Initialization Error:', error);
    }
  } else {
    // Optional: Log warning (useful for debugging runtime issues)
    console.warn("⚠️ FIREBASE_PRIVATE_KEY is missing. Firebase Admin initialization skipped.");
  }
}

// 2. Safe Exports with Guards
function createGuard<T extends object>(obj: T): T {
  const handler = {
    get(target: object, prop: string | symbol, receiver: any) {
      if (!admin.apps.length) {
        throw new Error("Firebase Admin is not initialized. Check FIREBASE_PRIVATE_KEY and other env vars.");
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        const boundFn = (...args: unknown[]) => {
          if (!admin.apps.length) {
            throw new Error("Firebase Admin is not initialized. Check FIREBASE_PRIVATE_KEY and other env vars.");
          }
          const result = value.apply(target, args);
          if (result && typeof result === 'object' && typeof result.then !== 'function') {
            return new Proxy(result, handler);
          }
          return result;
        };
        return boundFn;
      }
      if (value && typeof value === 'object') {
        return new Proxy(value, handler);
      }
      return value;
    }
  };
  return new Proxy(obj as object, handler) as unknown as T;
}

export const adminDb = admin.apps.length 
  ? admin.firestore() 
  : createGuard({} as FirebaseFirestore.Firestore);

export const adminAuth = admin.apps.length 
  ? admin.auth() 
  : createGuard({} as admin.auth.Auth);