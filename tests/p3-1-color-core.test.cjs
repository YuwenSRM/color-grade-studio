const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const Model = require('../src/core/color/transform-document.js');
const Cpu = require('../src/core/lut/cpu-reference-processor.js');
const Legacy = require('../src/core/lut/legacy-v1-adapter.js');
const Conversion = require('../src/core/conversion/contracts.js');
const LegacyLut = require('../assets/color-grade/color-grade-lut.js');
const LegacyRenderer = require('../assets/color-grade/color-grade-lut-renderer.js');

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `channel ${index}: expected ${expected[index]}, received ${actual[index]}`
    );
  }
}

function cube2(callback) {
  const values = [];
  for (let blue = 0; blue < 2; blue += 1) {
    for (let green = 0; green < 2; green += 1) {
      for (let red = 0; red < 2; red += 1) values.push(...callback(red, green, blue));
    }
  }
  return values;
}

function document(transforms, compatibility = { photoColorSpace: 'srgb-sdr' }) {
  return Model.createColorTransformDocument({
    source: { format: 'test', filename: 'non-symmetric.fixture' },
    colorContract: {
      inputColorSpace: 'srgb-sdr',
      outputColorSpace: 'srgb-sdr',
      workingColorSpace: 'srgb-sdr',
    },
    transforms,
    compatibility,
  });
}

test('P3-1 exports a DOM-independent frozen Float64 processing contract', () => {
  assert.deepEqual(Cpu.contract, {
    version: 2,
    precision: 'float64',
    interpolation: { lut1d: 'linear', lut3d: 'trilinear' },
    ordering: 'red-fastest',
    outOfDomain: {
      range: 'preserve-unless-clamp-true',
      lut1d: 'clamp-to-edge',
      lut3d: 'clamp-to-edge',
    },
    alpha: 'preserve-exactly',
    strength: { range: [0, 1], application: 'mix-original-with-final-sequence' },
    quantization: 'caller-boundary-only',
    invalidInput: 'throw-structured-error',
  });
  assert.equal(Object.isFrozen(Cpu.contract), true);
  assert.equal(Object.isFrozen(Cpu.contract.interpolation), true);

  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src/core/color/transform-document.js'), 'utf8'),
    context
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src/core/lut/cpu-reference-processor.js'), 'utf8'),
    context
  );
  assert.equal(typeof context.ColorTransformCpu.createProcessor, 'function');
  assert.equal(context.document, undefined);
  assert.equal(context.window, undefined);
});

test('ColorTransformDocument preserves ordered Range, Lut1D, Matrix, and Lut3D nodes', () => {
  const inputValues = cube2((red, green, blue) => [
    red * 0.6 + green * 0.2 + blue * 0.1,
    red * 0.1 + green * 0.7 + blue * 0.2,
    red * 0.3 + green * 0.1 + blue * 0.5,
  ]);
  const doc = document([
    { type: 'range', minIn: [0.25, 0.25, 0.25], maxIn: [0.75, 0.75, 0.75] },
    {
      type: 'lut1d',
      size: 2,
      values: [0, 0, 0, 0.5, 0.6, 0.7],
    },
    { type: 'matrix', matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], offset: [0.1, 0.1, 0.1] },
    { type: 'lut3d', size: 2, values: inputValues },
  ]);
  assert.deepEqual(
    doc.transforms.map((node) => node.type),
    ['range', 'lut1d', 'matrix', 'lut3d']
  );
  assert.equal(doc.transforms[3].ordering, 'red-fastest');
  assert.equal(doc.transforms[3].values instanceof Float64Array, true);
  assert.equal(Object.isFrozen(doc), true);
  assert.equal(Object.isFrozen(doc.transforms), true);

  // 0.5 maps to 0.5 through Range, 0.25/0.3/0.35 through LUT1D, then 0.35/0.4/0.45.
  assertClose(Cpu.createProcessor(doc).applyRgb([0.5, 0.5, 0.5]), [0.335, 0.405, 0.37]);
});

test('parse, application, and conversion states are independent and explicit', () => {
  const unassigned = Model.createColorTransformDocument({
    source: { format: 'cube' },
    transforms: [],
    compatibility: {
      photoColorSpace: 'srgb-sdr',
      conversionTargets: {
        cube: { status: 'not-yet-implemented', code: 'p3-2', loss: null },
      },
    },
  });
  assert.equal(unassigned.compatibility.parseStatus, 'parsed');
  assert.deepEqual(unassigned.compatibility.application, {
    status: 'requires-color-space-assignment',
    code: 'lut-color-space-unassigned',
  });
  assert.deepEqual(unassigned.compatibility.conversionTargets.cube, {
    status: 'not-yet-implemented',
    code: 'p3-2',
    loss: null,
  });
  assert.equal(
    Model.withApplicationAssessment(unassigned, 'display-p3').compatibility.application.status,
    'requires-color-space-assignment'
  );

  const applicable = document([], { photoColorSpace: 'srgb-sdr' });
  assert.equal(applicable.compatibility.application.status, 'applicable');
  assert.equal(
    Model.withApplicationAssessment(applicable, 'display-p3').compatibility.application.status,
    'unsupported-color-space'
  );
});

