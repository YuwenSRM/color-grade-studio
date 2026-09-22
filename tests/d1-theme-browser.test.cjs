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
const browserNames = (process.env.D1_BROWSERS || 'chrome,edge')
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

async function inspectTheme(page, dark) {
  await page.addInitScript(
    (isDark) => localStorage.setItem('landscape-theme', isDark ? 'dark' : 'light'),
    dark
  );
  await page.goto(page.themeUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.querySelector('#filterModal').hidden = false;
    document.querySelector('#filterDeleteConfirmation').hidden = false;
    document.querySelector('#cropBox').classList.add('show');
    document.querySelector('#comparisonDivider').hidden = false;
    document.querySelector('#filterRegion + .select-ui')?.classList.add('disabled');
  });
  await page.locator('#filterSearch').focus();
  const state = await page.evaluate(() => {
    const css = (selector) => getComputedStyle(document.querySelector(selector));
    const root = getComputedStyle(document.documentElement);
    return {
      dark: document.body.classList.contains('dark'),
      tokens: [
        '--surface-base',
        '--surface-raised',
        '--surface-sunken',
        '--border-subtle',
        '--border-strong',
        '--text-primary',
        '--text-secondary',
        '--accent',
        '--danger',
        '--focus-ring',
      ].map((name) => [name, root.getPropertyValue(name).trim()]),
      page: css('body').backgroundColor,
      panel: css('.canvas-panel').backgroundColor,
      input: css('#filterSearch').backgroundColor,
      inputBorder: css('#filterSearch').borderTopColor,
      focus: css('#filterSearch').boxShadow,
      modal: css('.filter-dialog').backgroundColor,
      overlay: css('.filter-modal-backdrop').backgroundColor,
      cropShade: css('.crop-box').boxShadow,
      divider: css('#comparisonDivider').backgroundColor,
      disabled: css('#download').backgroundColor,
      disabledText: css('#download').color,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  assert.equal(state.dark, dark);
  assert.ok(
    state.tokens.every(([, value]) => value),
    'all D1 semantic tokens must resolve'
  );
  assert.notEqual(state.page, state.panel, 'page and raised panel must remain distinct');
  if (dark)
    assert.notEqual(state.input, 'rgb(255, 255, 255)', 'dark inputs cannot fall back to white');
  assert.notEqual(state.modal, state.overlay, 'modal and overlay must be distinguishable');
  assert.match(state.focus, /rgb|rgba/, 'focused input must expose a focus ring');
  assert.notEqual(state.disabled, state.panel, 'disabled control needs a distinguishable surface');
  assert.ok(
    state.scrollWidth <= state.clientWidth + 1,
    'theme UI must not create horizontal overflow'
  );
  const screenshot = await page.screenshot();
  assert.ok(screenshot.length > 5000, 'the themed workbench screenshot must not be blank');
}

test('D1 semantic theme surfaces render in Chrome and Edge at desktop and narrow widths', async (t) => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    for (const name of browserNames) {
      const executablePath = browserPaths[name];
      assert.ok(executablePath, `unsupported D1 browser: ${name}`);
      const browser = await chromium.launch({ executablePath, headless: true });
      try {
        for (const viewport of [
          { width: 1440, height: 960 },
          { width: 390, height: 844 },
        ]) {
          for (const dark of [false, true]) {
            await t.test(`${name} ${viewport.width}px ${dark ? 'dark' : 'light'}`, async () => {
              const context = await browser.newContext({ viewport });
              const page = await context.newPage();
              page.themeUrl = `${origin}/color-grade.html`;
              try {
                await inspectTheme(page, dark);
              } finally {
                await context.close();
              }
            });
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    stopServer(server);
  }
});
