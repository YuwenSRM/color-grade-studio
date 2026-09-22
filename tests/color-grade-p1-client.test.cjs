const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { create } = require('../assets/color-grade/color-grade-p1-client.js');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets', 'color-grade');

class WorkerHarness {
  constructor() {
    this.terminated = false;
    const scope = {
      ArrayBuffer,
      Float64Array,
      TextDecoder,
      TextEncoder,
      Uint8ClampedArray,
      postMessage: (message, transfer) =>
        queueMicrotask(() =>
          this.onmessage?.({
            data: structuredClone(message, transfer?.length ? { transfer } : undefined),
          })
        ),
    };
    scope.self = scope;
    const context = vm.createContext(scope);
    scope.importScripts = (...files) =>
      files.forEach((file) =>
        vm.runInContext(fs.readFileSync(path.join(assets, file), 'utf8'), context, {
          filename: file,
        })
      );
    vm.runInContext(
      fs.readFileSync(path.join(assets, 'color-grade-p1-worker.js'), 'utf8'),
      context,
      { filename: 'color-grade-p1-worker.js' }
    );
    this.scope = scope;
  }
  postMessage(message, transfer) {
    queueMicrotask(() =>
      this.scope.onmessage({
        data: structuredClone(message, transfer?.length ? { transfer } : undefined),
      })
    );
  }
  terminate() {
    this.terminated = true;
  }
}

test('P1 client transfers source and renders a parameter filter through the versioned Worker', async () => {
  let worker;
  const client = create({
    workerFactory: () => {
      worker = new WorkerHarness();
      return worker;
    },
  });
  await client.ready;
  const pixels = Uint8ClampedArray.from([60, 70, 80, 90]);
  await client.setSource({ generation: 1, width: 1, height: 1, buffer: pixels.buffer });
  assert.equal(pixels.byteLength, 0);
  const result = await client.render({
    id: 'parameter-preview',
    generation: 1,
    basis: { kind: 'parameters', parameters: { b: 1, c: 1, s: 1, w: 1, t: 0 } },
  });
  assert.deepEqual(Array.from(new Uint8ClampedArray(result.buffer)), [60, 70, 80, 90]);
  client.close();
  assert.equal(worker.terminated, true);
});

test('P1 client transfers parameter JSON validation to the Worker', async () => {
  const client = create({ workerFactory: () => new WorkerHarness() });
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: 'real-landscape-filter',
      version: 1,
      kind: 'parameters',
      name: 'Client JSON',
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
  const result = await client.validateParameters(bytes.buffer);
  assert.equal(bytes.byteLength, 0);
  assert.equal(result.result.name, 'Client JSON');
  client.close();
});

test('reports a Worker failure to all pending P1 requests and terminates the client', async () => {
  const worker = {
    terminateCalled: false,
    postMessage() {},
    terminate() {
      this.terminateCalled = true;
    },
  };
  const client = create({ workerFactory: () => worker });
  const pending = client.ready;
  worker.onerror();
  await assert.rejects(pending, { code: 'worker-unavailable' });
  assert.equal(worker.terminateCalled, true);
  await assert.rejects(
    client.setSource({ generation: 1, width: 1, height: 1, buffer: new ArrayBuffer(4) }),
    { code: 'worker-unavailable' }
  );
});
