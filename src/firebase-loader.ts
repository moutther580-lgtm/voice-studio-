import type { User } from 'firebase/auth';

export type FirebaseModule = typeof import('./firebase');

let firebasePromise: Promise<FirebaseModule> | null = null;
let authListenerBound = false;

export function getFirebaseMod(): Promise<FirebaseModule> {
  if (!firebasePromise) {
    firebasePromise = import('./firebase');
  }
  return firebasePromise;
}

/**
 * Checks whether the browser already holds a Firebase Auth persisted session
 * without importing the Firebase JS SDK on cold public page visits.
 */
export async function hasLikelyFirebaseAuthSession(): Promise<boolean> {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('firebase:authUser:')) {
        const raw = localStorage.getItem(key);
        if (raw && raw !== 'null') return true;
      }
    }
  } catch {
    // Ignore storage access errors
  }

  try {
    if (typeof indexedDB !== 'undefined') {
      const idbAny = indexedDB as IDBFactory & {
        databases?: () => Promise<Array<{ name?: string }>>;
      };
      if (typeof idbAny.databases === 'function') {
        const dbs = await idbAny.databases();
        if (dbs.some((db) => db.name === 'firebaseLocalStorageDb')) {
          // Probe if there is at least one stored key in firebase-heartbeat or firebaseLocalStorage
          const hasRecords = await new Promise<boolean>((resolve) => {
            const req = indexedDB.open('firebaseLocalStorageDb');
            req.onerror = () => resolve(false);
            req.onsuccess = () => {
              const db = req.result;
              try {
                if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
                  db.close();
                  resolve(false);
                  return;
                }
                const tx = db.transaction('firebaseLocalStorage', 'readonly');
                const store = tx.objectStore('firebaseLocalStorage');
                const countReq = store.count();
                countReq.onsuccess = () => {
                  const n = countReq.result || 0;
                  db.close();
                  resolve(n > 0);
                };
                countReq.onerror = () => {
                  db.close();
                  resolve(false);
                };
              } catch {
                try {
                  db.close();
                } catch {
                  // Ignore
                }
                resolve(false);
              }
            };
          });
          if (hasRecords) return true;
        }
      }
    }
  } catch {
    // Ignore IDB errors
  }

  return false;
}

export async function ensureAuthListener(onUser: (user: User | null) => void | Promise<void>): Promise<FirebaseModule> {
  const mod = await getFirebaseMod();
  if (!authListenerBound) {
    authListenerBound = true;
    const { onAuthStateChanged } = await import('firebase/auth');
    onAuthStateChanged(mod.auth, (user) => {
      void onUser(user);
    });
  }
  return mod;
}
