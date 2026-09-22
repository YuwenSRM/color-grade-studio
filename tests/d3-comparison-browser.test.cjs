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
// D5 runs the full Chrome/Edge matrix. D3 stays focused and fast by default,
// while D3_BROWSERS=chrome,edge remains available for targeted cross-browser runs.
const browserNames = (process.env.D3_BROWSERS || 'chrome')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const firstPhoto = path.join(root, 'uploads', '5aaff1b3-19ab-4a7f-96cc-8b1d4710cbb6.png');
const secondPhoto = path.join(root, 'uploads', '246ca4e3-1dd2-411f-b091-af926eb541d4.png');

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

async function importPhoto(page, photo) {
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(
    (name) =>
      document.querySelector('#stage').getAttribute('aria-busy') === 'false' &&
      document.querySelector('#fileName').textContent === name &&
      document.querySelector('#mainCanvas').width > 1,
    path.basename(photo)
  );
}

async function comparisonState(page) {
  return page.evaluate(() => {
    const divider = document.querySelector('#comparisonDivider');
    return {
      mode: document.querySelector('#stage').dataset.comparison,
      position: divider.getAttribute('aria-valuenow'),
      dividerHidden: divider.hidden,
      originalHidden: document.querySelector('#comparisonCanvas').hidden,
      exposure: document.querySelector('#exposure').value,
    };
  });
}

async function setCropAspect(page, value) {
  await page.locator('#cropAspect').evaluate((select, nextValue) => {
    select.value = nextValue;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function assertEffectDefault(page, exposure = '31') {
  const state = await comparisonState(page);
  assert.deepEqual(
    {
      mode: state.mode,
      position: state.position,
      dividerHidden: state.dividerHidden,
      originalHidden: state.originalHidden,
    },
    {
      mode: 'effect',
      position: '50',
      dividerHidden: true,
      originalHidden: true,
    }
  );
  if (exposure !== null)
    assert.equal(state.exposure, exposure, 'comparison cannot alter adjustments');
}

test('D3 comparison state is preview-only and resets predictably in Chrome and Edge', async (t) => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    for (const name of browserNames) {
      const executablePath = browserPaths[name];
      assert.ok(executablePath, `unsupported D3 browser: ${name}`);
      const browser = await chromium.launch({ executablePath, headless: true });
      try {
        await t.test(`${name} pointer, touch and keyboard comparison controls`, async () => {
          const context = await browser.newContext({
            viewport: { width: 1440, height: 960 },
            hasTouch: true,
          });
          const page = await context.newPage();
          try {
            await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
            await importPhoto(page, firstPhoto);
            await page.locator('#exposure').evaluate((input) => {
              input.value = '31';
              input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await assertEffectDefault(page);

            await page.locator('#compareSplitVertical').click();
            assert.equal((await comparisonState(page)).mode, 'vertical');
            assert.equal((await comparisonState(page)).position, '50');

            const stage = await page.locator('#stage').boundingBox();
            const divider = await page.locator('#comparisonDivider').boundingBox();
            assert.ok(stage && divider, 'vertical divider must be visible and measurable');
            await page.mouse.move(divider.x + divider.width / 2, stage.y + stage.height / 2);
            await page.mouse.down();
            await page.mouse.move(stage.x + stage.width * 0.72, stage.y + stage.height / 2);
            await page.mouse.up();
            assert.ok(
              Number((await comparisonState(page)).position) >= 70,
              'pointer drag moves divider'
            );

            await page.locator('#compareSplitVertical').click();
            await assertEffectDefault(page);
            await page.locator('#compareSplitVertical').click();
            assert.equal((await comparisonState(page)).position, '50');

            const touchDivider = await page.locator('#comparisonDivider').boundingBox();
            assert.ok(touchDivider, 'touch target must be visible in split mode');
            await page.touchscreen.tap(
              touchDivider.x + touchDivider.width / 2,
              touchDivider.y + touchDivider.height / 2
            );
            assert.equal(
              (await comparisonState(page)).position,
              '50',
              'touch keeps a centered divider'
            );

            await page.locator('#compareSplitHorizontal').click();
            const horizontalDivider = page.locator('#comparisonDivider');
            await horizontalDivider.focus();
            await page.keyboard.press('End');
            assert.equal((await comparisonState(page)).position, '100');
            await page.keyboard.press('Home');
            assert.equal((await comparisonState(page)).position, '0');
            await page.keyboard.press('ArrowDown');
            assert.equal((await comparisonState(page)).position, '2');
            await page.locator('#compareSplitHorizontal').click();
            await assertEffectDefault(page);

            await page.locator('#compareOriginal').click();
            const original = await comparisonState(page);
            assert.equal(original.mode, 'original');
            assert.equal(original.originalHidden, false, 'original view is not a split');
            assert.equal(original.dividerHidden, true, 'original view has no divider');
            await page.locator('#compareEffect').click();
            await assertEffectDefault(page);

            await page.locator('#compareSplitVertical').click();
            await setCropAspect(page, '1:1');
            await assertEffectDefault(page);
            await page.locator('#compareSplitVertical').click();
            await page.locator('#cropReset').click();
            await assertEffectDefault(page);
            await page.locator('#compareSplitVertical').click();
            await page.locator('#applyCrop').click();
            await assertEffectDefault(page);

            await page.locator('#compareSplitVertical').click();
            await importPhoto(page, secondPhoto);
            await assertEffectDefault(page, null);
          } finally {
            await context.close();
          }
        });
      } finally {
        await browser.close();
      }
    }
  } finally {
    stopServer(server);
  }
});
