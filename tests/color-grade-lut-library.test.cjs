const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  LutLibrary,
  LutLibraryError,
  validateParameterFilterText,
  createStoredZip,
  readStoredZip,
  DB_VERSION,
  COLOR_SPACE_SRGB,
  COLOR_SPACE_UNKNOWN,
} = require('../assets/color-grade/color-grade-lut-library.js');

const root = path.resolve(__dirname, '..');

function file(name, contents, type = 'text/plain') {
  const blob = new Blob([contents], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

function jsonFilter(name = '柔和人像') {
  return JSON.stringify({
    format: 'real-landscape-filter',
    version: 1,
    kind: 'parameters',
    name,
    parameters: { b: 1, c: 0.9, s: 0.85, w: 1.02, t: 2 },
    metadata: {
      author: '测试作者',
      sourceUrl: '',
      scenes: ['人像'],
      inputColorSpace: 'sRGB SDR',
      outputColorSpace: 'sRGB SDR',
    },
  });
}

function memoryLibrary() {
  let sequence = 0;
  return new LutLibrary({
    indexedDB: null,
    idFactory: () => `filter-${++sequence}`,
    allowMemoryFallback: true,
  });
}

test('validates the strict Real Landscape parameter JSON schema', () => {
  const valid = validateParameterFilterText(jsonFilter());
  assert.deepEqual(valid.parameters, { b: 1, c: 0.9, s: 0.85, w: 1.02, t: 2 });
  assert.equal(valid.compatibilityStatus, 'applicable');
  assert.throws(
    () =>
      validateParameterFilterText(
        jsonFilter().replace('"kind":"parameters",', '"kind":"parameters","script":"bad",')
      ),
    (error) => error instanceof LutLibraryError && error.code === 'invalid-json-schema'
  );
  assert.throws(
    () => validateParameterFilterText(jsonFilter().replace('"t":2', '"t":99')),
    (error) => error instanceof LutLibraryError && error.code === 'invalid-json-schema'
  );
});

test('imports CUBE and parameter filters, preserves CUBE bytes, and skips matching hashes', async () => {
  const library = memoryLibrary();
  const cube = fs.readFileSync(
    path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-17.cube')
  );
  const first = await library.importFile(file('identity.cube', cube), {
    name: 'Identity',
    scenes: ['风景'],
    inputColorSpace: COLOR_SPACE_SRGB,
    outputColorSpace: COLOR_SPACE_SRGB,
  });
  assert.equal(first.status, 'imported');
  assert.equal(first.filter.kind, 'lut');
  assert.equal(first.filter.compatibilityStatus, 'applicable');
  assert.equal((await library.getBlob(first.filter.id)).size, cube.length);
  const duplicate = await library.importFile(file('same-content.cube', cube));
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.filter.id, first.filter.id);

  const parameter = await library.importFile(
    file('portrait.json', jsonFilter(), 'application/json')
  );
  assert.equal(parameter.status, 'imported');
  assert.equal(parameter.filter.kind, 'parameters');
  assert.equal((await library.list()).length, 2);
});

test('retains unknown-color-space LUTs for management but marks them unavailable', async () => {
  const library = memoryLibrary();
  const cube = fs.readFileSync(
    path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-17.cube')
  );
  const result = await library.importFile(file('unknown.cube', cube));
  assert.equal(result.filter.inputColorSpace, COLOR_SPACE_UNKNOWN);
  assert.equal(result.filter.compatibilityStatus, 'unknown-color-space');
  const updated = await library.update(result.filter.id, {
    inputColorSpace: COLOR_SPACE_SRGB,
    outputColorSpace: COLOR_SPACE_SRGB,
    favorite: true,
  });
  assert.equal(updated.compatibilityStatus, 'applicable');
  assert.equal(updated.favorite, true);
});

test('keeps an existing LUT record intact when its source Blob cannot be written', async () => {
  const library = memoryLibrary();
  const cube = fs.readFileSync(
    path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-17.cube')
  );
  const imported = await library.importFile(file('identity.cube', cube), {
    inputColorSpace: COLOR_SPACE_SRGB,
    outputColorSpace: COLOR_SPACE_SRGB,
  });
  library.memoryBlobs.delete(imported.filter.blobKey);

  await assert.rejects(library.update(imported.filter.id, { name: '不应保存的新名称' }), {
    code: 'invalid-blob',
  });
  assert.equal((await library.get(imported.filter.id)).name, imported.filter.name);
});

test('returns a known CUBE duplicate even when the library has reached its capacity', async () => {
  const library = memoryLibrary();
  const cube = fs.readFileSync(
    path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-17.cube')
  );
  const first = await library.importFile(file('identity.cube', cube), {
    inputColorSpace: COLOR_SPACE_SRGB,
    outputColorSpace: COLOR_SPACE_SRGB,
  });
  for (let index = 1; index < 50; index += 1)
    await library.importFile(
      file(`parameter-${index}.json`, jsonFilter(`参数 ${index}`), 'application/json')
    );

  assert.equal((await library.list()).length, 50);
  const duplicate = await library.importFile(file('same-content.cube', cube));
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.filter.id, first.filter.id);
});

