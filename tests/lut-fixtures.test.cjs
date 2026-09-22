const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixturesRoot = path.join(__dirname, 'fixtures', 'luts');
const manifest = JSON.parse(fs.readFileSync(path.join(fixturesRoot, 'manifest.json'), 'utf8'));

test('P0-1 LUT fixture manifest covers the agreed sample classes', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.entries.length, 19);

  const statusCounts = manifest.entries.reduce((counts, entry) => {
    counts[entry.expectedStatus] = (counts[entry.expectedStatus] || 0) + 1;
    return counts;
  }, {});

  assert.deepEqual(statusCounts, {
    accepted: 7,
    'recognized-but-rejected-for-p1-sdr': 2,
    rejected: 10,
  });

  const identitySizes = manifest.entries
    .filter((entry) => entry.sampleClass === 'valid-identity')
    .map((entry) => entry.gridSize)
    .sort((left, right) => left - right);
  assert.deepEqual(identitySizes, [17, 33, 65]);
});

test('P0-1 LUT fixture bytes and hashes match the manifest', () => {
  for (const entry of manifest.entries) {
    const filePath = path.join(fixturesRoot, ...entry.path.split('/'));
    const bytes = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const lines = bytes.toString('utf8').trimEnd().split(/\r?\n/).length;

    assert.equal(bytes.length, entry.bytes, `${entry.path}: byte length`);
    assert.equal(lines, entry.lines, `${entry.path}: line count`);
    assert.equal(hash, entry.sha256, `${entry.path}: SHA-256`);
  }
});
