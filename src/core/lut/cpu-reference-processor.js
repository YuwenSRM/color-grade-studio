(function (root, factory) {
  const model =
    typeof module === 'object' && module.exports
      ? require('../color/transform-document.js')
      : root.ColorTransformDocument;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformCpu = api;
})(globalThis, function (model) {
  'use strict';

  if (!model) throw new Error('ColorTransformDocument must be loaded before ColorTransformCpu.');

  const contract = Object.freeze({
    version: 2,
    precision: 'float64',
    interpolation: Object.freeze({ lut1d: 'linear', lut3d: 'trilinear' }),
    ordering: model.ordering,
    outOfDomain: Object.freeze({
      range: 'preserve-unless-clamp-true',
      lut1d: 'clamp-to-edge',
      lut3d: 'clamp-to-edge',
    }),
    alpha: 'preserve-exactly',
    strength: Object.freeze({ range: [0, 1], application: 'mix-original-with-final-sequence' }),
    quantization: 'caller-boundary-only',
    invalidInput: 'throw-structured-error',
  });

  const codes = Object.freeze({
    invalidDocument: 'invalid-document',
    invalidRgb: 'invalid-rgb',
    invalidRgba: 'invalid-rgba',
    invalidPixelBuffer: 'invalid-pixel-buffer',
    invalidIntensity: 'invalid-intensity',
    cancelled: 'operation-aborted',
    memoryBudgetExceeded: 'memory-budget-exceeded',
  });

  class ColorTransformProcessorError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'ColorTransformProcessorError';
      this.code = code;
      this.stage = 'processor';
      this.details = Object.freeze({ ...details });
    }
  }

  function fail(code, message, details) {
    throw new ColorTransformProcessorError(code, message, details);
  }

  function finiteVector(value, length, label, code) {
    if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== length) {
      fail(code, `${label} must contain exactly ${length} finite numbers.`);
    }
    const result = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      if (typeof value[index] !== 'number' || !Number.isFinite(value[index])) {
        fail(code, `${label} must contain exactly ${length} finite numbers.`, { index });
      }
      result[index] = value[index];
    }
    return result;
  }

  function prepareDocument(document) {
    if (
      !document ||
      document.schemaVersion !== model.schemaVersion ||
      !Array.isArray(document.transforms)
    ) {
      fail(codes.invalidDocument, 'A valid v2 ColorTransformDocument is required.');
    }
    // Snapshots sever execution from all mutable typed-array references in the document.
    return document.transforms.map((transform) => {
      if (transform.type === 'range') {
        return {
          ...transform,
          minIn: Float64Array.from(transform.minIn),
          maxIn: Float64Array.from(transform.maxIn),
          minOut: Float64Array.from(transform.minOut),
          maxOut: Float64Array.from(transform.maxOut),
        };
      }
      if (transform.type === 'lut1d' || transform.type === 'lut3d') {
        return {
          ...transform,
          domainMin: Float64Array.from(transform.domainMin),
          domainMax: Float64Array.from(transform.domainMax),
          values: Float64Array.from(transform.values),
        };
      }
      return {
        ...transform,
        matrix: Float64Array.from(transform.matrix),
        offset: Float64Array.from(transform.offset),
      };
    });
  }

  function clamp(value, minimum, maximum) {
    return value <= minimum ? minimum : value >= maximum ? maximum : value;
  }

  function position(value, minimum, maximum, size) {
    const normalized = (clamp(value, minimum, maximum) - minimum) / (maximum - minimum);
    return normalized * (size - 1);
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function applyRange(transform, value, output) {
    for (let channel = 0; channel < 3; channel += 1) {
      const input = transform.clamp
        ? clamp(value[channel], transform.minIn[channel], transform.maxIn[channel])
        : value[channel];
      output[channel] =
        transform.minOut[channel] +
        ((input - transform.minIn[channel]) /
          (transform.maxIn[channel] - transform.minIn[channel])) *
          (transform.maxOut[channel] - transform.minOut[channel]);
    }
  }

  function applyLut1D(transform, value, output) {
    for (let channel = 0; channel < 3; channel += 1) {
      const coordinate = position(
        value[channel],
        transform.domainMin[channel],
        transform.domainMax[channel],
        transform.size
      );
      const lower = Math.floor(coordinate);
      const upper = Math.min(lower + 1, transform.size - 1);
      output[channel] = lerp(
        transform.values[lower * 3 + channel],
        transform.values[upper * 3 + channel],
        coordinate - lower
      );
    }
  }

  function applyMatrix(transform, value, output) {
    for (let row = 0; row < 3; row += 1) {
      const offset = row * 3;
      output[row] =
        transform.matrix[offset] * value[0] +
        transform.matrix[offset + 1] * value[1] +
        transform.matrix[offset + 2] * value[2] +
        transform.offset[row];
    }
  }

  function applyLut3D(transform, value, output) {
    const size = transform.size;
    const redPosition = position(value[0], transform.domainMin[0], transform.domainMax[0], size);
    const greenPosition = position(value[1], transform.domainMin[1], transform.domainMax[1], size);
    const bluePosition = position(value[2], transform.domainMin[2], transform.domainMax[2], size);
    const red0 = Math.floor(redPosition);
    const green0 = Math.floor(greenPosition);
    const blue0 = Math.floor(bluePosition);
    const red1 = Math.min(red0 + 1, size - 1);
    const green1 = Math.min(green0 + 1, size - 1);
    const blue1 = Math.min(blue0 + 1, size - 1);
    const redMix = redPosition - red0;
    const greenMix = greenPosition - green0;
    const blueMix = bluePosition - blue0;
    const index = (red, green, blue, channel) => ((blue * size + green) * size + red) * 3 + channel;

    for (let channel = 0; channel < 3; channel += 1) {
      const lowerBlue = lerp(
        lerp(
          lerp(
            transform.values[index(red0, green0, blue0, channel)],
            transform.values[index(red1, green0, blue0, channel)],
            redMix
          ),
          lerp(
            transform.values[index(red0, green1, blue0, channel)],
            transform.values[index(red1, green1, blue0, channel)],
            redMix
          ),
          greenMix
        ),
        lerp(
          lerp(
            transform.values[index(red0, green0, blue1, channel)],
            transform.values[index(red1, green0, blue1, channel)],
            redMix
          ),
          lerp(
            transform.values[index(red0, green1, blue1, channel)],
            transform.values[index(red1, green1, blue1, channel)],
            redMix
          ),
          greenMix
        ),
        blueMix
      );
      output[channel] = lowerBlue;
    }
  }

  function applyTransform(transform, input, output) {
    if (transform.type === 'range') applyRange(transform, input, output);
    else if (transform.type === 'lut1d') applyLut1D(transform, input, output);
    else if (transform.type === 'matrix') applyMatrix(transform, input, output);
    else applyLut3D(transform, input, output);
  }

  function intensityFrom(options) {
    const intensity = options.intensity === undefined ? 1 : options.intensity;
    if (
      typeof intensity !== 'number' ||
      !Number.isFinite(intensity) ||
      intensity < 0 ||
      intensity > 1
    ) {
      fail(codes.invalidIntensity, 'intensity must be a finite number from 0 through 1.');
    }
    return intensity;
  }

  function createProcessor(document) {
    const transforms = prepareDocument(document);
    return Object.freeze({
      contract,
      applyRgb(rgb, options = {}) {
        const original = finiteVector(rgb, 3, 'rgb', codes.invalidRgb);
        const intensity = intensityFrom(options);
        let current = original;
        let scratch = new Float64Array(3);
        for (const transform of transforms) {
          applyTransform(transform, current, scratch);
          const previous = current;
          current = scratch;
          scratch = previous === original ? new Float64Array(3) : previous;
        }
        if (intensity === 1) return Float64Array.from(current);
        const output = new Float64Array(3);
        for (let channel = 0; channel < 3; channel += 1) {
          output[channel] = original[channel] + (current[channel] - original[channel]) * intensity;
        }
        return output;
      },
      applyRgba(rgba, options = {}) {
        const input = finiteVector(rgba, 4, 'rgba', codes.invalidRgba);
        const rgb = this.applyRgb(input.subarray(0, 3), options);
        return Float64Array.of(rgb[0], rgb[1], rgb[2], input[3]);
      },
      applyPixels(pixels, options = {}) {
        if (!(pixels instanceof Float64Array) || pixels.length % 4 !== 0) {
          fail(
            codes.invalidPixelBuffer,
            'pixels must be a Float64Array whose length is divisible by four.'
          );
        }
        const budget =
          options.memoryBudgetBytes === undefined ? Infinity : options.memoryBudgetBytes;
        if (!Number.isSafeInteger(budget) && budget !== Infinity) {
          fail(codes.memoryBudgetExceeded, 'memoryBudgetBytes must be a safe integer or Infinity.');
        }
        if (pixels.byteLength > budget) {
          fail(codes.memoryBudgetExceeded, 'Pixel buffer exceeds memoryBudgetBytes.', {
            byteLength: pixels.byteLength,
            budget,
          });
        }
        const output = new Float64Array(pixels.length);
        const total = pixels.length / 4;
        for (let pixel = 0; pixel < total; pixel += 1) {
          if (options.signal?.aborted)
            fail(codes.cancelled, 'The color transform operation was cancelled.', { pixel, total });
          const offset = pixel * 4;
          const rgba = this.applyRgba(pixels.subarray(offset, offset + 4), options);
          output.set(rgba, offset);
          if (
            typeof options.onProgress === 'function' &&
            (pixel === total - 1 || pixel % 256 === 255)
          ) {
            options.onProgress({ completed: pixel + 1, total });
          }
        }
        return output;
      },
    });
  }

  return Object.freeze({ contract, codes, ColorTransformProcessorError, createProcessor });
});
