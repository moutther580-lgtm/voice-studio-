export const AUTH_CARD_HTML = `
  <div class="card auth-book-card" id="authCard" tabindex="-1">
    <h2 id="authCardHeading">Sign in to Speech Studio (/app)</h2>
    <p class="hint">Sign in to activate <strong>3,000 free characters daily</strong>, full MP3 and WAV downloads, chapter books, and subtitle video export—or connect your own free Gemini API key anytime. This workspace is always ad-free.</p>

    <div class="btn-group">
      <button id="googleSignIn" type="button" class="full">Continue with Google</button>
    </div>

    <div class="auth-tabs" role="group" aria-label="Email authentication mode">
      <button id="tabSignIn" type="button" aria-pressed="true">Sign in with Email</button>
      <button id="tabSignUp" type="button" aria-pressed="false">Create Account</button>
    </div>

    <form id="authForm" novalidate>
      <div id="authNameWrap" hidden>
        <label for="authName">Full name</label>
        <input id="authName" type="text" autocomplete="name" maxlength="120" placeholder="Your name">
      </div>
      <label for="authEmail">Email address</label>
      <input id="authEmail" type="email" autocomplete="email" required placeholder="you@example.com">
      <label for="authPass">Password (minimum 6 characters)</label>
      <input id="authPass" type="password" autocomplete="current-password" minlength="6" required placeholder="Enter password">
      <div class="btn-group">
        <button id="authSubmit" type="submit">Sign in</button>
        <button id="authReset" type="button" class="sec">Reset password</button>
      </div>
    </form>

    <p id="authMsg" class="hint" role="status" aria-live="polite"></p>
    <p class="trust-note"><strong>Your files stay with you:</strong> Books and handouts stay inside your browser and are never stored on our servers. Text sent for voicing goes to Google's Gemini API under Google's terms.</p>
  </div>
`;

export const VERIFY_BOX_HTML = `
  <div class="card" id="authVerifyBox" tabindex="-1" hidden>
    <h1 tabindex="-1">Verify your email address</h1>
    <p id="verifyPromptText" class="note-box"></p>
    <div class="btn-group">
      <button id="refreshVerify" type="button">I verified — refresh status</button>
      <button id="resendVerify" type="button" class="sec">Resend verification email</button>
      <button id="signOutVerify" type="button" class="dng">Sign out</button>
    </div>
    <p id="verifyMsg" class="hint" role="status" aria-live="polite"></p>
  </div>
`;

