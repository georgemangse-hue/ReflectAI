const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  const navItems = await page.$$('.bottom-nav-item');
  console.log('\n=== BOTTOM NAV: ' + navItems.length + ' items ===');
  for (const item of navItems) {
    const txt = (await item.innerText()).trim();
    const tab = await item.getAttribute('data-tab');
    const act = await item.evaluate(el => el.classList.contains('active'));
    console.log('  [' + (act ? 'ACTIVE' : '     ') + '] ' + txt + ' (tab=' + tab + ')');
  }

  console.log('\n=== TAB PANES ===');
  for (const id of ['tab-home','tab-journal','tab-insights','tab-goals','tab-profile']) {
    const el = await page.$('#' + id);
    const hidden = el ? await el.evaluate(e => e.classList.contains('hidden')) : 'MISSING';
    console.log('  #' + id + ': exists=' + !!el + ', hidden=' + hidden);
  }
  await page.screenshot({ path: 'verify_ss_01_initial.png' });

  const authVisible = await page.$('#auth-overlay:not(.hidden)') !== null;
  if (authVisible) {
    await page.fill('#login-email', 'verify_test@reflectai.app');
    await page.fill('#login-password', 'TestPass99');
    await page.click('#login-btn');
    await sleep(2500);
  }
  const stillAuth = await page.$('#auth-overlay:not(.hidden)') !== null;
  console.log('\nStill on auth: ' + stillAuth);
  await page.screenshot({ path: 'verify_ss_02_logged_in.png' });
  if (stillAuth) { console.log('Login failed'); await browser.close(); return; }

  console.log('\n=== HOME TAB ===');
  const greeting = await page.$eval('#home-greeting', el => el.innerText).catch(() => 'MISSING');
  const date     = await page.$eval('#home-date', el => el.innerText).catch(() => 'MISSING');
  const quote    = await page.$eval('#home-quote-text', el => el.innerText).catch(() => 'MISSING');
  const streak   = await page.$eval('#streak-number', el => el.innerText).catch(() => 'MISSING');
  const moodN    = (await page.$$('.quick-mood-btn')).length;
  const reflBtn  = await page.$eval('.home-reflect-btn', el => el.innerText).catch(() => 'MISSING');
  console.log('  Greeting: "' + greeting + '"');
  console.log('  Date: "' + date + '"');
  console.log('  Quote: "' + quote.slice(0,60) + '"');
  console.log('  Streak: "' + streak + '"');
  console.log('  Mood btns: ' + moodN + ', Reflect btn: "' + reflBtn + '"');
  await page.screenshot({ path: 'verify_ss_03_home.png' });

  // Dismiss onboarding overlay if present
  const onboarding = await page.$('#onboarding-overlay.visible');
  if (onboarding) {
    console.log('  (Dismissing onboarding overlay)');
    await page.click('.onboarding-skip-link').catch(() =>
      page.click('.onboarding-cta').catch(() => {})
    );
    await sleep(500);
  }

  await page.click('[data-qmood="okay"]');
  await sleep(1500);
  const moodLogHid = await page.$eval('#home-mood-logged', el => el.classList.contains('hidden')).catch(() => true);
  const moodLogTxt = await page.$eval('#home-mood-logged', el => el.innerText).catch(() => '');
  console.log('  Mood logged: hidden=' + moodLogHid + ', "' + moodLogTxt + '"');
  await page.screenshot({ path: 'verify_ss_04_mood.png' });

  await page.click('[data-tab="journal"]');
  await sleep(700);
  console.log('\n=== JOURNAL TAB ===');
  const jActive  = await page.$eval('[data-tab="journal"]', el => el.classList.contains('active'));
  const hasTA    = !!await page.$('#journal-input');
  const subTxt   = await page.$eval('#submit-btn', el => el.innerText).catch(() => 'MISSING');
  const wc       = await page.$eval('#char-count', el => el.innerText).catch(() => 'MISSING');
  console.log('  active=' + jActive + ', textarea=' + hasTA + ', submit="' + subTxt + '", wc="' + wc + '"');
  await page.screenshot({ path: 'verify_ss_05_journal.png' });

  await page.fill('#journal-input', 'Testing the new ReflectAI tab layout today. The home tab shows a greeting, quote, mood check-in, streak widget, and goals snapshot. The journal tab has a clean writing area.');
  await sleep(300);
  const wcAfter = await page.$eval('#char-count', el => el.innerText).catch(() => '');
  console.log('  Word count after typing: "' + wcAfter + '"');
  await page.click('#submit-btn');
  await sleep(5000);
  const promptsVis = await page.$('#prompts-section:not(.hidden)') !== null;
  console.log('  Prompts visible after submit: ' + promptsVis);
  await page.screenshot({ path: 'verify_ss_06_submitted.png' });

  await page.click('[data-tab="insights"]');
  await sleep(1500);
  console.log('\n=== INSIGHTS TAB ===');
  const insTitle   = await page.$eval('.tab-page-title', el => el.innerText).catch(() => 'MISSING');
  const chartHid   = await page.$eval('#insights-chart-wrap', el => el.classList.contains('hidden')).catch(() => 'ERR');
  const emptyVis   = await page.$('#insights-mood-empty:not(.hidden)') !== null;
  const exportProH = await page.$eval('#export-pro-section', el => el.classList.contains('hidden')).catch(() => 'ERR');
  const exportFreH = await page.$eval('#export-free-section', el => el.classList.contains('hidden')).catch(() => 'ERR');
  console.log('  Title: "' + insTitle + '"');
  console.log('  Chart hidden: ' + chartHid + ' (empty prompt: ' + emptyVis + ')');
  console.log('  Export Pro hidden: ' + exportProH + ', Free hidden: ' + exportFreH);
  await page.screenshot({ path: 'verify_ss_07_insights.png' });

  await page.click('[data-tab="goals"]');
  await sleep(600);
  console.log('\n=== GOALS TAB ===');
  const goalIn  = !!await page.$('#goal-title');
  const catSel  = !!await page.$('#goal-category');
  const addBtn  = await page.$eval('#add-goal-btn', el => el.innerText).catch(() => 'MISSING');
  const contVis = await page.$('#goals-content:not(.hidden)') !== null;
  const lockVis = await page.$('#goals-lock:not(.hidden)') !== null;
  console.log('  form=' + goalIn + ', cat=' + catSel + ', add="' + addBtn + '", content=' + contVis + ', lock=' + lockVis);
  await page.screenshot({ path: 'verify_ss_08_goals.png' });

  await page.fill('#goal-title', 'Complete 30-day journaling challenge');
  await page.selectOption('#goal-category', 'Personal');
  await page.click('#add-goal-btn');
  await sleep(1200);
  const goalCards = (await page.$$('.goal-card')).length;
  const progFill  = !!await page.$('.goal-progress-fill');
  const catBadge  = !!await page.$('.goal-cat-badge');
  const progBtn   = !!await page.$('.goal-progress-btn');
  console.log('  Cards: ' + goalCards + ', progress bar: ' + progFill + ', cat badge: ' + catBadge + ', prog btn: ' + progBtn);
  await page.screenshot({ path: 'verify_ss_09_goal_added.png' });

  await page.click('[data-tab="home"]');
  await sleep(400);
  const homeGoals = (await page.$$('.home-goal-item')).length;
  console.log('\n  Home goals snapshot: ' + homeGoals + ' items');
  await page.screenshot({ path: 'verify_ss_10_home_with_data.png' });

  await page.click('[data-tab="journal"]');
  await sleep(400);
  const chips = (await page.$$('.entry-chip')).length;
  console.log('\n  Journal entry chips: ' + chips);
  await page.screenshot({ path: 'verify_ss_11_chips.png' });

  await page.click('[data-tab="profile"]');
  await sleep(600);
  console.log('\n=== PROFILE TAB ===');
  const avatar   = await page.$eval('#profile-avatar', el => el.innerText).catch(() => 'MISSING');
  const emailD   = await page.$eval('#profile-email-display', el => el.innerText).catch(() => 'MISSING');
  const planB    = await page.$eval('#profile-plan-badge', el => el.innerText).catch(() => 'MISSING');
  const since    = await page.$eval('#profile-member-since', el => el.innerText).catch(() => 'MISSING');
  const sEntries = await page.$eval('#profile-stat-entries', el => el.innerText).catch(() => 'MISSING');
  const actRows  = (await page.$$('.profile-action-row')).length;
  const upgVis   = await page.$('#profile-upgrade-banner:not(.hidden)') !== null;
  console.log('  avatar="' + avatar + '", email="' + emailD + '"');
  console.log('  plan="' + planB + '", since="' + since + '"');
  console.log('  entries stat="' + sEntries + '", action rows=' + actRows);
  console.log('  upgrade banner=' + upgVis);
  await page.screenshot({ path: 'verify_ss_12_profile.png' });

  await page.click('[data-tab="insights"]');
  await sleep(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2000);
  const tabAfterReload = await page.$eval('.bottom-nav-item.active', el => el.dataset.tab).catch(() => 'unknown');
  console.log('\n=== TAB PERSISTENCE after reload: "' + tabAfterReload + '" ===');
  await page.screenshot({ path: 'verify_ss_13_reload.png' });

  const rel = errors.filter(e => !e.includes('paystack.co') && !e.includes('flutterwave') && !e.includes('Refused to apply style') && !e.includes('checkout.'));
  if (rel.length) {
    console.log('\n=== CONSOLE ERRORS (' + rel.length + ') ===');
    rel.slice(0,6).forEach(e => console.log('  ERR: ' + e.slice(0,150)));
  } else {
    console.log('\nNo relevant console errors');
  }

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
