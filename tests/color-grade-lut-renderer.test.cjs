const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { validateBytes } = require('../assets/color-grade/color-grade-lut.js');
const {
  createTransform,
  sample,
  applyPixels,
  contract,
} = require('../assets/color-grade/color-grade-lut-renderer.js');

const fixturesRoot = path.join(__dirname, 'fixtures', 'luts');
const lutCache = new Map();

function fixture(relativePath) {
  if (!lutCache.has(relativePath)) {
    const result = validateBytes(
      fs.readFileSync(path.join(fixturesRoot, ...relativePath.split('/')))
    );
    assert.equal(result.ok, true, `${relativePath}: ${result.code}`);
    lutCache.set(relativePath, result.lut);
  }
  return lutCache.get(relativePath);
}

function cube2(transform, domainMin = [0, 0, 0], domainMax = [1, 1, 1]) {
  const values = [];
  for (let blue = 0; blue < 2; blue += 1) {
    for (let green = 0; green < 2; green += 1) {
      for (let red = 0; red < 2; red += 1) {
        values.push(...transform([red, green, blue]));
      }
    }
  }
  return {
    gridSize: 2,
    domainMin,
    domainMax,
    values: Float64Array.from(values),
    ordering: 'red-fastest',
  };
}

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    assert.ok(
      Math.abs(actual[index] - value) <= tolerance,
      `channel ${index}: expected ${value}, received ${actual[index]}`
    );
  });
}

function referencePixels() {
  const data = new Uint8ClampedArray(256 * 4);
  let state = 0x7f4a7c15;
  for (let pixel = 0; pixel < 256; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[pixel * 4 + channel] = state >>> 24;
    }
    data[pixel * 4 + 3] = pixel;
  }
  return data;
}

function sha256(values) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(values.buffer, values.byteOffset, values.byteLength))
    .digest('hex');
}

function bytesFromHex(value) {
  assert.match(value, /^[0-9a-f]{8}$/);
  return Array.from(Buffer.from(value, 'hex'));
}

test('exports the frozen P0-3 trilinear rendering contract', () => {
  assert.equal(typeof createTransform, 'function');
  assert.equal(typeof sample, 'function');
  assert.equal(typeof applyPixels, 'function');
  assert.deepEqual(contract, {
    version: 1,
    interpolation: 'trilinear',
    ordering: 'red-fastest',
    inputEncoding: 'normalized-srgb',
    outputEncoding: 'normalized-srgb',
    outOfDomain: 'clamp-to-edge',
    pixelFormat: 'rgba8-uint8-clamped',
    pixelMutation: 'in-place',
    alpha: 'preserve',
    intensityRange: [0, 1],
    intensitySpace: 'encoded-srgb',
    byteConversion: 'ecmascript-to-uint8-clamp',
    invalidInput: 'throw',
  });
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.intensityRange), true);
});

test('exposes the renderer through its browser global without page integration', () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, '..', 'assets', 'color-grade', 'color-grade-lut-renderer.js'),
      'utf8'
    ),
    context
  );
  assert.equal(typeof context.ColorGradeLutRenderer.createTransform, 'function');
  assert.equal(context.ColorGradeLutRenderer.contract.interpolation, 'trilinear');
});

test('trilinear sampling follows red-fastest CUBE axis order', () => {
  const lut = cube2(([red, green, blue]) => [
    0.1 + red * 0.6 + green * 0.2 + blue * 0.1,
    red * 0.2 + green * 0.5 + blue * 0.3,
    red * 0.4 + green * 0.1 + blue * 0.5,
  ]);
  assertClose(sample(lut, [0.25, 0.5, 0.75]), [0.425, 0.525, 0.525], 1e-12);

  const transform = createTransform(lut);
  assertClose(transform.sample([1, 0, 0]), [0.7, 0.2, 0.4], 1e-12);
  assertClose(transform.sample([0, 1, 0]), [0.3, 0.5, 0.1], 1e-12);
  assertClose(transform.sample([0, 0, 1]), [0.2, 0.3, 0.5], 1e-12);
});

test('trilinear sampling includes all eight corners', () => {
  const oneHot = cube2(([red, green, blue]) => {
    const value = red === 1 && green === 1 && blue === 1 ? 1 : 0;
    return [value, value, value];
  });
  assertClose(sample(oneHot, [0.25, 0.5, 0.75]), [0.09375, 0.09375, 0.09375], 1e-12);
});

test('identity LUTs at 17, 33, and 65 points preserve normalized samples', () => {
  const probes = [
    [0, 0, 0],
    [1, 1, 1],
    [0.123, 0.456, 0.789],
    [0.875, 0.3125, 0.640625],
  ];
  for (const size of [17, 33, 65]) {
    const transform = createTransform(fixture(`valid/identity-${size}.cube`));
    for (const probe of probes) assertClose(transform.sample(probe), probe, 6e-7);
  }
});

test('identity rendering preserves every byte and all alpha values', () => {
  const input = referencePixels();
  const expected = new Uint8ClampedArray(input);
  const output = applyPixels(input, fixture('valid/identity-33.cube'));
  assert.equal(output, input);
  assert.deepEqual(output, expected);
});

