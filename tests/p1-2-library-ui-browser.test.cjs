'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const cube = path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-17.cube');
const browserPath = [
  chromium.executablePath(),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

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

async function waitForServer(origin, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('P1-2 test server exited unexpectedly.');
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out starting the P1-2 test server.');
}

async function setSelect(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test(
  'P1-2 manages safe user-filter metadata, source/scene/favorite filters, keyboard cards, and two-step deletion',
  { skip: !browserPath && 'No local Chromium, Chrome, or Edge executable is available.' },
  async () => {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const server = startServer(port);
    const browser = await chromium.launch({ executablePath: browserPath, headless: true });
    const context = await browser.newContext();
    try {
      await waitForServer(origin, server);
      const page = await context.newPage();
      await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
      await page.locator('#filterImportInput').setInputFiles(cube);
      await page.waitForFunction(() =>
        document.querySelector('#libraryStatus')?.textContent.includes('导入完成：1 个成功')
      );

      await setSelect(page, '#filterSource', 'user');
      const card = page.locator('#variants .variant').first();
      await card.locator('.filter-edit-button').click();
      await page.locator('#filterEditName').waitFor({ state: 'visible' });
      assert.equal(
        await page.locator('#filterEditName').evaluate((node) => node === document.activeElement),
        true
      );

      await page.locator('#filterEditName').fill('<img src=x onerror=alert(1)> 安全名称');
      await page.locator('#filterEditAuthor').fill('<b>作者</b>');
      await page.locator('#filterEditSource').fill('https://example.test/original');
      await page.locator('#filterEditScenes').fill('P1-2 安全场景');
      await setSelect(page, '#filterEditInputSpace', 'sRGB SDR');
      await setSelect(page, '#filterEditOutputSpace', 'sRGB SDR');
      await page.locator('#saveFilterEdit').click();
      await page.waitForFunction(() => document.querySelector('#filterModal')?.hidden === true);

      assert.equal(await page.locator('#variants img').count(), 0);
      assert.match(await card.textContent(), /<img src=x onerror=alert\(1\)> 安全名称/);
      assert.equal(await card.getAttribute('role'), 'button');
      assert.equal(await card.getAttribute('tabindex'), '0');
      await card.focus();
      await card.press('Enter');
      await page.waitForFunction(
        () => document.querySelector('#variants .variant')?.getAttribute('aria-pressed') === 'true'
      );

      await page.locator('.favorite-button').click();
      await page.waitForFunction(
        () => document.querySelector('.favorite-button')?.getAttribute('aria-label') === '取消收藏'
      );
      await page.locator('#filterFavorites').check();
      assert.equal(await page.locator('#variants .variant').count(), 1);
      await page.locator('#filterFavorites').uncheck();
      await page.waitForFunction(() =>
        Array.from(document.querySelector('#filterScene').options).some(
          (option) => option.value === 'P1-2 安全场景'
        )
      );

      const edit = page.locator('.filter-edit-button').first();
      await edit.click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#filterModal')?.hidden === true);
      assert.equal(await edit.evaluate((node) => node === document.activeElement), true);

      await edit.click();
      await page.locator('#deleteFilter').click();
      await page.waitForFunction(
        () => document.querySelector('#filterDeleteConfirmation')?.hidden === false
      );
      assert.equal(await page.locator('#variants .variant').count(), 1);
      assert.equal(await page.locator('#deleteFilter').textContent(), '确认删除');
      await page.locator('#cancelFilterDelete').click();
      await page.locator('#deleteFilter').click();
      await page.locator('#deleteFilter').click();
      await page.waitForFunction(
        () => document.querySelectorAll('#variants .variant').length === 0
      );
      assert.equal(await page.locator('#filterEmpty').isHidden(), false);

      await setSelect(page, '#filterSource', 'builtin');
      await page.locator('#filterSearch').fill('Classic Chrome');
      await page.waitForFunction(
        () => document.querySelectorAll('#variants .variant').length === 1
      );
      assert.match(
        await page.locator('#variants .variant').first().textContent(),
        /Classic Chrome/
      );
    } finally {
      await context.close();
      await browser.close();
      if (server.exitCode === null) server.kill();
    }
  }
);
