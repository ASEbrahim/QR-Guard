/**
 * Takes screenshots of all pages for UI review.
 * Run: node scripts/screenshot-all.js
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3001';
const OUT = 'test-results/screenshots';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// --- Public pages (no auth) ---
for (const [name, path] of [
  ['01-login', '/login.html'],
  ['02-register', '/register.html'],
  ['03-forgot-password', '/forgot-password.html'],
]) {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await page.close();
  console.log(`  ${name}`);
}

// --- Instructor pages ---
const instPage = await context.newPage();
await instPage.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
await instPage.fill('#email', 'test@auk.edu.kw');
await instPage.fill('#password', 'password123');
await instPage.click('button[type="submit"]');
await instPage.waitForURL('**/instructor/**', { timeout: 5000 });
await instPage.screenshot({ path: `${OUT}/04-instructor-dashboard.png`, fullPage: true });
console.log('  04-instructor-dashboard');

// Click create course to expand it
const toggle = instPage.locator('#toggleCreate');
if (await toggle.isVisible()) {
  await toggle.click();
  await instPage.waitForTimeout(500);
  await instPage.screenshot({ path: `${OUT}/05-instructor-create-course.png`, fullPage: true });
  console.log('  05-instructor-create-course');
}
await instPage.close();

// --- Student pages ---
const stuPage = await context.newPage();
await stuPage.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
await stuPage.fill('#email', 'student@auk.edu.kw');
await stuPage.fill('#password', 'password123');
await stuPage.click('button[type="submit"]');
await stuPage.waitForTimeout(3000);
await stuPage.screenshot({ path: `${OUT}/06-student-dashboard.png`, fullPage: true });
console.log('  06-student-dashboard');

await stuPage.goto(`${BASE}/student/scan.html`, { waitUntil: 'networkidle' });
await stuPage.waitForTimeout(1000);
await stuPage.screenshot({ path: `${OUT}/07-student-scan.png`, fullPage: true });
console.log('  07-student-scan');
await stuPage.close();

// --- Misc pages ---
const miscPage = await context.newPage();
await miscPage.goto(`${BASE}/request-rebind.html`, { waitUntil: 'networkidle' });
await miscPage.screenshot({ path: `${OUT}/08-request-rebind.png`, fullPage: true });
console.log('  08-request-rebind');
await miscPage.close();

await browser.close();
console.log(`\nDone. Screenshots in ${OUT}/`);
