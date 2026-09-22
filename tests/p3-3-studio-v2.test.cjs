const assert = require('node:assert/strict');
const test = require('node:test');

const Studio = require('../src/core/color/studio-v2.js');
const Baker = require('../src/core/conversion/baker.js');
const Model = require('../src/core/color/transform-document.js');

function close(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1)
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${index}: ${actual[index]} !== ${expected[index]}`
    );
}
function identityLut() {
  const values = [];
  for (let b = 0; b < 2; b += 1)
    for (let g = 0; g < 2; g += 1) for (let r = 0; r < 2; r += 1) values.push(r, g, b);
  return Model.createColorTransformDocument({
    source: { format: 'test' },
    colorContract: { inputColorSpace: 'srgb-sdr', outputColorSpace: 'srgb-sdr' },
    transforms: [{ type: 'lut3d', size: 2, values }],
    compatibility: { photoColorSpace: 'srgb-sdr' },
  });
}

test('P3-3 freezes a Float64, SDR-only studio-v2 contract and all requested controls are bakeable point operations', () => {
  assert.equal(Studio.contract.renderEngineVersion, 'studio-v2');
  assert.equal(Studio.contract.precision, 'float64');
  for (const name of [
    'exposure',
    'contrast',
    'highlights',
    'shadows',
    'whites',
    'blacks',
    'temperature',
    'tint',
    'saturation',
    'vibrance',
    'lutIntensity',
  ])
    assert.equal(Studio.controls[name].bakeable, true);
  assert.ok(Studio.contract.bakeability.excludedEffects.includes('crop'));
  assert.ok(Studio.contract.bakeability.excludedEffects.includes('image-statistics'));
  assert.ok(
    Studio.contract.order.indexOf('base-effect-lut') < Studio.contract.order.indexOf('rgb-curves')
  );
});

test('P3-3 neutral settings are identity, alpha remains exact, and base LUT intensity is mixed before manual adjustments', () => {
  const neutral = Studio.createProcessor();
  close(neutral.applyRgb([0.2, 0.4, 0.6]), [0.2, 0.4, 0.6]);
  const rgba = neutral.applyRgba([0.2, 0.4, 0.6, 0.123456789]);
  close(rgba.subarray(0, 3), [0.2, 0.4, 0.6]);
  assert.equal(rgba[3], 0.123456789);
  const base = identityLut();
  const processor = Studio.createProcessor({
    baseDocument: base,
    settings: { lutIntensity: 0, exposure: 1 },
  });
  close(processor.applyRgb([0.1, 0.2, 0.3]), [0.2, 0.4, 0.6]);
});

test('P3-3 base controls have deterministic extrema and clamp only at the documented final output boundary', () => {
  const upper = Studio.createProcessor({
    settings: { exposure: 5, contrast: 100, whites: 100, temperature: 100, saturation: 100 },
  });
  const lower = Studio.createProcessor({
    settings: { exposure: -5, contrast: -100, blacks: -100, temperature: -100, saturation: -100 },
  });
  const bright = upper.applyRgb([1, 0.9, 0.8]);
  const dark = lower.applyRgb([0.1, 0.2, 0.3]);
  for (const value of [...bright, ...dark])
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  assert.ok(bright[0] >= dark[0]);
});

test('P3-3 every scalar control has an identity default, finite extrema, and stable serialized representation', () => {
  for (const [name, definition] of Object.entries(Studio.controls)) {
    const neutral = Studio.createSettings({ [name]: definition.default });
    assert.equal(neutral[name], definition.default, name);
    for (const value of [definition.min, definition.max]) {
      const settings = Studio.createSettings({ [name]: value });
      const output = Studio.createProcessor({ settings }).applyRgb([0.13, 0.47, 0.81]);
      for (const channel of output)
        assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 1, name);
      assert.equal(
        Studio.serialize(settings),
        Studio.serialize(Studio.deserialize(Studio.serialize(settings))),
        name
      );
    }
  }
});

test('P3-3 curves support deterministic repeated controls, HSL bands, and three tonal wheels without non-finite boundary output', () => {
  const settings = Studio.createSettings({
    curves: {
      rgb: [
        [0, 0],
        [0.5, 0.1],
        [0.5, 0.8],
        [1, 1],
      ],
    },
    hsl: { red: { hue: 100, saturation: 100, lightness: 100 } },
    wheels: {
      shadows: { hue: 210, saturation: 100 },
      midtones: { hue: 20, saturation: 100 },
      highlights: { hue: 55, saturation: 100 },
    },
    wheelStrength: 100,
    wheelBalance: -25,
  });
  assert.deepEqual(settings.curves.rgb, [
    [0, 0],
    [0.5, 0.8],
    [1, 1],
  ]);
  const processor = Studio.createProcessor({ settings });
  for (const pixel of [
    [1, 0, 0],
    [0, 0, 0],
    [1, 1, 1],
    [0.99, 0.01, 0.01],
  ])
    for (const value of processor.applyRgb(pixel))
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
});

test('P3-3 settings serialization is stable, rejects spatial/statistical impostors, and history supports undo/redo/copy/paste/reset', () => {
  const settings = Studio.createSettings({ exposure: 1, hsl: { blue: { saturation: 23 } } });
  const text = Studio.serialize(settings);
  assert.equal(text, Studio.serialize(Studio.deserialize(text)));
  assert.throws(
    () => Studio.createSettings({ crop: { x: 0 } }),
    (error) => error.code === 'studio-v2-unsupported-node'
  );
  assert.throws(
    () =>
      Studio.createSettings({
        curves: {
          cyan: [
            [0, 0],
            [1, 1],
          ],
        },
      }),
    (error) => error.code === 'studio-v2-unsupported-node'
  );
  const history = new Studio.StudioHistory();
  history.commit(settings);
  assert.equal(history.canUndo(), true);
  assert.equal(history.undo().exposure, 0);
  assert.equal(history.redo().exposure, 1);
  history.paste(history.copy());
  assert.equal(history.reset().exposure, 0);
});

test('P3-3 maintains the declared fixed order and a before/after comparison never changes the source sample', () => {
  const processor = Studio.createProcessor({
    settings: {
      exposure: 1,
      curves: {
        rgb: [
          [0, 0],
          [1, 0.5],
        ],
      },
    },
  });
  const input = Float64Array.of(0.2, 0.4, 0.6);
  const comparison = processor.compareRgb(input);
  close(comparison.before, input, 0);
  close(comparison.after, [0.2, 0.4, 0.5]);
  close(input, [0.2, 0.4, 0.6], 0);
});

test('P3-3 RGB histogram observes the same post-process graph and cannot affect rendered pixels', () => {
  const processor = Studio.createProcessor({ settings: { exposure: 1 } });
  const pixels = Float64Array.of(0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 0.5);
  const before = processor.applyPixels(pixels);
  const histogram = Studio.createHistogram(pixels, { bins: 4, processor });
  const after = processor.applyPixels(pixels);
  assert.deepEqual(Array.from(before), Array.from(after));
  assert.equal(histogram.pixels, 2);
  assert.equal(
    histogram.red.reduce((sum, value) => sum + value, 0),
    2
  );
  assert.equal(
    histogram.green.reduce((sum, value) => sum + value, 0),
    2
  );
  assert.equal(
    histogram.blue.reduce((sum, value) => sum + value, 0),
    2
  );
});

test('P3-3 pointwise graph can be explicitly compiled for the existing Baker and reports spatial nodes as excluded', () => {
  const document = Studio.toBakerDocument({
    settings: { exposure: 0.5, saturation: 20 },
    size: 17,
  });
  assert.equal(document.metadata.renderEngineVersion, 'studio-v2');
  assert.ok(document.metadata.excludedNodes.includes('crop'));
  const converted = Baker.convertToCube(document, { size: 17 });
  assert.equal(converted.report.loss, 'pipeline-bake');
  assert.ok(converted.report.excludedNodes.includes('crop'));
});
