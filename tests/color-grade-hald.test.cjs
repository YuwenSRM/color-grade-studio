const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Hald = require('../assets/color-grade/color-grade-hald.js');
const Lut = require('../assets/color-grade/color-grade-lut.js');

const root = path.resolve(__dirname, '..');

function loadLut(relativePath) {
  const parsed = Lut.validateBytes(fs.readFileSync(path.join(root, relativePath)));
  assert.equal(parsed.ok, true, parsed.error?.message || parsed.code);
  return parsed.lut;
}

function eligible(lut) {
  return {
    lut,
    inputColorSpace: 'sRGB SDR',
    outputColorSpace: 'sRGB SDR',
    compatibilityStatus: 'applicable',
  };
}

test('Hald Level 8 round-trips 17, 33 and 65 point identity LUTs within the 8-bit threshold', () => {
  for (const size of [17, 33, 65]) {
    const lut = loadLut(`tests/fixtures/luts/valid/identity-${size}.cube`);
    const sourceValues = Array.from(lut.values);
    const encoded = Hald.encodeHaldPng(eligible(lut));
    const decoded = Hald.decodeHaldPng(encoded.bytes);
    const comparison = Hald.compareLutSamples(eligible(lut), decoded, size);
    assert.deepEqual(
      {
        width: decoded.width,
        height: decoded.height,
        level: decoded.level,
        layout: decoded.layout,
        sourceHash: decoded.text.SourceLutSha256,
      },
      {
        width: 512,
        height: 512,
        level: 8,
        layout: 'flat-red-fastest',
        sourceHash: lut.sha256,
      }
    );
    assert.ok(comparison.maximumError <= 1 / 255, `${size}: ${comparison.maximumError}`);
    assert.deepEqual(
      Array.from(lut.values),
      sourceValues,
      'export must not mutate parsed CUBE values'
    );
  }
});

test('Hald rejects incompatible color spaces and non-default CUBE domains', () => {
  const lut = loadLut('tests/fixtures/luts/valid/identity-17.cube');
  assert.throws(
    () => Hald.encodeHaldPng({ ...eligible(lut), outputColorSpace: '未知' }),
    (error) => error instanceof Hald.HaldError && error.code === 'incompatible-color-space'
  );
  const customDomain = loadLut('tests/fixtures/luts/edge/domain-quarter-to-three-quarters-4.cube');
  assert.throws(
    () => Hald.encodeHaldPng(eligible(customDomain)),
    (error) => error instanceof Hald.HaldError && error.code === 'unsupported-domain'
  );
});

test('Hald async export honours cancellation and corrupted PNG data is rejected', async () => {
  const lut = loadLut('tests/fixtures/luts/valid/identity-17.cube');
  const controller = new AbortController();
  const pending = Hald.encodeHaldPngAsync(eligible(lut), { signal: controller.signal });
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof Hald.HaldError && error.code === 'operation-aborted'
  );

  const encoded = Hald.encodeHaldPng(eligible(lut));
  const corrupted = new Uint8Array(encoded.bytes);
  corrupted[48] ^= 1;
  assert.throws(
    () => Hald.decodeHaldPng(corrupted),
    (error) => error instanceof Hald.HaldError && error.code === 'invalid-png'
  );
});
