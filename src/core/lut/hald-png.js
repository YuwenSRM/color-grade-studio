(function (root, factory) {
  const model =
    typeof module === 'object' && module.exports
      ? require('../color/transform-document.js')
      : root.ColorTransformDocument;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformHaldPng = api;
})(globalThis, function (model) {
  'use strict';

  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const MAX_BYTES = 32 * 1024 * 1024;
  const MAX_DIMENSION = 512;
  const codes = Object.freeze({
    invalidPng: 'invalid-png',
    unsupportedPng: 'unsupported-png-variant',
    tooLarge: 'png-file-too-large',
    invalidHald: 'invalid-hald-layout',
    cancelled: 'operation-aborted',
  });
  class HaldPngError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'HaldPngError';
      this.code = code;
      this.stage = 'hald-png';
      this.details = Object.freeze({ ...details });
    }
  }
  function fail(code, message, details) {
    throw new HaldPngError(code, message, details);
  }
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length),
      view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)), false);
    return out;
  }
  function nodeZlib() {
    if (typeof require !== 'function')
      fail(
        codes.unsupportedPng,
        'This synchronous decoder requires a reviewed Node zlib runtime; browser decoding is intentionally not silently substituted.'
      );
    return require('node:zlib');
  }
  function paeth(a, b, c) {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }
  function unpack(raw, width, height, channels) {
    const stride = width * channels,
      expected = height * (stride + 1);
    if (raw.length !== expected)
      fail(codes.invalidPng, 'PNG decompressed length does not match its header.', {
        expected,
        actual: raw.length,
      });
    const pixels = new Uint8Array(width * height * channels);
    let at = 0;
    for (let row = 0; row < height; row += 1) {
      const filter = raw[at++];
      if (filter > 4)
        fail(codes.invalidPng, 'PNG scanline has an invalid filter.', { row, filter });
      const target = row * stride,
        previous = target - stride;
      for (let col = 0; col < stride; col += 1) {
        const value = raw[at++],
          left = col >= channels ? pixels[target + col - channels] : 0,
          up = row ? pixels[previous + col] : 0,
          upLeft = row && col >= channels ? pixels[previous + col - channels] : 0;
        pixels[target + col] =
          filter === 0
            ? value
            : filter === 1
              ? (value + left) & 255
              : filter === 2
                ? (value + up) & 255
                : filter === 3
                  ? (value + Math.floor((left + up) / 2)) & 255
                  : (value + paeth(left, up, upLeft)) & 255;
      }
    }
    return pixels;
  }
  function pngBytes(input) {
    if (ArrayBuffer.isView(input))
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    fail(codes.invalidPng, 'PNG input must be bytes.');
  }
  function decodePng(input, options = {}) {
    const bytes = pngBytes(input);
    if (bytes.length > (options.maxBytes || MAX_BYTES))
      fail(codes.tooLarge, 'PNG exceeds its byte limit.', {
        actual: bytes.length,
        maximum: options.maxBytes || MAX_BYTES,
      });
    if (bytes.length < 33 || !signature.every((byte, i) => byte === bytes[i]))
      fail(codes.invalidPng, 'File does not have a PNG signature.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 8,
      width,
      height,
      bitDepth,
      colorType,
      interlace,
      seenHeader = false,
      ended = false;
    const idat = [];
    const text = {};
    while (at < bytes.length) {
      if (at + 12 > bytes.length) fail(codes.invalidPng, 'PNG chunk is truncated.');
      const length = view.getUint32(at, false),
        start = at + 8,
        end = start + length;
      if (end + 4 > bytes.length) fail(codes.invalidPng, 'PNG chunk length is invalid.');
      const type = new TextDecoder('ascii', { fatal: true }).decode(bytes.subarray(at + 4, at + 8));
      const body = bytes.subarray(start, end);
      if (crc32(bytes.subarray(at + 4, end)) !== view.getUint32(end, false))
        fail(codes.invalidPng, 'PNG CRC check failed.', { type });
      if (type === 'IHDR') {
        if (seenHeader || length !== 13) fail(codes.invalidPng, 'PNG IHDR is invalid.');
        width = view.getUint32(start, false);
        height = view.getUint32(start + 4, false);
        bitDepth = body[8];
        colorType = body[9];
        if (!width || !height || body[10] || body[11])
          fail(codes.unsupportedPng, 'PNG compression or filtering method is unsupported.');
        interlace = body[12];
        seenHeader = true;
      } else if (type === 'IDAT') {
        if (!seenHeader || ended) fail(codes.invalidPng, 'PNG IDAT ordering is invalid.');
        idat.push(body);
      } else if (type === 'tEXt') {
        const zero = body.indexOf(0);
        if (zero > 0)
          text[new TextDecoder('latin1').decode(body.subarray(0, zero))] = new TextDecoder(
            'latin1'
          ).decode(body.subarray(zero + 1));
      } else if (type === 'IEND') {
        if (!seenHeader || length !== 0 || ended) fail(codes.invalidPng, 'PNG IEND is invalid.');
        ended = true;
      }
      at = end + 4;
    }
    if (!seenHeader || !ended || !idat.length)
      fail(codes.invalidPng, 'PNG has no complete pixel payload.');
    if (interlace !== 0 || bitDepth !== 8 || ![2, 6].includes(colorType))
      fail(
        codes.unsupportedPng,
        'Only non-interlaced 8-bit RGB and RGBA PNG Hald files are supported.',
        { bitDepth, colorType, interlace }
      );
    if (width > MAX_DIMENSION || height > MAX_DIMENSION)
      fail(codes.tooLarge, 'PNG dimensions exceed the Hald safety limit.', {
        width,
        height,
        maximum: MAX_DIMENSION,
      });
    let raw;
    try {
      raw = nodeZlib().inflateSync(Buffer.from(concat(idat)));
    } catch (_) {
      fail(codes.invalidPng, 'PNG zlib stream is invalid.');
    }
    return Object.freeze({
      width,
      height,
      bitDepth,
      colorType,
      channels: colorType === 2 ? 3 : 4,
      pixels: unpack(raw, width, height, colorType === 2 ? 3 : 4),
      text: Object.freeze(text),
    });
  }
  function haldLayout(width, height) {
    if (width !== height) fail(codes.invalidHald, 'Hald PNG must be square.', { width, height });
    const level = Math.round(Math.cbrt(width));
    if (level < 2 || level ** 3 !== width)
      fail(codes.invalidHald, 'Hald side length must be an exact level cubed.', { width });
    const cubeSize = level ** 2;
    return Object.freeze({ level, cubeSize, dimension: width, layout: 'flat-red-fastest' });
  }
  function parseHaldPng(input, options = {}) {
    const png = decodePng(input, options),
      layout = haldLayout(png.width, png.height),
      values = new Float64Array(layout.cubeSize ** 3 * 3);
    for (let index = 0; index < layout.cubeSize ** 3; index += 1) {
      const src = index * png.channels,
        dest = index * 3;
      values[dest] = png.pixels[src] / 255;
      values[dest + 1] = png.pixels[src + 1] / 255;
      values[dest + 2] = png.pixels[src + 2] / 255;
    }
    const source = {
      format: 'hald-png',
      dialect: 'standard-hald',
      filename: options.filename || null,
      byteLength: pngBytes(input).byteLength,
      sha256:
        typeof require === 'function'
          ? require('node:crypto')
              .createHash('sha256')
              .update(Buffer.from(pngBytes(input)))
              .digest('hex')
          : null,
      originalBlob: options.originalBlob || null,
    };
    return model.createColorTransformDocument({
      source,
      colorContract: options.colorContract || {},
      transforms: [{ type: 'lut3d', size: layout.cubeSize, values, ordering: 'red-fastest' }],
      metadata: { hald: { ...layout, bitDepth: 8, colorType: png.colorType, text: png.text } },
      compatibility: {
        photoColorSpace: options.photoColorSpace || null,
        conversionTargets: {
          cube: { status: 'supported-with-quantization', code: null, loss: 'format-rewrite' },
          hald: { status: 'supported-with-quantization', code: null, loss: 'format-rewrite' },
        },
      },
    });
  }
  function encodePngRgba(width, height, pixels, text = {}) {
    if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4)
      fail(codes.invalidPng, 'RGBA pixel buffer does not match PNG dimensions.');
    const raw = new Uint8Array(height * (width * 4 + 1));
    for (let row = 0; row < height; row += 1)
      raw.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1);
    const header = new Uint8Array(13),
      view = new DataView(header.buffer);
    view.setUint32(0, width, false);
    view.setUint32(4, height, false);
    header[8] = 8;
    header[9] = 6;
    const textChunks = Object.entries(text).map(([key, value]) =>
      chunk('tEXt', new TextEncoder().encode(`${key}\0${value}`))
    );
    return concat([
      signature,
      chunk('IHDR', header),
      ...textChunks,
      chunk('IDAT', nodeZlib().deflateSync(Buffer.from(raw))),
      chunk('IEND', new Uint8Array()),
    ]);
  }
  function writeHaldPng(document, options = {}) {
    const node = document?.transforms?.length === 1 && document.transforms[0];
    if (!node || node.type !== 'lut3d' || node.size > 65)
      fail(codes.invalidHald, 'Hald output requires one supported 3D LUT.');
    const level = options.level || 8;
    if (!Number.isSafeInteger(level) || level < 2 || level > 8)
      fail(codes.invalidHald, 'Hald level must be an integer from 2 through 8.');
    const cubeSize = level ** 2,
      dimension = level ** 3,
      output = new Uint8Array(dimension * dimension * 4);
    const processor =
      typeof require === 'function'
        ? require('./cpu-reference-processor.js').createProcessor(document)
        : null;
    if (!processor)
      fail(
        codes.unsupportedPng,
        'The browser-facing synchronous Hald writer is not available; use the worker/CLI conversion path.'
      );
    for (let b = 0; b < cubeSize; b += 1)
      for (let g = 0; g < cubeSize; g += 1)
        for (let r = 0; r < cubeSize; r += 1) {
          if (options.signal?.aborted) fail(codes.cancelled, 'Hald conversion was cancelled.');
          const rgb = processor.applyRgb([
              r / (cubeSize - 1),
              g / (cubeSize - 1),
              b / (cubeSize - 1),
            ]),
            at = (r + cubeSize * g + cubeSize * cubeSize * b) * 4;
          output[at] = Math.round(Math.max(0, Math.min(1, rgb[0])) * 255);
          output[at + 1] = Math.round(Math.max(0, Math.min(1, rgb[1])) * 255);
          output[at + 2] = Math.round(Math.max(0, Math.min(1, rgb[2])) * 255);
          output[at + 3] = 255;
        }
    const bytes = encodePngRgba(dimension, dimension, output, {
      HaldLevel: String(level),
      Layout: 'flat-red-fastest',
      ColorSpace: document.colorContract.outputColorSpace,
    });
    return Object.freeze({ bytes, level, cubeSize, dimension, bitDepth: 8, loss: 'pipeline-bake' });
  }
  return Object.freeze({
    MAX_BYTES,
    MAX_DIMENSION,
    codes,
    HaldPngError,
    decodePng,
    haldLayout,
    parseHaldPng,
    encodePngRgba,
    writeHaldPng,
  });
});
