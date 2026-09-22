const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Spi = require('../src/core/lut/spi-io.js');
const Csp = require('../src/core/lut/csp-io.js');
const Lustre = require('../src/core/lut/lustre-3dl-io.js');
const Cpu = require('../src/core/lut/cpu-reference-processor.js');
const Convert = require('../src/core/conversion/extended-lut-conversion.js');
const Legacy3dl = require('../assets/color-grade/color-grade-3dl.js');
const Model = require('../src/core/color/transform-document.js');

const utf8 = (text) => new TextEncoder().encode(text);
const srgb = { inputColorSpace: 'srgb-sdr', outputColorSpace: 'srgb-sdr' };
const spi3d = `SPILUT 1.0\n3 3\n2 2 2\n1 1 1 1 0 0\n0 1 1 0 1 1\n1 0 1 1 1 0\n0 0 1 0 0 1\n1 1 0 0.4 0.5 0.6\n0 1 0 0.1 0.2 0.3\n1 0 0 0.7 0.8 0.9\n0 0 0 0 0 0\n`;

test('P3-4 SPI1D preserves explicit range, applies values, writes deterministically, and reads back', () => {
  const source = utf8(
    'Version 1\nFrom -2 4\nLength 2\nComponents 3\n{\n0.1 0.2 0.3\n0.7 0.8 0.9\n}\n'
  );
  const document = Spi.parseSpi1dBytes(source, { colorContract: srgb });
  assert.deepEqual(Array.from(document.transforms[0].domainMin), [-2, -2, -2]);
  assert.deepEqual(Array.from(Cpu.createProcessor(document).applyRgb([4, 4, 4])), [0.7, 0.8, 0.9]);
  const result = Convert.convertToSpi1d(document);
  assert.deepEqual(Spi.writeSpi1d(document), result.bytes);
  assert.equal(result.report.target.sha256, Spi.hash(result.bytes));
  assert.equal(result.report.loss, 'format-rewrite');
});

test('P3-4 SPI3D accepts unordered explicit indices and reorders them to internal red-fastest', () => {
  const document = Spi.parseSpi3dBytes(utf8(spi3d), { colorContract: srgb });
  const actual = Cpu.createProcessor(document).applyRgb([1, 0, 0]);
  assert.deepEqual(Array.from(actual), [0.7, 0.8, 0.9]);
  const result = Convert.convertToSpi3d(document, { size: 17 });
  assert.equal(result.document.transforms[0].size, 17);
  assert.equal(result.report.target.dialect, 'sony-spi3d-v1');
  assert.equal(result.report.target.sha256, Spi.hash(result.bytes));
});

test('P3-4 SPI3D rejects duplicate, missing, out-of-range and oversized explicit grids', () => {
  assert.throws(
    () => Spi.parseSpi3dBytes(utf8(spi3d.replace('0 0 0 0 0 0', '1 1 1 0 0 0'))),
    (error) => error.code === 'duplicate-spi-index'
  );
  assert.throws(
    () => Spi.parseSpi3dBytes(utf8(spi3d.replace('1 1 1 1 0 0', '2 1 1 1 0 0'))),
    (error) => error.code === 'invalid-spi-index'
  );
  assert.throws(
    () => Spi.parseSpi3dBytes(utf8('SPILUT 1.0\n3 3\n66 66 66\n')),
    (error) => error.code === 'invalid-spi-header'
  );
  assert.throws(
    () => Spi.parseSpi3dBytes(utf8(spi3d.replace(/\n0 0 0 0 0 0\n/, '\n'))),
    (error) => error.code === 'missing-spi-index'
  );
});

