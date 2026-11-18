import { SignJWT, importPKCS8 } from 'jose';

export interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface WalletSnapshot {
  uid: string;
  email: string;
  paidCredits: number;
  dailyUsedChars: number;
  dailyDate: string;
  dailyLimit: number;
  totalCharsUsed: number;
  plan: 'free' | 'pro';
  exists?: boolean;
  updateTime?: string;
}

const SAFE_DOC_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_REFERRALS_PER_USER = 15;

function assertSafeDocId(id: string, label = 'document ID'): string {
  const clean = String(id || '').trim();
  if (!SAFE_DOC_ID_RE.test(clean)) {
    throw new Error(`Invalid ${label}.`);
  }
  return clean;
}

function canonicalizeEmail(email: string): string {
  const parts = String(email || '').trim().toLowerCase().split('@');
  if (parts.length !== 2) return String(email || '').trim().toLowerCase();
  let [local, domain] = parts;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  const plusIdx = local.indexOf('+');
  if (plusIdx >= 0) local = local.slice(0, plusIdx);
  if (domain === 'gmail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

let cachedToken: { token: string; exp: number } | null = null;

async function getGoogleAccessToken(creds: ServiceAccountCreds): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) {
    return cachedToken.token;
  }

  const rawKey = String(creds.private_key || '').trim().replace(/^"(.*)"$/, '$1');
  const pem = rawKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').trim();
  const key = await importPKCS8(pem, 'RS256');
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/datastore',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(creds.client_email)
    .setSubject(creds.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth token exchange failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { booleanValue: boolean }
  | { timestampValue: string };

function readStr(fields: Record<string, FsValue> | undefined, key: string, fallback = ''): string {
  const v = fields?.[key];
  return v && 'stringValue' in v ? v.stringValue : fallback;
}

function readInt(fields: Record<string, FsValue> | undefined, key: string, fallback = 0): number {
  const v = fields?.[key];
  return v && 'integerValue' in v ? parseInt(v.integerValue, 10) || 0 : fallback;
}

function readBool(fields: Record<string, FsValue> | undefined, key: string, fallback = false): boolean {
  const v = fields?.[key];
  return v && 'booleanValue' in v ? v.booleanValue : fallback;
}

export async function getFirestoreWallet(
  creds: ServiceAccountCreds,
  projectId: string,
  databaseId: string,
  uid: string,
  email: string,
  todayStr: string,
  defaultDailyLimit: number
): Promise<WalletSnapshot> {
  const safeUid = assertSafeDocId(uid, 'uid');
  const token = await getGoogleAccessToken(creds);
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/wallets/${safeUid}`;
  const res = await fetch(docUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) {
    return {
      uid: safeUid,
      email,
      paidCredits: 0,
      dailyUsedChars: 0,
      dailyDate: todayStr,
      dailyLimit: defaultDailyLimit,
      totalCharsUsed: 0,
      plan: 'free',
      exists: false,
    };
  }
  if (!res.ok) {
    throw new Error(`Firestore wallet fetch failed (${res.status})`);
  }

  const doc = (await res.json()) as { fields?: Record<string, FsValue>; updateTime?: string };
  const f = doc.fields;
  const storedDate = readStr(f, 'dailyDate', todayStr);
  const sameDay = storedDate === todayStr;

  return {
    uid: safeUid,
    email: readStr(f, 'email', email),
    paidCredits: Math.max(0, readInt(f, 'paidCredits', 0)),
    dailyUsedChars: sameDay ? Math.max(0, readInt(f, 'dailyUsedChars', 0)) : 0,
    dailyDate: todayStr,
    dailyLimit: Math.max(0, readInt(f, 'dailyLimit', defaultDailyLimit)),
    totalCharsUsed: Math.max(0, readInt(f, 'totalCharsUsed', 0)),
    plan: readStr(f, 'plan', 'free') === 'pro' ? 'pro' : 'free',
    exists: true,
    updateTime: doc.updateTime,
  };
}

export async function getFirestoreGlobalUsed(
  creds: ServiceAccountCreds,
  projectId: string,
  databaseId: string,
  todayStr: string
): Promise<number> {
  const safeDate = assertSafeDocId(todayStr, 'date');
  const token = await getGoogleAccessToken(creds);
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/systemCounters/global_${safeDate}`;
  const res = await fetch(docUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return 0;
  if (!res.ok) {
    throw new Error(`Global counter fetch failed (${res.status})`);
  }
  const doc = (await res.json()) as { fields?: Record<string, FsValue> };
  return Math.max(0, readInt(doc.fields, 'usedChars', 0));
}

export async function reserveFirestoreQuota(opts: {
  creds: ServiceAccountCreds;
  projectId: string;
  databaseId: string;
  uid: string;
  email: string;
  todayStr: string;
  defaultDailyLimit: number;
  globalCap: number;
  charsRequested: number;
}): Promise<
  | {
      ok: true;
      wallet: WalletSnapshot;
      freeFromDaily: number;
      paidNeeded: number;
      globalRemaining: number;
    }
  | {
      ok: false;
      code: 'QUOTA_EXCEEDED' | 'GLOBAL_CAP_REACHED';
      wallet: WalletSnapshot;
      remainingDaily: number;
      globalRemaining: number;
    }
> {
  const safeUid = assertSafeDocId(opts.uid, 'uid');
  const safeDate = assertSafeDocId(opts.todayStr, 'date');
  const base = `https://firestore.googleapis.com/v1/projects/${opts.projectId}/databases/${opts.databaseId}/documents`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await getGoogleAccessToken(opts.creds);
    const [wallet, globalUsed] = await Promise.all([
      getFirestoreWallet(
        opts.creds,
        opts.projectId,
        opts.databaseId,
        safeUid,
        opts.email,
        safeDate,
        opts.defaultDailyLimit
      ),
      getFirestoreGlobalUsed(opts.creds, opts.projectId, opts.databaseId, safeDate),
    ]);

    const remainingDaily = Math.max(0, wallet.dailyLimit - wallet.dailyUsedChars);
    const globalRemaining = Math.max(0, opts.globalCap - globalUsed);
    const freeFromDaily = Math.min(remainingDaily, opts.charsRequested);
    const paidNeeded = opts.charsRequested - freeFromDaily;

    if (freeFromDaily > globalRemaining && wallet.paidCredits < opts.charsRequested) {
      return {
        ok: false,
        code: 'GLOBAL_CAP_REACHED',
        wallet,
        remainingDaily,
        globalRemaining,
      };
    }

    if (paidNeeded > wallet.paidCredits) {
      return {
        ok: false,
        code: 'QUOTA_EXCEEDED',
        wallet,
        remainingDaily,
        globalRemaining,
      };
    }

    const updatedWallet: WalletSnapshot = {
      ...wallet,
      dailyUsedChars: wallet.dailyUsedChars + freeFromDaily,
      paidCredits: wallet.paidCredits - paidNeeded,
      totalCharsUsed: wallet.totalCharsUsed + opts.charsRequested,
      exists: true,
    };

    const nowIso = new Date().toISOString();
    const writes: Array<Record<string, unknown>> = [
      {
        currentDocument: wallet.exists && wallet.updateTime ? { updateTime: wallet.updateTime } : { exists: false },
        update: {
          name: `projects/${opts.projectId}/databases/${opts.databaseId}/documents/wallets/${safeUid}`,
          fields: {
            uid: { stringValue: safeUid },
            email: { stringValue: updatedWallet.email },
            paidCredits: { integerValue: String(updatedWallet.paidCredits) },
            dailyUsedChars: { integerValue: String(updatedWallet.dailyUsedChars) },
            dailyDate: { stringValue: updatedWallet.dailyDate },
            dailyLimit: { integerValue: String(updatedWallet.dailyLimit) },
            totalCharsUsed: { integerValue: String(updatedWallet.totalCharsUsed) },
            plan: { stringValue: updatedWallet.plan },
            updatedAt: { timestampValue: nowIso },
          },
        },
      },
    ];

    if (freeFromDaily > 0) {
      writes.push({
        update: {
          name: `projects/${opts.projectId}/databases/${opts.databaseId}/documents/systemCounters/global_${safeDate}`,
          fields: {
            date: { stringValue: safeDate },
            updatedAt: { timestampValue: nowIso },
          },
        },
        updateMask: { fieldPaths: ['date', 'updatedAt'] },
        updateTransforms: [
          {
            fieldPath: 'usedChars',
            increment: { integerValue: String(freeFromDaily) },
          },
        ],
      });
    }

    const commitRes = await fetch(`${base}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes }),
    });

    if (commitRes.ok) {
      return {
        ok: true,
        wallet: updatedWallet,
        freeFromDaily,
        paidNeeded,
        globalRemaining: Math.max(0, globalRemaining - freeFromDaily),
      };
    }

    if ((commitRes.status === 409 || commitRes.status === 400) && attempt < 2) {
      continue;
    }
    throw new Error(`Firestore quota reserve failed (${commitRes.status})`);
  }

  throw new Error('Quota update conflict under high concurrency. Please retry.');
}

export async function refundFirestoreQuota(opts: {
  creds: ServiceAccountCreds;
  projectId: string;
  databaseId: string;
  uid: string;
  todayStr: string;
  charsRequested: number;
  freeFromDaily: number;
  paidNeeded: number;
}): Promise<void> {
  const safeUid = assertSafeDocId(opts.uid, 'uid');
  const safeDate = assertSafeDocId(opts.todayStr, 'date');
  const token = await getGoogleAccessToken(opts.creds);
  const base = `https://firestore.googleapis.com/v1/projects/${opts.projectId}/databases/${opts.databaseId}/documents`;
  const nowIso = new Date().toISOString();

  const writes: Array<Record<string, unknown>> = [
    {
      currentDocument: { exists: true },
      update: {
        name: `projects/${opts.projectId}/databases/${opts.databaseId}/documents/wallets/${safeUid}`,
        fields: {
          updatedAt: { timestampValue: nowIso },
        },
      },
      updateMask: { fieldPaths: ['updatedAt'] },
      updateTransforms: [
        { fieldPath: 'dailyUsedChars', increment: { integerValue: String(-opts.freeFromDaily) } },
        { fieldPath: 'paidCredits', increment: { integerValue: String(opts.paidNeeded) } },
        { fieldPath: 'totalCharsUsed', increment: { integerValue: String(-opts.charsRequested) } },
      ],
    },
  ];

  if (opts.freeFromDaily > 0) {
    writes.push({
      currentDocument: { exists: true },
      update: {
        name: `projects/${opts.projectId}/databases/${opts.databaseId}/documents/systemCounters/global_${safeDate}`,
        fields: {
          updatedAt: { timestampValue: nowIso },
        },
      },
      updateMask: { fieldPaths: ['updatedAt'] },
      updateTransforms: [
        { fieldPath: 'usedChars', increment: { integerValue: String(-opts.freeFromDaily) } },
      ],
    });
  }

  await fetch(`${base}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });
}

export async function recordFirestoreLedgerEntry(opts: {
  creds: ServiceAccountCreds;
  projectId: string;
  databaseId: string;
  uid: string;
  charsUsed: number;
  creditsDeducted: number;
  model: string;
  note?: string;
}): Promise<void> {
  const safeUid = assertSafeDocId(opts.uid, 'uid');
  const token = await getGoogleAccessToken(opts.creds);
  const nowIso = new Date().toISOString();
  const base = `https://firestore.googleapis.com/v1/projects/${opts.projectId}/databases/${opts.databaseId}/documents`;
  const entryId = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const defaultNote =
    opts.creditsDeducted > 0
      ? `Speech synthesis (${opts.charsUsed} chars; ${opts.creditsDeducted} paid credits)`
      : `Free daily allowance (${opts.charsUsed} chars)`;

  const commitRes = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          currentDocument: { exists: false },
          update: {
            name: `projects/${opts.projectId}/databases/${opts.databaseId}/documents/ledger/${entryId}`,
            fields: {
              id: { stringValue: entryId },
              uid: { stringValue: safeUid },
              type: { stringValue: 'tts_usage' },
              chars: { integerValue: String(opts.charsUsed) },
              creditsDelta: { integerValue: String(-opts.creditsDeducted) },
              model: { stringValue: opts.model.slice(0, 80) },
              note: { stringValue: (opts.note || defaultNote).slice(0, 240) },
              createdAt: { timestampValue: nowIso },
            },
          },
        },
      ],
    }),
  });

  if (!commitRes.ok) {
    throw new Error(`Firestore ledger commit failed (${commitRes.status})`);
  }
}