export const CONVERTER_WORKSPACE_HTML = `
  <div id="converterWorkspace" hidden>
    <h1 tabindex="-1">Speech &amp; Audiobook Studio</h1>
    <p class="lead">Select your narrator voice and output format below, then drop a file or paste text to build clean MP3, WAV, or chapter audiobook files. This workspace stays ad-free.</p>

    <div class="card compact-bar" id="workspaceBalanceBar">
      <p class="account-meta" id="workspaceBalanceText">Checking balance…</p>
      <p class="hint" id="backendNotice" hidden></p>
    </div>

    <div class="card">
      <h2>1. Voice, model &amp; speaking style</h2>
      <div class="row">
        <div>
          <label id="voiceLabel" for="voice">Voice</label>
          <select id="voice"></select>
        </div>
        <div id="voiceBWrap" hidden>
          <label for="voiceB">Speaker B voice</label>
          <select id="voiceB"></select>
        </div>
        <div>
          <label for="mode">Narration mode</label>
          <select id="mode">
            <option value="single">Single voice (books, articles)</option>
            <option value="dialogue">Dialogue / 2 speakers (podcasts)</option>
          </select>
        </div>
        <div>
          <label for="model">Speech model</label>
          <select id="model"></select>
        </div>
      </div>

      <p id="dialogueHint" class="hint" hidden>Prefix lines with <strong>Host:</strong> / <strong>Guest:</strong> or <strong>A:</strong> / <strong>B:</strong> to switch speakers automatically.</p>

      <label for="stylePreset">Quick speaking style preset</label>
      <select id="stylePreset">
        <option value="">Standard natural delivery (no style override)</option>
        <option value="slowly, clearly, and calmly">Slow, clear &amp; calm narrator</option>
        <option value="warm, expressive audiobook storyteller">Warm audiobook storyteller</option>
        <option value="clear, crisp news anchor">Clear, crisp news anchor</option>
        <option value="measured, calm documentary narrator">Measured documentary narrator</option>
        <option value="__custom__">Custom instruction (type in box below)</option>
      </select>

      <label for="style">Custom speaking style / tone (optional — guides delivery, never spoken aloud)</label>
      <input id="style" placeholder="For example: slowly, clearly, and calmly" aria-describedby="styleHint">
      <p id="styleHint" class="hint">Pick a quick preset above or type custom delivery notes here. Leave blank for standard natural delivery.</p>

      <details class="panel" id="advancedSettingsPanel">
        <summary id="advancedSummary">Audio format &amp; advanced settings (MP3 64 kbps)</summary>
        <div class="row">
          <div>
            <label for="format">Audio output format</label>
            <select id="format">
              <option value="mp3">MP3 (compressed, small file size)</option>
              <option value="wav">WAV (uncompressed audio)</option>
            </select>
          </div>
          <div id="mp3QualityWrap">
            <label for="mp3Kbps">MP3 quality</label>
            <select id="mp3Kbps">
              <option value="64">64 kbps (speech optimized, ~28 MB/hr)</option>
              <option value="128">128 kbps (higher clarity, ~56 MB/hr)</option>
            </select>
          </div>
        </div>

        <div class="row">
          <div><label for="chunk">Characters per part</label><input id="chunk" type="number" min="300" max="3000" value="1800"></div>
          <div><label for="pause">Pause between requests (seconds)</label><input id="pause" type="number" min="0" max="60" value="1"></div>
          <div><label for="sil">Silence between parts (milliseconds)</label><input id="sil" type="number" min="0" max="3000" value="250"></div>
        </div>
      </details>

      <details class="panel" id="byokPanel">
        <summary id="byokSummary">Own Gemini API Key (optional Unlimited Mode)</summary>
        <label class="inline-check">
          <input id="byokEnabled" type="checkbox">
          <span>Use My Own Free Gemini API Key (Unlimited Mode)</span>
        </label>
        <div id="byokWrap" hidden>
          <label for="byokKey">Your Gemini API key (stored only in your browser)</label>
          <input id="byokKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza..." aria-describedby="byokHint">
          <div class="btn-group">
            <button id="byokToggleVis" type="button" class="sec" aria-pressed="false">Show key</button>
            <button id="byokClear" type="button" class="sec">Clear saved key</button>
          </div>
        </div>
        <p id="byokHint" class="hint">Saved strictly in your browser’s localStorage and never sent to Firebase or our server. When enabled with a valid key, speech requests go directly from your browser to Google's Gemini API and bypass the 3,000-character daily limit. Leave unchecked to use the built-in free allowance.</p>
        <p id="byokStatus" class="hint" role="status" aria-live="polite"></p>
      </details>

      <details class="panel">
        <summary id="dictSummary">Pronunciation dictionary (0 active rules)</summary>
        <p class="hint">Fix how specific abbreviations, names, or non-English terms are spoken before audio is generated. Your original text stays untouched.</p>
        <div class="row">
          <div><label for="dictFind">Written text</label><input id="dictFind" placeholder="For example: Jieshuo or Dr."></div>
          <div><label for="dictReplace">Spoken as</label><input id="dictReplace" placeholder="For example: Jay-shwoh or Doctor"></div>
        </div>
        <label class="inline-check">
          <input id="dictWhole" type="checkbox" checked>
          <span>Match whole word only</span>
        </label>
        <div class="btn-group">
          <button id="addDict" type="button" class="sec">Add rule</button>
          <button id="presetDict" type="button" class="sec">Add academic presets</button>
        </div>
        <p id="dictMsg" class="hint" role="status"></p>
        <ul class="dict-list" id="dictList"></ul>
      </details>
    </div>

    <div class="card">
      <h2>2. Your text or document</h2>
      <label class="inline-check">
        <input id="cleanDocs" type="checkbox" checked>
        <span>Smart document cleanup (remove standalone page numbers and repeated headers/footers from PDF &amp; EPUB files)</span>
      </label>

      <label for="text">Text to convert (or drop a PDF, DOCX, EPUB, TXT file below)</label>
      <textarea id="text" dir="auto" placeholder="Type, paste, or drop a PDF, DOCX, EPUB, Markdown, or TXT file here (supports RTL Urdu &amp; LTR English)"></textarea>

      <div class="btn-group">
        <button id="load" type="button" class="sec">Load PDF, DOCX, EPUB or TXT</button>
        <button id="paste" type="button" class="sec">Paste from clipboard</button>
        <button id="voiceDemo" type="button" class="sec">Test selected voice</button>
        <button id="sampleSingle" type="button" class="sec">Insert sample script</button>
        <button id="sampleDialogue" type="button" class="sec" hidden>Insert sample dialogue</button>
        <button id="detectChaptersBtn" type="button" class="sec">Split into chapters</button>
        <button id="clear" type="button" class="sec">Clear text</button>
      </div>
      <input id="file" type="file" accept=".pdf,.docx,.epub,.txt,.md,text/plain,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden aria-label="Choose a PDF, Word DOCX, EPUB, or text file">
      <p id="count" class="hint" aria-live="off">Characters: 0</p>

      <div id="chaptersBox" class="chapters-box" hidden>
        <p id="chaptersSummary" class="hint status-ok" role="status" aria-live="polite"></p>
        <label for="chapterSelect">Detected chapters / book sections</label>
        <select id="chapterSelect"></select>
        <div class="btn-group">
          <button id="loadChapterBtn" type="button" class="sec">Load selected chapter</button>
          <button id="loadAllChaptersBtn" type="button" class="sec">Load full book text</button>
          <button id="exportChaptersZipBtn" type="button">Export all chapters as Audiobook ZIP</button>
        </div>
      </div>

      <div class="btn-group">
        <button id="openPdfStudioShortcut" type="button" class="sec">Open PDF &amp; Book Studio</button>
        <button id="openPodcastStudioShortcut" type="button" class="sec">Open Podcast &amp; Translator</button>
      </div>

      <label for="audioTitle">Audio title for download (optional — auto-named from document or text)</label>
      <input id="audioTitle" type="text" dir="auto" maxlength="80" placeholder="Leave blank to auto-name from your document or first words (no dates)">

      <div class="btn-group">
        <button id="gen" type="button">Generate audio</button>
        <button id="prev" type="button" class="sec">Preview first 200 characters</button>
        <button id="cancel" type="button" class="dng" hidden>Cancel</button>
        <button id="resume" type="button" class="sec" hidden>Resume</button>
      </div>
      <p id="status" role="status" aria-live="polite"></p>
      <p id="statusErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
      <progress id="prog" value="0" max="100" aria-label="Audio generation progress" aria-valuetext="0 percent" hidden></progress>
    </div>

    <section class="card" id="result" aria-labelledby="resultHeading" hidden>
      <h2 id="resultHeading">Generated Audio Preview</h2>
      <audio id="player" controls aria-label="Generated speech audio player"></audio>
      <div class="player-bar">
        <div>
          <label for="speed">Playback speed</label>
          <select id="speed">
            <option value="1">1.0x (Normal)</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2.0x</option>
          </select>
        </div>
      </div>
      <p id="info" class="hint" role="status" aria-live="polite"></p>
      <div class="btn-group">
        <button id="openExportModalBtn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="exportModal">Export Audio, Subtitles &amp; Video…</button>
      </div>
    </section>

    <p class="hint">Audio is generated by AI. Please follow the rules of the platform where you publish it, including any disclosure of synthetic voices. Audio from Gemini carries an inaudible SynthID watermark.</p>
  </div>
`;

