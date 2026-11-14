import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const ADMIN_EMAIL = 'moutther580@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export interface UserWalletDoc {
  uid: string;
  email: string;
  paidCredits: number;
  dailyUsedChars: number;
  dailyDate: string;
  dailyLimit: number;
  totalCharsUsed: number;
  plan: 'free' | 'pro';
}

export interface LedgerEntryDoc {
  id: string;
  uid: string;
  type: 'tts_usage' | 'credit_purchase' | 'admin_grant';
  chars: number;
  creditsDelta: number;
  model: string;
  note: string;
  createdAt?: { toDate?: () => Date };
}

export async function signInWithGoogle(): Promise<User> {
  const res = await signInWithPopup(auth, googleProvider);
  return res.user;
}

export async function signInEmail(email: string, password: string): Promise<User> {
  const res = await signInWithEmailAndPassword(auth, email, password);
  return res.user;
}

export async function signUpEmail(email: string, password: string, displayName: string): Promise<User> {
  const res = await createUserWithEmailAndPassword(auth, email, password);
  const cleanName = displayName.trim().slice(0, 120);
  if (cleanName) {
    await updateProfile(res.user, { displayName: cleanName });
  }
  await sendEmailVerification(res.user);
  return res.user;
}

export async function resendVerificationEmail(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export async function sendResetEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export async function ensureUserAndWallet(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) return;

  const userPath = `users/${user.uid}`;
  const walletPath = `wallets/${user.uid}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (!userSnap.exists()) {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: (user.displayName || user.email.split('@')[0] || 'User').slice(0, 120),
        role: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  try {
    const walletSnap = await getDoc(doc(db, 'wallets', user.uid));
    if (!walletSnap.exists()) {
      await setDoc(doc(db, 'wallets', user.uid), {
        uid: user.uid,
        email: user.email,
        paidCredits: 0,
        dailyUsedChars: 0,
        dailyDate: today,
        dailyLimit: 3000,
        totalCharsUsed: 0,
        plan: 'free',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, walletPath);
  }
}

export function subscribeWallet(
  uid: string,
  onData: (wallet: UserWalletDoc | null) => void,
  onErr?: (err: Error) => void
): Unsubscribe {
  const path = `wallets/${uid}`;
  return onSnapshot(
    doc(db, 'wallets', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as UserWalletDoc) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (e) {
        onErr?.(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );
}

export function subscribeLedger(
  uid: string,
  onData: (entries: LedgerEntryDoc[]) => void,
  onErr?: (err: Error) => void
): Unsubscribe {
  const path = 'ledger';
  const q = query(collection(db, path), where('uid', '==', uid), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as LedgerEntryDoc);
      rows.sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
        const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      });
      onData(rows.slice(0, 20));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        onErr?.(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );
}

export async function checkIsAdmin(user: User): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (user.email === ADMIN_EMAIL) return true;
  const path = `admins/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function adminListWallets(): Promise<UserWalletDoc[]> {
  const path = 'wallets';
  try {
    const snap = await getDocs(query(collection(db, path), limit(50)));
    return snap.docs.map((d) => d.data() as UserWalletDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function adminGrantCredits(
  targetUid: string,
  addCredits: number,
  newDailyLimit: number,
  newPlan: 'free' | 'pro',
  note: string
): Promise<void> {
  const walletPath = `wallets/${targetUid}`;
  try {
    const walletRef = doc(db, 'wallets', targetUid);
    const snap = await getDoc(walletRef);
    if (!snap.exists()) {
      throw new Error('User wallet not found.');
    }
    const existing = snap.data() as UserWalletDoc;
    const entryId = `grant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ledgerRef = doc(db, 'ledger', entryId);

    const batch = writeBatch(db);
    batch.update(walletRef, {
      paidCredits: Math.max(0, (existing.paidCredits || 0) + addCredits),
      dailyLimit: Math.max(0, newDailyLimit),
      plan: newPlan,
      updatedAt: serverTimestamp(),
    });
    batch.set(ledgerRef, {
      id: entryId,
      uid: targetUid,
      type: addCredits > 0 ? 'credit_purchase' : 'admin_grant',
      chars: 0,
      creditsDelta: addCredits,
      model: 'admin-portal',
      note: (note.trim() || `Credits updated by admin (${addCredits >= 0 ? '+' : ''}${addCredits})`).slice(0, 240),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, walletPath);
  }
}
