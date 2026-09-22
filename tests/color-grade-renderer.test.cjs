const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { applyPixels } = require('../assets/color-grade/color-grade-renderer.js');

const neutral = { b: 1, c: 1, s: 1, w: 1, t: 0 };
function inputPixels() {
  const pixels = new Uint8ClampedArray(4096);
  let value = 0x12345678;
  for (let i = 0; i < pixels.length; i++) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    pixels[i] = value >>> 24;
  }
  return pixels;
}

// Captured from the original drawProfile before extraction: these fixtures verify
// exact output bytes, including clipping, alpha and manual tone blending.
const fixtures = [
  {
    name: 'neutral',
    p: neutral,
    hash: 'ae7f9d581c3caa0aefc9f00692563be4473478784d88a9a026d5377fea0efd8d',
  },
  {
    name: 'warm hue',
    p: { b: 1.07, c: 1.12, s: 1.08, w: 1.15, t: 12 },
    hash: 'bbc7debb0b58790fe113e87d3812c41ac2b59276ad8ff787616fd07cb3ad2c30',
  },
  {
    name: 'cool muted',
    p: { b: 0.93, c: 0.85, s: 0.67, w: 0.79, t: -32 },
    hash: 'cc47e40b31cac5ba754917d2caf39204f50b0064e76e391154663c9ed43003fd',
  },
  {
    name: 'monochrome',
    p: { b: 1.02, c: 1.15, s: 0, w: 1, t: 0 },
    hash: '9a3eab46140b37f66cc230a5544e7c1c4e29ebd8dc795d557690def54efe595d',
  },
  {
    name: 'manual tones',
    p: { b: 1.06, c: 1.11, s: 1.14, w: 1.13, t: 7 },
    settings: {
      delta: {
        exposure: 19,
        contrast: -23,
        highlights: 47,
        shadows: 36,
        black: -12,
        saturation: -25,
        vibrance: 69,
        temperature: -18,
        tint: 22,
        clarity: 37,
      },
      shadow: [12, 47, 91],
      mid: [107, 61, 147],
      high: [245, 220, 164],
      shadowAmount: 0.49,
      midAmount: 0.53,
      highAmount: 0.67,
    },
    hash: 'bce289fd9b8e01ea1f624c36ba2a0c65d1b41f39d23c70528525e28ecbe6515b',
  },
  {
    name: 'manual extremes',
    p: { b: 0.88, c: 1.3, s: 1.4, w: 0.67, t: 90 },
    settings: {
      delta: {
        exposure: -100,
        contrast: 100,
        highlights: -100,
        shadows: 100,
        black: -100,
        saturation: 100,
        vibrance: -100,
        temperature: 100,
        tint: -100,
        clarity: -100,
      },
      shadow: [255, 0, 0],
      mid: [0, 255, 0],
      high: [0, 0, 255],
      shadowAmount: 1,
      midAmount: 1,
      highAmount: 1,
    },
    hash: 'aa11287b906b1ba514be96d8b61ea51dfa55e0203e48dc56638a3cc7463185f1',
  },
];

for (const fixture of fixtures) {
  test(`shared renderer preserves original pixels: ${fixture.name}`, () => {
    const input = inputPixels();
    const originalAlpha = input.filter((_, index) => index % 4 === 3);
    const output = applyPixels(input, fixture.p, fixture.settings);
    assert.equal(output, input, 'the renderer should update the supplied buffer in place');
    assert.equal(crypto.createHash('sha256').update(output).digest('hex'), fixture.hash);
    assert.deepEqual(
      output.filter((_, index) => index % 4 === 3),
      originalAlpha
    );
  });
}

test('standard-v2 highlights use positive values to brighten only the highlight range', () => {
  const source = Uint8ClampedArray.from([24, 24, 24, 255, 128, 128, 128, 255, 220, 220, 220, 255]);
  const neutralOutput = applyPixels(new Uint8ClampedArray(source), neutral, {
    toneModel: 'standard-v2',
    delta: { highlights: 0 },
  });
  const brighter = applyPixels(new Uint8ClampedArray(source), neutral, {
    toneModel: 'standard-v2',
    delta: { highlights: 50 },
  });
  const darker = applyPixels(new Uint8ClampedArray(source), neutral, {
    toneModel: 'standard-v2',
    delta: { highlights: -50 },
  });

  assert.deepEqual(Array.from(brighter.slice(0, 8)), Array.from(neutralOutput.slice(0, 8)));
  assert.ok(brighter[8] > neutralOutput[8]);
  assert.ok(darker[8] < neutralOutput[8]);
  assert.deepEqual(Array.from(brighter.filter((_, index) => index % 4 === 3)), [255, 255, 255]);
});

test('legacy highlight edits retain their pixels when migrated to standard-v2', () => {
  const source = Uint8ClampedArray.from([208, 208, 208, 121, 232, 232, 232, 122]);
  const legacy = applyPixels(new Uint8ClampedArray(source), neutral, {
    delta: { highlights: 37 },
  });
  const migrated = applyPixels(new Uint8ClampedArray(source), neutral, {
    toneModel: 'standard-v2',
    delta: { highlights: -37 },
  });
  assert.deepEqual(Array.from(migrated), Array.from(legacy));
});

test('the historical renderer fixture remains legacy-v1 until an edit explicitly selects standard-v2', () => {
  const fixture = fixtures.find((entry) => entry.name === 'manual tones');
  const legacy = applyPixels(inputPixels(), fixture.p, fixture.settings);
  assert.equal(
    crypto.createHash('sha256').update(legacy).digest('hex'),
    fixture.hash,
    'unversioned persisted settings must preserve the frozen legacy output'
  );
});

