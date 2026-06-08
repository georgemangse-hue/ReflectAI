'use strict';

const http       = require('http');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const nodemailer   = require('nodemailer');
const PDFDocument  = require('pdfkit');

/* ================================================================
   .env loader
================================================================ */
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

/* ================================================================
   Configuration
================================================================ */
const PORT                = process.env.PORT || 3000;
const API_KEY             = process.env.ANTHROPIC_API_KEY;
const PAYSTACK_PUBLIC_KEY    = process.env.PAYSTACK_PUBLIC_KEY    || '';
const PAYSTACK_SECRET_KEY    = process.env.PAYSTACK_SECRET_KEY    || '';
const PAYSTACK_PLAN_CODE     = process.env.PAYSTACK_PLAN_CODE     || ''; // e.g. PLN_xxxxxxxx
const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY      || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_PRICE_ID        = process.env.STRIPE_PRICE_ID        || ''; // e.g. price_xxxxxxxx
const STRIPE_WEBHOOK_SECRET      = process.env.STRIPE_WEBHOOK_SECRET      || '';
const FLUTTERWAVE_PUBLIC_KEY     = process.env.FLUTTERWAVE_PUBLIC_KEY     || '';
const FLUTTERWAVE_SECRET_KEY     = process.env.FLUTTERWAVE_SECRET_KEY     || '';
const APP_URL                    = process.env.APP_URL                    || `http://localhost:${PORT}`;
const ADMIN_SECRET           = process.env.ADMIN_SECRET           || crypto.randomBytes(16).toString('hex');
const ADMIN_EMAIL            = (process.env.ADMIN_EMAIL || process.env.SMTP_USER || '').toLowerCase().trim();
const GMAIL_APP_PASSWORD     = process.env.GMAIL_APP_PASSWORD     || '';
const SMTP_USER              = process.env.SMTP_USER              || 'georgemangse@gmail.com';
const EMAIL_FROM_NAME        = process.env.EMAIL_FROM_NAME        || 'ReflectAI by PremierLEADZ';
const RESET_TTL              = 24 * 60 * 60 * 1000; // 24 hours
const TRIAL_DURATION_MS         = 30 * 24 * 60 * 60 * 1000; // 30 days
const FREE_GOAL_LIMIT           = 2;  // post-trial free tier: 2 active goals
const FREE_AI_EXCHANGES         = 3;  // post-trial free: 3 total exchanges (incl. initial reflect)

// ----------------------------------------------------------------
// African Cultural Context — proverbs, leader quotes, Nigerian themes
// Used to enrich weekly insights with one randomly selected entry.
// ----------------------------------------------------------------
const AFRICAN_QUOTES = [
  // African proverbs
  { text: "Until the lion tells its own story, the hunter will always be the hero.", source: "African proverb" },
  { text: "However long the night, the dawn will break.", source: "African proverb" },
  { text: "When spider webs unite, they can tie up a lion.", source: "Ethiopian proverb" },
  { text: "Knowledge is like a garden: if it is not cultivated, it cannot be harvested.", source: "African proverb" },
  { text: "If you want to go fast, go alone. If you want to go far, go together.", source: "African proverb" },
  { text: "The forest would be silent if no bird sang except the one that sang best.", source: "African proverb" },
  { text: "Rain does not fall on one roof alone.", source: "Cameroonian proverb" },
  { text: "He who learns, teaches.", source: "Ethiopian proverb" },
  { text: "A tree is straightened while it is young.", source: "African proverb" },
  { text: "A falling tree makes more noise than a growing forest.", source: "African proverb" },
  { text: "The one who tells the stories rules the world.", source: "African proverb" },
  { text: "A child who is not embraced by the village will burn it down to feel its warmth.", source: "African proverb" },
  { text: "Wisdom does not come overnight.", source: "Somali proverb" },
  { text: "When the music changes, so does the dance.", source: "Hausa proverb" },
  { text: "Even the mightiest eagle comes down to earth to drink.", source: "Nigerian proverb" },
  { text: "Be careful when a naked man offers you a shirt.", source: "Nigerian proverb" },
  { text: "The elder who stole yam could not rebuke a child for stealing crayfish.", source: "Igbo proverb" },
  { text: "When you follow in the path of your father, you learn to walk like him.", source: "Akan proverb" },
  { text: "A man who uses force is afraid of reasoning.", source: "Kenyan proverb" },
  { text: "Onye wetara oji wetara ndụ — He who brings kola brings life.", source: "Igbo proverb" },
  { text: "The best way to eat the elephant standing in your path is to cut it up into little pieces.", source: "African proverb" },
  { text: "Speak softly and carry a big stick; you will go far.", source: "West African proverb" },
  { text: "No matter how long the night, the day is sure to come.", source: "Congolese proverb" },
  { text: "The axe forgets, but the tree remembers.", source: "African proverb" },
  { text: "Do not look where you fell, but where you slipped.", source: "African proverb" },
  // Chinua Achebe
  { text: "The world is like a mask dancing. If you want to see it well, you do not stand in one place.", source: "Chinua Achebe, Arrow of God" },
  { text: "There is no story that is not true.", source: "Chinua Achebe, Things Fall Apart" },
  { text: "When suffering knocks at your door and you say there is no seat for him, he tells you not to worry because he has brought his own stool.", source: "Chinua Achebe, Arrow of God" },
  { text: "People create stories create people; or rather stories create people create stories.", source: "Chinua Achebe" },
  { text: "One of the truest tests of integrity is its blunt refusal to be compromised.", source: "Chinua Achebe" },
  { text: "A man who makes trouble for others is also making it for himself.", source: "Chinua Achebe, Things Fall Apart" },
  { text: "When old people speak it is not because of the sweetness of words in our mouths; it is because we see something which you do not see.", source: "Chinua Achebe, Things Fall Apart" },
  // Nelson Mandela
  { text: "It always seems impossible until it's done.", source: "Nelson Mandela" },
  { text: "Education is the most powerful weapon which you can use to change the world.", source: "Nelson Mandela" },
  { text: "Do not judge me by my successes, judge me by how many times I fell down and got back up again.", source: "Nelson Mandela" },
  { text: "I learned that courage was not the absence of fear, but the triumph over it.", source: "Nelson Mandela" },
  { text: "A winner is a dreamer who never gives up.", source: "Nelson Mandela" },
  { text: "The greatest glory in living lies not in never falling, but in rising every time we fall.", source: "Nelson Mandela" },
  { text: "Overcoming poverty is not a task of charity, it is an act of justice.", source: "Nelson Mandela" },
  // Chimamanda Ngozi Adichie
  { text: "The single story creates stereotypes, and the problem with stereotypes is not that they are untrue, but that they are incomplete.", source: "Chimamanda Ngozi Adichie" },
  { text: "Culture does not make people. People make culture.", source: "Chimamanda Ngozi Adichie" },
  { text: "I am a person who tires easily of anger and finds sadness more honest.", source: "Chimamanda Ngozi Adichie, Purple Hibiscus" },
  { text: "To accept your people and to love your people — even when they make you deeply uncomfortable — is to know yourself.", source: "Chimamanda Ngozi Adichie" },
  { text: "The most important thing about power is what you do when you have it.", source: "Chimamanda Ngozi Adichie" },
  { text: "Nne, sometimes life begins at the point of failure.", source: "Chimamanda Ngozi Adichie" },
  // Wole Soyinka
  { text: "The man dies in all who keep silent in the face of tyranny.", source: "Wole Soyinka" },
  { text: "A tiger does not proclaim its tigritude; it pounces.", source: "Wole Soyinka" },
  { text: "Books and all forms of writing are terror to those who wish to suppress the truth.", source: "Wole Soyinka" },
  { text: "We must shed the habit of talking about what we know. The time has come for us to know what we talk about.", source: "Wole Soyinka" },
  { text: "Mediocrity is the greatest threat to the growth of any nation.", source: "Wole Soyinka" },
];

function getRandomAfricanQuote() {
  return AFRICAN_QUOTES[Math.floor(Math.random() * AFRICAN_QUOTES.length)];
}

// In-memory demo rate limiter — 5 prompts per IP per hour (resets on server restart)
const demoRateLimit   = new Map();
const DEMO_HOUR_LIMIT = 5;
const DEMO_WINDOW_MS  = 60 * 60 * 1000;

function checkDemoRate(ip) {
  const now   = Date.now();
  const entry = demoRateLimit.get(ip);
  if (!entry || now - entry.ts >= DEMO_WINDOW_MS) {
    demoRateLimit.set(ip, { count: 1, ts: now });
    return true;
  }
  if (entry.count >= DEMO_HOUR_LIMIT) return false;
  entry.count++;
  return true;
}
const PUBLIC              = path.join(__dirname, 'public');

const DATA_DIR       = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE     = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE  = path.join(DATA_DIR, 'sessions.json');
const RESETS_FILE    = path.join(DATA_DIR, 'password_resets.json');
const REFERRALS_FILE = path.join(DATA_DIR, 'referrals.json');
const ENTRIES_DIR    = path.join(DATA_DIR, 'entries');
const GOALS_DIR      = path.join(DATA_DIR, 'goals');
const FEEDBACK_FILE           = path.join(DATA_DIR, 'feedback.json');
const FEEDBACK_RESPONSES_FILE = path.join(DATA_DIR, 'feedback_responses.json');
const MOOD_LOGS_DIR           = path.join(DATA_DIR, 'mood_logs');
const WEEKLY_INSIGHTS_DIR     = path.join(DATA_DIR, 'weekly_insights');

/* ================================================================
   Bootstrap
================================================================ */
;[DATA_DIR, ENTRIES_DIR, GOALS_DIR, MOOD_LOGS_DIR, WEEKLY_INSIGHTS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
if (!fs.existsSync(USERS_FILE))    fs.writeFileSync(USERS_FILE,    '[]');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]');
if (!fs.existsSync(RESETS_FILE))     fs.writeFileSync(RESETS_FILE,     '[]');
if (!fs.existsSync(REFERRALS_FILE)) fs.writeFileSync(REFERRALS_FILE, '[]');
if (!fs.existsSync(FEEDBACK_FILE))           fs.writeFileSync(FEEDBACK_FILE,           '[]');
if (!fs.existsSync(FEEDBACK_RESPONSES_FILE)) fs.writeFileSync(FEEDBACK_RESPONSES_FILE, '[]');

// Migration: ensure every user has a trial_start_date
// - Paid Pro users: set to createdAt (irrelevant since getUserAccessLevel returns 'pro' first)
// - Free users without a date: set to now, giving them 30 days from today
(function migrateTrialDates() {
  const users   = readJSON(USERS_FILE);
  const now     = Date.now();
  let changed   = 0;
  users.forEach(u => {
    if (!u.trial_start_date) {
      u.trial_start_date = u.paid ? (u.createdAt || now) : now;
      changed++;
    }
  });
  if (changed > 0) {
    writeJSON(USERS_FILE, users);
    console.log(`  ✔  Migrated trial_start_date for ${changed} user(s)`);
  }
}());

// One-time migration: copy old feedback.json records into feedback_responses.json
(function migrateOldFeedback() {
  const PAY_MAP = {
    yes:   'Yes, if it helps me grow',
    maybe: 'Maybe — depends on price',
    no:    "No — I'd want it free",
  };
  const old  = readJSON(FEEDBACK_FILE);
  if (!old.length) return;
  const dest = readJSON(FEEDBACK_RESPONSES_FILE);
  const existingIds = new Set(dest.map(r => r.id));
  let migrated = 0;
  for (const f of old) {
    if (existingIds.has(f.id)) continue; // already migrated
    dest.push({
      id:        f.id,
      userId:    f.userId  || null,
      email:     f.email   || null,
      q1: null, q2: null, q3: null, q4: null, q5: null,
      q6: PAY_MAP[f.wouldPay] || null,
      q7: null,
      q8: (f.likes   || '').trim() || null,
      q9: (f.improve || '').trim() || null,
      createdAt: f.createdAt || Date.now(),
      migratedFrom: 'feedback.json',
    });
    migrated++;
  }
  if (migrated > 0) {
    writeJSON(FEEDBACK_RESPONSES_FILE, dest);
    console.log(`  ✔  Migrated ${migrated} old feedback record(s) into feedback_responses.json`);
  }
}());

