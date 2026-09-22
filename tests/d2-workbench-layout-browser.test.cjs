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
const browserNames = (process.env.D2_BROWSERS || 'chrome,edge')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

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

async function measure(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      preset: box('#presetPanel'),
      canvas: box('.canvas-panel'),
      stage: box('#stage'),
      adjustments: box('#adjustmentsPanel'),
      tabs: box('.workbench-tabs'),
      presetDisplay: style('#presetPanel').display,
      adjustmentsDisplay: style('#adjustmentsPanel').display,
      toolbarRows: document.querySelectorAll('.canvas-tool-row').length,
      controls: [
        '#filterSearch',
        '#filterSource + .select-ui',
        '#filterScene + .select-ui',
        '#previewAspect + .select-ui',
        '#zoomIn',
        '#cropAspect + .select-ui',
      ].map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, rect.width, rect.height];
      }),
    };
  });
}

test('D2 workbench keeps looks, canvas, and adjustments in one responsive editor', async (t) => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    for (const name of browserNames) {
      const executablePath = browserPaths[name];
      assert.ok(executablePath, `unsupported D2 browser: ${name}`);
      const browser = await chromium.launch({ executablePath, headless: true });
      try {
        await t.test(`${name} desktop three-column workbench`, async () => {
          const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
          const page = await context.newPage();
          try {
            await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.querySelector('#canvasTools').classList.add('show'));
            const state = await measure(page);
            assert.ok(
              state.scrollWidth <= state.clientWidth + 1,
              'desktop must not scroll horizontally'
            );
            assert.equal(state.tabs.height, 0, 'desktop does not need a mobile pane switcher');
            assert.equal(
              state.toolbarRows,
              2,
              'canvas controls must be organized as two compact rows'
            );
            assert.ok(
              state.canvas.right < state.adjustments.left,
              'canvas and adjustment panels must be ordered as the two desktop columns'
            );
            assert.ok(
              state.preset.right <= state.canvas.left,
              'the LUT library must be the left workbench panel beside the persistent canvas'
            );
            assert.ok(
              state.canvas.width >= 460,
              'the main canvas column must retain practical editing width'
            );
            assert.ok(
              state.stage.width >= 420,
              'the preview stage must not be squeezed by side panels'
            );
            for (const [selector, width, height] of state.controls)
              assert.ok(width > 0 && height > 0, `${selector} must remain reachable on desktop`);
          } finally {
            await context.close();
          }
        });

        await t.test(`${name} narrow canvas-first panel switcher`, async () => {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
          const page = await context.newPage();
          try {
            await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.querySelector('#canvasTools').classList.add('show'));
            let state = await measure(page);
            assert.ok(
              state.scrollWidth <= state.clientWidth + 1,
              'narrow workbench must not scroll horizontally'
            );
            assert.ok(
              state.canvas.top < state.tabs.top,
              'the main canvas must appear before side-panel navigation'
            );
            assert.ok(state.stage.width > 250, 'the narrow preview stage must remain useful');
            assert.notEqual(state.presetDisplay, 'none', 'the Looks pane is initially visible');
            assert.equal(
              state.adjustmentsDisplay,
              'none',
              'adjustments are hidden until requested on narrow screens'
            );

            await page.locator('#showAdjustmentsPanel').click();
            state = await measure(page);
            assert.equal(
              state.preset.height,
              0,
              'the segmented adjustment pane replaces Looks without moving the canvas'
            );
            assert.notEqual(
              state.adjustmentsDisplay,
              'none',
              'adjustment pane is reachable by its tab'
            );
            assert.ok(
              state.scrollWidth <= state.clientWidth + 1,
              'switching panes must not create overflow'
            );

            await page.locator('#showPresetPanel').focus();
            await page.keyboard.press('ArrowRight');
            assert.equal(
              await page.locator('#showAdjustmentsPanel').getAttribute('aria-selected'),
              'true',
              'the segmented navigation exposes adjustment state to assistive technology'
            );
          } finally {
            await context.close();
          }
        });

        await t.test(`${name} medium pane switching preserves the editor canvas`, async () => {
          const context = await browser.newContext({ viewport: { width: 1024, height: 960 } });
          const page = await context.newPage();
          try {
            await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
            const before = await page.evaluate(() => {
              const canvas = document.querySelector('.canvas-panel').getBoundingClientRect();
              return {
                top: canvas.top + window.scrollY,
                left: canvas.left,
                width: canvas.width,
              };
            });
            await page.locator('#showAdjustmentsPanel').click();
            const after = await page.evaluate(() => {
              const canvas = document.querySelector('.canvas-panel').getBoundingClientRect();
              return { top: canvas.top + window.scrollY, left: canvas.left, width: canvas.width };
            });
            assert.deepEqual(after, before, 'switching side panes must not reflow the canvas');
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
