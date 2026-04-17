/**
 * Takes mobile-sized screenshots of key pages.
 * Run: node scripts/screenshot-mobile.js
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3001';
const OUT = 'test-results/screenshots';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone 14

// Login
const loginPage = await context.newPage();
await loginPage.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
await loginPage.screenshot({ path: `${OUT}/mobile-01-login.png`, fullPage: true });
console.log('  mobile-01-login');

// Instructor dashboard
await loginPage.fill('#email', 'test@auk.edu.kw');
await loginPage.fill('#password', 'password123');
await loginPage.click('button[type="submit"]');
await loginPage.waitForTimeout(3000);
await loginPage.screenshot({ path: `${OUT}/mobile-02-instructor-dash.png`, fullPage: true });
console.log('  mobile-02-instructor-dash');

// Course detail (if course exists)
const courseLink = loginPage.locator('.card-clickable').first();
if (await courseLink.isVisible()) {
  await courseLink.click();
  await loginPage.waitForTimeout(2000);
  await loginPage.screenshot({ path: `${OUT}/mobile-03-course-detail.png`, fullPage: true });
  console.log('  mobile-03-course-detail');
}
await loginPage.close();

// Student dashboard
const stuPage = await context.newPage();
await stuPage.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
await stuPage.fill('#email', 'student@auk.edu.kw');
await stuPage.fill('#password', 'password123');
await stuPage.click('button[type="submit"]');
await stuPage.waitForTimeout(3000);
await stuPage.screenshot({ path: `${OUT}/mobile-04-student-dash.png`, fullPage: true });
console.log('  mobile-04-student-dash');
await stuPage.close();

await browser.close();
console.log(`\nDone. Mobile screenshots in ${OUT}/`);