/* ================================================================
   JSON helpers
================================================================ */
function readJSON(filePath, fallback = []) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}
const entriesFile      = uid => path.join(ENTRIES_DIR,      `${uid}.json`);
const goalsFile        = uid => path.join(GOALS_DIR,        `${uid}.json`);
const moodLogsFile     = uid => path.join(MOOD_LOGS_DIR,    `${uid}.json`);
const weeklyInsightFile = uid => path.join(WEEKLY_INSIGHTS_DIR, `${uid}.json`);

const VALID_QUICK_MOODS = ['awful', 'meh', 'okay', 'good', 'great'];

/* ================================================================
   Crypto / auth helpers
================================================================ */
const generateId    = () => crypto.randomBytes(16).toString('hex');
const generateToken = () => crypto.randomBytes(32).toString('hex');

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120_000, 64, 'sha512').toString('hex');
}

function verifyPaystackSignature(rawBody, signature) {
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(rawBody).digest('hex');
  return hash === signature;
}

function stripeFormEncode(obj, prefix) {
  const parts = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (item !== null && typeof item === 'object')
          parts.push(stripeFormEncode(item, `${k}[${i}]`));
        else
          parts.push(`${encodeURIComponent(`${k}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (typeof val === 'object') {
      parts.push(stripeFormEncode(val, k));
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(val)}`);
    }
  }
  return parts.join('&');
}

function stripeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? stripeFormEncode(body) : null;
    const auth    = Buffer.from(STRIPE_SECRET_KEY + ':').toString('base64');
    const options = {
      hostname: 'api.stripe.com',
      path,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Could not parse Stripe response')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function verifyStripeSignature(rawBody, header) {
  if (!STRIPE_WEBHOOK_SECRET || !header) return !STRIPE_WEBHOOK_SECRET;
  const parts = {};
  header.split(',').forEach(p => {
    const eq = p.indexOf('=');
    if (eq !== -1) parts[p.slice(0, eq)] = p.slice(eq + 1);
  });
  const ts = parts['t'], v1 = parts['v1'];
  if (!ts || !v1) return false;
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(`${ts}.${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex')); }
  catch { return false; }
}

/* ================================================================
   Session helpers
================================================================ */
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

function getSessionUser(req) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) return null;
  const token   = header.slice(7);
  const session = readJSON(SESSIONS_FILE).find(s => s.token === token && s.expiresAt > Date.now());
  if (!session) return null;
  return readJSON(USERS_FILE).find(u => u.id === session.userId) || null;
}

function requireAuth(req, res) {
  const user = getSessionUser(req);
  if (!user) { sendJSON(res, 401, { error: 'Please log in to continue.' }); return null; }
  return user;
}

/* ================================================================
   Subscription-aware access check
================================================================ */
function isSubscriptionActive(user) {
  if (!user.paid) return false;
  if (!user.subscriptionExpiry) return true; // legacy one-time payers keep access
  if (user.subscriptionStatus === 'lapsed') return false;
  return user.subscriptionExpiry > Date.now();  // active OR non-renewing (not yet expired)
}

// Returns 'pro' | 'trial' | 'free'
// - 'pro':   active paid subscription
// - 'trial': within 30-day free trial window (full Pro access)
// - 'free':  trial expired, no active subscription (limited access)
function getUserAccessLevel(user) {
  if (isSubscriptionActive(user)) return 'pro';
  const trialStart = user.trial_start_date || user.createdAt || 0;
  if (trialStart && Date.now() < trialStart + TRIAL_DURATION_MS) return 'trial';
  return 'free';
}

function requireAdmin(req, res) {
  const header = req.headers['authorization'];
  const key    = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!key || key !== ADMIN_SECRET) {
    sendJSON(res, 401, { error: 'Admin access required.' });
    return false;
  }
  return true;
}

function requirePaid(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!isSubscriptionActive(user)) {
    const code = (user.paid && user.subscriptionExpiry) ? 'SUBSCRIPTION_EXPIRED' : 'PAYMENT_REQUIRED';
    sendJSON(res, 403, { error: 'An active subscription is required.', code });
    return null;
  }
  return user;
}

function requirePro(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  const level = getUserAccessLevel(user);
  if (level === 'free') {
    sendJSON(res, 403, { error: 'This feature requires a Pro plan or an active trial.', code: 'PRO_REQUIRED' });
    return null;
  }
  return user;
}

/* ================================================================
   User helpers
================================================================ */
function userShape(u) {
  const trialStart  = u.trial_start_date || u.createdAt || 0;
  const trialEnd    = trialStart + TRIAL_DURATION_MS;
  const accessLevel = getUserAccessLevel(u);
  return {
    id:                 u.id,
    email:              u.email,
    firstName:          u.firstName || null,
    lastName:           u.lastName  || null,
    plan:               u.plan,
    paid:               u.paid === true,
    subscriptionStatus: u.subscriptionStatus  || null,
    subscriptionExpiry: u.subscriptionExpiry  || null,
    createdAt:          u.createdAt,
    trial_start_date:   trialStart,
    trial_end_date:     trialEnd,
    access_level:       accessLevel   // 'pro' | 'trial' | 'free'
  };
}

function updateUser(userId, updates) {
  const users = readJSON(USERS_FILE);
  const idx   = users.findIndex(u => u.id === userId);
  if (idx === -1) return null;
  Object.assign(users[idx], updates);
  writeJSON(USERS_FILE, users);
  return users[idx];
}

function findUserByEmail(email) {
  return readJSON(USERS_FILE).find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

/* ================================================================
   Streak
================================================================ */
function computeStreak(entries) {
  if (!entries.length) return 0;
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().split('T')[0]; })();
  const dates     = [...new Set(entries.map(e => e.date))].sort().reverse();
  if (dates[0] !== today && dates[0] !== yesterday) return 0;
  let streak = 0, expected = dates[0];
  for (const date of dates) {
    if (date !== expected) break;
    streak++;
    const d = new Date(expected + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    expected = d.toISOString().split('T')[0];
  }
  return streak;
}

/* ================================================================
   MIME types
================================================================ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

/* ================================================================
   HTTP helpers
================================================================ */
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

/* ================================================================
   External API helpers
================================================================ */
function paystackRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.paystack.co',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        console.log(`[Paystack] ${method} ${path} → HTTP ${res.statusCode}`);
        console.log('[Paystack] raw response:', raw);
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Could not parse Paystack response')); }
      });
    });
    req.on('error', err => {
      console.error('[Paystack] network error:', err.message);
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

const verifyPaystackTransaction  = ref  => paystackRequest('GET', `/transaction/verify/${encodeURIComponent(ref)}`);
const getPaystackSubscription    = code => paystackRequest('GET', `/subscription/${encodeURIComponent(code)}`);
const disablePaystackSubscription = (code, token) =>
  paystackRequest('POST', '/subscription/disable', { code, token });

function callClaude(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, system: systemPrompt, messages });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) reject(new Error(parsed.error?.message || `Anthropic error ${res.statusCode}`));
          else resolve(parsed);
        } catch { reject(new Error('Could not parse Anthropic response')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendEmail(to, subject, html) {
  if (!GMAIL_APP_PASSWORD) {
    console.log(`[email] No GMAIL_APP_PASSWORD — skipping send to ${to} | subject: ${subject}`);
    return Promise.resolve({ dev: true });
  }
  const transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false, // STARTTLS
    auth:   { user: SMTP_USER, pass: GMAIL_APP_PASSWORD }
  });
  return transporter.sendMail({
    from:    `"${EMAIL_FROM_NAME}" <${SMTP_USER}>`,
    to,
    subject,
    html
  });
}

function sendSubscriptionConfirmationEmail(email, expiry) {
  const expiryStr = expiry
    ? new Date(expiry).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const year = new Date().getFullYear();
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f7f4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f4;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
      <tr>
        <td style="background:#3a8f65;padding:28px 40px;text-align:center;">
          <span style="font-size:22px;vertical-align:middle;">🌿</span>
          <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;vertical-align:middle;">&nbsp;ReflectAI</span>
          <p style="color:#c8e6d8;font-size:13px;margin:6px 0 0;letter-spacing:0.02em;">Learn | Grow | Succeed</p>
        </td>
      </tr>
      <tr>
        <td style="padding:40px 40px 32px;">
          <h1 style="color:#1a2e24;font-size:22px;font-weight:700;margin:0 0 12px;line-height:1.3;">You're now a Pro member 🎉</h1>
          <p style="color:#4a5e52;font-size:15px;line-height:1.7;margin:0 0 20px;">Thank you for subscribing to ReflectAI Pro. Your account has been upgraded and all Pro features are now unlocked.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;width:100%;">
            <tr><td style="background:#f4f7f4;border-radius:8px;padding:16px 20px;">
              <p style="color:#3a8f65;font-size:13px;font-weight:700;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.08em;">What's included in Pro</p>
              <p style="color:#4a5e52;font-size:14px;line-height:1.7;margin:0;">
                ✓ &nbsp;Unlimited journal entries<br/>
                ✓ &nbsp;Extended coaching sessions (10 exchanges)<br/>
                ✓ &nbsp;Unlimited weekly insights<br/>
                ✓ &nbsp;Unlimited goals &amp; AI check-ins
              </p>
            </td></tr>
          </table>
          ${expiryStr ? `<p style="color:#8a9e92;font-size:13px;line-height:1.6;margin:0 0 24px;">Your subscription renews on <strong>${expiryStr}</strong>.</p>` : ''}
          <table cellpadding="0" cellspacing="0">
            <tr><td style="background:#3a8f65;border-radius:8px;">
              <a href="${APP_URL}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">Open ReflectAI →</a>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e8f0eb;margin:0;"/></td></tr>
      <tr>
        <td style="padding:24px 40px 32px;">
          <p style="color:#4a5e52;font-size:13px;line-height:1.6;margin:0;">
            Warm regards,<br/>
            <strong>The ReflectAI Team</strong><br/>
            <span style="color:#8a9e92;">PremierLEADZ Consulting Ltd</span>
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#f4f7f4;padding:16px 40px;text-align:center;border-top:1px solid #e8f0eb;">
          <p style="color:#b0bdb4;font-size:11px;margin:0;line-height:1.5;">
            © ${year} PremierLEADZ Consulting Ltd · ReflectAI<br/>
            This is an automated message — please do not reply to this email.
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  return sendEmail(email, 'Welcome to ReflectAI Pro 🎉', html).catch(err =>
    console.error('[email] subscription confirmation failed:', err.message)
  );
}

/* ================================================================
   REFERRAL HELPERS
================================================================ */
function generateReferralCode() {
  const chars  = 'abcdefghjkmnpqrstuvwxyz23456789'; // no confusable chars
  const taken  = new Set(readJSON(USERS_FILE).map(u => u.referralCode).filter(Boolean));
  let code;
  do {
    const bytes = crypto.randomBytes(6);
    code = Array.from(bytes).map(b => chars[b % chars.length]).join('');
  } while (taken.has(code));
  return code;
}