export async function creditReferralBonus(
  creds: ServiceAccountCreds,
  projectId: string,
  databaseId: string,
  newUid: string,
  referrerUid: string,
  bonusChars = 2000,
  newEmail = ''
): Promise<{ alreadyExists: boolean; credited: boolean; bonusChars: number; capReached?: boolean }> {
  const safeNewUid = assertSafeDocId(newUid, 'newUid');
  const safeReferrerUid = assertSafeDocId(referrerUid, 'referrerUid');
  if (safeNewUid === safeReferrerUid) {
    return { alreadyExists: false, credited: false, bonusChars: 0 };
  }

  const token = await getGoogleAccessToken(creds);
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;

  const existingRefRes = await fetch(`${base}/referrals/${safeNewUid}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (existingRefRes.ok) {
    const existingDoc = (await existingRefRes.json()) as { fields?: Record<string, FsValue> };
    return {
      alreadyExists: true,
      credited: readBool(existingDoc.fields, 'bonusGranted', false),
      bonusChars: 0,
    };
  }
  if (existingRefRes.status !== 404) {
    throw new Error(`Referral lookup failed (${existingRefRes.status})`);
  }

  const [walletRes, statsRes] = await Promise.all([
    fetch(`${base}/wallets/${safeReferrerUid}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(`${base}/referralStats/${safeReferrerUid}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  const nowIso = new Date().toISOString();

  if (walletRes.status === 404) {
    await fetch(`${base}/referrals?documentId=${encodeURIComponent(safeNewUid)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          uid: { stringValue: safeNewUid },
          referrerUid: { stringValue: safeReferrerUid },
          bonusGranted: { booleanValue: false },
          createdAt: { timestampValue: nowIso },
        },
      }),
    });
    return { alreadyExists: false, credited: false, bonusChars: 0 };
  }

  if (!walletRes.ok) {
    throw new Error(`Referrer wallet lookup failed (${walletRes.status})`);
  }

  const refWalletDoc = (await walletRes.json()) as { fields?: Record<string, FsValue>; updateTime?: string };
  const referrerEmail = readStr(refWalletDoc.fields, 'email', '');
  if (newEmail && referrerEmail && canonicalizeEmail(newEmail) === canonicalizeEmail(referrerEmail)) {
    return { alreadyExists: false, credited: false, bonusChars: 0 };
  }

  let currentStatsCount = 0;
  let statsExists = false;
  let statsUpdateTime: string | undefined;
  if (statsRes.ok) {
    const statsDoc = (await statsRes.json()) as { fields?: Record<string, FsValue>; updateTime?: string };
    statsExists = true;
    statsUpdateTime = statsDoc.updateTime;
    currentStatsCount = Math.max(0, readInt(statsDoc.fields, 'creditedCount', 0));
  } else if (statsRes.status !== 404) {
    throw new Error(`Referral stats lookup failed (${statsRes.status})`);
  }

  if (currentStatsCount >= MAX_REFERRALS_PER_USER) {
    await fetch(`${base}/referrals?documentId=${encodeURIComponent(safeNewUid)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          uid: { stringValue: safeNewUid },
          referrerUid: { stringValue: safeReferrerUid },
          bonusGranted: { booleanValue: false },
          createdAt: { timestampValue: nowIso },
        },
      }),
    }).catch(() => {});
    return { alreadyExists: false, credited: false, bonusChars: 0, capReached: true };
  }

  const entryId = `ref_${safeNewUid.slice(0, 24)}_${Date.now().toString(36)}`;

  const commitRes = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          currentDocument: { exists: false },
          update: {
            name: `projects/${projectId}/databases/${databaseId}/documents/referrals/${safeNewUid}`,
            fields: {
              uid: { stringValue: safeNewUid },
              referrerUid: { stringValue: safeReferrerUid },
              bonusGranted: { booleanValue: true },
              createdAt: { timestampValue: nowIso },
            },
          },
        },
        {
          currentDocument: statsExists && statsUpdateTime ? { updateTime: statsUpdateTime } : { exists: false },
          update: {
            name: `projects/${projectId}/databases/${databaseId}/documents/referralStats/${safeReferrerUid}`,
            fields: {
              uid: { stringValue: safeReferrerUid },
              creditedCount: { integerValue: String(currentStatsCount + 1) },
              updatedAt: { timestampValue: nowIso },
            },
          },
        },
        {
          currentDocument: { exists: true },
          update: {
            name: `projects/${projectId}/databases/${databaseId}/documents/wallets/${safeReferrerUid}`,
            fields: {
              updatedAt: { timestampValue: nowIso },
            },
          },
          updateMask: { fieldPaths: ['updatedAt'] },
          updateTransforms: [
            { fieldPath: 'paidCredits', increment: { integerValue: String(bonusChars) } },
          ],
        },
        {
          currentDocument: { exists: false },
          update: {
            name: `projects/${projectId}/databases/${databaseId}/documents/ledger/${entryId}`,
            fields: {
              id: { stringValue: entryId },
              uid: { stringValue: safeReferrerUid },
              type: { stringValue: 'admin_grant' },
              chars: { integerValue: '0' },
              creditsDelta: { integerValue: String(bonusChars) },
              model: { stringValue: 'referral-bonus' },
              note: { stringValue: `Referral invite bonus (+${bonusChars.toLocaleString()} credits)` },
              createdAt: { timestampValue: nowIso },
            },
          },
        },
      ],
    }),
  });

  if (commitRes.status === 409 || commitRes.status === 400) {
    return { alreadyExists: true, credited: false, bonusChars: 0 };
  }
  if (!commitRes.ok) {
    throw new Error(`Referral commit failed (${commitRes.status})`);
  }
  return { alreadyExists: false, credited: true, bonusChars };
}

export interface ServerRuntimeConfig {
  id: string;
  geminiApiKey: string;
  dailyFreeCharLimit: number;
  globalDailyFreeChars: number;
  maintenanceMode: boolean;
  siteNotice: string;
  allowPdfStudio: boolean;
  allowPodcastStudio: boolean;
  updatedBy: string;
  updatedAt?: string;
}

export async function getFirestoreServerConfig(
  creds: ServiceAccountCreds,
  projectId: string,
  databaseId: string
): Promise<ServerRuntimeConfig | null> {
  const token = await getGoogleAccessToken(creds);
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/serverConfig/runtime`;
  const res = await fetch(docUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Server config fetch failed (${res.status})`);
  }
  const doc = (await res.json()) as { fields?: Record<string, FsValue> };
  const f = doc.fields;
  if (!f) return null;

  const updatedAtField = f.updatedAt;
  const updatedAt = updatedAtField && 'timestampValue' in updatedAtField ? updatedAtField.timestampValue : undefined;

  return {
    id: readStr(f, 'id', 'runtime'),
    geminiApiKey: readStr(f, 'geminiApiKey', ''),
    dailyFreeCharLimit: Math.max(0, readInt(f, 'dailyFreeCharLimit', 3000)),
    globalDailyFreeChars: Math.max(0, readInt(f, 'globalDailyFreeChars', 100000)),
    maintenanceMode: readBool(f, 'maintenanceMode', false),
    siteNotice: readStr(f, 'siteNotice', ''),
    allowPdfStudio: readBool(f, 'allowPdfStudio', true),
    allowPodcastStudio: readBool(f, 'allowPodcastStudio', true),
    updatedBy: readStr(f, 'updatedBy', ''),
    updatedAt,
  };
}

export async function saveFirestoreServerConfig(
  creds: ServiceAccountCreds,
  projectId: string,
  databaseId: string,
  cfg: ServerRuntimeConfig
): Promise<void> {
  const token = await getGoogleAccessToken(creds);
  const nowIso = new Date().toISOString();
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/serverConfig/runtime`;
  const res = await fetch(docUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        id: { stringValue: 'runtime' },
        geminiApiKey: { stringValue: cfg.geminiApiKey.slice(0, 256) },
        dailyFreeCharLimit: { integerValue: String(Math.max(0, cfg.dailyFreeCharLimit)) },
        globalDailyFreeChars: { integerValue: String(Math.max(0, cfg.globalDailyFreeChars)) },
        maintenanceMode: { booleanValue: Boolean(cfg.maintenanceMode) },
        siteNotice: { stringValue: cfg.siteNotice.slice(0, 400) },
        allowPdfStudio: { booleanValue: Boolean(cfg.allowPdfStudio) },
        allowPodcastStudio: { booleanValue: Boolean(cfg.allowPodcastStudio) },
        updatedBy: { stringValue: cfg.updatedBy.slice(0, 254) },
        updatedAt: { timestampValue: nowIso },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Server config save failed (${res.status})`);
  }
}
