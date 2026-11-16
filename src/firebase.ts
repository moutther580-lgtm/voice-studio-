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
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const ADMIN_UID = 'T2t9j7YD2JaTsichCnZkFlzxr6w1';
const ADMIN_EMAIL_SHA256 = '0eac69186c17bf2ac9b7518e47ab997cfeed06f19d74c864e97690e41528826f';

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyStrictAdmin(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified || user.uid !== ADMIN_UID || !user.email) {
    return false;
  }
  const digest = await sha256Hex(user.email.trim().toLowerCase());
  return digest === ADMIN_EMAIL_SHA256;
}

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

export interface ContactMessageDoc {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'unread' | 'read';
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
  return verifyStrictAdmin(user);
}

export async function adminListWallets(): Promise<Array<{ docId: string; wallet: UserWalletDoc }>> {
  const path = 'wallets';
  try {
    const snap = await getDocs(query(collection(db, path), limit(100)));
    return snap.docs.map((d) => ({
      docId: d.id,
      wallet: { ...(d.data() as UserWalletDoc), uid: (d.data() as UserWalletDoc).uid || d.id },
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function adminFindWallet(targetInput: string): Promise<{ docId: string; wallet: UserWalletDoc } | null> {
  const clean = targetInput.trim();
  if (!clean) return null;
  const path = `wallets/${clean}`;
  try {
    if (clean.includes('@')) {
      const byEmail = await getDocs(query(collection(db, 'wallets'), where('email', '==', clean), limit(1)));
      if (!byEmail.empty) {
        const d = byEmail.docs[0];
        return { docId: d.id, wallet: d.data() as UserWalletDoc };
      }
    }
    const directSnap = await getDoc(doc(db, 'wallets', clean));
    if (directSnap.exists()) {
      return { docId: directSnap.id, wallet: directSnap.data() as UserWalletDoc };
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function adminGrantCredits(
  targetInput: string,
  addCredits: number,
  newDailyLimit: number,
  newPlan: 'free' | 'pro',
  note: string
): Promise<UserWalletDoc> {
  const cleanTarget = targetInput.trim();
  if (!cleanTarget) {
    throw new Error('Enter a target user UID or email address first.');
  }

  let resolvedDocId = cleanTarget;
  let existing: UserWalletDoc | null = null;
  const lookupPath = `wallets/${cleanTarget}`;

  try {
    const found = await adminFindWallet(cleanTarget);
    if (found) {
      resolvedDocId = found.docId;
      existing = found.wallet;
    } else if (!cleanTarget.includes('@')) {
      throw new Error('No wallet found for that UID. Ask the user to sign in once first, or enter their email address.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No wallet found')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, lookupPath);
  }

  const walletPath = `wallets/${resolvedDocId}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const walletRef = doc(db, 'wallets', resolvedDocId);
    const entryId = `grant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ledgerRef = doc(db, 'ledger', entryId);

    const nextPaidCredits = Math.max(0, (existing?.paidCredits || 0) + addCredits);
    const nextDailyLimit = Math.max(0, newDailyLimit);
    const resolvedEmail = existing?.email || (cleanTarget.includes('@') ? cleanTarget : 'unknown@user');
    const resolvedUidField = existing?.uid || resolvedDocId;

    const batch = writeBatch(db);
    if (existing) {
      batch.update(walletRef, {
        paidCredits: nextPaidCredits,
        dailyLimit: nextDailyLimit,
        plan: newPlan,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(walletRef, {
        uid: resolvedUidField,
        email: resolvedEmail,
        paidCredits: nextPaidCredits,
        dailyUsedChars: 0,
        dailyDate: today,
        dailyLimit: nextDailyLimit,
        totalCharsUsed: 0,
        plan: newPlan,
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(ledgerRef, {
      id: entryId,
      uid: resolvedDocId,
      type: addCredits > 0 ? 'credit_purchase' : 'admin_grant',
      chars: 0,
      creditsDelta: addCredits,
      model: 'admin-portal',
      note: (note.trim() || `Credits updated by admin (${addCredits >= 0 ? '+' : ''}${addCredits})`).slice(0, 240),
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    return {
      uid: resolvedUidField,
      email: resolvedEmail,
      paidCredits: nextPaidCredits,
      dailyUsedChars: existing?.dailyUsedChars || 0,
      dailyDate: existing?.dailyDate || today,
      dailyLimit: nextDailyLimit,
      totalCharsUsed: existing?.totalCharsUsed || 0,
      plan: newPlan,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, walletPath);
  }
}

export async function submitContactMessage(input: {
  name: string;
  email: string;
  subject: string;
  message: string;
}): Promise<string> {
  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().slice(0, 254);
  const subject = input.subject.trim().slice(0, 120);
  const message = input.message.trim().slice(0, 2000);

  if (name.length < 2) {
    throw new Error('Please enter your full name (at least 2 characters).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address so we can reply.');
  }
  if (subject.length < 2) {
    throw new Error('Please choose or enter a message topic.');
  }
  if (message.length < 10) {
    throw new Error('Please write a message of at least 10 characters.');
  }

  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `contactMessages/${id}`;
  try {
    await setDoc(doc(db, 'contactMessages', id), {
      id,
      name,
      email,
      subject,
      message,
      status: 'unread',
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adminListContactMessages(): Promise<ContactMessageDoc[]> {
  const path = 'contactMessages';
  try {
    const snap = await getDocs(query(collection(db, path), orderBy('createdAt', 'desc'), limit(50)));
    return snap.docs.map((d) => ({ ...(d.data() as ContactMessageDoc), id: d.id }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function adminSetContactMessageStatus(
  messageId: string,
  status: 'read' | 'unread'
): Promise<void> {
  const path = `contactMessages/${messageId}`;
  try {
    await updateDoc(doc(db, 'contactMessages', messageId), { status });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminDeleteContactMessage(messageId: string): Promise<void> {
  const path = `contactMessages/${messageId}`;
  try {
    await deleteDoc(doc(db, 'contactMessages', messageId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function adminListRecentLedger(): Promise<LedgerEntryDoc[]> {
  const path = 'ledger';
  try {
    const snap = await getDocs(query(collection(db, path), orderBy('createdAt', 'desc'), limit(40)));
    return snap.docs.map((d) => ({ ...(d.data() as LedgerEntryDoc), id: d.id }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export interface UserProfileDoc {
  uid: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt?: { toDate?: () => Date };
}

export async function adminListUsers(): Promise<UserProfileDoc[]> {
  const path = 'users';
  try {
    const snap = await getDocs(query(collection(db, path), limit(100)));
    return snap.docs.map((d) => ({ ...(d.data() as UserProfileDoc), uid: (d.data() as UserProfileDoc).uid || d.id }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export interface ReferralRecordDoc {
  uid: string;
  referrerUid: string;
  bonusGranted: boolean;
  createdAt?: { toDate?: () => Date };
}

export async function recordPendingReferralClient(user: User, referrerUid: string): Promise<boolean> {
  const cleanRef = referrerUid.trim();
  if (!user.emailVerified || !cleanRef || cleanRef === user.uid || !/^[a-zA-Z0-9_-]{6,128}$/.test(cleanRef)) {
    return false;
  }
  const path = `referrals/${user.uid}`;
  try {
    const refDoc = doc(db, 'referrals', user.uid);
    const snap = await getDoc(refDoc);
    if (snap.exists()) return false;
    await setDoc(refDoc, {
      uid: user.uid,
      referrerUid: cleanRef,
      bonusGranted: false,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      return false;
    }
  }
}

export function subscribeMyReferrals(
  uid: string,
  onData: (records: ReferralRecordDoc[]) => void,
  onErr?: (err: Error) => void
): Unsubscribe {
  const path = 'referrals';
  const q = query(collection(db, path), where('referrerUid', '==', uid), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as ReferralRecordDoc);
      rows.sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
        const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      });
      onData(rows);
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

export async function adminListReferrals(): Promise<ReferralRecordDoc[]> {
  const path = 'referrals';
  try {
    const snap = await getDocs(query(collection(db, path), limit(100)));
    const rows = snap.docs.map((d) => ({ ...(d.data() as ReferralRecordDoc), uid: d.id }));
    rows.sort((a, b) => {
      const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return tb - ta;
    });
    return rows;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function adminApproveReferral(record: ReferralRecordDoc, bonusChars = 2000): Promise<void> {
  if (record.bonusGranted) return;
  const path = `referrals/${record.uid}`;
  try {
    const walletRef = doc(db, 'wallets', record.referrerUid);
    const walletSnap = await getDoc(walletRef);
    if (!walletSnap.exists()) {
      throw new Error(`Referrer account (${record.referrerUid}) does not have an active wallet yet.`);
    }
    const existingWallet = walletSnap.data() as UserWalletDoc;
    const entryId = `ref_${record.uid.slice(0, 20)}_${Date.now().toString(36)}`;
    const batch = writeBatch(db);
    batch.update(doc(db, 'referrals', record.uid), { bonusGranted: true });
    batch.update(walletRef, {
      paidCredits: Math.max(0, existingWallet.paidCredits || 0) + bonusChars,
      dailyLimit: existingWallet.dailyLimit,
      plan: existingWallet.plan,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'ledger', entryId), {
      id: entryId,
      uid: record.referrerUid,
      type: 'admin_grant',
      chars: 0,
      creditsDelta: bonusChars,
      model: 'referral-bonus',
      note: `Referral invite bonus approved (+${bonusChars.toLocaleString()} credits)`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
