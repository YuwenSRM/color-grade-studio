'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const browserPaths = Object.freeze({
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
});
const browserNames = (process.env.D4_BROWSERS || 'chrome,edge')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const photo = path.join(root, 'uploads', '5aaff1b3-19ab-4a7f-96cc-8b1d4710cbb6.png');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function startServer(port) {
  return spawn(process.execPath, ['serve.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitForServer(origin) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

function stopServer(server) {
  if (server?.exitCode === null) server.kill();
}

async function importPhoto(page) {
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(
    () =>
      document.querySelector('#stage').getAttribute('aria-busy') === 'false' &&
      document.querySelector('#mainCanvas').width > 1
  );
}

async function selectBuiltinLut(page) {
  await page.locator('#filterSearch').fill('柔和肖像');
  await page.waitForFunction(() => document.querySelectorAll('#variants .variant').length === 1);
  await page.locator('#variants .variant').click();
  await page.waitForFunction(() => !document.querySelector('#filterIntensity').hidden);
}

test('D4 groups adjustments and keeps LUT management and strength controls usable in Chrome and Edge', async (t) => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    for (const name of browserNames) {
      const executablePath = browserPaths[name];
      assert.ok(executablePath, `unsupported D4 browser: ${name}`);
      const browser = await chromium.launch({ executablePath, headless: true });
      try {
        await t.test(`${name} management menu, grouped controls and LUT endpoints`, async () => {
          const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
          const page = await context.newPage();
          try {
            await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
            assert.deepEqual(
              (
                await page
                  .locator('#adjustmentsPanel .adjustment-group > summary')
                  .allTextContents()
              ).map((text) => text.replace(/\s+/g, ' ').trim()),
              [
                '基础影调、色彩与精确调整',
                '色彩分级HSL 参数、强度与平衡',
                '细节与氛围鲜艳度、色温、色调与清晰度',
              ]
            );
            assert.equal(await page.locator('#moreFilters').locator('#filterRegion').count(), 1);
            assert.equal(await page.locator('#moreFilters').locator('#filterCamera').count(), 1);
            assert.equal(await page.locator('#libraryMenu').isHidden(), true);
            await page.locator('#libraryMenuToggle').click();
            assert.equal(await page.locator('#libraryMenu').isVisible(), true);
            for (const selector of [
              '#importFilters',
              '#backupFilters',
              '#restoreMode + .select-ui',
              '#restoreFilters',
            ])
              assert.equal(
                await page.locator(selector).isVisible(),
                true,
                `${selector} must be in the menu`
              );
            await page.locator('#restoreMode').dispatchEvent('click');
            assert.equal(
              await page.locator('#libraryMenu').isVisible(),
              true,
              'a menu action must not be treated as an outside click'
            );
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#libraryMenu').isHidden(), true);

            await importPhoto(page);
            await selectBuiltinLut(page);
            const strength = page.locator('#filterIntensityInput');
            assert.equal(await strength.getAttribute('min'), '0');
            assert.equal(await strength.getAttribute('max'), '100');
            assert.equal(await page.locator('#filterIntensityValue').textContent(), '100%');
            await strength.focus();
            await page.keyboard.press('Home');
            assert.equal(await page.locator('#filterIntensityValue').textContent(), '0%');
            assert.equal(await strength.getAttribute('aria-valuetext'), '0%');
            assert.equal(
              await strength.evaluate((input) => input.style.getPropertyValue('--range-progress')),
              '0%'
            );
            await page.keyboard.press('End');
            assert.equal(await page.locator('#filterIntensityValue').textContent(), '100%');
            assert.equal(
              await page.locator('.applied-filter-intensity-value').textContent(),
              '100%'
            );

            const exposureInput = page.locator('#exposureInput');
            await exposureInput.fill('27');
            await exposureInput.dispatchEvent('input');
            assert.equal(await page.locator('#exposure').inputValue(), '27');
            assert.equal(await page.locator('#exposureV').textContent(), '+27');
            await page.locator('[data-manual-reset="exposure"]').click();
            assert.equal(await page.locator('#exposure').inputValue(), '0');

            await page.locator('#shadowAmtInput').fill('37');
            await page.locator('#shadowAmtInput').dispatchEvent('input');
            assert.equal(await page.locator('#shadowAmt').inputValue(), '37');
            assert.equal(await page.locator('#shadowAmtInput').inputValue(), '37');
            await page.locator('[data-grade-reset="shadow"]').click();
            assert.equal(await page.locator('#shadowAmt').inputValue(), '0');
            assert.equal(await page.locator('#shadowAmtInput').inputValue(), '0');
          } finally {
            await context.close();
          }
        });

        await t.test(
          `${name} narrow management and adjustment controls do not overflow`,
          async () => {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
            const page = await context.newPage();
            try {
              await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
              await page.locator('#moreFilters summary').click();
              await page.locator('#libraryMenuToggle').click();
              const sizes = await page.evaluate(() => ({
                clientWidth: document.documentElement.clientWidth,
                clientHeight: document.documentElement.clientHeight,
                scrollWidth: document.documentElement.scrollWidth,
                menu: document.querySelector('#libraryMenu').getBoundingClientRect().toJSON(),
              }));
              assert.ok(
                sizes.scrollWidth <= sizes.clientWidth + 1,
                'narrow view must not overflow'
              );
              assert.ok(
                sizes.menu.left >= 0 &&
                  sizes.menu.right <= sizes.clientWidth &&
                  sizes.menu.top >= 0 &&
                  sizes.menu.bottom <= sizes.clientHeight,
                'menu stays fully reachable in the viewport'
              );
              await page.locator('#showAdjustmentsPanel').click();
              assert.equal(await page.locator('#adjustmentsPanel').isVisible(), true);
              await page
                .locator('#adjustmentsPanel .adjustment-group:last-of-type > summary')
                .click();
              assert.ok(
                await page.locator('#adjustmentsPanel [data-manual-reset="clarity"]').isVisible(),
                'detail and atmosphere controls remain reachable'
              );
            } finally {
              await context.close();
            }
          }
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    stopServer(server);
  }
});