function sendReferralNotificationEmail(to, friendName) {
  const year = new Date().getFullYear();
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f7f4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f4;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
      <tr>
        <td style="background:#3a8f65;padding:28px 40px;text-align:center;">
          <span style="font-size:22px;vertical-align:middle;">🌿</span>
          <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;vertical-align:middle;">&nbsp;ReflectAI</span>
          <p style="color:#c8e6d8;font-size:13px;margin:6px 0 0;letter-spacing:0.02em;">Learn | Grow | Succeed</p>
        </td>
      </tr>
      <tr>
        <td style="padding:40px 40px 32px;">
          <h1 style="color:#1a2e24;font-size:22px;font-weight:700;margin:0 0 12px;">Great news! 🎉</h1>
          <p style="color:#4a5e52;font-size:15px;line-height:1.7;margin:0 0 20px;">
            <strong>${friendName}</strong> just joined ReflectAI using your referral link. One free month has been added to your account!
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;width:100%;">
            <tr><td style="background:#f4f7f4;border-radius:8px;padding:16px 20px;text-align:center;">
              <p style="color:#3a8f65;font-size:32px;font-weight:700;margin:0 0 4px;">+1 month free</p>
              <p style="color:#8a9e92;font-size:13px;margin:0;">added to your ReflectAI subscription</p>
            </td></tr>
          </table>
          <p style="color:#4a5e52;font-size:14px;line-height:1.7;margin:0 0 24px;">Keep sharing your referral link to earn more — up to 3 free months per year.</p>
          <table cellpadding="0" cellspacing="0">
            <tr><td style="background:#3a8f65;border-radius:8px;">
              <a href="${APP_URL}/referral.html" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">View my referrals →</a>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e8f0eb;margin:0;"/></td></tr>
      <tr>
        <td style="padding:24px 40px 32px;">
          <p style="color:#4a5e52;font-size:13px;line-height:1.6;margin:0;">
            Warm regards,<br/>
            <strong>The ReflectAI Team</strong><br/>
            <span style="color:#8a9e92;">PremierLEADZ Consulting Ltd</span>
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#f4f7f4;padding:16px 40px;text-align:center;border-top:1px solid #e8f0eb;">
          <p style="color:#b0bdb4;font-size:11px;margin:0;line-height:1.5;">
            © ${year} PremierLEADZ Consulting Ltd · ReflectAI<br/>
            This is an automated message — please do not reply to this email.
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  return sendEmail(to, `${friendName} just joined ReflectAI using your link 🎉`, html);
}

async function applyReferralCredit(paidUser) {
  if (!paidUser.referredBy) return;

  const referrals = readJSON(REFERRALS_FILE);
  const idx = referrals.findIndex(r => r.referredUserId === paidUser.id && !r.convertedAt);
  if (idx === -1) return; // no pending referral record

  const referrer = readJSON(USERS_FILE).find(u => u.id === paidUser.referredBy);
  if (!referrer || referrer.id === paidUser.id) return; // self-referral guard

  // Yearly cap: max 12 credits per calendar year
  const year = String(new Date().getFullYear());
  const yearlyCount = referrer.referralCreditYearlyCount?.[year] || 0;
  if (yearlyCount >= 3) {
    console.log(`[referral] ${referrer.email} has hit the 3-credit yearly cap`);
    return;
  }

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const now         = Date.now();

  // Credit the referrer: extend their subscription by 30 days
  const referrerExpiry = Math.max(referrer.subscriptionExpiry || now, now) + THIRTY_DAYS;
  updateUser(referrer.id, {
    plan:               'pro',
    paid:               true,
    subscriptionStatus: (referrer.paid && referrer.subscriptionStatus === 'active') ? 'active' : 'active',
    subscriptionExpiry: referrerExpiry,
    referralCredits:    (referrer.referralCredits || 0) + 1,
    referralCreditYearlyCount: { ...(referrer.referralCreditYearlyCount || {}), [year]: yearlyCount + 1 }
  });

  // Mark referral as converted
  referrals[idx].convertedAt      = now;
  referrals[idx].creditedReferrer = true;
  referrals[idx].creditedReferred = true;
  writeJSON(REFERRALS_FILE, referrals);

  // Notify the referrer by email
  const handle     = paidUser.email.split('@')[0].split(/[._-]/)[0].slice(0, 20);
  const friendName = handle.charAt(0).toUpperCase() + handle.slice(1);
  sendReferralNotificationEmail(referrer.email, friendName)
    .catch(err => console.error('[referral] notification email failed:', err.message));

  console.log(`[referral] Credited: referrer=${referrer.email}, referred=${paidUser.email}`);
}

const VALID_MOODS = ['motivated', 'happy', 'grateful', 'tired', 'anxious', 'sad', 'overwhelmed'];