export const ACCOUNT_CARD_HTML = `
  <div class="card" id="accountCard" tabindex="-1">
    <div class="account-head">
      <div>
        <h2 id="userDisplay">Account</h2>
        <p class="account-meta" id="userAccountMeta"></p>
      </div>
      <div class="btn-group">
        <button id="refreshQuota" type="button" class="sec">Refresh balance</button>
        <button id="signOutBtn" type="button" class="dng">Sign out</button>
      </div>
    </div>

    <div class="quota-metrics">
      <div class="quota-metric">
        <span class="quota-label">Free remaining today</span>
        <strong id="statDailyRemaining">3,000 chars</strong>
      </div>
      <div class="quota-metric">
        <span class="quota-label">Available credits</span>
        <strong id="statPaidCredits">0 chars</strong>
      </div>
      <div class="quota-metric">
        <span class="quota-label">Total lifetime generated</span>
        <strong id="statTotalUsed">0 chars</strong>
      </div>
      <div class="quota-metric">
        <span class="quota-label">Account plan</span>
        <strong id="statAccountPlan">Free</strong>
      </div>
    </div>

    <label for="dailyBar" id="dailyBarLabel">Daily free allowance used: 0 of 3,000 characters</label>
    <progress id="dailyBar" value="0" max="3000" aria-labelledby="dailyBarLabel"></progress>

    <p id="serverHealthStatus" class="hint" role="status" aria-live="polite">Checking speech server status…</p>
    <p id="accountMsg" class="hint" role="status" aria-live="polite"></p>

    <details class="panel" id="referralPanel" open>
      <summary>Invite Friends &amp; Earn Free Bonus Credits</summary>
      <p class="hint">Share your personal invite link. Each friend who creates and verifies an account earns you <strong>2,000 bonus characters</strong>.</p>
      <label for="refLinkInput">Your personal invite link</label>
      <input id="refLinkInput" type="text" readonly aria-describedby="refStatsMsg">
      <div class="btn-group">
        <button id="copyRefBtn" type="button" class="sec">Copy invite link</button>
        <button id="shareRefBtn" type="button" class="sec">Share invite</button>
      </div>
      <p id="refStatsMsg" class="hint">Invited friends: 0 · Bonus credits earned: 0 chars</p>
      <p id="refActionMsg" class="hint" role="status" aria-live="polite"></p>
    </details>

    <details class="panel" open>
      <summary>Recent usage &amp; credit history</summary>
      <ul class="ledger-list" id="ledgerList">
        <li>No usage recorded yet.</li>
      </ul>
    </details>
  </div>
`;

