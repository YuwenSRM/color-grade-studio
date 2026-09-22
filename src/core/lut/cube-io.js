(function (root, factory) {
  const model =
    typeof module === 'object' && module.exports
      ? require('../color/transform-document.js')
      : root.ColorTransformDocument;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformCubeIo = api;
})(globalThis, function (model) {
  'use strict';

  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_3D_SIZE = 65;
  const codes = Object.freeze({
    invalidBytes: 'invalid-cube-bytes',
    invalidEncoding: 'invalid-cube-encoding',
    tooLarge: 'cube-file-too-large',
    empty: 'empty-cube-file',
    invalidDirective: 'invalid-cube-directive',
    duplicateDirective: 'duplicate-cube-directive',
    invalidSize: 'invalid-cube-size',
    invalidNumber: 'invalid-cube-number',
    invalidData: 'invalid-cube-data',
    dataCount: 'cube-data-count-mismatch',
    invalidDomain: 'invalid-cube-domain',
    unsupportedSequence: 'unsupported-cube-sequence',
    unsupportedTransform: 'cube-target-unsupported-transform',
    invalidTarget: 'invalid-cube-target',
    aborted: 'operation-aborted',
  });
  class CubeIoError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'CubeIoError';
      this.code = code;
      this.stage = 'cube-io';
      this.details = Object.freeze({ ...details });
    }
  }
  function fail(code, message, details) {
    throw new CubeIoError(code, message, details);
  }
  function hash(bytes) {
    if (typeof require !== 'function') return null;
    return require('node:crypto').createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  }
  function byteView(input) {
    if (ArrayBuffer.isView(input))
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    fail(codes.invalidBytes, 'CUBE input must be bytes.');
  }
  function number(token, line) {
    if (!/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(token))
      fail(codes.invalidNumber, 'CUBE contains an invalid number.', { line, token });
    const result = Number(token);
    if (!Number.isFinite(result))
      fail(codes.invalidNumber, 'CUBE contains a non-finite number.', { line, token });
    return result;
  }
  function vec(tokens, line, directive) {
    if (tokens.length !== 4)
      fail(codes.invalidDirective, 'CUBE directive must contain three numbers.', {
        line,
        directive,
      });
    return [number(tokens[1], line), number(tokens[2], line), number(tokens[3], line)];
  }
  function scalarRange(tokens, line, directive) {
    if (tokens.length !== 3)
      fail(codes.invalidDirective, 'CUBE input range must contain two numbers.', {
        line,
        directive,
      });
    const minimum = number(tokens[1], line),
      maximum = number(tokens[2], line);
    if (minimum >= maximum)
      fail(codes.invalidDomain, 'CUBE input range must be increasing.', { line, directive });
    return [minimum, maximum];
  }
  function parseTitle(value, line) {
    const match = /^"((?:[^"\\]|\\["\\])*)"$/.exec(value.trim());
    if (!match)
      fail(codes.invalidDirective, 'CUBE TITLE must be a quoted string.', {
        line,
        directive: 'TITLE',
      });
    return match[1].replace(/\\(["\\])/g, '$1');
  }
  function parseCubeBytes(input, options = {}) {
    const bytes = byteView(input);
    if (!bytes.length) fail(codes.empty, 'CUBE file is empty.');
    if (bytes.length > (options.maxBytes || MAX_BYTES))
      fail(codes.tooLarge, 'CUBE file exceeds its byte limit.', {
        actual: bytes.length,
        maximum: options.maxBytes || MAX_BYTES,
      });
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      fail(codes.invalidEncoding, 'CUBE file must be valid UTF-8.');
    }
    return parseCubeText(text, { ...options, bytes });
  }
  function parseCubeText(text, options = {}) {
    if (typeof text !== 'string' || !text.trim()) fail(codes.empty, 'CUBE file is empty.');
    const seen = new Set();
    const rows = [];
    let title = null;
    let size1 = null;
    let size3 = null;
    let domainMin = [0, 0, 0],
      domainMax = [1, 1, 1],
      oneRange = null,
      threeRange = null;
    let hasResolve = false;
    const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = index + 1;
      const clean = lines[index].replace(/#.*/, '').trim();
      if (!clean) continue;
      const tokens = clean.split(/\s+/);
      const directive = tokens[0];
      if (/^[+-]?(?:\d|\.)/.test(directive)) {
        if (tokens.length !== 3)
          fail(codes.invalidData, 'CUBE data rows must contain three numbers.', { line });
        rows.push([number(tokens[0], line), number(tokens[1], line), number(tokens[2], line)]);
        continue;
      }
      if (
        ![
          'TITLE',
          'LUT_1D_SIZE',
          'LUT_3D_SIZE',
          'DOMAIN_MIN',
          'DOMAIN_MAX',
          'LUT_1D_INPUT_RANGE',
          'LUT_3D_INPUT_RANGE',
        ].includes(directive)
      )
        fail(codes.invalidDirective, 'CUBE directive is not in the supported subset.', {
          line,
          directive,
        });
      if (seen.has(directive))
        fail(codes.duplicateDirective, 'CUBE directive may occur only once.', { line, directive });
      if (rows.length)
        fail(codes.invalidDirective, 'CUBE directives must precede data.', { line, directive });
      seen.add(directive);
      if (directive === 'TITLE') title = parseTitle(clean.slice(5), line);
      else if (directive === 'LUT_1D_SIZE' || directive === 'LUT_3D_SIZE') {
        if (tokens.length !== 2 || !/^\d+$/.test(tokens[1]))
          fail(codes.invalidSize, 'CUBE LUT size must be an integer.', { line, directive });
        const size = Number(tokens[1]);
        const maximum = directive === 'LUT_3D_SIZE' ? MAX_3D_SIZE : 65536;
        if (size < 2 || size > maximum)
          fail(codes.invalidSize, 'CUBE LUT size is outside the frozen support range.', {
            line,
            directive,
            size,
            maximum,
          });
        if (directive === 'LUT_1D_SIZE') size1 = size;
        else size3 = size;
      } else if (directive === 'DOMAIN_MIN') domainMin = vec(tokens, line, directive);
      else if (directive === 'DOMAIN_MAX') domainMax = vec(tokens, line, directive);
      else {
        hasResolve = true;
        if (directive === 'LUT_1D_INPUT_RANGE') oneRange = scalarRange(tokens, line, directive);
        else threeRange = scalarRange(tokens, line, directive);
      }
    }
    if (!size1 && !size3)
      fail(codes.invalidDirective, 'CUBE must declare LUT_1D_SIZE or LUT_3D_SIZE.');
    if (hasResolve && (seen.has('DOMAIN_MIN') || seen.has('DOMAIN_MAX')))
      fail(
        codes.invalidDirective,
        'Resolve input ranges and IRIDAS DOMAIN directives cannot be mixed.'
      );
    for (let c = 0; c < 3; c += 1)
      if (domainMin[c] >= domainMax[c])
        fail(codes.invalidDomain, 'CUBE domain must be increasing.', { channel: c });
    const expected = (size1 || 0) + (size3 ? size3 ** 3 : 0);
    if (rows.length !== expected)
      fail(codes.dataCount, 'CUBE data row count does not match its declared LUT sizes.', {
        expected,
        actual: rows.length,
      });
    const transforms = [];
    let at = 0;
    if (size1) {
      const range = oneRange || [domainMin[0], domainMax[0]];
      transforms.push({
        type: 'lut1d',
        size: size1,
        domainMin: [range[0], range[0], range[0]],
        domainMax: [range[1], range[1], range[1]],
        values: rows.slice(at, at + size1).flat(),
      });
      at += size1;
    }
    if (size3) {
      const range = threeRange || null;
      transforms.push({
        type: 'lut3d',
        size: size3,
        domainMin: range ? [range[0], range[0], range[0]] : domainMin,
        domainMax: range ? [range[1], range[1], range[1]] : domainMax,
        values: rows.slice(at).flat(),
        ordering: 'red-fastest',
      });
    }
    const dialect = hasResolve ? 'resolve' : 'iridas';
    const bytes = options.bytes || new TextEncoder().encode(text);
    return model.createColorTransformDocument({
      source: {
        format: 'cube',
        dialect,
        filename: options.filename || null,
        byteLength: bytes.byteLength,
        sha256: hash(bytes),
        originalBlob: options.originalBlob || null,
      },
      colorContract: options.colorContract || {},
      transforms,
      metadata: { title, originalDirectives: [...seen] },
      compatibility: {
        photoColorSpace: options.photoColorSpace || null,
        conversionTargets: {
          cube: { status: 'supported', code: null, loss: null },
          hald: { status: 'supported-with-bake', code: null, loss: 'pipeline-bake' },
        },
      },
    });
  }
  function format(value) {
    if (!Number.isFinite(value)) fail(codes.invalidTarget, 'CUBE cannot write a non-finite value.');
    return Number(value).toFixed(7);
  }
  function sameChannels(v) {
    return v[0] === v[1] && v[1] === v[2];
  }
  function writeCube(document, options = {}) {
    const dialect = options.dialect || 'iridas';
    if (!['iridas', 'resolve'].includes(dialect))
      fail(codes.invalidTarget, 'Only IRIDAS and Resolve CUBE output are supported.');
    const nodes = document?.transforms || [];
    const allowed = nodes.filter((node) => node.type === 'lut1d' || node.type === 'lut3d');
    if (
      !nodes.length ||
      allowed.length !== nodes.length ||
      nodes.filter((node) => node.type === 'lut1d').length > 1 ||
      nodes.filter((node) => node.type === 'lut3d').length > 1
    )
      fail(
        codes.unsupportedTransform,
        'CUBE can express at most one 1D LUT followed by one 3D LUT.',
        { types: nodes.map((node) => node.type) }
      );
    if (nodes.length === 2 && !(nodes[0].type === 'lut1d' && nodes[1].type === 'lut3d'))
      fail(codes.unsupportedSequence, 'CUBE sequence must be 1D then 3D.');
    const one = nodes.find((node) => node.type === 'lut1d'),
      three = nodes.find((node) => node.type === 'lut3d');
    const lines = [];
    if (options.title || document.metadata?.title)
      lines.push(`TITLE ${JSON.stringify(options.title || document.metadata.title)}`);
    if (dialect === 'iridas') {
      const node = three || one;
      lines.push(`DOMAIN_MIN ${Array.from(node.domainMin, format).join(' ')}`);
      lines.push(`DOMAIN_MAX ${Array.from(node.domainMax, format).join(' ')}`);
    }
    if (one) {
      lines.push(`LUT_1D_SIZE ${one.size}`);
      if (dialect === 'resolve') {
        if (!sameChannels(one.domainMin) || !sameChannels(one.domainMax))
          fail(codes.invalidTarget, 'Resolve input range must be scalar.');
        lines.push(`LUT_1D_INPUT_RANGE ${format(one.domainMin[0])} ${format(one.domainMax[0])}`);
      }
    }
    if (three) {
      lines.push(`LUT_3D_SIZE ${three.size}`);
      if (dialect === 'resolve') {
        if (!sameChannels(three.domainMin) || !sameChannels(three.domainMax))
          fail(codes.invalidTarget, 'Resolve input range must be scalar.');
        lines.push(
          `LUT_3D_INPUT_RANGE ${format(three.domainMin[0])} ${format(three.domainMax[0])}`
        );
      }
    }
    for (const node of [one, three])
      if (node)
        for (let index = 0; index < node.values.length; index += 3)
          lines.push(
            `${format(node.values[index])} ${format(node.values[index + 1])} ${format(node.values[index + 2])}`
          );
    return new TextEncoder().encode(`${lines.join('\n')}\n`);
  }
  return Object.freeze({
    MAX_BYTES,
    codes,
    CubeIoError,
    parseCubeBytes,
    parseCubeText,
    writeCube,
    hash,
  });
});
