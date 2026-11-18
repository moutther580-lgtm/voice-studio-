import type { User } from 'firebase/auth';
import { getFirebaseMod } from './firebase-loader';
import type {
  ContactMessageDoc,
  LedgerEntryDoc,
  ReferralRecordDoc,
  UserProfileDoc,
  UserWalletDoc,
} from './firebase';
import { ADMIN_PANEL_HTML } from './private-screens';

export interface AdminHostHooks {
  getCurrentUser: () => User | null;
  isAdminActive: (user: User | null) => boolean;
  navigateToPage: (id: 'tool' | 'admin', moveFocus?: boolean) => void;
  fetchBackendQuota: (user: User) => Promise<void>;
  loadPublicSiteStatus: () => Promise<void>;
  checkHealthText?: () => Promise<void>;
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Missing admin element: ${selector}`);
  return el as T;
};

export function unmountAdminPanel() {
  const mount = document.getElementById('adminMount');
  if (mount) mount.innerHTML = '';
}

export function mountAdminPanel(hooks: AdminHostHooks): void {
  const currentUser = hooks.getCurrentUser();
  if (!hooks.isAdminActive(currentUser)) {
    unmountAdminPanel();
    return;
  }

  const mount = document.getElementById('adminMount');
  if (!mount) return;
  mount.innerHTML = ADMIN_PANEL_HTML;

  document.getElementById('adminBackToStudioBtn')?.addEventListener('click', () => {
    hooks.navigateToPage('tool', true);
  });

  let cachedWallets: Array<{ docId: string; wallet: UserWalletDoc }> = [];
  let cachedLedger: LedgerEntryDoc[] = [];
  let cachedFilteredLedger: LedgerEntryDoc[] = [];
  let cachedInbox: ContactMessageDoc[] = [];
  let unreadOnlyFilter = false;
  let pendingDeleteId: string | null = null;

  const formatActivityLabel = (type: LedgerEntryDoc['type']): string => {
    if (type === 'credit_purchase') return 'Credits added';
    if (type === 'tts_usage') return 'Audio generated';
    return 'Admin update';
  };

  $('#adminSessionIdentity').textContent =
    `Signed in as verified primary admin (${currentUser?.email || ''}). Access is restricted strictly to this account.`;

  const formatUiError = (err: unknown, fallback: string): string => {
    const raw = err instanceof Error ? err.message : String(err || '');
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (parsed.error) return parsed.error;
      } catch {
        // Fall through
      }
    }
    return raw || fallback;
  };
  const setAdminStatus = (msg: string) => {
    $('#adminErr').textContent = '';
    $('#adminMsg').textContent = msg;
  };
  const setAdminError = (msg: string) => {
    $('#adminMsg').textContent = '';
    $('#adminErr').textContent = msg;
  };
  const setServerStatus = (msg: string) => {
    $('#adminServerErr').textContent = '';
    $('#adminServerMsg').textContent = msg;
  };
  const setServerError = (msg: string) => {
    $('#adminServerMsg').textContent = '';
    $('#adminServerErr').textContent = msg;
  };
  const setVercelStatus = (msg: string) => {
    $('#adminVercelErr').textContent = '';
    $('#adminVercelMsg').textContent = msg;
  };
  const setVercelError = (msg: string) => {
    $('#adminVercelMsg').textContent = '';
    $('#adminVercelErr').textContent = msg;
  };

  const maskShort = (raw: string): string => {
    const s = raw.trim();
    if (!s) return 'Not set';
    return s.length <= 8 ? '••••' : `${s.slice(0, 6)}••••${s.slice(-4)}`;
  };

  const applyServerBadges = (data: {
    keySource?: string;
    adminKeyMasked?: string;
    envKeyMasked?: string;
    dailyFreeCharLimit?: number;
    globalDailyFreeChars?: number;
    maintenanceMode?: boolean;
    siteNotice?: string;
    allowPdfStudio?: boolean;
    allowPodcastStudio?: boolean;
    serviceAccountConfigured?: boolean;
    kvConfigured?: boolean;
    vercelEnvConfigured?: boolean;
  }) => {
    const srcLabel =
      data.keySource === 'admin' ? 'Admin Panel Key' : data.keySource === 'env' ? 'Host Env Var' : 'None Configured';
    $('#adminKeySourceBadge').textContent = `Key source: ${srcLabel}`;
    if (typeof data.vercelEnvConfigured === 'boolean') {
      $('#adminVercelBadge').textContent = data.vercelEnvConfigured
        ? 'Vercel Auto-Push: Connected'
        : 'Vercel Auto-Push: Setup once below';
    }
    $('#adminMaintBadge').textContent = data.maintenanceMode ? 'Mode: Maintenance PAUSED' : 'Mode: Live Active';
    $('#adminMaskedKeysInfo').textContent =
      `Active Admin Key: ${data.adminKeyMasked || 'Not set'} · Host Env Key: ${data.envKeyMasked || 'Not set'}`;
    $('#adminDiagDetails').textContent =
      `Service account: ${data.serviceAccountConfigured ? 'Ready' : 'Not set'} · Edge KV: ${data.kvConfigured ? 'Connected' : 'Memory only'} · Vercel Auto-Push: ${data.vercelEnvConfigured ? 'Connected' : 'Setup once above'}`;
    if (typeof data.dailyFreeCharLimit === 'number') {
      $<HTMLInputElement>('#adminCfgDailyLimit').value = String(data.dailyFreeCharLimit);
    }
    if (typeof data.globalDailyFreeChars === 'number') {
      $<HTMLInputElement>('#adminCfgGlobalCap').value = String(data.globalDailyFreeChars);
    }
    if (typeof data.siteNotice === 'string') {
      $<HTMLInputElement>('#adminCfgNotice').value = data.siteNotice;
    }
    if (typeof data.maintenanceMode === 'boolean') {
      $<HTMLInputElement>('#adminCfgMaintenance').checked = data.maintenanceMode;
    }
    if (typeof data.allowPdfStudio === 'boolean') {
      $<HTMLInputElement>('#adminCfgPdfStudio').checked = data.allowPdfStudio;
    }
    if (typeof data.allowPodcastStudio === 'boolean') {
      $<HTMLInputElement>('#adminCfgPodcastStudio').checked = data.allowPodcastStudio;
    }
  };

  const loadServerConfig = async () => {
    try {
      const user = hooks.getCurrentUser();
      if (!user) return;
      const fb = await getFirebaseMod();
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as Parameters<typeof applyServerBadges>[0];
        $('#adminSyncBadge').textContent =
          data.kvConfigured || data.serviceAccountConfigured ? 'Sync: Server + DB Ready' : 'Sync: Runtime Memory';
        applyServerBadges(data);
        return;
      }

      const cachedSummary = await fb.adminGetServerConfig().catch(() => null);
      if (cachedSummary) {
        $('#adminSyncBadge').textContent = 'Sync: Firestore only (API offline)';
        applyServerBadges({
          keySource: cachedSummary.hasGeminiApiKey ? 'admin' : 'env',
          adminKeyMasked: cachedSummary.geminiApiKeyMasked,
          dailyFreeCharLimit: cachedSummary.dailyFreeCharLimit,
          globalDailyFreeChars: cachedSummary.globalDailyFreeChars,
          maintenanceMode: cachedSummary.maintenanceMode,
          siteNotice: cachedSummary.siteNotice,
          allowPdfStudio: cachedSummary.allowPdfStudio,
          allowPodcastStudio: cachedSummary.allowPodcastStudio,
        });
      } else {
        $('#adminSyncBadge').textContent = 'Sync: Check server';
      }
    } catch (err) {
      setServerError(formatUiError(err, 'Could not load server runtime config.'));
    }
  };

  const checkHealth = async () => {
    const statusEl = $('#adminSystemStatus');
    statusEl.textContent = 'Checking server status…';
    try {
      const res = await fetch('/api/health');
      if (res.status === 404) {
        statusEl.textContent = 'Speech server route was not found on this preview URL.';
        return;
      }
      if (!res.ok) {
        statusEl.textContent = `Server returned status code ${res.status}.`;
        return;
      }
      const data = (await res.json()) as {
        backendConfigured?: boolean;
        dailyLimit?: number;
        keySource?: string;
        maintenanceMode?: boolean;
      };
      statusEl.textContent = data.backendConfigured
        ? `Speech server active (Source: ${data.keySource || 'env'}). Daily allowance: ${(data.dailyLimit || 3000).toLocaleString()} chars · ${data.maintenanceMode ? 'Maintenance ON' : 'Live'}.`
        : 'Server is online, but the shared speech key is not configured yet.';
    } catch {
      statusEl.textContent = 'Could not check server status right now.';
    }
  };

  $('#adminToggleKeyVis').onclick = () => {
    const inp = $<HTMLInputElement>('#adminCfgApiKey');
    const btn = $<HTMLButtonElement>('#adminToggleKeyVis');
    const isHidden = inp.type === 'password';
    inp.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? 'Hide' : 'Show';
  };

  $('#adminTestKeyBtn').onclick = async () => {
    const user = hooks.getCurrentUser();
    if (!user) return;
    const btn = $<HTMLButtonElement>('#adminTestKeyBtn');
    const candidate = $<HTMLInputElement>('#adminCfgApiKey').value.trim();
    btn.disabled = true;
    setServerStatus('Testing Gemini API key against Google servers…');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'test_key',
          geminiApiKey: candidate || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setServerError(data.error || 'Key verification failed.');
      } else {
        setServerStatus(data.message || 'Gemini API key verified successfully.');
      }
    } catch (err) {
      setServerError(formatUiError(err, 'Could not reach server to test API key.'));
    } finally {
      btn.disabled = false;
    }
  };

  const commitServerSettings = async (clearKey: boolean) => {
    const user = hooks.getCurrentUser();
    if (!user) return;
    const fb = await getFirebaseMod();
    const saveBtn = $<HTMLButtonElement>('#adminSaveServerBtn');
    const clearBtn = $<HTMLButtonElement>('#adminClearKeyBtn');
    const typedKey = $<HTMLInputElement>('#adminCfgApiKey').value.trim();
    const dailyFreeCharLimit = Math.max(
      0,
      Math.min(1000000, parseInt($<HTMLInputElement>('#adminCfgDailyLimit').value, 10) || 3000)
    );
    const globalDailyFreeChars = Math.max(
      0,
      Math.min(100000000, parseInt($<HTMLInputElement>('#adminCfgGlobalCap').value, 10) || 100000)
    );
    const maintenanceMode = $<HTMLInputElement>('#adminCfgMaintenance').checked;
    const allowPdfStudio = $<HTMLInputElement>('#adminCfgPdfStudio').checked;
    const allowPodcastStudio = $<HTMLInputElement>('#adminCfgPodcastStudio').checked;
    const siteNotice = $<HTMLInputElement>('#adminCfgNotice').value.trim().slice(0, 400);
    const vercelProject = $<HTMLInputElement>('#adminVercelProject').value.trim();
    const vercelTeamId = $<HTMLInputElement>('#adminVercelTeam').value.trim();
    const vercelToken = $<HTMLInputElement>('#adminVercelToken').value.trim();
    const deployHookUrl = $<HTMLInputElement>('#adminVercelHook').value.trim();
    const persistVercelConnection = $<HTMLInputElement>('#adminVercelPersist').checked;

    saveBtn.disabled = true;
    clearBtn.disabled = true;
    setServerStatus(clearKey ? 'Clearing admin API key and saving settings…' : 'Pushing API key & settings to server…');

    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'save_config',
          clearApiKey: clearKey,
          geminiApiKey: clearKey ? '' : typedKey || '__KEEP__',
          dailyFreeCharLimit,
          globalDailyFreeChars,
          maintenanceMode,
          siteNotice,
          allowPdfStudio,
          allowPodcastStudio,
          pushToVercel: !clearKey,
          vercelProject: vercelProject || undefined,
          vercelTeamId: vercelTeamId || undefined,
          vercelToken: vercelToken || undefined,
          deployHookUrl: deployHookUrl || undefined,
          persistVercelConnection,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        persistedToKv?: boolean;
        persistedToFirestore?: boolean;
        vercelPushed?: boolean;
        redeployTriggered?: boolean;
        vercelError?: string;
      } & Parameters<typeof applyServerBadges>[0];

      if (res.status !== 404 && (!res.ok || !data.ok)) {
        setServerError(data.error || 'Could not save server configuration.');
        return;
      }

      $<HTMLInputElement>('#adminCfgApiKey').value = '';
      $<HTMLInputElement>('#adminCfgApiKey').type = 'password';
      $('#adminToggleKeyVis').textContent = 'Show';
      $<HTMLInputElement>('#adminVercelToken').value = '';

      if (!(res.ok && data.ok && data.persistedToFirestore)) {
        await fb.adminSaveServerConfig({
          geminiApiKey: clearKey ? '' : typedKey,
          preserveExistingKey: !clearKey && !typedKey,
          dailyFreeCharLimit,
          globalDailyFreeChars,
          maintenanceMode,
          siteNotice,
          allowPdfStudio,
          allowPodcastStudio,
          updatedBy: user.email || 'moutther580@gmail.com',
        });
      }
      const cachedSummary = await fb.adminGetServerConfig().catch(() => null);

      if (res.ok && data.ok) {
        applyServerBadges(data);
        if (clearKey) {
          setServerStatus('Admin override key cleared from server and reverted cleanly to Host Env key.');
        } else if (data.vercelPushed) {
          setServerStatus(
            data.redeployTriggered
              ? 'Pushed directly to backend & Vercel Env, triggered live production redeploy, and cleared from browser input.'
              : 'Pushed directly to backend & Vercel Env and cleared from browser input.'
          );
        } else if (data.vercelError) {
          setServerStatus('Saved & activated live on backend and cleared from browser input.');
          setVercelError(data.vercelError);
        } else {
          setServerStatus('Saved & activated on backend, synced to Firestore, and cleared from browser input.');
        }
      } else {
        const maskedFallback = clearKey
          ? 'Not set'
          : typedKey
            ? maskShort(typedKey)
            : cachedSummary?.geminiApiKeyMasked || 'Not set';
        applyServerBadges({
          keySource: clearKey ? 'env' : typedKey || cachedSummary?.hasGeminiApiKey ? 'admin' : 'env',
          adminKeyMasked: maskedFallback,
          dailyFreeCharLimit,
          globalDailyFreeChars,
          maintenanceMode,
          siteNotice,
          allowPdfStudio,
          allowPodcastStudio,
        });
        setServerStatus('Saved configuration to Firestore and cleared from browser input.');
      }

      await hooks.loadPublicSiteStatus();
      await hooks.fetchBackendQuota(user);
      await checkHealth();
    } catch (err) {
      setServerError(formatUiError(err, 'Could not save server configuration.'));
    } finally {
      saveBtn.disabled = false;
      clearBtn.disabled = false;
    }
  };

  $('#adminSaveServerBtn').onclick = () => {
    void commitServerSettings(false);
  };
  $('#adminClearKeyBtn').onclick = () => {
    void commitServerSettings(true);
  };

  $('#adminPushVercelBtn').onclick = async () => {
    const user = hooks.getCurrentUser();
    if (!user) return;
    const fb = await getFirebaseMod();
    const btn = $<HTMLButtonElement>('#adminPushVercelBtn');
    const typedKey = $<HTMLInputElement>('#adminCfgApiKey').value.trim();
    const dailyFreeCharLimit = Math.max(
      0,
      Math.min(1000000, parseInt($<HTMLInputElement>('#adminCfgDailyLimit').value, 10) || 3000)
    );
    const globalDailyFreeChars = Math.max(
      0,
      Math.min(100000000, parseInt($<HTMLInputElement>('#adminCfgGlobalCap').value, 10) || 100000)
    );
    const vercelProject = $<HTMLInputElement>('#adminVercelProject').value.trim();
    const vercelTeamId = $<HTMLInputElement>('#adminVercelTeam').value.trim();
    const vercelToken = $<HTMLInputElement>('#adminVercelToken').value.trim();
    const deployHookUrl = $<HTMLInputElement>('#adminVercelHook').value.trim();
    const persistVercelConnection = $<HTMLInputElement>('#adminVercelPersist').checked;

    btn.disabled = true;
    setVercelStatus('Pushing environment variables directly to Vercel…');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'push_vercel_env',
          geminiApiKey: typedKey || undefined,
          dailyFreeCharLimit,
          globalDailyFreeChars,
          vercelProject: vercelProject || undefined,
          vercelTeamId: vercelTeamId || undefined,
          vercelToken: vercelToken || undefined,
          deployHookUrl: deployHookUrl || undefined,
          persistVercelConnection,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string; maskedKey?: string };
      if (!res.ok || !data.ok) {
        setVercelError(data.error || 'Could not push environment variables to Vercel.');
        return;
      }
      $<HTMLInputElement>('#adminVercelToken').value = '';
      $<HTMLInputElement>('#adminCfgApiKey').value = '';
      $<HTMLInputElement>('#adminCfgApiKey').type = 'password';
      $('#adminToggleKeyVis').textContent = 'Show';
      if (typedKey) {
        await fb
          .adminSaveServerConfig({
            geminiApiKey: typedKey,
            dailyFreeCharLimit,
            globalDailyFreeChars,
            maintenanceMode: $<HTMLInputElement>('#adminCfgMaintenance').checked,
            siteNotice: $<HTMLInputElement>('#adminCfgNotice').value.trim(),
            allowPdfStudio: $<HTMLInputElement>('#adminCfgPdfStudio').checked,
            allowPodcastStudio: $<HTMLInputElement>('#adminCfgPodcastStudio').checked,
            updatedBy: user.email || 'moutther580@gmail.com',
          })
          .catch(() => {});
      }
      setVercelStatus(data.message || 'Environment variables pushed directly to Vercel and cleared from browser.');
      await loadServerConfig();
      await hooks.loadPublicSiteStatus();
    } catch (err) {
      setVercelError(formatUiError(err, 'Could not reach server to push Vercel environment variables.'));
    } finally {
      btn.disabled = false;
    }
  };

  mount.querySelectorAll<HTMLButtonElement>('.admin-preset-credit').forEach((btn) => {
    btn.onclick = () => {
      const val = btn.dataset.credits || '0';
      $<HTMLInputElement>('#adminAddCredits').value = val;
      setAdminStatus(`Credit amount set to ${Number(val).toLocaleString()} characters.`);
    };
  });

  const updateWalletOverview = (wallets: Array<{ docId: string; wallet: UserWalletDoc }>) => {
    cachedWallets = wallets;
    const today = new Date().toISOString().slice(0, 10);
    const totalCredits = wallets.reduce((acc, item) => acc + (item.wallet.paidCredits || 0), 0);
    const totalDaily = wallets.reduce(
      (acc, item) => acc + (item.wallet.dailyDate === today ? item.wallet.dailyUsedChars || 0 : 0),
      0
    );
    $('#adminStatWallets').textContent = wallets.length.toLocaleString();
    $('#adminStatCredits').textContent = totalCredits.toLocaleString();
    $('#adminStatDaily').textContent = totalDaily.toLocaleString();
  };

  const renderLedgerTable = () => {
    const filterText = $<HTMLInputElement>('#adminLedgerFilter').value.trim().toLowerCase();
    const typeFilter = $<HTMLSelectElement>('#adminLedgerType').value;
    const filtered = cachedLedger.filter((entry) => {
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
      if (!filterText) return true;
      return (
        entry.uid.toLowerCase().includes(filterText) ||
        entry.note.toLowerCase().includes(filterText) ||
        entry.model.toLowerCase().includes(filterText)
      );
    });
    cachedFilteredLedger = filtered;

    const tbody = $('#adminLedgerBody');
    tbody.innerHTML = '';
    for (const e of filtered) {
      const tr = document.createElement('tr');
      const tdTime = document.createElement('td');
      tdTime.textContent = e.createdAt?.toDate?.()?.toLocaleString() || 'Recent';
      const tdUid = document.createElement('td');
      tdUid.textContent = e.uid;
      const tdType = document.createElement('td');
      tdType.textContent = formatActivityLabel(e.type);
      const tdDelta = document.createElement('td');
      tdDelta.textContent = `${e.creditsDelta > 0 ? '+' : ''}${e.creditsDelta.toLocaleString()}`;
      const tdChars = document.createElement('td');
      tdChars.textContent = e.chars.toLocaleString();
      const tdModel = document.createElement('td');
      tdModel.textContent = e.model === 'admin-portal' ? 'Admin Panel' : e.model || '—';
      const tdNote = document.createElement('td');
      tdNote.textContent = e.note || '—';
      tr.append(tdTime, tdUid, tdType, tdDelta, tdChars, tdModel, tdNote);
      tbody.appendChild(tr);
    }
    $('#adminLedgerWrap').hidden = filtered.length === 0;
    $('#adminLedgerMsg').textContent = `Showing ${filtered.length} of ${cachedLedger.length} recent record(s).`;
  };

  const loadLedger = async () => {
    $('#adminLedgerErr').textContent = '';
    $('#adminLedgerMsg').textContent = 'Loading recent history…';
    try {
      const fb = await getFirebaseMod();
      cachedLedger = await fb.adminListRecentLedger();
      renderLedgerTable();
    } catch (err) {
      $('#adminLedgerMsg').textContent = '';
      $('#adminLedgerErr').textContent = formatUiError(err, 'Could not load activity history.');
    }
  };

  const renderWalletRows = (wallets: Array<{ docId: string; wallet: UserWalletDoc }>, focusGrantDocId?: string) => {
    const tbody = $('#adminUsersBody');
    tbody.innerHTML = '';
    for (const { docId, wallet: w } of wallets) {
      const tr = document.createElement('tr');

      const tdEmail = document.createElement('td');
      tdEmail.textContent = w.email;
      const tdId = document.createElement('td');
      tdId.textContent = docId;
      const tdPlan = document.createElement('td');
      tdPlan.textContent = w.plan === 'pro' ? 'Extended' : 'Free';
      const tdDaily = document.createElement('td');
      tdDaily.textContent = `${w.dailyUsedChars.toLocaleString()}/${w.dailyLimit.toLocaleString()}`;
      const tdLifetime = document.createElement('td');
      tdLifetime.textContent = (w.totalCharsUsed || 0).toLocaleString();
      const tdPaid = document.createElement('td');
      tdPaid.textContent = w.paidCredits.toLocaleString();

      const tdAct = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'admin-row-actions';

      const selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'sec';
      selBtn.textContent = 'Select';
      selBtn.setAttribute('aria-label', `Select account for ${w.email}`);
      selBtn.onclick = () => {
        $<HTMLInputElement>('#adminUid').value = docId;
        $<HTMLInputElement>('#adminDailyLimit').value = String(w.dailyLimit);
        $<HTMLSelectElement>('#adminPlan').value = w.plan;
        setAdminStatus(`Selected ${w.email}. Current credits: ${w.paidCredits.toLocaleString()}.`);
        $('#adminAddCredits').focus();
      };

      const quickGrantBtn = document.createElement('button');
      quickGrantBtn.type = 'button';
      quickGrantBtn.className = 'sec';
      quickGrantBtn.textContent = '+10k';
      quickGrantBtn.setAttribute('aria-label', `Add 10,000 credits to ${w.email}`);
      quickGrantBtn.dataset.grantDoc = docId;
      quickGrantBtn.onclick = async () => {
        setAdminStatus(`Adding 10,000 credits to ${w.email}…`);
        try {
          const fb = await getFirebaseMod();
          const updated = await fb.adminGrantCredits(
            docId,
            10000,
            w.dailyLimit,
            w.plan,
            'Added 10,000 credits from Admin Panel'
          );
          setAdminStatus(`Added 10,000 credits to ${updated.email}. New balance: ${updated.paidCredits.toLocaleString()}.`);
          const refreshed = await fb.adminListWallets();
          updateWalletOverview(refreshed);
          renderWalletRows(refreshed, docId);
          if (cachedLedger.length) await loadLedger();
          const user = hooks.getCurrentUser();
          if (user && (updated.uid === user.uid || updated.email === user.email)) {
            await hooks.fetchBackendQuota(user);
          }
        } catch (err) {
          setAdminError(formatUiError(err, 'Could not add credits.'));
        }
      };

      const resetTodayBtn = document.createElement('button');
      resetTodayBtn.type = 'button';
      resetTodayBtn.className = 'sec';
      resetTodayBtn.textContent = 'Reset Today';
      resetTodayBtn.setAttribute('aria-label', `Reset today's usage to 0 for ${w.email}`);
      resetTodayBtn.onclick = async () => {
        setAdminStatus(`Resetting today's usage for ${w.email}…`);
        try {
          const fb = await getFirebaseMod();
          await fb.adminResetUserDailyUsage(docId, w.email);
          setAdminStatus(`Reset today's character usage to 0 for ${w.email}.`);
          const refreshed = await fb.adminListWallets();
          updateWalletOverview(refreshed);
          renderWalletRows(refreshed, docId);
          if (cachedLedger.length) await loadLedger();
          const user = hooks.getCurrentUser();
          if (user && (docId === user.uid || w.email === user.email)) {
            await hooks.fetchBackendQuota(user);
          }
        } catch (err) {
          setAdminError(formatUiError(err, 'Could not reset daily usage.'));
        }
      };