test('backs up and fully validates a library before merge or replace restore', async () => {
  const source = memoryLibrary();
  const cube = fs.readFileSync(
    path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-17.cube')
  );
  await source.importFile(file('identity.cube', cube), {
    inputColorSpace: COLOR_SPACE_SRGB,
    outputColorSpace: COLOR_SPACE_SRGB,
  });
  await source.importFile(file('portrait.json', jsonFilter(), 'application/json'));
  const backup = await source.exportBackup();

  const destination = memoryLibrary();
  const merged = await destination.restoreBackup(backup, { mode: 'merge' });
  assert.deepEqual(merged, { mode: 'merge', imported: 2, skipped: 0, total: 2 });
  assert.equal((await destination.list()).length, 2);
  const skipped = await destination.restoreBackup(backup, { mode: 'merge' });
  assert.equal(skipped.imported, 0);
  assert.equal(skipped.skipped, 2);

  const corruptBytes = new Uint8Array(await backup.arrayBuffer());
  // Local ZIP header is 30 bytes plus "manifest.json"; mutate stored manifest data so its CRC fails.
  corruptBytes[48] ^= 0xff;
  const corrupt = new Blob([corruptBytes], { type: 'application/zip' });
  const before = await destination.list();
  await assert.rejects(destination.restoreBackup(corrupt, { mode: 'replace' }), {
    code: 'invalid-backup',
  });
  assert.deepEqual(
    await destination.list(),
    before,
    'a rejected restore must not mutate the library'
  );
});

test('requires persistent storage in production and uses an injected async LUT validator', async () => {
  await assert.rejects(new LutLibrary({ indexedDB: null }).list(), {
    code: 'storage-unavailable',
  });
  let calls = 0;
  const library = new LutLibrary({
    indexedDB: null,
    allowMemoryFallback: true,
    idFactory: () => 'worker-validated',
    lutValidator: async (candidate, { signal }) => {
      calls += 1;
      assert.equal(signal, undefined);
      return require('../assets/color-grade/color-grade-lut.js').validateBytes(
        await candidate.arrayBuffer()
      );
    },
  });
  const cube = fs.readFileSync(
    path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-17.cube')
  );
  await library.importFile(file('worker.cube', cube), {
    inputColorSpace: COLOR_SPACE_SRGB,
    outputColorSpace: COLOR_SPACE_SRGB,
  });
  assert.equal(calls, 1);
});

test('validates parameter-filter hashes in backups and previews replacement impact without mutation', async () => {
  assert.equal(DB_VERSION, 2);
  const source = memoryLibrary();
  await source.importFile(file('portrait.json', jsonFilter(), 'application/json'));
  const backup = await source.exportBackup();
  const entries = readStoredZip(new Uint8Array(await backup.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
  manifest.filters[0].parameters.b = 1.2;
  entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  const tampered = new Blob(
    [createStoredZip(Array.from(entries, ([name, bytes]) => ({ name, bytes })))],
    { type: 'application/zip' }
  );
  const destination = memoryLibrary();
  const before = await destination.list();
  await assert.rejects(destination.previewRestore(tampered, { mode: 'replace' }), {
    code: 'invalid-backup',
  });
  assert.deepEqual(await destination.list(), before);

  const preview = await destination.previewRestore(backup, { mode: 'replace' });
  assert.deepEqual(
    {
      mode: preview.mode,
      imported: preview.imported,
      skipped: preview.skipped,
      total: preview.total,
      replaced: preview.replaced,
    },
    { mode: 'replace', imported: 1, skipped: 0, total: 1, replaced: 0 }
  );
  assert.deepEqual(await destination.list(), before, 'preflight must not write to the destination');
});

test('backup restore rejects malformed records and does not overwrite ID conflicts', async () => {
  const source = memoryLibrary();
  await source.importFile(file('backup.json', jsonFilter('来自备份'), 'application/json'));
  const backup = await source.exportBackup();
  const entries = readStoredZip(new Uint8Array(await backup.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
  manifest.filters[0].name = '';
  entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  const malformed = new Blob(
    [createStoredZip(Array.from(entries, ([name, bytes]) => ({ name, bytes })))],
    { type: 'application/zip' }
  );
  const destination = memoryLibrary();
  await assert.rejects(destination.restoreBackup(malformed), { code: 'invalid-backup' });
  assert.deepEqual(await destination.list(), []);

  const local = await destination.importFile(file('local.json', jsonFilter('本地条目')));
  const collisionEntries = readStoredZip(new Uint8Array(await backup.arrayBuffer()));
  const collisionManifest = JSON.parse(
    new TextDecoder().decode(collisionEntries.get('manifest.json'))
  );
  collisionManifest.filters[0].id = local.filter.id;
  collisionEntries.set(
    'manifest.json',
    new TextEncoder().encode(JSON.stringify(collisionManifest))
  );
  const idCollision = new Blob(
    [createStoredZip(Array.from(collisionEntries, ([name, bytes]) => ({ name, bytes })))],
    { type: 'application/zip' }
  );
  const preview = await destination.previewRestore(idCollision, { mode: 'merge' });
  assert.equal(preview.imported, 0);
  assert.equal(preview.conflicts.length, 1);
  await destination.restoreBackup(idCollision, { mode: 'merge' });
  assert.equal((await destination.get(local.filter.id)).name, '本地条目');
});
