(function (root, factory) {
  const model =
    typeof module === 'object' && module.exports
      ? require('../color/transform-document.js')
      : root.ColorTransformDocument;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformCspIo = api;
})(globalThis, function (model) {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const codes = Object.freeze({
    invalidBytes: 'invalid-csp-bytes',
    invalidEncoding: 'invalid-csp-encoding',
    tooLarge: 'csp-file-too-large',
    invalidHeader: 'invalid-csp-header',
    invalidSection: 'invalid-csp-section',
    invalidData: 'invalid-csp-data',
    invalidNumber: 'invalid-csp-number',
    unsupportedSection: 'unsupported-csp-section',
    unsupportedTarget: 'csp-target-unsupported-transform',
  });
  class CspIoError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'CspIoError';
      this.code = code;
      this.stage = 'csp-io';
      this.details = Object.freeze({ ...details });
    }
  }
  function fail(code, message, details) {
    throw new CspIoError(code, message, details);
  }
  function view(value) {
    if (ArrayBuffer.isView(value))
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    fail(codes.invalidBytes, 'CSP input must be bytes.');
  }
  function hash(value) {
    return typeof require === 'function'
      ? require('node:crypto').createHash('sha256').update(Buffer.from(value)).digest('hex')
      : null;
  }
  function numeric(value, line) {
    if (
      !/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(value) ||
      !Number.isFinite(Number(value))
    )
      fail(codes.invalidNumber, 'CSP contains an invalid number.', { line, value });
    return Number(value);
  }
  function oneLine(lines, at, count, line, label) {
    if (typeof lines[at] !== 'string')
      fail(codes.invalidData, `CSP ${label} is truncated.`, { line });
    const parts = lines[at].split(/\s+/);
    if (parts.length !== count)
      fail(codes.invalidData, `CSP ${label} length is invalid.`, { line });
    return parts.map((part) => numeric(part, line));
  }
  function parseCspBytes(input, options = {}) {
    const sourceBytes = view(input);
    if (!sourceBytes.length) fail(codes.invalidData, 'CSP is empty.');
    if (sourceBytes.length > (options.maxBytes || MAX_BYTES))
      fail(codes.tooLarge, 'CSP exceeds its byte limit.');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
    } catch (_) {
      fail(codes.invalidEncoding, 'CSP must be UTF-8.');
    }
    const lines = text
      .replace(/^\uFEFF/, '')
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines[0] !== 'CSPLUTV100' || !['1D', '3D'].includes(lines[1]))
      fail(
        codes.invalidHeader,
        'CSP controlled subset requires CSPLUTV100 and an explicit 1D or 3D type.'
      );
    let at = 2;
    if (lines[at] === 'BEGIN METADATA')
      fail(codes.unsupportedSection, 'CSP metadata is rejected in the controlled subset.');
    const type = lines[1],
      inputRanges = [null, null, null],
      output = [null, null, null],
      sizes = [];
    for (let c = 0; c < 3; c += 1) {
      if (!/^\d+$/.test(lines[at]))
        fail(codes.invalidData, 'CSP pre-LUT size is invalid.', { channel: c });
      const size = Number(lines[at++]);
      if (size === 0) {
        inputRanges[c] = [0, 1];
        output[c] = [0, 1];
        sizes.push(2);
        continue;
      }
      if (size < 2 || size > 65536)
        fail(codes.invalidData, 'CSP pre-LUT size is outside the safety limit.', {
          channel: c,
          size,
        });
      const inputs = oneLine(lines, at++, size, at, 'pre-LUT input');
      output[c] = oneLine(lines, at++, size, at, 'pre-LUT output');
      for (let i = 1; i < size; i += 1)
        if (inputs[i - 1] >= inputs[i])
          fail(codes.invalidData, 'CSP pre-LUT input range must increase.', {
            channel: c,
            index: i,
          });
      inputRanges[c] = [inputs[0], inputs[inputs.length - 1]];
      sizes.push(size);
    }
    const hasPrelut = output.some(
      (channel, c) =>
        channel.length !== 2 ||
        inputRanges[c][0] !== 0 ||
        inputRanges[c][1] !== 1 ||
        channel[0] !== 0 ||
        channel[1] !== 1
    );
    if (!(sizes[0] === sizes[1] && sizes[1] === sizes[2]))
      fail(
        codes.unsupportedSection,
        'CSP channels must use equal pre-LUT sizes in the controlled subset.'
      );
    const transforms = [];
    if (hasPrelut) {
      const values = new Float64Array(sizes[0] * 3);
      for (let i = 0; i < sizes[0]; i += 1)
        for (let c = 0; c < 3; c += 1) values[i * 3 + c] = output[c][i];
      transforms.push({
        type: 'lut1d',
        size: sizes[0],
        domainMin: inputRanges.map((range) => range[0]),
        domainMax: inputRanges.map((range) => range[1]),
        values,
      });
    }
    if (type === '1D') {
      if (!/^\d+$/.test(lines[at])) fail(codes.invalidData, 'CSP 1D size is invalid.');
      const size = Number(lines[at++]);
      if (size < 2 || size > 65536 || at + size !== lines.length)
        fail(codes.invalidData, 'CSP 1D table is invalid or incomplete.');
      const values = new Float64Array(size * 3);
      for (let i = 0; i < size; i += 1) values.set(oneLine(lines, at++, 3, at, '1D'), i * 3);
      transforms.push({ type: 'lut1d', size, values });
    } else {
      const dimensions = oneLine(lines, at++, 3, at, '3D dimensions');
      if (
        !dimensions.every(Number.isSafeInteger) ||
        !(dimensions[0] === dimensions[1] && dimensions[1] === dimensions[2]) ||
        dimensions[0] < 2 ||
        dimensions[0] > 65
      )
        fail(codes.invalidData, 'CSP 3D grid must be cubic from 2 through 65.');
      const size = dimensions[0];
      if (at + size ** 3 !== lines.length)
        fail(codes.invalidData, 'CSP 3D table is invalid or incomplete.');
      const values = new Float64Array(size ** 3 * 3);
      for (let i = 0; i < size ** 3; i += 1) values.set(oneLine(lines, at++, 3, at, '3D'), i * 3);
      transforms.push({ type: 'lut3d', size, values, ordering: 'red-fastest' });
    }
    return model.createColorTransformDocument({
      source: {
        format: 'csp',
        dialect: 'cinespace-csplutv100',
        filename: options.filename || null,
        byteLength: sourceBytes.byteLength,
        sha256: hash(sourceBytes),
        originalBlob: options.originalBlob || null,
      },
      colorContract: options.colorContract || {},
      transforms,
      metadata: { csp: { prelut: hasPrelut, type, sequence: transforms.map((node) => node.type) } },
      compatibility: {
        photoColorSpace: options.photoColorSpace || null,
        conversionTargets: {
          cube: { status: 'supported-with-bake', code: null, loss: 'pipeline-bake' },
          spi1d: {
            status: type === '1D' && transforms.length === 1 ? 'supported' : 'supported-with-bake',
            code: null,
            loss: type === '1D' && transforms.length === 1 ? null : 'pipeline-bake',
          },
          spi3d: { status: 'supported-with-bake', code: null, loss: 'pipeline-bake' },
          csp: { status: 'supported', code: null, loss: null },
        },
      },
    });
  }
  function format(value) {
    if (!Number.isFinite(value)) fail(codes.invalidData, 'CSP cannot write non-finite values.');
    return Number(value).toFixed(10);
  }
  function writeCsp(document) {
    const nodes = document?.transforms || [];
    if (
      !nodes.length ||
      nodes.length > 2 ||
      nodes.some((node) => !['lut1d', 'lut3d'].includes(node.type)) ||
      (nodes.length === 2 && nodes[0].type !== 'lut1d')
    )
      fail(codes.unsupportedTarget, 'CSP writes one LUT or a pre-LUT followed by one 1D/3D LUT.');
    const pre = nodes.length === 2 ? nodes[0] : null,
      main = nodes[nodes.length - 1],
      lines = ['CSPLUTV100', main.type === 'lut1d' ? '1D' : '3D'];
    for (let c = 0; c < 3; c += 1) {
      if (!pre) lines.push('0');
      else {
        lines.push(String(pre.size));
        const inputs = Array.from(
          { length: pre.size },
          (_, i) => pre.domainMin[c] + ((pre.domainMax[c] - pre.domainMin[c]) * i) / (pre.size - 1)
        );
        lines.push(inputs.map(format).join(' '));
        lines.push(
          Array.from({ length: pre.size }, (_, i) => format(pre.values[i * 3 + c])).join(' ')
        );
      }
    }
    if (main.type === 'lut1d') {
      lines.push(String(main.size));
      for (let i = 0; i < main.size; i += 1)
        lines.push(
          `${format(main.values[i * 3])} ${format(main.values[i * 3 + 1])} ${format(main.values[i * 3 + 2])}`
        );
    } else {
      lines.push(`${main.size} ${main.size} ${main.size}`);
      for (let i = 0; i < main.values.length; i += 3)
        lines.push(
          `${format(main.values[i])} ${format(main.values[i + 1])} ${format(main.values[i + 2])}`
        );
    }
    return new TextEncoder().encode(`${lines.join('\n')}\n`);
  }
  return Object.freeze({ MAX_BYTES, codes, CspIoError, parseCspBytes, writeCsp, hash });
});
