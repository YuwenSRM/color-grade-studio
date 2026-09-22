(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformDocument = api;
})(globalThis, function () {
  'use strict';

  const schemaVersion = 2;
  const ordering = 'red-fastest';
  const supportedWorkingColorSpace = 'srgb-sdr';
  const supportedTransformTypes = new Set(['range', 'lut1d', 'matrix', 'lut3d']);
  const knownColorSpaces = new Set(['srgb-sdr', 'display-p3', 'unassigned']);
  const codes = Object.freeze({
    invalidDocument: 'invalid-document',
    invalidSchemaVersion: 'invalid-schema-version',
    invalidSource: 'invalid-source',
    invalidColorContract: 'invalid-color-contract',
    invalidTransform: 'invalid-transform',
    invalidRange: 'invalid-range',
    invalidLut1d: 'invalid-lut1d',
    invalidMatrix: 'invalid-matrix',
    invalidLut3d: 'invalid-lut3d',
    invalidCompatibility: 'invalid-compatibility',
  });

  class ColorTransformError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'ColorTransformError';
      this.code = code;
      this.stage = 'model';
      this.details = Object.freeze({ ...details });
    }
  }

  function fail(code, message, details) {
    throw new ColorTransformError(code, message, details);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNumber(value, label, code, details) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(code, `${label} must be a finite number.`, details);
    }
    return value;
  }

  function finiteVector(value, length, label, code) {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
      fail(code, `${label} must contain ${length} finite numbers.`);
    }
    if (value.length !== length) fail(code, `${label} must contain ${length} finite numbers.`);
    const copy = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      copy[index] = finiteNumber(value[index], `${label}[${index}]`, code, { index });
    }
    return copy;
  }

  function readOptionalVector(value, fallback, label, code) {
    return value === undefined ? Float64Array.from(fallback) : finiteVector(value, 3, label, code);
  }

  function freezeNode(node) {
    // Typed arrays cannot be frozen across all supported Node/browser runtimes. They are copied
    // at model construction and processors snapshot them again before execution.
    return Object.freeze(node);
  }

  function createRange(input = {}) {
    if (!isPlainObject(input)) fail(codes.invalidRange, 'Range must be an object.');
    const minIn = readOptionalVector(input.minIn, [0, 0, 0], 'Range minIn', codes.invalidRange);
    const maxIn = readOptionalVector(input.maxIn, [1, 1, 1], 'Range maxIn', codes.invalidRange);
    const minOut = readOptionalVector(input.minOut, [0, 0, 0], 'Range minOut', codes.invalidRange);
    const maxOut = readOptionalVector(input.maxOut, [1, 1, 1], 'Range maxOut', codes.invalidRange);
    for (let index = 0; index < 3; index += 1) {
      if (minIn[index] >= maxIn[index]) {
        fail(codes.invalidRange, 'Each Range minIn value must be less than maxIn.', { index });
      }
    }
    if (input.clamp !== undefined && typeof input.clamp !== 'boolean') {
      fail(codes.invalidRange, 'Range clamp must be a boolean.');
    }
    return freezeNode({
      type: 'range',
      minIn,
      maxIn,
      minOut,
      maxOut,
      clamp: input.clamp === true,
    });
  }

  function createLut1D(input = {}) {
    if (!isPlainObject(input)) fail(codes.invalidLut1d, 'Lut1D must be an object.');
    const size = input.size;
    if (!Number.isSafeInteger(size) || size < 2 || size > 65536) {
      fail(codes.invalidLut1d, 'Lut1D size must be an integer from 2 through 65536.');
    }
    const domainMin = readOptionalVector(
      input.domainMin,
      [0, 0, 0],
      'Lut1D domainMin',
      codes.invalidLut1d
    );
    const domainMax = readOptionalVector(
      input.domainMax,
      [1, 1, 1],
      'Lut1D domainMax',
      codes.invalidLut1d
    );
    for (let index = 0; index < 3; index += 1) {
      if (domainMin[index] >= domainMax[index]) {
        fail(codes.invalidLut1d, 'Each Lut1D domainMin value must be less than domainMax.', {
          index,
        });
      }
    }
    const values = finiteVector(input.values, size * 3, 'Lut1D values', codes.invalidLut1d);
    return freezeNode({
      type: 'lut1d',
      size,
      domainMin,
      domainMax,
      values,
      interpolation: 'linear',
    });
  }

  function createMatrix(input = {}) {
    if (!isPlainObject(input)) fail(codes.invalidMatrix, 'Matrix must be an object.');
    return freezeNode({
      type: 'matrix',
      matrix: finiteVector(input.matrix, 9, 'Matrix matrix', codes.invalidMatrix),
      offset: readOptionalVector(input.offset, [0, 0, 0], 'Matrix offset', codes.invalidMatrix),
    });
  }

  function createLut3D(input = {}) {
    if (!isPlainObject(input)) fail(codes.invalidLut3d, 'Lut3D must be an object.');
    const size = input.size === undefined ? input.gridSize : input.size;
    if (!Number.isSafeInteger(size) || size < 2 || size > 65) {
      fail(codes.invalidLut3d, 'Lut3D size must be an integer from 2 through 65.');
    }
    if (input.ordering !== undefined && input.ordering !== ordering) {
      fail(codes.invalidLut3d, `Lut3D ordering must be ${ordering}.`);
    }
    const domainMin = readOptionalVector(
      input.domainMin,
      [0, 0, 0],
      'Lut3D domainMin',
      codes.invalidLut3d
    );
    const domainMax = readOptionalVector(
      input.domainMax,
      [1, 1, 1],
      'Lut3D domainMax',
      codes.invalidLut3d
    );
    for (let index = 0; index < 3; index += 1) {
      if (domainMin[index] >= domainMax[index]) {
        fail(codes.invalidLut3d, 'Each Lut3D domainMin value must be less than domainMax.', {
          index,
        });
      }
    }
    return freezeNode({
      type: 'lut3d',
      size,
      domainMin,
      domainMax,
      values: finiteVector(input.values, size ** 3 * 3, 'Lut3D values', codes.invalidLut3d),
      ordering,
      interpolation: 'trilinear',
    });
  }

  function createTransform(input) {
    if (!isPlainObject(input) || !supportedTransformTypes.has(input.type)) {
      fail(codes.invalidTransform, 'Transform type must be Range, Lut1D, Matrix, or Lut3D.');
    }
    if (input.type === 'range') return createRange(input);
    if (input.type === 'lut1d') return createLut1D(input);
    if (input.type === 'matrix') return createMatrix(input);
    return createLut3D(input);
  }

  function createSource(input = {}) {
    if (!isPlainObject(input) || typeof input.format !== 'string' || !input.format) {
      fail(codes.invalidSource, 'source.format is required.');
    }
    const filename = input.filename === undefined ? null : input.filename;
    if (filename !== null && typeof filename !== 'string') {
      fail(codes.invalidSource, 'source.filename must be a string or null.');
    }
    const byteLength = input.byteLength === undefined ? null : input.byteLength;
    if (byteLength !== null && (!Number.isSafeInteger(byteLength) || byteLength < 0)) {
      fail(codes.invalidSource, 'source.byteLength must be a non-negative safe integer or null.');
    }
    const sha256 = input.sha256 === undefined ? null : input.sha256;
    if (sha256 !== null && !/^[a-f0-9]{64}$/i.test(sha256)) {
      fail(codes.invalidSource, 'source.sha256 must be a SHA-256 hex digest or null.');
    }
    return Object.freeze({
      format: input.format,
      dialect: typeof input.dialect === 'string' ? input.dialect : null,
      filename,
      byteLength,
      sha256: sha256 && sha256.toLowerCase(),
      // This is a reference to the authoritative browser Blob/bytes, never a parsed substitute.
      originalBlob: input.originalBlob === undefined ? null : input.originalBlob,
    });
  }

  function colorSpace(value, field) {
    if (typeof value !== 'string' || !knownColorSpaces.has(value)) {
      fail(codes.invalidColorContract, `${field} must be a known color-space identifier.`, {
        field,
        value,
      });
    }
    return value;
  }

  function createColorContract(input = {}) {
    if (!isPlainObject(input)) fail(codes.invalidColorContract, 'colorContract must be an object.');
    const inputColorSpace = colorSpace(input.inputColorSpace || 'unassigned', 'inputColorSpace');
    const outputColorSpace = colorSpace(input.outputColorSpace || 'unassigned', 'outputColorSpace');
    const workingColorSpace = colorSpace(
      input.workingColorSpace || supportedWorkingColorSpace,
      'workingColorSpace'
    );
    return Object.freeze({
      inputColorSpace,
      outputColorSpace,
      workingColorSpace,
      inputRange: createRange(input.inputRange || {}),
      outputRange: createRange(input.outputRange || {}),
    });
  }

  function applicationStatus(colorContract, photoColorSpace) {
    if (!photoColorSpace || photoColorSpace === 'unassigned') {
      return Object.freeze({
        status: 'requires-photo-color-space',
        code: 'photo-color-space-unassigned',
      });
    }
    if (
      colorContract.inputColorSpace === 'unassigned' ||
      colorContract.outputColorSpace === 'unassigned'
    ) {
      return Object.freeze({
        status: 'requires-color-space-assignment',
        code: 'lut-color-space-unassigned',
      });
    }
    if (
      photoColorSpace !== supportedWorkingColorSpace ||
      colorContract.inputColorSpace !== supportedWorkingColorSpace ||
      colorContract.outputColorSpace !== supportedWorkingColorSpace ||
      colorContract.workingColorSpace !== supportedWorkingColorSpace
    ) {
      return Object.freeze({ status: 'unsupported-color-space', code: 'sdr-srgb-only' });
    }
    return Object.freeze({ status: 'applicable', code: null });
  }

  function conversionTargets(input) {
    if (input === undefined) return Object.freeze({});
    if (!isPlainObject(input))
      fail(codes.invalidCompatibility, 'conversionTargets must be an object.');
    const result = {};
    for (const [target, state] of Object.entries(input)) {
      if (!isPlainObject(state) || typeof state.status !== 'string') {
        fail(codes.invalidCompatibility, 'Each conversion target must have a status.', { target });
      }
      result[target] = Object.freeze({
        status: state.status,
        code: state.code === undefined ? null : state.code,
        loss: state.loss === undefined ? null : state.loss,
      });
    }
    return Object.freeze(result);
  }

  function createCompatibility(colorContract, input = {}) {
    if (!isPlainObject(input)) fail(codes.invalidCompatibility, 'compatibility must be an object.');
    const parseStatus = input.parseStatus || 'parsed';
    if (parseStatus !== 'parsed' && parseStatus !== 'rejected') {
      fail(codes.invalidCompatibility, 'parseStatus must be parsed or rejected.');
    }
    return Object.freeze({
      parseStatus,
      application: applicationStatus(colorContract, input.photoColorSpace || null),
      conversionTargets: conversionTargets(input.conversionTargets),
    });
  }

  function createColorTransformDocument(input = {}) {
    if (!isPlainObject(input))
      fail(codes.invalidDocument, 'ColorTransformDocument must be an object.');
    const version = input.schemaVersion === undefined ? schemaVersion : input.schemaVersion;
    if (version !== schemaVersion) {
      fail(codes.invalidSchemaVersion, `schemaVersion must be ${schemaVersion}.`, { version });
    }
    if (!Array.isArray(input.transforms)) {
      fail(codes.invalidDocument, 'transforms must be an ordered array.');
    }
    const colorContract = createColorContract(input.colorContract || {});
    const metadata = isPlainObject(input.metadata) ? { ...input.metadata } : {};
    return Object.freeze({
      schemaVersion,
      source: createSource(input.source),
      colorContract,
      transforms: Object.freeze(input.transforms.map(createTransform)),
      metadata: Object.freeze(metadata),
      compatibility: createCompatibility(colorContract, input.compatibility || {}),
    });
  }

  function withApplicationAssessment(document, photoColorSpace) {
    if (!document || document.schemaVersion !== schemaVersion) {
      fail(codes.invalidDocument, 'A v2 ColorTransformDocument is required.');
    }
    return Object.freeze({
      ...document,
      compatibility: Object.freeze({
        ...document.compatibility,
        application: applicationStatus(document.colorContract, photoColorSpace),
      }),
    });
  }

  return Object.freeze({
    schemaVersion,
    ordering,
    supportedWorkingColorSpace,
    codes,
    ColorTransformError,
    createRange,
    createLut1D,
    createMatrix,
    createLut3D,
    createTransform,
    createColorTransformDocument,
    withApplicationAssessment,
  });
});
