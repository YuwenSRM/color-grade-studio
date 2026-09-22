const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../assets/pages/color-grade-import.js'),
  'utf8'
);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ decode } = {}) {
  const images = [];
  const created = [];
  const revoked = [];
  class FakeImage {
    constructor() {
      this.naturalWidth = 1920;
      this.naturalHeight = 1080;
      this.src = '';
      images.push(this);
    }
    decode() {
      return decode ? decode() : Promise.resolve();
    }
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    }
  }
  const context = {
    window: {},
    Image: FakeImage,
    DOMException,
    URL: {
      createObjectURL(file) {
        created.push(file);
        return `blob:test-${created.length}`;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
  };
  vm.runInNewContext(source, context);
  return { helper: context.window.LandscapeColorImport, images, created, revoked };
}

function file(bytes, type = 'image/png', name = 'image.png') {
  const blob = new Blob([bytes], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

function png(width = 1920, height = 1080) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width, height, metadata = false) {
  const offset = metadata ? 2 + 65537 + 10 : 2;
  const bytes = Buffer.alloc(offset + 12);
  bytes.writeUInt16BE(0xffd8, 0);
  if (metadata) {
    bytes.writeUInt16BE(0xffe1, 2);
    bytes.writeUInt16BE(65535, 4);
    bytes.writeUInt16BE(0xffe2, 65539);
    bytes.writeUInt16BE(8, 65541);
  }
  bytes.writeUInt16BE(0xffc0, offset);
  bytes.writeUInt16BE(10, offset + 2);
  bytes[offset + 4] = 8;
  bytes.writeUInt16BE(height, offset + 5);
  bytes.writeUInt16BE(width, offset + 7);
  return bytes;
}

function webp(width, height, kind = 'VP8X') {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF');
  bytes.writeUInt32LE(22, 4);
  bytes.write('WEBP', 8);
  bytes.write(kind, 12);
  bytes.writeUInt32LE(10, 16);
  if (kind === 'VP8X') {
    bytes.writeUIntLE(width - 1, 24, 3);
    bytes.writeUIntLE(height - 1, 27, 3);
  } else if (kind === 'VP8 ') {
    bytes[23] = 0x9d;
    bytes[24] = 0x01;
    bytes[25] = 0x2a;
    bytes.writeUInt16LE(width, 26);
    bytes.writeUInt16LE(height, 28);
  } else {
    bytes[20] = 0x2f;
    bytes.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  }
  return bytes;
}

function gif(width, height) {
  const bytes = Buffer.alloc(13);
  bytes.write('GIF89a');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

function bmp(width, height) {
  const bytes = Buffer.alloc(54);
  bytes.write('BM');
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  return bytes;
}

function avif() {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24);
  bytes.write('ftyp', 4);
  bytes.write('avif', 8);
  bytes.write('avif', 16);
  return bytes;
}

test('successful import waits for decode and releases its object URL exactly once', async () => {
  let finishDecode;
  const f = fixture({
    decode: () =>
      new Promise((resolve) => {
        finishDecode = resolve;
      }),
  });
  let resolved = false;
  const pending = f.helper.load(file(png())).then((image) => {
    resolved = true;
    return image;
  });
  await flush();
  assert.equal(f.images.length, 1);
  f.images[0].onload();
  await flush();
  assert.equal(resolved, false);
  assert.deepEqual(f.revoked, []);
  finishDecode();
  const image = await pending;
  assert.equal(image, f.images[0]);
  assert.equal(image.src, 'blob:test-1');
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
  assert.deepEqual(f.revoked, ['blob:test-1']);
});

test('already aborted import does not read the file or create an image URL', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.helper.load(
      {
        slice() {
          assert.fail('must not read');
        },
      },
      { signal: controller.signal }
    ),
    { name: 'AbortError' }
  );
  assert.equal(f.images.length, 0);
  assert.equal(f.created.length, 0);
});