export const ADMIN_PANEL_HTML = `
  <h1 tabindex="-1">Admin Panel</h1>
  <p class="lead">Manage user accounts, credits, daily limits, activity history, and visitor messages.</p>
  <div class="card" id="adminOverviewCard">
    <div class="account-head">
      <div>
        <h2>Control Room Overview</h2>
        <p class="account-meta">Manage API keys, hosting environment variables, limits, user accounts, roles, and visitor inbox from one place.</p>
      </div>
      <div class="btn-group compact-actions">
        <button id="adminRefreshAll" type="button">Refresh All</button>
      </div>
    </div>

    <div class="admin-meta-strip">
      <span id="adminKeySourceBadge">Key source: Checking…</span>
      <span aria-hidden="true">·</span>
      <span id="adminVercelBadge">Vercel Auto-Push: Checking…</span>
      <span aria-hidden="true">·</span>
      <span id="adminMaintBadge">Mode: Checking…</span>
      <span aria-hidden="true">·</span>
      <span id="adminSyncBadge">Sync: Checking…</span>
    </div>

    <div class="quota-metrics">
      <div class="quota-metric">
        <span class="quota-label">User accounts</span>
        <strong id="adminStatWallets">—</strong>
      </div>
      <div class="quota-metric">
        <span class="quota-label">Total credits available</span>
        <strong id="adminStatCredits">—</strong>
      </div>
      <div class="quota-metric">
        <span class="quota-label">Characters used today</span>
        <strong id="adminStatDaily">—</strong>
      </div>
      <div class="quota-metric">
        <span class="quota-label">Unread messages</span>
        <strong id="adminStatUnread">—</strong>
      </div>
    </div>
    <p id="adminOverviewMsg" class="hint" role="status" aria-live="polite"></p>
  </div>

  <div class="card" id="adminServerConfigCard">
    <h2>Server API Key, Limits &amp; Direct Vercel Env Push</h2>
    <p class="hint">Paste a Gemini API key (free or paid) and press <strong>Save &amp; Push API Key to Server</strong>. It pushes straight to your backend &amp; Vercel environment variables and clears immediately from this input—leaving your personal browser key in Step 1 untouched.</p>
    <p class="hint" id="adminMaskedKeysInfo">Active Admin Key: Loading… · Host Env Key: Loading…</p>

    <label for="adminCfgApiKey">Shared Server Gemini API Key (leave blank to keep current server key)</label>
    <div class="input-inline-row">
      <input id="adminCfgApiKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza… paste new Gemini key to push straight to server">
      <button id="adminToggleKeyVis" type="button" class="sec">Show</button>
    </div>

    <div class="row">
      <div>
        <label for="adminCfgDailyLimit">Default Daily Free Characters per User</label>
        <input id="adminCfgDailyLimit" type="number" min="0" max="1000000" value="3000">
      </div>
      <div>
        <label for="adminCfgGlobalCap">Global Daily Free Character Cap</label>
        <input id="adminCfgGlobalCap" type="number" min="0" max="100000000" value="100000">
      </div>
    </div>

    <label for="adminCfgNotice">Public Site Announcement / Maintenance Notice</label>
    <input id="adminCfgNotice" type="text" maxlength="400" placeholder="Optional banner shown at the top of the app">

    <label class="inline-check">
      <input id="adminCfgMaintenance" type="checkbox">
      <span>Maintenance mode (pause shared speech &amp; studio API for standard users)</span>
    </label>
    <label class="inline-check">
      <input id="adminCfgPdfStudio" type="checkbox" checked>
      <span>Enable AI PDF &amp; Book Chapter Studio proxy for users</span>
    </label>
    <label class="inline-check">
      <input id="adminCfgPodcastStudio" type="checkbox" checked>
      <span>Enable Podcast &amp; Translator Studio proxy for users</span>
    </label>

    <div class="btn-group">
      <button id="adminSaveServerBtn" type="button">Save &amp; Push API Key to Server</button>
      <button id="adminTestKeyBtn" type="button" class="sec">Test Key Now</button>
      <button id="adminClearKeyBtn" type="button" class="dng">Clear Admin Key (Revert to Host Env)</button>
    </div>
    <p id="adminServerMsg" class="hint" tabindex="-1" role="status" aria-live="polite"></p>
    <p id="adminServerErr" class="hint err-msg" role="alert" aria-live="assertive"></p>

    <details class="panel" id="adminVercelDetails">
      <summary>Vercel Auto-Push Connection (One-Time Setup)</summary>
      <p class="hint">Connect your Vercel Project ID and Access Token once here. Whenever you press <strong>Save &amp; Push API Key to Server</strong>, Voice Studio automatically updates <code>GEMINI_API_KEY</code> and triggers a live production redeploy with no Vercel dashboard visits required.</p>
      <div class="row">
        <div>
          <label for="adminVercelProject">Vercel Project ID or Name</label>
          <input id="adminVercelProject" type="text" autocomplete="off" placeholder="prj_... or voice-studio">
        </div>
        <div>
          <label for="adminVercelTeam">Vercel Team ID (optional)</label>
          <input id="adminVercelTeam" type="text" autocomplete="off" placeholder="team_... (leave blank for personal account)">
        </div>
      </div>
      <label for="adminVercelToken">Vercel API Access Token</label>
      <input id="adminVercelToken" type="password" autocomplete="off" spellcheck="false" placeholder="Optional once saved on server">
      <label for="adminVercelHook">Vercel Deploy Hook URL (optional—auto-redeploy works even without this)</label>
      <input id="adminVercelHook" type="url" autocomplete="off" placeholder="https://api.vercel.com/v1/integrations/deploy/...">
      <label class="inline-check">
        <input id="adminVercelPersist" type="checkbox" checked>
        <span>Save Vercel Project ID &amp; Token securely into Vercel Environment Variables on push (so you never enter them again)</span>
      </label>
      <div class="btn-group">
        <button id="adminPushVercelBtn" type="button" class="sec">Push Key &amp; Connect Vercel Now</button>
      </div>
      <p id="adminVercelMsg" class="hint" role="status" aria-live="polite"></p>
      <p id="adminVercelErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
    </details>
  </div>

  <div class="card" id="adminCard">
    <h2>Users, Wallets, Roles &amp; Credits</h2>
    <p class="hint">Search for any user, view registered accounts and roles, reset today's daily usage, grant credits, or assign Co-Admin access.</p>
    <div class="row">
      <div>
        <label for="adminSearchInput">Find user by Email or Account ID</label>
        <input id="adminSearchInput" type="text" placeholder="user@example.com or Account ID">
      </div>
    </div>
    <div class="btn-group">
      <button id="adminFindBtn" type="button" class="sec">Search user</button>
      <button id="adminLoadUsers" type="button" class="sec">Show all users</button>
      <button id="adminLoadProfiles" type="button" class="sec">Show profiles &amp; roles</button>
    </div>
    <div class="admin-table-wrap" id="adminTableWrap" hidden>
      <table class="admin-table">
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Account ID</th>
            <th scope="col">Plan</th>
            <th scope="col">Used Today</th>
            <th scope="col">Total Used</th>
            <th scope="col">Credits</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody id="adminUsersBody"></tbody>
      </table>
    </div>
    <div class="admin-table-wrap" id="adminProfilesWrap" hidden>
      <table class="admin-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Account ID</th>
            <th scope="col">Role</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody id="adminProfilesBody"></tbody>
      </table>
    </div>

    <hr class="divider">

    <h3>Update Credits &amp; Daily Limit</h3>
    <div class="row">
      <div>
        <label for="adminUid">Selected User (Email or Account ID)</label>
        <input id="adminUid" type="text" placeholder="Choose a user above or enter Email / ID">
      </div>
      <div>
        <label for="adminAddCredits">Add or Remove Credits (characters)</label>
        <input id="adminAddCredits" type="number" value="10000" step="1000">
      </div>
    </div>
    <div class="btn-group">
      <button type="button" class="sec admin-preset-credit" data-credits="10000">+10,000</button>
      <button type="button" class="sec admin-preset-credit" data-credits="50000">+50,000</button>
      <button type="button" class="sec admin-preset-credit" data-credits="100000">+100,000</button>
      <button type="button" class="sec admin-preset-credit" data-credits="0">0 (Limit / Plan only)</button>
    </div>
    <div class="row">
      <div>
        <label for="adminDailyLimit">Daily Free Limit</label>
        <input id="adminDailyLimit" type="number" value="3000" min="0" max="1000000">
      </div>
      <div>
        <label for="adminPlan">Plan</label>
        <select id="adminPlan">
          <option value="free">Free</option>
          <option value="pro">Extended</option>
        </select>
      </div>
    </div>
    <label for="adminNote">Reason / Note</label>
    <input id="adminNote" type="text" maxlength="240" placeholder="Reason for adding credits or changing limit">
    <div class="btn-group">
      <button id="adminApply" type="button">Save Changes</button>
    </div>

    <details class="panel">
      <summary>Bulk Credit Grant (All Loaded User Accounts)</summary>
      <div class="row">
        <div>
          <label for="adminBulkCredits">Bonus Credits per Account</label>
          <input id="adminBulkCredits" type="number" value="5000" step="1000">
        </div>
        <div>
          <label for="adminBulkNote">Campaign Note</label>
          <input id="adminBulkNote" type="text" maxlength="240" value="Community appreciation bonus credits">
        </div>
      </div>
      <div class="btn-group">
        <button id="adminBulkGrantBtn" type="button" class="sec">Grant Bonus to All Active Accounts</button>
      </div>
    </details>

    <p id="adminMsg" class="hint" tabindex="-1" role="status" aria-live="polite"></p>
    <p id="adminErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
  </div>

  <div class="card" id="adminLedgerCard">
    <h2>Activity History</h2>
    <p class="hint">See recent credit changes, quota updates, and audio generations across all user accounts.</p>
    <div class="row">
      <div>
        <label for="adminLedgerFilter">Filter by User or Note</label>
        <input id="adminLedgerFilter" type="text" placeholder="Type email, user ID, or note">
      </div>
      <div>
        <label for="adminLedgerType">Activity Type</label>
        <select id="adminLedgerType">
          <option value="all">All activity</option>
          <option value="admin_grant">Admin updates</option>
          <option value="credit_purchase">Credits added</option>
          <option value="tts_usage">Audio generated</option>
        </select>
      </div>
    </div>
    <div class="btn-group">
      <button id="adminLoadLedger" type="button" class="sec">Load Recent History</button>
      <button id="adminExportCsvBtn" type="button" class="sec">Export Filtered CSV</button>
    </div>
    <p id="adminLedgerMsg" class="hint" role="status" aria-live="polite"></p>
    <p id="adminLedgerErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
    <div class="admin-table-wrap" id="adminLedgerWrap" hidden>
      <table class="admin-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">User</th>
            <th scope="col">Activity</th>
            <th scope="col">Credits</th>
            <th scope="col">Characters</th>
            <th scope="col">Voice Model</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody id="adminLedgerBody"></tbody>
      </table>
    </div>
  </div>

  <div class="card" id="adminReferralsCard">
    <h2>Referral Invites</h2>
    <p class="hint">Monitor friend invites and grant pending 2,000-character invite bonuses if automatic crediting is inactive.</p>
    <div class="btn-group">
      <button id="adminLoadReferrals" type="button" class="sec">Load Referrals</button>
    </div>
    <p id="adminRefMsg" class="hint" role="status" aria-live="polite"></p>
    <p id="adminRefErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
    <div class="admin-table-wrap" id="adminRefWrap" hidden>
      <table class="admin-table">
        <thead>
          <tr>
            <th scope="col">Invited User ID</th>
            <th scope="col">Referrer User ID</th>
            <th scope="col">Status</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody id="adminRefBody"></tbody>
      </table>
    </div>
  </div>

  <div class="card" id="adminInboxCard">
    <h2>Contact Messages</h2>
    <p class="hint">Read and manage messages sent by visitors from the Contact page.</p>
    <div class="btn-group">
      <button id="adminLoadInbox" type="button" class="sec">Load Messages</button>
      <button id="adminUnreadOnly" type="button" class="sec" aria-pressed="false">Show unread only</button>
    </div>
    <p id="adminInboxMsg" class="hint" tabindex="-1" role="status" aria-live="polite"></p>
    <p id="adminInboxErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
    <ul class="inbox-list" id="adminInboxList"></ul>
  </div>

  <div class="card" id="adminHealthCard">
    <h2>Server &amp; Integration Diagnostics</h2>
    <p class="hint" id="adminSessionIdentity"></p>
    <p class="hint" id="adminDiagDetails">Service account: Checking… · Edge KV: Checking… · Vercel Env: Checking…</p>
    <p class="hint" id="adminSystemStatus" role="status" aria-live="polite">Press Check Server Status to verify that speech generation is ready.</p>
    <div class="btn-group">
      <button id="adminCheckHealth" type="button" class="sec">Check Server Status</button>
    </div>
  </div>
  <div class="btn-group">
    <button id="adminBackToStudioBtn" type="button" class="sec">Back to Speech Studio</button>
  </div>
`;
