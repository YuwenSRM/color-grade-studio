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
    if (child.exitCode !== null) throw new Error('P1-1 test server exited unexpectedly.');
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out starting the P1-1 test server.');
}

test(
  'P1-1 persists an imported LUT record, Blob, and favorite across a browser refresh',
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
      await page.waitForFunction(
        () => document.querySelector('#libraryStatus')?.textContent.length
      );
      await page.locator('#filterImportInput').setInputFiles(cube);
      await page.waitForFunction(() =>
        document.querySelector('#libraryStatus')?.textContent.includes('导入完成：1 个成功')
      );

      const imported = await page.evaluate(async () => {
        const library = new window.LandscapeLutLibrary.LutLibrary();
        const [filter] = await library.list();
        await library.update(filter.id, { favorite: true });
        return { id: filter.id, hash: filter.contentHash };
      });

      await page.reload({ waitUntil: 'networkidle' });
      const restored = await page.evaluate(async () => {
        const library = new window.LandscapeLutLibrary.LutLibrary();
        const [filter] = await library.list();
        const blob = await library.getBlob(filter.id);
        return {
          id: filter.id,
          hash: filter.contentHash,
          favorite: filter.favorite,
          blobSize: blob?.size || 0,
        };
      });
      assert.equal(restored.id, imported.id);
      assert.equal(restored.hash, imported.hash);
      assert.equal(restored.favorite, true);
      assert.ok(restored.blobSize > 0);
    } finally {
      await context.close();
      await browser.close();
      if (server.exitCode === null) server.kill();
    }
  }
);