test('studio-v2 tonal grading accepts H/S/L, per-range intensity and a continuous global balance', () => {
  const source = Uint8ClampedArray.from([38, 38, 38, 255, 128, 128, 128, 255, 224, 224, 224, 255]);
  const base = applyPixels(new Uint8ClampedArray(source), neutral, {
    gradingModel: 'studio-v2',
    grading: {
      shadows: { hue: 220, saturation: 80, lightness: 0, intensity: 0 },
      midtones: { hue: 120, saturation: 0, lightness: 0, intensity: 0 },
      highlights: { hue: 40, saturation: 0, lightness: 0, intensity: 0 },
      balance: 0,
    },
  });
  const shadowTint = applyPixels(new Uint8ClampedArray(source), neutral, {
    gradingModel: 'studio-v2',
    grading: {
      shadows: { hue: 220, saturation: 80, lightness: 10, intensity: 100 },
      midtones: { hue: 120, saturation: 0, lightness: 0, intensity: 0 },
      highlights: { hue: 40, saturation: 0, lightness: 0, intensity: 0 },
      balance: 0,
    },
  });
  const movedBalance = applyPixels(new Uint8ClampedArray(source), neutral, {
    gradingModel: 'studio-v2',
    grading: {
      shadows: { hue: 220, saturation: 80, lightness: 10, intensity: 100 },
      midtones: { hue: 120, saturation: 0, lightness: 0, intensity: 0 },
      highlights: { hue: 40, saturation: 0, lightness: 0, intensity: 0 },
      balance: 80,
    },
  });
  assert.deepEqual(Array.from(base), Array.from(source), 'all zero range intensities are identity');
  assert.notDeepEqual(Array.from(shadowTint.slice(0, 3)), Array.from(base.slice(0, 3)));
  assert.notDeepEqual(Array.from(movedBalance.slice(0, 3)), Array.from(shadowTint.slice(0, 3)));
  assert.deepEqual(
    Array.from(shadowTint.filter((_, index) => index % 4 === 3)),
    Array.from(source.filter((_, index) => index % 4 === 3))
  );
});

function workerHarness() {
  const messages = [];
  const worker = {
    Uint8ClampedArray,
    ArrayBuffer,
    postMessage(message, transfer) {
      messages.push(
        structuredClone({ message, transferred: Boolean(transfer?.length) }, { transfer })
      );
    },
  };
  worker.self = worker;
  worker.importScripts = (relative) => {
    const filename = path.resolve(__dirname, '../assets/pages', relative);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
  };
  const context = vm.createContext(worker);
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, '../assets/pages/color-grade-worker.js'), 'utf8'),
    context
  );
  return { send: (message) => worker.onmessage({ data: message }), messages };
}

test('thumbnail worker transfers results without mutating its reusable source', () => {
  const worker = workerHarness();
  const original = inputPixels();
  worker.send({ type: 'init', generation: 2, width: 32, height: 32, buffer: original.buffer });
  worker.send({ type: 'render', generation: 2, id: 'warm', profile: fixtures[1].p });
  worker.send({ type: 'render', generation: 2, id: 'neutral', profile: neutral });
  assert.equal(worker.messages.length, 2);
  const [warm, identity] = worker.messages;
  assert.equal(warm.message.type, 'rendered');
  assert.equal(warm.message.id, 'warm');
  assert.equal(warm.message.generation, 2);
  assert.equal(warm.message.width, 32);
  assert.equal(warm.message.height, 32);
  assert.equal(warm.transferred, true);
  assert.deepEqual(
    new Uint8ClampedArray(warm.message.buffer),
    applyPixels(inputPixels(), fixtures[1].p)
  );
  assert.deepEqual(new Uint8ClampedArray(identity.message.buffer), inputPixels());
  assert.deepEqual(original, inputPixels());
});

test('thumbnail worker ignores stale source and render generations', () => {
  const worker = workerHarness();
  worker.send({ type: 'init', generation: 3, width: 32, height: 32, buffer: inputPixels().buffer });
  worker.send({ type: 'init', generation: 2, width: 1, height: 1, buffer: new ArrayBuffer(4) });
  worker.send({ type: 'render', generation: 2, id: 'stale', profile: neutral });
  worker.send({ type: 'render', generation: 4, id: 'uninitialized', profile: neutral });
  worker.send({ type: 'render', generation: 3, id: 'current', profile: neutral });
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].message.id, 'current');
  assert.equal(worker.messages[0].message.width, 32);
});

test('thumbnail worker reports rendering failures and can recover', () => {
  const worker = workerHarness();
  worker.send({ type: 'init', generation: 1, width: 32, height: 32, buffer: new ArrayBuffer(4) });
  assert.equal(worker.messages[0].message.type, 'error');
  assert.match(worker.messages[0].message.message, /pixel buffer/);
  worker.send({ type: 'init', generation: 2, width: 32, height: 32, buffer: inputPixels().buffer });
  worker.send({ type: 'render', generation: 2, id: 'broken', profile: null });
  assert.equal(worker.messages[1].message.type, 'error');
  assert.equal(worker.messages[1].message.id, 'broken');
  worker.send({ type: 'render', generation: 2, id: 'recovered', profile: neutral });
  assert.equal(worker.messages[2].message.type, 'rendered');
  assert.equal(worker.messages[2].message.id, 'recovered');
});
