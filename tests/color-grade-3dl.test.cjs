const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const detector = require('../assets/color-grade/color-grade-3dl.js');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, 'tests', 'fixtures', '3dl', 'external-source');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));

test('licensed OpenColorIO .3dl fixtures remain byte-identical and detected as unsupported dialects', () => {
  assert.equal(manifest.upstreamLicense, 'BSD-3-Clause');
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'LICENSE.txt')), true);
  for (const entry of manifest.entries) {
    const bytes = fs.readFileSync(path.join(root, entry.path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const detected = detector.detectText(bytes.toString('utf8'), {
      filename: path.basename(entry.path),
    });
    assert.deepEqual(
      {
        ok: detected.ok,
        status: detected.status,
        code: detected.code,
        dialect: detected.dialect,
        gridSize: detected.gridSize,
        outputRange: detected.outputRange,
      },
      {
        ok: true,
        status: 'detected-unsupported',
        code: 'unsupported-3dl-dialect',
        dialect: entry.expectedDialect,
        gridSize: entry.expectedGridSize,
        outputRange: entry.expectedOutputRange,
      }
    );
    assert.equal(detected.dataRows, entry.expectedDataRows);
  }
});

test('3dl detector rejects unknown and incomplete formats without treating them as applicable LUTs', () => {
  assert.equal(detector.detectText('LUT_3D_SIZE 2\n0 0 0').status, 'rejected');
  assert.equal(detector.detectText('3DMESH\nMesh 4 12').code, 'incomplete-3dl-mesh');
  assert.equal(detector.detectText('').code, 'invalid-3dl-text');
});

test('3dl detector refuses non-.3dl files before reading them', async () => {
  const result = await detector.detectFile({ name: 'not-a-lut.cube', text: async () => '3DMESH' });
  assert.equal(result.code, 'unsupported-3dl-extension');
  assert.equal(result.status, 'rejected');
});
