(function (root, factory) {
  const model =
    typeof module === 'object' && module.exports
      ? require('../color/transform-document.js')
      : root.ColorTransformDocument;
  const cpu =
    typeof module === 'object' && module.exports
      ? require('../lut/cpu-reference-processor.js')
      : root.ColorTransformCpu;
  const contracts =
    typeof module === 'object' && module.exports
      ? require('./contracts.js')
      : root.ColorTransformConversionContracts;
  const cube =
    typeof module === 'object' && module.exports
      ? require('../lut/cube-io.js')
      : root.ColorTransformCubeIo;
  const hald =
    typeof module === 'object' && module.exports
      ? require('../lut/hald-png.js')
      : root.ColorTransformHaldPng;
  const api = factory(model, cpu, contracts, cube, hald);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformBaker = api;
})(globalThis, function (model, cpu, contracts, cube, hald) {
  'use strict';

  const gridSizes = Object.freeze([17, 33, 65]);
  const codes = Object.freeze({
    invalidGrid: 'invalid-target-grid',
    invalidSource: 'invalid-conversion-source',
    unsupportedParameter: 'unsupported-parameter-filter',
    excludedNode: 'excluded-non-pixel-node',
    readbackFailed: 'conversion-readback-failed',
    errorThresholdExceeded: 'conversion-error-threshold-exceeded',
  });
  class BakerError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'BakerError';
      this.code = code;
      this.stage = 'baker';
      this.details = Object.freeze({ ...details });
    }
  }
  function fail(code, message, details) {
    throw new BakerError(code, message, details);
  }
  function isSame3d(document, size) {
    return (
      document.transforms.length === 1 &&
      document.transforms[0].type === 'lut3d' &&
      document.transforms[0].size === size
    );
  }
  function hash(bytes) {
    return cube.hash(bytes);
  }
  function samples(document, candidate, side = 7) {
    const source = cpu.createProcessor(document),
      target = cpu.createProcessor(candidate);
    let maximum = 0,
      sum = 0,
      count = 0,
      values = [];
    for (let b = 0; b < side; b += 1)
      for (let g = 0; g < side; g += 1)
        for (let r = 0; r < side; r += 1) {
          const rgb = [r / (side - 1), g / (side - 1), b / (side - 1)],
            one = source.applyRgb(rgb),
            two = target.applyRgb(rgb);
          for (let c = 0; c < 3; c += 1) {
            const error = Math.abs(one[c] - two[c]);
            maximum = Math.max(maximum, error);
            sum += error;
            values.push(error);
            count += 1;
          }
        }
    values.sort((a, b) => a - b);
    return Object.freeze({
      probeGrid: side,
      maximum,
      mean: sum / count,
      p99: values[Math.min(values.length - 1, Math.ceil(values.length * 0.99) - 1)],
      deltaE: null,
    });
  }
  function lossFor(document, size) {
    if (
      document.source?.format === 'real-landscape-filter-json' ||
      document.metadata?.pipelineBake === true
    )
      return 'pipeline-bake';
    return isSame3d(document, size)
      ? 'format-rewrite'
      : document.transforms.length === 1 && document.transforms[0].type === 'lut3d'
        ? 'grid-resample'
        : 'pipeline-bake';
  }
  function bakeToLut3D(document, options = {}) {
    const size = options.size || 33;
    if (!gridSizes.includes(size))
      fail(codes.invalidGrid, 'Baked CUBE grids are restricted to 17, 33, and 65.', { size });
    if (!document || document.schemaVersion !== model.schemaVersion)
      fail(codes.invalidSource, 'A v2 transform document is required.');
    const bytes = size ** 3 * 3 * Float64Array.BYTES_PER_ELEMENT;
    const guard = contracts.createTaskGuard({
      signal: options.signal,
      onProgress: options.onProgress,
      memoryBudgetBytes: options.memoryBudgetBytes,
    });
    guard.reserve(bytes);
    const values = new Float64Array(size ** 3 * 3),
      processor = cpu.createProcessor(document);
    let complete = 0,
      at = 0;
    for (let b = 0; b < size; b += 1) {
      for (let g = 0; g < size; g += 1)
        for (let r = 0; r < size; r += 1) {
          guard.checkpoint(complete, size ** 3);
          const value = processor.applyRgb([r / (size - 1), g / (size - 1), b / (size - 1)]);
          values[at++] = value[0];
          values[at++] = value[1];
          values[at++] = value[2];
          complete += 1;
        }
      guard.checkpoint(complete, size ** 3);
    }
    const excludedNodes = Object.freeze([...(document.metadata?.excludedNodes || [])]);
    const baked = model.createColorTransformDocument({
      source: {
        format: 'baked-lut3d',
        dialect: 'studio-v2',
        filename: null,
        byteLength: null,
        sha256: null,
      },
      colorContract: document.colorContract,
      transforms: [{ type: 'lut3d', size, values, ordering: 'red-fastest' }],
      metadata: { bakedFrom: document.source.sha256, excludedNodes },
      compatibility: {
        photoColorSpace:
          document.compatibility.application.status === 'applicable' ? 'srgb-sdr' : null,
      },
    });
    return Object.freeze({
      document: baked,
      loss: lossFor(document, size),
      excludedNodes,
      estimatedBytes: bytes,
      metrics: samples(document, baked),
    });
  }
  function report({
    source,
    target,
    sourceFormat,
    targetFormat,
    sourceDialect,
    targetDialect,
    grid,
    colorContract,
    loss,
    metrics,
    excludedNodes,
    options,
  }) {
    const bitDepth = target.bitDepth || 'float-text';
    return Object.freeze({
      schemaVersion: 1,
      engineVersion: 'studio-v2-p3-2',
      source: {
        sha256: source.source.sha256,
        format: sourceFormat,
        dialect: sourceDialect,
        grid: source.transforms
          .filter((node) => node.type === 'lut1d' || node.type === 'lut3d')
          .map((node) => ({ type: node.type, size: node.size })),
      },
      target: {
        sha256: target.sha256,
        format: targetFormat,
        dialect: targetDialect,
        grid,
        bitDepth,
      },
      colorContract: {
        inputColorSpace: colorContract.inputColorSpace,
        outputColorSpace: colorContract.outputColorSpace,
        workingColorSpace: colorContract.workingColorSpace,
      },
      loss,
      interpolation: 'trilinear',
      bitDepth,
      metrics,
      excludedNodes: Object.freeze([...excludedNodes]),
      options: Object.freeze({ ...options }),
      reversible: false,
    });
  }
  function convertToCube(document, options = {}) {
    const size = options.size || 33,
      baked = bakeToLut3D(document, { ...options, size }),
      bytes = cube.writeCube(baked.document, {
        dialect: options.dialect || 'iridas',
        title: options.title,
      });
    let reread;
    try {
      reread = cube.parseCubeBytes(bytes, { colorContract: document.colorContract });
    } catch (error) {
      throw new BakerError(codes.readbackFailed, 'Written CUBE failed its mandatory readback.', {
        cause: error.code || error.message,
      });
    }
    const output = { bytes, sha256: hash(bytes), bitDepth: 'float-text' };
    const result = Object.freeze({
      bytes,
      document: reread,
      report: report({
        source: document,
        target: output,
        sourceFormat: document.source.format,
        targetFormat: 'cube',
        sourceDialect: document.source.dialect,
        targetDialect: options.dialect || 'iridas',
        grid: size,
        colorContract: document.colorContract,
        loss: baked.loss,
        metrics: samples(document, reread),
        excludedNodes: baked.excludedNodes,
        options: { size, dialect: options.dialect || 'iridas' },
      }),
    });
    return result;
  }
  function convertToHald(document, options = {}) {
    const level = options.level || 8,
      size = level ** 2,
      baked = bakeToLut3D(document, { ...options, size: gridSizes.includes(size) ? size : 65 });
    const encoded = hald.writeHaldPng(baked.document, { level, signal: options.signal });
    let reread;
    try {
      reread = hald.parseHaldPng(encoded.bytes, { colorContract: document.colorContract });
    } catch (error) {
      throw new BakerError(
        codes.readbackFailed,
        'Written Hald PNG failed its mandatory readback.',
        { cause: error.code || error.message }
      );
    }
    const metrics = samples(document, reread);
    if (metrics.maximum > 1 / 255) {
      throw new BakerError(
        codes.errorThresholdExceeded,
        'Hald RGBA8 quantization or clipping exceeds the P3-2 error threshold; no target was produced.',
        { maximum: metrics.maximum, threshold: 1 / 255 }
      );
    }
    const output = { bytes: encoded.bytes, sha256: hash(encoded.bytes), bitDepth: 8 };
    return Object.freeze({
      bytes: encoded.bytes,
      document: reread,
      report: report({
        source: document,
        target: output,
        sourceFormat: document.source.format,
        targetFormat: 'hald-png',
        sourceDialect: document.source.dialect,
        targetDialect: 'standard-hald',
        grid: reread.transforms[0].size,
        colorContract: document.colorContract,
        loss: 'pipeline-bake',
        metrics,
        excludedNodes: baked.excludedNodes,
        options: { level, bitDepth: 8 },
      }),
    });
  }
  function parameterDocument(input, options = {}) {
    let parsed;
    try {
      parsed = typeof input === 'string' ? JSON.parse(input) : input;
    } catch (_) {
      fail(codes.unsupportedParameter, 'Parameter JSON is not valid.');
    }
    const p = parsed?.parameters;
    if (
      parsed?.format !== 'real-landscape-filter' ||
      parsed?.version !== 1 ||
      parsed?.kind !== 'parameters' ||
      !p ||
      !['b', 'c', 's', 'w', 't'].every((key) => Number.isFinite(p[key]))
    )
      fail(
        codes.unsupportedParameter,
        'Only Real Landscape parameter filter JSON v1 is supported.'
      );
    const bounds = { b: [0.5, 1.5], c: [0, 1.5], s: [0, 1.5], w: [0.5, 1.5], t: [-60, 60] };
    for (const [key, range] of Object.entries(bounds))
      if (p[key] < range[0] || p[key] > range[1])
        fail(codes.unsupportedParameter, 'Parameter JSON has an out-of-range value.', {
          key,
          value: p[key],
        });
    const hue = (p.t * Math.PI) / 180,
      u = Math.cos(hue),
      v = Math.sin(hue);
    const matrix = [
      0.213 + 0.787 * u - 0.213 * v,
      0.715 - 0.715 * u - 0.715 * v,
      0.072 - 0.072 * u + 0.928 * v,
      0.213 - 0.213 * u + 0.143 * v,
      0.715 + 0.285 * u + 0.14 * v,
      0.072 - 0.072 * u - 0.283 * v,
      0.213 - 0.213 * u - 0.787 * v,
      0.715 - 0.715 * u + 0.715 * v,
      0.072 + 0.928 * u + 0.072 * v,
    ];
    // The legacy parameter basis is pointwise. This Float64 representation deliberately omits editor settings and spatial effects.
    const values = new Float64Array(2 ** 3 * 3);
    let at = 0;
    for (let b = 0; b < 2; b += 1)
      for (let g = 0; g < 2; g += 1)
        for (let r = 0; r < 2; r += 1) {
          let x = r + (p.b - 1) + ((p.w - 1) * 52) / 255,
            y = g + (p.b - 1),
            z = b + (p.b - 1) - ((p.w - 1) * 52 * 0.62) / 255;
          let lum = (x + y + z) / 3;
          x = lum + (x - lum) * p.c;
          y = lum + (y - lum) * p.c;
          z = lum + (z - lum) * p.c;
          const xr = matrix[0] * x + matrix[1] * y + matrix[2] * z,
            yg = matrix[3] * x + matrix[4] * y + matrix[5] * z,
            zb = matrix[6] * x + matrix[7] * y + matrix[8] * z;
          lum = (xr + yg + zb) / 3;
          values[at++] = lum + (xr - lum) * p.s;
          values[at++] = lum + (yg - lum) * p.s;
          values[at++] = lum + (zb - lum) * p.s;
        }
    return model.createColorTransformDocument({
      source: {
        format: 'real-landscape-filter-json',
        dialect: 'v1',
        filename: options.filename || null,
        byteLength: typeof input === 'string' ? new TextEncoder().encode(input).byteLength : null,
        sha256: typeof input === 'string' ? hash(new TextEncoder().encode(input)) : null,
      },
      colorContract: {
        inputColorSpace:
          parsed.metadata?.inputColorSpace === 'sRGB SDR' ? 'srgb-sdr' : 'unassigned',
        outputColorSpace:
          parsed.metadata?.outputColorSpace === 'sRGB SDR' ? 'srgb-sdr' : 'unassigned',
      },
      transforms: [{ type: 'lut3d', size: 2, values }],
      metadata: {
        parameterFilter: { version: 1, parameters: { ...p } },
        excludedNodes: [
          'editor-delta',
          'crop',
          'sharpen',
          'denoise',
          'vignette',
          'grain',
          'masks',
          'local-adjustments',
        ],
      },
      compatibility: {},
    });
  }
  return Object.freeze({
    gridSizes,
    codes,
    BakerError,
    bakeToLut3D,
    convertToCube,
    convertToHald,
    parameterDocument,
    samples,
  });
});