/* ================================================================
   MAIN SERVER
================================================================ */
const server = http.createServer(async (req, res) => {
  const url    = req.url.split('?')[0];
  const method = req.method.toUpperCase();

  res.on('finish', () => {
    if (res.statusCode >= 400) console.error(`${res.statusCode} ${method} ${req.url}`);
  });

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {

    /* ==============================================================
       CONFIG
    ============================================================== */
    /* ==============================================================
       ADMIN
    ============================================================== */
    if (method === 'GET' && url === '/api/admin/users') {
      if (!requireAdmin(req, res)) return;
      const users    = readJSON(USERS_FILE);
      const sessions = readJSON(SESSIONS_FILE);
      const now      = Date.now();
      const rows  = users.map(u => {
        const entries    = readJSON(entriesFile(u.id));
        const lastEntry  = entries.reduce((max, e) => Math.max(max, e.createdAt || 0), 0);
        const userSessions = sessions.filter(s => s.userId === u.id);
        const lastSession  = userSessions.reduce((max, s) => Math.max(max, s.expiresAt - SESSION_TTL), 0);
        const lastActive   = Math.max(lastEntry, lastSession) || null;
        const accessLevel  = getUserAccessLevel(u);
        const trialStart   = u.trial_start_date || u.createdAt || 0;
        const trialEnd     = trialStart + TRIAL_DURATION_MS;
        const trialDaysLeft = accessLevel === 'trial'
          ? Math.max(0, Math.ceil((trialEnd - now) / 86400000))
          : 0;
        return {
          id:                 u.id,
          email:              u.email,
          firstName:          u.firstName || null,
          lastName:           u.lastName  || null,
          plan:               u.plan,
          paid:               u.paid === true,
          subscriptionStatus: u.subscriptionStatus  || null,
          subscriptionExpiry: u.subscriptionExpiry  || null,
          subscriptionCode:   u.subscriptionCode    || null,
          entryCount:         entries.length,
          createdAt:          u.createdAt,
          lastActive:         lastActive || u.createdAt,
          access_level:       accessLevel,
          trial_start_date:   trialStart || null,
          trial_end_date:     trialEnd   || null,
          trialDaysLeft
        };
      });
      // Trial stats
      const allUsers = readJSON(USERS_FILE);
      const trialUsers = allUsers.filter(u => {
        if (u.paid && isSubscriptionActive(u)) return false; // skip paying users
        const ts = u.trial_start_date || u.createdAt || 0;
        return ts && Date.now() < ts + TRIAL_DURATION_MS;
      });
      const trialDaysRemaining = trialUsers.length
        ? trialUsers.reduce((sum, u) => {
            const ts  = u.trial_start_date || u.createdAt || Date.now();
            const rem = Math.max(0, Math.ceil((ts + TRIAL_DURATION_MS - Date.now()) / 86400000));
            return sum + rem;
          }, 0) / trialUsers.length
        : 0;
      const postTrialFree = allUsers.filter(u => {
        if (u.paid && isSubscriptionActive(u)) return false;
        const ts = u.trial_start_date || u.createdAt || 0;
        return !ts || Date.now() >= ts + TRIAL_DURATION_MS;
      });
      const paidCount  = rows.filter(u => u.paid && (!u.subscriptionExpiry || (u.subscriptionStatus === 'active' && u.subscriptionExpiry > now))).length;
      const conversion = trialUsers.length + paidCount > 0
        ? Math.round((paidCount / (trialUsers.length + paidCount + postTrialFree.length)) * 100)
        : 0;

      const stats = {
        total:           rows.length,
        active:          paidCount,
        nonRenewing:     rows.filter(u => u.subscriptionStatus === 'non-renewing' && (u.subscriptionExpiry || 0) > now).length,
        expired:         rows.filter(u => u.paid && u.subscriptionExpiry && u.subscriptionExpiry <= now).length,
        free:            rows.filter(u => !u.paid).length,
        onTrial:         trialUsers.length,
        trialDaysAvg:    Math.round(trialDaysRemaining),
        postTrialFree:   postTrialFree.length,
        conversionRate:  conversion
      };
      return sendJSON(res, 200, { users: rows, stats });
    }

    if (method === 'PATCH' && url.startsWith('/api/admin/users/')) {
      if (!requireAdmin(req, res)) return;
      const userId = url.slice('/api/admin/users/'.length);
      if (!userId) return sendJSON(res, 400, { error: 'Missing user ID.' });
      const { plan } = await readBody(req);
      if (plan !== 'free' && plan !== 'pro')
        return sendJSON(res, 400, { error: 'plan must be "free" or "pro".' });

      const users = readJSON(USERS_FILE);
      const user  = users.find(u => u.id === userId);
      if (!user) return sendJSON(res, 404, { error: 'User not found.' });

      if (plan === 'pro') {
        Object.assign(user, { plan: 'pro', paid: true, subscriptionStatus: 'active', subscriptionExpiry: null });
      } else {
        Object.assign(user, { plan: 'free', paid: false, subscriptionStatus: null, subscriptionExpiry: null });
      }
      writeJSON(USERS_FILE, users);
      return sendJSON(res, 200, { user: userShape(user) });
    }

    if (method === 'DELETE' && url === '/api/admin/users') {
      if (!requireAdmin(req, res)) return;
      const { ids } = await readBody(req);
      if (!Array.isArray(ids) || !ids.length)
        return sendJSON(res, 400, { error: 'No user IDs provided.' });

      const users = readJSON(USERS_FILE);
      const toDelete = users.filter(u => ids.includes(u.id));

      // Guard: admin email
      if (ADMIN_EMAIL) {
        const adminUser = toDelete.find(u => u.email.toLowerCase() === ADMIN_EMAIL);
        if (adminUser) return sendJSON(res, 403, { error: 'You cannot delete the admin account.' });
      }

      // Guard: paying subscribers
      const now = Date.now();
      const paidUsers = toDelete.filter(u => {
        if (!u.paid) return false;
        if (!u.subscriptionExpiry) return true; // lifetime
        return u.subscriptionExpiry > now;       // active or non-renewing
      });
      if (paidUsers.length)
        return sendJSON(res, 403, {
          error: `${paidUsers.length} selected user(s) are active subscribers. Remove them from selection before deleting.`
        });

      const deleteIds = new Set(toDelete.map(u => u.id));

      // Remove from users file
      writeJSON(USERS_FILE, users.filter(u => !deleteIds.has(u.id)));

      // Remove sessions
      const sessions = readJSON(SESSIONS_FILE);
      writeJSON(SESSIONS_FILE, sessions.filter(s => !deleteIds.has(s.userId)));

      // Remove per-user data files
      for (const uid of deleteIds) {
        [entriesFile(uid), goalsFile(uid), moodLogsFile(uid), weeklyInsightFile(uid)].forEach(f => {
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
        });
      }

      return sendJSON(res, 200, { deleted: deleteIds.size });
    }

    if (method === 'GET' && url === '/api/config') {
      return sendJSON(res, 200, {
        paystackPublicKey:     PAYSTACK_PUBLIC_KEY,
        paystackPlanCode:      PAYSTACK_PLAN_CODE,
        stripePublishableKey:  STRIPE_PUBLISHABLE_KEY,
        flutterwavePublicKey:  FLUTTERWAVE_PUBLIC_KEY
      });
    }

    /* ==============================================================
       AUTH
    ============================================================== */
    if (method === 'POST' && url === '/api/auth/signup') {
      const { email, password, referralCode: inboundRefCode } = await readBody(req);
      if (!email || !email.includes('@') || !email.includes('.'))
        return sendJSON(res, 400, { error: 'Please enter a valid email address.' });
      if (!password || password.length < 8)
        return sendJSON(res, 400, { error: 'Password must be at least 8 characters.' });

      const users = readJSON(USERS_FILE);
      if (users.find(u => u.email.toLowerCase() === email.toLowerCase().trim()))
        return sendJSON(res, 409, { error: 'An account with this email already exists.' });

      // Resolve referrer (must exist, must not be same email)
      const referrer = inboundRefCode
        ? users.find(u => u.referralCode === inboundRefCode && u.email.toLowerCase() !== email.toLowerCase().trim())
        : null;

      const salt = crypto.randomBytes(32).toString('hex');
      const now  = Date.now();
      const user = {
        id: generateId(), email: email.toLowerCase().trim(),
        passwordHash: hashPassword(password, salt), salt,
        plan: 'free', paid: false, createdAt: now,
        trial_start_date: now,   // 30-day Pro trial starts immediately
        referralCode:   generateReferralCode(),
        referredBy:     referrer?.id || null,
        referralCredits: 0
      };
      users.push(user);
      writeJSON(USERS_FILE, users);

      // Create pending referral record
      if (referrer) {
        const referrals = readJSON(REFERRALS_FILE);
        referrals.push({
          id: generateId(), referrerId: referrer.id,
          referredUserId: user.id, referredEmail: user.email,
          signedUpAt: Date.now(), convertedAt: null,
          creditedReferrer: false, creditedReferred: false
        });
        writeJSON(REFERRALS_FILE, referrals);
      }

      const token = generateToken();
      const sessions = readJSON(SESSIONS_FILE);
      sessions.push({ token, userId: user.id, expiresAt: Date.now() + SESSION_TTL });
      writeJSON(SESSIONS_FILE, sessions);

      return sendJSON(res, 201, { token, user: userShape(user) });
    }

    if (method === 'POST' && url === '/api/auth/login') {
      const { email, password } = await readBody(req);
      if (!email || !password)
        return sendJSON(res, 400, { error: 'Email and password are required.' });

      const users = readJSON(USERS_FILE);
      const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
      if (!user || hashPassword(password, user.salt) !== user.passwordHash)
        return sendJSON(res, 401, { error: 'Incorrect email or password.' });

      const token    = generateToken();
      const sessions = readJSON(SESSIONS_FILE).filter(s => s.userId !== user.id || s.expiresAt > Date.now());
      sessions.push({ token, userId: user.id, expiresAt: Date.now() + SESSION_TTL });
      writeJSON(SESSIONS_FILE, sessions);

      return sendJSON(res, 200, { token, user: userShape(user) });
    }

    if (method === 'POST' && url === '/api/auth/logout') {
      const header = req.headers['authorization'];
      const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;
      if (token) writeJSON(SESSIONS_FILE, readJSON(SESSIONS_FILE).filter(s => s.token !== token));
      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'POST' && url === '/api/auth/forgot-password') {
      const { email } = await readBody(req);
      // Always return 200 — never reveal whether an email exists
      if (email) {
        const user = findUserByEmail(email);
        if (user) {
          const resets = readJSON(RESETS_FILE).filter(r => r.userId !== user.id || r.expiresAt > Date.now());
          const token  = generateToken();
          resets.push({ token, userId: user.id, email: user.email, expiresAt: Date.now() + RESET_TTL });
          writeJSON(RESETS_FILE, resets);

          const resetUrl = `${APP_URL}/reset.html?token=${token}`;
          console.log(`[forgot-password] Reset link for ${user.email}: ${resetUrl}`);

          const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f7f4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f4;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

      <!-- Header / Logo -->
      <tr>
        <td style="background:#3a8f65;padding:28px 40px;text-align:center;">
          <div style="display:inline-block;">
            <span style="font-size:22px;vertical-align:middle;">🌿</span>
            <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;vertical-align:middle;">&nbsp;ReflectAI</span>
          </div>
          <p style="color:#c8e6d8;font-size:13px;margin:6px 0 0;letter-spacing:0.02em;">Learn | Grow | Succeed</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:40px 40px 32px;">
          <h1 style="color:#1a2e24;font-size:22px;font-weight:700;margin:0 0 12px;line-height:1.3;">Reset your password</h1>
          <p style="color:#4a5e52;font-size:15px;line-height:1.7;margin:0 0 28px;">
            You requested a password reset for your ReflectAI account. Click the button below to set a new password. This link expires in <strong>24 hours</strong>.
          </p>

          <!-- CTA Button -->
          <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr>
              <td style="background:#3a8f65;border-radius:8px;">
                <a href="${resetUrl}"
                   style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.01em;border-radius:8px;">
                  Reset my password
                </a>
              </td>
            </tr>
          </table>

          <!-- Fallback link -->
          <p style="color:#8a9e92;font-size:12px;line-height:1.6;margin:0 0 4px;">Button not working? Copy and paste this link into your browser:</p>
          <p style="margin:0;"><a href="${resetUrl}" style="color:#3a8f65;font-size:12px;word-break:break-all;">${resetUrl}</a></p>
        </td>
      </tr>

      <!-- Divider -->
      <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e8f0eb;margin:0;"/></td></tr>

      <!-- Footer note -->
      <tr>
        <td style="padding:24px 40px 16px;">
          <p style="color:#8a9e92;font-size:13px;line-height:1.65;margin:0;">
            If you didn't request this reset, please ignore this email. Your account is safe.
          </p>
        </td>
      </tr>

      <!-- Sign-off -->
      <tr>
        <td style="padding:0 40px 32px;">
          <p style="color:#4a5e52;font-size:13px;line-height:1.6;margin:0;">
            Warm regards,<br/>
            <strong>The ReflectAI Team</strong><br/>
            <span style="color:#8a9e92;">PremierLEADZ Consulting Ltd</span>
          </p>
        </td>
      </tr>

      <!-- Bottom bar -->
      <tr>
        <td style="background:#f4f7f4;padding:16px 40px;text-align:center;border-top:1px solid #e8f0eb;">
          <p style="color:#b0bdb4;font-size:11px;margin:0;line-height:1.5;">
            © ${new Date().getFullYear()} PremierLEADZ Consulting Ltd · ReflectAI<br/>
            This is an automated message — please do not reply to this email.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

          try { await sendEmail(user.email, 'Reset your ReflectAI password', html); }
          catch (err) { console.error('[forgot-password] email send failed:', err.message); }
        }
      }
      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'GET' && url.startsWith('/api/auth/validate-reset-token')) {
      const qs    = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
      const token = new URLSearchParams(qs).get('token');
      if (!token) return sendJSON(res, 400, { valid: false, error: 'Token is required.' });
      const reset = readJSON(RESETS_FILE).find(r => r.token === token && r.expiresAt > Date.now());
      if (!reset)  return sendJSON(res, 400, { valid: false, error: 'This reset link is invalid or has expired.' });
      return sendJSON(res, 200, { valid: true, email: reset.email });
    }

    if (method === 'POST' && url === '/api/auth/reset-password') {
      const { token, password } = await readBody(req);
      if (!token || !password)
        return sendJSON(res, 400, { error: 'Token and new password are required.' });
      if (password.length < 8)
        return sendJSON(res, 400, { error: 'Password must be at least 8 characters.' });

      const resets = readJSON(RESETS_FILE);
      const idx    = resets.findIndex(r => r.token === token && r.expiresAt > Date.now());
      if (idx === -1) return sendJSON(res, 400, { error: 'This reset link is invalid or has expired.' });

      const { userId } = resets[idx];
      const salt = crypto.randomBytes(32).toString('hex');
      updateUser(userId, { passwordHash: hashPassword(password, salt), salt });

      // Consume the token and invalidate all sessions for this user
      resets.splice(idx, 1);
      writeJSON(RESETS_FILE, resets);
      writeJSON(SESSIONS_FILE, readJSON(SESSIONS_FILE).filter(s => s.userId !== userId));

      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'GET' && url === '/api/referral') {
      const user = requireAuth(req, res);
      if (!user) return;

      // Generate code on-the-fly for users who signed up before this feature
      let code = user.referralCode;
      if (!code) {
        code = generateReferralCode();
        updateUser(user.id, { referralCode: code });
      }

      const referrals  = readJSON(REFERRALS_FILE).filter(r => r.referrerId === user.id);
      const converted  = referrals.filter(r => r.convertedAt);
      const credits    = user.referralCredits || 0;

      return sendJSON(res, 200, {
        code,
        link:  `${APP_URL}/join?ref=${code}`,
        stats: {
          totalReferred:  referrals.length,
          totalConverted: converted.length,
          creditsEarned:  credits
        }
      });
    }

    if (method === 'GET' && url === '/api/auth/me') {
      const user = requireAuth(req, res);
      if (!user) return;
      const entries = readJSON(entriesFile(user.id));
      return sendJSON(res, 200, {
        user: userShape(user),
        streak: computeStreak(entries),
        entryCount: entries.length
      });
    }

    /* ==============================================================
       PAYMENT — initial subscription
    ============================================================== */
    if (method === 'POST' && url === '/api/payment/verify') {
      const user = requireAuth(req, res);
      if (!user) return;
      const { reference } = await readBody(req);
      if (!reference) return sendJSON(res, 400, { error: 'Payment reference is required.' });

      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

      if (!PAYSTACK_SECRET_KEY) {
        // Dev / test mode
        const expiry = Date.now() + THIRTY_DAYS;
        updateUser(user.id, {
          paid: true, plan: 'pro',
          subscriptionStatus: 'active',
          subscriptionExpiry: expiry,
          subscriptionCode:   'TEST_SUB_' + reference
        });
        const updated = readJSON(USERS_FILE).find(u => u.id === user.id);
        sendSubscriptionConfirmationEmail(user.email, expiry);
        applyReferralCredit(updated);
        return sendJSON(res, 200, { ok: true, user: userShape(updated) });
      }

      // Verify with Paystack
      console.log('[verify] reference received:', reference);
      console.log('[verify] key prefix in use:', PAYSTACK_SECRET_KEY.slice(0, 12) + '…');
      if (reference.startsWith('TEST_REF_')) {
        console.error('[verify] TEST reference submitted to live-key server — PAYSTACK_PUBLIC_KEY is missing from Railway env vars');
        return sendJSON(res, 400, { error: 'Payment configuration error: PAYSTACK_PUBLIC_KEY is not set on the server. Contact support.' });
      }
      const result = await verifyPaystackTransaction(reference);
      console.log('[verify] full Paystack result:', JSON.stringify(result, null, 2));
      if (!result.status || result.data?.status !== 'success') {
        console.error('[verify] FAILED — result.status:', result.status, '| data.status:', result.data?.status, '| message:', result.message);
        return sendJSON(res, 400, { error: result.message || 'Payment not successful. Please try again.' });
      }
      if ((result.data?.amount || 0) < 300000) {
        console.error('[verify] AMOUNT MISMATCH — got:', result.data?.amount, 'kobo, need >= 300000');
        return sendJSON(res, 400, { error: 'Payment amount is insufficient (expected ₦3,000).' });
      }

      // Extract subscription code — Paystack includes it in the transaction data for plan payments
      const subscriptionCode = result.data?.subscription_code || result.data?.plan_object?.subscription_code || null;

      const paystackExpiry = Date.now() + THIRTY_DAYS;
      updateUser(user.id, {
        paid: true, plan: 'pro',
        subscriptionStatus: 'active',
        subscriptionExpiry: paystackExpiry,
        subscriptionCode
      });
      const updated = readJSON(USERS_FILE).find(u => u.id === user.id);
      sendSubscriptionConfirmationEmail(user.email, paystackExpiry);
      applyReferralCredit(updated);
      return sendJSON(res, 200, { ok: true, user: userShape(updated) });
    }

    /* ==============================================================
       PAYMENT — Flutterwave transaction verify
    ============================================================== */
    if (method === 'POST' && url === '/api/payment/verify-flutterwave') {
      const user = requireAuth(req, res);
      if (!user) return;
      const { transaction_id } = await readBody(req);
      if (!transaction_id) return sendJSON(res, 400, { error: 'Transaction ID is required.' });

      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

      if (!FLUTTERWAVE_SECRET_KEY) {
        // Dev / test mode
        const flwExpiry = Date.now() + THIRTY_DAYS;
        updateUser(user.id, {
          paid: true, plan: 'pro',
          subscriptionStatus: 'active',
          subscriptionExpiry: flwExpiry,
          flwTransactionId:   String(transaction_id)
        });
        const updated = readJSON(USERS_FILE).find(u => u.id === user.id);
        sendSubscriptionConfirmationEmail(user.email, flwExpiry);
        applyReferralCredit(updated);
        return sendJSON(res, 200, { ok: true, user: userShape(updated) });
      }

      // Verify with Flutterwave
      let flwResult;
      try {
        flwResult = await new Promise((resolve, reject) => {
          const options = {
            hostname: 'api.flutterwave.com',
            path:     `/v3/transactions/${encodeURIComponent(transaction_id)}/verify`,
            method:   'GET',
            headers:  { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}` }
          };
          const req2 = https.request(options, r => {
            let body = '';
            r.on('data', c => body += c);
            r.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Bad JSON')); } });
          });
          req2.on('error', reject);
          req2.end();
        });
      } catch (err) {
        return sendJSON(res, 502, { error: 'Could not reach Flutterwave. Please try again.' });
      }

      if (flwResult.status !== 'success' || flwResult.data?.status !== 'successful')
        return sendJSON(res, 400, { error: 'Payment not successful. Please try again.' });
      if ((flwResult.data?.amount || 0) < 7)
        return sendJSON(res, 400, { error: 'Payment amount is insufficient (expected $7.99).' });

      const flwLiveExpiry = Date.now() + THIRTY_DAYS;
      updateUser(user.id, {
        paid: true, plan: 'pro',
        subscriptionStatus: 'active',
        subscriptionExpiry: flwLiveExpiry,
        flwTransactionId:   String(transaction_id),
        flwCustomerId:      String(flwResult.data?.customer?.id || '')
      });
      const updated = readJSON(USERS_FILE).find(u => u.id === user.id);
      sendSubscriptionConfirmationEmail(user.email, flwLiveExpiry);
      applyReferralCredit(updated);
      return sendJSON(res, 200, { ok: true, user: userShape(updated) });
    }

    /* ==============================================================
       PAYMENT — cancel subscription
    ============================================================== */
    if (method === 'POST' && url === '/api/subscription/cancel') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!user.paid) return sendJSON(res, 400, { error: 'No active subscription found.' });

      // Try to disable on Paystack if we have a real subscription code
      if (PAYSTACK_SECRET_KEY && user.subscriptionCode && !user.subscriptionCode.startsWith('TEST_')) {
        try {
          const sub = await getPaystackSubscription(user.subscriptionCode);
          if (sub.status && sub.data?.email_token) {
            await disablePaystackSubscription(user.subscriptionCode, sub.data.email_token);
          }
        } catch (err) {
          console.warn('[cancel] Paystack disable failed:', err.message);
        }
      }

      // Try to cancel on Stripe if we have a real Stripe subscription
      if (STRIPE_SECRET_KEY && user.stripeSubscriptionId && !user.stripeSubscriptionId.startsWith('test_')) {
        try {
          await stripeRequest('POST', `/v1/subscriptions/${encodeURIComponent(user.stripeSubscriptionId)}`, {
            cancel_at_period_end: 'true'
          });
        } catch (err) {
          console.warn('[cancel] Stripe update failed:', err.message);
        }
      }

      updateUser(user.id, { subscriptionStatus: 'non-renewing' });
      return sendJSON(res, 200, { ok: true, subscriptionStatus: 'non-renewing' });
    }

    /* ==============================================================
       PAYMENT — Paystack webhook (primary endpoint)
    ============================================================== */
    if (method === 'POST' && url === '/webhook/paystack') {
      const rawBody = await readRawBody(req);
      const sig     = req.headers['x-paystack-signature'];

      if (PAYSTACK_SECRET_KEY && !verifyPaystackSignature(rawBody, sig || '')) {
        res.writeHead(400); return res.end('Invalid signature');
      }

      let event;
      try { event = JSON.parse(rawBody); } catch { res.writeHead(400); return res.end('Bad JSON'); }

      const data  = event.data || {};
      const email = data.customer?.email;
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

      if (event.event === 'charge.success') {
        if (email) {
          const u = findUserByEmail(email);
          if (u) {
            updateUser(u.id, {
              paid: true, plan: 'pro',
              subscriptionStatus: 'active',
              subscriptionExpiry: Date.now() + THIRTY_DAYS,
              subscriptionCode:   data.subscription_code || u.subscriptionCode || null
            });
          }
        }
      }

      if (event.event === 'subscription.create') {
        if (email) {
          const u = findUserByEmail(email);
          if (u) {
            const expiry = data.next_payment_date
              ? new Date(data.next_payment_date).getTime()
              : Date.now() + THIRTY_DAYS;
            updateUser(u.id, {
              paid: true, plan: 'pro',
              subscriptionStatus: 'active',
              subscriptionExpiry: expiry,
              subscriptionCode:   data.subscription_code || u.subscriptionCode || null
            });
          }
        }
      }

      if (event.event === 'subscription.disable') {
        if (email) {
          const u = findUserByEmail(email);
          if (u) {
            updateUser(u.id, {
              paid: false, plan: 'free',
              subscriptionStatus: 'disabled'
            });
          }
        }
      }

      res.writeHead(200); return res.end('OK');
    }

    /* ==============================================================
       PAYMENT — Paystack webhook (handles auto-renewals)
       Paystack calls this endpoint when a subscription renews or fails.
    ============================================================== */
    if (method === 'POST' && url === '/api/webhook/paystack') {
      const rawBody = await readRawBody(req);
      const sig     = req.headers['x-paystack-signature'];

      // Verify signature (skip check in test mode)
      if (PAYSTACK_SECRET_KEY && sig && !verifyPaystackSignature(rawBody, sig)) {
        res.writeHead(400); return res.end('Invalid signature');
      }

      let event;
      try { event = JSON.parse(rawBody); } catch { res.writeHead(400); return res.end('Bad JSON'); }

      const data = event.data || {};

      if (event.event === 'charge.success') {
        // Subscription renewed — extend expiry for this customer
        const email = data.customer?.email;
        if (email) {
          const u = findUserByEmail(email);
          if (u && u.paid) {
            const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
            const currentExpiry = u.subscriptionExpiry || Date.now();
            updateUser(u.id, {
              subscriptionStatus: 'active',
              subscriptionExpiry: Math.max(currentExpiry, Date.now()) + THIRTY_DAYS,
              subscriptionCode:   data.subscription_code || u.subscriptionCode
            });
          }
        }
      }

      if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
        const email = data.customer?.email;
        if (email) {
          const u = findUserByEmail(email);
          if (u) updateUser(u.id, { subscriptionStatus: 'non-renewing' });
        }
      }

      if (event.event === 'invoice.payment_failed') {
        const email = data.customer?.email;
        if (email) {
          const u = findUserByEmail(email);
          if (u) updateUser(u.id, { subscriptionStatus: 'lapsed' });
        }
      }

      res.writeHead(200); return res.end('OK');
    }

    /* ==============================================================
       PAYMENT — Flutterwave webhook (handles renewals and failures)
    ============================================================== */
    if (method === 'POST' && url === '/api/webhook/flutterwave') {
      const rawBody = await readRawBody(req);
      const sig     = req.headers['verif-hash'];

      // Verify hash if a secret is configured
      if (FLUTTERWAVE_SECRET_KEY && sig !== FLUTTERWAVE_SECRET_KEY) {
        res.writeHead(401); return res.end('Invalid signature');
      }

      let event;
      try { event = JSON.parse(rawBody); } catch { res.writeHead(400); return res.end('Bad JSON'); }

      const data = event.data || {};
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

      if (event.event === 'charge.completed' && data.status === 'successful') {
        const email = data.customer?.email;
        if (email) {
          const u = findUserByEmail(email);
          if (u && u.paid) {
            const currentExpiry = u.subscriptionExpiry || Date.now();
            updateUser(u.id, {
              subscriptionStatus: 'active',
              subscriptionExpiry: Math.max(currentExpiry, Date.now()) + THIRTY_DAYS
            });
          }
        }
      }

      if (event.event === 'subscription.cancelled') {
        const email = data.customer?.email;
        if (email) {
          const u = findUserByEmail(email);
          if (u) updateUser(u.id, { subscriptionStatus: 'non-renewing' });
        }
      }

      res.writeHead(200); return res.end('OK');
    }

    /* ==============================================================
       PAYMENT — Stripe Checkout (international users)
    ============================================================== */
    if (method === 'POST' && url === '/api/stripe/create-checkout') {
      const user = requireAuth(req, res);
      if (!user) return;

      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

      if (!STRIPE_SECRET_KEY) {
        // Dev / test mode — simulate without hitting Stripe
        updateUser(user.id, {
          paid: true, plan: 'pro',
          subscriptionStatus:  'active',
          subscriptionExpiry:  Date.now() + THIRTY_DAYS,
          stripeSubscriptionId: 'test_sub_' + Date.now()
        });
        const updated = readJSON(USERS_FILE).find(u => u.id === user.id);
        return sendJSON(res, 200, { testMode: true, user: userShape(updated) });
      }

      if (!STRIPE_PRICE_ID)
        return sendJSON(res, 500, { error: 'Stripe price ID is not configured on this server.' });

      const session = await stripeRequest('POST', '/v1/checkout/sessions', {
        mode:       'subscription',
        line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
        customer_email: user.email,
        success_url: `${APP_URL}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${APP_URL}?payment=cancelled`,
        metadata:              { userId: user.id },
        subscription_data:     { metadata: { userId: user.id } }
      });

      if (session.error) return sendJSON(res, 400, { error: session.error.message });
      return sendJSON(res, 200, { url: session.url });
    }

    if (method === 'GET' && url.startsWith('/api/stripe/verify-session')) {
      const user = requireAuth(req, res);
      if (!user) return;
      const qs        = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
      const sessionId = new URLSearchParams(qs).get('session_id');
      if (!sessionId) return sendJSON(res, 400, { error: 'session_id is required.' });

      const session = await stripeRequest('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
      if (session.error) return sendJSON(res, 400, { error: session.error.message });

      if (session.payment_status !== 'paid' && session.status !== 'complete')
        return sendJSON(res, 400, { error: 'Payment not yet completed.' });
      if (session.metadata?.userId !== user.id && session.customer_email !== user.email)
        return sendJSON(res, 403, { error: 'Session does not belong to the current user.' });

      const THIRTY_DAYS  = 30 * 24 * 60 * 60 * 1000;
      const stripeExpiry = Date.now() + THIRTY_DAYS;
      updateUser(user.id, {
        paid: true, plan: 'pro',
        subscriptionStatus:  'active',
        subscriptionExpiry:  stripeExpiry,
        stripeCustomerId:     session.customer,
        stripeSubscriptionId: session.subscription
      });
      const updated = readJSON(USERS_FILE).find(u => u.id === user.id);
      sendSubscriptionConfirmationEmail(user.email, stripeExpiry);
      applyReferralCredit(updated);
      return sendJSON(res, 200, { ok: true, user: userShape(updated) });
    }

    /* ==============================================================
       PAYMENT — Stripe webhook (renewals, cancellations)
    ============================================================== */
    if (method === 'POST' && url === '/api/webhook/stripe') {
      const rawBody = await readRawBody(req);
      const sig     = req.headers['stripe-signature'];

      if (STRIPE_WEBHOOK_SECRET && !verifyStripeSignature(rawBody, sig)) {
        res.writeHead(400); return res.end('Invalid signature');
      }

      let event;
      try { event = JSON.parse(rawBody); } catch { res.writeHead(400); return res.end('Bad JSON'); }

      const obj = event.data?.object || {};

      if (event.type === 'checkout.session.completed') {
        const userId = obj.metadata?.userId;
        const u = userId
          ? readJSON(USERS_FILE).find(u => u.id === userId)
          : findUserByEmail(obj.customer_email);
        if (u) {
          const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
          updateUser(u.id, {
            paid: true, plan: 'pro',
            subscriptionStatus:  'active',
            subscriptionExpiry:  Date.now() + THIRTY_DAYS,
            stripeCustomerId:     obj.customer,
            stripeSubscriptionId: obj.subscription
          });
        }
      }

      if (event.type === 'invoice.payment_succeeded') {
        const u = readJSON(USERS_FILE).find(u => u.stripeCustomerId === obj.customer);
        if (u) {
          const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
          updateUser(u.id, {
            subscriptionStatus: 'active',
            subscriptionExpiry: Math.max(u.subscriptionExpiry || 0, Date.now()) + THIRTY_DAYS
          });
        }
      }

      if (event.type === 'invoice.payment_failed') {
        const u = readJSON(USERS_FILE).find(u => u.stripeCustomerId === obj.customer);
        if (u) updateUser(u.id, { subscriptionStatus: 'lapsed' });
      }

      if (event.type === 'customer.subscription.deleted') {
        const u = readJSON(USERS_FILE).find(u => u.stripeCustomerId === obj.customer);
        if (u) updateUser(u.id, { subscriptionStatus: 'lapsed' });
      }

      if (event.type === 'customer.subscription.updated' && obj.cancel_at_period_end) {
        const u = readJSON(USERS_FILE).find(u => u.stripeCustomerId === obj.customer);
        if (u && u.subscriptionStatus === 'active') updateUser(u.id, { subscriptionStatus: 'non-renewing' });
      }

      res.writeHead(200); return res.end('OK');
    }

    /* ==============================================================
       FEEDBACK (market research survey — q1..q9)
    ============================================================== */
    if (method === 'POST' && url === '/api/feedback') {
      const user = getSessionUser(req); // optional — anonymous users allowed
      const body = await readBody(req);

      const str  = (v) => (typeof v === 'string' ? v.trim().slice(0, 2000) : null) || null;
      const entry = {
        id:        generateId(),
        userId:    user ? user.id    : null,
        email:     user ? user.email : null,
        q1:  str(body.q1),
        q2:  str(body.q2),
        q3:  str(body.q3),
        q4:  str(body.q4),
        q5:  str(body.q5),
        q6:  str(body.q6),
        q7:  str(body.q7),
        q8:  str(body.q8),
        q9:  str(body.q9),
        createdAt: Date.now(),
      };

      const hasAnswer = ['q1','q2','q3','q4','q5','q6','q7','q8','q9'].some(k => entry[k]);
      if (!hasAnswer)
        return sendJSON(res, 400, { error: 'Please answer at least one question.' });

      const all = readJSON(FEEDBACK_RESPONSES_FILE);
      all.push(entry);
      writeJSON(FEEDBACK_RESPONSES_FILE, all);
      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'GET' && url === '/api/admin/feedback') {
      if (!requireAdmin(req, res)) return;
      const all  = readJSON(FEEDBACK_RESPONSES_FILE);
      const list = [...all].sort((a, b) => b.createdAt - a.createdAt);
      return sendJSON(res, 200, {
        feedback: list,
        stats: {
          total: all.length,
          yes:   all.filter(f => f.q6 === 'Yes, if it helps me grow').length,
          maybe: all.filter(f => f.q6 === 'Maybe — depends on price').length,
          no:    all.filter(f => f.q6 === 'No — I\'d want it free').length,
        }
      });
    }

    /* ==============================================================
       ENTRIES
    ============================================================== */
    if (method === 'GET' && url === '/api/entries') {
      const user = requireAuth(req, res);
      if (!user) return;
      const entries = readJSON(entriesFile(user.id));
      return sendJSON(res, 200, { entries, streak: computeStreak(entries) });
    }

    if (method === 'POST' && url === '/api/entries') {
      const user = requireAuth(req, res);
      if (!user) return;
      const { date, text, mood } = await readBody(req);
      if (!date || !text || text.trim().length < 10)
        return sendJSON(res, 400, { error: 'Entry text is too short.' });

      const entries  = readJSON(entriesFile(user.id));
      const isUpdate = entries.some(e => e.date === date);

      const entry = {
        id: date, date, text: text.trim(),
        mood: VALID_MOODS.includes(mood) ? mood : null,
        createdAt: Date.now()
      };
      const idx = entries.findIndex(e => e.date === date);
      if (idx !== -1) entries[idx] = entry; else entries.unshift(entry);
      writeJSON(entriesFile(user.id), entries);
      return sendJSON(res, 200, { entry, streak: computeStreak(entries) });
    }

    if (method === 'DELETE' && url === '/api/entries') {
      const user = requireAuth(req, res);
      if (!user) return;
      writeJSON(entriesFile(user.id), []);
      return sendJSON(res, 200, { ok: true });
    }

    const entryEditMatch = url.match(/^\/api\/entries\/(\d{4}-\d{2}-\d{2})$/);
    if (entryEditMatch && method === 'PATCH') {
      const user = requireAuth(req, res);
      if (!user) return;
      const entryDate      = entryEditMatch[1];
      const { text, mood, coachSummary } = await readBody(req);
      const entries        = readJSON(entriesFile(user.id));
      const idx            = entries.findIndex(e => e.date === entryDate);
      if (idx === -1) return sendJSON(res, 404, { error: 'Entry not found.' });

      if (text !== undefined) {
        if (!text || text.trim().length < 10)
          return sendJSON(res, 400, { error: 'Entry text is too short.' });
        entries[idx].text = text.trim();
      }
      if (mood !== undefined) entries[idx].mood = VALID_MOODS.includes(mood) ? mood : null;
      if (coachSummary !== undefined) entries[idx].coachSummary = typeof coachSummary === 'string' ? coachSummary.trim().slice(0, 5000) : null;
      entries[idx].updatedAt = Date.now();
      writeJSON(entriesFile(user.id), entries);
      return sendJSON(res, 200, { entry: entries[idx] });
    }

    /* ==============================================================
       EXPORT
    ============================================================== */
    if (method === 'POST' && url === '/api/export/pdf') {
      const user = requirePro(req, res);
      if (!user) return;

      const entries    = readJSON(entriesFile(user.id)).sort((a, b) => b.date.localeCompare(a.date));
      const exportDate = new Date().toISOString().slice(0, 10);
      const fileUser   = user.email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ReflectAI-Journal-${fileUser}-${exportDate}.pdf"`
      });

      const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
      doc.pipe(res);

      // Title block
      doc.fontSize(26).font('Helvetica-Bold').fillColor('#1a6b4a')
         .text('ReflectAI Journal', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica').fillColor('#555')
         .text(user.email, { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor('#888')
         .text(`Exported ${exportDate}  |  ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`, { align: 'center' });
      doc.moveDown(1.2);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
      doc.moveDown(1.5);

      if (entries.length === 0) {
        doc.fontSize(11).font('Helvetica').fillColor('#888')
           .text('No journal entries found.', { align: 'center' });
      } else {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];

          // Start a new page when close to the bottom
          if (i > 0 && doc.y > doc.page.height - 160) doc.addPage();

          const d = new Date(entry.date + 'T12:00:00');
          const label = d.toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
          });

          doc.fontSize(13).font('Helvetica-Bold').fillColor('#1a1a1a').text(label);
          if (entry.mood) {
            const moodCap = entry.mood.charAt(0).toUpperCase() + entry.mood.slice(1);
            doc.fontSize(10).font('Helvetica').fillColor('#777').text(`Mood: ${moodCap}`);
          }
          doc.moveDown(0.4);
          doc.fontSize(10.5).font('Helvetica').fillColor('#333').text(entry.text, { lineGap: 3 });
          if (entry.coachSummary) {
            doc.moveDown(0.4);
            doc.fontSize(9.5).font('Helvetica-Oblique').fillColor('#666')
               .text(`AI Reflection: ${entry.coachSummary}`, { lineGap: 2 });
          }
          if (i < entries.length - 1) {
            doc.moveDown(1);
            doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ebebeb').lineWidth(0.5).stroke();
            doc.moveDown(1);
          }
        }
      }

      // Per-page footer + page numbers (requires bufferPages: true)
      const range      = doc.bufferedPageRange();
      const totalPages = range.count;
      for (let p = 0; p < totalPages; p++) {
        doc.switchToPage(p);
        const footerY = doc.page.height - 35;
        doc.fontSize(8).font('Helvetica').fillColor('#aaa')
           .text('Generated by ReflectAI — PremierLEADZ Consulting Ltd', 50, footerY, { width: 300 });
        doc.fontSize(8).font('Helvetica').fillColor('#aaa')
           .text(`Page ${p + 1} of ${totalPages}`, 50, footerY, { width: 495, align: 'right' });
      }

      doc.end();
      return;
    }

    /* ==============================================================
       AI
    ============================================================== */
    /* ==============================================================
       DEMO — public, no auth, rate-limited
    ============================================================== */
    if (method === 'POST' && url === '/api/demo/reflect') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
      if (!checkDemoRate(ip)) {
        return sendJSON(res, 429, { error: "You've used all 5 demo prompts for this hour. Sign up for unlimited access!" });
      }
      if (!API_KEY) return sendJSON(res, 500, { error: 'AI features are not configured on this server.' });

      const { entry } = await readBody(req);
      if (!entry || entry.trim().length < 20)
        return sendJSON(res, 400, { error: 'Please write a little more so the AI has something to reflect on.' });

      const systemPrompt = `You are a warm, perceptive life coach supporting students and young professionals — particularly those navigating life in Nigeria and across Africa. You carry the warmth of a trusted Nigerian mentor: grounded in community values, resilient spirit, and the deep belief that every person's story matters. Read the journal entry below and write exactly ONE reflection prompt.

The prompt must:
1. Reference a specific detail, emotion, or phrase the writer actually used — never generic
2. Use second person ("you", "your") and a warm, conversational tone
3. Be 1–2 sentences — like a question a coach would lean in and ask
4. Favour "what" or "how" over "why"

Cultural awareness: be attuned to Nigerian and African life realities where relevant — family expectations, the weight of community honour, hustle spirit, faith as an anchor, and the quiet pride of small wins against real obstacles.

Also pick the single best category from: Feelings, Mindset, Growth, Next Step, Gratitude, Perspective, Relationships, Identity

Respond with ONLY valid JSON — no markdown, no explanation:
{"prompt": "...", "category": "..."}`;

      const result = await callClaude(
        [{ role: 'user', content: `Journal entry:\n\n${entry.trim()}` }],
        systemPrompt
      );
      const raw  = result.content[0].text.trim().replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '');
      const data = JSON.parse(raw);
      return sendJSON(res, 200, { prompt: data.prompt, category: data.category });
    }

    if (method === 'POST' && url === '/api/reflect') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!API_KEY) return sendJSON(res, 500, { error: 'ANTHROPIC_API_KEY is not configured.' });

      const { entry } = await readBody(req);
      if (!entry || entry.trim().length < 10)
        return sendJSON(res, 400, { error: 'Entry text is too short.' });

      const systemPrompt = `You are a warm, perceptive life coach who specialises in supporting students and young professionals navigating early-career life — especially those building their futures in Nigeria and across Africa. Your tone is like a wise, older friend — curious, non-judgmental, and genuinely invested in this person's growth. You are culturally attuned to the African experience: the weight of family expectations, the hustle spirit, faith as a daily anchor, community bonds, and the particular resilience required to build a life in Nigeria.

When given a journal entry, write exactly 3 reflection prompts that feel like they came from someone who truly *listened*. Each prompt should help the writer go one layer deeper — past what happened, into what it means for who they are and who they are becoming. Where it genuinely fits, honour the Nigerian and African context — the communal dimension of personal choices, the complexity of family honour, the quiet dignity of persisting through difficult odds.

Rules every prompt must follow:
1. Reference at least one specific detail, emotion, person, situation, or phrase the writer actually used. A prompt that could appear in any stranger's journal has failed.
2. Use second person ("you", "your") and a warm, conversational tone — not clinical or therapy-speak.
3. Favour "what" and "how" questions over "why" — why can feel accusatory; what and how feel curious and forward-moving.
4. Keep each prompt to 1–2 sentences. Make it feel like a question a coach would lean in and ask, not an essay assignment.
5. Cover three different dimensions across the three prompts: one that goes inward (feelings, identity, self-belief), one that goes outward (relationships, environment, context), and one that goes forward (action, decision, possibility).
6. Never open a prompt with tired clichés like "What emotions came up", "How did that make you feel", "What could you do differently", or "What are you grateful for". Say it fresh.

Language craft — weave these in naturally, not mechanically:
- Use presuppositions of growth: embed the assumption that change is already in motion, not just possible. "Now that you're starting to see this..." or "As you continue to work through this..." rather than "If you were to grow..."
- Use "when" not "if" for forward questions. "When you act on this..." presupposes momentum; "if" introduces doubt.
- Occasionally use future pacing — pull the writer forward in time. "Looking back on this from two years from now, what will you be glad you noticed?" or "When you've navigated through this, what do you think you'll have learned about yourself?"
- Use cause-effect bridges that assume forward motion: "As you sit with what you wrote about [specific detail], what's already starting to shift?"
- Speak to their inner knowing: "What does the part of you that already knows the answer want you to hear?" or "What's the thing you wrote today that you already know is true, even if it's uncomfortable?"

Respond with ONLY a valid JSON array — no markdown fences, no explanation, no preamble.
Format: [{ "prompt": "...", "category": "..." }, ...]
Available categories (pick the 3 that best fit): Feelings, Mindset, Growth, Next Step, Gratitude, Perspective, Relationships, Identity`;

      const result = await callClaude([{ role: 'user', content: `Here is today's journal entry. Read it carefully — the more your prompts mirror what I actually wrote, the more useful they'll be.\n\n---\n${entry}\n---` }], systemPrompt);
      const raw    = result.content[0].text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
      return sendJSON(res, 200, { prompts: JSON.parse(raw) });
    }

    if (method === 'POST' && url === '/api/coach') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!API_KEY) return sendJSON(res, 500, { error: 'ANTHROPIC_API_KEY is not configured.' });

      const { messages } = await readBody(req);
      if (!Array.isArray(messages) || messages.length < 3)
        return sendJSON(res, 400, { error: 'Missing or too-short conversation history.' });

      // Enforce per-plan exchange limits (history starts at 2; each exchange adds 2 entries + 1 pending user msg)
      // Exchange 1 = initial /api/reflect call; coach handles exchanges 2-N
      // pro/trial: 10 total (9 coach), free: 3 total (2 coach)
      const exchangeRequested = (messages.length - 1) / 2;
      const accessLevel = getUserAccessLevel(user);
      const isPro       = accessLevel === 'pro' || accessLevel === 'trial';
      const coachLimit  = isPro ? 9 : (FREE_AI_EXCHANGES - 1); // 9 or 2
      const totalExch   = coachLimit + 1;                       // 10 or 3
      if (exchangeRequested > coachLimit)
        return sendJSON(res, 403, { error: `You've reached the session limit.`, code: 'COACH_LIMIT_REACHED' });

      // Build exchange-aware closing guidance appended to system prompt
      let closingGuidance = '';
      if (exchangeRequested === coachLimit) {
        closingGuidance = isPro
          ? `\n\nIMPORTANT — THIS IS THE FINAL EXCHANGE (Exchange ${totalExch} of ${totalExch} for this Pro plan session). Deliver a complete and warm closing:\n1. A comprehensive summary of all key insights from this entire session\n2. Three specific, actionable growth steps for the week ahead (number them clearly)\n3. A personalised encouragement grounded in something specific they shared today\n4. End with exactly: "See you in your next entry 🌱"\nMake this feel like a real coaching session closing — complete, warm, and human.`
          : `\n\nIMPORTANT — THIS IS THE FINAL EXCHANGE (Exchange ${totalExch} of ${totalExch} for this free plan session). Deliver a warm closing:\n1. A 2-3 sentence summary of the key insight from this session\n2. One specific, actionable growth step to take before their next journal entry\n3. An encouraging closing message\n4. At the very end, gently and warmly add: "Want to go deeper? Upgrade to Pro for extended coaching sessions — ₦3,000/month." — not as a sales pitch, just a genuine invitation.\nKeep the entire response warm and coach-like, never clinical.`;
      } else if (exchangeRequested === coachLimit - 1 && coachLimit > 1) {
        closingGuidance = isPro
          ? `\n\nIMPORTANT — This is Exchange ${totalExch - 1} of ${totalExch} (penultimate for this Pro plan session). Begin warmly bringing the session toward its close. Open your response with something like: "We've covered a lot of ground today — let's bring this session to a meaningful close..." Then reflect on what has been most significant in this conversation and ask one final question that will help them crystallise their insights before the final exchange.`
          : `\n\nIMPORTANT — This is Exchange ${totalExch - 1} of ${totalExch} (penultimate for this session). Start gently bringing the session toward a close. Open with something like: "We're coming to the end of today's reflection — let's bring this together..." Then reflect on what has been most meaningful and ask one last meaningful question to help crystallise their key insight.`;
      }

      // Cap history to keep context manageable: always keep first 2 (entry + opening prompt), then last 10
      const trimmed = messages.length > 12
        ? [...messages.slice(0, 2), ...messages.slice(-10)]
        : messages;

      const systemPrompt = `You are a warm, skilled life coach having a private session with someone about their journal entry — someone who likely lives and works in Nigeria or West Africa. You've already asked them a reflection prompt and they've responded. Your job: help them go deeper — one layer per turn.

You are culturally intelligent and attuned to the Nigerian context: you understand the weight that family honour carries, the intersection of faith and ambition, hustle culture, the communal dimension of personal decisions, and the real pressure of building a life with limited safety nets. Honour this context — neither exoticise it nor ignore it.

Core approach — Pace then Lead: first reflect back what they actually said (so they feel truly heard), then move them forward with a question that presupposes they're already capable and already in motion.

Rules:
1. Keep responses SHORT: 1–3 sentences of reflection, then ONE focused question. Never ask two questions.
2. Mirror their EXACT words and phrases — don't paraphrase. If they said "stuck", say "stuck". Hearing their own language creates deep resonance.
3. Go one layer deeper every turn. Surface answer? Push gently underneath. Already deep? Follow it to the root.
4. Sound like a perceptive friend, not a therapist. Warm, direct, human. No clinical language.
5. NEVER open with filler: no "That's great", "I hear you", "Thank you for sharing", "It sounds like". Just respond to what they said.
6. Use presuppositions of capability — embed the assumption they already have what they need: "What do you already know about how to handle this?" or "The part of you that knows the answer — what's it been trying to tell you?"
7. Use "when" not "if" for forward questions: "When you make this shift..." not "If you were to make this shift..." — subtle but it changes how the person relates to change.
8. Use future pacing occasionally: pull them forward in time, then bring them back. "Step two years ahead — you've worked through this. What did you do that made the difference?" Then follow with: "What would it take to start that now?"
9. Offer reframes when someone is stuck in a limiting story: "What if what you're calling [their exact word for the problem] is actually [reframe]?" — then follow with a question. Use sparingly; one well-placed reframe lands harder than three.
10. When they use absolute words — "always", "never", "everyone", "nobody" — surface the exception gently: "Always? Can you think of even one time that wasn't true?" This opens space without confrontation.
11. When they say "I have to" or "I should", occasionally shift to choice: "What would happen if you didn't? What would you do then?" This surfaces what they actually want beneath the obligation.
12. Match their sensory language: if they use feeling words ("heavy", "gut feeling", "tight"), stay in feeling language. If visual ("I see", "it's clear", "picture"), stay visual. This builds rapport at a level they won't consciously notice.
13. Use the journal entry (in the first message) as a reference — connect their current words back to specific things they wrote when it deepens the insight.
14. Each exchange should leave the person feeling more understood AND more clear about something they couldn't quite articulate before.`;

      const result  = await callClaude(trimmed, systemPrompt + closingGuidance);
      const message = result.content[0].text;
      return sendJSON(res, 200, { message, exchangesDone: exchangeRequested, coachLimit });
    }

    if (method === 'POST' && url === '/api/weekly-insight') {
      const user = requireAuth(req, res);
      if (!user) return;

      const insightLevel = getUserAccessLevel(user);
      if (insightLevel === 'free') {
        // Post-trial free: 1 insight per calendar month
        const now          = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (user.insightLastMonth === currentMonth) {
          const nextMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          const nextDateStr = nextMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
          return sendJSON(res, 403, {
            error: `Your next insight is available on ${nextDateStr}. Upgrade to Pro for weekly insights.`,
            code:  'INSIGHT_MONTHLY_LIMIT',
            nextAvailableDate: nextMonth.getTime()
          });
        }
      }
      if (!API_KEY) return sendJSON(res, 500, { error: 'ANTHROPIC_API_KEY is not configured.' });

      const entries = readJSON(entriesFile(user.id)).slice(0, 7);
      if (!entries.length)
        return sendJSON(res, 200, { insight: "You haven't written any entries yet. Start journaling daily and come back here for your first weekly insight!" });

      const formatted    = entries.map((e, i) => `Entry ${i + 1} — ${e.date}:\n${e.text}`).join('\n\n---\n\n');
      const weeklyQuote  = getRandomAfricanQuote();
      const systemPrompt = `You are a warm, perceptive life coach who specialises in supporting students and young professionals — particularly those building their futures in Nigeria and across Africa. You have just read someone's journal entries from the past week. Write a personal weekly insight in 2–3 short paragraphs.

Your voice is like a trusted Nigerian mentor who notices things the writer hasn't consciously spotted about themselves — honest, warm, culturally grounded, and specific. You understand the African experience: family expectations, hustle spirit, faith as an anchor, community honour, and the particular resilience of building a life in Nigeria.

Structure:
1. Open by naming a concrete theme or tension that ran through the week — back it up with a specific detail or phrase from the entries.
2. Celebrate something real: a moment of courage, resilience, self-awareness, or quiet growth. Quote or closely echo something they actually wrote.
3. Weave in this African quote or proverb naturally — let it illuminate something specific about their week, not just drop in as decoration: "${weeklyQuote.text}" — ${weeklyQuote.source}
4. Close with one forward-looking invitation tailored to this particular person — a challenge or experiment to carry into the week ahead.

Voice: second person only ("you", "your"). Flowing prose, no bullets or headers. ~180–230 words. Let encouragement come from specificity, not cheerleading. Never say "amazing" or "you're doing great". Feel warm and culturally alive — not generic Western self-help.`;

      const result = await callClaude([{ role: 'user', content: `Here are my journal entries from this past week:\n\n${formatted}` }], systemPrompt);
      if (insightLevel === 'free') {
        const now          = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        updateUser(user.id, { insightLastMonth: currentMonth });
      }
      return sendJSON(res, 200, { insight: result.content[0].text });
    }

    /* ==============================================================
       GOALS  (1 free trial goal; unlimited for pro)
    ============================================================== */
    if (method === 'GET' && url === '/api/goals') {
      const user = requireAuth(req, res);
      if (!user) return;
      return sendJSON(res, 200, { goals: readJSON(goalsFile(user.id)) });
    }

    if (method === 'POST' && url === '/api/goals') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (getUserAccessLevel(user) === 'free') {
        const existingGoals = readJSON(goalsFile(user.id)).filter(g => g.status !== 'completed');
        if (existingGoals.length >= FREE_GOAL_LIMIT) {
          return sendJSON(res, 403, {
            error: `You've reached the free plan limit of ${FREE_GOAL_LIMIT} active goals. Upgrade to Pro for unlimited goals.`,
            code: 'GOAL_LIMIT_REACHED'
          });
        }
      }
      const { title, description, targetDate, category } = await readBody(req);
      if (!title?.trim()) return sendJSON(res, 400, { error: 'Goal title is required.' });

      const VALID_CATEGORIES = ['Personal', 'Career', 'Health', 'Learning', 'Other'];
      const goals = readJSON(goalsFile(user.id));
      const goal  = {
        id: generateId(), title: title.trim().slice(0, 100),
        description: (description || '').trim().slice(0, 500),
        targetDate: targetDate || null,
        category: VALID_CATEGORIES.includes(category) ? category : null,
        progress: 0,
        status: 'active', createdAt: Date.now()
      };
      goals.unshift(goal);
      writeJSON(goalsFile(user.id), goals);
      return sendJSON(res, 201, { goal });
    }

    const goalIdMatch = url.match(/^\/api\/goals\/([a-f0-9]+)$/);
    if (goalIdMatch) {
      const goalId = goalIdMatch[1];
      if (method === 'PATCH') {
        const user = requireAuth(req, res);
        if (!user) return;
        const updates = await readBody(req);
        const goals   = readJSON(goalsFile(user.id));
        const idx     = goals.findIndex(g => g.id === goalId);
        if (idx === -1) return sendJSON(res, 404, { error: 'Goal not found.' });
        const VALID_CATEGORIES = ['Personal', 'Career', 'Health', 'Learning', 'Other'];
        ['title', 'description', 'targetDate', 'status'].forEach(k => {
          if (updates[k] !== undefined) goals[idx][k] = updates[k];
        });
        if (updates.category !== undefined)
          goals[idx].category = VALID_CATEGORIES.includes(updates.category) ? updates.category : null;
        if (updates.progress !== undefined) {
          const p = Number(updates.progress);
          if (!isNaN(p)) goals[idx].progress = Math.min(100, Math.max(0, Math.round(p / 10) * 10));
        }
        writeJSON(goalsFile(user.id), goals);
        return sendJSON(res, 200, { goal: goals[idx] });
      }
      if (method === 'DELETE') {
        const user = requireAuth(req, res);
        if (!user) return;
        const goals = readJSON(goalsFile(user.id));
        writeJSON(goalsFile(user.id), goals.filter(g => g.id !== goalId));
        return sendJSON(res, 200, { ok: true });
      }
    }

    const checkinMatch = url.match(/^\/api\/goals\/([a-f0-9]+)\/checkin$/);
    if (method === 'POST' && checkinMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      if (getUserAccessLevel(user) === 'free') {
        return sendJSON(res, 403, {
          error: 'AI goal check-ins require an active Pro plan or trial. Upgrade to Pro for unlimited check-ins.',
          code: 'PRO_REQUIRED'
        });
      }
      if (!API_KEY) return sendJSON(res, 500, { error: 'ANTHROPIC_API_KEY is not configured.' });

      const goalId  = checkinMatch[1];
      const goals   = readJSON(goalsFile(user.id));
      const goal    = goals.find(g => g.id === goalId);
      if (!goal) return sendJSON(res, 404, { error: 'Goal not found.' });

      const entries   = readJSON(entriesFile(user.id)).slice(0, 7);
      const formatted = entries.length
        ? entries.map((e, i) => `Entry ${i + 1} (${e.date}):\n${e.text}`).join('\n\n---\n\n')
        : 'No recent journal entries.';

      const systemPrompt = `You are a warm, encouraging life coach helping a student or young professional — likely based in Nigeria or West Africa — track progress on a personal goal. You have their goal details and recent journal entries. Write a short, personal goal check-in in 2–3 sentences.

Your check-in should note any specific evidence from the journal entries that relates to this goal (progress, setbacks, related thoughts, or relevant actions). Be attuned to the Nigerian context — the weight of goals that carry family honour, limited resources, and real structural obstacles. Celebrate persistence as much as results. If there's no direct evidence, make an empathetic observation and offer one concrete, encouraging next step. Be specific — no generic advice.`;

      const userMsg = `My goal: "${goal.title}"${goal.description ? `\nDetails: ${goal.description}` : ''}${goal.targetDate ? `\nTarget date: ${goal.targetDate}` : ''}\n\nRecent journal entries:\n\n${formatted}`;
      const result  = await callClaude([{ role: 'user', content: userMsg }], systemPrompt);
      return sendJSON(res, 200, { checkin: result.content[0].text });
    }

    /* ==============================================================
       MOOD LOGS (quick 5-emoji check-in from Home tab)
    ============================================================== */
    if (method === 'GET' && url === '/api/mood-logs') {
      const user = requireAuth(req, res);
      if (!user) return;
      const allLogs    = readJSON(moodLogsFile(user.id));
      const moodLevel  = getUserAccessLevel(user);
      if (moodLevel === 'free') {
        // Free tier: only last 7 days visible
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 6); // include today + 6 prior days
        const cutoffISO   = cutoff.toISOString().split('T')[0];
        const visibleLogs = allLogs.filter(l => l.date >= cutoffISO);
        const hasOlder    = allLogs.some(l => l.date < cutoffISO);
        return sendJSON(res, 200, { logs: visibleLogs, moodRestricted: true, hasOlderData: hasOlder });
      }
      return sendJSON(res, 200, { logs: allLogs, moodRestricted: false, hasOlderData: false });
    }

    if (method === 'POST' && url === '/api/mood-logs') {
      const user = requireAuth(req, res);
      if (!user) return;
      const { mood } = await readBody(req);
      if (!VALID_QUICK_MOODS.includes(mood))
        return sendJSON(res, 400, { error: 'Invalid mood value.' });
      const today = new Date().toISOString().split('T')[0];
      const logs  = readJSON(moodLogsFile(user.id));
      const score = VALID_QUICK_MOODS.indexOf(mood) + 1;
      const entry = { date: today, mood, score, createdAt: Date.now() };
      const idx   = logs.findIndex(l => l.date === today);
      if (idx !== -1) logs[idx] = entry; else logs.unshift(entry);
      writeJSON(moodLogsFile(user.id), logs);
      return sendJSON(res, 200, { log: entry });
    }

    /* ==============================================================
       WEEKLY INSIGHTS SUMMARY (cached per ISO week, Insights tab)
    ============================================================== */
    if (method === 'GET' && url === '/api/insights/weekly-summary') {
      const user = requireAuth(req, res);
      if (!user) return;

      const now   = new Date();
      const dow   = now.getDay(); // 0=Sun
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dow);
      const weekStartISO = weekStart.toISOString().split('T')[0];
      const today        = now.toISOString().split('T')[0];
      const weekKey      = weekStartISO;

      // Always compute fresh stats (cheap: just reads local JSON files)
      const entries     = readJSON(entriesFile(user.id));
      const weekEntries = entries.filter(e => e.date >= weekStartISO && e.date <= today);
      const totalWords  = weekEntries.reduce((s, e) => s + (e.text ? e.text.trim().split(/\s+/).length : 0), 0);

      const logs     = readJSON(moodLogsFile(user.id));
      const weekLogs = logs.filter(l => l.date >= weekStartISO && l.date <= today);
      const moodCounts = {};
      weekLogs.forEach(l => { moodCounts[l.mood] = (moodCounts[l.mood] || 0) + 1; });
      const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const avgMoodScore = weekLogs.length > 0
        ? Math.round(weekLogs.reduce((s, l) => s + l.score, 0) / weekLogs.length * 10) / 10
        : null;
      const moodCount = weekLogs.length;

      const stats = { entries: weekEntries.length, words: totalWords, topMood, avgMoodScore, moodCount };

      // Only cache the AI insight (expensive Claude API call)
      const allCached = readJSON(weeklyInsightFile(user.id), {});
      let aiInsight = allCached[weekKey]?.aiInsight || null;

      if (!aiInsight && API_KEY && weekEntries.length > 0) {
        try {
          const sample = weekEntries.slice(0, 5)
            .map((e, i) => `Entry ${i + 1} (${e.date}):\n${e.text.slice(0, 250)}`)
            .join('\n\n');
          const result = await callClaude(
            [{ role: 'user', content: `Based on these journal entries from this week, write ONE encouraging sentence (max 30 words) about the person's journey:\n\n${sample}` }],
            'You are a warm life coach. Respond with exactly one encouraging sentence, max 30 words. No preamble, no quotes.'
          );
          aiInsight = result.content[0].text.trim();
          allCached[weekKey] = { aiInsight, generatedAt: Date.now() };
          writeJSON(weeklyInsightFile(user.id), allCached);
        } catch { aiInsight = null; }
      }

      return sendJSON(res, 200, { weekKey, stats, aiInsight, cached: !!allCached[weekKey] });
    }

    /* ==============================================================
       CHANGE PASSWORD (Profile tab)
    ============================================================== */
    if (method === 'POST' && url === '/api/auth/change-password') {
      const user = requireAuth(req, res);
      if (!user) return;
      const { currentPassword, newPassword } = await readBody(req);
      if (!currentPassword || !newPassword)
        return sendJSON(res, 400, { error: 'Both current and new password are required.' });
      if (newPassword.length < 8)
        return sendJSON(res, 400, { error: 'New password must be at least 8 characters.' });

      const users      = readJSON(USERS_FILE);
      const userRecord = users.find(u => u.id === user.id);
      if (!userRecord || hashPassword(currentPassword, userRecord.salt) !== userRecord.passwordHash)
        return sendJSON(res, 400, { error: 'Current password is incorrect.' });

      const salt = crypto.randomBytes(32).toString('hex');
      updateUser(user.id, { passwordHash: hashPassword(newPassword, salt), salt });
      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'PATCH' && url === '/api/auth/profile') {
      const user = requireAuth(req, res);
      if (!user) return;
      const { firstName, lastName } = await readBody(req);
      updateUser(user.id, {
        firstName: (firstName || '').trim().slice(0, 50) || null,
        lastName:  (lastName  || '').trim().slice(0, 50) || null,
      });
      const updated = readJSON(USERS_FILE).find(u => u.id === user.id);
      return sendJSON(res, 200, { user: userShape(updated) });
    }

    /* ==============================================================
       STATIC FILES
    ============================================================== */
    const urlPath  = (url === '/' ? '/index.html' : url === '/admin' ? '/admin.html' : url === '/demo' ? '/demo.html' : url === '/join' ? '/index.html' : url === '/timeline' ? '/timeline.html' : url);
    const filePath = path.resolve(PUBLIC, '.' + urlPath);
    if (!filePath.startsWith(PUBLIC + path.sep) && filePath !== PUBLIC) {
      res.writeHead(403); return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not Found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });

  } catch (err) {
    console.error('[server error]', err.message);
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ✦  ReflectAI is running!');
  console.log(`  →  Open http://localhost:${PORT} in your browser`);
  console.log('  →  Paystack webhook URL: http://your-domain.com/webhook/paystack');
  console.log('  →  Stripe webhook URL:   http://your-domain.com/api/webhook/stripe');
  console.log('');
  if (!API_KEY)                  console.warn('  ⚠  ANTHROPIC_API_KEY not set — AI features disabled.\n');
  if (!PAYSTACK_SECRET_KEY)      console.warn('  ℹ  PAYSTACK_SECRET_KEY not set — Paystack runs in test mode.\n');
  if (!PAYSTACK_PUBLIC_KEY)      console.warn('  ⚠  PAYSTACK_PUBLIC_KEY not set — frontend will use test mode even if secret key is live!\n');
  if (!PAYSTACK_PLAN_CODE)       console.warn('  ℹ  PAYSTACK_PLAN_CODE not set — create a monthly plan in Paystack dashboard.\n');

  // Detect live/test key mismatch — the most common cause of "Transaction reference not found"
  const skEnv = PAYSTACK_SECRET_KEY.startsWith('sk_live_') ? 'live'
              : PAYSTACK_SECRET_KEY.startsWith('sk_test_') ? 'test' : null;
  const pkEnv = PAYSTACK_PUBLIC_KEY.startsWith('pk_live_') ? 'live'
              : PAYSTACK_PUBLIC_KEY.startsWith('pk_test_') ? 'test' : null;
  if (skEnv && pkEnv && skEnv !== pkEnv) {
    console.error(`  ✖  PAYSTACK KEY MISMATCH: secret key is ${skEnv} but public key is ${pkEnv}!`);
    console.error('     Transactions will fail with "Transaction reference not found".');
    console.error('     Fix: make sure both PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY are from the same environment.\n');
  } else if (skEnv) {
    console.log(`  ✓  Paystack keys: both ${skEnv} mode.\n`);
  }
  if (!STRIPE_SECRET_KEY)        console.warn('  ℹ  STRIPE_SECRET_KEY not set — Stripe runs in test mode.\n');
  if (!STRIPE_PRICE_ID)          console.warn('  ℹ  STRIPE_PRICE_ID not set — create a recurring price in Stripe dashboard.\n');
  if (!process.env.ADMIN_SECRET) console.warn(`  ℹ  ADMIN_SECRET not set — using auto-generated key: ${ADMIN_SECRET}\n`);
});
