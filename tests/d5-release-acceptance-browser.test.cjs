'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const screenshotDirectory = path.join(__dirname, 'artifacts', 'd5-release');
const photo = path.join(root, 'uploads', '5aaff1b3-19ab-4a7f-96cc-8b1d4710cbb6.png');
const browserPaths = Object.freeze({
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
});
const browserNames = (process.env.D5_BROWSERS || 'chrome,edge')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const viewports = [
  { width: 1440, height: 960, name: 'desktop' },
  { width: 390, height: 844, name: 'narrow' },
];

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

async function loadWorkbench(page, origin, dark) {
  await page.addInitScript(
    ({ isDark }) => {
      localStorage.setItem('landscape-theme', isDark ? 'dark' : 'light');
      const NativeWorker = window.Worker;
      window.__d5WorkerPosts = [];
      window.__d5WorkerInstances = 0;
      window.Worker = function WorkerTracer(...args) {
        window.__d5WorkerInstances += 1;
        const worker = new NativeWorker(...args);
        const postMessage = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer) => {
          window.__d5WorkerPosts.push(message?.type || 'unknown');
          return transfer === undefined ? postMessage(message) : postMessage(message, transfer);
        };
        return worker;
      };
    },
    { isDark: dark }
  );
  await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
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
  await page.waitForFunction(
    () =>
      !document.querySelector('#filterIntensity').hidden &&
      document.querySelector('#mainCanvas').width > 1
  );
}

async function setLutIntensity(page, value) {
  await page.locator('#filterIntensityInput').evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForFunction(
    (nextValue) => document.querySelector('#filterIntensityValue').textContent === `${nextValue}%`,
    value
  );
}

async function setLutInteractionIntensity(page, value) {
  await page.locator('#filterIntensityInput').evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.waitForFunction(
    (nextValue) => document.querySelector('#filterIntensityValue').textContent === `${nextValue}%`,
    value
  );
}

async function captureLutSamples(page, maximum = 96) {
  return page.evaluate((limit) => {
    const effectCanvas = document.querySelector('#mainCanvas');
    const sourceCanvas = document.querySelector('#comparisonCanvas');
    const effect = effectCanvas
      .getContext('2d')
      .getImageData(0, 0, effectCanvas.width, effectCanvas.height).data;
    const source = sourceCanvas
      .getContext('2d')
      .getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
    const samples = [];
    for (let index = 0; index < source.length && samples.length < limit; index += 4) {
      if (
        source[index] !== effect[index] ||
        source[index + 1] !== effect[index + 1] ||
        source[index + 2] !== effect[index + 2]
      )
        samples.push([
          index,
          source[index],
          source[index + 1],
          source[index + 2],
          source[index + 3],
          effect[index],
          effect[index + 1],
          effect[index + 2],
          effect[index + 3],
        ]);
    }
    return samples;
  }, maximum);
}

async function waitForSamplePixels(page, expectedSamples, tolerance = 0) {
  await page.waitForFunction(
    ({ samples: nextSamples, allowedDifference }) => {
      const canvas = document.querySelector('#mainCanvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return nextSamples.every(([offset, red, green, blue, alpha]) =>
        [red, green, blue, alpha].every(
          (expectedValue, channel) =>
            Math.abs(pixels[offset + channel] - expectedValue) <= allowedDifference
        )
      );
    },
    { samples: expectedSamples, allowedDifference: tolerance },
    { timeout: 5000 }
  );
}

async function assertVisibleControlsFit(page) {
  const issues = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const selector = [
      'button:not([hidden]):not(:disabled)',
      'input:not([type="file"]):not([hidden]):not(:disabled)',
      'select:not([hidden]):not(:disabled)',
      'summary:not([hidden])',
      '[role="slider"]:not([hidden])',
    ].join(',');
    return [...document.querySelectorAll(selector)].flatMap((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        rect.width === 0 ||
        rect.height === 0
      )
        return [];
      const outside = rect.left < -1 || rect.right > viewportWidth + 1;
      const clippedText =
        node.scrollWidth > node.clientWidth + 2 && node.textContent.trim().length > 0;
      return outside || clippedText
        ? [{ id: node.id || node.className, outside, clippedText }]
        : [];
    });
  });
  assert.deepEqual(
    issues,
    [],
    `visible controls must fit their viewport: ${JSON.stringify(issues)}`
  );
}

