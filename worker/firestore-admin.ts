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
}

let cachedToken: { token: string; exp: number } | null = null;

async function getGoogleAccessToken(creds: ServiceAccountCreds): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) {
    return cachedToken.token;
  }

  const key = await importPKCS8(creds.private_key, 'RS256');
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
  | { timestampValue: string };

function readStr(fields: Record<string, FsValue> | undefined, key: string, fallback = ''): string {
  const v = fields?.[key];
  return v && 'stringValue' in v ? v.stringValue : fallback;
}

function readInt(fields: Record<string, FsValue> | undefined, key: string, fallback = 0): number {
  const v = fields?.[key];
  return v && 'integerValue' in v ? parseInt(v.integerValue, 10) || 0 : fallback;
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
  const token = await getGoogleAccessToken(creds);
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/wallets/${uid}`;
  const res = await fetch(docUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) {
    return {
      uid,
      email,
      paidCredits: 0,
      dailyUsedChars: 0,
      dailyDate: todayStr,
      dailyLimit: defaultDailyLimit,
      totalCharsUsed: 0,
      plan: 'free',
    };
  }
  if (!res.ok) {
    throw new Error(`Firestore wallet fetch failed (${res.status})`);
  }

  const doc = (await res.json()) as { fields?: Record<string, FsValue> };
  const f = doc.fields;
  const storedDate = readStr(f, 'dailyDate', todayStr);
  const sameDay = storedDate === todayStr;

  return {
    uid,
    email: readStr(f, 'email', email),
    paidCredits: Math.max(0, readInt(f, 'paidCredits', 0)),
    dailyUsedChars: sameDay ? Math.max(0, readInt(f, 'dailyUsedChars', 0)) : 0,
    dailyDate: todayStr,
    dailyLimit: Math.max(0, readInt(f, 'dailyLimit', defaultDailyLimit)),
    totalCharsUsed: Math.max(0, readInt(f, 'totalCharsUsed', 0)),
    plan: readStr(f, 'plan', 'free') === 'pro' ? 'pro' : 'free',
  };
}

export async function commitFirestoreUsage(
  creds: ServiceAccountCreds,
  projectId: string,
  databaseId: string,
  wallet: WalletSnapshot,
  charsUsed: number,
  creditsDeducted: number,
  model: string
): Promise<void> {
  const token = await getGoogleAccessToken(creds);
  const nowIso = new Date().toISOString();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
  const entryId = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const commitRes = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: `projects/${projectId}/databases/${databaseId}/documents/wallets/${wallet.uid}`,
            fields: {
              uid: { stringValue: wallet.uid },
              email: { stringValue: wallet.email },
              paidCredits: { integerValue: String(wallet.paidCredits) },
              dailyUsedChars: { integerValue: String(wallet.dailyUsedChars) },
              dailyDate: { stringValue: wallet.dailyDate },
              dailyLimit: { integerValue: String(wallet.dailyLimit) },
              totalCharsUsed: { integerValue: String(wallet.totalCharsUsed) },
              plan: { stringValue: wallet.plan },
              updatedAt: { timestampValue: nowIso },
            },
          },
        },
        {
          update: {
            name: `projects/${projectId}/databases/${databaseId}/documents/ledger/${entryId}`,
            fields: {
              id: { stringValue: entryId },
              uid: { stringValue: wallet.uid },
              type: { stringValue: 'tts_usage' },
              chars: { integerValue: String(charsUsed) },
              creditsDelta: { integerValue: String(-creditsDeducted) },
              model: { stringValue: model.slice(0, 80) },
              note: {
                stringValue: creditsDeducted > 0
                  ? `Speech synthesis (${charsUsed} chars; ${creditsDeducted} paid credits)`
                  : `Free daily allowance (${charsUsed} chars)`,
              },
              createdAt: { timestampValue: nowIso },
            },
          },
        },
      ],
    }),
  });

  if (!commitRes.ok) {
    throw new Error(`Firestore commit failed (${commitRes.status})`);
  }
}