test('P3-4 SPI3D rejects non-default domains rather than silently writing a changed transform', () => {
  const document = Model.createColorTransformDocument({
    source: { format: 'test' },
    colorContract: srgb,
    transforms: [
      {
        type: 'lut3d',
        size: 2,
        domainMin: [-1, -1, -1],
        domainMax: [2, 2, 2],
        values: new Float64Array(2 ** 3 * 3).fill(0.25),
      },
    ],
  });
  assert.throws(
    () => Spi.writeSpi3d(document),
    (error) => error.code === 'invalid-spi-target'
  );
  assert.throws(
    () => Convert.convertToSpi3d(document, { size: 17 }),
    (error) => error.code === 'invalid-spi-target'
  );
});

test('P3-4 CSP preserves a pre-LUT before its 3D table and rejects unknown sections', () => {
  const source = utf8(
    'CSPLUTV100\n3D\n2\n-1 1\n0 0.5\n2\n-1 1\n0 0.5\n2\n-1 1\n0 0.5\n2 2 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n'
  );
  const document = Csp.parseCspBytes(source, { colorContract: srgb });
  assert.deepEqual(
    document.transforms.map((node) => node.type),
    ['lut1d', 'lut3d']
  );
  assert.deepEqual(Array.from(Cpu.createProcessor(document).applyRgb([1, 1, 1])), [0.5, 0.5, 0.5]);
  const roundTrip = Csp.parseCspBytes(Csp.writeCsp(document), { colorContract: srgb });
  assert.deepEqual(
    roundTrip.transforms.map((node) => node.type),
    ['lut1d', 'lut3d']
  );
  const converted = Convert.convertToCsp(document, { size: 17 });
  assert.equal(converted.report.loss, 'pipeline-bake');
  assert.equal(converted.report.target.sha256, Csp.hash(converted.bytes));
  assert.throws(
    () => Csp.parseCspBytes(utf8('CSPLUTV100\n3D\nBEGIN METADATA\n')),
    (error) => error.code === 'unsupported-csp-section'
  );
  assert.throws(
    () => Csp.parseCspBytes(utf8('CSPLUTV100\n3D\n2\n')),
    (error) => error instanceof Csp.CspIoError && error.code === 'invalid-csp-data'
  );
});

test('P3-4 fixed OpenColorIO Lustre sample has explicit 5/12 bit semantics and blue-fastest transposition', () => {
  const bytes = fs.readFileSync(
    path.join(__dirname, 'fixtures/3dl/external-source/lustre_33x33x33.3dl')
  );
  const document = Lustre.parseLustre3dlBytes(bytes, { colorContract: srgb });
  assert.equal(document.transforms[0].size, 33);
  assert.equal(document.metadata.threeDl.outputBitDepth, 12);
  const first = document.transforms[0].values.slice(0, 3);
  assert.deepEqual(Array.from(first), [2 / 4095, 4 / 4095, 4 / 4095]);
  const result = Convert.convertToLustre3dl(document);
  assert.equal(result.document.transforms[0].size, 33);
  assert.equal(result.report.target.bitDepth, 12);
  assert.equal(result.report.target.sha256, Lustre.hash(result.bytes));
  assert.ok(result.report.metrics.maximum <= 1 / 4095, result.report.metrics.maximum);
});

test('P3-4 keeps unsupported Flame/Discreet and malformed Lustre files on explicit refusal paths', () => {
  const discreet = fs.readFileSync(
    path.join(__dirname, 'fixtures/3dl/external-source/discreet-3d-lut.3dl')
  );
  assert.equal(Legacy3dl.detectText(discreet.toString('utf8')).status, 'detected-unsupported');
  assert.throws(
    () => Lustre.parseLustre3dlBytes(discreet),
    (error) => error.code === 'unsupported-3dl-dialect'
  );
  assert.throws(
    () => Lustre.parseLustre3dlBytes(utf8('3DMESH\nMesh 5 12\n0 0 0\n')),
    (error) => error.code === 'invalid-lustre-3dl-data'
  );
  assert.throws(
    () => Lustre.parseLustre3dlBytes(new Uint8Array(20 * 1024 * 1024 + 1)),
    (error) => error.code === '3dl-file-too-large'
  );
});
