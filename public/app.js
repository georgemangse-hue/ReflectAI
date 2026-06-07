/* ================================================================
   ReflectAI – app.js  (v5)

   Sections
   --------
    1. Mood config
    2. App state
    3. API helper
    4. Auth — login, signup, logout, init
    5. Payment — payment wall + Paystack
    6. Date helpers
    7. Init (page boot after auth)
    8. Entries — load, save, clear
    9. Entry edit
   10. Mood selector
   11. Mood trend chart
   12. Streak
   13. Journal form
   14. Reflection prompts
   15. Onboarding
   16. Weekly insight
   17. Goals (Pro)
   18. History
   19. Theme toggle
   20. Scroll-reveal
   21. Textarea auto-resize
   22. Toast
   23. Security — escapeHTML
   24. Boot
================================================================ */


/* ================================================================
   1. MOOD CONFIG
================================================================ */
const MOODS = [
  { id: 'motivated',   label: 'Motivated',   emoji: '🚀', color: '#2d8653', score: 5 },
  { id: 'happy',       label: 'Happy',       emoji: '😊', color: '#48a876', score: 4 },
  { id: 'grateful',    label: 'Grateful',    emoji: '🙏', color: '#76b89a', score: 3 },
  { id: 'tired',       label: 'Tired',       emoji: '😴', color: '#9090c0', score: 2 },
  { id: 'anxious',     label: 'Anxious',     emoji: '😰', color: '#c06868', score: 1 },
  { id: 'sad',         label: 'Sad',         emoji: '😢', color: '#7878b8', score: 1 },
  { id: 'overwhelmed', label: 'Overwhelmed', emoji: '😵', color: '#c87070', score: 1 },
];

function moodById(id) { return MOODS.find(m => m.id === id) || null; }


/* ================================================================
   2. APP STATE
================================================================ */
const state = {
  user:                null,
  entries:             [],
  goals:               [],
  streak:              0,
  selectedMood:        null,
  paystackKey:         '',
  planCode:            '',
  stripePublishableKey: '',
  flutterwaveKey:      '',
  countryCode:         null,  // set by detectCountry() on load
  countryOverride:     null,  // set when user clicks "Switch currency"
  userPlan:            'free', // 'free' or 'pro'
  accessLevel:         'free', // 'pro' | 'trial' | 'free'
  moodRestricted:      false,  // true when free-tier mood history is limited to 7 days
  moodHasOlderData:    false,
  coachEntry:          '',    // journal text for the current coach session
  coachSessions:       {},    // keyed by prompt index: { history: [{role,content}] }
  onboarding:          { active: false, step: 0 },
  // per-session upgrade prompts: track which features have already shown a prompt this session
  upgradeShown:        new Set()
};


/* ================================================================
   2b. DRAFT
================================================================ */
const DRAFT_KEY = 'reflectai_draft';
let draftSaveTimer = null;

function countWords(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function updateWordCount(ta) {
  const el = document.getElementById('char-count');
  if (!el) return;
  const n = countWords(ta.value);
  el.textContent = n === 1 ? '1 word' : `${n} words`;
  el.classList.toggle('warn', n > 450);
}

function saveDraft() {
  const ta = document.getElementById('journal-input');
  if (!ta) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    text: ta.value,
    mood: state.selectedMood,
    date: getTodayISO()
  }));
  const el = document.getElementById('draft-indicator');
  if (el) {
    el.textContent = 'Draft saved';
    clearTimeout(el._clearTimer);
    el._clearTimer = setTimeout(() => { el.textContent = ''; }, 2000);
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (draft.date !== getTodayISO() || !draft.text) return false;
    const ta = document.getElementById('journal-input');
    ta.value = draft.text;
    updateWordCount(ta);
    autoResizeTextarea(ta);
    if (draft.mood) selectMood(draft.mood, true);
    const el = document.getElementById('draft-indicator');
    if (el) {
      el.textContent = 'Draft restored';
      clearTimeout(el._clearTimer);
      el._clearTimer = setTimeout(() => { el.textContent = ''; }, 3000);
    }
    return true;
  } catch { return false; }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  const el = document.getElementById('draft-indicator');
  if (el) el.textContent = '';
}


/* ================================================================
   3. API HELPER
================================================================ */
async function api(method, path, body) {
  const token = localStorage.getItem('reflectai_token');
  const opts  = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body)  opts.body = JSON.stringify(body);

  const res  = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) { clearAuthState(); showAuthOverlay(); return null; }
  if (res.status === 403 && (data.code === 'PAYMENT_REQUIRED' || data.code === 'SUBSCRIPTION_EXPIRED')) {
    showPaymentWall();
    return null;
  }
  if (res.status === 403 && data.code === 'GOAL_LIMIT_REACHED') {
    if (!state.upgradeShown.has('goals')) {
      state.upgradeShown.add('goals');
      showUpgradePrompt(data.error || "You've reached the free plan goal limit.", 'goals');
    }
    return null;
  }
  if (res.status === 403 && data.code === 'INSIGHT_MONTHLY_LIMIT') {
    return { _insightMonthlyLimit: true, error: data.error, nextAvailableDate: data.nextAvailableDate };
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}


/* ================================================================
   4. AUTH
================================================================ */
function showAuthOverlay() { document.getElementById('auth-overlay').classList.remove('hidden'); }
function hideAuthOverlay() { document.getElementById('auth-overlay').classList.add('hidden');    }

function showAuthTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden',    tab !== 'login');
  document.getElementById('signup-form').classList.toggle('hidden',   tab !== 'signup');
  document.getElementById('forgot-form')?.classList.add('hidden');
  document.getElementById('forgot-success')?.classList.add('hidden');
  document.getElementById('tab-login').classList.toggle('active',     tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active',    tab === 'signup');
  document.getElementById('auth-error').classList.add('hidden');
}

function showForgotPassword() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('auth-error').classList.add('hidden');
  document.getElementById('forgot-success').classList.add('hidden');
  // Pre-fill email from login field if already typed
  const loginEmail = document.getElementById('login-email').value.trim();
  if (loginEmail) document.getElementById('forgot-email').value = loginEmail;
  document.getElementById('forgot-form').classList.remove('hidden');
  document.getElementById('forgot-email').focus();
}

function backToLogin() {
  document.getElementById('forgot-form').classList.add('hidden');
  document.getElementById('forgot-success').classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const btn   = document.getElementById('forgot-btn');
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) return;
  btn.disabled = true; btn.textContent = 'Sending…';
  document.getElementById('auth-error').classList.add('hidden');
  try {
    await fetch('/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    // Always show success — never reveal whether email exists
    document.getElementById('forgot-form').classList.add('hidden');
    document.getElementById('forgot-success').classList.remove('hidden');
  } catch {
    const el = document.getElementById('auth-error');
    el.textContent = 'Could not send reset email. Please try again.';
    el.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Send reset link';
  }
}

function setAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function handleLogin(event) {
  event.preventDefault();
  const btn      = document.getElementById('login-btn');
  const email    = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  btn.disabled = true; btn.textContent = 'Logging in…';
  document.getElementById('auth-error').classList.add('hidden');
  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.error) { setAuthError(data.error); return; }
    onAuthSuccess(data.token, data.user);
  } catch { setAuthError('Could not connect to the server. Is it running?'); }
  finally { btn.disabled = false; btn.textContent = 'Log in'; }
}

async function handleSignup(event) {
  event.preventDefault();
  const btn      = document.getElementById('signup-btn');
  const email    = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const confirm  = document.getElementById('signup-confirm').value;
  document.getElementById('auth-error').classList.add('hidden');
  if (password !== confirm) { setAuthError('Passwords do not match.'); return; }
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const refCode = localStorage.getItem('reflectai_ref') || '';
    const res  = await fetch('/api/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, referralCode: refCode })
    });
    const data = await res.json();
    if (data.error) { setAuthError(data.error); return; }
    localStorage.removeItem('reflectai_ref');
    onAuthSuccess(data.token, data.user);
  } catch { setAuthError('Could not connect to the server. Is it running?'); }
  finally { btn.disabled = false; btn.textContent = 'Create account'; }
}

function onAuthSuccess(token, user) {
  localStorage.setItem('reflectai_token', token);
  state.user = user;
  hideAuthOverlay();
  applyUserUI(user);
  loadAppData();
}

function clearAuthState() {
  localStorage.removeItem('reflectai_token');
  state.user = null; state.entries = []; state.goals = [];
  state.streak = 0; state.selectedMood = null;
}

async function handleLogout() {
  await api('POST', '/api/auth/logout').catch(() => {});
  clearAuthState();
  hidePaymentWall();
  _moodLogs = []; _insightsLoaded = false;
  if (_insightsMoodChart) { _insightsMoodChart.destroy(); _insightsMoodChart = null; }
  const ta = document.getElementById('journal-input');
  if (ta) ta.value = '';
  document.getElementById('char-count').textContent = '0 words';
  document.getElementById('prompts-section')?.classList.add('hidden');
  clearMoodSelection();
  renderHistory();
  renderStreak(0);
  localStorage.removeItem(TAB_KEY);
  switchTab('home');
  showAuthOverlay();
  showToast('You have been logged out.');
}

function applyUserUI(user) {
  const accessLevel = user.access_level || (user.plan === 'pro' ? 'pro' : 'free');
  const isPro       = accessLevel === 'pro';
  const isTrial     = accessLevel === 'trial';
  state.userPlan    = user.plan || 'free';
  state.accessLevel = accessLevel;

  document.getElementById('nav-user').classList.remove('hidden');
  const navBadge = document.getElementById('nav-plan-badge');
  if (isPro)    { navBadge.textContent = 'PRO';   navBadge.classList.add('pro');    }
  else if (isTrial) { navBadge.textContent = 'TRIAL'; navBadge.classList.add('trial'); }
  else          { navBadge.textContent = 'FREE';  navBadge.classList.remove('pro'); }

  document.getElementById('dropdown-email').textContent = user.email;
  const dropBadge = document.getElementById('dropdown-plan-badge');
  if (isPro)    { dropBadge.textContent = 'PRO';   dropBadge.classList.add('pro');    }
  else if (isTrial) { dropBadge.textContent = 'TRIAL'; dropBadge.classList.add('trial'); }
  else          { dropBadge.textContent = 'FREE';  dropBadge.classList.remove('pro'); }

  document.getElementById('dropdown-plan-label').textContent =
    isPro ? 'Pro plan' : isTrial ? 'Pro Trial (30 days)' : 'Free plan';
  document.getElementById('dropdown-upgrade-btn').classList.toggle('hidden', isPro || isTrial);
  applySubscriptionUI(user);
  updateProfileUI(user);
  applyProGates(isPro || isTrial);

  // Trial banner
  renderTrialBanner(user);

  // Show one-time trial expiry modal
  if (accessLevel === 'free' && !user.paid) {
    maybeShowTrialExpiredModal(user);
  }
}

const TRIAL_EXPIRED_KEY = 'reflectai_trial_expired_shown';

function renderTrialBanner(user) {
  const banner = document.getElementById('trial-banner');
  if (!banner) return;

  if (user.access_level !== 'trial') {
    banner.classList.add('hidden');
    document.documentElement.style.setProperty('--trial-banner-h', '0px');
    return;
  }

  const trialEnd = user.trial_end_date;
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000)) : 0;
  const textEl   = document.getElementById('trial-banner-text');

  banner.classList.remove('hidden', 'trial-amber', 'trial-red');
  if (textEl) textEl.textContent = `🌿 Pro Trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`;

  if (daysLeft <= 3) {
    banner.classList.add('trial-red');
  } else if (daysLeft <= 7) {
    banner.classList.add('trial-amber');
  }

  // Measure the rendered height and set the CSS variable so header/content shift down
  requestAnimationFrame(() => {
    const h = banner.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--trial-banner-h', Math.round(h) + 'px');
  });
}

