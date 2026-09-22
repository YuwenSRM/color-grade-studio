'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const cubePath = path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-17.cube');
const cubeText = fs.readFileSync(cubePath, 'utf8');
const browserPath = [
  chromium.executablePath(),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

function parameterJson(name) {
  return JSON.stringify({
    format: 'real-landscape-filter',
    version: 1,
    kind: 'parameters',
    name,
    parameters: { b: 1, c: 0.9, s: 0.85, w: 1.02, t: 2 },
    metadata: {
      author: 'P1-4 browser test',
      sourceUrl: '',
      scenes: ['人像'],
      inputColorSpace: 'sRGB SDR',
      outputColorSpace: 'sRGB SDR',
    },
  });
}

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

async function waitForServer(origin, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('P1-4 test server exited unexpectedly.');
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out starting the P1-4 test server.');
}

async function gotoEditor(context, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('#libraryStatus')?.textContent.length > 0
  );
  return page;
}

async function importFilter(page, name, json) {
  return page.evaluate(
    async ({ fileName, contents, type }) => {
      const library = new window.LandscapeLutLibrary.LutLibrary();
      const file = new File([contents], fileName, { type });
      const result = await library.importFile(file, {
        inputColorSpace: 'sRGB SDR',
        outputColorSpace: 'sRGB SDR',
      });
      return { id: result.filter.id, hash: result.filter.contentHash, kind: result.filter.kind };
    },
    {
      fileName: name,
      contents: json,
      type: name.endsWith('.json') ? 'application/json' : 'text/plain',
    }
  );
}

async function backupBytes(page) {
  return page.evaluate(async () => {
    const library = new window.LandscapeLutLibrary.LutLibrary();
    return Array.from(new Uint8Array(await (await library.exportBackup()).arrayBuffer()));
  });
}

async function libraryRows(page) {
  return page.evaluate(async () => {
    const library = new window.LandscapeLutLibrary.LutLibrary();
    return (await library.list()).map((filter) => ({
      id: filter.id,
      name: filter.name,
      kind: filter.kind,
      hash: filter.contentHash,
      favorite: filter.favorite,
    }));
  });
}

