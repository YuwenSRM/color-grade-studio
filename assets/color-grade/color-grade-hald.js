(function (root, factory) {
  const api = factory(
    root.ColorGradeLutRenderer ||
      (typeof require === 'function' ? require('./color-grade-lut-renderer.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorGradeHald = api;
})(globalThis, function (LutRenderer) {
  'use strict';

  const FORMAT = 'real-landscape-hald-clut';
  const VERSION = 1;
  const DEFAULT_LEVEL = 8;
  const MIN_LEVEL = 2;
  const MAX_LEVEL = 8;
  const COLOR_SPACE_SRGB = 'sRGB SDR';
  const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

  class HaldError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'HaldError';
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  }

  function fail(code, message, details) {
    throw new HaldError(code, message, details);
  }

  function checkAbort(signal) {
    if (signal?.aborted) fail('operation-aborted', 'Hald CLUT 导出已取消。');
  }

  function validLevel(value) {
    return Number.isSafeInteger(value) && value >= MIN_LEVEL && value <= MAX_LEVEL;
  }

  function layout(level = DEFAULT_LEVEL) {
    if (!validLevel(level))
      fail('invalid-level', `Hald Level 必须是 ${MIN_LEVEL} 到 ${MAX_LEVEL} 的整数。`);
    const cubeSize = level ** 2;
    const dimension = level ** 3;
    return Object.freeze({
      level,
      cubeSize,
      dimension,
      pixelCount: dimension ** 2,
      layout: 'flat-red-fastest',
      bitDepth: 8,
      colorType: 'RGBA',
    });
  }

  function normalizedDomain(lut) {
    return (
      Array.isArray(lut?.domainMin) &&
      Array.isArray(lut?.domainMax) &&
      lut.domainMin.length === 3 &&
      lut.domainMax.length === 3 &&
      lut.domainMin.every((value) => value === 0) &&
      lut.domainMax.every((value) => value === 1)
    );
  }

  function assertEligible(value) {
    const candidate = value?.lut || value;
    if (!candidate || !LutRenderer) fail('invalid-lut', 'Hald CLUT 导出需要已验证的 3D CUBE LUT。');
    if (
      value?.inputColorSpace !== COLOR_SPACE_SRGB ||
      value.outputColorSpace !== COLOR_SPACE_SRGB
    ) {
      fail('incompatible-color-space', '仅支持输入和输出均为 sRGB SDR 的 LUT 导出 Hald CLUT。');
    }
    if (value.compatibilityStatus !== 'applicable') {
      fail('incompatible-color-space', '色彩空间未知的 LUT 不能导出 Hald CLUT。');
    }
    if (!normalizedDomain(candidate)) {
      fail('unsupported-domain', 'Hald CLUT v1 仅支持 DOMAIN_MIN 0 0 0 和 DOMAIN_MAX 1 1 1。');
    }
    try {
      return LutRenderer.createTransform(candidate);
    } catch (error) {
      fail('invalid-lut', error.message || 'LUT 不符合 Hald CLUT 导出要求。');
    }
  }

  function sampleOffset(red, green, blue, size) {
    return red + size * green + size * size * blue;
  }

  function writeHaldPixels(transform, options = {}) {
    const spec = layout(options.level);
    const pixels = new Uint8ClampedArray(spec.pixelCount * 4);
    const maximum = spec.cubeSize - 1;
    for (let blue = 0; blue < spec.cubeSize; blue += 1) {
      checkAbort(options.signal);
      for (let green = 0; green < spec.cubeSize; green += 1) {
        for (let red = 0; red < spec.cubeSize; red += 1) {
          const output = transform.sample([red / maximum, green / maximum, blue / maximum]);
          const offset = sampleOffset(red, green, blue, spec.cubeSize) * 4;
          pixels[offset] = output[0] * 255;
          pixels[offset + 1] = output[1] * 255;
          pixels[offset + 2] = output[2] * 255;
          pixels[offset + 3] = 255;
        }
      }
    }
    return { spec, pixels };
  }

  async function writeHaldPixelsAsync(transform, options = {}) {
    const spec = layout(options.level);
    const pixels = new Uint8ClampedArray(spec.pixelCount * 4);
    const maximum = spec.cubeSize - 1;
    for (let blue = 0; blue < spec.cubeSize; blue += 1) {
      checkAbort(options.signal);
      for (let green = 0; green < spec.cubeSize; green += 1) {
        for (let red = 0; red < spec.cubeSize; red += 1) {
          const output = transform.sample([red / maximum, green / maximum, blue / maximum]);
          const offset = sampleOffset(red, green, blue, spec.cubeSize) * 4;
          pixels[offset] = output[0] * 255;
          pixels[offset + 1] = output[1] * 255;
          pixels[offset + 2] = output[2] * 255;
          pixels[offset + 3] = 255;
        }
      }
      // Give the browser a chance to process a cancellation between Hald blue slices.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { spec, pixels };
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < table.length; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1)
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function adler32(bytes) {
    let left = 1;
    let right = 0;
    for (const byte of bytes) {
      left = (left + byte) % 65521;
      right = (right + left) % 65521;
    }
    return ((right << 16) | left) >>> 0;
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value >>> 0, false);
  }

  function read32(view, offset) {
    return view.getUint32(offset, false);
  }

  function deflateStored(bytes) {
    const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
    const output = new Uint8Array(2 + blocks * 5 + bytes.length + 4);
    output[0] = 0x78;
    output[1] = 0x01;
    let sourceOffset = 0;
    let outputOffset = 2;
    while (sourceOffset < bytes.length || (bytes.length === 0 && sourceOffset === 0)) {
      const length = Math.min(65535, bytes.length - sourceOffset);
      const final = sourceOffset + length >= bytes.length;
      output[outputOffset++] = final ? 1 : 0;
      output[outputOffset++] = length & 0xff;
      output[outputOffset++] = length >>> 8;
      const complement = ~length & 0xffff;
      output[outputOffset++] = complement & 0xff;
      output[outputOffset++] = complement >>> 8;
      output.set(bytes.subarray(sourceOffset, sourceOffset + length), outputOffset);
      outputOffset += length;
      sourceOffset += length;
      if (final) break;
    }
    const checksum = adler32(bytes);
    output[outputOffset++] = checksum >>> 24;
    output[outputOffset++] = checksum >>> 16;
    output[outputOffset++] = checksum >>> 8;
    output[outputOffset++] = checksum;
    return output;
  }

  function inflateStored(bytes) {
    if (bytes.length < 6 || (bytes[0] & 0x0f) !== 8 || ((bytes[0] << 8) + bytes[1]) % 31 !== 0)
      fail('invalid-png', 'PNG 的 zlib 数据无效。');
    const chunks = [];
    let offset = 2;
    let final = false;
    while (!final) {
      if (offset + 5 > bytes.length - 4) fail('invalid-png', 'PNG 的 deflate 数据被截断。');
      const control = bytes[offset++];
      final = Boolean(control & 1);
      if ((control >>> 1) & 3) fail('unsupported-png', '仅支持本产品写出的未压缩 PNG 数据。');
      const length = bytes[offset] | (bytes[offset + 1] << 8);
      const complement = bytes[offset + 2] | (bytes[offset + 3] << 8);
      offset += 4;
      if ((~length & 0xffff) !== complement || offset + length > bytes.length - 4)
        fail('invalid-png', 'PNG 的 deflate 数据无效。');
      chunks.push(bytes.slice(offset, offset + length));
      offset += length;
    }
    if (offset + 4 !== bytes.length) fail('invalid-png', 'PNG 的 deflate 尾部无效。');
    const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let resultOffset = 0;
    for (const chunk of chunks) {
      result.set(chunk, resultOffset);
      resultOffset += chunk.length;
    }
    const expected =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    if (adler32(result) >>> 0 !== expected >>> 0) fail('invalid-png', 'PNG 的 Adler32 校验失败。');
    return result;
  }

  function chunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const output = new Uint8Array(12 + data.length);
    const view = new DataView(output.buffer);
    write32(view, 0, data.length);
    output.set(typeBytes, 4);
    output.set(data, 8);
    write32(view, output.length - 4, crc32(output.slice(4, output.length - 4)));
    return output;
  }

  function concatenate(parts) {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function encodePngRgba(width, height, pixels, text = {}) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
      fail('invalid-png', 'PNG 尺寸无效。');
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4)
      fail('invalid-png', 'PNG 像素缓冲无效。');
    const raw = new Uint8Array(height * (width * 4 + 1));
    for (let row = 0; row < height; row += 1) {
      const target = row * (width * 4 + 1);
      raw[target] = 0;
      raw.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), target + 1);
    }
    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    write32(ihdrView, 0, width);
    write32(ihdrView, 4, height);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const textChunks = Object.entries(text).map(([key, value]) => {
      const content = new TextEncoder().encode(`${key}\0${value}`);
      return chunk('tEXt', content);
    });
    return concatenate([
      PNG_SIGNATURE,
      chunk('IHDR', ihdr),
      ...textChunks,
      chunk('IDAT', deflateStored(raw)),
      chunk('IEND', new Uint8Array()),
    ]);
  }

  function decodePngRgba(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    if (bytes.length < PNG_SIGNATURE.length + 12) fail('invalid-png', '文件不是有效 PNG。');
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1)
      if (bytes[index] !== PNG_SIGNATURE[index]) fail('invalid-png', '文件不是有效 PNG。');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = PNG_SIGNATURE.length;
    let width = 0;
    let height = 0;
    let seenHeader = false;
    let seenEnd = false;
    const data = [];
    const text = {};
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) fail('invalid-png', 'PNG 区块被截断。');
      const length = read32(view, offset);
      const dataStart = offset + 8;
      const end = dataStart + length;
      if (end + 4 > bytes.length) fail('invalid-png', 'PNG 区块长度无效。');
      const type = new TextDecoder('ascii', { fatal: true }).decode(
        bytes.slice(offset + 4, offset + 8)
      );
      const payload = bytes.slice(dataStart, end);
      if (crc32(bytes.slice(offset + 4, end)) !== read32(view, end))
        fail('invalid-png', 'PNG CRC 校验失败。');
      if (type === 'IHDR') {
        if (seenHeader || length !== 13) fail('invalid-png', 'PNG IHDR 无效。');
        width = read32(view, dataStart);
        height = read32(view, dataStart + 4);
        if (
          !width ||
          !height ||
          payload[8] !== 8 ||
          payload[9] !== 6 ||
          payload[10] ||
          payload[11] ||
          payload[12]
        )
          fail('unsupported-png', '仅支持 8 位非隔行 RGBA PNG。');
        seenHeader = true;
      } else if (type === 'IDAT') {
        if (!seenHeader || seenEnd) fail('invalid-png', 'PNG IDAT 顺序无效。');
        data.push(payload);
      } else if (type === 'tEXt') {
        const separator = payload.indexOf(0);
        if (separator > 0) {
          const decoder = new TextDecoder('latin1');
          text[decoder.decode(payload.slice(0, separator))] = decoder.decode(
            payload.slice(separator + 1)
          );
        }
      } else if (type === 'IEND') {
        if (length !== 0 || !seenHeader || seenEnd) fail('invalid-png', 'PNG IEND 无效。');
        seenEnd = true;
      }
      offset = end + 4;
    }
    if (!seenHeader || !seenEnd || !data.length) fail('invalid-png', 'PNG 缺少必要区块。');
    const raw = inflateStored(concatenate(data));
    const stride = width * 4 + 1;
    if (raw.length !== stride * height) fail('invalid-png', 'PNG 像素数据长度无效。');
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      if (raw[row * stride] !== 0) fail('unsupported-png', '仅支持无滤镜的本产品 PNG。');
      pixels.set(raw.subarray(row * stride + 1, (row + 1) * stride), row * width * 4);
    }
    return Object.freeze({ width, height, pixels, text: Object.freeze(text) });
  }

  function encodeHaldPng(value, options = {}) {
    const transform = assertEligible(value);
    const { spec, pixels } = writeHaldPixels(transform, options);
    const bytes = encodePngRgba(spec.dimension, spec.dimension, pixels, {
      Format: FORMAT,
      Version: String(VERSION),
      HaldLevel: String(spec.level),
      Layout: spec.layout,
      ColorSpace: COLOR_SPACE_SRGB,
      SourceLutSha256: value?.lut?.sha256 || value?.sha256 || '',
    });
    return Object.freeze({ bytes, pixels, ...spec });
  }

  async function encodeHaldPngAsync(value, options = {}) {
    const transform = assertEligible(value);
    const { spec, pixels } = await writeHaldPixelsAsync(transform, options);
    checkAbort(options.signal);
    const bytes = encodePngRgba(spec.dimension, spec.dimension, pixels, {
      Format: FORMAT,
      Version: String(VERSION),
      HaldLevel: String(spec.level),
      Layout: spec.layout,
      ColorSpace: COLOR_SPACE_SRGB,
      SourceLutSha256: value?.lut?.sha256 || value?.sha256 || '',
    });
    return Object.freeze({ bytes, pixels, ...spec });
  }

  function decodeHaldPng(bytes) {
    const decoded = decodePngRgba(bytes);
    const level = Number(decoded.text.HaldLevel);
    const spec = layout(level);
    if (decoded.width !== spec.dimension || decoded.height !== spec.dimension)
      fail('invalid-hald-layout', 'Hald PNG 尺寸与 Level 不一致。');
    if (
      decoded.text.Format !== FORMAT ||
      decoded.text.Layout !== spec.layout ||
      decoded.text.ColorSpace !== COLOR_SPACE_SRGB
    )
      fail('invalid-hald-layout', 'Hald PNG 元数据不符合 Real Landscape Hald v1。');
    return Object.freeze({ ...decoded, ...spec });
  }

  function sampleHald(decoded, rgb) {
    if (!decoded?.pixels || !Array.isArray(rgb) || rgb.length !== 3)
      fail('invalid-hald-layout', 'Hald 采样参数无效。');
    const maximum = decoded.cubeSize - 1;
    const positions = rgb.map((value) => {
      if (!Number.isFinite(value) || value < 0 || value > 1)
        fail('invalid-hald-layout', 'Hald 采样必须在 0 到 1。');
      return value * maximum;
    });
    const lower = positions.map(Math.floor);
    const upper = lower.map((value) => Math.min(value + 1, maximum));
    const mix = positions.map((value, index) => value - lower[index]);
    const pixel = (red, green, blue, channel) =>
      decoded.pixels[sampleOffset(red, green, blue, decoded.cubeSize) * 4 + channel] / 255;
    const lerp = (start, end, amount) => start + (end - start) * amount;
    return [0, 1, 2].map((channel) => {
      const lowerBlue = lerp(
        lerp(
          lerp(
            pixel(lower[0], lower[1], lower[2], channel),
            pixel(upper[0], lower[1], lower[2], channel),
            mix[0]
          ),
          lerp(
            pixel(lower[0], upper[1], lower[2], channel),
            pixel(upper[0], upper[1], lower[2], channel),
            mix[0]
          ),
          mix[1]
        ),
        lerp(
          lerp(
            pixel(lower[0], lower[1], upper[2], channel),
            pixel(upper[0], lower[1], upper[2], channel),
            mix[0]
          ),
          lerp(
            pixel(lower[0], upper[1], upper[2], channel),
            pixel(upper[0], upper[1], upper[2], channel),
            mix[0]
          ),
          mix[1]
        ),
        mix[2]
      );
      return lowerBlue;
    });
  }

  function compareLutSamples(value, decoded, points) {
    const transform = assertEligible(value);
    const samples = points || decoded.cubeSize;
    if (!Number.isSafeInteger(samples) || samples < 2)
      fail('invalid-sample-count', 'Hald 对照采样数量无效。');
    let maximumError = 0;
    for (let blue = 0; blue < samples; blue += 1) {
      for (let green = 0; green < samples; green += 1) {
        for (let red = 0; red < samples; red += 1) {
          const input = [red / (samples - 1), green / (samples - 1), blue / (samples - 1)];
          const expected = transform.sample(input);
          const actual = sampleHald(decoded, input);
          for (let channel = 0; channel < 3; channel += 1)
            maximumError = Math.max(maximumError, Math.abs(expected[channel] - actual[channel]));
        }
      }
    }
    return Object.freeze({ samples, maximumError, quantizationLimit: 1 / 255 });
  }

  return Object.freeze({
    FORMAT,
    VERSION,
    DEFAULT_LEVEL,
    MIN_LEVEL,
    MAX_LEVEL,
    COLOR_SPACE_SRGB,
    HaldError,
    layout,
    assertEligible,
    encodePngRgba,
    decodePngRgba,
    encodeHaldPng,
    encodeHaldPngAsync,
    decodeHaldPng,
    sampleHald,
    compareLutSamples,
  });
});
