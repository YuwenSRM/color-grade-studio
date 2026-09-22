const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const assetsRoot = path.join(root, 'assets', 'color-grade');
const fixturesRoot = path.join(__dirname, 'fixtures', 'luts');
const reference = JSON.parse(
  fs.readFileSync(path.join(fixturesRoot, 'reference-outputs.json'), 'utf8')
);

function lutBuffer(relativePath) {
  const bytes = fs.readFileSync(path.join(fixturesRoot, ...relativePath.split('/')));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function chartPixels() {
  return Uint8ClampedArray.from(
    Object.entries(reference.input.swatches)
      .sort(([left], [right]) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
      .flatMap(([, rgba]) => Array.from(Buffer.from(rgba, 'hex')))
  );
}

function sha256(values) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(values.buffer, values.byteOffset, values.byteLength))
    .digest('hex');
}

function workerHarness() {
  const messages = [];
  const worker = {
    ArrayBuffer,
    Float64Array,
    TextDecoder,
    TextEncoder,
    Uint8ClampedArray,
    postMessage(message, transfer) {
      messages.push(
        structuredClone(
          { message, transferred: Boolean(transfer?.length) },
          transfer?.length ? { transfer } : undefined
        )
      );
    },
  };
  worker.self = worker;
  const context = vm.createContext(worker);
  worker.importScripts = (...relativePaths) => {
    for (const relativePath of relativePaths) {
      const filename = path.resolve(assetsRoot, relativePath);
      vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    }
  };
  const filename = path.join(assetsRoot, 'color-grade-lut-worker.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return {
    messages,
    send(message) {
      worker.onmessage({ data: message });
    },
    take() {
      assert.ok(messages.length, 'expected a worker response');
      return messages.shift();
    },
  };
}

function expectReady(worker) {
  const response = worker.take();
  assert.equal(response.message.type, 'ready');
  assert.deepEqual(response.message.protocol, {
    version: 1,
    maximumCachedLuts: 4,
    lutIds: 'non-empty ASCII strings up to 128 characters',
    cachePolicy: 'least-recently-used',
  });
}

function validate(worker, requestId, lutId, relativePath) {
  worker.send({ type: 'validate-lut', requestId, lutId, buffer: lutBuffer(relativePath) });
  const response = worker.take().message;
  assert.equal(response.type, 'lut-validated');
  assert.equal(response.requestId, requestId);
  assert.equal(response.lutId, lutId);
  return response;
}

function setSource(worker, requestId, generation, pixels, width, height) {
  worker.send({
    type: 'set-source',
    requestId,
    generation,
    width,
    height,
    buffer: pixels.buffer,
  });
  const response = worker.take().message;
  assert.equal(response.type, 'source-ready');
  assert.equal(response.requestId, requestId);
  return response;
}

function render(worker, requestId, id, generation, lutId, intensity = undefined) {
  worker.send({ type: 'render', requestId, id, generation, lutId, intensity });
  return worker.take();
}

test('starts with a versioned, bounded cache protocol while P0 Worker remains outside the editor page', () => {
  const worker = workerHarness();
  expectReady(worker);
  const page = fs.readFileSync(path.join(root, 'color-grade.html'), 'utf8');
  assert.doesNotMatch(page, /color-grade-lut-worker\.js/);
  assert.match(page, /color-grade-lut\.js/);
  assert.match(page, /color-grade-lut-renderer\.js/);
  assert.match(page, /color-grade-p1-client\.js/);
});

test('validates a LUT, caches one transform, and matches the P0-3 golden output in the worker', () => {
  const worker = workerHarness();
  expectReady(worker);

  const validated = validate(
    worker,
    'validate-warm',
    'warm-portrait',
    'creative/warm-portrait-17.cube'
  );
  assert.equal(validated.result.ok, true);
  assert.equal(validated.result.lut.gridSize, 17);
  assert.equal(validated.result.lut.ordering, 'red-fastest');
  assert.equal(validated.evictedLutId, null);

  const input = chartPixels();
  const original = new Uint8ClampedArray(input);
  setSource(worker, 'source-chart', 4, input, reference.input.width, reference.input.height);
  const response = render(worker, 'render-warm', 'preview-warm', 4, 'warm-portrait');
  assert.equal(response.transferred, true);
  assert.equal(response.message.type, 'rendered');
  assert.equal(response.message.requestId, 'render-warm');
  assert.equal(response.message.id, 'preview-warm');
  assert.equal(response.message.lutId, 'warm-portrait');
  assert.equal(response.message.intensity, 1);

  const expected = reference.outputs.find(
    (entry) => entry.fixturePath === 'creative/warm-portrait-17.cube'
  );
  const output = new Uint8ClampedArray(response.message.buffer);
  assert.equal(sha256(output), expected.outputSha256);
  assert.deepEqual(input, original, 'the worker must retain an unchanged source buffer');
  for (let offset = 3; offset < output.length; offset += 4) {
    assert.equal(output[offset], input[offset]);
  }
});

