'use strict';

// Release evidence for the generated standalone bundle.  This deliberately
// drives the source page and the built output through the same browser path.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'tests', 'artifacts', 'd5-source-standalone-parity');
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

function start(command, port) {
  return spawn(process.execPath, command, {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitForServer(origin, pathname) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}${pathname}`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${origin}${pathname}.`);
}

function stop(server) {
  if (server?.exitCode === null) server.kill();
}

async function setIntensity(page, value) {
  await page.locator('#filterIntensityInput').evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.waitForFunction(
    (next) =>
      document.querySelector('#filterIntensityValue').textContent === `${next}%` &&
      document.querySelector('#filterIntensity').getAttribute('aria-busy') === 'false',
    value,
    { timeout: 8000 }
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}

async function metrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const { top, bottom, height } = document.querySelector(selector).getBoundingClientRect();
      return { top, bottom, height };
    };
    const controls = document.querySelector('#adjustmentsPanel');
    return {
      canvasPanel: rect('.canvas-panel'),
      adjustmentsPanel: rect('#adjustmentsPanel'),
      controls: { clientHeight: controls.clientHeight, scrollHeight: controls.scrollHeight },
      workbenchHeight: document
        .querySelector('.workbench')
        .style.getPropertyValue('--workbench-panel-height'),
    };
  });
}

function assertAligned(result, label) {
  const { canvasPanel: canvas, adjustmentsPanel: panel } = result;
  assert.ok(Math.abs(canvas.top - panel.top) <= 1, `${label}: panel tops differ`);
  assert.ok(Math.abs(canvas.bottom - panel.bottom) <= 1, `${label}: panel bottoms differ`);
  assert.ok(Math.abs(canvas.height - panel.height) <= 1, `${label}: panel heights differ`);
  assert.ok(
    result.controls.scrollHeight > result.controls.clientHeight,
    `${label}: controls must scroll`
  );
}

async function samples(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#mainCanvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const step = Math.max(4, Math.floor(data.length / 160 / 4) * 4);
    return Array.from({ length: 160 }, (_, index) => {
      const offset = Math.min(data.length - 4, index * step);
      return [offset, data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
    });
  });
}

function assertEndpointPixels(source, midpoint, effect, label) {
  for (let index = 0; index < source.length; index += 1) {
    const [, sr, sg, sb, sa] = source[index];
    const [, mr, mg, mb, ma] = midpoint[index];
    const [, er, eg, eb, ea] = effect[index];
    assert.equal(ma, sa, `${label}: 50% must preserve alpha at sample ${index}`);
    assert.equal(ea, sa, `${label}: 100% must preserve alpha at sample ${index}`);
    for (const [actual, expected] of [
      [mr, sr + (er - sr) * 0.5],
      [mg, sg + (eg - sg) * 0.5],
      [mb, sb + (eb - sb) * 0.5],
    ]) {
      assert.ok(Math.abs(actual - expected) <= 1, `${label}: 50% mix exceeds one 8-bit unit`);
    }
  }
}

