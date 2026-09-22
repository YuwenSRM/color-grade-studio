'use strict';

// Records the pre-refactor source/standalone behavior used by the realtime-sync plan.
// Keep this independent of implementation details so later phases can compare against it.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'tests', 'artifacts', 'color-grade-ui-realtime-baseline');
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

function startSourceServer(port) {
  return spawn(process.execPath, ['serve.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

function startStandaloneServer(port) {
  return spawn(process.execPath, ['scripts/serve-standalone.cjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function stop(server) {
  if (server?.exitCode === null) server.kill();
}

function endpointPixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#mainCanvas');
    const { width, height } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let hash = 2166136261;
    for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
    const point = (x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x + 1) * 4));
    return {
      width,
      height,
      rgba: {
        topLeft: point(0, 0),
        center: point(Math.floor(width / 2), Math.floor(height / 2)),
        bottomRight: point(width - 1, height - 1),
      },
      fnv1a32: (hash >>> 0).toString(16).padStart(8, '0'),
    };
  });
}

async function setIntensity(page, value) {
  await page.locator('#filterIntensityInput').evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.waitForFunction((nextValue) => {
    const input = document.querySelector('#filterIntensityInput');
    const control = document.querySelector('#filterIntensity');
    return input.value === String(nextValue) && control.getAttribute('aria-busy') === 'false';
  }, value);
  return endpointPixels(page);
}

async function selectReferenceLut(page) {
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(
    () => document.querySelector('#stage').getAttribute('aria-busy') === 'false'
  );
  await page.locator('#filterSearch').fill('柔和肖像');
  await page.locator('#variants .variant').click();
  await page.waitForFunction(() => !document.querySelector('#filterIntensity').hidden);
  await page.waitForFunction(
    () =>
      Math.max(
        document.querySelector('#mainCanvas').width,
        document.querySelector('#mainCanvas').height
      ) === 560
  );
  await page.waitForTimeout(150);
}

async function collect(name, origin, route, browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      window.__colorGradeBaseline = { events: Object.create(null), canvasCommits: 0 };
      const originalPutImageData = CanvasRenderingContext2D.prototype.putImageData;
      CanvasRenderingContext2D.prototype.putImageData = function (...args) {
        if (this.canvas?.id === 'mainCanvas') window.__colorGradeBaseline.canvasCommits += 1;
        return originalPutImageData.apply(this, args);
      };
      document.addEventListener(
        'input',
        (event) => {
          const id = event.target?.id;
          if (id)
            window.__colorGradeBaseline.events[id] =
              (window.__colorGradeBaseline.events[id] || 0) + 1;
        },
        true
      );
    });
    await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    await selectReferenceLut(page);
    await page.evaluate(() => {
      window.__colorGradeBaseline.events = Object.create(null);
      window.__colorGradeBaseline.canvasCommits = 0;
    });

    const endpoints = {};
    for (const value of [0, 50, 100]) endpoints[`${value}%`] = await setIntensity(page, value);

    // These representative operations define the pre-refactor event baseline without
    // introducing change/pointerup high-quality work into the endpoint samples above.
    for (const [id, value] of [
      ['exposure', 12],
      ['shadowHue', 218],
      ['gradeBalance', -18],
    ]) {
      await page.locator(`#${id}`).evaluate((input, nextValue) => {
        input.value = String(nextValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(250);

    const result = await page.evaluate(() => ({
      canvas: {
        width: document.querySelector('#mainCanvas').width,
        height: document.querySelector('#mainCanvas').height,
      },
      endpointStatus: document.querySelector('#filterIntensity').getAttribute('aria-busy'),
      eventCounts: window.__colorGradeBaseline.events,
      canvasCommits: window.__colorGradeBaseline.canvasCommits,
      selectedFilter: document.querySelector('#previewName').textContent,
    }));
    result.endpoints = endpoints;
    await page.screenshot({ path: path.join(artifacts, `${name}-1440.png`), fullPage: true });
    return result;
  } finally {
    await context.close();
  }
}

async function main() {
  assert.ok(fs.existsSync(chrome), `Chrome is required at ${chrome}`);
  assert.ok(fs.existsSync(photo), `Baseline image is missing: ${photo}`);
  assert.ok(
    fs.existsSync(path.join(root, 'dist', 'standalone', 'index.html')),
    'Standalone output is missing. Run npm run build:standalone first.'
  );
  fs.mkdirSync(artifacts, { recursive: true });
  const sourcePort = await freePort();
  const standalonePort = await freePort();
  const source = startSourceServer(sourcePort);
  const standalone = startStandaloneServer(standalonePort);
  const sourceOrigin = `http://127.0.0.1:${sourcePort}`;
  const standaloneOrigin = `http://127.0.0.1:${standalonePort}`;
  try {
    await Promise.all([waitFor(`${sourceOrigin}/api/health`), waitFor(`${standaloneOrigin}/`)]);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
      const evidence = {
        capturedAt: new Date().toISOString(),
        fixture: path.relative(root, photo),
        viewport: { width: 1440, height: 960 },
        source: await collect('source', sourceOrigin, '/color-grade.html', browser),
        standalone: await collect('standalone', standaloneOrigin, '/', browser),
      };
      assert.deepEqual(
        evidence.standalone.canvas,
        evidence.source.canvas,
        'source and standalone canvas dimensions must match'
      );
      assert.deepEqual(
        evidence.standalone.endpoints,
        evidence.source.endpoints,
        'source and standalone 0/50/100% endpoint pixels must match'
      );
      assert.deepEqual(
        evidence.standalone.eventCounts,
        evidence.source.eventCounts,
        'source and standalone representative adjustment event counts must match'
      );
      fs.writeFileSync(
        path.join(artifacts, 'baseline.json'),
        `${JSON.stringify(evidence, null, 2)}\n`
      );
      console.log(JSON.stringify(evidence, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    stop(source);
    stop(standalone);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
