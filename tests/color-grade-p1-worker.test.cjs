const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const Lut = require('../assets/color-grade/color-grade-lut.js');
const LutRenderer = require('../assets/color-grade/color-grade-lut-renderer.js');
const Renderer = require('../assets/color-grade/color-grade-renderer.js');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets', 'color-grade');

function workerHarness() {
  const messages = [];
  const scope = {
    ArrayBuffer,
    Float64Array,
    TextDecoder,
    TextEncoder,
    Uint8ClampedArray,
    postMessage(message, transfer) {
      messages.push(structuredClone(message, transfer?.length ? { transfer } : undefined));
    },
  };
  scope.self = scope;
  const context = vm.createContext(scope);
  scope.importScripts = (...files) =>
    files.forEach((file) =>
      vm.runInContext(fs.readFileSync(path.join(assets, file), 'utf8'), context, { filename: file })
    );
  vm.runInContext(fs.readFileSync(path.join(assets, 'color-grade-p1-worker.js'), 'utf8'), context, {
    filename: 'color-grade-p1-worker.js',
  });
  return {
    send(message) {
      scope.onmessage({ data: message });
    },
    take() {
      assert.ok(messages.length, 'expected a worker response');
      return messages.shift();
    },
  };
}

test('P1 Worker blends the complete LUT effect from the untouched source and preserves alpha', () => {
  const worker = workerHarness();
  assert.equal(worker.take().type, 'ready');
  const bytes = fs.readFileSync(
    path.join(assets, '..', '..', 'tests', 'fixtures', 'luts', 'creative', 'warm-portrait-17.cube')
  );
  worker.send({
    type: 'validate-lut',
    requestId: 'validate',
    lutId: 'warm',
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  assert.equal(worker.take().result.ok, true);
  const source = Uint8ClampedArray.from([20, 60, 180, 33, 220, 130, 25, 199]);
  worker.send({
    type: 'set-source',
    requestId: 'source',
    generation: 1,
    width: 2,
    height: 1,
    buffer: source.buffer,
  });
  assert.equal(worker.take().type, 'source-ready');
  const settings = { delta: { exposure: 15, contrast: -10 } };
  worker.send({
    type: 'render',
    requestId: 'render',
    id: 'preview',
    generation: 1,
    basis: { kind: 'lut', lutId: 'warm', intensity: 0.5 },
    settings,
  });
  const output = worker.take();
  assert.equal(output.type, 'rendered');

  const parsed = Lut.validateBytes(bytes).lut;
  const fullEffect = new Uint8ClampedArray([20, 60, 180, 33, 220, 130, 25, 199]);
  LutRenderer.applyPixels(fullEffect, parsed);
  Renderer.applyPixels(fullEffect, { b: 1, c: 1, s: 1, w: 1, t: 0 }, settings);
  const expected = new Uint8ClampedArray(source);
  for (let index = 0; index < expected.length; index += 4) {
    expected[index] = source[index] + (fullEffect[index] - source[index]) * 0.5;
    expected[index + 1] = source[index + 1] + (fullEffect[index + 1] - source[index + 1]) * 0.5;
    expected[index + 2] = source[index + 2] + (fullEffect[index + 2] - source[index + 2]) * 0.5;
  }
  assert.deepEqual(Array.from(new Uint8ClampedArray(output.buffer)), Array.from(expected));
  assert.deepEqual(Array.from(source), [20, 60, 180, 33, 220, 130, 25, 199]);
  assert.equal(new Uint8ClampedArray(output.buffer)[3], 33);
  assert.equal(new Uint8ClampedArray(output.buffer)[7], 199);

  for (const [intensity, expectedPixels] of [
    [0, source],
    [1, fullEffect],
  ]) {
    worker.send({
      type: 'render',
      requestId: `endpoint-${intensity}`,
      id: `endpoint-${intensity}`,
      generation: 1,
      basis: { kind: 'lut', lutId: 'warm', intensity },
      settings,
    });
    assert.deepEqual(
      Array.from(new Uint8ClampedArray(worker.take().buffer)),
      Array.from(expectedPixels),
      `${intensity * 100}% must match its endpoint`
    );
  }
});

test('P1 Worker accepts standard-v2 highlight settings and rejects unknown tone models', () => {
  const worker = workerHarness();
  worker.take();
  worker.send({
    type: 'set-source',
    requestId: 'source',
    generation: 3,
    width: 1,
    height: 1,
    buffer: Uint8ClampedArray.from([220, 220, 220, 77]).buffer,
  });
  worker.take();
  worker.send({
    type: 'render',
    requestId: 'standard',
    id: 'standard',
    generation: 3,
    basis: { kind: 'parameters', parameters: { b: 1, c: 1, s: 1, w: 1, t: 0 } },
    settings: { toneModel: 'standard-v2', delta: { highlights: 50 } },
  });
  const standard = worker.take();
  assert.equal(standard.type, 'rendered');
  assert.ok(new Uint8ClampedArray(standard.buffer)[0] > 220);
  worker.send({
    type: 'render',
    requestId: 'invalid-tone-model',
    id: 'invalid-tone-model',
    generation: 3,
    basis: { kind: 'parameters', parameters: { b: 1, c: 1, s: 1, w: 1, t: 0 } },
    settings: { toneModel: 'made-up', delta: { highlights: 50 } },
  });
  assert.equal(worker.take().code, 'invalid-render-options');
});

test('P1 Worker forwards versioned studio-v2 grading settings to the shared renderer', () => {
  const worker = workerHarness();
  worker.take();
  const source = Uint8ClampedArray.from([48, 48, 48, 77]);
  worker.send({
    type: 'set-source',
    requestId: 'source',
    generation: 4,
    width: 1,
    height: 1,
    buffer: source.buffer,
  });
  worker.take();
  const settings = {
    gradingModel: 'studio-v2',
    grading: {
      shadows: { hue: 220, saturation: 90, lightness: 8, intensity: 100 },
      midtones: { hue: 0, saturation: 0, lightness: 0, intensity: 0 },
      highlights: { hue: 0, saturation: 0, lightness: 0, intensity: 0 },
      balance: -20,
    },
  };
  worker.send({
    type: 'render',
    requestId: 'studio-grade',
    id: 'studio-grade',
    generation: 4,
    basis: { kind: 'parameters', parameters: { b: 1, c: 1, s: 1, w: 1, t: 0 } },
    settings,
  });
  const output = worker.take();
  assert.equal(output.type, 'rendered');
  const expected = Renderer.applyPixels(
    new Uint8ClampedArray(source),
    { b: 1, c: 1, s: 1, w: 1, t: 0 },
    settings
  );
  assert.deepEqual(Array.from(new Uint8ClampedArray(output.buffer)), Array.from(expected));
  assert.equal(new Uint8ClampedArray(output.buffer)[3], 77);
});

test('P1 Worker blends parameter effects from the untouched source and rejects an unloaded LUT', () => {
  const worker = workerHarness();
  worker.take();
  const source = Uint8ClampedArray.from([100, 90, 80, 77]);
  worker.send({
    type: 'set-source',
    requestId: 'source',
    generation: 2,
    width: 1,
    height: 1,
    buffer: source.buffer,
  });
  worker.take();
  worker.send({
    type: 'render',
    requestId: 'parameters',
    id: 'parameters',
    generation: 2,
    basis: {
      kind: 'parameters',
      parameters: { b: 1.1, c: 1, s: 1, w: 1, t: 0 },
      intensity: 0.5,
    },
  });
  const rendered = worker.take();
  assert.equal(rendered.type, 'rendered');
  const fullEffect = Renderer.applyPixels(new Uint8ClampedArray(source), {
    b: 1.1,
    c: 1,
    s: 1,
    w: 1,
    t: 0,
  });
  const expected = new Uint8ClampedArray(source);
  for (let index = 0; index < expected.length; index += 4) {
    expected[index] = source[index] + (fullEffect[index] - source[index]) * 0.5;
    expected[index + 1] = source[index + 1] + (fullEffect[index + 1] - source[index + 1]) * 0.5;
    expected[index + 2] = source[index + 2] + (fullEffect[index + 2] - source[index + 2]) * 0.5;
  }
  assert.deepEqual(Array.from(new Uint8ClampedArray(rendered.buffer)), Array.from(expected));
  assert.equal(new Uint8ClampedArray(rendered.buffer)[3], 77);
  worker.send({
    type: 'render',
    requestId: 'missing',
    id: 'missing',
    generation: 2,
    basis: { kind: 'lut', lutId: 'missing', intensity: 1 },
  });
  assert.equal(worker.take().code, 'lut-not-loaded');
});

test('P1 Worker validates strict parameter JSON without running it on the page thread', () => {
  const worker = workerHarness();
  worker.take();
  const valid = new TextEncoder().encode(
    JSON.stringify({
      format: 'real-landscape-filter',
      version: 1,
      kind: 'parameters',
      name: 'Worker JSON',
      parameters: { b: 1, c: 1, s: 1, w: 1, t: 0 },
      metadata: {
        author: '',
        sourceUrl: '',
        scenes: [],
        inputColorSpace: 'sRGB SDR',
        outputColorSpace: 'sRGB SDR',
      },
    })
  );
  worker.send({ type: 'validate-parameters', requestId: 'json', buffer: valid.buffer });
  const accepted = worker.take();
  assert.equal(accepted.type, 'parameters-validated');
  assert.equal(accepted.result.compatibilityStatus, 'applicable');
  const invalid = new TextEncoder().encode('{"script":"bad"}');
  worker.send({ type: 'validate-parameters', requestId: 'bad-json', buffer: invalid.buffer });
  assert.equal(worker.take().code, 'invalid-json-schema');
});
