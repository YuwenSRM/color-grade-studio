'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

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

test('grade tabs keep one readable panel without horizontal overflow across supported widths', async () => {
  assert.ok(
    require('node:fs').existsSync(chrome),
    'Chrome is required for grade tab layout checks'
  );
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await waitForServer(origin);
    for (const width of [280, 320, 390, 520, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      try {
        await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
        if (width < 1100) await page.locator('#showAdjustmentsPanel').click();
        const state = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          activeInputs: [
            ...document.querySelectorAll('#gradeTonePanelShadow input[type="number"]'),
          ].map((input) => input.getBoundingClientRect().width),
          hiddenPanels: [...document.querySelectorAll('.grade-tone-panel[hidden]')].length,
          visiblePanels: [...document.querySelectorAll('.grade-tone-panel:not([hidden])')].length,
        }));
        assert.ok(
          state.scrollWidth <= state.clientWidth + 1,
          `${width}px grade editor must not introduce horizontal scrolling`
        );
        assert.equal(state.visiblePanels, 1, `${width}px exposes one grade panel`);
        assert.equal(state.hiddenPanels, 2, `${width}px hides inactive grade panels natively`);
        for (const inputWidth of state.activeInputs)
          assert.ok(inputWidth >= 72, `${width}px H/S/L input is at least 72px wide`);
      } finally {
        await context.close();
      }
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
      await page.locator('#showAdjustmentsPanel').click();
      await page.evaluate(() => {
        document.querySelector('.controls').classList.remove('is-locked');
        document
          .querySelectorAll('.grade-editor input, .grade-editor button')
          .forEach((control) => {
            control.disabled = false;
          });
      });
      await page.locator('#gradeToneShadow').focus();
      await page.keyboard.press('ArrowRight');
      const activeTab = await page.evaluate(() => document.activeElement?.id);
      assert.equal(activeTab, 'gradeToneMid', `ArrowRight must move tab focus, got ${activeTab}`);
      assert.equal(await page.locator('#gradeToneShadow').getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#gradeToneMid').getAttribute('aria-selected'), 'true');
      assert.equal(
        await page.locator('#gradeTonePanelShadow').evaluate((node) => node.hidden),
        true
      );
      assert.equal(await page.locator('#gradeTonePanelMid').evaluate((node) => node.hidden), false);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    if (server.exitCode === null) server.kill();
  }
});
