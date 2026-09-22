'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
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

async function chooseParameterPreset(page) {
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(
    () => document.querySelector('#stage').getAttribute('aria-busy') === 'false'
  );
  await page.locator('#filterSearch').fill('高原自然');
  await page.locator('#variants .variant').click();
  await page.waitForTimeout(800);
  const renderer = await page.locator('#stage').evaluate((stage) => ({
    renderer: stage.dataset.interactiveRenderer,
    selected: document.querySelector('#variants .variant')?.getAttribute('aria-pressed'),
    canvas: document.querySelector('#interactiveCanvas').getContext('webgl') !== null,
    maxDifference: document.querySelector('#interactiveCanvas').dataset.webglMaximumDifference,
  }));
  assert.equal(renderer.renderer, 'webgl', JSON.stringify(renderer));
}

test('WebGL parameter preview uses a stable overlay, uploads source once, and falls back after context loss', async (t) => {
  if (!fs.existsSync(chrome)) t.skip('Google Chrome is not installed.');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
      await chooseParameterPreset(page);
      const before = await page.evaluate(() => {
        const main = document.querySelector('#mainCanvas').getBoundingClientRect();
        const gpu = document.querySelector('#interactiveCanvas').getBoundingClientRect();
        return {
          main: { width: main.width, height: main.height, left: main.left, top: main.top },
          gpu: { width: gpu.width, height: gpu.height, left: gpu.left, top: gpu.top },
          uploads: Number(document.querySelector('#interactiveCanvas').dataset.webglSourceUploads),
          draws: Number(document.querySelector('#interactiveCanvas').dataset.webglDraws),
        };
      });
      assert.deepEqual(before.gpu, before.main, 'GPU overlay must occupy the existing preview box');
      const orientation = await page.evaluate(() => {
        const source = {
          width: 2,
          height: 2,
          data: new Uint8ClampedArray([
            255,
            0,
            0,
            255, // top-left: red
            0,
            255,
            0,
            255, // top-right: green
            0,
            0,
            255,
            255, // bottom-left: blue
            255,
            255,
            0,
            255, // bottom-right: yellow
          ]),
        };
        const profile = { b: 1, c: 1, s: 1, w: 1, t: 0 };
        const settings = { toneModel: 'standard-v2', delta: {} };
        const canvas = document.createElement('canvas');
        const preview = window.ColorGradeWebglPreview.create(canvas);
        const request = { source, profile, settings, intensity: 1 };
        const drawn = preview.draw(request);
        const visible = document.createElement('canvas');
        visible.width = source.width;
        visible.height = source.height;
        visible.getContext('2d').drawImage(canvas, 0, 0);
        const pixels = visible
          .getContext('2d')
          .getImageData(0, 0, source.width, source.height).data;
        const corner = (x, y) =>
          Array.from(pixels.slice((y * source.width + x) * 4, (y * source.width + x + 1) * 4));
        const result = {
          drawn,
          verified: preview.verify(window.ColorGradeRenderer, request),
          corners: {
            topLeft: corner(0, 0),
            topRight: corner(1, 0),
            bottomLeft: corner(0, 1),
            bottomRight: corner(1, 1),
          },
        };
        preview.dispose();
        return result;
      });
      assert.equal(orientation.drawn, true);
      assert.equal(orientation.verified, true);
      assert.deepEqual(orientation.corners, {
        topLeft: [255, 0, 0, 255],
        topRight: [0, 255, 0, 255],
        bottomLeft: [0, 0, 255, 255],
        bottomRight: [255, 255, 0, 255],
      });
      const golden = await page.evaluate(() => {
        const source = { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4) };
        for (let index = 0; index < source.data.length; index += 4) {
          source.data[index] = (index * 29) % 256;
          source.data[index + 1] = (index * 47) % 256;
          source.data[index + 2] = (index * 71) % 256;
          source.data[index + 3] = index % 12 === 0 ? 127 : 255;
        }
        const profile = { b: 1.07, c: 1.11, s: 0.84, w: 1.13, t: -17 };
        const scenarios = [
          {
            toneModel: 'standard-v2',
            delta: {
              exposure: 17,
              contrast: -22,
              highlights: 46,
              shadows: -31,
              black: 13,
              saturation: 24,
              vibrance: 42,
              temperature: -18,
              tint: 22,
              clarity: 31,
            },
          },
          {
            toneModel: 'standard-v2',
            delta: {
              exposure: -63,
              contrast: 81,
              highlights: -59,
              shadows: 72,
              black: -44,
              saturation: -75,
              vibrance: 88,
              temperature: 64,
              tint: -57,
              clarity: -43,
            },
          },
          {
            toneModel: 'standard-v2',
            delta: {
              exposure: 9,
              contrast: 14,
              highlights: 28,
              shadows: -19,
              black: 6,
              saturation: 11,
              vibrance: 33,
              temperature: 7,
              tint: -8,
              clarity: 16,
            },
            gradingModel: 'studio-v2',
            grading: {
              shadows: { hue: 238, saturation: 76, lightness: -22, intensity: 58 },
              midtones: { hue: 119, saturation: 43, lightness: 11, intensity: 41 },
              highlights: { hue: 38, saturation: 82, lightness: 17, intensity: 67 },
              balance: -26,
            },
          },
        ];
        return scenarios.map((settings, index) => {
          const canvas = document.createElement('canvas');
          const preview = window.ColorGradeWebglPreview.create(canvas);
          const request = { source, profile, settings, intensity: index === 1 ? 0.63 : 1 };
          const ok = preview.draw(request) && preview.verify(window.ColorGradeRenderer, request);
          const maximumDifference = Number(canvas.dataset.webglMaximumDifference);
          preview.dispose();
          return { ok, maximumDifference };
        });
      });
      for (const result of golden) {
        assert.equal(result.ok, true, `GPU golden mismatch: ${JSON.stringify(result)}`);
        assert.ok(
          result.maximumDifference <= 3,
          `GPU maximum difference was ${result.maximumDifference}`
        );
      }

      await page.evaluate(() => {
        const stage = document.querySelector('#stage');
        const main = document.querySelector('#mainCanvas');
        const gpu = document.querySelector('#interactiveCanvas');
        window.__previewLayerTransitions = [];
        window.__previewLayerObserver = new MutationObserver((records) => {
          for (const record of records) {
            window.__previewLayerTransitions.push({
              target: record.target.id,
              attribute: record.attributeName,
              oldValue: record.oldValue,
              value: record.target.getAttribute(record.attributeName),
            });
          }
        });
        window.__previewLayerObserver.observe(stage, {
          attributes: true,
          attributeFilter: ['data-interactive-renderer'],
          attributeOldValue: true,
        });
        window.__previewLayerObserver.observe(main, {
          attributes: true,
          attributeFilter: ['style'],
          attributeOldValue: true,
        });
        window.__previewLayerObserver.observe(gpu, {
          attributes: true,
          attributeFilter: ['class'],
          attributeOldValue: true,
        });
      });

      for (const [id, value] of [
        ['exposure', 8],
        ['contrast', 19],
        ['shadowHue', 235],
        ['shadowAmt', 38],
        ['gradeBalance', -22],
      ]) {
        await page.locator(`#${id}`).evaluate((input, next) => {
          input.value = String(next);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
      }
      await page.waitForFunction(
        (draws) => Number(document.querySelector('#interactiveCanvas').dataset.webglDraws) > draws,
        before.draws
      );
      await page.evaluate(() => window.__previewLayerObserver.disconnect());
      const transitions = await page.evaluate(() => window.__previewLayerTransitions);
      assert.equal(
        transitions.some(
          (transition) =>
            transition.target === 'interactiveCanvas' &&
            transition.attribute === 'class' &&
            /(^|\\s)is-active(\\s|$)/.test(transition.oldValue || '') &&
            !/(^|\\s)is-active(\\s|$)/.test(transition.value || '')
        ),
        false,
        `parameter input must not remove the GPU overlay: ${JSON.stringify(transitions)}`
      );
      assert.equal(
        transitions.some(
          (transition) =>
            transition.target === 'mainCanvas' &&
            transition.attribute === 'style' &&
            /visibility\\s*:\\s*hidden/i.test(transition.oldValue || '') &&
            !/visibility\\s*:\\s*hidden/i.test(transition.value || '')
        ),
        false,
        `parameter input must not reveal the CPU canvas: ${JSON.stringify(transitions)}`
      );
      assert.equal(
        transitions.some(
          (transition) =>
            transition.target === 'stage' &&
            transition.attribute === 'data-interactive-renderer' &&
            transition.value === 'cpu'
        ),
        false,
        `parameter input must not switch renderers: ${JSON.stringify(transitions)}`
      );

      await page.locator('#filterIntensityInput').evaluate((input) => {
        input.value = '63';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(
        () => document.querySelector('#stage').dataset.interactiveRenderer === 'webgl'
      );
      const after = await page.evaluate(() => ({
        main: document.querySelector('#mainCanvas').getBoundingClientRect().toJSON(),
        gpu: document.querySelector('#interactiveCanvas').getBoundingClientRect().toJSON(),
        uploads: Number(document.querySelector('#interactiveCanvas').dataset.webglSourceUploads),
        draws: Number(document.querySelector('#interactiveCanvas').dataset.webglDraws),
        maximumDifference: Number(
          document.querySelector('#interactiveCanvas').dataset.webglMaximumDifference
        ),
      }));
      assert.equal(after.uploads, before.uploads, 'adjustments must not re-upload S560');
      assert.ok(
        after.draws > before.draws,
        'each interaction frame must draw with updated uniforms'
      );
      assert.equal(after.gpu.width, after.main.width);
      assert.equal(after.gpu.height, after.main.height);
      assert.equal(after.gpu.left, after.main.left);
      assert.equal(after.gpu.top, after.main.top);
      assert.ok(
        after.maximumDifference <= 3,
        `GPU maximum difference was ${after.maximumDifference}`
      );

      await page.locator('#interactiveCanvas').evaluate((canvas) => {
        canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      });
      await page.waitForFunction(
        () => document.querySelector('#stage').dataset.interactiveRenderer === 'cpu'
      );
      const fallback = await page.evaluate(() => ({
        gpuActive: document.querySelector('#interactiveCanvas').classList.contains('is-active'),
        mainVisibility: document.querySelector('#mainCanvas').style.visibility,
        width: document.querySelector('#mainCanvas').width,
      }));
      assert.equal(fallback.gpuActive, false);
      assert.equal(fallback.mainVisibility, '');
      assert.equal(fallback.width, 560, 'context-loss fallback keeps the interaction resolution');
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    if (server.exitCode === null) server.kill();
  }
});

test('WebGL creation failure retains the existing CPU interaction endpoint', async (t) => {
  if (!fs.existsSync(chrome)) t.skip('Google Chrome is not installed.');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => {
        const native = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          if (this.id === 'interactiveCanvas' && type === 'webgl') return null;
          return native.call(this, type, ...args);
        };
      });
      await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
      await page.locator('#fileInput').setInputFiles(photo);
      await page.waitForFunction(
        () => document.querySelector('#stage').getAttribute('aria-busy') === 'false'
      );
      await page.locator('#filterSearch').fill('高原自然');
      await page.locator('#variants .variant').click();
      await page.waitForFunction(() => document.querySelector('#mainCanvas').width === 560);
      const state = await page.evaluate(() => ({
        renderer: document.querySelector('#stage').dataset.interactiveRenderer,
        gpuActive: document.querySelector('#interactiveCanvas').classList.contains('is-active'),
        mainVisibility: document.querySelector('#mainCanvas').style.visibility,
      }));
      assert.notEqual(state.renderer, 'webgl');
      assert.equal(state.gpuActive, false);
      assert.equal(state.mainVisibility, '');
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    if (server.exitCode === null) server.kill();
  }
});

test('a missing standalone-style WebGL runtime keeps the CPU preview usable', async (t) => {
  if (!fs.existsSync(chrome)) t.skip('Google Chrome is not installed.');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.route('**/assets/color-grade/color-grade-webgl-preview.js', (route) =>
      route.abort()
    );
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
      await page.locator('#fileInput').setInputFiles(photo);
      await page.waitForFunction(
        () => document.querySelector('#stage').getAttribute('aria-busy') === 'false'
      );
      await page.locator('#filterSearch').fill('高原自然');
      await page.locator('#variants .variant').click();
      await page.waitForFunction(() => document.querySelector('#mainCanvas').width === 560);
      const state = await page.evaluate(() => ({
        api: typeof window.ColorGradeWebglPreview,
        renderer: document.querySelector('#stage').dataset.interactiveRenderer,
        gpuActive: document.querySelector('#interactiveCanvas').classList.contains('is-active'),
      }));
      assert.equal(state.api, 'undefined');
      assert.notEqual(state.renderer, 'webgl');
      assert.equal(state.gpuActive, false);
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    if (server.exitCode === null) server.kill();
  }
});
