const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkLayout(page, label) {
  const nav    = await page.$('.bottom-nav');
  const navBox = nav ? await nav.boundingBox() : null;

  const main   = await page.$('.tab-main');
  const mainBox = main ? await main.boundingBox() : null;

  const brand  = await page.$('.nav-brand');
  const brandVisible = brand ? await brand.evaluate(el => {
    const s = window.getComputedStyle(el);
    return s.display !== 'none';
  }) : false;

  const logo   = await page.$('.app-logo');
  const logoVisible = logo ? await logo.evaluate(el => {
    const s = window.getComputedStyle(el);
    return s.display !== 'none';
  }) : false;

  console.log('\n--- ' + label + ' ---');
  if (navBox) {
    console.log('  Nav box: x=' + Math.round(navBox.x) + ' y=' + Math.round(navBox.y) +
      ' w=' + Math.round(navBox.width) + ' h=' + Math.round(navBox.height));
    const isVertical = navBox.height > navBox.width;
    console.log('  Nav orientation: ' + (isVertical ? 'VERTICAL (sidebar)' : 'HORIZONTAL (bottom bar)'));
  }
  if (mainBox) {
    console.log('  Content left edge: ' + Math.round(mainBox.x));
    console.log('  Content top edge:  ' + Math.round(mainBox.y));
  }
  console.log('  Sidebar brand visible: ' + brandVisible);
  console.log('  Header logo visible:   ' + logoVisible);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // --- MOBILE: 375px ---
  const mobileCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await sleep(1000);
  await mobilePage.screenshot({ path: 'verify_nav_375.png' });
  await checkLayout(mobilePage, 'MOBILE 375px');
  await mobileCtx.close();

  // --- DESKTOP: 1200px ---
  const desktopCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const desktopPage = await desktopCtx.newPage();
  await desktopPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await sleep(1000);
  await desktopPage.screenshot({ path: 'verify_nav_1200.png' });
  await checkLayout(desktopPage, 'DESKTOP 1200px');

  // Tab switching on desktop
  await desktopPage.click('[data-tab="journal"]');
  await sleep(400);
  const journalActive = await desktopPage.$eval('[data-tab="journal"]', el => el.classList.contains('active'));
  console.log('\n  Tab switch to Journal: active=' + journalActive);
  await desktopPage.screenshot({ path: 'verify_nav_1200_journal.png' });

  // Check localStorage persistence
  await desktopPage.click('[data-tab="goals"]');
  await sleep(200);
  await desktopPage.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1200);
  const persistedTab = await desktopPage.$eval('.bottom-nav-item.active', el => el.dataset.tab).catch(() => 'unknown');
  console.log('  Persisted tab after reload: "' + persistedTab + '"');
  await desktopPage.screenshot({ path: 'verify_nav_1200_reload.png' });

  await desktopCtx.close();
  await browser.close();
  console.log('\nScreenshots: verify_nav_*.png');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