      const ledgerBtn = document.createElement('button');
      ledgerBtn.type = 'button';
      ledgerBtn.className = 'sec';
      ledgerBtn.textContent = 'History';
      ledgerBtn.setAttribute('aria-label', `View activity history for ${w.email}`);
      ledgerBtn.onclick = async () => {
        $<HTMLInputElement>('#adminLedgerFilter').value = docId;
        $<HTMLSelectElement>('#adminLedgerType').value = 'all';
        if (!cachedLedger.length) await loadLedger();
        else renderLedgerTable();
        $('#adminLedgerFilter').focus();
      };

      wrap.append(selBtn, quickGrantBtn, resetTodayBtn, ledgerBtn);
      tdAct.appendChild(wrap);

      tr.append(tdEmail, tdId, tdPlan, tdDaily, tdLifetime, tdPaid, tdAct);
      tbody.appendChild(tr);

      if (focusGrantDocId && focusGrantDocId === docId) {
        quickGrantBtn.focus();
      }
    }
    $('#adminTableWrap').hidden = wallets.length === 0;
  };

  const renderProfilesRows = (profiles: UserProfileDoc[], adminUid: string) => {
    const tbody = $('#adminProfilesBody');
    tbody.innerHTML = '';
    for (const u of profiles) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = u.displayName || '—';
      const tdEmail = document.createElement('td');
      tdEmail.textContent = u.email;
      const tdUid = document.createElement('td');
      tdUid.textContent = u.uid;
      const tdRole = document.createElement('td');
      tdRole.textContent = u.uid === adminUid ? 'Primary Admin' : u.role === 'admin' ? 'Co-Admin' : 'User';

      const tdAct = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'admin-row-actions';

      const selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'sec';
      selBtn.textContent = 'Select';
      selBtn.setAttribute('aria-label', `Select user ${u.email}`);
      selBtn.onclick = () => {
        $<HTMLInputElement>('#adminUid').value = u.uid;
        setAdminStatus(`Selected user ${u.email}.`);
        $('#adminAddCredits').focus();
      };
      wrap.appendChild(selBtn);

      if (u.uid !== adminUid) {
        const makeAdmin = u.role !== 'admin';
        const roleBtn = document.createElement('button');
        roleBtn.type = 'button';
        roleBtn.className = 'sec';
        roleBtn.textContent = makeAdmin ? 'Make Co-Admin' : 'Remove Co-Admin';
        roleBtn.setAttribute('aria-label', `${roleBtn.textContent} for ${u.email}`);
        roleBtn.onclick = async () => {
          setAdminStatus(`Updating role for ${u.email}…`);
          try {
            const fb = await getFirebaseMod();
            await fb.adminUpdateUserRole(u.uid, u.email, makeAdmin);
            const refreshedProfiles = await fb.adminListUsers();
            renderProfilesRows(refreshedProfiles, fb.ADMIN_UID);
            setAdminStatus(`${u.email} role updated to ${makeAdmin ? 'Co-Admin' : 'Standard User'}.`);
          } catch (err) {
            setAdminError(formatUiError(err, 'Could not update user role.'));
          }
        };
        wrap.appendChild(roleBtn);
      }

      tdAct.appendChild(wrap);
      tr.append(tdName, tdEmail, tdUid, tdRole, tdAct);
      tbody.appendChild(tr);
    }
    $('#adminProfilesWrap').hidden = profiles.length === 0;
  };

  const findBtn = $<HTMLButtonElement>('#adminFindBtn');
  const loadUsersBtn = $<HTMLButtonElement>('#adminLoadUsers');
  const loadProfilesBtn = $<HTMLButtonElement>('#adminLoadProfiles');
  const applyBtn = $<HTMLButtonElement>('#adminApply');

  findBtn.onclick = async () => {
    const queryVal = $<HTMLInputElement>('#adminSearchInput').value.trim();
    if (!queryVal) {
      setAdminError('Enter an email address or account ID to search.');
      $('#adminSearchInput').focus();
      return;
    }
    findBtn.disabled = true;
    setAdminStatus(`Searching for ${queryVal}…`);
    try {
      const fb = await getFirebaseMod();
      const found = await fb.adminFindWallet(queryVal);
      if (!found) {
        renderWalletRows([]);
        $<HTMLInputElement>('#adminUid').value = queryVal;
        setAdminStatus(
          queryVal.includes('@')
            ? `No existing account for ${queryVal}. Target field is filled if you want to set it up.`
            : `No user found with ID ${queryVal}.`
        );
        return;
      }
      renderWalletRows([found]);
      $<HTMLInputElement>('#adminUid').value = found.docId;
      $<HTMLInputElement>('#adminDailyLimit').value = String(found.wallet.dailyLimit);
      $<HTMLSelectElement>('#adminPlan').value = found.wallet.plan;
      setAdminStatus(`Found account for ${found.wallet.email}.`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Search failed.'));
    } finally {
      findBtn.disabled = false;
    }
  };

  loadUsersBtn.onclick = async () => {
    loadUsersBtn.disabled = true;
    setAdminStatus('Loading user accounts…');
    try {
      const fb = await getFirebaseMod();
      const wallets = await fb.adminListWallets();
      updateWalletOverview(wallets);
      renderWalletRows(wallets);
      setAdminStatus(`Loaded ${wallets.length} user account(s).`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Could not load user accounts.'));
    } finally {
      loadUsersBtn.disabled = false;
    }
  };

  loadProfilesBtn.onclick = async () => {
    loadProfilesBtn.disabled = true;
    setAdminStatus('Loading user profiles…');
    try {
      const fb = await getFirebaseMod();
      const profiles = await fb.adminListUsers();
      renderProfilesRows(profiles, fb.ADMIN_UID);
      setAdminStatus(`Loaded ${profiles.length} user profile(s).`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Could not load user profiles.'));
    } finally {
      loadProfilesBtn.disabled = false;
    }
  };

  applyBtn.onclick = async () => {
    const target = $<HTMLInputElement>('#adminUid').value.trim();
    const addCredits = parseInt($<HTMLInputElement>('#adminAddCredits').value, 10) || 0;
    const parsedLimit = parseInt($<HTMLInputElement>('#adminDailyLimit').value, 10);
    const dailyLimit = Number.isNaN(parsedLimit) ? 3000 : Math.max(0, parsedLimit);
    const plan = $<HTMLSelectElement>('#adminPlan').value === 'pro' ? 'pro' : 'free';
    const note = $<HTMLInputElement>('#adminNote').value;

    if (!target) {
      setAdminError('Choose or enter a user email or account ID first.');
      $('#adminUid').focus();
      return;
    }
    applyBtn.disabled = true;
    setAdminStatus('Saving changes…');
    try {
      const fb = await getFirebaseMod();
      const updated = await fb.adminGrantCredits(target, addCredits, dailyLimit, plan, note);
      setAdminStatus(
        `Saved for ${updated.email}: Credits ${updated.paidCredits.toLocaleString()}, Daily limit ${updated.dailyLimit.toLocaleString()}, Plan ${updated.plan === 'pro' ? 'Extended' : 'Free'}.`
      );
      $('#adminMsg').focus();
      const wallets = await fb.adminListWallets();
      updateWalletOverview(wallets);
      renderWalletRows(wallets);
      await loadLedger();
      const user = hooks.getCurrentUser();
      if (user && (updated.uid === user.uid || updated.email === user.email)) {
        await hooks.fetchBackendQuota(user);
      }
    } catch (err) {
      setAdminError(formatUiError(err, 'Could not save changes.'));
    } finally {
      applyBtn.disabled = false;
    }
  };

  $('#adminBulkGrantBtn').onclick = async () => {
    const bulkBtn = $<HTMLButtonElement>('#adminBulkGrantBtn');
    const bonus = parseInt($<HTMLInputElement>('#adminBulkCredits').value, 10) || 0;
    const note = $<HTMLInputElement>('#adminBulkNote').value;
    if (bonus === 0) {
      setAdminError('Enter a non-zero bonus character amount.');
      return;
    }
    bulkBtn.disabled = true;
    setAdminStatus('Granting bonus credits to all active user accounts…');
    try {
      const fb = await getFirebaseMod();
      const targets = cachedWallets.length ? cachedWallets : await fb.adminListWallets();
      const count = await fb.adminGrantBulkCredits(targets, bonus, note);
      const refreshed = await fb.adminListWallets();
      updateWalletOverview(refreshed);
      renderWalletRows(refreshed);
      await loadLedger();
      const user = hooks.getCurrentUser();
      if (user) await hooks.fetchBackendQuota(user);
      setAdminStatus(`Granted ${bonus >= 0 ? '+' : ''}${bonus.toLocaleString()} credits across ${count} account(s).`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Bulk grant failed.'));
    } finally {
      bulkBtn.disabled = false;
    }
  };

  $('#adminLoadLedger').onclick = () => {
    void loadLedger();
  };
  $('#adminExportCsvBtn').onclick = () => {
    const rows = cachedFilteredLedger.length ? cachedFilteredLedger : cachedLedger;
    if (!rows.length) {
      $('#adminLedgerErr').textContent = 'Load recent activity history before exporting CSV.';
      return;
    }
    const esc = (v: unknown) => {
      const raw = String(v ?? '');
      const safe =
        typeof v === 'number' || /^-?\d+(?:\.\d+)?$/.test(raw)
          ? raw
          : /^[=+\-@\t\r]/.test(raw)
            ? `'${raw}`
            : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [
      ['Time', 'UID', 'Activity', 'CreditsDelta', 'Characters', 'Model', 'Note'].map(esc).join(','),
      ...rows.map((r) =>
        [
          r.createdAt?.toDate?.()?.toISOString() || '',
          r.uid,
          formatActivityLabel(r.type),
          r.creditsDelta,
          r.chars,
          r.model,
          r.note,
        ]
          .map(esc)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice-studio-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    $('#adminLedgerMsg').textContent = `Exported ${rows.length} ledger row(s) to CSV.`;
  };
  $('#adminLedgerFilter').addEventListener('input', () => {
    if (cachedLedger.length) renderLedgerTable();
  });
  $('#adminLedgerType').addEventListener('change', () => {
    if (cachedLedger.length) renderLedgerTable();
  });

  const setInboxStatus = (msg: string) => {
    $('#adminInboxErr').textContent = '';
    $('#adminInboxMsg').textContent = msg;
  };
  const setInboxError = (msg: string) => {
    $('#adminInboxMsg').textContent = '';
    $('#adminInboxErr').textContent = msg;
  };

  type InboxFocusTarget =
    | { kind: 'toggle'; id: string }
    | { kind: 'confirm'; id: string }
    | { kind: 'delete'; id: string }
    | { kind: 'status' };

  const renderInbox = (focusTarget?: InboxFocusTarget) => {
    const unreadCount = cachedInbox.filter((m) => m.status === 'unread').length;
    $('#adminStatUnread').textContent = unreadCount.toLocaleString();

    const visible = unreadOnlyFilter ? cachedInbox.filter((m) => m.status === 'unread') : cachedInbox;
    const ul = $('#adminInboxList');
    ul.innerHTML = '';
    if (!visible.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = unreadOnlyFilter ? 'No unread messages.' : 'No contact messages found.';
      ul.appendChild(li);
      if (focusTarget?.kind === 'status') $('#adminInboxMsg').focus();
      return;
    }

    for (const m of visible) {
      const li = document.createElement('li');
      li.className = 'inbox-item';

      const heading = document.createElement('strong');
      heading.textContent = `[${m.status === 'unread' ? 'UNREAD' : 'READ'}] ${m.subject}`;

      const meta = document.createElement('div');
      meta.className = 'inbox-meta';
      const when = m.createdAt?.toDate?.()?.toLocaleString() || 'Recent';
      meta.textContent = `From: ${m.name} (${m.email}) · ${when}`;

      const body = document.createElement('p');
      body.className = 'inbox-body';
      body.textContent = m.message;

      const actions = document.createElement('div');
      actions.className = 'btn-group';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'sec';
      const nextStatus = m.status === 'unread' ? 'read' : 'unread';
      toggleBtn.textContent = m.status === 'unread' ? 'Mark as read' : 'Mark as unread';
      toggleBtn.setAttribute('aria-label', `${toggleBtn.textContent} message from ${m.name}`);
      toggleBtn.onclick = async () => {
        try {
          const fb = await getFirebaseMod();
          await fb.adminSetContactMessageStatus(m.id, nextStatus);
          cachedInbox = await fb.adminListContactMessages();
          renderInbox({ kind: 'toggle', id: m.id });
          setInboxStatus(`Marked message from ${m.name} as ${nextStatus}.`);
        } catch (err) {
          setInboxError(formatUiError(err, 'Could not update message status.'));
        }
      };

      if (pendingDeleteId === m.id) {
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'dng';
        confirmBtn.textContent = 'Confirm delete';
        confirmBtn.setAttribute('aria-label', `Confirm delete message from ${m.name}`);
        confirmBtn.onclick = async () => {
          try {
            pendingDeleteId = null;
            const fb = await getFirebaseMod();
            await fb.adminDeleteContactMessage(m.id);
            cachedInbox = await fb.adminListContactMessages();
            setInboxStatus(`Deleted message from ${m.name}.`);
            renderInbox({ kind: 'status' });
          } catch (err) {
            setInboxError(formatUiError(err, 'Could not delete message.'));
          }
        };

        const cancelDelBtn = document.createElement('button');
        cancelDelBtn.type = 'button';
        cancelDelBtn.className = 'sec';
        cancelDelBtn.textContent = 'Cancel';
        cancelDelBtn.onclick = () => {
          pendingDeleteId = null;
          renderInbox({ kind: 'delete', id: m.id });
        };

        actions.append(toggleBtn, confirmBtn, cancelDelBtn);
        li.append(heading, meta, body, actions);
        ul.appendChild(li);

        if (focusTarget?.kind === 'confirm' && focusTarget.id === m.id) confirmBtn.focus();
        else if (focusTarget?.kind === 'toggle' && focusTarget.id === m.id) toggleBtn.focus();
      } else {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'dng';
        delBtn.textContent = 'Delete';
        delBtn.setAttribute('aria-label', `Delete message from ${m.name}`);
        delBtn.onclick = () => {
          pendingDeleteId = m.id;
          renderInbox({ kind: 'confirm', id: m.id });
        };
        actions.append(toggleBtn, delBtn);
        li.append(heading, meta, body, actions);
        ul.appendChild(li);

        if (focusTarget?.kind === 'delete' && focusTarget.id === m.id) delBtn.focus();
        else if (focusTarget?.kind === 'toggle' && focusTarget.id === m.id) toggleBtn.focus();
      }
    }

    if (focusTarget?.kind === 'status') {
      $('#adminInboxMsg').focus();
    }
  };

  $('#adminLoadInbox').onclick = async () => {
    setInboxStatus('Loading contact messages…');
    try {
      const fb = await getFirebaseMod();
      cachedInbox = await fb.adminListContactMessages();
      renderInbox();
      const unreadCount = cachedInbox.filter((m) => m.status === 'unread').length;
      setInboxStatus(`Loaded ${cachedInbox.length} message(s) (${unreadCount} unread).`);
    } catch (err) {
      setInboxError(formatUiError(err, 'Could not load contact messages.'));
    }
  };

  $('#adminUnreadOnly').onclick = () => {
    unreadOnlyFilter = !unreadOnlyFilter;
    const btn = $('#adminUnreadOnly');
    btn.setAttribute('aria-pressed', String(unreadOnlyFilter));
    btn.textContent = unreadOnlyFilter ? 'Show all messages' : 'Show unread only';
    renderInbox();
  };

  const renderReferralsTable = (rows: ReferralRecordDoc[]) => {
    const tbody = $('#adminRefBody');
    tbody.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      const tdUid = document.createElement('td');
      tdUid.textContent = r.uid;
      const tdRef = document.createElement('td');
      tdRef.textContent = r.referrerUid;
      const tdStatus = document.createElement('td');
      tdStatus.textContent = r.bonusGranted ? 'Bonus granted (+2,000)' : 'Pending approval';

      const tdAct = document.createElement('td');
      if (!r.bonusGranted) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sec';
        btn.textContent = 'Grant +2k bonus';
        btn.onclick = async () => {
          $('#adminRefErr').textContent = '';
          $('#adminRefMsg').textContent = `Granting referral bonus for ${r.referrerUid}…`;
          try {
            const fb = await getFirebaseMod();
            await fb.adminApproveReferral(r, 2000);
            const refreshed = await fb.adminListReferrals();
            renderReferralsTable(refreshed);
            const wallets = await fb.adminListWallets();
            updateWalletOverview(wallets);
            renderWalletRows(wallets);
            $('#adminRefMsg').textContent = `Granted 2,000 credits to ${r.referrerUid}.`;
          } catch (err) {
            $('#adminRefErr').textContent = formatUiError(err, 'Could not grant referral bonus.');
          }
        };
        tdAct.appendChild(btn);
      } else {
        tdAct.textContent = 'Completed';
      }
      tr.append(tdUid, tdRef, tdStatus, tdAct);
      tbody.appendChild(tr);
    }
    $('#adminRefWrap').hidden = rows.length === 0;
    $('#adminRefMsg').textContent = rows.length ? `Showing ${rows.length} referral record(s).` : 'No referrals recorded yet.';
  };

  $('#adminLoadReferrals').onclick = async () => {
    $('#adminRefErr').textContent = '';
    $('#adminRefMsg').textContent = 'Loading referrals…';
    try {
      const fb = await getFirebaseMod();
      const rows = await fb.adminListReferrals();
      renderReferralsTable(rows);
    } catch (err) {
      $('#adminRefMsg').textContent = '';
      $('#adminRefErr').textContent = formatUiError(err, 'Could not load referrals.');
    }
  };

  $('#adminCheckHealth').onclick = () => {
    void checkHealth();
  };

  const refreshAllBtn = $<HTMLButtonElement>('#adminRefreshAll');
  refreshAllBtn.onclick = async () => {
    refreshAllBtn.disabled = true;
    $('#adminOverviewMsg').textContent = 'Loading admin overview…';
    try {
      const fb = await getFirebaseMod();
      const [wallets, profiles, ledger, inbox, referrals] = await Promise.all([
        fb.adminListWallets(),
        fb.adminListUsers(),
        fb.adminListRecentLedger(),
        fb.adminListContactMessages(),
        fb.adminListReferrals(),
      ]);
      updateWalletOverview(wallets);
      renderWalletRows(wallets);
      renderProfilesRows(profiles, fb.ADMIN_UID);
      cachedLedger = ledger;
      renderLedgerTable();
      cachedInbox = inbox;
      renderInbox();
      renderReferralsTable(referrals);
      await loadServerConfig();
      await checkHealth();
      $('#adminOverviewMsg').textContent =
        `All admin sections updated (${wallets.length} wallet(s), ${profiles.length} profile(s)).`;
    } catch (err) {
      $('#adminOverviewMsg').textContent = formatUiError(err, 'Some sections could not be loaded.');
    } finally {
      refreshAllBtn.disabled = false;
    }
  };
}
