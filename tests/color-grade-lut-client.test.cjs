const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  create,
  LutWorkerClientError,
  protocolVersion,
} = require('../assets/color-grade/color-grade-lut-client.js');

const root = path.resolve(__dirname, '..');
const assetsRoot = path.join(root, 'assets', 'color-grade');
const fixturesRoot = path.join(__dirname, 'fixtures', 'luts');
const reference = JSON.parse(
  fs.readFileSync(path.join(fixturesRoot, 'reference-outputs.json'), 'utf8')
);

function sha256(values) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(values.buffer, values.byteOffset, values.byteLength))
    .digest('hex');
}

function fixtureBytes(relativePath) {
  return fs.readFileSync(path.join(fixturesRoot, ...relativePath.split('/')));
}

function chartPixels() {
  return Uint8ClampedArray.from(
    Object.entries(reference.input.swatches)
      .sort(([left], [right]) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
      .flatMap(([, rgba]) => Array.from(Buffer.from(rgba, 'hex')))
  );
}

class FakeLutWorker {
  constructor() {
    this.terminated = false;
    const scope = {
      ArrayBuffer,
      Float64Array,
      TextDecoder,
      TextEncoder,
      Uint8ClampedArray,
      postMessage: (message, transfer) => {
        const cloned = structuredClone(message, transfer?.length ? { transfer } : undefined);
        queueMicrotask(() => this.onmessage?.({ data: cloned }));
      },
    };
    scope.self = scope;
    const context = vm.createContext(scope);
    scope.importScripts = (...relativePaths) => {
      for (const relativePath of relativePaths) {
        const filename = path.resolve(assetsRoot, relativePath);
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
      }
    };
    vm.runInContext(
      fs.readFileSync(path.join(assetsRoot, 'color-grade-lut-worker.js'), 'utf8'),
      context,
      {
        filename: path.join(assetsRoot, 'color-grade-lut-worker.js'),
      }
    );
    this.scope = scope;
  }

  postMessage(message, transfer) {
    if (this.terminated) throw new Error('worker terminated');
    const cloned = structuredClone(message, transfer?.length ? { transfer } : undefined);
    queueMicrotask(() => this.scope.onmessage({ data: cloned }));
  }

  terminate() {
    this.terminated = true;
  }
}

function clientHarness() {
  let worker = null;
  const client = create({
    workerFactory() {
      worker = new FakeLutWorker();
      return worker;
    },
  });
  return { client, worker: () => worker };
}

class ManualWorker {
  constructor() {
    this.sent = [];
    this.terminated = false;
  }

  postMessage(message) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message) {
    this.onmessage({ data: message });
  }
}

test('exposes a browser/CommonJS client API without adding a page dependency', () => {
  assert.equal(protocolVersion, 1);
  assert.equal(typeof create, 'function');
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(assetsRoot, 'color-grade-lut-client.js'), 'utf8'),
    context
  );
  assert.equal(typeof context.ColorGradeLutWorkerClient.create, 'function');
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, 'color-grade.html'), 'utf8'),
    /color-grade-lut-client\.js/
  );
});

test('coordinates Worker validation, source transfer, rendering, and disposal through one client', async () => {
  const { client, worker } = clientHarness();
  const protocol = await client.ready;
  assert.equal(protocol.version, 1);

  const loaded = await client.validateLut(
    'warm-portrait',
    fixtureBytes('creative/warm-portrait-17.cube')
  );
  assert.equal(loaded.result.ok, true);
  assert.equal(loaded.result.lut.sha256.length, 64);
  assert.equal(loaded.evictedLutId, null);

  const input = chartPixels();
  const original = new Uint8ClampedArray(input);
  await client.setSource({
    generation: 1,
    width: reference.input.width,
    height: reference.input.height,
    buffer: input.buffer,
  });
  assert.equal(
    input.byteLength,
    0,
    'the original-sized source buffer is transferred to the worker'
  );

  const rendered = await client.render({
    id: 'main-preview',
    generation: 1,
    lutId: 'warm-portrait',
  });
  const expected = reference.outputs.find(
    (entry) => entry.fixturePath === 'creative/warm-portrait-17.cube'
  );
  const output = new Uint8ClampedArray(rendered.buffer);
  assert.equal(sha256(output), expected.outputSha256);
  assert.deepEqual(
    Array.from(output.filter((_, index) => index % 4 === 3)),
    Array.from(original.filter((_, index) => index % 4 === 3))
  );
  assert.equal(await client.disposeLut('warm-portrait'), true);
  client.close();
  assert.equal(worker().terminated, true);
});