test('abort during header reading rejects promptly and prevents a late decode', async () => {
  const f = fixture();
  const controller = new AbortController();
  let finishRead;
  const bytes = png();
  const input = {
    name: 'image.png',
    type: 'image/png',
    size: bytes.length,
    slice() {
      return {
        arrayBuffer: () =>
          new Promise((resolve) => {
            finishRead = resolve;
          }),
      };
    },
  };
  const pending = f.helper.load(input, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  finishRead(Uint8Array.from(bytes).buffer);
  await flush();
  assert.equal(f.created.length, 0);
  assert.equal(f.images.length, 0);
});

test('abort clears image source, revokes its URL and ignores old onload callbacks', async () => {
  const f = fixture();
  const controller = new AbortController();
  const pending = f.helper.load(file(png()), { signal: controller.signal });
  await flush();
  const image = f.images[0];
  const oldLoad = image.onload;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await oldLoad();
  assert.equal(image.src, '');
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
  assert.deepEqual(f.revoked, ['blob:test-1']);
});

test('abort while decode is pending cannot later resolve the obsolete import', async () => {
  let finishDecode;
  const f = fixture({
    decode: () =>
      new Promise((resolve) => {
        finishDecode = resolve;
      }),
  });
  const controller = new AbortController();
  const pending = f.helper.load(file(png()), { signal: controller.signal });
  await flush();
  const callback = f.images[0].onload();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  finishDecode();
  await callback;
  assert.deepEqual(f.revoked, ['blob:test-1']);
  assert.equal(f.images[0].src, '');
});

test('browser decode rejection and error events both clean up object URLs', async (t) => {
  for (const mode of ['decode', 'onerror']) {
    await t.test(mode, async () => {
      const f = fixture({ decode: () => Promise.reject(new Error('corrupt image')) });
      const pending = f.helper.load(file(png()));
      await flush();
      f.images[0][mode === 'decode' ? 'onload' : 'onerror']();
      await assert.rejects(pending, { message: f.helper.errors.decode });
      assert.equal(f.images[0].src, '');
      assert.deepEqual(f.revoked, ['blob:test-1']);
    });
  }
});

test('oversized files, unsupported SVG and malformed image headers fail before image decoding', async (t) => {
  const cases = [
    [
      'large file',
      {
        type: 'image/png',
        size: 50 * 1024 * 1024 + 1,
        slice() {
          assert.fail('must not read');
        },
      },
      'fileSize',
    ],
    ['SVG', file('<svg></svg>', 'image/svg+xml', 'image.svg'), 'unsupported'],
    ['empty', file(''), 'decode'],
    ['corrupt header', file('this is not a png'), 'decode'],
    ['mismatched MIME', file(png(), 'image/jpeg', 'image.jpg'), 'decode'],
    ['zero dimension', file(png(0, 100)), 'decode'],
  ];
  for (const [name, input, code] of cases) {
    await t.test(name, async () => {
      const f = fixture();
      await assert.rejects(f.helper.load(input), { message: f.helper.errors[code] });
      assert.equal(f.created.length, 0);
      assert.equal(f.images.length, 0);
    });
  }
});

test('supported format headers reject excessive pixels before allocating decoded image buffers', async (t) => {
  const cases = [
    ['png', png(12000, 8000), 'image/png'],
    ['jpeg with large metadata', jpeg(12000, 8000, true), 'image/jpeg'],
    ['webp extended', webp(12000, 8000), 'image/webp'],
    ['webp lossy', webp(12000, 8000, 'VP8 '), 'image/webp'],
    ['webp lossless', webp(12000, 8000, 'VP8L'), 'image/webp'],
    ['gif', gif(12000, 8000), 'image/gif'],
    ['bmp top down', bmp(12000, -8000), 'image/bmp'],
    ['single dimension', png(40000, 1), 'image/png'],
  ];
  for (const [name, bytes, type] of cases) {
    await t.test(name, async () => {
      const f = fixture();
      await assert.rejects(f.helper.load(file(bytes, type)), {
        message: f.helper.errors.dimensions,
      });
      assert.equal(f.created.length, 0);
      assert.equal(f.images.length, 0);
    });
  }
});

test('decoded dimensions are also checked for AVIF and disagreeing browser results', async (t) => {
  for (const [name, input] of [
    ['avif', file(avif(), 'image/avif')],
    ['png', file(png())],
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const pending = f.helper.load(input);
      await flush();
      f.images[0].naturalWidth = 12000;
      f.images[0].naturalHeight = 8000;
      f.images[0].onload();
      await assert.rejects(pending, { message: f.helper.errors.dimensions });
      assert.equal(f.images[0].src, '');
      assert.deepEqual(f.revoked, ['blob:test-1']);
    });
  }
});

test('missing MIME uses a supported extension and older browsers can load without decode()', async () => {
  const f = fixture();
  const pending = f.helper.load(file(jpeg(1920, 1080), '', 'photo.JPEG'));
  await flush();
  f.images[0].decode = undefined;
  f.images[0].onload();
  assert.equal(await pending, f.images[0]);
  assert.deepEqual(f.revoked, ['blob:test-1']);
});
