(function (root, factory) {
  const baker =
    typeof module === 'object' && module.exports ? require('./baker.js') : root.ColorTransformBaker;
  const spi =
    typeof module === 'object' && module.exports
      ? require('../lut/spi-io.js')
      : root.ColorTransformSpiIo;
  const csp =
    typeof module === 'object' && module.exports
      ? require('../lut/csp-io.js')
      : root.ColorTransformCspIo;
  const lustre =
    typeof module === 'object' && module.exports
      ? require('../lut/lustre-3dl-io.js')
      : root.ColorTransformLustre3dlIo;
  const api = factory(baker, spi, csp, lustre);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformExtendedLutConversion = api;
})(globalThis, function (baker, spi, csp, lustre) {
  'use strict';
  const codes = Object.freeze({
    invalidTarget: 'invalid-extended-lut-target',
    readbackFailed: 'extended-conversion-readback-failed',
  });
  class ExtendedConversionError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'ExtendedConversionError';
      this.code = code;
      this.stage = 'extended-lut-conversion';
      this.details = Object.freeze({ ...details });
    }
  }
  function fail(code, message, details) {
    throw new ExtendedConversionError(code, message, details);
  }
  function scalarRange(node) {
    return { min: Array.from(node.domainMin || []), max: Array.from(node.domainMax || []) };
  }
  function report(source, bytes, result, targetFormat, targetDialect, bitDepth, loss, options) {
    const nodes = result.transforms.filter(
      (node) => node.type === 'lut1d' || node.type === 'lut3d'
    );
    return Object.freeze({
      schemaVersion: 1,
      engineVersion: 'studio-v2-p3-4',
      source: {
        sha256: source.source.sha256,
        format: source.source.format,
        dialect: source.source.dialect,
        transforms: source.transforms.map((node) => ({
          type: node.type,
          size: node.size || null,
          range: scalarRange(node),
        })),
      },
      target: {
        sha256: (targetFormat === 'spi1d' || targetFormat === 'spi3d'
          ? spi
          : targetFormat === 'csp'
            ? csp
            : lustre
        ).hash(bytes),
        format: targetFormat,
        dialect: targetDialect,
        grid: nodes.map((node) => ({ type: node.type, size: node.size })),
        ranges: nodes.map(scalarRange),
        bitDepth,
      },
      colorContract: {
        inputColorSpace: source.colorContract.inputColorSpace,
        outputColorSpace: source.colorContract.outputColorSpace,
        workingColorSpace: source.colorContract.workingColorSpace,
      },
      loss,
      interpolation: 'trilinear',
      bitDepth,
      metrics: baker.samples(source, result),
      excludedNodes: Object.freeze([...(source.metadata?.excludedNodes || [])]),
      options: Object.freeze({ ...options }),
      reversible: false,
    });
  }
  function make3d(source, size, options) {
    return baker.bakeToLut3D(source, { ...options, size });
  }
  function convertToSpi1d(document) {
    if (document.transforms.length !== 1 || document.transforms[0].type !== 'lut1d')
      fail(
        codes.invalidTarget,
        'SPI1D cannot express a transform sequence; use an explicit 3D pipeline bake target.'
      );
    const bytes = spi.writeSpi1d(document);
    let reread;
    try {
      reread = spi.parseSpi1dBytes(bytes, { colorContract: document.colorContract });
    } catch (error) {
      fail(codes.readbackFailed, 'SPI1D readback failed.', { cause: error.code || error.message });
    }
    return Object.freeze({
      bytes,
      document: reread,
      report: report(
        document,
        bytes,
        reread,
        'spi1d',
        'sony-spi1d-v1',
        'float-text',
        'format-rewrite',
        {}
      ),
    });
  }
  function convertToSpi3d(document, options = {}) {
    spi.assertUnitSpi3dDomains(document);
    const baked = make3d(document, options.size || 33, options),
      bytes = spi.writeSpi3d(baked.document);
    let reread;
    try {
      reread = spi.parseSpi3dBytes(bytes, { colorContract: document.colorContract });
    } catch (error) {
      fail(codes.readbackFailed, 'SPI3D readback failed.', { cause: error.code || error.message });
    }
    return Object.freeze({
      bytes,
      document: reread,
      report: report(document, bytes, reread, 'spi3d', 'sony-spi3d-v1', 'float-text', baked.loss, {
        size: baked.document.transforms[0].size,
      }),
    });
  }
  function convertToCsp(document, options = {}) {
    const baked = make3d(document, options.size || 33, options),
      bytes = csp.writeCsp(baked.document);
    let reread;
    try {
      reread = csp.parseCspBytes(bytes, { colorContract: document.colorContract });
    } catch (error) {
      fail(codes.readbackFailed, 'CSP readback failed.', { cause: error.code || error.message });
    }
    return Object.freeze({
      bytes,
      document: reread,
      report: report(
        document,
        bytes,
        reread,
        'csp',
        'cinespace-csplutv100',
        'float-text',
        baked.loss,
        {
          size: baked.document.transforms[0].size,
          shaperBaked: document.transforms.some((node) => node.type === 'lut1d'),
        }
      ),
    });
  }
  function convertToLustre3dl(document, options = {}) {
    const baked = make3d(document, 33, options),
      bytes = lustre.writeLustre3dl(baked.document);
    let reread;
    try {
      reread = lustre.parseLustre3dlBytes(bytes, { colorContract: document.colorContract });
    } catch (error) {
      fail(codes.readbackFailed, 'Lustre 3DL readback failed.', {
        cause: error.code || error.message,
      });
    }
    return Object.freeze({
      bytes,
      document: reread,
      report: report(
        document,
        bytes,
        reread,
        '3dl',
        'lustre-mesh-5-12-33-no-shaper',
        12,
        baked.loss === 'format-rewrite' ? 'pipeline-bake' : baked.loss,
        {
          size: 33,
          inputBitDepth: 5,
          outputBitDepth: 12,
          shaperBaked: document.transforms.some((node) => node.type === 'lut1d'),
        }
      ),
    });
  }
  return Object.freeze({
    codes,
    ExtendedConversionError,
    convertToSpi1d,
    convertToSpi3d,
    convertToCsp,
    convertToLustre3dl,
  });
});