test('keeps rejected LUT diagnostics as a result and rejects stale render promises after source replacement', async () => {
  const { client } = clientHarness();
  await client.ready;
  const rejected = await client.validateLut(
    'broken',
    fixtureBytes('invalid/wrong-column-count.cube')
  );
  assert.equal(rejected.result.ok, false);
  assert.equal(rejected.result.code, 'invalid-data-column-count');

  await client.validateLut('identity', fixtureBytes('valid/identity-17.cube'));
  const sourceA = Uint8ClampedArray.from([10, 20, 30, 40]);
  await client.setSource({ generation: 1, width: 1, height: 1, buffer: sourceA.buffer });
  const stale = client.render({ id: 'old-preview', generation: 1, lutId: 'identity' });
  const sourceB = Uint8ClampedArray.from([200, 100, 50, 20]);
  const replacement = client.setSource({
    generation: 2,
    width: 1,
    height: 1,
    buffer: sourceB.buffer,
  });
  await assert.rejects(stale, (error) => {
    assert.ok(error instanceof LutWorkerClientError);
    assert.equal(error.code, 'operation-superseded');
    return true;
  });
  await replacement;
  const current = await client.render({ id: 'new-preview', generation: 2, lutId: 'identity' });
  assert.deepEqual(Array.from(new Uint8ClampedArray(current.buffer)), [200, 100, 50, 20]);
  client.close();
});

test('rejects invalid client calls before they can leave unresolved Worker promises', async () => {
  const { client } = clientHarness();
  await client.ready;
  await assert.rejects(client.validateLut('bad id', fixtureBytes('valid/identity-17.cube')), {
    code: 'invalid-lut-id',
  });
  await assert.rejects(
    client.setSource({ generation: 1, width: 2, height: 1, buffer: new ArrayBuffer(4) }),
    { code: 'invalid-source' }
  );

  const input = Uint8ClampedArray.from([1, 2, 3, 4]);
  await client.setSource({ generation: 1, width: 1, height: 1, buffer: input.buffer });
  await assert.rejects(client.render({ id: 'bad', generation: 0, lutId: 'missing' }), {
    code: 'source-not-ready',
  });
  await assert.rejects(
    client.render({ id: 'bad', generation: 1, lutId: 'missing', intensity: 2 }),
    {
      code: 'invalid-render-options',
    }
  );
  await assert.rejects(
    client.setSource({ generation: 1, width: 1, height: 1, buffer: new ArrayBuffer(4) }),
    { code: 'invalid-generation' }
  );
  client.close();
});

test('does not expose an output when a Worker response does not match its pending request', async () => {
  const worker = new ManualWorker();
  const client = create({ workerFactory: () => worker });
  worker.emit({
    type: 'ready',
    protocolVersion,
    protocol: { version: protocolVersion },
  });
  await client.ready;

  const validation = client.validateLut('expected-lut', Uint8Array.from([1, 2, 3]));
  assert.equal(worker.sent.length, 1);
  worker.emit({
    type: 'lut-validated',
    protocolVersion,
    requestId: worker.sent[0].requestId,
    lutId: 'wrong-lut',
    result: { ok: true },
    evictedLutId: null,
  });
  await assert.rejects(validation, { code: 'invalid-worker-response' });
  client.close();
});
