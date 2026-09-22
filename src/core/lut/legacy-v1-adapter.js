(function (root, factory) {
  const model =
    typeof module === 'object' && module.exports
      ? require('../color/transform-document.js')
      : root.ColorTransformDocument;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformLegacyV1Adapter = api;
})(globalThis, function (model) {
  'use strict';

  const legacyRenderEngineVersion = 'legacy-v1';
  const codes = Object.freeze({ invalidLegacyLut: 'invalid-legacy-v1-lut' });

  class LegacyV1AdapterError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'LegacyV1AdapterError';
      this.code = codes.invalidLegacyLut;
      this.stage = 'adapter';
      this.details = Object.freeze({ ...details });
    }
  }

  function toColorTransformDocument(lut, source = {}) {
    if (!lut || typeof lut !== 'object')
      throw new LegacyV1AdapterError('A parsed legacy-v1 LUT is required.');
    const size = lut.gridSize;
    if (!Number.isSafeInteger(size) || !lut.values || !lut.domainMin || !lut.domainMax) {
      throw new LegacyV1AdapterError('The legacy-v1 LUT is incomplete.');
    }
    return model.createColorTransformDocument({
      source: {
        format: source.format || 'cube',
        dialect: source.dialect || 'legacy-v1-iridas-3d',
        filename: source.filename || null,
        byteLength: source.byteLength === undefined ? null : source.byteLength,
        sha256: source.sha256 || lut.sha256 || null,
        originalBlob: source.originalBlob,
      },
      colorContract: {
        inputColorSpace: 'srgb-sdr',
        outputColorSpace: 'srgb-sdr',
        workingColorSpace: 'srgb-sdr',
      },
      transforms: [
        {
          type: 'lut3d',
          size,
          domainMin: lut.domainMin,
          domainMax: lut.domainMax,
          values: lut.values,
          ordering: lut.ordering,
        },
      ],
      metadata: { renderEngineVersion: legacyRenderEngineVersion, legacyTitle: lut.title || null },
      compatibility: {
        photoColorSpace: 'srgb-sdr',
        conversionTargets: {},
      },
    });
  }

  function renderEngineVersion(record) {
    return record?.renderEngineVersion || legacyRenderEngineVersion;
  }

  return Object.freeze({
    legacyRenderEngineVersion,
    codes,
    LegacyV1AdapterError,
    toColorTransformDocument,
    renderEngineVersion,
  });
});