test('reuses the cached transform for intensity changes without mutating the source pixels', () => {
  const worker = workerHarness();
  expectReady(worker);
  assert.equal(
    validate(worker, 'validate-identity', 'identity', 'valid/identity-33.cube').result.ok,
    true
  );
  const input = Uint8ClampedArray.from([20, 100, 220, 17, 255, 0, 40, 231]);
  const original = new Uint8ClampedArray(input);
  setSource(worker, 'source-intensity', 1, input, 2, 1);

  const half = render(worker, 'render-half', 'half', 1, 'identity', 0.5).message;
  assert.deepEqual(Array.from(new Uint8ClampedArray(half.buffer)), Array.from(input));
  const zero = render(worker, 'render-zero', 'zero', 1, 'identity', 0).message;
  assert.deepEqual(Array.from(new Uint8ClampedArray(zero.buffer)), Array.from(input));
  assert.deepEqual(input, original);
});

test('returns P0-2 diagnostics without caching rejected files and preserves a previous valid cache entry', () => {
  const worker = workerHarness();
  expectReady(worker);
  assert.equal(
    validate(worker, 'validate-good', 'replaceable', 'valid/identity-17.cube').result.ok,
    true
  );

  const rejected = validate(
    worker,
    'validate-bad',
    'replaceable',
    'invalid/wrong-column-count.cube'
  );
  assert.equal(rejected.result.ok, false);
  assert.equal(rejected.result.code, 'invalid-data-column-count');
  assert.equal(rejected.result.line, 6);
  assert.equal(rejected.result.error, undefined);

  const input = Uint8ClampedArray.from([90, 40, 20, 31]);
  setSource(worker, 'source-retained', 1, input, 1, 1);
  const response = render(worker, 'render-retained', 'retained', 1, 'replaceable').message;
  assert.equal(response.type, 'rendered');
  assert.deepEqual(Array.from(new Uint8ClampedArray(response.buffer)), Array.from(input));
});

test('ignores stale generations and lets the controller discard mismatched render work without source corruption', () => {
  const worker = workerHarness();
  expectReady(worker);
  assert.equal(
    validate(worker, 'validate-lut', 'identity', 'valid/identity-17.cube').result.ok,
    true
  );

  const sourceA = Uint8ClampedArray.from([10, 20, 30, 40]);
  setSource(worker, 'source-a', 8, sourceA, 1, 1);
  worker.send({
    type: 'set-source',
    requestId: 'source-stale',
    generation: 7,
    width: 1,
    height: 1,
    buffer: Uint8ClampedArray.from([200, 100, 50, 20]).buffer,
  });
  assert.equal(worker.messages.length, 0);
  worker.send({
    type: 'render',
    requestId: 'render-stale',
    id: 'stale',
    generation: 7,
    lutId: 'identity',
  });
  assert.equal(worker.messages.length, 0);

  const current = render(worker, 'render-current', 'current', 8, 'identity').message;
  assert.deepEqual(Array.from(new Uint8ClampedArray(current.buffer)), Array.from(sourceA));
});

test('bounds the cache with least-recently-used eviction and supports explicit disposal', () => {
  const worker = workerHarness();
  expectReady(worker);
  for (const lutId of ['one', 'two', 'three', 'four']) {
    const response = validate(worker, `validate-${lutId}`, lutId, 'valid/identity-17.cube');
    assert.equal(response.evictedLutId, null);
  }
  const fifth = validate(worker, 'validate-five', 'five', 'valid/identity-17.cube');
  assert.equal(fifth.evictedLutId, 'one');

  const input = Uint8ClampedArray.from([10, 20, 30, 40]);
  setSource(worker, 'source-cache', 3, input, 1, 1);
  const missing = render(worker, 'render-evicted', 'evicted', 3, 'one').message;
  assert.equal(missing.type, 'error');
  assert.equal(missing.code, 'lut-not-loaded');

  worker.send({ type: 'dispose-lut', requestId: 'dispose-five', lutId: 'five' });
  const disposed = worker.take().message;
  assert.equal(disposed.type, 'lut-disposed');
  assert.equal(disposed.disposed, true);
  const absent = render(worker, 'render-disposed', 'disposed', 3, 'five').message;
  assert.equal(absent.code, 'lut-not-loaded');
});

test('rejects invalid source and render messages while leaving a usable worker state', () => {
  const worker = workerHarness();
  expectReady(worker);
  worker.send({
    type: 'set-source',
    requestId: 'bad-source',
    generation: 1,
    width: 2,
    height: 1,
    buffer: new ArrayBuffer(4),
  });
  const sourceError = worker.take().message;
  assert.equal(sourceError.type, 'error');
  assert.equal(sourceError.code, 'invalid-source');

  assert.equal(
    validate(worker, 'validate-good', 'identity', 'valid/identity-17.cube').result.ok,
    true
  );
  const input = Uint8ClampedArray.from([1, 2, 3, 4]);
  setSource(worker, 'source-good', 1, input, 1, 1);
  const optionsError = render(
    worker,
    'bad-intensity',
    'bad-intensity',
    1,
    'identity',
    1.01
  ).message;
  assert.equal(optionsError.type, 'error');
  assert.equal(optionsError.code, 'invalid-render-options');

  const recovered = render(worker, 'render-good', 'good', 1, 'identity').message;
  assert.equal(recovered.type, 'rendered');
  assert.deepEqual(Array.from(new Uint8ClampedArray(recovered.buffer)), Array.from(input));
});