function maybeShowTrialExpiredModal(user) {
  // Only show once per browser (user has seen the trial and it just ended)
  if (localStorage.getItem(TRIAL_EXPIRED_KEY)) return;
  // Only show if the trial actually existed (trial_start_date set) and just expired
  if (!user.trial_start_date && !user.trial_end_date) return;
  // Mark as shown so it doesn't repeat
  localStorage.setItem(TRIAL_EXPIRED_KEY, '1');
  const modal = document.getElementById('trial-expired-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeTrialExpiredModal() {
  const modal = document.getElementById('trial-expired-modal');
  if (modal) modal.classList.add('hidden');
}

function applyProGates(isProOrTrial) {
  document.getElementById('weekly-lock')?.classList.add('hidden');
  document.getElementById('weekly-content')?.classList.remove('hidden');
  document.getElementById('goals-lock')?.classList.add('hidden');
  document.getElementById('goals-content')?.classList.remove('hidden');

  // Show trial notes only for free users (post-trial)
  const weeklyNote = document.getElementById('weekly-trial-note');
  if (weeklyNote) weeklyNote.classList.toggle('hidden', isProOrTrial);
  updateGoalsTrialNote();

  // Export button: unlocked for pro and trial, locked for free
  const exportBtn = document.getElementById('dropdown-export-btn');
  if (exportBtn) {
    if (isProOrTrial) {
      exportBtn.classList.remove('dropdown-btn-locked');
      exportBtn.removeAttribute('title');
    } else {
      exportBtn.classList.add('dropdown-btn-locked');
      exportBtn.title = 'Pro feature — upgrade to export your journal';
    }
  }
}

async function exportJournal() {
  if (!state.user || state.accessLevel === 'free') {
    showToast('Upgrade to Pro to export your journal');
    showPaymentWall();
    return;
  }

  const btn = document.getElementById('dropdown-export-btn');
  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }

  try {
    const token = localStorage.getItem('reflectai_token');
    const res = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Export failed. Please try again.');
      return;
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const dateStr  = new Date().toISOString().slice(0, 10);
    const username = (state.user?.email || 'journal').split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
    a.href     = url;
    a.download = `ReflectAI-Journal-${username}-${dateStr}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Journal exported successfully!');
  } catch {
    showToast('Export failed. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

async function initAuth() {
  const token = localStorage.getItem('reflectai_token');
  if (!token) { showAuthOverlay(); restoreTab(); return; }
  try {
    const data = await api('GET', '/api/auth/me');
    if (!data) return;
    state.user = data.user; state.streak = data.streak;
    hideAuthOverlay();
    applyUserUI(data.user);
    await loadAppData();
  } catch { showAuthOverlay(); restoreTab(); }
}

function showUpgradeModal()  { showPaymentWall(); }
function closeUpgradeModal() { hidePaymentWall(); }
function closePaymentWall()  { hidePaymentWall(); }
function handleUpgrade()     { closeUpgradeModal(); showPaymentWall(); }


/* ================================================================
   5. PAYMENT — PAYSTACK + FLUTTERWAVE
================================================================ */
const GEO_CACHE_KEY = 'reflectai_geo';
const GEO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function detectCountry() {
  // Return cached result if fresh
  try {
    const cached = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || 'null');
    if (cached && (Date.now() - cached.ts) < GEO_CACHE_TTL) return cached.code;
  } catch {}

  let code = null;

  // Primary: ipapi.co
  try {
    const geo = await fetch('https://ipapi.co/json/').then(r => r.json());
    if (!geo.error && geo.country_code) code = geo.country_code;
  } catch {}

  // Fallback: ipwho.is
  if (!code) {
    try {
      const geo = await fetch('https://ipwho.is/').then(r => r.json());
      if (geo.success !== false && geo.country_code) code = geo.country_code;
    } catch {}
  }

  // Fallback: browser timezone / UTC offset
  if (!code) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === 'Africa/Lagos' || (-new Date().getTimezoneOffset()) === 60) code = 'NG';
  }

  try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ code, ts: Date.now() })); } catch {}
  return code;
}

function getEffectiveRegion() {
  if (state.countryOverride) return state.countryOverride;         // manual override
  if (state.countryCode === 'NG') return 'NG';
  if (state.countryCode !== null)  return 'INTL';
  return null; // both APIs failed — let user choose
}

function applyPaymentWallRegion() {
  const paystackOpt    = document.getElementById('payment-opt-paystack');
  const flutterwaveOpt = document.getElementById('payment-opt-flutterwave');
  const divider        = document.querySelector('#payment-options-container .payment-divider');
  const priceEl        = document.getElementById('payment-price-display');
  const switchRow      = document.getElementById('payment-switch-currency');
  if (!paystackOpt || !flutterwaveOpt) return;

  const note = '<span class="payment-price-note">/month · cancel anytime</span>';
  const region = getEffectiveRegion();

  if (region === 'NG') {
    if (priceEl)   priceEl.innerHTML   = '🇳🇬 ₦3,000' + note;
    if (switchRow) switchRow.innerHTML = 'Not in Nigeria? <a href="#" class="payment-switch-link" onclick="switchPaymentCurrency(\'INTL\');return false;">Switch to USD ($7.99/month)</a>';
    paystackOpt.classList.remove('hidden');
    flutterwaveOpt.classList.add('hidden');
    if (divider) divider.classList.add('hidden');
  } else if (region === 'INTL') {
    if (priceEl)   priceEl.innerHTML   = '🌍 $7.99' + note;
    if (switchRow) switchRow.innerHTML = 'In Nigeria? <a href="#" class="payment-switch-link" onclick="switchPaymentCurrency(\'NG\');return false;">Switch to NGN (₦3,000/month)</a>';
    flutterwaveOpt.classList.remove('hidden');
    paystackOpt.classList.add('hidden');
    if (divider) divider.classList.add('hidden');
  } else {
    // API failed — show both and let user pick
    if (priceEl)   priceEl.innerHTML   = 'Choose your currency' + note;
    if (switchRow) switchRow.innerHTML = '';
    paystackOpt.classList.remove('hidden');
    flutterwaveOpt.classList.remove('hidden');
    if (divider) divider.classList.remove('hidden');
  }
}

function switchPaymentCurrency(region) {
  state.countryOverride = region;
  applyPaymentWallRegion();
}

function showPaymentWall() {
  applyPaymentWallRegion();
  document.getElementById('payment-wall')?.classList.remove('hidden');
}
function hidePaymentWall() { document.getElementById('payment-wall')?.classList.add('hidden'); }

// Warm, non-aggressive upgrade prompt toast — shown at most once per session per feature
function showUpgradePrompt(message, featureKey) {
  if (featureKey && state.upgradeShown.has(featureKey)) return;
  if (featureKey) state.upgradeShown.add(featureKey);
  const existing = document.getElementById('upgrade-prompt-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'upgrade-prompt-toast';
  el.className = 'upgrade-prompt-toast';
  el.innerHTML = `
    <p class="upgrade-prompt-msg">${escapeHTML(message)}</p>
    <div class="upgrade-prompt-actions">
      <button class="btn btn-primary btn-sm upgrade-prompt-btn" onclick="document.getElementById('upgrade-prompt-toast')?.remove();showPaymentWall()">Upgrade to Pro — ₦3,000/month</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('upgrade-prompt-toast')?.remove()">Not now</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 8000);
}

async function loadConfig() {
  try {
    const [config, countryCode] = await Promise.all([
      fetch('/api/config').then(r => r.json()),
      detectCountry()
    ]);
    state.paystackKey          = config.paystackPublicKey    || '';
    state.planCode             = config.paystackPlanCode     || '';
    state.stripePublishableKey = config.stripePublishableKey || '';
    state.flutterwaveKey       = config.flutterwavePublicKey || '';
    state.countryCode          = countryCode;
  } catch {}
}

function handleHeroCta() {
  if (state.user) {
    document.getElementById('journal-section')?.scrollIntoView({ behavior: 'smooth' });
  } else {
    showAuthOverlay();
  }
}

function openPaystack() {
  if (!state.user) { showAuthOverlay(); return; }

  if (!state.paystackKey) {
    // Dev / test mode — simulate a subscription payment with a fake reference
    const btn = document.getElementById('paystack-pay-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
    showToast('Test mode: simulating subscription payment…');
    setTimeout(() => verifyPayment('TEST_REF_' + Date.now()), 1200);
    return;
  }

  if (!window.PaystackPop) {
    showToast('Paystack failed to load. Please check your internet connection.');
    return;
  }

  const setup = {
    key:      state.paystackKey,
    email:    state.user.email,
    currency: 'NGN',
    ref:      'REFLECTAI_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    metadata: { userId: state.user.id },
    callback(response) { verifyPayment(response.reference); },
    onClose()  { showToast('Payment cancelled. Your journal is waiting when you\'re ready!'); }
  };

  if (state.planCode) {
    // Paystack subscription — amount is defined by the plan (₦3,000/month)
    setup.plan = state.planCode;
  } else {
    // Fallback: one-off charge if no plan code is configured
    setup.amount = 300000;
  }

  window.PaystackPop.setup(setup).openIframe();
}

async function verifyPayment(reference) {
  showToast('Verifying payment…');
  try {
    const data = await api('POST', '/api/payment/verify', { reference });
    if (!data) return;
    state.user = { ...state.user, ...data.user };
    hidePaymentWall();
    applyUserUI(state.user);
    await loadAppData();
    const expiry = state.user.subscriptionExpiry
      ? new Date(state.user.subscriptionExpiry).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
    showToast('🎉 Subscription active!' + (expiry ? ` Next renewal: ${expiry}.` : ''));
  } catch (err) {
    const btn = document.getElementById('paystack-pay-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe — ₦3,000/month'; }
    showToast('Verification failed: ' + err.message);
  }
}

function openFlutterwave() {
  if (!state.user) { showAuthOverlay(); return; }

  const btn = document.getElementById('flutterwave-pay-btn');

  if (!state.flutterwaveKey) {
    // Dev / test mode — simulate a subscription payment
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
    showToast('Test mode: simulating Flutterwave payment…');
    setTimeout(() => verifyFlutterwavePayment('TEST_FLW_' + Date.now()), 1200);
    return;
  }

  if (!window.FlutterwaveCheckout) {
    showToast('Flutterwave failed to load. Please check your internet connection.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Opening checkout…'; }

  window.FlutterwaveCheckout({
    public_key:      state.flutterwaveKey,
    tx_ref:          'REFLECTAI_FLW_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    amount:          7.99,
    currency:        'USD',
    payment_options: 'card',
    customer: {
      email: state.user.email,
      name:  state.user.email
    },
    customizations: {
      title:       'ReflectAI Pro',
      description: 'Monthly subscription — $7.99/month',
      logo:        ''
    },
    callback(data) {
      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Flutterwave — $7.99/month'; }
      if (data.status === 'successful' || data.status === 'completed') {
        verifyFlutterwavePayment(data.transaction_id);
      } else {
        showToast('Payment was not completed. Please try again.');
      }
    },
    onclose() {
      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Flutterwave — $7.99/month'; }
      showToast('Payment cancelled. Your journal is waiting when you\'re ready!');
    }
  });
}

async function verifyFlutterwavePayment(transaction_id) {
  showToast('Verifying payment…');
  try {
    const data = await api('POST', '/api/payment/verify-flutterwave', { transaction_id });
    if (!data) return;
    state.user = { ...state.user, ...data.user };
    hidePaymentWall();
    applyUserUI(state.user);
    await loadAppData();
    const expiry = state.user.subscriptionExpiry
      ? new Date(state.user.subscriptionExpiry).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
    showToast('🎉 Subscription active!' + (expiry ? ` Next renewal: ${expiry}.` : ''));
  } catch (err) {
    const btn = document.getElementById('flutterwave-pay-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Flutterwave — $7.99/month'; }
    showToast('Verification failed: ' + err.message);
  }
}

async function cancelSubscription() {
  const expiry = state.user?.subscriptionExpiry
    ? new Date(state.user.subscriptionExpiry).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'the end of your billing period';
  if (!confirm(`Cancel your subscription?\n\nYou'll keep access until ${expiry}. No further charges after that.`)) return;

  const btn = document.getElementById('dropdown-cancel-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }

  try {
    await api('POST', '/api/subscription/cancel');
    state.user.subscriptionStatus = 'non-renewing';
    applySubscriptionUI(state.user);
    showToast('Subscription cancelled. You have access until ' + expiry + '.');
  } catch (err) {
    showToast('Could not cancel: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Cancel Subscription'; }
  }
}

async function openStripe() {
  if (!state.user) { showAuthOverlay(); return; }

  const btn = document.getElementById('stripe-pay-btn');

  if (!state.stripePublishableKey) {
    // Dev / test mode — backend simulates the subscription
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
    showToast('Test mode: simulating Stripe subscription…');
    try {
      const data = await api('POST', '/api/stripe/create-checkout');
      if (!data) return;
      if (data.testMode) {
        state.user = { ...state.user, ...data.user };
        hidePaymentWall();
        applyUserUI(state.user);
        await loadAppData();
        showToast('🎉 Subscription active! (Stripe test mode)');
      }
    } catch (err) {
      showToast('Could not start checkout: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Stripe — $5/month'; }
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Opening checkout…'; }
  try {
    const data = await api('POST', '/api/stripe/create-checkout');
    if (!data) { if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Stripe — $5/month'; } return; }
    window.location.href = data.url;
  } catch (err) {
    showToast('Could not start Stripe checkout: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Stripe — $5/month'; }
  }
}

async function handleStripeReturn() {
  const params  = new URLSearchParams(window.location.search);
  const payment = params.get('payment');

  if (payment === 'cancelled') {
    window.history.replaceState({}, '', window.location.pathname);
    showToast("Payment cancelled. Your journal is waiting when you're ready!");
    return;
  }

  if (payment === 'success') {
    const sessionId = params.get('session_id');
    window.history.replaceState({}, '', window.location.pathname);
    if (!sessionId) return;
    showToast('Verifying payment…');
    try {
      const data = await api('GET', `/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`);
      if (!data) return;
      state.user = { ...state.user, ...data.user };
      hidePaymentWall();
      applyUserUI(state.user);
      await loadAppData();
      const expiry = state.user.subscriptionExpiry
        ? new Date(state.user.subscriptionExpiry).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : null;
      showToast('🎉 Subscription active!' + (expiry ? ` Next renewal: ${expiry}.` : ''));
    } catch (err) {
      showToast('Could not verify payment: ' + err.message);
    }
  }
}

function applySubscriptionUI(user) {
  const cancelBtn  = document.getElementById('dropdown-cancel-btn');
  const resubBtn   = document.getElementById('dropdown-resub-btn');
  const renewalEl  = document.getElementById('dropdown-renewal');

  if (!user.subscriptionExpiry) {
    if (renewalEl) renewalEl.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (resubBtn)  resubBtn.classList.add('hidden');
    return;
  }

  const expiryDate = new Date(user.subscriptionExpiry);
  const expiryStr  = expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const expired    = user.subscriptionExpiry <= Date.now() || user.subscriptionStatus === 'lapsed';

  if (!expired && user.subscriptionStatus === 'active') {
    if (renewalEl) { renewalEl.textContent = `Renews ${expiryStr}`; renewalEl.classList.remove('hidden'); }
    if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel Subscription'; }
    if (resubBtn)  resubBtn.classList.add('hidden');
  } else if (!expired && user.subscriptionStatus === 'non-renewing') {
    if (renewalEl) { renewalEl.textContent = `Active until ${expiryStr} · Will not renew`; renewalEl.classList.remove('hidden'); }
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (resubBtn)  resubBtn.classList.remove('hidden');
  } else {
    if (renewalEl) { renewalEl.textContent = `Expired ${expiryStr}`; renewalEl.classList.remove('hidden'); }
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (resubBtn)  resubBtn.classList.remove('hidden');
  }
}

function toggleAccountDropdown() {
  const dropdown = document.getElementById('account-dropdown');
  const trigger  = document.getElementById('account-dropdown-trigger');
  const isOpen   = !dropdown.classList.contains('hidden');
  if (isOpen) {
    closeAccountDropdown();
  } else {
    dropdown.classList.remove('hidden');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }
}

function closeAccountDropdown() {
  const dropdown = document.getElementById('account-dropdown');
  const trigger  = document.getElementById('account-dropdown-trigger');
  if (dropdown) dropdown.classList.add('hidden');
  if (trigger)  trigger.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', function(e) {
  const wrap = document.getElementById('account-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) closeAccountDropdown();
});


/* ================================================================
   6. DATE HELPERS
================================================================ */
function getTodayISO() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}

function formatDateLong(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function formatDateShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

function formatTargetDate(iso) {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}


/* ================================================================
   7. INIT
================================================================ */
function initApp() {
  document.getElementById('today-date').textContent = formatDateLong(getTodayISO());

  const textarea = document.getElementById('journal-input');
  textarea.addEventListener('input', () => {
    updateWordCount(textarea);
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(saveDraft, 1000);
  });
}

async function loadAppData() {
  await loadEntries();
  await loadGoals();
  await loadMoodLogs();
  loadReferralStats();
  restoreTab();
  if (shouldShowOnboarding()) startOnboarding();
}


/* ================================================================
   8. ENTRIES
================================================================ */
async function loadEntries() {
  try {
    const data = await api('GET', '/api/entries');
    if (!data) return;
    state.entries = data.entries;
    state.streak  = data.streak;

    const today = state.entries.find(e => e.date === getTodayISO());
    if (today) {
      const ta = document.getElementById('journal-input');
      ta.value = today.text;
      updateWordCount(ta);
      autoResizeTextarea(ta);
      if (today.mood) selectMood(today.mood, true);
    } else {
      restoreDraft();
    }

    renderStreak(state.streak);
    renderHistory();
    renderEntryStrip();
    renderMoodSection();
  } catch (err) { console.error('[loadEntries]', err.message); }
}

function updateFreeEntryCounter() {
  // Entries are now unlimited for all users — hide the counter
  const counter = document.getElementById('free-entry-counter');
  if (counter) counter.classList.add('hidden');
}

async function saveEntry(text, mood) {
  const todayISO = getTodayISO();
  const data = await api('POST', '/api/entries', { date: todayISO, text, mood: mood || null });
  if (!data) return;
  const idx = state.entries.findIndex(e => e.date === data.entry.date);
  if (idx !== -1) state.entries[idx] = data.entry;
  else state.entries.unshift(data.entry);
  state.streak = data.streak;
  renderStreak(state.streak);
  renderHistory();
  renderMoodSection();
}

function confirmClearHistory() {
  document.getElementById('clear-confirm-modal').classList.remove('hidden');
}

function closeClearConfirm() {
  document.getElementById('clear-confirm-modal').classList.add('hidden');
}

async function executeClearHistory() {
  const btn = document.getElementById('clear-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    await api('DELETE', '/api/entries');
    state.entries = []; state.streak = 0;
    const ta = document.getElementById('journal-input');
    ta.value = '';
    document.getElementById('char-count').textContent = '0 words';
    autoResizeTextarea(ta);
    clearMoodSelection();
    renderStreak(0);
    renderHistory();
    renderMoodSection();
    closeClearConfirm();
    showToast('All entries have been cleared.');
  } catch (err) {
    showToast('Could not clear entries: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Delete All';
  }
}


/* ================================================================
   9. ENTRY EDIT
================================================================ */
function editEntry(id) {
  const item = document.querySelector(`.history-item[data-id="${id}"]`);
  if (!item) return;
  item.classList.add('open', 'editing');
  document.getElementById(`hbody-${id}`)?.classList.add('hidden');
  document.getElementById(`hedit-${id}`)?.classList.remove('hidden');
  document.getElementById(`edit-ta-${id}`)?.focus();
}

function cancelEdit(id) {
  const item = document.querySelector(`.history-item[data-id="${id}"]`);
  if (!item) return;
  item.classList.remove('editing');
  document.getElementById(`hbody-${id}`)?.classList.remove('hidden');
  document.getElementById(`hedit-${id}`)?.classList.add('hidden');
}

function selectEditMood(entryId, moodId) {
  document.querySelectorAll(`#hedit-${entryId} .edit-mood-btn`).forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.editMood === moodId);
  });
}

async function saveEditedEntry(id) {
  const textarea = document.getElementById(`edit-ta-${id}`);
  const editForm = document.getElementById(`hedit-${id}`);
  if (!textarea || !editForm) return;

  const text = textarea.value.trim();
  if (text.length < 10) { showToast('Entry is too short to save.'); return; }

  const selectedMoodBtn = editForm.querySelector('.edit-mood-btn.selected');
  const mood = selectedMoodBtn?.dataset.editMood || null;

  const saveBtn = editForm.querySelector('.btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const data = await api('PATCH', `/api/entries/${id}`, { text, mood });
    if (!data) return;
    const idx = state.entries.findIndex(e => e.id === id);
    if (idx !== -1) state.entries[idx] = data.entry;
    // If this was today's entry, update the main textarea too
    if (id === getTodayISO()) {
      const ta = document.getElementById('journal-input');
      ta.value = data.entry.text;
      autoResizeTextarea(ta);
      if (data.entry.mood) selectMood(data.entry.mood, true);
    }
    renderHistory();
    renderMoodSection();
    showToast('Entry updated!');
    requestAnimationFrame(() => {
      document.querySelector(`.history-item[data-id="${id}"]`)?.classList.add('open');
    });
  } catch (err) {
    showToast('Could not save: ' + err.message);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
  }
}


/* ================================================================
   10. MOOD SELECTOR
================================================================ */
async function selectMood(id, silent = false) {
  state.selectedMood = id;
  document.querySelectorAll('.mood-btn:not(.edit-mood-btn)').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.mood === id);
  });

  if (!silent) {
    const todayEntry = state.entries.find(e => e.date === getTodayISO());
    if (todayEntry) {
      try {
        await saveEntry(todayEntry.text, id);
        showToast(`${moodById(id)?.emoji || ''} Mood updated!`);
      } catch { /* mood will save on next form submit */ }
    } else {
      saveDraft();
    }
  }
}

function clearMoodSelection() {
  state.selectedMood = null;
  document.querySelectorAll('.mood-btn').forEach(btn => btn.classList.remove('selected'));
}


/* ================================================================
   11. MOOD TREND CHART
================================================================ */
function renderMoodSection() {
  const moodEntries = state.entries.filter(e => e.mood);
  const section     = document.getElementById('mood-section');
  if (!moodEntries.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  requestAnimationFrame(() => {
    const canvas = document.getElementById('mood-chart-canvas');
    drawMoodChart(canvas, [...moodEntries].reverse().slice(-21));
    renderMoodFrequency(moodEntries);
  });
}

function drawMoodChart(canvas, orderedEntries) {
  if (!canvas || !orderedEntries.length) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth;
  const H   = canvas.clientHeight || 180;
  if (W === 0) return;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cs         = getComputedStyle(document.documentElement);
  const borderClr  = cs.getPropertyValue('--border').trim()     || '#cde5d8';
  const primaryClr = cs.getPropertyValue('--primary').trim()    || '#3a8f65';
  const mutedClr   = cs.getPropertyValue('--text-muted').trim() || '#587568';

  const PAD = { top: 18, right: 14, bottom: 38, left: 14 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;
  const n   = orderedEntries.length;

  const xOf = i => PAD.left + (n === 1 ? cW / 2 : i * cW / (n - 1));
  const yOf = s => PAD.top  + cH - ((s - 1) / 4) * cH;

  const pts = orderedEntries.map((e, i) => {
    const m = moodById(e.mood);
    return { x: xOf(i), y: yOf(m?.score ?? 3), mood: m, date: e.date };
  });

  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = borderClr;
  ctx.lineWidth   = 1;
  for (let s = 1; s <= 5; s++) {
    const y = yOf(s);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  if (n >= 2) {
    const fill = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    fill.addColorStop(0, primaryClr + '28');
    fill.addColorStop(1, primaryClr + '00');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n - 1; i++) {
      const mx = (pts[i].x + pts[i+1].x) / 2, my = (pts[i].y + pts[i+1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[n-1].x, pts[n-1].y);
    ctx.lineTo(pts[n-1].x, PAD.top + cH);
    ctx.lineTo(pts[0].x,   PAD.top + cH);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = primaryClr;
    ctx.lineWidth   = 2.5;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n - 1; i++) {
      const mx = (pts[i].x + pts[i+1].x) / 2, my = (pts[i].y + pts[i+1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[n-1].x, pts[n-1].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  pts.forEach(p => {
    ctx.shadowColor = p.mood?.color || primaryClr;
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = p.mood?.color || primaryClr;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = '12px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.mood?.emoji || '·', p.x, p.y);
  });

  const labelIdxs = [...new Set([0, Math.floor((n-1)/2), n-1])].filter(i => i < n);
  ctx.fillStyle = mutedClr;
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  labelIdxs.forEach((i, li) => {
    const p   = pts[i];
    const lbl = new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    ctx.textAlign = li === 0 ? 'left' : li === labelIdxs.length - 1 ? 'right' : 'center';
    ctx.fillText(lbl, p.x, H - PAD.bottom + 8);
  });
}

function renderMoodFrequency(moodEntries) {
  const counts = {};
  moodEntries.forEach(e => { counts[e.mood] = (counts[e.mood] || 0) + 1; });
  document.getElementById('mood-frequency').innerHTML = MOODS
    .filter(m => counts[m.id])
    .map(m => `
      <div class="mood-freq-item">
        <span class="mood-freq-emoji">${m.emoji}</span>
        <span class="mood-freq-label">${m.label}</span>
        <span class="mood-freq-count">×${counts[m.id]}</span>
      </div>`)
    .join('');
}


/* ================================================================
   12. STREAK
================================================================ */
function streakMessage(n) {
  if (n === 0)  return "Write today to start your streak!";
  if (n === 1)  return "Day 1 — every great habit starts here.";
  if (n < 4)    return `${n} days strong. Keep going!`;
  if (n < 7)    return `${n} days — you're building something real.`;
  if (n === 7)  return "One full week! You're on a roll. 🎉";
  if (n < 14)   return `${n} days — this is becoming a habit.`;
  if (n === 14) return "Two weeks! You're a journaling regular.";
  if (n < 30)   return `${n} days — remarkable consistency.`;
  if (n === 30) return "30 days! A full month of reflection. Incredible.";
  return `${n} days — you're in elite company.`;
}

function renderStreak(n) {
  document.getElementById('streak-number').textContent  = n;
  document.getElementById('streak-message').textContent = streakMessage(n);
  document.getElementById('streak-widget').classList.toggle('streak-active', n > 0);
}


/* ================================================================
   13. JOURNAL FORM
================================================================ */
document.getElementById('journal-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const textarea  = document.getElementById('journal-input');
  const submitBtn = document.getElementById('submit-btn');
  const text      = textarea.value.trim();

  if (text.length < 20) {
    showToast('Please write at least a sentence or two so the AI has something to work with.');
    return;
  }

  submitBtn.disabled = true; submitBtn.textContent = 'Saving…';

  try {
    await saveEntry(text, state.selectedMood);
    clearDraft();
  } catch (err) {
    showToast('Could not save entry: ' + err.message);
    submitBtn.disabled = false; submitBtn.textContent = 'Save & Reflect →';
    return;
  }

  submitBtn.textContent = 'Generating…';
  const promptsSection = document.getElementById('prompts-section');
  promptsSection.classList.remove('hidden');
  promptsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await fetchReflectionPrompts(text);

  submitBtn.disabled = false; submitBtn.textContent = 'Save & Reflect →';
});


/* ================================================================
   14. REFLECTION PROMPTS + COACH CONVERSATION
================================================================ */
async function fetchReflectionPrompts(entryText) {
  const loader = document.getElementById('prompts-loader');
  const error  = document.getElementById('prompts-error');
  const result = document.getElementById('prompts-result');
  const grid   = document.getElementById('prompts-grid');

  loader.classList.remove('hidden');
  error.classList.add('hidden');
  result.classList.add('hidden');
  grid.innerHTML = '';
  state.coachEntry    = entryText;
  state.coachSessions = {};

  try {
    const data = await api('POST', '/api/reflect', { entry: entryText });
    if (!data) return;
    data.prompts.forEach(({ prompt, category }, i) => {
      grid.appendChild(buildPromptCard(prompt, category, i));
    });
    result.classList.remove('hidden');
    showToast('✦ Entry saved and prompts generated!');
    // Onboarding hook: advance to celebration screen after first entry
    if (state.onboarding.active && state.onboarding.step === 2) {
      setTimeout(() => advanceOnboarding(), 700);
    }
  } catch (err) {
    error.textContent = `Couldn't get reflection prompts: ${err.message}`;
    error.classList.remove('hidden');
  } finally { loader.classList.add('hidden'); }
}

function buildPromptCard(prompt, category, index) {
  const card = document.createElement('div');
  card.className = 'prompt-card';
  card.id        = `prompt-card-${index}`;
  card.innerHTML = `
    <div class="prompt-category">${escapeHTML(category)}</div>
    <p class="prompt-text">${escapeHTML(prompt)}</p>
    <button class="coach-expand-btn" onclick="openCoachThread(${index})">Explore this →</button>
    <div class="coach-thread hidden" id="coach-thread-${index}">
      <div class="coach-progress" id="coach-progress-${index}">
        <span class="coach-progress-label" id="coach-progress-label-${index}">Exchange 1 of 6</span>
        <div class="coach-progress-track">
          <div class="coach-progress-fill" id="coach-progress-fill-${index}" style="width:0%"></div>
        </div>
      </div>
      <div class="coach-messages" id="coach-messages-${index}"></div>
      <div class="coach-input-row" id="coach-input-row-${index}">
        <textarea class="coach-input" id="coach-input-${index}"
          placeholder="Write your response…" rows="2"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCoachMessage(${index});}"></textarea>
        <button class="coach-send-btn" id="coach-send-${index}" onclick="sendCoachMessage(${index})">Send →</button>
      </div>
    </div>`;
  return card;
}

function openCoachThread(index) {
  const card   = document.getElementById(`prompt-card-${index}`);
  const thread = document.getElementById(`coach-thread-${index}`);
  const btn    = card?.querySelector('.coach-expand-btn');
  if (!thread || !card) return;

  if (!state.coachSessions[index]) {
    const promptText = card.querySelector('.prompt-text').textContent;
    state.coachSessions[index] = {
      history: [
        { role: 'user',      content: `Here is my journal entry:\n\n${state.coachEntry}` },
        { role: 'assistant', content: promptText }
      ]
    };
    appendCoachBubble(document.getElementById(`coach-messages-${index}`), 'coach', promptText);
    // pro/trial: 10 total; free: 3 total
    const total = (state.accessLevel === 'pro' || state.accessLevel === 'trial') ? 10 : 3;
    updateCoachProgress(index, 1, total);
  }

  thread.classList.remove('hidden');
  card.classList.add('coach-active');
  if (btn) btn.classList.add('hidden');
  document.getElementById(`coach-input-${index}`)?.focus();
}

async function sendCoachMessage(index) {
  const inputEl  = document.getElementById(`coach-input-${index}`);
  const sendBtn  = document.getElementById(`coach-send-${index}`);
  const msgEl    = document.getElementById(`coach-messages-${index}`);
  const session  = state.coachSessions[index];
  if (!inputEl || !session) return;

  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value    = '';
  inputEl.disabled = true;
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }

  appendCoachBubble(msgEl, 'user', text);
  session.history.push({ role: 'user', content: text });

  const thinking = appendCoachThinking(msgEl);
  thinking.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Exchange limits: pro/trial = 10 total (9 coach), free = 3 total (2 coach)
  const isPro         = state.accessLevel === 'pro' || state.accessLevel === 'trial';
  const coachLimit    = isPro ? 9 : 2;
  const totalExchanges = isPro ? 10 : 3;

  let sessionEnded = false;
  try {
    const data = await api('POST', '/api/coach', { messages: session.history });
    thinking.remove();
    if (!data) return;

    session.history.push({ role: 'assistant', content: data.message });
    const bubble = appendCoachBubble(msgEl, 'coach', data.message);
    bubble.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const exchangesDone  = (session.history.length - 2) / 2; // coach exchanges completed
    const overallExchange = exchangesDone + 1;                // +1 for initial reflect

    updateCoachProgress(index, overallExchange, totalExchanges);

    if (exchangesDone >= coachLimit) {
      sessionEnded = true;
      // Hide the input row — session is complete
      const inputRow = document.getElementById(`coach-input-row-${index}`);
      if (inputRow) inputRow.classList.add('hidden');
      // Show Session Complete overlay after a brief pause so user reads final message
      setTimeout(() => showSessionComplete(data.message), 1400);
    }
  } catch (err) {
    thinking.remove();
    appendCoachBubble(msgEl, 'coach', "I'm having trouble responding right now — please try again.");
  } finally {
    if (!sessionEnded) {
      inputEl.disabled = false;
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send →'; }
      inputEl.focus();
    }
  }
}

function appendCoachBubble(container, role, text) {
  const el = document.createElement('div');
  el.className   = `coach-bubble coach-bubble--${role}`;
  el.textContent = text;
  container.appendChild(el);
  return el;
}

function appendCoachThinking(container) {
  const el = document.createElement('div');
  el.className = 'coach-bubble coach-bubble--coach coach-thinking';
  el.innerHTML  = '<span></span><span></span><span></span>';
  container.appendChild(el);
  return el;
}

function updateCoachProgress(index, current, total) {
  const label = document.getElementById(`coach-progress-label-${index}`);
  const fill  = document.getElementById(`coach-progress-fill-${index}`);
  if (label) label.textContent = `Exchange ${current} of ${total}`;
  if (fill)  fill.style.width  = `${Math.round((current / total) * 100)}%`;
}

function showSessionComplete(finalMessage) {
  const isPro     = state.accessLevel === 'pro' || state.accessLevel === 'trial';
  const today     = getTodayISO();
  const entry     = state.entries.find(e => e.date === today);
  const moodInfo  = moodById(entry?.mood || state.selectedMood);
  const dateLabel = formatDateLong(today);
  const streak    = state.streak;

  document.getElementById('session-complete-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id        = 'session-complete-overlay';
  overlay.className = 'session-complete-overlay';

  const metaItems = [
    `<span class="session-meta-item">${escapeHTML(dateLabel)}</span>`,
    moodInfo ? `<span class="session-meta-item">${moodInfo.emoji} ${escapeHTML(moodInfo.label)}</span>` : '',
    streak > 0 ? `<span class="session-meta-item">🔥 ${streak}-day streak</span>` : ''
  ].filter(Boolean).join('');

  overlay.innerHTML = `
    <div class="session-complete-card">
      <div class="session-complete-icon">✦</div>
      <h2 class="session-complete-title">Session Complete</h2>
      <div class="session-complete-meta">${metaItems}</div>
      <div class="session-insight-box">
        <p class="session-insight-label">Today's Key Reflection</p>
        <p class="session-insight-text" id="session-insight-text"></p>
      </div>
      <div class="session-complete-actions">
        <button class="btn btn-primary" id="session-save-btn">Save to Journal</button>
        <button class="btn btn-secondary" onclick="startNewEntry()">Start New Entry</button>
      </div>
      ${!isPro ? `<div class="session-upgrade-prompt">
        Want to go deeper? <button class="session-upgrade-link" onclick="showUpgradeModal()">Upgrade to Pro</button> for 10 coaching exchanges — ₦3,000/month
      </div>` : `<div class="session-upgrade-prompt">
        Enjoyed today's session? <a href="/referral.html" class="session-upgrade-link">Share ReflectAI with a friend</a> and earn a free month
      </div>`}
    </div>`;

  // Set insight text safely (preserves line breaks)
  document.body.appendChild(overlay);
  document.getElementById('session-insight-text').textContent = finalMessage;

  const saveBtn = document.getElementById('session-save-btn');
  saveBtn.addEventListener('click', () => saveSessionSummary(finalMessage, saveBtn));

  requestAnimationFrame(() => overlay.classList.add('visible'));
}

async function saveSessionSummary(summaryText, btn) {
  const today = getTodayISO();
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await api('PATCH', `/api/entries/${today}`, { coachSummary: summaryText });
    if (btn) { btn.disabled = true; btn.textContent = 'Saved ✓'; }
    showToast('Session summary saved to your journal!');
  } catch (err) {
    showToast('Could not save: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Save to Journal'; }
  }
}

function startNewEntry() {
  document.getElementById('session-complete-overlay')?.remove();
  const ta = document.getElementById('journal-input');
  if (ta) { ta.value = ''; updateWordCount(ta); autoResizeTextarea(ta); }
  clearMoodSelection();
  clearDraft();
  state.coachEntry    = '';
  state.coachSessions = {};
  document.getElementById('prompts-section')?.classList.add('hidden');
  document.getElementById('journal-section')?.scrollIntoView({ behavior: 'smooth' });
  ta?.focus();
}


/* ================================================================
   15. REFERRAL
================================================================ */
function captureReferralCode() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref && /^[a-z0-9]{5,12}$/.test(ref)) {
    localStorage.setItem('reflectai_ref', ref);
    // Remove ref from URL without reload
    const clean = window.location.pathname;
    window.history.replaceState({}, '', clean);
  }
}

async function loadReferralStats() {
  try {
    const data = await api('GET', '/api/referral');
    if (!data) return;

    // Update credit badge in dropdown
    const creditEl = document.getElementById('dropdown-referral-credit');
    if (creditEl) {
      if (data.stats.creditsEarned > 0) {
        const remaining = data.stats.creditsEarned - data.stats.totalConverted;
        creditEl.textContent = remaining > 0
          ? `🎁 You have ${remaining} month${remaining > 1 ? 's' : ''} of free credit`
          : `🎁 ${data.stats.creditsEarned} referral credit${data.stats.creditsEarned > 1 ? 's' : ''} earned`;
        creditEl.classList.remove('hidden');
      }
    }
  } catch { /* non-critical */ }
}


/* ================================================================
   16. ONBOARDING
================================================================ */
const ONBOARDED_KEY = 'reflectai_onboarded';

function shouldShowOnboarding() {
  if (localStorage.getItem(ONBOARDED_KEY)) return false;
  return state.entries.length === 0;
}

function startOnboarding() {
  state.onboarding = { active: true, step: 1 };
  showOnboardingOverlay(1);
}

function showOnboardingOverlay(step) {
  document.getElementById('onboarding-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id        = 'onboarding-overlay';
  overlay.className = 'onboarding-overlay';

  if (step === 1) {
    overlay.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-logo">✦</div>
        <h2 class="onboarding-title">Welcome to ReflectAI</h2>
        <p class="onboarding-subtitle">Your private space to think clearly, feel heard, and grow — one entry at a time.</p>
        <ul class="onboarding-features">
          <li><span class="onboarding-feature-icon">✍️</span><span>Write freely — no rules, no judgement, no audience</span></li>
          <li><span class="onboarding-feature-icon">🤖</span><span>Get 3 AI reflection prompts crafted for exactly what <em>you</em> wrote</span></li>
          <li><span class="onboarding-feature-icon">💬</span><span>Go deeper with a private coaching conversation built around your entry</span></li>
        </ul>
        <button class="btn btn-primary onboarding-cta" onclick="advanceOnboarding()">Write my first entry →</button>
        <p class="onboarding-skip">Already know the app? <button class="onboarding-skip-link" onclick="completeOnboarding()">Skip intro</button></p>
      </div>`;
  } else if (step === 3) {
    overlay.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-celebrate">🎉</div>
        <h2 class="onboarding-title">Your first reflection is ready!</h2>
        <p class="onboarding-subtitle">Claude read exactly what you wrote and crafted these questions just for you — not generic advice, but a real conversation starter.</p>
        <div class="onboarding-next-steps">
          <div class="onboarding-step-item">
            <span class="onboarding-step-num">1</span>
            <span>Pick the prompt that resonates most with you</span>
          </div>
          <div class="onboarding-step-item">
            <span class="onboarding-step-num">2</span>
            <span>Tap <strong>Explore this →</strong> to begin a coaching conversation</span>
          </div>
          <div class="onboarding-step-item">
            <span class="onboarding-step-num">3</span>
            <span>Come back tomorrow to keep your streak going 🔥</span>
          </div>
        </div>
        <button class="btn btn-primary onboarding-cta" onclick="completeOnboarding()">See my prompts →</button>
      </div>`;
  }

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function advanceOnboarding() {
  const step = state.onboarding.step;

  if (step === 1) {
    // Close welcome → go to guided writing
    document.getElementById('onboarding-overlay')?.remove();
    state.onboarding.step = 2;

    // Pre-fill textarea with a soft starter prompt
    const ta = document.getElementById('journal-input');
    if (ta && !ta.value.trim()) {
      ta.value = 'Right now, the thing that\'s most on my mind is ';
      updateWordCount(ta);
      autoResizeTextarea(ta);
    }

    // Show the floating writing tip
    showOnboardingTip();

    // Scroll to journal and focus
    document.getElementById('journal-section')?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => ta?.setSelectionRange(ta.value.length, ta.value.length) || ta?.focus(), 650);
  } else if (step === 2) {
    // Prompts generated — advance to celebration
    state.onboarding.step = 3;
    showOnboardingOverlay(3);
  }
}

function showOnboardingTip() {
  document.getElementById('onboarding-tip')?.remove();
  const tip = document.createElement('div');
  tip.id        = 'onboarding-tip';
  tip.className = 'onboarding-tip';
  tip.innerHTML = `
    <span class="onboarding-tip-icon">✦</span>
    <span class="onboarding-tip-text">Write anything that's on your mind — even a few sentences. Claude will respond to what <em>you</em> actually wrote, not a template.</span>
    <button class="onboarding-tip-close" onclick="document.getElementById('onboarding-tip')?.remove()" aria-label="Dismiss tip">×</button>`;

  const form = document.getElementById('journal-form');
  form?.parentNode?.insertBefore(tip, form);
  requestAnimationFrame(() => tip.classList.add('visible'));
}

function completeOnboarding() {
  localStorage.setItem(ONBOARDED_KEY, '1');
  state.onboarding = { active: false, step: 0 };
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 320);
  }
  document.getElementById('onboarding-tip')?.remove();
}


/* ================================================================
   16. WEEKLY INSIGHT  (Pro)
================================================================ */
async function generateWeeklyInsight() {
  const loader = document.getElementById('insight-loader');
  const error  = document.getElementById('insight-error');
  const textEl = document.getElementById('insight-text');
  const metaEl = document.getElementById('insight-meta');
  const btn    = document.getElementById('generate-insight-btn');

  btn.disabled = true; btn.textContent = 'Generating…';
  loader.classList.remove('hidden');
  error.classList.add('hidden');
  textEl.textContent = '';

  try {
    const data = await api('POST', '/api/weekly-insight');
    if (!data) return;

    // Monthly limit reached for free users
    if (data._insightMonthlyLimit) {
      const nextDate = data.nextAvailableDate
        ? new Date(data.nextAvailableDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        : 'next month';
      error.textContent = data.error || `Your next insight is available on ${nextDate}.`;
      error.classList.remove('hidden');
      if (!state.upgradeShown.has('insights')) {
        state.upgradeShown.add('insights');
        showUpgradePrompt(`Upgrade to Pro for weekly insights — your next free insight is on ${nextDate}.`, 'insights');
      }
      return;
    }

    textEl.textContent = data.insight;
    textEl.classList.remove('placeholder-text');
    const count = Math.min(state.entries.length, 7);
    metaEl.textContent = `Based on your ${count} most recent ${count === 1 ? 'entry' : 'entries'}`;
    showToast('Weekly insight generated!');
  } catch (err) {
    error.textContent = `Couldn't generate insight: ${err.message}`;
    error.classList.remove('hidden');
  } finally {
    loader.classList.add('hidden');
    btn.disabled = false; btn.textContent = 'Regenerate';
  }
}


/* ================================================================
   17. GOALS  (Pro)
================================================================ */
async function loadGoals() {
  try {
    const data = await api('GET', '/api/goals');
    if (!data) return;
    state.goals = data.goals;
    renderGoals();
  } catch (err) { console.error('[loadGoals]', err.message); }
}

async function handleAddGoal(e) {
  e.preventDefault();
  const titleEl    = document.getElementById('goal-title');
  const dateEl     = document.getElementById('goal-target-date');
  const categoryEl = document.getElementById('goal-category');
  const btn        = document.getElementById('add-goal-btn');
  const title      = titleEl.value.trim();
  if (!title) { showToast('Please enter a goal title.'); return; }

  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const data = await api('POST', '/api/goals', {
      title,
      targetDate: dateEl.value || null,
      category:   categoryEl?.value || null
    });
    if (!data) return;
    state.goals.unshift(data.goal);
    renderGoals();
    titleEl.value = ''; dateEl.value = '';
    if (categoryEl) categoryEl.value = '';
    showToast('Goal added!');
  } catch (err) { showToast('Could not add goal: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Add Goal'; }
}

async function toggleGoalStatus(id) {
  const goal = state.goals.find(g => g.id === id);
  if (!goal) return;
  const newStatus = goal.status === 'completed' ? 'active' : 'completed';
  try {
    await api('PATCH', `/api/goals/${id}`, { status: newStatus });
    goal.status = newStatus;
    renderGoals();
  } catch (err) { showToast('Could not update goal: ' + err.message); }
}

async function deleteGoal(id) {
  if (!window.confirm('Delete this goal?')) return;
  try {
    await api('DELETE', `/api/goals/${id}`);
    state.goals = state.goals.filter(g => g.id !== id);
    renderGoals();
    showToast('Goal deleted.');
  } catch (err) { showToast('Could not delete goal: ' + err.message); }
}

async function goalCheckin(id) {
  const btn = document.getElementById(`checkin-btn-${id}`);
  const out = document.getElementById(`checkin-out-${id}`);
  if (!btn || !out) return;
  btn.disabled = true; btn.textContent = 'Checking in…';
  out.textContent = ''; out.classList.remove('hidden');
  try {
    const data = await api('POST', `/api/goals/${id}/checkin`);
    if (!data) return;
    out.textContent = data.checkin;
  } catch (err) { out.textContent = 'Could not generate check-in: ' + err.message; }
  finally { btn.disabled = false; btn.textContent = '🤖 Check in'; }
}

function updateGoalsTrialNote() {
  const note = document.getElementById('goals-trial-note');
  if (!note) return;
  if (!state.user || state.accessLevel !== 'free') { note.classList.add('hidden'); return; }
  note.classList.remove('hidden');
  const activeGoals = state.goals.filter(g => g.status !== 'completed').length;
  note.textContent = activeGoals >= 2
    ? 'Free plan: 2 active goals maximum · Upgrade to Pro for unlimited goals'
    : `Free plan: ${2 - activeGoals} goal slot${activeGoals === 1 ? '' : 's'} remaining · Upgrade for unlimited`;
}

function renderGoals() {
  updateGoalsTrialNote();
  const container   = document.getElementById('goals-list');
  const compSection = document.getElementById('completed-goals-section');
  const compList    = document.getElementById('completed-goals-list');
  const compCount   = document.getElementById('completed-count');
  if (!container) return;

  const activeGoals    = state.goals.filter(g => g.status !== 'completed');
  const completedGoals = state.goals.filter(g => g.status === 'completed');

  container.innerHTML = '';
  if (!activeGoals.length) {
    container.innerHTML = '<div class="goals-empty"><p>No active goals. Add one above!</p></div>';
  } else {
    activeGoals.forEach(g => renderGoalCard(container, g));
  }

  if (completedGoals.length > 0) {
    compSection?.classList.remove('hidden');
    if (compCount) compCount.textContent = completedGoals.length;
    if (compList) {
      compList.innerHTML = '';
      completedGoals.forEach(g => renderGoalCard(compList, g));
    }
  } else {
    compSection?.classList.add('hidden');
  }

  renderHomeGoalsSnapshot();
}


/* ================================================================
   17. HISTORY
================================================================ */
function renderHistory() {
  updateFreeEntryCounter();
  const container = document.getElementById('history-container');
  const query = (document.getElementById('history-search')?.value || '').trim().toLowerCase();
  const entries = query
    ? state.entries.filter(e => e.text.toLowerCase().includes(query))
    : state.entries;

  if (!state.entries.length) {
    container.innerHTML = `
      <div class="history-empty">
        <div class="history-empty-icon">📓</div>
        <p>No entries yet. Write your first entry above to get started!</p>
      </div>`;
    return;
  }

  if (!entries.length) {
    container.innerHTML = `
      <div class="history-empty">
        <div class="history-empty-icon">🔍</div>
        <p>No entries match "<strong>${escapeHTML(query)}</strong>".</p>
      </div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'history-list';

  entries.forEach(entry => {
    const preview   = entry.text.length > 80 ? entry.text.slice(0, 80) + '…' : entry.text;
    const moodInfo  = moodById(entry.mood);
    const moodBadge = moodInfo
      ? `<span class="history-mood" title="${moodInfo.label}" aria-label="${moodInfo.label}">${moodInfo.emoji}</span>`
      : '';
    const editedNote = entry.updatedAt
      ? `<span class="history-edited-tag">edited</span>`
      : '';

    const editMoodBtns = MOODS.map(m => `
      <button type="button" class="mood-btn edit-mood-btn${entry.mood === m.id ? ' selected' : ''}"
        data-edit-mood="${m.id}"
        onclick="selectEditMood('${escapeHTML(entry.id)}','${m.id}')">
        <span class="mood-emoji" aria-hidden="true">${m.emoji}</span>
        <span class="mood-name">${m.label}</span>
      </button>`).join('');

    const item = document.createElement('div');
    item.className  = 'history-item';
    item.dataset.id = entry.id;
    item.innerHTML  = `
      <div class="history-item-header">
        <div class="history-item-clickable" onclick="toggleHistoryItem('${escapeHTML(entry.id)}')">
          <div class="history-item-meta">
            <div class="history-date">${escapeHTML(formatDateShort(entry.date))}${moodBadge}${editedNote}</div>
            <div class="history-preview">${escapeHTML(preview)}</div>
          </div>
        </div>
        <div class="history-header-actions">
          <button class="btn btn-sm btn-ghost history-edit-btn"
            onclick="editEntry('${escapeHTML(entry.id)}')">Edit</button>
          <span class="history-chevron" onclick="toggleHistoryItem('${escapeHTML(entry.id)}')" aria-hidden="true">▼</span>
        </div>
      </div>
      <div class="history-body" id="hbody-${entry.id}">${escapeHTML(entry.text)}</div>
      <div class="history-edit-form hidden" id="hedit-${entry.id}">
        <div class="edit-mood-row">${editMoodBtns}</div>
        <textarea class="journal-textarea edit-textarea" id="edit-ta-${entry.id}"
          maxlength="3000" aria-label="Edit journal entry">${escapeHTML(entry.text)}</textarea>
        <div class="edit-actions">
          <button class="btn btn-primary btn-sm"
            onclick="saveEditedEntry('${escapeHTML(entry.id)}')">Save changes</button>
          <button class="btn btn-ghost btn-sm"
            onclick="cancelEdit('${escapeHTML(entry.id)}')">Cancel</button>
        </div>
      </div>`;
    list.appendChild(item);
  });

  container.innerHTML = '';
  container.appendChild(list);
}

function toggleHistoryItem(id) {
  const item = document.querySelector(`.history-item[data-id="${id}"]`);
  if (!item || item.classList.contains('editing')) return;
  item.classList.toggle('open');
}


/* ================================================================
   18. THEME TOGGLE
================================================================ */
function initTheme() {
  updateToggleBtn(document.documentElement.getAttribute('data-theme') || 'light');
}

function toggleTheme() {
  const next = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('reflectai_theme', next);
  updateToggleBtn(next);
  requestAnimationFrame(() => {
    const moodEntries = state.entries.filter(e => e.mood);
    if (moodEntries.length) drawMoodChart(document.getElementById('mood-chart-canvas'), [...moodEntries].reverse().slice(-21));
  });
}

function updateToggleBtn(theme) {
  const btn  = document.getElementById('theme-toggle');
  const icon = btn?.querySelector('.theme-icon');
  if (!btn) return;
  if (theme === 'dark') {
    icon.textContent = '☀️';
    btn.setAttribute('aria-label', 'Switch to light mode');
    btn.title = 'Switch to light mode';
  } else {
    icon.textContent = '🌙';
    btn.setAttribute('aria-label', 'Switch to dark mode');
    btn.title = 'Switch to dark mode';
  }
}


/* ================================================================
   19. SCROLL-REVEAL
================================================================ */
function initScrollReveal() {
  const obs = new IntersectionObserver(
    es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } }),
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}


/* ================================================================
   20. TEXTAREA AUTO-RESIZE
================================================================ */
function autoResizeTextarea(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
function initAutoResize(ta)     { ta.addEventListener('input', () => autoResizeTextarea(ta)); autoResizeTextarea(ta); }


/* ================================================================
   21. TOAST
================================================================ */
function showToast(message) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = message; t.setAttribute('role', 'status');
  document.body.appendChild(t);
  setTimeout(() => t.parentNode && t.remove(), 3500);
}


/* ================================================================
   22. SECURITY
================================================================ */
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}


/* ================================================================
   23. FEEDBACK
================================================================ */
const _fbAnswers = {};

function showFeedbackModal() { document.getElementById('feedback-modal')?.classList.remove('hidden'); }
function closeFeedbackModal() {
  document.getElementById('feedback-modal')?.classList.add('hidden');
  _resetFeedbackModal();
}

function selectSingle(btn) {
  const q = btn.dataset.q;
  document.querySelectorAll(`.fb-opt[data-q="${q}"]`).forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _fbAnswers[q] = btn.dataset.val;
  updateProgress();
}

function toggleMulti(btn) {
  const q = btn.dataset.q;
  btn.classList.toggle('selected');
  if (!(_fbAnswers[q] instanceof Set)) _fbAnswers[q] = new Set();
  if (btn.classList.contains('selected')) _fbAnswers[q].add(btn.dataset.val);
  else {
    _fbAnswers[q].delete(btn.dataset.val);
    if (_fbAnswers[q].size === 0) delete _fbAnswers[q];
  }
  updateProgress();
}

function updateProgress() {
  let answered = 0;
  for (let i = 1; i <= 7; i++) {
    const v = _fbAnswers['q' + i];
    if (i === 3) { if (v instanceof Set && v.size > 0) answered++; }
    else if (v) answered++;
  }
  if ((document.getElementById('fb-q8')?.value || '').trim()) answered++;
  if ((document.getElementById('fb-q9')?.value || '').trim()) answered++;
  const pct = Math.round((answered / 9) * 100);
  const fill  = document.getElementById('fb-progress-fill');
  const label = document.getElementById('fb-progress-label');
  if (fill)  fill.style.width = pct + '%';
  if (label) label.textContent = answered + ' of 9 answered';
}

function _resetFeedbackModal() {
  Object.keys(_fbAnswers).forEach(k => delete _fbAnswers[k]);
  document.querySelectorAll('.fb-opt').forEach(b => b.classList.remove('selected'));
  const q8 = document.getElementById('fb-q8'); if (q8) q8.value = '';
  const q9 = document.getElementById('fb-q9'); if (q9) q9.value = '';
  const form = document.getElementById('feedback-form');
  const ty   = document.getElementById('fb-thankyou');
  const err  = document.getElementById('feedback-error');
  if (form) form.classList.remove('hidden');
  if (ty)   ty.classList.add('hidden');
  if (err)  { err.classList.add('hidden'); err.textContent = ''; }
  const btn = document.getElementById('feedback-submit-btn');
  if (btn)  { btn.disabled = false; btn.textContent = 'Submit Survey →'; }
  updateProgress();
}

async function submitFeedback(event) {
  event.preventDefault();
  const errEl = document.getElementById('feedback-error');
  const btn   = document.getElementById('feedback-submit-btn');
  errEl.classList.add('hidden');

  let answered = 0;
  for (let i = 1; i <= 7; i++) {
    const v = _fbAnswers['q' + i];
    if (i === 3) { if (v instanceof Set && v.size > 0) answered++; }
    else if (v) answered++;
  }
  if ((document.getElementById('fb-q8')?.value || '').trim()) answered++;
  if ((document.getElementById('fb-q9')?.value || '').trim()) answered++;

  if (answered < 1) {
    errEl.textContent = 'Please answer at least one question before submitting.';
    errEl.classList.remove('hidden');
    return;
  }

  const payload = {
    q1: _fbAnswers.q1 || null,
    q2: _fbAnswers.q2 || null,
    q3: (_fbAnswers.q3 instanceof Set && _fbAnswers.q3.size > 0) ? [..._fbAnswers.q3].join(', ') : null,
    q4: _fbAnswers.q4 || null,
    q5: _fbAnswers.q5 || null,
    q6: _fbAnswers.q6 || null,
    q7: _fbAnswers.q7 || null,
    q8: (document.getElementById('fb-q8')?.value || '').trim() || null,
    q9: (document.getElementById('fb-q9')?.value || '').trim() || null,
  };

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const token = localStorage.getItem('reflectai_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res  = await fetch('/api/feedback', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    document.getElementById('feedback-form').classList.add('hidden');
    document.getElementById('fb-thankyou').classList.remove('hidden');
  } catch {
    errEl.textContent = 'Something went wrong. Please try again.';
    errEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Submit Survey →';
  }
}


/* ================================================================
   24. PWA — service worker + install prompt
================================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

let _pwaPrompt = null;
const PWA_DISMISSED_KEY = 'reflectai_pwa_dismissed';

const _isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
const _isAndroid    = /android/i.test(navigator.userAgent);
const _isStandalone = window.matchMedia('(display-mode: standalone)').matches
                      || window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaPrompt = e;
});

window.addEventListener('appinstalled', () => {
  _pwaPrompt = null;
  document.getElementById('pwa-banner')?.classList.add('hidden');
  showToast('ReflectAI added to your home screen!');
});

function maybeShowPwaBanner() {
  // Don't show if already installed, already dismissed, or on desktop
  if (_isStandalone) return;
  if (localStorage.getItem(PWA_DISMISSED_KEY)) return;
  if (!_isIOS && !_isAndroid) return;

  setTimeout(() => {
    if (_isStandalone) return;
    const banner = document.getElementById('pwa-banner');
    const hint   = document.getElementById('pwa-banner-hint');
    if (!banner) return;

    // iOS Safari: no beforeinstallprompt — show manual instructions
    if (_isIOS && hint) {
      hint.textContent = 'Tap the Share button ↑ then "Add to Home Screen"';
    }
    // Android without native prompt: show manual instructions
    if (_isAndroid && !_pwaPrompt && hint) {
      hint.textContent = 'Tap ⋮ in Chrome then "Add to Home Screen"';
    }

    banner.classList.remove('hidden');
  }, 20000); // 20 s — enough time to log in and read an entry
}

function dismissPwaBanner() {
  document.getElementById('pwa-banner')?.classList.add('hidden');
  localStorage.setItem(PWA_DISMISSED_KEY, '1');
}

async function triggerPwaInstall() {
  if (_pwaPrompt) {
    // Android Chrome — native prompt available
    _pwaPrompt.prompt();
    const { outcome } = await _pwaPrompt.userChoice;
    _pwaPrompt = null;
    document.getElementById('pwa-banner')?.classList.add('hidden');
    if (outcome === 'accepted') showToast('ReflectAI added to your home screen!');
  } else {
    // iOS / other — just dismiss; hint text already guides them
    dismissPwaBanner();
  }
}


/* ================================================================
   25. TAB NAVIGATION
================================================================ */
const TAB_KEY = 'reflectai_tab';
let _insightsMoodChart = null;
let _moodLogs          = [];
let _insightsLoaded    = false;

function switchTab(name) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  const pane = document.getElementById('tab-' + name);
  if (pane) pane.classList.remove('hidden');

  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  localStorage.setItem(TAB_KEY, name);

  // Make reveal elements in new tab visible immediately
  document.querySelectorAll(`#tab-${name} .reveal`).forEach(el => el.classList.add('visible'));

  if (name === 'home')     renderHomeTab();
  if (name === 'journal')  { renderEntryStrip(); updateFreeEntryCounter(); }
  if (name === 'insights') initInsightsTab();
  if (name === 'goals')    renderGoals();
  if (name === 'profile')  renderProfileStats();
}

function restoreTab() {
  const saved = localStorage.getItem(TAB_KEY) || 'home';
  switchTab(saved);
}


/* ================================================================
   26. HOME TAB
================================================================ */
const HOME_QUOTES = [
  { text: "The secret of getting ahead is getting started.", source: "Mark Twain" },
  { text: "Small daily improvements are the key to staggering long-term results.", source: "Robin Sharma" },
  { text: "You don't have to be great to start, but you have to start to be great.", source: "Zig Ziglar" },
  { text: "It always seems impossible until it's done.", source: "Nelson Mandela" },
  { text: "However long the night, the dawn will break.", source: "African proverb" },
  { text: "If you want to go fast, go alone. If you want to go far, go together.", source: "African proverb" },
  { text: "Knowledge is like a garden: if it is not cultivated, it cannot be harvested.", source: "African proverb" },
  { text: "A winner is a dreamer who never gives up.", source: "Nelson Mandela" },
  { text: "The world is like a mask dancing. If you want to see it well, you do not stand in one place.", source: "Chinua Achebe" },
  { text: "Until the lion tells its own story, the hunter will always be the hero.", source: "African proverb" },
];

function renderHomeTab() {
  const now  = new Date();
  const hour = now.getHours();
  const tod  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  // Use saved firstName; fall back to the email prefix if nothing is set
  const firstName = (state.user?.firstName || '').trim() ||
                    (state.user?.email || '').split('@')[0];
  const greetEl = document.getElementById('home-greeting');
  if (greetEl) greetEl.textContent = tod + (firstName ? ', ' + firstName : '') + ' 🌿';

  const dateEl = document.getElementById('home-date');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const q = HOME_QUOTES[dayOfYear % HOME_QUOTES.length];
  const qtEl = document.getElementById('home-quote-text');
  const qsEl = document.getElementById('home-quote-source');
  if (qtEl) qtEl.textContent = '“' + q.text + '”';
  if (qsEl) qsEl.textContent = '— ' + q.source;

  renderHomeMoodCheckIn();
  renderHomeGoalsSnapshot();
}

async function loadMoodLogs() {
  try {
    const data = await api('GET', '/api/mood-logs');
    if (!data) return;
    _moodLogs                = data.logs || [];
    state.moodRestricted     = data.moodRestricted  || false;
    state.moodHasOlderData   = data.hasOlderData    || false;
    renderHomeMoodCheckIn();
  } catch (e) { console.error('[loadMoodLogs]', e.message); }
}

function renderHomeMoodCheckIn() {
  const today    = getTodayISO();
  const todayLog = _moodLogs.find(l => l.date === today);
  const loggedEl = document.getElementById('home-mood-logged');
  const rowEl    = document.getElementById('home-mood-row');
  if (!rowEl) return;

  rowEl.querySelectorAll('.quick-mood-btn').forEach(btn => btn.classList.remove('selected'));

  if (todayLog) {
    const EM = { awful: '😞', meh: '😐', okay: '🙂', good: '😊', great: '🤩' };
    const btn = rowEl.querySelector(`[data-qmood="${todayLog.mood}"]`);
    if (btn) btn.classList.add('selected');
    if (loggedEl) {
      loggedEl.textContent = `You’re feeling ${todayLog.mood} today ${EM[todayLog.mood] || ''}`;
      loggedEl.classList.remove('hidden');
    }
  } else {
    if (loggedEl) loggedEl.classList.add('hidden');
  }
}

async function logQuickMood(mood) {
  try {
    const data = await api('POST', '/api/mood-logs', { mood });
    if (!data) return;
    _moodLogs = _moodLogs.filter(l => l.date !== data.log.date);
    _moodLogs.unshift(data.log);
    renderHomeMoodCheckIn();
    _insightsLoaded = false; // so chart refreshes next time Insights opens
    const EM = { awful: '😞', meh: '😐', okay: '🙂', good: '😊', great: '🤩' };
    showToast('Mood logged ' + (EM[mood] || ''));
  } catch (e) { showToast('Could not save mood: ' + e.message); }
}

function renderHomeGoalsSnapshot() {
  const list = document.getElementById('home-goals-list');
  if (!list) return;
  const active = state.goals.filter(g => g.status !== 'completed').slice(0, 3);
  if (!active.length) {
    list.innerHTML = '<div class="home-goals-empty"><button class="home-link-btn" onclick="switchTab(\'goals\')">Set your first goal →</button></div>';
    return;
  }
  list.innerHTML = active.map(g => `
    <div class="home-goal-item">
      <div class="home-goal-title">${escapeHTML(g.title)}</div>
      <div class="home-goal-progress-bar">
        <div class="home-goal-progress-fill" style="width:${g.progress || 0}%"></div>
      </div>
    </div>`).join('');
}


/* ================================================================
   27. JOURNAL TAB — entry strip + past entry modal
================================================================ */
function renderEntryStrip() {
  const strip = document.getElementById('entry-strip');
  if (!strip) return;
  const recent = state.entries.slice(0, 3);
  if (!recent.length) { strip.innerHTML = ''; return; }
  strip.innerHTML = recent.map(e => {
    const d = new Date(e.date + 'T00:00:00');
    const label = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<button class="entry-chip" onclick="openPastEntryModal('${escapeHTML(e.date)}')">${escapeHTML(label)}</button>`;
  }).join('');
}

function openPastEntryModal(date) {
  const entry = state.entries.find(e => e.date === date);
  if (!entry) return;
  const d = new Date(date + 'T00:00:00');
  document.getElementById('past-entry-modal-date').textContent =
    d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const mood   = moodById(entry.mood);
  const moodEl = document.getElementById('past-entry-modal-mood');
  if (moodEl) moodEl.textContent = mood ? mood.emoji + ' ' + mood.label : '';
  document.getElementById('past-entry-modal-body').textContent = entry.text;
  document.getElementById('past-entry-modal').classList.remove('hidden');
}

function closePastEntryModal() {
  document.getElementById('past-entry-modal')?.classList.add('hidden');
}


/* ================================================================
   28. INSIGHTS TAB
================================================================ */
function initInsightsTab() {
  if (_insightsLoaded) return;
  _insightsLoaded = true;
  renderInsightsMoodChart();
  loadWeeklySummary();
  const isProOrTrial = state.accessLevel === 'pro' || state.accessLevel === 'trial';
  document.getElementById('export-pro-section')?.classList.toggle('hidden', !isProOrTrial);
  document.getElementById('export-free-section')?.classList.toggle('hidden', isProOrTrial);

  // Update mood chart title and restriction overlay
  const titleEl = document.getElementById('mood-chart-title');
  if (titleEl) titleEl.textContent = state.moodRestricted ? 'Mood — Last 7 Days' : 'Mood This Week';
  const upgradeEl = document.getElementById('mood-history-upgrade');
  if (upgradeEl) upgradeEl.classList.toggle('hidden', !state.moodHasOlderData);
}

function renderInsightsMoodChart() {
  const wrap    = document.getElementById('insights-chart-wrap');
  const emptyEl = document.getElementById('insights-mood-empty');
  if (!wrap) return;

  const today = new Date();
  const labels = [], scores = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const log = _moodLogs.find(l => l.date === iso);
    labels.push(d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }));
    scores.push(log ? log.score : null);
  }

  const hasData = scores.some(s => s !== null);
  if (!hasData) {
    wrap.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  emptyEl?.classList.add('hidden');

  const canvas = document.getElementById('insights-mood-canvas');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_insightsMoodChart) { _insightsMoodChart.destroy(); _insightsMoodChart = null; }

  const cs          = getComputedStyle(document.documentElement);
  const borderClr   = cs.getPropertyValue('--border').trim()      || '#cde5d8';
  const textMuted   = cs.getPropertyValue('--text-muted').trim()  || '#587568';

  _insightsMoodChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Mood',
        data: scores,
        backgroundColor: scores.map(s =>
          s === null ? 'transparent' : `rgba(29,158,117,${0.2 + (s / 5) * 0.65})`),
        borderColor: scores.map(s => s === null ? 'transparent' : '#1D9E75'),
        borderWidth: 2,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              return ['','😞 Awful','😐 Meh','🙂 Okay','😊 Good','🤩 Great'][ctx.raw] || '—';
            }
          }
        }
      },
      scales: {
        y: {
          min: 0, max: 5,
          ticks: {
            stepSize: 1, color: textMuted, font: { size: 11 },
            callback: v => ['','😞','😐','🙂','😊','🤩'][v] || ''
          },
          grid: { color: borderClr }
        },
        x: { ticks: { color: textMuted, font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
}

async function loadWeeklySummary() {
  const loaderEl   = document.getElementById('insight-loader');
  const entriesEl  = document.getElementById('weekly-stat-entries');
  const wordsEl    = document.getElementById('weekly-stat-words');
  const moodEl     = document.getElementById('weekly-stat-mood');
  const textEl     = document.getElementById('insight-text');
  if (!loaderEl) return;
  loaderEl.classList.remove('hidden');
  try {
    const data = await api('GET', '/api/insights/weekly-summary');
    if (!data) return;
    if (entriesEl) entriesEl.textContent = data.stats?.entries ?? '—';
    if (wordsEl)   wordsEl.textContent   = data.stats?.words   ?? '—';
    const EM = { awful: '😞', meh: '😐', okay: '🙂', good: '😊', great: '🤩' };
    if (moodEl)  moodEl.textContent  = data.stats?.topMood ? (EM[data.stats.topMood] || data.stats.topMood) : '—';
    if (textEl) {
      textEl.textContent = data.aiInsight || 'Write more entries this week to get your AI insight.';
      textEl.classList.toggle('placeholder-text', !data.aiInsight);
    }
  } catch (e) { console.warn('[loadWeeklySummary]', e.message); }
  finally { loaderEl.classList.add('hidden'); }
}

async function handleInsightsExport() {
  const btn     = document.getElementById('insights-export-btn');
  const spinner = document.getElementById('insights-export-spinner');
  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');
  try {
    const token = localStorage.getItem('reflectai_token');
    const res   = await fetch('/api/export/pdf', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Export failed.');
      return;
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const dateStr  = new Date().toISOString().slice(0, 10);
    const username = (state.user?.email || 'journal').split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
    a.href = url; a.download = 'ReflectAI-Journal-' + username + '-' + dateStr + '.pdf';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('Journal exported!');
  } catch { showToast('Export failed. Please try again.'); }
  finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add('hidden');
  }
}


/* ================================================================
   29. GOALS TAB — progress, category, confetti, completed section
================================================================ */
async function adjustGoalProgress(id, delta) {
  const goal = state.goals.find(g => g.id === id);
  if (!goal) return;
  const newProg = Math.min(100, Math.max(0, (goal.progress || 0) + delta * 10));
  try {
    await api('PATCH', '/api/goals/' + id, { progress: newProg });
    goal.progress = newProg;
    renderGoals();
  } catch (e) { showToast('Could not update: ' + e.message); }
}

function triggerConfetti(x, y) {
  const colors = ['#1D9E75','#5dbf8a','#E1F5EE','#fbbf24','#f87171','#60a5fa','#a78bfa'];
  for (let i = 0; i < 20; i++) {
    const el    = document.createElement('div');
    el.className = 'confetti-piece';
    const angle = (i / 20) * 360;
    const dist  = 55 + Math.random() * 90;
    const cx    = (Math.cos(angle * Math.PI / 180) * dist).toFixed(1) + 'px';
    const cy    = (Math.sin(angle * Math.PI / 180) * dist - 40).toFixed(1) + 'px';
    const cr    = Math.round(Math.random() * 360) + 'deg';
    el.style.cssText = `left:${x}px;top:${y}px;background:${colors[i%colors.length]};--cx:${cx};--cy:${cy};--cr:${cr}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
}

async function toggleGoalStatusWithConfetti(id, event) {
  const goal = state.goals.find(g => g.id === id);
  if (!goal) return;
  const newStatus = goal.status === 'completed' ? 'active' : 'completed';
  try {
    await api('PATCH', '/api/goals/' + id, { status: newStatus });
    goal.status = newStatus;
    if (newStatus === 'completed' && event) {
      const r = event.target.getBoundingClientRect();
      triggerConfetti(r.left + r.width / 2, r.top + r.height / 2);
      const card = document.getElementById('goal-card-' + id);
      if (card) { card.classList.add('just-completed'); setTimeout(() => card.classList.remove('just-completed'), 800); }
    }
    renderGoals();
    renderHomeGoalsSnapshot();
  } catch (e) { showToast('Could not update goal: ' + e.message); }
}

function toggleCompletedGoals() {
  const list = document.getElementById('completed-goals-list');
  const btn  = document.getElementById('completed-toggle-btn');
  if (!list || !btn) return;
  const showing = !list.classList.contains('hidden');
  list.classList.toggle('hidden', showing);
  const count = state.goals.filter(g => g.status === 'completed').length;
  btn.textContent = (showing ? 'Show' : 'Hide') + ' completed (' + count + ')';
}

function renderGoalCard(container, goal) {
  const isDone    = goal.status === 'completed';
  const catBadge  = goal.category
    ? `<span class="goal-cat-badge goal-cat-${escapeHTML(goal.category)}">${escapeHTML(goal.category)}</span>`
    : '';
  const dateStr   = goal.targetDate ? formatTargetDate(goal.targetDate) : null;
  const progress  = goal.progress || 0;

  const card = document.createElement('div');
  card.className  = 'goal-card' + (isDone ? ' goal-done' : '');
  card.id         = 'goal-card-' + goal.id;
  card.innerHTML  = `
    <div class="goal-card-header">
      <div class="goal-card-info">
        <h3 class="goal-title-text">${escapeHTML(goal.title)}</h3>
        ${goal.description ? `<p class="goal-desc-text">${escapeHTML(goal.description)}</p>` : ''}
        <div class="goal-meta-row">
          ${catBadge}
          ${dateStr ? `<span class="goal-date-text">${escapeHTML(dateStr)}</span>` : ''}
        </div>
        ${!isDone ? `
        <div class="goal-progress-wrap">
          <div class="goal-progress-header">
            <span class="goal-progress-pct">${progress}%</span>
            <div class="goal-progress-controls">
              <button class="goal-progress-btn" onclick="adjustGoalProgress('${goal.id}',-1)" title="−10%">−</button>
              <button class="goal-progress-btn" onclick="adjustGoalProgress('${goal.id}',1)"  title="+10%">+</button>
            </div>
          </div>
          <div class="goal-progress-track">
            <div class="goal-progress-fill" style="width:${progress}%"></div>
          </div>
        </div>` : ''}
      </div>
      <div class="goal-card-actions">
        <button class="btn btn-sm ${isDone ? 'btn-ghost' : 'btn-secondary'}"
          onclick="toggleGoalStatusWithConfetti('${goal.id}',event)">
          ${isDone ? 'Reopen' : '✓ Complete'}
        </button>
        ${!isDone ? `<button class="btn btn-sm btn-secondary" id="checkin-btn-${goal.id}" onclick="goalCheckin('${goal.id}')">🤖 Check in</button>` : ''}
        <button class="btn btn-sm btn-ghost-danger" onclick="deleteGoal('${goal.id}')">🗑</button>
      </div>
    </div>
    <div class="goal-checkin-result hidden" id="checkin-out-${goal.id}"></div>`;
  container.appendChild(card);
}


/* ================================================================
   30. PROFILE TAB
================================================================ */
function updateProfileUI(user) {
  if (!user) return;
  const isPro = user.plan === 'pro';

  const firstName   = (user.firstName || '').trim();
  const lastName    = (user.lastName  || '').trim();
  const fullName    = [firstName, lastName].filter(Boolean).join(' ');
  // Initials: first letter of first name + first letter of last name
  const initials    = [firstName, lastName]
    .filter(Boolean).map(n => n[0].toUpperCase()).slice(0, 2).join('')
    || (user.email[0] || '?').toUpperCase();

  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) avatarEl.textContent = initials;

  const fullNameEl = document.getElementById('profile-full-name');
  if (fullNameEl) fullNameEl.textContent = fullName || '';

  const emailEl = document.getElementById('profile-email-display');
  if (emailEl) emailEl.textContent = user.email;

  const badgeEl = document.getElementById('profile-plan-badge');
  if (badgeEl) { badgeEl.textContent = isPro ? 'PRO' : 'FREE'; badgeEl.classList.toggle('pro', isPro); }

  const sinceEl = document.getElementById('profile-member-since');
  if (sinceEl && user.createdAt) {
    sinceEl.textContent = 'Since ' + new Date(user.createdAt)
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  document.getElementById('profile-upgrade-banner')?.classList.toggle('hidden', isPro);

  const billingEl   = document.getElementById('profile-billing-section');
  const billingText = document.getElementById('profile-billing-text');
  if (billingEl && billingText) {
    if (isPro && user.subscriptionExpiry) {
      const expStr = new Date(user.subscriptionExpiry)
        .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      billingText.textContent = user.subscriptionStatus === 'non-renewing'
        ? `Active until ${expStr} · Will not renew`
        : `Renews ${expStr}`;
      billingEl.classList.remove('hidden');
    } else {
      billingEl.classList.add('hidden');
    }
  }
}

function renderProfileStats() {
  const entriesEl = document.getElementById('profile-stat-entries');
  const wordsEl   = document.getElementById('profile-stat-words');
  const daysEl    = document.getElementById('profile-stat-days');
  const streakEl  = document.getElementById('profile-stat-streak');
  if (!entriesEl) return;

  entriesEl.textContent = state.entries.length;
  const totalWords = state.entries.reduce(
    (s, e) => s + (e.text ? e.text.trim().split(/\s+/).filter(Boolean).length : 0), 0
  );
  wordsEl.textContent = totalWords > 9999 ? Math.round(totalWords / 1000) + 'k' : totalWords;
  daysEl.textContent  = new Set(state.entries.map(e => e.date)).size;
  streakEl.textContent = state.streak;
}

function openEditProfile() {
  const form    = document.getElementById('profile-edit-form');
  const editBtn = document.getElementById('profile-edit-btn');
  if (!form) return;
  const fn = document.getElementById('edit-first-name');
  const ln = document.getElementById('edit-last-name');
  if (fn) fn.value = (state.user?.firstName || '').trim();
  if (ln) ln.value = (state.user?.lastName  || '').trim();
  document.getElementById('profile-edit-success')?.classList.add('hidden');
  form.classList.remove('hidden');
  if (editBtn) editBtn.style.display = 'none';
  fn?.focus();
}

function cancelEditProfile() {
  document.getElementById('profile-edit-form')?.classList.add('hidden');
  document.getElementById('profile-edit-success')?.classList.add('hidden');
  const editBtn = document.getElementById('profile-edit-btn');
  if (editBtn) editBtn.style.display = '';
}

async function saveProfileEdit() {
  const fn = (document.getElementById('edit-first-name')?.value || '').trim();
  const ln = (document.getElementById('edit-last-name')?.value  || '').trim();
  const successEl = document.getElementById('profile-edit-success');
  try {
    const data = await api('PATCH', '/api/auth/profile', { firstName: fn, lastName: ln });
    if (!data) return;
    state.user = { ...state.user, ...data.user };
    updateProfileUI(state.user);
    renderHomeTab();
    renderProfileStats();
    if (successEl) {
      successEl.classList.remove('hidden');
      setTimeout(() => successEl.classList.add('hidden'), 3000);
    }
    setTimeout(cancelEditProfile, 1800);
  } catch (e) { showToast('Could not save: ' + e.message); }
}

function toggleChangePassword() {
  const form  = document.getElementById('change-password-form');
  const arrow = document.getElementById('cp-arrow');
  if (!form) return;
  const open = form.classList.contains('hidden');
  form.classList.toggle('hidden', !open);
  if (arrow) arrow.textContent = open ? '∨' : '›';
  if (!open) {
    ['cp-current','cp-new','cp-confirm'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('cp-error')?.classList.add('hidden');
  }
}

async function submitChangePassword() {
  const currentPw = document.getElementById('cp-current')?.value || '';
  const newPw     = document.getElementById('cp-new')?.value     || '';
  const confirmPw = document.getElementById('cp-confirm')?.value || '';
  const errEl     = document.getElementById('cp-error');
  if (errEl) errEl.classList.add('hidden');

  if (!currentPw || !newPw || !confirmPw) {
    if (errEl) { errEl.textContent = 'All fields are required.'; errEl.classList.remove('hidden'); } return;
  }
  if (newPw !== confirmPw) {
    if (errEl) { errEl.textContent = 'New passwords do not match.'; errEl.classList.remove('hidden'); } return;
  }
  if (newPw.length < 8) {
    if (errEl) { errEl.textContent = 'New password must be at least 8 characters.'; errEl.classList.remove('hidden'); } return;
  }

  try {
    await api('POST', '/api/auth/change-password', { currentPassword: currentPw, newPassword: newPw });
    showToast('Password updated successfully!');
    toggleChangePassword();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message || 'Could not update password.'; errEl.classList.remove('hidden'); }
  }
}


/* ================================================================
   24. BOOT
================================================================ */
/* ================================================================
   31. SWIPE GESTURE NAVIGATION (mobile only, < 768px)
================================================================ */
function initSwipeNav() {
  const TAB_ORDER       = ['home', 'journal', 'insights', 'goals', 'profile'];
  const SWIPE_THRESHOLD = 50; // px minimum to count as a swipe
  const ANIM_MS         = 280; // must match CSS transition duration

  let touchStartX   = 0;
  let touchStartY   = 0;
  let swipeDisabled = false; // true when touch started on a text input
  let isAnimating   = false;

  const main = document.getElementById('tab-main');
  if (!main) return;

  main.addEventListener('touchstart', e => {
    const t = e.target;
    // Disable swipe if the touch began inside a textarea, input, or
    // horizontally-scrollable strip (entry chips), so those still work.
    swipeDisabled =
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'INPUT'    ||
      t.tagName === 'SELECT'   ||
      !!t.closest('textarea, input, select, .entry-strip');
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  main.addEventListener('touchend', e => {
    if (swipeDisabled || isAnimating)    return;
    if (window.innerWidth >= 768)        return; // sidebar handles desktop

    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;

    // Ignore if the gesture is more vertical than horizontal (scrolling)
    if (Math.abs(dy) >= Math.abs(dx))   return;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    const currentName = localStorage.getItem(TAB_KEY) || 'home';
    const currentIdx  = TAB_ORDER.indexOf(currentName);
    const direction   = dx < 0 ? 'left' : 'right';
    const nextIdx     = currentIdx + (direction === 'left' ? 1 : -1);

    // Don't swipe past the first or last tab
    if (nextIdx < 0 || nextIdx >= TAB_ORDER.length) return;

    _animateToTab(currentName, TAB_ORDER[nextIdx], direction);
  }, { passive: true });

  function _animateToTab(fromName, toName, direction) {
    if (isAnimating) return;
    isAnimating = true;

    const outgoing = document.getElementById('tab-' + fromName);
    const incoming = document.getElementById('tab-' + toName);
    if (!outgoing || !incoming) { isAnimating = false; return; }

    const enterFrom = direction === 'left' ?  '100%' : '-100%';
    const exitTo    = direction === 'left' ? '-100%' :  '100%';

    // Place incoming off-screen and make it visible (but not yet scrolled)
    incoming.style.transform = 'translateX(' + enterFrom + ')';
    incoming.style.transition = 'none';
    incoming.classList.remove('hidden');

    // Trigger a reflow so the browser registers the initial transform
    // before we start the transition
    incoming.getBoundingClientRect();

    // Animate both panes simultaneously
    const timing = 'transform ' + ANIM_MS + 'ms ease';
    incoming.style.transition = timing;
    outgoing.style.transition = timing;

    requestAnimationFrame(() => {
      incoming.style.transform = 'translateX(0)';
      outgoing.style.transform = 'translateX(' + exitTo + ')';
    });

    setTimeout(() => {
      // Clear all inline styles set during animation
      incoming.style.transition = '';
      incoming.style.transform  = '';
      outgoing.style.transition = '';
      outgoing.style.transform  = '';
      isAnimating = false;

      // Hand off to the normal switchTab so nav, localStorage,
      // and any tab-init callbacks (renderGoals, etc.) all fire correctly.
      switchTab(toName);
    }, ANIM_MS + 10);
  }
}

/* ================================================================
   24. BOOT
================================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  captureReferralCode();
  initTheme();
  initApp();
  initSwipeNav();
  initAutoResize(document.getElementById('journal-input'));
  await loadConfig();
  await initAuth();
  handleStripeReturn();
  maybeShowPwaBanner();
});

// Handle keyboard hiding bottom nav when textarea is focused
document.addEventListener('DOMContentLoaded', () => {
  const ta  = document.getElementById('journal-input');
  const nav = document.getElementById('bottom-nav');
  if (!ta || !nav) return;
  ta.addEventListener('focus', () => {
    if (window.innerWidth <= 768) nav.style.transform = 'translateY(100%)';
  });
  ta.addEventListener('blur', () => {
    nav.style.transform = '';
  });
});

window.addEventListener('resize', () => {
  // Redraw insights chart on resize (if visible)
  if (_insightsMoodChart) {
    _insightsMoodChart.resize();
  }
});
