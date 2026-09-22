'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
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

async function panelMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.canvas-panel').getBoundingClientRect();
    const controls = document.querySelector('#adjustmentsPanel');
    const controlRect = controls.getBoundingClientRect();
    const style = getComputedStyle(controls);
    return {
      canvas,
      controls: controlRect,
      clientHeight: controls.clientHeight,
      scrollHeight: controls.scrollHeight,
      position: style.position,
      overflowY: style.overflowY,
      maxHeight: style.maxHeight,
    };
  });
}

async function waitForSharedHeight(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.canvas-panel').getBoundingClientRect();
    const controls = document.querySelector('#adjustmentsPanel').getBoundingClientRect();
    return (
      document.querySelector('.workbench').style.getPropertyValue('--workbench-panel-height') &&
      Math.abs(canvas.height - controls.height) <= 2
    );
  });
}

test('A0 keeps the desktop Inspector aligned with the preview workspace and restores a natural narrow adjustment panel', async () => {
  assert.ok(fs.existsSync(chrome), 'Chrome is required for A0 layout checks');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await waitForServer(origin);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
      for (const viewport of [
        { width: 1100, height: 720 },
        { width: 1280, height: 960 },
        { width: 1920, height: 720 },
      ]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(() => {
          const controls = document.querySelector('#adjustmentsPanel');
          return controls && getComputedStyle(controls).display !== 'none';
        });
        await waitForSharedHeight(page);
        const metrics = await panelMetrics(page);
        assert.equal(metrics.position, 'sticky', `${viewport.width}px Inspector is sticky`);
        assert.equal(metrics.overflowY, 'auto', `${viewport.width}px Inspector scrolls itself`);
        assert.equal(
          Math.round(metrics.controls.height),
          Math.round(metrics.canvas.height),
          `${viewport.width}px Inspector shares the preview workspace height`
        );
        assert.ok(
          metrics.scrollHeight > metrics.clientHeight,
          'long controls scroll inside Inspector'
        );
      }

      const before = await panelMetrics(page);
      await page.evaluate(() => {
        const added = document.createElement('div');
        added.style.height = '160px';
        document.querySelector('.canvas-panel').append(added);
      });
      await waitForSharedHeight(page);
      const after = await panelMetrics(page);
      assert.ok(
        after.canvas.height >= before.canvas.height + 159,
        'canvas probe changes canvas height'
      );
      assert.ok(
        after.controls.height >= before.controls.height + 159,
        'desktop Inspector height tracks canvas height changes'
      );
      assert.equal(Math.round(after.controls.height), Math.round(after.canvas.height));

      await page.setViewportSize({ width: 1024, height: 900 });
      await page.locator('#showAdjustmentsPanel').click();
      const medium = await panelMetrics(page);
      assert.equal(medium.maxHeight, 'none');
      assert.equal(medium.overflowY, 'visible');
      assert.equal(medium.position, 'relative');
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    if (server.exitCode === null) server.kill();
  }
});

test('A0 establishes the initial shared workspace height when ResizeObserver is unavailable', async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await waitForServer(origin);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => {
        delete window.ResizeObserver;
      });
      await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
      await waitForSharedHeight(page);
      const before = await panelMetrics(page);
      assert.equal(before.position, 'sticky');
      assert.equal(before.overflowY, 'auto');
      assert.equal(Math.round(before.controls.height), Math.round(before.canvas.height));
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    if (server.exitCode === null) server.kill();
  }
});
