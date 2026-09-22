const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateCatalog } = require('../scripts/validate-p2-content-catalog.cjs');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'docs', 'reference', 'lut-content-catalog.json');

function readCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
}

test('P2-1 catalog has three admitted self-developed builtins and preserved validation fixtures', () => {
  const catalog = readCatalog();
  const result = validateCatalog(catalog, { root });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.summary, {
    entries: 6,
    admitted: 3,
    validationOnly: 3,
    releaseEnabled: 3,
  });
  assert.equal(catalog.catalogStatus, 'completed-local-research');
  const admitted = catalog.entries.filter((entry) => entry.admissionStatus === 'admitted');
  assert.equal(
    admitted.every(
      (entry) =>
        entry.origin === 'self-developed' &&
        entry.packagePolicy.includeInBuiltin === true &&
        entry.packagePolicy.includeInRelease === true &&
        entry.visualVerification.status === 'approved'
    ),
    true
  );
});

test('catalog rejects release admission without evidence', () => {
  const catalog = readCatalog();
  const candidate = structuredClone(catalog.entries[0]);
  candidate.admissionStatus = 'admitted';
  candidate.packagePolicy.includeInBuiltin = true;
  candidate.packagePolicy.includeInRelease = true;
  const result = validateCatalog({ ...catalog, entries: [candidate] }, { root });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /authorized test image/);
  assert.match(result.errors.join('\n'), /approved visualVerification/);
});

test('catalog rejects a changed content hash', () => {
  const catalog = readCatalog();
  const changed = structuredClone(catalog);
  changed.entries[0].content.sha256 = '0'.repeat(64);
  const result = validateCatalog(changed, { root });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /content: SHA-256 does not match/);
});

test('catalog rejects a CUBE metadata value that disagrees with the verified file', () => {
  const catalog = readCatalog();
  const changed = structuredClone(catalog);
  changed.entries.find(
    (entry) => entry.internalId === 'p2-builtin-soft-portrait'
  ).content.gridSize = 33;
  const result = validateCatalog(changed, { root });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /content\.gridSize does not match CUBE/);
});
