'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const photo = path.join(root, 'tests', 'fixtures', 'images', 'standalone-sample.png');

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

function startServer(script, port) {
  return spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitFor(origin, readyPath, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Server at ${origin} exited before it became ready.`);
    try {
      if ((await fetch(`${origin}${readyPath}`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

function stopServer(server) {
  if (server?.exitCode === null) server.kill();
}

async function openPage(browser, url, viewport) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.variant').length === 24);
  return { context, page };
}

async function layoutSnapshot(page, width) {
  if (width < 1100) await page.locator('#showAdjustmentsPanel').click();
  return page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        top: box.top,
        left: box.left,
        right: box.right,
      };
    };
    const controls = document.querySelector('#adjustmentsPanel');
    const stage = document.querySelector('#stage');
    const stageTop = stage.getBoundingClientRect().top;
    controls.scrollTop = Math.min(120, controls.scrollHeight);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      panelCount: document.querySelectorAll('.grade-tone-panel').length,
      visiblePanelCount: document.querySelectorAll('.grade-tone-panel:not([hidden])').length,
      hiddenPanelCount: document.querySelectorAll('.grade-tone-panel[hidden]').length,
      tabs: [...document.querySelectorAll('.grade-tone-tab')].map((tab) => ({
        id: tab.id,
        selected: tab.getAttribute('aria-selected'),
        controls: tab.getAttribute('aria-controls'),
        tabIndex: tab.tabIndex,
      })),
      hslWidths: [...document.querySelectorAll('#gradeTonePanelShadow input[type="number"]')].map(
        (input) => input.getBoundingClientRect().width
      ),
      gradeEditor: rect('.grade-editor'),
      gradeEditorStyle: {
        boxSizing: getComputedStyle(document.querySelector('.grade-editor')).boxSizing,
        overflowX: getComputedStyle(document.querySelector('.grade-editor')).overflowX,
      },
      canvasPanel: rect('.canvas-panel'),
      controlsPanel: rect('#adjustmentsPanel'),
      stageStableDuringPanelScroll: stageTop === stage.getBoundingClientRect().top,
    };
  });
}

function standaloneLayoutParity(snapshot) {
  return {
    panelCount: snapshot.panelCount,
    visiblePanelCount: snapshot.visiblePanelCount,
    hiddenPanelCount: snapshot.hiddenPanelCount,
    tabs: snapshot.tabs,
    hslWidths: snapshot.hslWidths,
    gradeEditor: {
      width: snapshot.gradeEditor.width,
      height: snapshot.gradeEditor.height,
      left: snapshot.gradeEditor.left,
      right: snapshot.gradeEditor.right,
    },
    gradeEditorStyle: snapshot.gradeEditorStyle,
  };
}

function assertLayout(snapshot, width, label) {
  assert.ok(
    snapshot.scrollWidth <= snapshot.clientWidth + 1,
    `${label} at ${width}px introduced horizontal scrolling`
  );
  assert.equal(snapshot.panelCount, 3, `${label} must retain all grade panels`);
  assert.equal(snapshot.visiblePanelCount, 1, `${label} must expose one grade panel`);
  assert.equal(snapshot.hiddenPanelCount, 2, `${label} must hide inactive grade panels`);
  assert.deepEqual(
    snapshot.tabs.map((tab) => tab.selected),
    ['true', 'false', 'false'],
    `${label} must retain a single active grade tab`
  );
  for (const inputWidth of snapshot.hslWidths) {
    assert.ok(inputWidth >= 72, `${label} HSL input is narrower than 72px at ${width}px`);
  }
  assert.equal(
    snapshot.stageStableDuringPanelScroll,
    true,
    `${label} panel scroll moved the stage`
  );
  if (width >= 1100) {
    assert.equal(
      snapshot.canvasPanel.top,
      snapshot.controlsPanel.top,
      `${label} preview and adjustment panels do not share a top baseline`
    );
  }
}

async function importPhotoAndSelectBuiltin(page) {
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(
    () => document.querySelector('#stage')?.getAttribute('aria-busy') === 'false'
  );
  await page.locator('#filterSearch').fill('柔和肖像');
  await page.waitForFunction(() => document.querySelectorAll('#variants .variant').length === 1);
  await page.locator('#variants .variant').click();
  await page.waitForFunction(() => !document.querySelector('#filterIntensity').hidden);
}

async function setInputAndWaitForInteractiveFrame(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.waitForFunction(
    () =>
      document.querySelector('#filterIntensity')?.getAttribute('aria-busy') === 'false' &&
      Math.max(
        document.querySelector('#mainCanvas').width,
        document.querySelector('#mainCanvas').height
      ) === 560
  );
}

async function setIntensityAndWaitForHighQualityFrame(page, value) {
  await page.locator('#filterIntensityInput').evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForFunction(
    () =>
      document.querySelector('#filterIntensity')?.getAttribute('aria-busy') === 'false' &&
      Math.max(
        document.querySelector('#mainCanvas').width,
        document.querySelector('#mainCanvas').height
      ) === 1100
  );
}

async function previewSamples(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#mainCanvas');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const samples = [];
    for (let index = 0; index < 97; index += 1) {
      const pixel = Math.floor((index * (canvas.width * canvas.height - 1)) / 96);
      const offset = pixel * 4;
      samples.push(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    }
    return { width: canvas.width, height: canvas.height, samples };
  });
}

function assertMidpointBlend(original, midpoint, effect, label) {
  assert.deepEqual(
    midpoint.samples.filter((_, index) => index % 4 === 3),
    original.samples.filter((_, index) => index % 4 === 3),
    `${label} changed alpha while mixing`
  );
  for (let index = 0; index < midpoint.samples.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const expected =
        original.samples[index + channel] +
        (effect.samples[index + channel] - original.samples[index + channel]) * 0.5;
      assert.ok(
        Math.abs(midpoint.samples[index + channel] - expected) <= 1,
        `${label} midpoint channel ${index + channel} is not an endpoint mix`
      );
    }
  }
}

async function exportPreviewDigest(page) {
  await page.locator('#downloadSpec').evaluate((select) => {
    select.value = 'preview';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const download = page.waitForEvent('download');
  await page.locator('#download').click();
  const stream = await (await download).createReadStream();
  const hash = crypto.createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function realtimeSnapshot(page) {
  await importPhotoAndSelectBuiltin(page);
  await setInputAndWaitForInteractiveFrame(page, '#filterIntensityInput', 0);
  const original = await previewSamples(page);
  await setInputAndWaitForInteractiveFrame(page, '#filterIntensityInput', 50);
  const midpoint = await previewSamples(page);
  await setInputAndWaitForInteractiveFrame(page, '#filterIntensityInput', 100);
  const effect = await previewSamples(page);
  assertMidpointBlend(original, midpoint, effect, 'filter intensity preview');

  await setInputAndWaitForInteractiveFrame(page, '#exposure', 18);
  await setInputAndWaitForInteractiveFrame(page, '#shadowHue', 145);
  await setInputAndWaitForInteractiveFrame(page, '#shadowAmtInput', 37);
  const interactive = await previewSamples(page);
  await setIntensityAndWaitForHighQualityFrame(page, 50);
  const highQuality = await previewSamples(page);
  const exportDigest = await exportPreviewDigest(page);
  return {
    original,
    midpoint,
    effect,
    interactive,
    highQuality,
    exportDigest,
    controls: await page.evaluate(() => ({
      exposure: document.querySelector('#exposure').value,
      shadowHue: document.querySelector('#shadowHue').value,
      shadowAmount: document.querySelector('#shadowAmtInput').value,
      intensity: document.querySelector('#filterIntensityInput').value,
      intensityText: document.querySelector('#filterIntensityInput').getAttribute('aria-valuetext'),
    })),
  };
}

async function main() {
  if (!fs.existsSync(chrome)) {
    console.log(JSON.stringify({ skipped: 'Chrome executable unavailable' }));
    return;
  }
  assert.ok(fs.existsSync(photo), `Missing standalone acceptance photo fixture: ${photo}`);
  const [sourcePort, standalonePort] = await Promise.all([freePort(), freePort()]);
  const sourceOrigin = `http://127.0.0.1:${sourcePort}`;
  const standaloneOrigin = `http://127.0.0.1:${standalonePort}`;
  const sourceServer = startServer('serve.js', sourcePort);
  const standaloneServer = startServer('scripts/serve-standalone.cjs', standalonePort);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await Promise.all([
      waitFor(sourceOrigin, '/api/health', sourceServer),
      waitFor(standaloneOrigin, '/', standaloneServer),
    ]);
    const layouts = {};
    for (const width of [280, 320, 390, 520, 1440]) {
      const viewport = { width, height: 960 };
      const source = await openPage(browser, `${sourceOrigin}/color-grade.html`, viewport);
      const standalone = await openPage(browser, `${standaloneOrigin}/`, viewport);
      try {
        const [sourceLayout, standaloneLayout] = await Promise.all([
          layoutSnapshot(source.page, width),
          layoutSnapshot(standalone.page, width),
        ]);
        assertLayout(sourceLayout, width, 'source page');
        assertLayout(standaloneLayout, width, 'standalone page');
        const sourceParity = standaloneLayoutParity(sourceLayout);
        const standaloneParity = standaloneLayoutParity(standaloneLayout);
        if (JSON.stringify(standaloneParity) !== JSON.stringify(sourceParity)) {
          throw new Error(
            `grade editor layout diverged at ${width}px:\nsource=${JSON.stringify(sourceParity)}\nstandalone=${JSON.stringify(standaloneParity)}`
          );
        }
        layouts[width] = 'matched';
      } finally {
        await Promise.all([source.context.close(), standalone.context.close()]);
      }
    }

    const viewport = { width: 1440, height: 960 };
    const source = await openPage(browser, `${sourceOrigin}/color-grade.html`, viewport);
    const standalone = await openPage(browser, `${standaloneOrigin}/`, viewport);
    try {
      const [sourceResult, standaloneResult] = await Promise.all([
        realtimeSnapshot(source.page),
        realtimeSnapshot(standalone.page),
      ]);
      assert.deepEqual(
        standaloneResult,
        sourceResult,
        'standalone control state, endpoint pixels, or export differs from the source page'
      );
      console.log(
        JSON.stringify(
          {
            sourceOrigin,
            standaloneOrigin,
            layouts,
            interactiveCanvas: {
              width: sourceResult.interactive.width,
              height: sourceResult.interactive.height,
              samples: sourceResult.interactive.samples.length / 4,
            },
            highQualityCanvas: {
              width: sourceResult.highQuality.width,
              height: sourceResult.highQuality.height,
              samples: sourceResult.highQuality.samples.length / 4,
            },
            exportDigest: sourceResult.exportDigest,
            status: 'source-and-standalone-sync-accepted',
          },
          null,
          2
        )
      );
    } finally {
      await Promise.all([source.context.close(), standalone.context.close()]);
    }
  } finally {
    await browser.close();
    stopServer(sourceServer);
    stopServer(standaloneServer);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