test('D5 release matrix captures Chrome and Edge workbench states and keeps accessible controls reachable', async (t) => {
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    for (const name of browserNames) {
      const executablePath = browserPaths[name];
      assert.ok(executablePath, `unsupported D5 browser: ${name}`);
      const browser = await chromium.launch({ executablePath, headless: true });
      try {
        for (const viewport of viewports) {
          for (const dark of [false, true]) {
            await t.test(
              `${name} ${viewport.name} ${dark ? 'dark' : 'light'} screenshot and accessibility`,
              async () => {
                const context = await browser.newContext({ viewport });
                const page = await context.newPage();
                try {
                  await loadWorkbench(page, origin, dark);
                  await importPhoto(page);
                  await page.evaluate(() =>
                    document.querySelector('#canvasTools').classList.add('show')
                  );
                  if (viewport.width < 600) await page.locator('#showAdjustmentsPanel').click();
                  await assertVisibleControlsFit(page);
                  const state = await page.evaluate(() => ({
                    bodyDark: document.body.classList.contains('dark'),
                    scrollWidth: document.documentElement.scrollWidth,
                    clientWidth: document.documentElement.clientWidth,
                    presetRole: document.querySelector('#presetPanel').getAttribute('role'),
                    adjustmentRole: document
                      .querySelector('#adjustmentsPanel')
                      .getAttribute('role'),
                    libraryControls: document
                      .querySelector('#showPresetPanel')
                      .getAttribute('aria-controls'),
                    adjustmentPressed: document
                      .querySelector('#showAdjustmentsPanel')
                      .getAttribute('aria-pressed'),
                    menuRole: document.querySelector('#libraryMenu').getAttribute('role'),
                    menuLabel: document.querySelector('#libraryMenu').getAttribute('aria-label'),
                    dividerRole: document.querySelector('#comparisonDivider').getAttribute('role'),
                    dividerLabel: document
                      .querySelector('#comparisonDivider')
                      .getAttribute('aria-label'),
                    comparePressed: [...document.querySelectorAll('.compare-controls button')].map(
                      (button) => button.getAttribute('aria-pressed')
                    ),
                  }));
                  assert.equal(state.bodyDark, dark);
                  assert.ok(
                    state.scrollWidth <= state.clientWidth + 1,
                    'page must not overflow horizontally'
                  );
                  assert.deepEqual(
                    [state.presetRole, state.adjustmentRole, state.libraryControls],
                    [null, 'tabpanel', 'lutLibrary']
                  );
                  assert.equal(
                    state.adjustmentPressed,
                    viewport.width < 600 ? 'true' : 'false',
                    'only the mobile adjustment control represents an expanded panel'
                  );
                  assert.deepEqual(
                    [state.menuRole, state.menuLabel],
                    ['group', '我的 LUT 管理菜单']
                  );
                  assert.deepEqual(
                    [state.dividerRole, state.dividerLabel],
                    ['slider', '调色前后分割位置']
                  );
                  assert.deepEqual(state.comparePressed, ['true', 'false', 'false', 'false']);
                  // The narrow layout intentionally hides preset controls after switching to adjustments.
                  const focusTargets =
                    viewport.width < 600
                      ? ['#showAdjustmentsPanel', '#exposure', '#gradeBalance']
                      : ['#filterSearch', '#compareEffect', '#libraryMenuToggle'];
                  for (const selector of focusTargets) {
                    await page.locator(selector).focus();
                    assert.equal(
                      await page
                        .locator(selector)
                        .evaluate((node) => document.activeElement === node),
                      true
                    );
                  }
                  const screenshot = path.join(
                    screenshotDirectory,
                    `${name}-${viewport.width}-${dark ? 'dark' : 'light'}.png`
                  );
                  await page.screenshot({ path: screenshot, fullPage: false });
                  assert.ok(
                    fs.statSync(screenshot).size > 5000,
                    'screenshot must contain rendered UI'
                  );
                } finally {
                  await context.close();
                }
              }
            );
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

test('D5 comparison is display-only and a rapid LUT strength drag coalesces Worker preview work', async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: browserPaths.chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    try {
      await loadWorkbench(page, origin, false);
      await importPhoto(page);
      await selectBuiltinLut(page);
      // Let the initial selection and visible thumbnail work settle before measuring
      // commands triggered by comparison or the intensity control.
      await page.waitForTimeout(1000);
      await setLutInteractionIntensity(page, 0);
      await page.waitForFunction(
        () =>
          Math.max(
            document.querySelector('#mainCanvas').width,
            document.querySelector('#mainCanvas').height
          ) === 560
      );
      const sourceSamples = await page.evaluate(() => {
        const canvas = document.querySelector('#mainCanvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const step = Math.max(4, Math.floor(data.length / 96 / 4) * 4);
        return Array.from({ length: 96 }, (_, index) => {
          const offset = Math.min(data.length - 4, index * step);
          return [offset, data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
        });
      });

      await setLutInteractionIntensity(page, 100);
      const effectSamples = await page.evaluate((samples) => {
        const canvas = document.querySelector('#mainCanvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return samples.map(([offset]) => [
          offset,
          data[offset],
          data[offset + 1],
          data[offset + 2],
          data[offset + 3],
        ]);
      }, sourceSamples);
      assert.ok(
        effectSamples.some((sample, index) =>
          sample.slice(1, 4).some((value, channel) => value !== sourceSamples[index][channel + 1])
        ),
        'the selected LUT must visibly differ from the 560px source endpoint'
      );

      const midpoint = sourceSamples.map(([offset, red, green, blue, alpha], index) => [
        offset,
        red + (effectSamples[index][1] - red) * 0.5,
        green + (effectSamples[index][2] - green) * 0.5,
        blue + (effectSamples[index][3] - blue) * 0.5,
        alpha,
      ]);
      await setLutInteractionIntensity(page, 50);
      await waitForSamplePixels(page, midpoint, 1);
      await page.evaluate(() => {
        window.__d5WorkerPosts.length = 0;
      });
      for (const selector of [
        '#compareOriginal',
        '#compareSplitVertical',
        '#compareSplitHorizontal',
        '#compareEffect',
      ]) {
        await page.locator(selector).click();
      }
      await page.waitForTimeout(100);
      assert.deepEqual(
        await page.evaluate(() =>
          window.__d5WorkerPosts.filter((type) => ['set-source', 'render'].includes(type))
        ),
        [],
        'comparison must only change display state and cannot request a new LUT render'
      );

      await page.locator('#filterIntensityInput').evaluate((input) => {
        for (const value of ['90', '72', '51', '33']) {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(
        () => document.querySelector('#filterIntensityValue').textContent === '33%'
      );
      await page.waitForTimeout(600);
      const previewMessages = await page.evaluate(() =>
        window.__d5WorkerPosts.filter((type) => ['set-source', 'render'].includes(type))
      );
      assert.ok(
        previewMessages.length <= 2,
        `rapid drag must emit one final preview: ${previewMessages}`
      );
      assert.deepEqual(previewMessages, ['set-source', 'render']);
      await page.waitForFunction(
        () =>
          Math.max(
            document.querySelector('#mainCanvas').width,
            document.querySelector('#mainCanvas').height
          ) === 1100
      );
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
});

test('D5 LUT endpoint cache survives filter switches, while crop and Worker restart use fresh revisions', async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: browserPaths.chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    try {
      await loadWorkbench(page, origin, false);
      await importPhoto(page);
      await selectBuiltinLut(page);
      await page.waitForTimeout(700);

      await page.evaluate(() => (window.__d5WorkerPosts.length = 0));
      await page.locator('#filterSearch').fill('清澈风景');
      await page.locator('#variants .variant').click();
      await page.waitForTimeout(500);
      const firstSwitch = await page.evaluate(() => [...window.__d5WorkerPosts]);
      assert.ok(
        firstSwitch.includes('validate-lut'),
        'a newly selected LUT must create an endpoint'
      );

      await page.evaluate(() => (window.__d5WorkerPosts.length = 0));
      await setLutInteractionIntensity(page, 0);
      await setLutInteractionIntensity(page, 100);
      await page.waitForTimeout(100);
      assert.deepEqual(
        await page.evaluate(() => window.__d5WorkerPosts),
        [],
        'a cached S560/F560 endpoint must mix strength changes without new Worker work'
      );

      await page.locator('#filterSearch').fill('柔和肖像');
      await page.locator('#variants .variant').click();
      await page.waitForTimeout(500);
      assert.ok(
        await page.evaluate(() => window.__d5WorkerPosts.includes('render')),
        'switching filters must establish a fresh, current content revision'
      );

      await page.evaluate(() => (window.__d5WorkerPosts.length = 0));
      await page.locator('#zoomIn').click();
      await page.waitForFunction(
        () =>
          window.__d5WorkerPosts.filter((type) => ['set-source', 'render'].includes(type)).length >=
          2
      );
      assert.equal(
        await page.evaluate(() => Math.max(mainCanvas.width, mainCanvas.height) < 1100),
        true,
        'a crop revision must commit its newly cropped endpoint rather than the old full frame'
      );

      const workersBeforeRestart = await page.evaluate(() => window.__d5WorkerInstances);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.__d5WorkerPosts.length = 0;
      });
      await page.locator('#variants .variant').click();
      await page.waitForFunction(
        (previousCount) => window.__d5WorkerInstances > previousCount,
        workersBeforeRestart
      );
      await page.waitForFunction(() => window.__d5WorkerPosts.includes('render'));
      assert.ok(
        await page.evaluate(() => window.__d5WorkerPosts.includes('validate-lut')),
        'a restarted Worker must rebuild its content-addressed transform before rendering'
      );
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
});
