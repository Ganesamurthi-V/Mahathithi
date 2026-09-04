/**
 * Capture screenshots of every admin-panel page for visual review.
 *
 * Usage:
 *   node scripts/capture-pages.mjs                       # localhost, login page only
 *   $env:ADMIN_ID="x"; $env:ADMIN_PASS="y"; node scripts/capture-pages.mjs
 *   $env:BASE_URL="https://mahathithi.vercel.app"; node scripts/capture-pages.mjs
 *
 * Credentials are read from env vars only, never hardcoded, and are not printed.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'screenshots');
const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const ID = process.env.ADMIN_ID || '';
const PASS = process.env.ADMIN_PASS || '';

const PAGES = [
  { path: '/', name: '1-dashboard', label: 'Dashboard' },
  { path: '/stakeholders', name: '2-stakeholders', label: 'Stakeholders' },
  { path: '/enumerators', name: '3-enumerators', label: 'Enumerators' },
  { path: '/districts', name: '4-districts', label: 'Districts' },
  { path: '/audit', name: '5-audit-logs', label: 'Audit Logs' },
  { path: '/export', name: '6-export-sql', label: 'Export SQL' },
];

mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const failedRequests = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`[${page.url().replace(BASE, '')}] ${m.text().slice(0, 300)}`);
});
page.on('requestfailed', (r) => {
  failedRequests.push(`${r.method()} ${r.url().slice(0, 160)} — ${r.failure()?.errorText}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`);
});

console.log(`base: ${BASE}`);

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, '0-login.png'), fullPage: true });
console.log('captured 0-login.png');

if (!ID || !PASS) {
  console.log('\nADMIN_ID / ADMIN_PASS not set — captured the login page only.');
  console.log('Set both env vars to capture the six authenticated pages.');
  await browser.close();
  process.exit(0);
}

// Log in. Field selectors are resolved defensively so a label change does not
// break the run outright.
const idBox = page.locator('input[name="loginId"], input[type="text"]').first();
const pwBox = page.locator('input[type="password"]').first();
await idBox.fill(ID);
await pwBox.fill(PASS);
await Promise.all([
  page.waitForLoadState('networkidle'),
  page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")').first().click(),
]);
await page.waitForTimeout(2500);

const stillLogin = await page.locator('input[type="password"]').count();
if (stillLogin > 0) {
  await page.screenshot({ path: join(OUT, '0-login-failed.png'), fullPage: true });
  const msg = await page.locator('[class*="error"], [role="alert"]').first().textContent().catch(() => null);
  console.error(`\nLOGIN FAILED${msg ? ` — ${msg.trim()}` : ''}`);
  console.error('The panel requires an account with isAdmin=true.');
  await browser.close();
  process.exit(1);
}
console.log('logged in');

for (const p of PAGES) {
  await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 45000 });
  // Let skeletons resolve into real content.
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(OUT, `${p.name}.png`), fullPage: true });

  const counts = await page.evaluate(() => ({
    rows: document.querySelectorAll('tbody tr').length,
    tables: document.querySelectorAll('table').length,
    buttons: document.querySelectorAll('button').length,
    cards: document.querySelectorAll('[class*="card"], [class*="stat"]').length,
    inputs: document.querySelectorAll('input, select').length,
    skeletons: document.querySelectorAll('[class*="skeleton"], [class*="Skeleton"]').length,
    emptyText: /no data|nothing|empty|no records|no results/i.test(document.body.innerText) ? 'yes' : 'no',
  }));
  console.log(`captured ${p.name}.png  ${p.label} → ${JSON.stringify(counts)}`);
}

console.log(`\nscreenshots in: ${OUT}`);
if (consoleErrors.length) {
  console.log(`\nconsole errors (${consoleErrors.length}):`);
  [...new Set(consoleErrors)].slice(0, 20).forEach((e) => console.log('  ' + e));
}
if (failedRequests.length) {
  console.log(`\nfailed / 4xx-5xx requests (${failedRequests.length}):`);
  [...new Set(failedRequests)].slice(0, 25).forEach((e) => console.log('  ' + e));
}
if (!consoleErrors.length && !failedRequests.length) console.log('\nno console errors, no failed requests');

await browser.close();
