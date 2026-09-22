'use strict';

// Runs P1 release acceptance against installed Chromium browsers. It deliberately requires
// caller-provided, authorized photo fixtures instead of manufacturing synthetic "real" photos.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const identityLut = path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-33.cube');
const secondLut = path.join(
  root,
  'tests',
  'fixtures',
  'luts',
  'creative',
  'clean-contrast-17.cube'
);
const browserPaths = Object.freeze({
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
});
const browserNames = (process.env.P1_BROWSERS || 'chrome,edge')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const runCount = Number(process.env.P1_BROWSER_RUNS || 5);
const photoNames = (process.env.P1_PHOTOS || '12,24')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const validateScenarios = process.env.P1_VALIDATE_SCENARIOS !== '0';
const collectMetrics = process.env.P1_COLLECT_METRICS !== '0';

function progress(message) {
  console.log(`[P1 browser acceptance] ${message}`);
}

function requireFixture(variable, pixels) {
  const value = process.env[variable];
  if (!value) {
    throw new Error(
      `${variable} is required. Set it to an authorized SDR sRGB photo with ${Math.floor(
        pixels * 0.95
      ).toLocaleString()}-${Math.ceil(pixels * 1.05).toLocaleString()} pixels.`
    );
  }
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`${variable} does not exist: ${file}`);
  return file;
}

