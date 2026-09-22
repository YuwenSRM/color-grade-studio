const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const photo = path.join(root, 'uploads', '5aaff1b3-19ab-4a7f-96cc-8b1d4710cbb6.png');
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

function stopServer(server) {
  if (server?.exitCode === null) server.kill();
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function loadWithPaintTrace(page, origin) {
  await page.addInitScript(() => {
    window.__filterIntensityInputs = [];
    window.__filterIntensityPaints = [];
    const originalPutImageData = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (...args) {
      if (this.canvas?.id === 'mainCanvas') window.__filterIntensityPaints.push(performance.now());
      return originalPutImageData.apply(this, args);
    };
    document.addEventListener(
      'input',
      (event) => {
        if (event.target?.id === 'filterIntensityInput')
          window.__filterIntensityInputs.push({
            value: Number(event.target.value),
            time: performance.now(),
          });
      },
      true
    );
  });
  await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
}

async function chooseBuiltinLut(page) {
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(
    () => document.querySelector('#stage').getAttribute('aria-busy') === 'false'
  );
  await page.locator('#filterSearch').fill('柔和肖像');
  await page.locator('#variants .variant').click();
  await page.waitForFunction(() => !document.querySelector('#filterIntensity').hidden);
  await page.waitForTimeout(800);
  await page.locator('#filterIntensityInput').evaluate((input) => {
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#mainCanvas');
    const control = document.querySelector('#filterIntensity');
    return (
      Math.max(canvas.width, canvas.height) === 560 && control.getAttribute('aria-busy') === 'false'
    );
  });
}

test('CPU filter intensity compositor presents sustained cross-frame drags within the interaction budget', async (t) => {
  if (!require('node:fs').existsSync(chrome)) t.skip('Google Chrome is not installed.');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    try {
      await loadWithPaintTrace(page, origin);
      await chooseBuiltinLut(page);
      const idleHeight = await page
        .locator('#filterIntensity')
        .evaluate((node) => node.getBoundingClientRect().height);
      await page.locator('#filterIntensityInput').evaluate((input) => {
        input.value = '51';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(
        () => document.querySelector('#filterIntensity').getAttribute('aria-busy') === 'true'
      );
      const busyState = await page.evaluate(() => ({
        height: document.querySelector('#filterIntensity').getBoundingClientRect().height,
        status: document.querySelector('#filterIntensityStatus').textContent,
        statusRole: document.querySelector('#filterIntensityStatus').getAttribute('role'),
        endpoints: [...document.querySelectorAll('.filter-intensity-endpoint')].map(
          (node) => node.textContent
        ),
      }));
      await page.waitForFunction(
        () => document.querySelector('#filterIntensity').getAttribute('aria-busy') === 'false'
      );
      assert.equal(
        busyState.height,
        idleHeight,
        'busy feedback must not change the control height'
      );
      assert.equal(busyState.status, '预览更新中');
      assert.equal(busyState.statusRole, 'status');
      assert.deepEqual(busyState.endpoints, ['原图 0%', '完整滤镜 100%']);
      await page.evaluate(() => {
        window.__filterIntensityInputs.length = 0;
        window.__filterIntensityPaints.length = 0;
      });

      const beganAt = Date.now();
      let step = 0;
      while (Date.now() - beganAt < 2000) {
        const value = 1 + ((step * 17) % 99);
        await page.locator('#filterIntensityInput').evaluate((input, nextValue) => {
          input.value = String(nextValue);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        step += 1;
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      await page.waitForFunction(
        () => document.querySelector('#filterIntensity').getAttribute('aria-busy') === 'false'
      );
      const trace = await page.evaluate(() => ({
        inputs: window.__filterIntensityInputs,
        paints: window.__filterIntensityPaints,
        value: document.querySelector('#filterIntensityInput').value,
        valueText: document.querySelector('#filterIntensityInput').getAttribute('aria-valuetext'),
        valueNow: document.querySelector('#filterIntensityInput').getAttribute('aria-valuenow'),
        canvasEdge: Math.max(
          document.querySelector('#mainCanvas').width,
          document.querySelector('#mainCanvas').height
        ),
      }));
      assert.ok(
        trace.inputs.length >= 55,
        `expected cross-frame inputs for two seconds, got ${trace.inputs.length}`
      );
      assert.ok(
        trace.paints.length >= 60,
        `expected at least 30 canvas commits/sec, got ${trace.paints.length}`
      );
      assert.equal(trace.canvasEdge, 560, 'dragging must keep the fixed 560px interaction frame');
      assert.equal(trace.valueText, `${trace.value}%`);
      assert.equal(trace.valueNow, trace.value);

      const latency = trace.inputs.map((input) => {
        const paint = trace.paints.find((time) => time >= input.time);
        return paint == null ? Infinity : paint - input.time;
      });
      const paintGaps = trace.paints.slice(1).map((time, index) => time - trace.paints[index]);
      assert.ok(
        percentile(latency, 0.95) <= 50,
        `input-to-paint p95 was ${percentile(latency, 0.95)}ms`
      );
      assert.ok(Math.max(...paintGaps) <= 100, `canvas commit gap was ${Math.max(...paintGaps)}ms`);
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
});

test('rapid LUT intensity changes ending at 100% retain a visible preview through the 560px to 1100px handoff', async (t) => {
  if (!require('node:fs').existsSync(chrome)) t.skip('Google Chrome is not installed.');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    try {
      await loadWithPaintTrace(page, origin);
      await chooseBuiltinLut(page);
      await page.evaluate(() => {
        window.__lutIntensityCommits = [];
        document.addEventListener('color-grade-preview-commit', (event) => {
          window.__lutIntensityCommits.push(event.detail);
        });
      });

      // Reproduce a drag that invalidates settled 100% work twice before its
      // final pointerup/change request. The last value must own the display.
      await page.locator('#filterIntensityInput').evaluate((input) => {
        for (const value of [100, 20, 100, 50, 100]) {
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        input.dispatchEvent(new Event('pointerup', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await page.waitForFunction(
        () => {
          const canvas = document.querySelector('#mainCanvas');
          const control = document.querySelector('#filterIntensity');
          return (
            document.querySelector('#filterIntensityInput').value === '100' &&
            Math.max(canvas.width, canvas.height) === 1100 &&
            control.getAttribute('aria-busy') === 'false'
          );
        },
        { timeout: 15000 }
      );

      const result = await page.evaluate(() => {
        const canvas = document.querySelector('#mainCanvas');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let opaqueSamples = 0;
        let coloredSamples = 0;
        for (let index = 0; index < pixels.length; index += 4096) {
          if (pixels[index + 3] > 0) opaqueSamples += 1;
          if (pixels[index] || pixels[index + 1] || pixels[index + 2]) coloredSamples += 1;
        }
        const style = getComputedStyle(canvas);
        return {
          busy: document.querySelector('#filterIntensity').getAttribute('aria-busy'),
          value: document.querySelector('#filterIntensityInput').value,
          width: canvas.width,
          height: canvas.height,
          display: style.display,
          visibility: style.visibility,
          opaqueSamples,
          coloredSamples,
          commits: window.__lutIntensityCommits,
        };
      });

      assert.equal(result.value, '100');
      assert.equal(result.busy, 'false');
      assert.equal(Math.max(result.width, result.height), 1100);
      assert.notEqual(result.display, 'none');
      assert.notEqual(result.visibility, 'hidden');
      assert.ok(result.opaqueSamples > 0, 'settled preview canvas must contain visible pixels');
      assert.ok(result.coloredSamples > 0, 'settled preview canvas must not be blank');
      assert.ok(
        result.commits.some((commit) => commit.limit === 560 && commit.intensity === 1),
        'the final 100% request must first present an interaction-resolution frame'
      );
      assert.ok(
        result.commits.some((commit) => commit.limit === 1100 && commit.intensity === 1),
        'the final 100% request must replace it with the high-quality frame'
      );
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
});

test('filter intensity preview geometry remains stable across backing-buffer changes', async (t) => {
  if (!require('node:fs').existsSync(chrome)) t.skip('Google Chrome is not installed.');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    try {
      await loadWithPaintTrace(page, origin);
      await chooseBuiltinLut(page);
      const visibleRect = (selector) =>
        page.locator(selector).evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        });
      const interactionRect = await visibleRect('#mainCanvas');

      await page.locator('#filterIntensityInput').evaluate((input) => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#mainCanvas');
        return Math.max(canvas.width, canvas.height) === 1100;
      });
      assert.deepEqual(
        await visibleRect('#mainCanvas'),
        interactionRect,
        'the 1100px settled preview must retain the 560px interaction display box'
      );

      await page.locator('#filterIntensityInput').evaluate((input) => {
        input.value = '51';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#mainCanvas');
        return Math.max(canvas.width, canvas.height) === 560;
      });
      assert.deepEqual(
        await visibleRect('#mainCanvas'),
        interactionRect,
        'returning to the 560px preview must not move or resize the display box'
      );

      for (const id of ['#compareOriginal', '#compareSplitVertical', '#compareSplitHorizontal']) {
        await page.locator(id).click();
        const rectangles = await page.evaluate(() => {
          const rect = (node) => {
            const box = node.getBoundingClientRect();
            return { left: box.left, top: box.top, width: box.width, height: box.height };
          };
          return {
            main: rect(document.querySelector('#mainCanvas')),
            comparison: rect(document.querySelector('#comparisonCanvas')),
            divider: rect(document.querySelector('#comparisonDivider')),
            mode: document.querySelector('#stage').dataset.comparison,
          };
        });
        assert.deepEqual(
          rectangles.comparison,
          rectangles.main,
          `${rectangles.mode} comparison canvas must share the main preview box`
        );
        if (rectangles.mode === 'vertical') {
          assert.equal(rectangles.divider.height, rectangles.main.height);
        } else if (rectangles.mode === 'horizontal') {
          assert.equal(rectangles.divider.width, rectangles.main.width);
        }
      }
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
});

test('filter intensity endpoints and status remain visible across supported layouts and scaling', async (t) => {
  if (!require('node:fs').existsSync(chrome)) t.skip('Google Chrome is not installed.');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
      for (const width of [280, 320, 390, 520, 1440]) {
        for (const zoom of [1, 1.25, 1.5]) {
          await t.test(`${width}px at ${Math.round(zoom * 100)}%`, async () => {
            // Browser zoom reduces the CSS layout viewport. Model that relationship
            // directly so media queries exercise the layout users actually receive.
            const context = await browser.newContext({
              viewport: { width: Math.round(width / zoom), height: 960 },
              deviceScaleFactor: zoom,
            });
            const page = await context.newPage();
            try {
              await loadWithPaintTrace(page, origin);
              await chooseBuiltinLut(page);
              const layout = await page.evaluate(() => {
                const panel = document.querySelector('#filterIntensity');
                const input = document.querySelector('#filterIntensityInput');
                const endpoints = [...panel.querySelectorAll('.filter-intensity-endpoint')];
                const visible = (node) => {
                  const rect = node.getBoundingClientRect();
                  const style = getComputedStyle(node);
                  return {
                    display: style.display,
                    width: rect.width,
                    height: rect.height,
                    left: rect.left,
                    right: rect.right,
                  };
                };
                return {
                  viewport: document.documentElement.clientWidth,
                  panel: visible(panel),
                  input: visible(input),
                  endpoints: endpoints.map(visible),
                  status: visible(document.querySelector('#filterIntensityStatus')),
                };
              });
              for (const element of [
                layout.panel,
                layout.input,
                layout.status,
                ...layout.endpoints,
              ]) {
                assert.notEqual(element.display, 'none');
                assert.ok(
                  element.width > 0 && element.height > 0,
                  'intensity controls must be visible'
                );
                assert.ok(
                  element.left >= -1 && element.right <= layout.viewport + 1,
                  'controls must fit viewport'
                );
              }
            } finally {
              await context.close();
            }
          });
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
});
