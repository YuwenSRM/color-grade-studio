'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');
const runtimeManifest = require('../scripts/standalone-runtime-manifest.cjs');
const { createServer } = require('../scripts/serve-standalone.cjs');

const root = path.resolve(__dirname, '..');
const candidateRoot = path.join(root, 'dist', 'standalone-candidate', 'app');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const forbiddenRequest =
  /(?:^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/)|\/(?:api|login(?:\.html)?|image-library)(?:\/|$))/i;

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

async function startCandidateServer(port) {
  const server = createServer(candidateRoot);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function waitFor(origin, server) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!server.listening) throw new Error(`${origin} stopped before it became ready.`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

function stop(child) {
  if (child?.listening) child.close();
}

test('candidate has current BUILD.json, serves every runtime asset, and stays offline while switching locale', async () => {
  assert.ok(fs.existsSync(chrome), 'Google Chrome is required for release candidate checks');
  const sourceBuild = fs.readFileSync(path.join(root, 'dist', 'standalone', 'BUILD.json'));
  assert.deepEqual(fs.readFileSync(path.join(candidateRoot, 'BUILD.json')), sourceBuild);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = await startCandidateServer(port);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await waitFor(origin, server);
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    const forbidden = [];
    const failed = [];
    page.on('request', (request) => {
      if (forbiddenRequest.test(request.url())) forbidden.push(request.url());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    });
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('.variant').length > 0);
      await page.locator('#filterSearch').fill('Exposure +20');
      await page.waitForFunction(
        () => document.querySelector('.intent-chip')?.textContent.trim() === '曝光 +20'
      );
      await page.evaluate(() => window.ColorGradeI18n.setLocale('en-US'));
      await page.waitForFunction(() => document.documentElement.lang === 'en-US');
      const state = await page.evaluate(() => ({
        title: document.title,
        input: document.querySelector('#filterSearch').value,
        chip: document.querySelector('.intent-chip')?.textContent.trim(),
        library: document.querySelector('#showPresetPanel').textContent.trim(),
      }));
      assert.deepEqual(state, {
        title: 'Local Color Studio',
        input: 'Exposure +20',
        chip: 'Exposure +20',
        library: 'LUT Library',
      });
      const assets = runtimeManifest
        .standaloneOutputFiles(root)
        .filter((relative) => relative !== 'index.html' && relative !== 'BUILD.json');
      const assetResults = await page.evaluate(
        async (paths) =>
          Promise.all(
            paths.map(async (pathname) => ({ pathname, status: (await fetch(pathname)).status }))
          ),
        assets
      );
      for (const result of assetResults)
        assert.equal(
          result.status,
          200,
          `candidate runtime asset did not resolve: ${result.pathname}`
        );
      assert.deepEqual(forbidden, [], 'candidate made a forbidden network request');
      assert.deepEqual(failed, [], 'candidate received a failed runtime response');
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    stop(server);
  }
});
