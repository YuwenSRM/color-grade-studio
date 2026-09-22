(function (global) {
  'use strict';

  const limits = Object.freeze({
    maxFileBytes: 50 * 1024 * 1024,
    maxPixels: 60000000,
    maxDimension: 32767,
  });
  const errors = Object.freeze({
    unsupported: 'IMAGE_UNSUPPORTED',
    fileSize: 'IMAGE_FILE_TOO_LARGE',
    dimensions: 'IMAGE_DIMENSIONS_INVALID',
    decode: 'IMAGE_DECODE_FAILED',
  });
  function failure(code, details) {
    const error = new Error(code);
    error.code = code;
    error.details = details || {};
    return error;
  }
  const mimeFormats = {
    'image/png': 'png',
    'image/x-png': 'png',
    'image/jpeg': 'jpeg',
    'image/pjpeg': 'jpeg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/x-ms-bmp': 'bmp',
    'image/avif': 'avif',
  };
  const extensionFormats = {
    png: 'png',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    webp: 'webp',
    gif: 'gif',
    bmp: 'bmp',
    avif: 'avif',
  };

  function checkDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      throw failure(errors.decode);
    if (
      width > limits.maxDimension ||
      height > limits.maxDimension ||
      width * height > limits.maxPixels
    )
      throw failure(errors.dimensions);
  }

  function textAt(view, offset, count) {
    let result = '';
    for (let i = 0; i < count; i++) result += String.fromCharCode(view.getUint8(offset + i));
    return result;
  }

  // Read bounded windows and skip metadata segments instead of reading the whole file.
  // AVIF dimensions are checked after decoding; its nested item properties need a full container parser.
  async function inspectDimensions(file, format, isAborted) {
    let windowStart = -1;
    let windowBytes = null;
    async function read(offset, length) {
      if (isAborted()) throw new DOMException('Aborted', 'AbortError');
      if (offset < 0 || length < 0 || offset + length > file.size) throw failure(errors.decode);
      if (
        !windowBytes ||
        offset < windowStart ||
        offset + length > windowStart + windowBytes.byteLength
      ) {
        windowStart = offset;
        windowBytes = await file
          .slice(offset, Math.min(file.size, offset + Math.max(length, 65536)))
          .arrayBuffer();
        if (isAborted()) throw new DOMException('Aborted', 'AbortError');
      }
      return new DataView(windowBytes, offset - windowStart, length);
    }
    const header = await read(0, Math.min(32, file.size));
    if (format === 'png') {
      if (
        header.byteLength < 24 ||
        textAt(header, 0, 8) !== '\x89PNG\r\n\x1a\n' ||
        header.getUint32(8) !== 13 ||
        textAt(header, 12, 4) !== 'IHDR'
      )
        throw failure(errors.decode);
      return [header.getUint32(16), header.getUint32(20)];
    }
    if (format === 'gif') {
      if (header.byteLength < 10 || !['GIF87a', 'GIF89a'].includes(textAt(header, 0, 6)))
        throw new Error(errors.decode);
      return [header.getUint16(6, true), header.getUint16(8, true)];
    }
    if (format === 'bmp') {
      if (header.byteLength < 26 || textAt(header, 0, 2) !== 'BM') throw new Error(errors.decode);
      const dibSize = header.getUint32(14, true);
      if (dibSize === 12) return [header.getUint16(18, true), header.getUint16(20, true)];
      if (dibSize >= 40) return [header.getInt32(18, true), Math.abs(header.getInt32(22, true))];
      throw new Error(errors.decode);
    }
    if (format === 'jpeg') {
      if (header.byteLength < 4 || header.getUint16(0) !== 0xffd8) throw new Error(errors.decode);
      let offset = 2;
      while (offset < file.size) {
        let marker = await read(offset, 2);
        if (marker.getUint8(0) !== 0xff) throw new Error(errors.decode);
        while (marker.getUint8(1) === 0xff) marker = await read(++offset, 2);
        const code = marker.getUint8(1);
        offset += 2;
        if (code === 0xda || code === 0xd9 || code === 0x00) throw new Error(errors.decode);
        if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) continue;
        const segment = await read(offset, 2);
        const length = segment.getUint16(0);
        if (length < 2 || offset + length > file.size) throw new Error(errors.decode);
        if (code >= 0xc0 && code <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(code)) {
          if (length < 8) throw new Error(errors.decode);
          const frame = await read(offset, 7);
          return [frame.getUint16(5), frame.getUint16(3)];
        }
        offset += length;
      }
      throw new Error(errors.decode);
    }
    if (format === 'webp') {
      if (
        header.byteLength < 20 ||
        textAt(header, 0, 4) !== 'RIFF' ||
        textAt(header, 8, 4) !== 'WEBP'
      )
        throw new Error(errors.decode);
      const end = header.getUint32(4, true) + 8;
      if (end > file.size || end < 20) throw new Error(errors.decode);
      let offset = 12;
      while (offset + 8 <= end) {
        const chunk = await read(offset, 8);
        const kind = textAt(chunk, 0, 4);
        const length = chunk.getUint32(4, true);
        if (offset + 8 + length > end) throw new Error(errors.decode);
        if (kind === 'VP8X') {
          if (length < 10) throw new Error(errors.decode);
          const data = await read(offset + 8, 10);
          const uint24 = (start) =>
            data.getUint8(start) +
            data.getUint8(start + 1) * 256 +
            data.getUint8(start + 2) * 65536;
          return [uint24(4) + 1, uint24(7) + 1];
        }
        if (kind === 'VP8 ') {
          if (length < 10) throw new Error(errors.decode);
          const data = await read(offset + 8, 10);
          if (textAt(data, 3, 3) !== '\x9d\x01\x2a') throw new Error(errors.decode);
          return [data.getUint16(6, true) & 0x3fff, data.getUint16(8, true) & 0x3fff];
        }
        if (kind === 'VP8L') {
          if (length < 5) throw new Error(errors.decode);
          const data = await read(offset + 8, 5);
          if (data.getUint8(0) !== 0x2f) throw new Error(errors.decode);
          const bits = data.getUint32(1, true);
          return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
        }
        offset += 8 + length + (length % 2);
      }
      throw new Error(errors.decode);
    }
    if (format === 'avif') {
      if (header.byteLength < 16 || textAt(header, 4, 4) !== 'ftyp') throw new Error(errors.decode);
      const boxSize = header.getUint32(0);
      if (boxSize < 16 || boxSize > file.size || boxSize > 65536) throw new Error(errors.decode);
      const box = await read(0, boxSize);
      for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
        if (offset === 12) continue; // Minor version is not a compatible brand.
        if (['avif', 'avis'].includes(textAt(box, offset, 4))) return null;
      }
      throw new Error(errors.decode);
    }
    throw new Error(errors.unsupported);
  }

  function load(file, options = {}) {
    const signal = options.signal;
    return new Promise((resolve, reject) => {
      let settled = false;
      let objectUrl = null;
      let image = null;
      function finish(error) {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', abort);
        if (image) {
          image.onload = null;
          image.onerror = null;
          if (error) image.removeAttribute('src');
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (error) reject(error);
        else resolve(image);
      }
      function abort() {
        finish(new DOMException('Aborted', 'AbortError'));
      }
      if (signal && signal.aborted) return abort();
      if (signal) signal.addEventListener('abort', abort, { once: true });
      (async () => {
        const mime = String((file && file.type) || '').toLowerCase();
        const extension = String((file && file.name) || '')
          .split('.')
          .pop()
          .toLowerCase();
        const format = mime ? mimeFormats[mime] : extensionFormats[extension];
        if (!file || typeof file.slice !== 'function' || !format) throw failure(errors.unsupported);
        if (file.size > limits.maxFileBytes) throw failure(errors.fileSize);
        if (!file.size) throw failure(errors.decode);
        const dimensions = await inspectDimensions(file, format, () => settled);
        if (settled) return;
        if (dimensions) checkDimensions(...dimensions);
        image = new Image();
        image.decoding = 'async';
        image.onerror = () => finish(failure(errors.decode));
        image.onload = async () => {
          if (settled) return;
          try {
            // onload covers older browsers, decode() ensures drawing will not trigger deferred decoding.
            if (typeof image.decode === 'function') await image.decode();
            if (settled) return;
            checkDimensions(image.naturalWidth, image.naturalHeight);
            finish();
          } catch (error) {
            finish(failure(error.code === errors.dimensions ? errors.dimensions : errors.decode));
          }
        };
        objectUrl = URL.createObjectURL(file);
        image.src = objectUrl;
      })().catch((error) => {
        finish(failure(Object.values(errors).includes(error?.code) ? error.code : errors.decode));
      });
    });
  }

  global.LandscapeColorImport = Object.freeze({ load, limits, errors });
})(window);
