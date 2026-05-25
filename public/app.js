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
   15. Weekly insight
   16. Goals (Pro)
   17. History
   18. Theme toggle
   19. Scroll-reveal
   20. Textarea auto-resize
   21. Toast
   22. Security — escapeHTML
   23. Boot
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
  flutterwaveKey:      ''
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
  if (res.status === 403 && (data.code === 'PAYMENT_REQUIRED' || data.code === 'SUBSCRIPTION_EXPIRED' || data.code === 'ENTRY_LIMIT_REACHED' || data.code === 'PRO_TRIAL_EXHAUSTED')) {
    showPaymentWall();
    return null;
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
  document.getElementById('login-form').classList.toggle('hidden',  tab !== 'login');
  document.getElementById('signup-form').classList.toggle('hidden', tab !== 'signup');
  document.getElementById('tab-login').classList.toggle('active',   tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active',  tab === 'signup');
  document.getElementById('auth-error').classList.add('hidden');
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
    const res  = await fetch('/api/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.error) { setAuthError(data.error); return; }
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
  document.getElementById('journal-input').value = '';
  document.getElementById('char-count').textContent = '0 words';
  document.getElementById('prompts-section').classList.add('hidden');
  document.getElementById('mood-section').classList.add('hidden');
  clearMoodSelection();
  renderHistory();
  renderStreak(0);
  showAuthOverlay();
  showToast('You have been logged out.');
}

function applyUserUI(user) {
  const isPro = user.plan === 'pro';
  document.getElementById('nav-user').classList.remove('hidden');
  const navBadge = document.getElementById('nav-plan-badge');
  navBadge.textContent = isPro ? 'PRO' : 'FREE';
  navBadge.classList.toggle('pro', isPro);
  document.getElementById('account-email').textContent = user.email;
  const accBadge = document.getElementById('account-plan-badge');
  accBadge.textContent = isPro ? 'PRO' : 'FREE';
  accBadge.classList.toggle('pro', isPro);
  document.getElementById('account-plan-label').textContent = isPro ? 'Pro plan' : 'Free plan';
  document.getElementById('account-upgrade-btn').classList.toggle('hidden', isPro);
  applySubscriptionUI(user);

  // Update hero CTA button label
  const heroBtn = document.getElementById('hero-cta-btn');
  if (heroBtn) heroBtn.textContent = 'Go to Journal →';

  applyProGates(isPro);
}

function applyProGates(isPro) {
  // All users get trial access — hide the lock overlays, show the content
  document.getElementById('weekly-lock').classList.add('hidden');
  document.getElementById('weekly-content').classList.remove('hidden');
  document.getElementById('goals-lock').classList.add('hidden');
  document.getElementById('goals-content').classList.remove('hidden');

  // Show trial notes only for free users
  const weeklyNote = document.getElementById('weekly-trial-note');
  if (weeklyNote) weeklyNote.classList.toggle('hidden', isPro);
  updateGoalsTrialNote();
}

async function initAuth() {
  const token = localStorage.getItem('reflectai_token');
  if (!token) { showAuthOverlay(); return; }
  try {
    const data = await api('GET', '/api/auth/me');
    if (!data) return;
    state.user = data.user; state.streak = data.streak;
    hideAuthOverlay();
    applyUserUI(data.user);
    await loadAppData();
  } catch { showAuthOverlay(); }
}

function showUpgradeModal()  { showPaymentWall(); }
function closeUpgradeModal() { hidePaymentWall(); }
function closePaymentWall()  { hidePaymentWall(); }


/* ================================================================
   5. PAYMENT — PAYSTACK + FLUTTERWAVE
================================================================ */
function isNigerianUser() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone === 'Africa/Lagos';
}

function applyPaymentWallRegion() {
  const container = document.getElementById('payment-options-container');
  if (!container) return;
  const paystackOpt     = document.getElementById('payment-opt-paystack');
  const flutterwaveOpt  = document.getElementById('payment-opt-flutterwave');
  const divider         = container.querySelector('.payment-divider');
  if (!paystackOpt || !flutterwaveOpt || !divider) return;

  if (isNigerianUser()) {
    // Nigerian users: Paystack first (primary), Flutterwave second (secondary)
    container.append(paystackOpt, divider, flutterwaveOpt);
    document.getElementById('paystack-pay-btn')?.classList.replace('btn-secondary', 'btn-primary');
    document.getElementById('flutterwave-pay-btn')?.classList.replace('btn-primary', 'btn-secondary');
  } else {
    // International users: Flutterwave first (primary), Paystack second (secondary)
    container.append(flutterwaveOpt, divider, paystackOpt);
    document.getElementById('flutterwave-pay-btn')?.classList.replace('btn-secondary', 'btn-primary');
    document.getElementById('paystack-pay-btn')?.classList.replace('btn-primary', 'btn-secondary');
  }
}

function showPaymentWall() {
  applyPaymentWallRegion();
  document.getElementById('payment-wall')?.classList.remove('hidden');
}
function hidePaymentWall() { document.getElementById('payment-wall')?.classList.add('hidden'); }

async function loadConfig() {
  try {
    const data = await fetch('/api/config').then(r => r.json());
    state.paystackKey          = data.paystackPublicKey    || '';
    state.planCode             = data.paystackPlanCode     || '';
    state.stripePublishableKey = data.stripePublishableKey || '';
    state.flutterwaveKey       = data.flutterwavePublicKey || '';
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
    amount:          5,
    currency:        'USD',
    payment_options: 'card',
    customer: {
      email: state.user.email,
      name:  state.user.email
    },
    customizations: {
      title:       'ReflectAI Pro',
      description: 'Monthly subscription — $5/month',
      logo:        ''
    },
    callback(data) {
      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Flutterwave — $5/month'; }
      if (data.status === 'successful' || data.status === 'completed') {
        verifyFlutterwavePayment(data.transaction_id);
      } else {
        showToast('Payment was not completed. Please try again.');
      }
    },
    onclose() {
      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Flutterwave — $5/month'; }
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
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Flutterwave — $5/month'; }
    showToast('Verification failed: ' + err.message);
  }
}

async function cancelSubscription() {
  const expiry = state.user?.subscriptionExpiry
    ? new Date(state.user.subscriptionExpiry).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'the end of your billing period';
  if (!confirm(`Cancel your subscription?\n\nYou'll keep access until ${expiry}. No further charges after that.`)) return;

  const btn = document.getElementById('subscription-cancel-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }

  try {
    await api('POST', '/api/subscription/cancel');
    state.user.subscriptionStatus = 'non-renewing';
    applySubscriptionUI(state.user);
    showToast('Subscription cancelled. You have access until ' + expiry + '.');
  } catch (err) {
    showToast('Could not cancel: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Cancel subscription'; }
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
  const cancelBtn = document.getElementById('subscription-cancel-btn');
  const resubBtn  = document.getElementById('subscription-resubscribe-btn');
  const statusEl  = document.getElementById('subscription-status-text');
  const row       = document.getElementById('subscription-status-row');
  if (!row) return;

  if (!user.subscriptionExpiry) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');

  const expiryDate = new Date(user.subscriptionExpiry);
  const expiryStr  = expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const expired    = user.subscriptionExpiry <= Date.now() || user.subscriptionStatus === 'lapsed';

  if (!expired && user.subscriptionStatus === 'active') {
    statusEl.textContent = `Active · Renews ${expiryStr}`;
    if (cancelBtn) { cancelBtn.style.display = 'inline-flex'; cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel subscription'; }
    if (resubBtn)  resubBtn.style.display = 'none';
  } else if (!expired && user.subscriptionStatus === 'non-renewing') {
    statusEl.textContent = `Active until ${expiryStr} · Will not renew`;
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (resubBtn)  resubBtn.style.display = 'inline-flex';
  } else {
    statusEl.textContent = `Expired ${expiryStr}`;
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (resubBtn)  resubBtn.style.display = 'inline-flex';
  }
}


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
    renderMoodSection();
  } catch (err) { console.error('[loadEntries]', err.message); }
}

const FREE_ENTRY_LIMIT = 3;

function updateFreeEntryCounter() {
  const counter = document.getElementById('free-entry-counter');
  if (!counter) return;
  if (!state.user || state.user.paid) { counter.classList.add('hidden'); return; }
  const hasToday  = state.entries.some(e => e.date === getTodayISO());
  const remaining = Math.max(0, FREE_ENTRY_LIMIT - state.entries.length);
  if (hasToday || state.entries.length >= FREE_ENTRY_LIMIT) {
    counter.classList.add('hidden');
    return;
  }
  counter.classList.remove('hidden');
  counter.textContent = remaining === 1
    ? '1 free entry remaining — subscribe for unlimited'
    : `${remaining} of ${FREE_ENTRY_LIMIT} free entries remaining`;
}

async function saveEntry(text, mood) {
  const todayISO = getTodayISO();
  const hasToday = state.entries.some(e => e.date === todayISO);
  if (!hasToday && !state.user?.paid && state.entries.length >= FREE_ENTRY_LIMIT) {
    showPaymentWall();
    return;
  }
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

async function confirmClearHistory() {
  if (!window.confirm('Delete ALL your journal entries?\n\nThis cannot be undone.')) return;
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
    showToast('All entries have been cleared.');
  } catch (err) { showToast('Could not clear entries: ' + err.message); }
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
    submitBtn.disabled = false; submitBtn.textContent = 'Get Reflection Prompts →';
    return;
  }

  submitBtn.textContent = 'Generating…';
  const promptsSection = document.getElementById('prompts-section');
  promptsSection.classList.remove('hidden');
  promptsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await fetchReflectionPrompts(text);

  submitBtn.disabled = false; submitBtn.textContent = 'Get Reflection Prompts →';
});


/* ================================================================
   14. REFLECTION PROMPTS
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

  try {
    const data = await api('POST', '/api/reflect', { entry: entryText });
    if (!data) return;
    data.prompts.forEach(({ prompt, category }) => {
      const card = document.createElement('div');
      card.className = 'prompt-card';
      card.innerHTML = `
        <div class="prompt-category">${escapeHTML(category)}</div>
        <p class="prompt-text">${escapeHTML(prompt)}</p>`;
      grid.appendChild(card);
    });
    result.classList.remove('hidden');
    showToast('✦ Entry saved and prompts generated!');
  } catch (err) {
    error.textContent = `Couldn't get reflection prompts: ${err.message}`;
    error.classList.remove('hidden');
  } finally { loader.classList.add('hidden'); }
}


/* ================================================================
   15. WEEKLY INSIGHT  (Pro)
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
   16. GOALS  (Pro)
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
  const titleEl = document.getElementById('goal-title');
  const dateEl  = document.getElementById('goal-target-date');
  const descEl  = document.getElementById('goal-description');
  const btn     = document.getElementById('add-goal-btn');
  const title   = titleEl.value.trim();
  if (!title) { showToast('Please enter a goal title.'); return; }

  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const data = await api('POST', '/api/goals', { title, description: descEl.value.trim(), targetDate: dateEl.value || null });
    if (!data) return;
    state.goals.unshift(data.goal);
    renderGoals();
    titleEl.value = ''; dateEl.value = ''; descEl.value = '';
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
  if (!state.user || state.user.plan === 'pro') { note.classList.add('hidden'); return; }
  note.classList.remove('hidden');
  note.textContent = state.goals.length >= 1
    ? '1 free goal included · Subscribe for unlimited goals & AI check-ins'
    : 'Free trial: add 1 goal to try it out · Subscribe for unlimited';
}

function renderGoals() {
  updateGoalsTrialNote();
  const container = document.getElementById('goals-list');
  if (!state.goals.length) {
    container.innerHTML = `<div class="goals-empty"><p>No goals yet. Add your first goal above — your journal entries will help track your progress.</p></div>`;
    return;
  }
  container.innerHTML = '';
  state.goals.forEach(goal => {
    const isDone  = goal.status === 'completed';
    const dateStr = goal.targetDate ? `Target: ${formatTargetDate(goal.targetDate)}` : '';
    const card    = document.createElement('div');
    card.className = `goal-card${isDone ? ' goal-done' : ''}`;
    card.innerHTML = `
      <div class="goal-card-header">
        <div class="goal-card-info">
          <h3 class="goal-title-text">${escapeHTML(goal.title)}</h3>
          ${goal.description ? `<p class="goal-desc-text">${escapeHTML(goal.description)}</p>` : ''}
          <div class="goal-meta-row">
            <span class="goal-status-badge ${isDone ? 'done' : 'active'}">${isDone ? '✓ Completed' : '● Active'}</span>
            ${dateStr ? `<span class="goal-date-text">${escapeHTML(dateStr)}</span>` : ''}
          </div>
        </div>
        <div class="goal-card-actions">
          <button class="btn btn-sm btn-secondary" onclick="toggleGoalStatus('${goal.id}')">${isDone ? 'Reopen' : '✓ Complete'}</button>
          <button class="btn btn-sm btn-secondary" id="checkin-btn-${goal.id}" onclick="goalCheckin('${goal.id}')">🤖 Check in</button>
          <button class="btn btn-sm btn-ghost-danger" onclick="deleteGoal('${goal.id}')">Delete</button>
        </div>
      </div>
      <div class="goal-checkin-result hidden" id="checkin-out-${goal.id}"></div>`;
    container.appendChild(card);
  });
}


/* ================================================================
   17. HISTORY
================================================================ */
function renderHistory() {
  updateFreeEntryCounter();
  const container = document.getElementById('history-container');
  if (!state.entries.length) {
    container.innerHTML = `
      <div class="history-empty">
        <div class="history-empty-icon">📓</div>
        <p>No entries yet. Write your first entry above to get started!</p>
      </div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'history-list';

  state.entries.forEach(entry => {
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
let _selectedPayOpt = null;

function showFeedbackModal() { document.getElementById('feedback-modal')?.classList.remove('hidden'); }
function closeFeedbackModal() { document.getElementById('feedback-modal')?.classList.add('hidden'); }

function selectPayOpt(val) {
  _selectedPayOpt = val;
  document.querySelectorAll('.feedback-pay-btn').forEach(b => b.classList.toggle('selected', b.dataset.val === val));
}

async function submitFeedback(event) {
  event.preventDefault();
  const likes   = document.getElementById('fb-likes').value.trim();
  const improve = document.getElementById('fb-improve').value.trim();
  const errEl   = document.getElementById('feedback-error');
  const btn     = document.getElementById('feedback-submit-btn');

  errEl.classList.add('hidden');
  if (!likes && !improve && !_selectedPayOpt) {
    errEl.textContent = 'Please answer at least one question before submitting.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await api('POST', '/api/feedback', { likes, improve, wouldPay: _selectedPayOpt });
    closeFeedbackModal();
    showToast('Thanks for your feedback! 🙏');
    document.getElementById('fb-likes').value = '';
    document.getElementById('fb-improve').value = '';
    _selectedPayOpt = null;
    document.querySelectorAll('.feedback-pay-btn').forEach(b => b.classList.remove('selected'));
  } catch (err) {
    errEl.textContent = 'Could not send feedback: ' + err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Send Feedback →';
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
   24. BOOT
================================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initApp();
  initScrollReveal();
  initAutoResize(document.getElementById('journal-input'));
  await loadConfig();
  await initAuth();
  handleStripeReturn();
  maybeShowPwaBanner();
});

window.addEventListener('resize', () => {
  const moodEntries = state.entries.filter(e => e.mood);
  if (moodEntries.length) drawMoodChart(document.getElementById('mood-chart-canvas'), [...moodEntries].reverse().slice(-21));
});