test('the CPU executor applies a non-symmetric 3D LUT in red-fastest order and clamps LUT domains', () => {
  const doc = document([
    {
      type: 'lut3d',
      size: 2,
      domainMin: [0.25, 0.25, 0.25],
      domainMax: [0.75, 0.75, 0.75],
      values: cube2((red, green, blue) => [
        red + 2 * green + 4 * blue,
        10 * red + green,
        100 * green + blue,
      ]),
    },
  ]);
  const processor = Cpu.createProcessor(doc);
  assertClose(processor.applyRgb([0.5, 0.5, 0.5]), [3.5, 5.5, 50.5]);
  assertClose(processor.applyRgb([-4, 2, 0.5]), [4, 1, 100.5]);
});

test('Range preserves out-of-range values unless clamp is explicit; strength mixes after the full sequence', () => {
  const unclamped = Cpu.createProcessor(
    document([
      { type: 'range', minIn: [0, 0, 0], maxIn: [1, 1, 1], minOut: [0, 0, 0], maxOut: [2, 2, 2] },
    ])
  );
  assertClose(unclamped.applyRgb([1.5, -0.25, 0.5]), [3, -0.5, 1]);
  assertClose(unclamped.applyRgb([0.2, 0.4, 0.6], { intensity: 0.25 }), [0.25, 0.5, 0.75]);
  const clamped = Cpu.createProcessor(
    document([
      {
        type: 'range',
        clamp: true,
        minIn: [0, 0, 0],
        maxIn: [1, 1, 1],
        minOut: [0, 0, 0],
        maxOut: [2, 2, 2],
      },
    ])
  );
  assertClose(clamped.applyRgb([1.5, -0.25, 0.5]), [2, 0, 1]);
});

test('Float64 RGBA pixel execution preserves alpha exactly and has no intermediate RGBA8 quantization', () => {
  const processor = Cpu.createProcessor(
    document([
      {
        type: 'matrix',
        matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        offset: [1 / 1024, 1 / 2048, -1 / 4096],
      },
    ])
  );
  const result = processor.applyPixels(
    Float64Array.of(0.1, 0.2, 0.3, 0.123456789, 0.4, 0.5, 0.6, 1)
  );
  assertClose(result.subarray(0, 4), [0.1009765625, 0.20048828125, 0.299755859375, 0.123456789], 0);
  assertClose(result.subarray(4, 8), [0.4009765625, 0.50048828125, 0.599755859375, 1], 0);
  assert.equal(result instanceof Float64Array, true);
});

test('processors snapshot LUT values and return structured cancellation, memory, and input errors', () => {
  const values = cube2((red, green, blue) => [red, green, blue]);
  const doc = document([{ type: 'lut3d', size: 2, values }]);
  const processor = Cpu.createProcessor(doc);
  doc.transforms[0].values.fill(0);
  assertClose(processor.applyRgb([1, 1, 1]), [1, 1, 1]);
  assert.throws(
    () => processor.applyRgb([0, Number.NaN, 0]),
    (error) => error.code === 'invalid-rgb'
  );
  assert.throws(
    () => processor.applyRgb([0, 0, 0], { intensity: 2 }),
    (error) => error.code === 'invalid-intensity'
  );
  assert.throws(
    () => processor.applyPixels(new Float64Array(4), { memoryBudgetBytes: 1 }),
    (error) => error.code === 'memory-budget-exceeded'
  );
  assert.throws(
    () => processor.applyPixels(new Float64Array(4), { signal: { aborted: true } }),
    (error) => error.code === 'operation-aborted'
  );
});

test('legacy-v1 remains untouched and can be represented by an explicit v2 adapter document', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/luts/valid/identity-17.cube'));
  const parsed = LegacyLut.validateBytes(fixture);
  assert.equal(parsed.ok, true);
  const source = new Uint8ClampedArray([12, 128, 247, 73]);
  const before = LegacyRenderer.applyPixels(new Uint8ClampedArray(source), parsed.lut);
  assert.deepEqual(before, source);
  const adapted = Legacy.toColorTransformDocument(parsed.lut, { filename: 'identity-17.cube' });
  assert.equal(adapted.metadata.renderEngineVersion, 'legacy-v1');
  assert.equal(adapted.compatibility.application.status, 'applicable');
  assertClose(
    Cpu.createProcessor(adapted).applyRgba([12 / 255, 128 / 255, 247 / 255, 73 / 255]),
    [12 / 255, 128 / 255, 247 / 255, 73 / 255],
    6e-7
  );
  assert.equal(Legacy.renderEngineVersion({}), 'legacy-v1');
  assert.equal(Legacy.renderEngineVersion({ renderEngineVersion: 'studio-v2' }), 'studio-v2');
});

test('P3-1 conversion task boundary defines cancellation, progress, and memory behavior without implementing P3-2 formats', () => {
  assert.equal(Conversion.conversionContract.version, 1);
  const events = [];
  const guard = Conversion.createTaskGuard({
    memoryBudgetBytes: 32,
    onProgress: (event) => events.push(event),
  });
  guard.reserve(32);
  guard.checkpoint(1, 2);
  assert.deepEqual(events, [{ completed: 1, total: 2 }]);
  assert.throws(
    () => guard.reserve(33),
    (error) => error.code === 'memory-budget-exceeded'
  );
  assert.throws(
    () => guard.checkpoint(2, 1),
    (error) => error.code === 'invalid-conversion-task'
  );
  assert.throws(
    () => Conversion.createTaskGuard({ signal: { aborted: true } }).checkpoint(0, 1),
    (error) => error.code === 'operation-aborted'
  );
});
