(function (root, factory) {
  const model =
    typeof module === 'object' && module.exports
      ? require('../color/transform-document.js')
      : root.ColorTransformDocument;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformSpiIo = api;
})(globalThis, function (model) {
  'use strict';

  const MAX_BYTES = 20 * 1024 * 1024;
  const codes = Object.freeze({
    invalidBytes: 'invalid-spi-bytes',
    invalidEncoding: 'invalid-spi-encoding',
    tooLarge: 'spi-file-too-large',
    invalidHeader: 'invalid-spi-header',
    invalidDirective: 'invalid-spi-directive',
    invalidNumber: 'invalid-spi-number',
    invalidData: 'invalid-spi-data',
    invalidIndex: 'invalid-spi-index',
    duplicateIndex: 'duplicate-spi-index',
    missingIndex: 'missing-spi-index',
    unsupportedTarget: 'spi-target-unsupported-transform',
    invalidTarget: 'invalid-spi-target',
  });
  class SpiIoError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'SpiIoError';
      this.code = code;
      this.stage = 'spi-io';
      this.details = Object.freeze({ ...details });
    }
  }
  function fail(code, message, details) {
    throw new SpiIoError(code, message, details);
  }
  function bytes(input) {
    if (ArrayBuffer.isView(input))
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    fail(codes.invalidBytes, 'SPI input must be bytes.');
  }
  function digest(input) {
    return typeof require === 'function'
      ? require('node:crypto').createHash('sha256').update(Buffer.from(input)).digest('hex')
      : null;
  }
  function read(input, options) {
    const view = bytes(input);
    if (!view.length) fail(codes.invalidData, 'SPI file is empty.');
    if (view.length > (options.maxBytes || MAX_BYTES))
      fail(codes.tooLarge, 'SPI file exceeds the byte limit.');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(view);
    } catch (_) {
      fail(codes.invalidEncoding, 'SPI file must be UTF-8.');
    }
  }
  function finite(token, line) {
    if (
      !/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(token) ||
      !Number.isFinite(Number(token))
    )
      fail(codes.invalidNumber, 'SPI contains an invalid number.', { line, token });
    return Number(token);
  }
  function integer(token, line) {
    if (!/^\d+$/.test(token))
      fail(codes.invalidNumber, 'SPI requires an integer.', { line, token });
    return Number(token);
  }
  function cleanLines(text) {
    return text
      .replace(/^\uFEFF/, '')
      .split(/\r\n|\n|\r/)
      .map((raw, index) => ({ raw, line: index + 1, text: raw.replace(/#.*/, '').trim() }))
      .filter((entry) => entry.text);
  }
  function makeDocument(format, dialect, sourceBytes, options, transforms, metadata) {
    return model.createColorTransformDocument({
      source: {
        format,
        dialect,
        filename: options.filename || null,
        byteLength: sourceBytes.byteLength,
        sha256: digest(sourceBytes),
        originalBlob: options.originalBlob || null,
      },
      colorContract: options.colorContract || {},
      transforms,
      metadata,
      compatibility: {
        photoColorSpace: options.photoColorSpace || null,
        conversionTargets: {
          cube: { status: 'supported-with-bake', code: null, loss: 'pipeline-bake' },
          spi1d: { status: 'supported', code: null, loss: null },
          spi3d: { status: 'supported-with-unit-domain', code: null, loss: null },
          csp: { status: 'supported-with-bake', code: null, loss: 'pipeline-bake' },
        },
      },
    });
  }
  function parseSpi1dBytes(input, options = {}) {
    const sourceBytes = bytes(input),
      lines = cleanLines(read(sourceBytes, options));
    let version = null,
      from = null,
      length = null,
      components = null,
      begin = -1,
      end = -1;
    for (let at = 0; at < lines.length; at += 1) {
      const entry = lines[at],
        tokens = entry.text.split(/\s+/),
        key = tokens[0].toLowerCase();
      if (entry.text === '{') {
        if (begin !== -1)
          fail(codes.invalidHeader, 'SPI1D may have one data block.', { line: entry.line });
        begin = at;
        continue;
      }
      if (entry.text === '}') {
        end = at;
        continue;
      }
      if (begin !== -1) continue;
      if (key === 'version' && tokens.length === 2) version = tokens[1];
      else if (key === 'from' && tokens.length === 3)
        from = [finite(tokens[1], entry.line), finite(tokens[2], entry.line)];
      else if (key === 'length' && tokens.length === 2) length = integer(tokens[1], entry.line);
      else if (key === 'components' && tokens.length === 2)
        components = integer(tokens[1], entry.line);
      else
        fail(codes.invalidDirective, 'SPI1D directive is outside the controlled subset.', {
          line: entry.line,
          directive: tokens[0],
        });
    }
    if (
      version !== '1' ||
      !from ||
      !Number.isSafeInteger(length) ||
      length < 2 ||
      length > 65536 ||
      components !== 3 ||
      begin < 0 ||
      end !== lines.length - 1 ||
      end <= begin
    )
      fail(
        codes.invalidHeader,
        'SPI1D requires Version 1, From, Length, Components 3, and one final block.'
      );
    if (from[0] >= from[1]) fail(codes.invalidHeader, 'SPI1D From range must increase.');
    const rows = lines.slice(begin + 1, end);
    if (rows.length !== length)
      fail(codes.invalidData, 'SPI1D row count does not match Length.', {
        expected: length,
        actual: rows.length,
      });
    const values = new Float64Array(length * 3);
    for (let i = 0; i < rows.length; i += 1) {
      const parts = rows[i].text.split(/\s+/);
      if (parts.length !== 3)
        fail(codes.invalidData, 'SPI1D rows must have three components.', { line: rows[i].line });
      for (let c = 0; c < 3; c += 1) values[i * 3 + c] = finite(parts[c], rows[i].line);
    }
    return makeDocument(
      'spi1d',
      'sony-spi1d-v1',
      sourceBytes,
      options,
      [
        {
          type: 'lut1d',
          size: length,
          domainMin: [from[0], from[0], from[0]],
          domainMax: [from[1], from[1], from[1]],
          values,
        },
      ],
      { spi: { version: 1, range: from, components: 3 } }
    );
  }
  function parseSpi3dBytes(input, options = {}) {
    const sourceBytes = bytes(input),
      lines = cleanLines(read(sourceBytes, options));
    if (lines.length < 5 || !/^SPILUT\s+1\.0$/i.test(lines[0].text))
      fail(codes.invalidHeader, 'SPI3D requires SPILUT 1.0.');
    const channel = lines[1].text.split(/\s+/),
      sizes = lines[2].text.split(/\s+/);
    if (channel.length !== 2 || channel[0] !== '3' || channel[1] !== '3' || sizes.length !== 3)
      fail(codes.invalidHeader, 'SPI3D requires 3 3 and cubic grid dimensions.');
    const size = integer(sizes[0], lines[2].line),
      wrapped = lines[3]?.text === '{';
    if (
      sizes.some((value) => integer(value, lines[2].line) !== size) ||
      size < 2 ||
      size > 65 ||
      (wrapped && lines[lines.length - 1].text !== '}')
    )
      fail(
        codes.invalidHeader,
        'SPI3D controlled subset requires a 2..65 cubic grid and explicit rows.'
      );
    const values = new Float64Array(size ** 3 * 3),
      seen = new Uint8Array(size ** 3),
      rows = wrapped ? lines.slice(4, -1) : lines.slice(3);
    if (rows.length > size ** 3)
      fail(codes.invalidData, 'SPI3D has more rows than its declared grid.', {
        expected: size ** 3,
        actual: rows.length,
      });
    for (const row of rows) {
      const parts = row.text.split(/\s+/);
      if (parts.length !== 6)
        fail(codes.invalidData, 'SPI3D rows require r g b R G B.', { line: row.line });
      const r = integer(parts[0], row.line),
        g = integer(parts[1], row.line),
        b = integer(parts[2], row.line);
      if (r >= size || g >= size || b >= size)
        fail(codes.invalidIndex, 'SPI3D index is outside its declared grid.', {
          line: row.line,
          r,
          g,
          b,
          size,
        });
      const target = (b * size + g) * size + r;
      if (seen[target])
        fail(codes.duplicateIndex, 'SPI3D contains a duplicate grid index.', {
          line: row.line,
          r,
          g,
          b,
        });
      seen[target] = 1;
      for (let c = 0; c < 3; c += 1) values[target * 3 + c] = finite(parts[c + 3], row.line);
    }
    const missing = seen.indexOf(0);
    if (missing !== -1)
      fail(codes.missingIndex, 'SPI3D does not cover every declared grid index.', { missing });
    return makeDocument(
      'spi3d',
      'sony-spi3d-v1',
      sourceBytes,
      options,
      [{ type: 'lut3d', size, values, ordering: 'red-fastest' }],
      { spi: { version: '1.0', channels: 3, ordering: 'explicit-index-red-fastest' } }
    );
  }
  function format(value) {
    if (!Number.isFinite(value)) fail(codes.invalidTarget, 'SPI cannot write non-finite values.');
    return Number(value).toFixed(10);
  }
  function assertUnitSpi3dDomains(document) {
    const nodes = (document?.transforms || []).filter((node) => node.type === 'lut3d');
    if (
      nodes.some(
        (node) =>
          node.domainMin[0] !== 0 ||
          node.domainMin[1] !== 0 ||
          node.domainMin[2] !== 0 ||
          node.domainMax[0] !== 1 ||
          node.domainMax[1] !== 1 ||
          node.domainMax[2] !== 1
      )
    )
      fail(
        codes.invalidTarget,
        'SPI3D controlled output cannot express a non-[0,1] 3D LUT domain.',
        {
          domains: nodes.map((node) => ({
            min: Array.from(node.domainMin),
            max: Array.from(node.domainMax),
          })),
        }
      );
  }
  function writeSpi1d(document) {
    const nodes = document?.transforms || [];
    if (nodes.length !== 1 || nodes[0].type !== 'lut1d')
      fail(codes.unsupportedTarget, 'SPI1D writes exactly one 1D LUT.');
    const node = nodes[0];
    if (!(
      node.domainMin[0] === node.domainMin[1] &&
      node.domainMin[1] === node.domainMin[2] &&
      node.domainMax[0] === node.domainMax[1] &&
      node.domainMax[1] === node.domainMax[2]
    ))
      fail(codes.invalidTarget, 'SPI1D controlled subset requires a scalar range.');
    const lines = [
      'Version 1',
      `From ${format(node.domainMin[0])} ${format(node.domainMax[0])}`,
      `Length ${node.size}`,
      'Components 3',
      '{',
    ];
    for (let i = 0; i < node.values.length; i += 3)
      lines.push(
        `${format(node.values[i])} ${format(node.values[i + 1])} ${format(node.values[i + 2])}`
      );
    lines.push('}');
    return new TextEncoder().encode(`${lines.join('\n')}\n`);
  }
  function writeSpi3d(document) {
    const nodes = document?.transforms || [];
    if (nodes.length !== 1 || nodes[0].type !== 'lut3d')
      fail(codes.unsupportedTarget, 'SPI3D writes exactly one 3D LUT.');
    assertUnitSpi3dDomains(document);
    const node = nodes[0],
      lines = ['SPILUT 1.0', '3 3', `${node.size} ${node.size} ${node.size}`];
    for (let b = 0; b < node.size; b += 1)
      for (let g = 0; g < node.size; g += 1)
        for (let r = 0; r < node.size; r += 1) {
          const at = ((b * node.size + g) * node.size + r) * 3;
          lines.push(
            `${r} ${g} ${b} ${format(node.values[at])} ${format(node.values[at + 1])} ${format(node.values[at + 2])}`
          );
        }
    return new TextEncoder().encode(`${lines.join('\n')}\n`);
  }
  return Object.freeze({
    MAX_BYTES,
    codes,
    SpiIoError,
    parseSpi1dBytes,
    parseSpi3dBytes,
    writeSpi1d,
    writeSpi3d,
    assertUnitSpi3dDomains,
    hash: digest,
  });
});
