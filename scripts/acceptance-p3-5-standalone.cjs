'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const candidate = path.join(root, 'dist', 'standalone-candidate');
const browsers = [
  { name: 'Chrome', executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  { name: 'Edge', executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
];
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2/wAAAABJRU5ErkJggg==',
  'base64'
);

async function waitForServer(origin) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Candidate loopback server did not become available.');
}

async function exerciseBrowser(browserInfo, origin) {
  if (!fs.existsSync(browserInfo.executable))
    return { browser: browserInfo.name, status: 'skipped' };
  console.log(`${browserInfo.name}: starting isolated browser context`);
  const requests = [];
  let browser;
  let context;
  try {
    browser = await chromium.launch({
      executablePath: browserInfo.executable,
      headless: true,
    });
    console.log(`${browserInfo.name}: browser launched`);
    // A fresh browser context is an isolated temporary profile; no user browser data is reused.
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    console.log(`${browserInfo.name}: temporary profile ready`);
    const page = await context.newPage();
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log(`${browserInfo.name}: shell loaded`);
    await page.waitForSelector('#importFilters', { timeout: 10000 });
    await page.setViewportSize({ width: 360, height: 640 });
    assert.ok(await page.locator('#importFilters').isVisible());
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.equal(await page.locator('#uploadToLibrary').isVisible(), false);
    assert.equal(await page.locator('#colorAccount').isVisible(), false);
    assert.ok(await page.locator('#nightTheme').isVisible());
    await page.locator('#nightTheme').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('dark')), true);
    const language = page.locator('.language-toggle');
    await language.click();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    await page.locator('#tonePalette').focus();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tonePalette');
    assert.ok(await page.locator('#tonePalette').getAttribute('role'));
    assert.ok((await page.locator('#importFilters').boundingBox()).width > 0);

    const persistence = await page.evaluate(async () => {
      const library = new window.LandscapeLutLibrary.LutLibrary({
        idFactory: () => 'p3-5-candidate-filter',
        now: () => '2026-09-12T00:00:00.000Z',
      });
      const contents = JSON.stringify({
        format: 'real-landscape-filter',
        version: 1,
        kind: 'parameters',
        name: 'P3 candidate parameter filter',
        parameters: { b: 1, c: 1, s: 1, w: 1, t: 0 },
        metadata: {
          author: '',
          sourceUrl: '',
          licenseNote: '',
          brand: 'Candidate',
          scenes: [],
          inputColorSpace: 'sRGB SDR',
          outputColorSpace: 'sRGB SDR',
        },
      });
      await library.importFile(
        new File([contents], 'candidate.json', { type: 'application/json' })
      );
      const backup = await library.exportBackup();
      await library.restoreBackup(backup, { mode: 'replace' });
      return { count: (await library.list()).length, bytes: backup.size };
    });
    assert.equal(persistence.count, 1);
    assert.ok(persistence.bytes > 0);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    assert.equal(
      await page.evaluate(
        async () => (await new window.LandscapeLutLibrary.LutLibrary().list()).length
      ),
      1
    );
    await context.setOffline(true);
    assert.equal(await page.title(), '本地调色台');
    assert.equal(await page.locator('#backupFilters').count(), 1);
    await context.setOffline(false);
    assert.ok(
      requests.every((url) => url.startsWith(origin)),
      `unexpected request: ${requests.join(', ')}`
    );

    const failurePage = await context.newPage();
    await failurePage.addInitScript(() => {
      window.Worker = class {
        constructor() {
          throw new Error('P3-5 simulated worker failure');
        }
      };
    });
    await failurePage.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await failurePage.setInputFiles('#emptyFileInput', {
      name: 'worker-failure.png',
      mimeType: 'image/png',
      buffer: onePixelPng,
    });
    await failurePage.waitForSelector('#stage:not(.empty)', { timeout: 10000 });
    assert.equal(await failurePage.locator('#status').count(), 1);
    console.log(`${browserInfo.name}: acceptance passed`);
    return { browser: browserInfo.name, status: 'passed', requests: requests.length, persistence };
  } finally {
    await context?.close();
    await browser?.close();
  }
}

async function main() {
  const origin = 'http://127.0.0.1:4174';
  const server = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'ColorGradeStudio.ps1',
      '-NoOpen',
      '-Diagnostic',
    ],
    {
      cwd: candidate,
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  try {
    await waitForServer(origin);
    console.log(`Candidate loopback server ready: ${origin}`);
    const results = [];
    for (const browserInfo of browsers) results.push(await exerciseBrowser(browserInfo, origin));
    assert.ok(
      results.some((result) => result.status === 'passed'),
      'No supported browser executable was available.'
    );
    console.log(
      JSON.stringify(
        { origin, results, performanceGate: 'reported separately', status: 'accepted' },
        null,
        2
      )
    );
  } finally {
    if (server.exitCode === null) {
      execFileSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          'ColorGradeStudio.ps1',
          '-Stop',
          '-Diagnostic',
        ],
        { cwd: candidate, stdio: 'ignore', windowsHide: true }
      );
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
