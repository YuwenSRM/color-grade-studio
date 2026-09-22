'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const Hald = require('../assets/color-grade/color-grade-hald.js');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(
  root,
  'docs',
  'reference',
  'p2-evidence',
  'p2-browser-acceptance.json'
);
const sample3dl = path.join(
  root,
  'tests',
  'fixtures',
  '3dl',
  'external-source',
  'discreet-3d-lut.3dl'
);
const browsers = {
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
};

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
  return spawn(process.execPath, ['serve.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitForServer(origin, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('P2 browser acceptance server exited early.');
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch (_) {}
    await delay(100);
  }
  throw new Error('Timed out waiting for the P2 browser acceptance server.');
}

async function runBrowser(name, executablePath, origin) {
  if (!fs.existsSync(executablePath)) return { name, skipped: 'browser executable unavailable' };
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.variant').length === 24);
    assert.equal(
      await page.locator('.variant canvas').count(),
      0,
      'no-photo state must have no thumbnails'
    );

    await page.locator('#filterSearch').fill('柔和肖像');
    await page.waitForFunction(() => document.querySelectorAll('.variant').length === 1);
    await page.locator('.variant').click();
    await page.waitForFunction(() => document.querySelector('#exportHald')?.disabled === false);
    const haldDownload = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#exportHald').click();
    const download = await haldDownload;
    const downloadedPath = await download.path();
    assert.ok(downloadedPath, 'Hald download must have a local path');
    const decoded = Hald.decodeHaldPng(fs.readFileSync(downloadedPath));
    assert.deepEqual(
      {
        dimensions: [decoded.width, decoded.height],
        level: decoded.level,
        colorSpace: decoded.text.ColorSpace,
        layout: decoded.text.Layout,
      },
      {
        dimensions: [512, 512],
        level: 8,
        colorSpace: 'sRGB SDR',
        layout: 'flat-red-fastest',
      }
    );
    assert.equal(
      await page.locator('.variant canvas').count(),
      0,
      'Hald export must not require a photo'
    );

    await page.locator('#filterImportInput').setInputFiles(sample3dl);
    await page.waitForFunction(() =>
      document.querySelector('#libraryStatus')?.textContent.includes('P2 暂不导入或应用')
    );
    const threeDlStatus = await page.locator('#libraryStatus').textContent();
    return {
      name,
      version: browser.version(),
      noPhotoCanvasCount: 0,
      hald: {
        bytes: fs.statSync(downloadedPath).size,
        dimensions: [decoded.width, decoded.height],
        level: decoded.level,
        sourceLutSha256: decoded.text.SourceLutSha256,
      },
      threeDlStatus,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  try {
    await waitForServer(origin, server);
    const results = [];
    for (const [name, executablePath] of Object.entries(browsers))
      results.push(await runBrowser(name, executablePath, origin));
    const report = {
      schemaVersion: 1,
      generatedOn: new Date().toISOString(),
      scope:
        'P2 no-photo browser acceptance; does not replace authorized 12MP/24MP photo performance testing.',
      origin,
      results,
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ output: path.relative(root, outputPath), report }, null, 2));
  } finally {
    if (server.exitCode === null) server.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