test(
  'P1-4 restores a ZIP in a clean browser library, merges by content hash, confirms replacement twice, and preserves data on corrupt input',
  { skip: !browserPath && 'No local Chromium, Chrome, or Edge executable is available.' },
  async () => {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const server = startServer(port);
    const browser = await chromium.launch({ executablePath: browserPath, headless: true });
    const sourceContext = await browser.newContext();
    const targetContext = await browser.newContext();
    try {
      await waitForServer(origin, server);
      const source = await gotoEditor(sourceContext, origin);
      const importedLut = await importFilter(source, 'backup-identity.cube', cubeText);
      const importedParameters = await importFilter(
        source,
        'backup-portrait.json',
        parameterJson('备份人像')
      );
      await source.evaluate(async (id) => {
        const library = new window.LandscapeLutLibrary.LutLibrary();
        await library.update(id, { favorite: true });
      }, importedLut.id);
      const backup = Buffer.from(await backupBytes(source));

      const target = await gotoEditor(targetContext, origin);
      const cleanResult = await target.evaluate(async (bytes) => {
        const library = new window.LandscapeLutLibrary.LutLibrary();
        return library.restoreBackup(new File([new Uint8Array(bytes)], 'library.zip'), {
          mode: 'merge',
        });
      }, Array.from(backup));
      assert.deepEqual(cleanResult, { mode: 'merge', imported: 2, skipped: 0, total: 2 });
      const cleanRows = await libraryRows(target);
      assert.equal(cleanRows.length, 2, 'a clean browser profile restores the full library');
      assert.equal(cleanRows.find((row) => row.id === importedLut.id).favorite, true);
      assert.deepEqual(
        new Set(cleanRows.map((row) => row.id)),
        new Set([importedLut.id, importedParameters.id])
      );
      const cleanBlobSize = await target.evaluate(async (id) => {
        const library = new window.LandscapeLutLibrary.LutLibrary();
        return (await library.getBlob(id))?.size || 0;
      }, importedLut.id);
      assert.ok(cleanBlobSize > 0, 'the original CUBE blob is restored alongside its record');

      await target.evaluate(async (id) => {
        const library = new window.LandscapeLutLibrary.LutLibrary();
        await library.remove(id);
      }, importedParameters.id);
      await importFilter(target, 'local-only.json', parameterJson('本地保留'));
      const mergePreview = await target.evaluate(async (bytes) => {
        const library = new window.LandscapeLutLibrary.LutLibrary();
        const file = new File([new Uint8Array(bytes)], 'library.zip');
        const preview = await library.previewRestore(file, { mode: 'merge' });
        await library.restoreBackup(file, { mode: 'merge' });
        return {
          imported: preview.imported,
          skipped: preview.skipped,
          duplicateReasons: preview.duplicates.map((entry) => entry.reason),
          conflicts: preview.conflicts.length,
        };
      }, Array.from(backup));
      assert.deepEqual(mergePreview, {
        imported: 1,
        skipped: 1,
        duplicateReasons: ['content-hash'],
        conflicts: 0,
      });
      assert.equal(
        (await libraryRows(target)).length,
        3,
        'merge retains local entries and adds only new content'
      );

      await target.evaluate(() => {
        window.__p14ConfirmCalls = [];
        window.confirm = (message) => {
          window.__p14ConfirmCalls.push(message);
          return true;
        };
      });
      await target.evaluate(() => {
        const control = document.querySelector('#restoreMode');
        control.value = 'replace';
        control.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await target.locator('#filterRestoreInput').setInputFiles({
        name: 'library.zip',
        mimeType: 'application/zip',
        buffer: backup,
      });
      await target.waitForFunction(() =>
        document.querySelector('#libraryStatus')?.textContent.includes('恢复完成：2 个导入')
      );
      const replaceCalls = await target.evaluate(() => window.__p14ConfirmCalls);
      assert.equal(
        replaceCalls.length,
        2,
        'replace requires the initial and post-validation confirmations'
      );
      assert.match(replaceCalls[1], /替换当前 3 个滤镜，并导入 2 个滤镜/);
      assert.deepEqual(
        new Set((await libraryRows(target)).map((row) => row.id)),
        new Set([importedLut.id, importedParameters.id])
      );

      const beforeCorrupt = await libraryRows(target);
      const corrupt = Buffer.from(backup);
      corrupt[48] ^= 0xff;
      await target.evaluate(() => {
        window.__p14ConfirmCalls = [];
      });
      await target.locator('#filterRestoreInput').setInputFiles({
        name: 'corrupt-library.zip',
        mimeType: 'application/zip',
        buffer: corrupt,
      });
      await target.waitForFunction(() =>
        document.querySelector('#libraryStatus')?.textContent.includes('备份恢复失败')
      );
      assert.deepEqual(
        await libraryRows(target),
        beforeCorrupt,
        'corrupt input cannot mutate the current library'
      );
      assert.equal((await target.evaluate(() => window.__p14ConfirmCalls)).length, 1);
    } finally {
      await sourceContext.close();
      await targetContext.close();
      await browser.close();
      if (server.exitCode === null) server.kill();
    }
  }
);

test(
  'P1-4 upgrades a real v1 IndexedDB database to v2 without dropping its filters',
  { skip: !browserPath && 'No local Chromium, Chrome, or Edge executable is available.' },
  async () => {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const server = startServer(port);
    const browser = await chromium.launch({ executablePath: browserPath, headless: true });
    const context = await browser.newContext();
    try {
      await waitForServer(origin, server);
      const setup = await context.newPage();
      await setup.goto(`${origin}/api/health`);
      await setup.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open('real-landscape-filter-library', 1);
            request.onupgradeneeded = () => {
              const store = request.result.createObjectStore('filters', { keyPath: 'id' });
              store.put({
                id: 'legacy-parameter',
                schemaVersion: 1,
                kind: 'parameters',
                contentHash: 'a'.repeat(64),
                name: 'Legacy parameter',
                origin: 'user',
                brand: '自定义',
                author: '',
                sourceUrl: '',
                licenseNote: '',
                scenes: ['人像'],
                inputColorSpace: 'sRGB SDR',
                outputColorSpace: 'sRGB SDR',
                compatibilityStatus: 'applicable',
                favorite: false,
                thumbnailKey: null,
                createdAt: '2026-09-01T00:00:00.000Z',
                updatedAt: '2026-09-01T00:00:00.000Z',
                parameters: { b: 1, c: 1, s: 1, w: 1, t: 0 },
              });
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              request.result.close();
              resolve();
            };
          })
      );
      const page = await gotoEditor(context, origin);
      const migrated = await page.evaluate(async () => {
        const library = new window.LandscapeLutLibrary.LutLibrary();
        const rows = await library.list();
        return await new Promise((resolve, reject) => {
          const request = indexedDB.open('real-landscape-filter-library');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction('settings', 'readonly');
            const setting = transaction.objectStore('settings').get('p1-contract-version');
            setting.onerror = () => reject(setting.error);
            setting.onsuccess = () => {
              resolve({
                version: database.version,
                stores: Array.from(database.objectStoreNames),
                hasHashIndex: database
                  .transaction('filters', 'readonly')
                  .objectStore('filters')
                  .indexNames.contains('contentHash'),
                setting: setting.result?.value,
                legacyName: rows.find((row) => row.id === 'legacy-parameter')?.name,
              });
              database.close();
            };
          };
        });
      });
      assert.deepEqual(migrated, {
        version: 2,
        stores: ['blobs', 'filters', 'settings'],
        hasHashIndex: true,
        setting: 1,
        legacyName: 'Legacy parameter',
      });
    } finally {
      await context.close();
      await browser.close();
      if (server.exitCode === null) server.kill();
    }
  }
);