test('matches the independently generated reference chart for all accepted LUTs', () => {
  const reference = JSON.parse(
    fs.readFileSync(path.join(fixturesRoot, 'reference-outputs.json'), 'utf8')
  );
  assert.equal(reference.schemaVersion, 1);
  assert.equal(reference.referenceContract.version, contract.version);

  const orderedSwatches = Object.entries(reference.input.swatches).sort(
    ([left], [right]) => Number.parseInt(left, 10) - Number.parseInt(right, 10)
  );
  const input = Uint8ClampedArray.from(orderedSwatches.flatMap(([, rgba]) => bytesFromHex(rgba)));
  assert.equal(input.length, reference.input.byteLength);
  assert.equal(sha256(input), reference.input.sha256);
  assert.equal(reference.outputs.length, 7);

  for (const expected of reference.outputs) {
    const lut = fixture(expected.fixturePath);
    assert.equal(lut.sha256, expected.lutSha256, `${expected.fixturePath}: LUT hash`);
    const output = createTransform(lut).applyPixels(new Uint8ClampedArray(input));
    assert.equal(output.byteLength, expected.outputByteLength);
    assert.equal(sha256(output), expected.outputSha256, `${expected.fixturePath}: output hash`);

    for (const [label, rgba] of Object.entries(expected.probes)) {
      const index = Number.parseInt(label, 10);
      assert.deepEqual(
        Array.from(output.subarray(index * 4, index * 4 + 4)),
        bytesFromHex(rgba),
        `${expected.fixturePath}: ${label}`
      );
    }
    for (let offset = 3; offset < output.length; offset += 4) {
      assert.equal(output[offset], input[offset], `${expected.fixturePath}: alpha byte ${offset}`);
    }
    if (expected.fixturePath.startsWith('valid/identity-')) assert.deepEqual(output, input);
  }
});

test('custom domains map within their range and clamp outside values to the nearest face', () => {
  const lut = cube2(
    ([red, green, blue]) => [0.25 + red * 0.5, 0.25 + green * 0.5, 0.25 + blue * 0.5],
    [0.25, 0.25, 0.25],
    [0.75, 0.75, 0.75]
  );
  const transform = createTransform(lut);
  assertClose(transform.sample([0.25, 0.5, 0.75]), [0.25, 0.5, 0.75], 1e-12);
  assertClose(transform.sample([-1, 0.5, 2]), [0.25, 0.5, 0.75], 1e-12);
});

test('extremely narrow finite domains do not overflow their coordinate mapping', () => {
  const maximum = Number.MIN_VALUE;
  const lut = cube2(
    ([red, green, blue]) => [red, green, blue],
    [0, 0, 0],
    [maximum, maximum, maximum]
  );
  const transform = createTransform(lut);
  assertClose(transform.sample([0, 0, 0]), [0, 0, 0], 0);
  assertClose(transform.sample([maximum, maximum, maximum]), [1, 1, 1], 0);
});

test('pixel rendering applies normalized intensity and preserves alpha', () => {
  const constant = cube2(() => [1, 0, 0.5]);
  const source = new Uint8ClampedArray([20, 100, 220, 17, 255, 0, 40, 231]);
  const unchanged = new Uint8ClampedArray(source);
  assert.deepEqual(createTransform(constant).applyPixels(unchanged, { intensity: 0 }), source);

  const output = new Uint8ClampedArray(source);
  createTransform(constant).applyPixels(output, { intensity: 0.5 });
  assert.deepEqual(output, new Uint8ClampedArray([138, 50, 174, 17, 255, 0, 84, 231]));
});

test('pixel rendering uses Uint8ClampedArray ties-to-even conversion', () => {
  const constant = cube2(() => [0.5 / 255, 1.5 / 255, 2.5 / 255]);
  const output = new Uint8ClampedArray([100, 100, 100, 29]);
  createTransform(constant).applyPixels(output);
  assert.deepEqual(output, new Uint8ClampedArray([0, 2, 2, 29]));
});

test('a transform snapshots LUT values when it is created', () => {
  const lut = cube2(([red, green, blue]) => [red, green, blue]);
  const transform = createTransform(lut);
  lut.values.fill(0);
  assertClose(transform.sample([1, 1, 1]), [1, 1, 1], 0);
});

test('rejects malformed LUTs, pixel buffers, RGB probes, and intensity values', () => {
  const valid = cube2(([red, green, blue]) => [red, green, blue]);
  assert.throws(() => createTransform(null), TypeError);
  assert.throws(() => createTransform({ ...valid, gridSize: 1 }), RangeError);
  assert.throws(() => createTransform({ ...valid, ordering: 'blue-fastest' }), RangeError);
  assert.throws(() => createTransform({ ...valid, values: valid.values.slice(1) }), RangeError);
  assert.throws(() => createTransform({ ...valid, domainMin: ['0', 0, 0] }), TypeError);
  assert.throws(() => createTransform({ ...valid, domainMin: [-1, 0, 0] }), RangeError);

  const stringValue = { ...valid, values: Array.from(valid.values) };
  stringValue.values[0] = '0';
  assert.throws(() => createTransform(stringValue), RangeError);

  const invalidValue = { ...valid, values: new Float64Array(valid.values) };
  invalidValue.values[0] = Number.NaN;
  assert.throws(() => createTransform(invalidValue), RangeError);

  const transform = createTransform(valid);
  assert.throws(() => transform.sample([0, 1]), TypeError);
  assert.throws(() => transform.sample(['0', 1, 0]), TypeError);
  assert.throws(() => transform.sample([0, 1, Number.NaN]), TypeError);
  assert.throws(() => transform.applyPixels(new Uint8Array(4)), TypeError);
  assert.throws(() => transform.applyPixels(new Uint8ClampedArray(3)), RangeError);
  assert.throws(
    () => transform.applyPixels(new Uint8ClampedArray(4), { intensity: 1.01 }),
    RangeError
  );
});