function p95(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort() {
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
  const child = spawn(process.execPath, ['serve.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', (data) => (log += data));
  child.stderr.on('data', (data) => (log += data));
  child.p1Log = () => log;
  return child;
}

async function waitForServer(origin, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local server exited: ${child.p1Log()}`);
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch (_) {}
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

function stopServer(child) {
  if (child?.exitCode === null) child.kill();
}

async function openPage(
  browser,
  origin,
  { workerUnavailable = false, beforeNavigate = null } = {}
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  await context.addInitScript((blockWorker) => {
    if (blockWorker) {
      window.Worker = class {
        constructor() {
          throw new Error('Worker blocked by P1 acceptance test');
        }
      };
    }
    window.__p1Paints = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const context = original.apply(this, args);
      if (args[0] !== '2d' || !context || context.__p1PaintProbe) return context;
      const putImageData = context.putImageData.bind(context);
      const canvas = this;
      context.putImageData = (...putArgs) => {
        const result = putImageData(...putArgs);
        if (canvas.id === 'mainCanvas') window.__p1Paints.push(performance.now());
        return result;
      };
      context.__p1PaintProbe = true;
      return context;
    };
  }, workerUnavailable);
  const page = await context.newPage();
  const extras = beforeNavigate ? await beforeNavigate({ context, page }) : {};
  await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('#libraryStatus')?.textContent.length > 0
  );
  return { context, page, ...extras };
}

async function importApplicableLut(page, file = identityLut) {
  await page.locator('#filterImportInput').setInputFiles(file);
  await page.waitForFunction(() =>
    document.querySelector('#libraryStatus')?.textContent.includes('导入完成')
  );
  progress('LUT import completed; locating the user-filter edit control.');
  await page.locator('.variant .filter-edit-button').first().click();
  progress('User-filter edit panel opened.');
  await page.locator('#filterEditInputSpace').evaluate((element) => {
    element.value = 'sRGB SDR';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  progress('User-filter input color space selected.');
  await page.locator('#filterEditOutputSpace').evaluate((element) => {
    element.value = 'sRGB SDR';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  progress('User-filter output color space selected.');
  await page.locator('#saveFilterEdit').click();
  progress('User-filter edit saved.');
  await page.waitForFunction(() => document.querySelector('#filterModal')?.hidden === true);
}

async function importPhoto(page, file, targetPixels) {
  const filename = path.basename(file);
  await page.locator('#emptyFileInput').setInputFiles(file);
  await page.waitForFunction(
    (name) => document.querySelector('#fileName')?.textContent === name,
    filename
  );
  await page.waitForFunction(
    () => document.querySelector('#stage')?.getAttribute('aria-busy') === 'false'
  );
  const dimensions = await page.evaluate(() => {
    const match = document.querySelector('#fileInfo').textContent.match(/(\d+) × (\d+)/);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    return { width, height, pixels: width * height };
  });
  assert.ok(
    dimensions.pixels >= targetPixels * 0.95 && dimensions.pixels <= targetPixels * 1.05,
    `Expected ${targetPixels} pixels (+/-5%), received ${dimensions.width}x${dimensions.height}.`
  );
  return dimensions;
}

async function renderUserLut(page) {
  const before = await page.evaluate(() => window.__p1Paints.length);
  const started = await page.evaluate(() => performance.now());
  await page.locator('.variant').first().click();
  await page.waitForFunction((count) => window.__p1Paints.length > count, before);
  return page.evaluate((start) => performance.now() - start, started);
}

async function browserMemory(page) {
  return page.evaluate(async () => {
    const storage = await navigator.storage?.estimate?.();
    return {
      storage,
      performanceMemory: performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          }
        : null,
    };
  });
}

async function exportOriginal(page) {
  await page.locator('#downloadSpec').evaluate((element) => {
    element.value = 'original';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const started = await page.evaluate(() => performance.now());
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#download').click();
  await download;
  return page.evaluate((start) => performance.now() - start, started);
}

async function verifyCancelledExport(page) {
  let downloads = 0;
  const onDownload = () => (downloads += 1);
  page.on('download', onDownload);
  await page.locator('#downloadSpec').evaluate((element) => {
    element.value = 'original';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#download').click();
  await page.waitForSelector('#cancelExport:not([hidden])');
  await page.locator('#cancelExport').click();
  await page.waitForFunction(() => document.querySelector('#cancelExport')?.hidden === true);
  await page.waitForTimeout(500);
  page.off('download', onDownload);
  assert.equal(downloads, 0, 'A cancelled export must not create a download.');
  assert.match(await page.locator('#status').textContent(), /已取消导出/);
}

async function verifyWorkerUnavailable(browser, origin, photo) {
  const { context, page } = await openPage(browser, origin, { workerUnavailable: true });
  try {
    await importApplicableLut(page);
    await importPhoto(page, photo.file, photo.targetPixels);
    const before = await page.evaluate(() => {
      const canvas = document.querySelector('#mainCanvas');
      return Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data);
    });
    await page.locator('.variant').first().click();
    await page.waitForFunction(() =>
      document.querySelector('#editorToast')?.classList.contains('show')
    );
    const after = await page.evaluate(() => {
      const canvas = document.querySelector('#mainCanvas');
      return Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data);
    });
    assert.deepEqual(after, before, 'A failed P1 Worker must preserve the current preview.');
  } finally {
    await context.close();
  }
}

function countPersisted(page) {
  return page.evaluate(async () => {
    const library = new window.LandscapeLutLibrary.LutLibrary();
    return (await library.list()).length;
  });
}

async function importFile(page, file) {
  await page.locator('#filterImportInput').setInputFiles(file);
  await page.waitForFunction(() =>
    document.querySelector('#libraryStatus')?.textContent.includes('导入完成')
  );
}

async function assertLibraryUnchanged(page, before) {
  assert.equal(
    await page.locator('.variant').count(),
    before.cards,
    'Quota failure mutated the saved library.'
  );
  assert.match(await page.locator('#libraryStatus').textContent(), /0 个成功/);
  assert.equal(
    await countPersisted(page),
    before.persisted,
    'Quota failure left a partial IndexedDB record behind.'
  );
}

// Chromium applies Storage.overrideQuotaForOrigin only to storage connections opened after the
// override, and navigator.storage.estimate() keeps reporting the profile quota regardless. The
// override is therefore installed before the first navigation and native enforcement is proven
// by the QuotaExceededError the browser raises inside the library's own write transaction.
const nativeQuotaBytes = 512 * 1024; // Fits clean-contrast-17 (~130 KB); rejects identity-33 (~970 KB).

async function verifyNativeQuotaFailure(browser, origin) {
  const { context, page, session } = await openPage(browser, origin, {
    beforeNavigate: async ({ context, page }) => {
      const session = await context.newCDPSession(page);
      await session.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: nativeQuotaBytes });
      return { session };
    },
  });
  try {
    await importApplicableLut(page, secondLut);
    const before = {
      cards: await page.locator('.variant').count(),
      persisted: await countPersisted(page),
    };
    await page.evaluate(() => {
      const api = window.LandscapeLutLibrary;
      const put = api.LutLibrary.prototype.put;
      window.__p1PutErrors = [];
      api.LutLibrary.prototype.put = async function (...args) {
        try {
          return await put.apply(this, args);
        } catch (error) {
          window.__p1PutErrors.push(error?.name || error?.code || String(error));
          throw error;
        }
      };
    });
    const overrideQuota = await session.send('Storage.getUsageAndQuota', { origin });
    await importFile(page, identityLut);
    const putErrors = await page.evaluate(() => window.__p1PutErrors);
    if (!putErrors.includes('QuotaExceededError')) return null;
    await assertLibraryUnchanged(page, before);
    return {
      nativeQuotaEnforced: true,
      quotaBytes: nativeQuotaBytes,
      nativeError: 'QuotaExceededError',
      estimate: await page.evaluate(() => navigator.storage.estimate()),
      overrideQuota: { quota: overrideQuota.quota, overrideActive: overrideQuota.overrideActive },
    };
  } finally {
    await session.send('Storage.overrideQuotaForOrigin', { origin }).catch(() => {});
    await context.close();
  }
}

async function verifySimulatedQuotaFailure(browser, origin) {
  const { context, page } = await openPage(browser, origin);
  try {
    await importApplicableLut(page);
    const before = {
      cards: await page.locator('.variant').count(),
      persisted: await countPersisted(page),
    };
    // Exercise the same write-failure recovery path without pretending the browser imposed it.
    await page.evaluate(() => {
      const api = window.LandscapeLutLibrary;
      api.LutLibrary.prototype.put = async () => {
        throw new api.LutLibraryError('storage-failed', 'Quota exceeded.');
      };
    });
    await importFile(page, secondLut);
    await assertLibraryUnchanged(page, before);
    return {
      nativeQuotaEnforced: false,
      estimate: await page.evaluate(() => navigator.storage.estimate()),
    };
  } finally {
    await context.close();
  }
}

async function verifyQuotaFailure(browser, origin) {
  return (
    (await verifyNativeQuotaFailure(browser, origin)) ||
    verifySimulatedQuotaFailure(browser, origin)
  );
}

async function verifyCancelledExportOnPhoto(browser, origin, photo) {
  const { context, page } = await openPage(browser, origin);
  try {
    await importApplicableLut(page);
    await importPhoto(page, photo.file, photo.targetPixels);
    await renderUserLut(page);
    await verifyCancelledExport(page);
  } finally {
    await context.close();
  }
}

async function runBrowser(name, executablePath, origin, photos) {
  progress(`Launching ${name}.`);
  const browser = await chromium.launch({
    executablePath,
    headless: process.env.P1_HEADLESS !== '0',
  });
  try {
    const samples = [];
    const scenarios = { cancellation: false, workerUnavailable: false, storage: null };
    if (collectMetrics) {
      for (const photo of photos) {
        for (let run = 1; run <= runCount; run += 1) {
          progress(`${name}: ${photo.label} run ${run}/${runCount}.`);
          const { context, page } = await openPage(browser, origin);
          try {
            await importApplicableLut(page);
            progress(`${name}: ${photo.label} run ${run}/${runCount} LUT imported.`);
            const dimensions = await importPhoto(page, photo.file, photo.targetPixels);
            progress(`${name}: ${photo.label} run ${run}/${runCount} photo imported.`);
            const coldPreviewMilliseconds = await renderUserLut(page);
            progress(`${name}: ${photo.label} run ${run}/${runCount} cold preview rendered.`);
            const warmPreviewMilliseconds = await renderUserLut(page);
            progress(`${name}: ${photo.label} run ${run}/${runCount} warm preview rendered.`);
            const exportOriginalMilliseconds = await exportOriginal(page);
            progress(`${name}: ${photo.label} run ${run}/${runCount} export finished.`);
            samples.push({
              photo: photo.label,
              run,
              dimensions,
              coldPreviewMilliseconds: round(coldPreviewMilliseconds),
              warmPreviewMilliseconds: round(warmPreviewMilliseconds),
              exportOriginalMilliseconds: round(exportOriginalMilliseconds),
              memory: await browserMemory(page),
            });
          } finally {
            await context.close();
          }
        }
      }
    }
    if (validateScenarios) {
      const scenarioPhoto = photos.find((photo) => photo.label === '24MP') || photos[0];
      await verifyCancelledExportOnPhoto(browser, origin, scenarioPhoto);
      scenarios.cancellation = true;
      progress(`${name}: cancellation check passed.`);
      await verifyWorkerUnavailable(browser, origin, scenarioPhoto);
      scenarios.workerUnavailable = true;
      progress(`${name}: unavailable Worker check passed.`);
      const quota = await verifyQuotaFailure(browser, origin);
      scenarios.storage = quota;
      progress(
        `${name}: IndexedDB quota check passed (${quota.nativeQuotaEnforced ? 'native quota' : 'simulated quota error'}).`
      );
    }
    const aggregate = Object.fromEntries(
      photos.map((photo) => {
        const group = samples.filter((sample) => sample.photo === photo.label);
        return [
          photo.label,
          group.length
            ? {
                coldPreviewP95Milliseconds: round(
                  p95(group.map((item) => item.coldPreviewMilliseconds))
                ),
                warmPreviewP95Milliseconds: round(
                  p95(group.map((item) => item.warmPreviewMilliseconds))
                ),
                exportOriginalP95Milliseconds: round(
                  p95(group.map((item) => item.exportOriginalMilliseconds))
                ),
              }
            : null,
        ];
      })
    );
    return { name, version: browser.version(), samples, aggregate, scenarios };
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!Number.isInteger(runCount) || runCount < 5)
    throw new Error('P1_BROWSER_RUNS must be an integer >= 5.');
  const candidates = {
    12: {
      label: '12MP',
      file: requireFixture('P1_12MP_IMAGE', 12_000_000),
      targetPixels: 12_000_000,
    },
    24: {
      label: '24MP',
      file: requireFixture('P1_24MP_IMAGE', 24_000_000),
      targetPixels: 24_000_000,
    },
  };
  if (photoNames.some((name) => !candidates[name]))
    throw new Error('P1_PHOTOS accepts only comma-separated values 12 and 24.');
  const photos = photoNames.map((name) => candidates[name]);
  if (!photos.length) throw new Error('P1_PHOTOS must include at least one photo class.');
  const missing = browserNames.filter(
    (name) => !browserPaths[name] || !fs.existsSync(browserPaths[name])
  );
  if (missing.length) throw new Error(`Missing configured browser(s): ${missing.join(', ')}.`);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin, server);
    progress(`Local server ready at ${origin}.`);
    const browsers = [];
    for (const name of browserNames)
      browsers.push(await runBrowser(name, browserPaths[name], origin, photos));
    const report = {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      origin,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model,
      },
      fixtures: photos,
      browsers,
    };
    const directory = path.join(root, 'data', 'p1-browser-acceptance');
    fs.mkdirSync(directory, { recursive: true });
    const output = path.join(
      directory,
      `p1-browser-${report.measuredAt.replace(/[:.]/g, '-')}.json`
    );
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    for (const browser of browsers) {
      for (const metrics of Object.values(browser.aggregate)) {
        if (!metrics) continue;
        assert.ok(
          metrics.coldPreviewP95Milliseconds <= 1000,
          `${browser.name} preview P95 exceeded 1 second.`
        );
      }
    }
    console.log(JSON.stringify({ output, report }, null, 2));
  } finally {
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
