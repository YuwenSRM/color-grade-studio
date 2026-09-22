(function (root, factory) {
  const model =
    typeof module === 'object' && module.exports
      ? require('../color/transform-document.js')
      : root.ColorTransformDocument;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformLustre3dlIo = api;
})(globalThis, function (model) {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const codes = Object.freeze({
    invalidBytes: 'invalid-3dl-bytes',
    invalidEncoding: 'invalid-3dl-encoding',
    tooLarge: '3dl-file-too-large',
    unsupportedDialect: 'unsupported-3dl-dialect',
    invalidHeader: 'invalid-lustre-3dl-header',
    invalidData: 'invalid-lustre-3dl-data',
    invalidCode: 'invalid-lustre-3dl-code',
    invalidTarget: 'invalid-lustre-3dl-target',
  });
  class Lustre3dlIoError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'Lustre3dlIoError';
      this.code = code;
      this.stage = 'lustre-3dl-io';
      this.details = Object.freeze({ ...details });
    }
  }
  function fail(code, message, details) {
    throw new Lustre3dlIoError(code, message, details);
  }
  function view(value) {
    if (ArrayBuffer.isView(value))
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    fail(codes.invalidBytes, '.3dl input must be bytes.');
  }
  function hash(value) {
    return typeof require === 'function'
      ? require('node:crypto').createHash('sha256').update(Buffer.from(value)).digest('hex')
      : null;
  }
  function parseInteger(value, line) {
    if (!/^\d+$/.test(value))
      fail(codes.invalidCode, 'Lustre .3dl values must be unsigned decimal integer codes.', {
        line,
        value,
      });
    return Number(value);
  }
  function parseLustre3dlBytes(input, options = {}) {
    const sourceBytes = view(input);
    if (!sourceBytes.length) fail(codes.invalidData, '.3dl is empty.');
    if (sourceBytes.length > (options.maxBytes || MAX_BYTES))
      fail(codes.tooLarge, '.3dl exceeds its byte limit.');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
    } catch (_) {
      fail(codes.invalidEncoding, '.3dl must be UTF-8.');
    }
    const lines = text
      .replace(/^\uFEFF/, '')
      .split(/\r\n|\n|\r/)
      .map((raw, index) => ({ line: index + 1, text: raw.trim() }));
    const effective = lines.filter((entry) => entry.text && !entry.text.startsWith('#'));
    if (
      effective.length < 3 ||
      effective[0].text !== '3DMESH' ||
      !/^Mesh\s+5\s+12$/.test(effective[1].text)
    )
      fail(
        codes.unsupportedDialect,
        'Only the explicit Lustre Mesh 5 12 / 33-cube / 12-bit-output subset is open.',
        { header: effective.slice(0, 2).map((entry) => entry.text) }
      );
    const size = 33,
      outputMaximum = 4095,
      data = effective.slice(2, 2 + size ** 3),
      trailer = effective.slice(2 + size ** 3);
    if (
      data.length !== size ** 3 ||
      (trailer.length &&
        !(trailer.length === 2 && trailer[0].text === 'LUT8' && trailer[1].text === 'gamma 1.0'))
    )
      fail(
        codes.invalidData,
        'Lustre Mesh 5 12 must contain exactly 33 cubed RGB rows, with only the fixed optional LUT8/gamma trailer.',
        { expected: size ** 3, actual: data.length, trailer: trailer.map((entry) => entry.text) }
      );
    const values = new Float64Array(size ** 3 * 3);
    for (let source = 0; source < data.length; source += 1) {
      const parts = data[source].text.split(/\s+/);
      if (parts.length !== 3)
        fail(codes.invalidData, 'Lustre data rows require exactly three integer codes.', {
          line: data[source].line,
        });
      const r = Math.floor(source / (size * size)),
        g = Math.floor(source / size) % size,
        b = source % size;
      const target = ((b * size + g) * size + r) * 3;
      for (let c = 0; c < 3; c += 1) {
        const code = parseInteger(parts[c], data[source].line);
        if (code > outputMaximum)
          fail(codes.invalidCode, 'Lustre output code is outside 12-bit range.', {
            line: data[source].line,
            code,
          });
        values[target + c] = code / outputMaximum;
      }
    }
    return model.createColorTransformDocument({
      source: {
        format: '3dl',
        dialect: 'lustre-mesh-5-12-33-no-shaper',
        filename: options.filename || null,
        byteLength: sourceBytes.byteLength,
        sha256: hash(sourceBytes),
        originalBlob: options.originalBlob || null,
      },
      colorContract: options.colorContract || {},
      transforms: [{ type: 'lut3d', size, values, ordering: 'red-fastest' }],
      metadata: {
        threeDl: {
          inputBitDepth: 5,
          outputBitDepth: 12,
          inputRange: [0, 31],
          outputRange: [0, 4095],
          sourceOrdering: 'blue-fastest',
          internalOrdering: 'red-fastest',
          shaper: 'absent',
        },
      },
      compatibility: {
        photoColorSpace: options.photoColorSpace || null,
        conversionTargets: {
          cube: { status: 'supported-with-bake', code: null, loss: 'pipeline-bake' },
          spi3d: { status: 'supported-with-bake', code: null, loss: 'pipeline-bake' },
          csp: { status: 'supported-with-bake', code: null, loss: 'pipeline-bake' },
          '3dl-lustre': {
            status: 'supported-with-quantization',
            code: null,
            loss: 'format-rewrite',
          },
        },
      },
    });
  }
  function writeLustre3dl(document) {
    const nodes = document?.transforms || [];
    if (nodes.length !== 1 || nodes[0].type !== 'lut3d' || nodes[0].size !== 33)
      fail(codes.invalidTarget, 'Lustre 3DL output is restricted to one 33-point 3D LUT.');
    const node = nodes[0],
      lines = [
        '3DMESH',
        'Mesh 5 12',
        '# 3 columns rgb',
        '# 35937 rows',
        '# input [0..31]',
        '# output [0..4095]',
        '# 33 cubed',
      ];
    for (let r = 0; r < 33; r += 1)
      for (let g = 0; g < 33; g += 1)
        for (let b = 0; b < 33; b += 1) {
          const at = ((b * 33 + g) * 33 + r) * 3;
          const encode = (value) => Math.round(Math.max(0, Math.min(1, value)) * 4095);
          lines.push(
            `${encode(node.values[at])} ${encode(node.values[at + 1])} ${encode(node.values[at + 2])}`
          );
        }
    return new TextEncoder().encode(`${lines.join('\n')}\n`);
  }
  return Object.freeze({
    MAX_BYTES,
    codes,
    Lustre3dlIoError,
    parseLustre3dlBytes,
    writeLustre3dl,
    hash,
  });
});