async function exercise(page, origin, entry, label) {
  await page.addInitScript(() => {
    window.__d5Parity = { inputs: [], commits: [] };
    document.addEventListener(
      'input',
      (event) => {
        if (event.target?.id === 'filterIntensityInput' || event.target?.id === 'exposure') {
          window.__d5Parity.inputs.push({ id: event.target.id, time: performance.now() });
        }
      },
      true
    );
    document.addEventListener('color-grade-preview-commit', (event) => {
      window.__d5Parity.commits.push({
        ...event.detail,
        renderer:
          event.detail.renderer ||
          document.querySelector('#stage')?.dataset.interactiveRenderer ||
          'cpu',
      });
    });
  });
  await page.goto(`${origin}${entry}`, { waitUntil: 'networkidle' });
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(
    () => document.querySelector('#stage').getAttribute('aria-busy') === 'false'
  );
  await page.waitForFunction(() =>
    document.querySelector('.workbench').style.getPropertyValue('--workbench-panel-height')
  );
  const initial = await metrics(page);
  assertAligned(initial, `${label} initial`);

  await page.locator('#filterSearch').fill('柔和肖像');
  await page.locator('#variants .variant').click();
  await page.waitForFunction(() => !document.querySelector('#filterIntensity').hidden);
  await setIntensity(page, 0);
  const endpoint0 = await samples(page);
  await setIntensity(page, 100);
  const endpoint100 = await samples(page);
  await setIntensity(page, 50);
  const endpoint50 = await samples(page);
  assertEndpointPixels(endpoint0, endpoint50, endpoint100, label);

  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'd5-parity-height-probe';
    probe.style.height = '73px';
    document.querySelector('.canvas-panel').append(probe);
  });
  await page.waitForFunction(() => {
    const left = document.querySelector('.canvas-panel').getBoundingClientRect();
    const right = document.querySelector('#adjustmentsPanel').getBoundingClientRect();
    return Math.abs(left.height - right.height) <= 1 && left.height > 73;
  });
  const dynamic = await metrics(page);
  assertAligned(dynamic, `${label} dynamic`);
  assert.ok(
    dynamic.canvasPanel.height >= initial.canvasPanel.height + 72,
    `${label}: dynamic left height did not propagate`
  );

  // Parameter presets select the WebGL path where available.  The resulting
  // commit data is recorded even on a CPU fallback device.
  await page.locator('#filterSearch').fill('高原自然');
  await page.locator('#variants .variant').click();
  await page.waitForFunction(() => document.querySelector('#mainCanvas').width === 560);
  const prior = await page.evaluate(() => window.__d5Parity.commits.length);
  await page.locator('#exposure').evaluate((input) => {
    input.value = '13';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction((count) => window.__d5Parity.commits.length > count, prior);
  const trace = await page.evaluate(() => window.__d5Parity);
  const latencies = trace.inputs
    .map((input) => {
      const commit = trace.commits.find(
        (candidate) => candidate.time >= input.time && candidate.limit === 560
      );
      return commit ? commit.time - input.time : null;
    })
    .filter(Number.isFinite);
  assert.ok(latencies.length >= 4, `${label}: missing visible interaction commits`);
  assert.ok(Math.max(...latencies) < 500, `${label}: preview commit took too long`);

  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${label}-1440x960.png`), fullPage: false });
  return {
    entry,
    initial,
    dynamic,
    endpointSamples: {
      zero: endpoint0.length,
      midpoint: endpoint50.length,
      full: endpoint100.length,
    },
    trace: {
      commitCount: trace.commits.length,
      renderers: [...new Set(trace.commits.map((commit) => commit.renderer))],
      latencies,
    },
  };
}

test('D5 source and standalone releases preserve layout, dynamic height, endpoint pixels, and preview commits', async () => {
  assert.ok(fs.existsSync(chrome), 'Google Chrome is required for release parity checks');
  const sourcePort = await freePort();
  const standalonePort = await freePort();
  const sourceOrigin = `http://127.0.0.1:${sourcePort}`;
  const standaloneOrigin = `http://127.0.0.1:${standalonePort}`;
  const sourceServer = start(['serve.js'], sourcePort);
  const standaloneServer = start(['scripts/serve-standalone.cjs'], standalonePort);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await Promise.all([
      waitForServer(sourceOrigin, '/api/health'),
      waitForServer(standaloneOrigin, '/'),
    ]);
    const results = {};
    for (const [label, origin, entry] of [
      ['source', sourceOrigin, '/color-grade.html'],
      ['standalone', standaloneOrigin, '/'],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const page = await context.newPage();
      try {
        results[label] = await exercise(page, origin, entry, label);
      } finally {
        await context.close();
      }
    }
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(
      path.join(artifacts, 'measurements-1440x960.json'),
      `${JSON.stringify({ viewport: { width: 1440, height: 960 }, generatedAt: new Date().toISOString(), results }, null, 2)}\n`
    );
  } finally {
    await browser.close();
    stop(sourceServer);
    stop(standaloneServer);
  }
});
