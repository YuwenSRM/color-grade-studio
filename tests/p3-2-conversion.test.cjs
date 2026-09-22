const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Cube = require('../src/core/lut/cube-io.js');
const Hald = require('../src/core/lut/hald-png.js');
const Baker = require('../src/core/conversion/baker.js');
const Cpu = require('../src/core/lut/cpu-reference-processor.js');
const Model = require('../src/core/color/transform-document.js');

const root = path.resolve(__dirname, '..');
const source = (name) =>
  fs.readFileSync(path.join(root, 'tests/fixtures/luts/external-source', name));
const srgb = { inputColorSpace: 'srgb-sdr', outputColorSpace: 'srgb-sdr' };

test('P3-2 parses fixed OpenColorIO IRIDAS and Resolve CUBE fixtures without changing legacy parsing', () => {
  const one = Cube.parseCubeBytes(source('ocio-iridas-1d.cube'));
  const three = Cube.parseCubeBytes(source('ocio-iridas-3d.cube'));
  const combined = Cube.parseCubeBytes(source('ocio-resolve-1d3d.cube'));
  assert.deepEqual(
    one.transforms.map((node) => [node.type, node.size]),
    [['lut1d', 5]]
  );
  assert.deepEqual(
    three.transforms.map((node) => [node.type, node.size]),
    [['lut3d', 2]]
  );
  assert.deepEqual(
    combined.transforms.map((node) => [node.type, node.size]),
    [
      ['lut1d', 6],
      ['lut3d', 3],
    ]
  );
  assert.equal(combined.source.dialect, 'resolve');
  assert.deepEqual(Array.from(combined.transforms[0].domainMin), [-1, -1, -1]);
  assert.deepEqual(Array.from(combined.transforms[1].domainMax), [4, 4, 4]);
  assert.throws(
    () =>
      Cube.parseCubeText(
        'LUT_3D_SIZE 2\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\nUNKNOWN 1'
      ),
    (error) => error.code === 'invalid-cube-directive'
  );
});

test('P3-2 writes deterministic CUBE and mandatory readback preserves its grid points', () => {
  const document = Cube.parseCubeBytes(source('ocio-iridas-3d.cube'), { colorContract: srgb });
  const first = Cube.writeCube(document, { dialect: 'iridas' });
  const second = Cube.writeCube(document, { dialect: 'iridas' });
  assert.deepEqual(first, second);
  const reread = Cube.parseCubeBytes(first, { colorContract: srgb });
  assert.deepEqual(
    Array.from(reread.transforms[0].values),
    Array.from(document.transforms[0].values)
  );
  const converted = Baker.convertToCube(document, { size: 17, dialect: 'resolve' });
  assert.equal(converted.report.target.sha256, Cube.hash(converted.bytes));
  assert.equal(converted.report.loss, 'grid-resample');
  assert.equal(converted.report.metrics.maximum, 0);
  assert.equal(converted.document.transforms[0].size, 17);
});

test('P3-2 bakes CUBE to default Level 8 Hald then reads the external-standard layout back', () => {
  const document = Cube.parseCubeBytes(
    fs.readFileSync(path.join(root, 'tests/fixtures/luts/valid/identity-17.cube')),
    { colorContract: srgb }
  );
  const result = Baker.convertToHald(document);
  assert.equal(result.document.source.format, 'hald-png');
  assert.equal(result.document.transforms[0].size, 64);
  assert.equal(result.report.target.bitDepth, 8);
  assert.ok(result.report.metrics.maximum <= 1 / 255, result.report.metrics.maximum);
  assert.equal(result.report.target.sha256, Cube.hash(result.bytes));
  assert.equal(result.document.metadata.hald.layout, 'flat-red-fastest');
  const backToCube = Baker.convertToCube(result.document, { size: 33 });
  assert.equal(backToCube.document.transforms[0].size, 33);
  assert.equal(backToCube.report.source.format, 'hald-png');
});

test('P3-2 rejects frozen unsupported PNG variants and supports RGB/RGBA non-interlaced safety subset', () => {
  const pixels = new Uint8Array(4 * 4 * 4).fill(255);
  const png = Hald.encodePngRgba(4, 4, pixels);
  const decoded = Hald.decodePng(png);
  assert.deepEqual([decoded.width, decoded.height, decoded.colorType], [4, 4, 6]);
  const badInterlace = new Uint8Array(png);
  badInterlace[28] = 1;
  assert.throws(
    () => Hald.decodePng(badInterlace),
    (error) => error.code === 'invalid-png'
  );
  assert.throws(
    () => Hald.parseHaldPng(png),
    (error) => error.code === 'invalid-hald-layout'
  );
});

test('P3-2 keeps the red-fastest Hald axis order for a non-symmetric transform', () => {
  const values = new Float64Array(2 ** 3 * 3);
  let at = 0;
  for (let blue = 0; blue < 2; blue += 1) {
    for (let green = 0; green < 2; green += 1) {
      for (let red = 0; red < 2; red += 1) {
        values[at++] = 0.2 * red + 0.4 * blue;
        values[at++] = 0.2 * red + 0.1 * green;
        values[at++] = 0.2 * green + 0.1 * blue;
      }
    }
  }
  const document = Model.createColorTransformDocument({
    source: { format: 'test' },
    colorContract: srgb,
    transforms: [{ type: 'lut3d', size: 2, values }],
    compatibility: { photoColorSpace: 'srgb-sdr' },
  });
  const encoded = Hald.writeHaldPng(document, { level: 2 });
  const reread = Hald.parseHaldPng(encoded.bytes, { colorContract: srgb });
  const actual = Cpu.createProcessor(reread).applyRgb([1, 0, 1]);
  for (const [index, expected] of [0.6, 0.2, 0.1].entries()) {
    assert.ok(Math.abs(actual[index] - expected) <= 1 / 255, actual[index]);
  }
});

test('P3-2 conversion honors cancellation and memory budgets without creating a target', () => {
  const document = Cube.parseCubeBytes(source('ocio-iridas-3d.cube'), { colorContract: srgb });
  assert.throws(
    () => Baker.bakeToLut3D(document, { size: 17, memoryBudgetBytes: 1 }),
    (error) => error.code === 'memory-budget-exceeded'
  );
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => Baker.convertToCube(document, { size: 17, signal: controller.signal }),
    (error) => error.code === 'operation-aborted'
  );
  assert.throws(
    () => Baker.convertToHald(document),
    (error) => error.code === 'conversion-error-threshold-exceeded'
  );
});

test('P3-2 parameter JSON creates a traceable pointwise subgraph and names excluded spatial nodes', () => {
  const json = JSON.stringify({
    format: 'real-landscape-filter',
    version: 1,
    kind: 'parameters',
    name: 'Baked',
    parameters: { b: 1.1, c: 0.9, s: 1.05, w: 1.02, t: 4 },
    metadata: { inputColorSpace: 'sRGB SDR', outputColorSpace: 'sRGB SDR' },
  });
  const document = Baker.parameterDocument(json);
  assert.equal(document.source.format, 'real-landscape-filter-json');
  assert.ok(document.metadata.excludedNodes.includes('crop'));
  const result = Baker.convertToCube(document, { size: 17 });
  assert.equal(result.report.loss, 'pipeline-bake');
  assert.ok(result.report.metrics.maximum <= 5e-8, result.report.metrics.maximum);
  assert.ok(result.report.excludedNodes.includes('crop'));
  assert.equal(Cpu.createProcessor(result.document).applyRgb([0.4, 0.5, 0.6]).length, 3);
});
