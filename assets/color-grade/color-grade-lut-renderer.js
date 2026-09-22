(function (root, factory) {
  const renderer = factory();
  if (typeof module === 'object' && module.exports) module.exports = renderer;
  else root.ColorGradeLutRenderer = renderer;
})(globalThis, function () {
  'use strict';

  const contract = Object.freeze({
    version: 1,
    interpolation: 'trilinear',
    ordering: 'red-fastest',
    inputEncoding: 'normalized-srgb',
    outputEncoding: 'normalized-srgb',
    outOfDomain: 'clamp-to-edge',
    pixelFormat: 'rgba8-uint8-clamped',
    pixelMutation: 'in-place',
    alpha: 'preserve',
    intensityRange: Object.freeze([0, 1]),
    intensitySpace: 'encoded-srgb',
    byteConversion: 'ecmascript-to-uint8-clamp',
    invalidInput: 'throw',
  });

  function isArrayLike(value) {
    return Array.isArray(value) || ArrayBuffer.isView(value);
  }

  function validateTriplet(value, name) {
    if (!isArrayLike(value) || value.length !== 3) {
      throw new TypeError(`${name} must contain exactly three numbers.`);
    }
    const result = Array.from(value);
    if (!result.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      throw new TypeError(`${name} must contain finite numbers.`);
    }
    return result;
  }

  function prepareLut(lut) {
    if (!lut || typeof lut !== 'object') throw new TypeError('A parsed 3D LUT is required.');
    const size = lut.gridSize;
    if (!Number.isSafeInteger(size) || size < 2 || size > 65) {
      throw new RangeError('The LUT grid size must be an integer from 2 through 65.');
    }
    if (lut.ordering !== contract.ordering) {
      throw new RangeError(`The LUT ordering must be ${contract.ordering}.`);
    }

    const domainMin = validateTriplet(lut.domainMin, 'domainMin');
    const domainMax = validateTriplet(lut.domainMax, 'domainMax');
    for (let channel = 0; channel < 3; channel += 1) {
      if (domainMin[channel] >= domainMax[channel]) {
        throw new RangeError('Every domainMin channel must be less than domainMax.');
      }
      if (domainMin[channel] < 0 || domainMax[channel] > 1) {
        throw new RangeError('LUT domains must contain normalized SDR numbers.');
      }
    }

    const values = lut.values;
    if (!isArrayLike(values) || values.length !== size ** 3 * 3) {
      throw new RangeError('The LUT value count does not match its grid size.');
    }
    for (let index = 0; index < values.length; index += 1) {
      if (
        typeof values[index] !== 'number' ||
        !Number.isFinite(values[index]) ||
        values[index] < 0 ||
        values[index] > 1
      ) {
        throw new RangeError('LUT values must be finite normalized SDR numbers.');
      }
    }
    const valueSnapshot = Float64Array.from(values);

    return Object.freeze({
      size,
      values: valueSnapshot,
      domainMin,
      domainMax,
      greenStride: size * 3,
      blueStride: size * size * 3,
    });
  }

  function gridPosition(value, minimum, maximum, gridMaximum) {
    if (value <= minimum) return 0;
    if (value >= maximum) return gridMaximum;
    return ((value - minimum) / (maximum - minimum)) * gridMaximum;
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function sampleInto(state, red, green, blue, output) {
    const maximum = state.size - 1;
    const redPosition = gridPosition(red, state.domainMin[0], state.domainMax[0], maximum);
    const greenPosition = gridPosition(green, state.domainMin[1], state.domainMax[1], maximum);
    const bluePosition = gridPosition(blue, state.domainMin[2], state.domainMax[2], maximum);
    const red0 = Math.floor(redPosition);
    const green0 = Math.floor(greenPosition);
    const blue0 = Math.floor(bluePosition);
    const red1 = Math.min(red0 + 1, maximum);
    const green1 = Math.min(green0 + 1, maximum);
    const blue1 = Math.min(blue0 + 1, maximum);
    const redMix = redPosition - red0;
    const greenMix = greenPosition - green0;
    const blueMix = bluePosition - blue0;
    const base = blue0 * state.blueStride + green0 * state.greenStride + red0 * 3;
    const redOffset = (red1 - red0) * 3;
    const greenOffset = (green1 - green0) * state.greenStride;
    const blueOffset = (blue1 - blue0) * state.blueStride;

    for (let channel = 0; channel < 3; channel += 1) {
      const corner000 = state.values[base + channel];
      const corner100 = state.values[base + redOffset + channel];
      const corner010 = state.values[base + greenOffset + channel];
      const corner110 = state.values[base + greenOffset + redOffset + channel];
      const corner001 = state.values[base + blueOffset + channel];
      const corner101 = state.values[base + blueOffset + redOffset + channel];
      const corner011 = state.values[base + blueOffset + greenOffset + channel];
      const corner111 = state.values[base + blueOffset + greenOffset + redOffset + channel];
      const lowerGreen = lerp(
        lerp(corner000, corner100, redMix),
        lerp(corner010, corner110, redMix),
        greenMix
      );
      const upperGreen = lerp(
        lerp(corner001, corner101, redMix),
        lerp(corner011, corner111, redMix),
        greenMix
      );
      output[channel] = lerp(lowerGreen, upperGreen, blueMix);
    }
    return output;
  }

  function validateRgb(rgb) {
    return validateTriplet(rgb, 'rgb');
  }

  function validatePixels(data) {
    if (Object.prototype.toString.call(data) !== '[object Uint8ClampedArray]') {
      throw new TypeError('Pixel data must be a Uint8ClampedArray.');
    }
    if (data.length % 4 !== 0) {
      throw new RangeError('Pixel data length must be divisible by four.');
    }
  }

  function validateIntensity(options) {
    const intensity = options.intensity === undefined ? 1 : options.intensity;
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
      throw new RangeError('LUT intensity must be from 0 through 1.');
    }
    return intensity;
  }

  function createTransform(lut) {
    const state = prepareLut(lut);
    return Object.freeze({
      contract,
      sample(rgb) {
        const [red, green, blue] = validateRgb(rgb);
        return sampleInto(state, red, green, blue, new Float64Array(3));
      },
      applyPixels(data, options = {}) {
        validatePixels(data);
        const intensity = validateIntensity(options);
        if (!intensity) return data;

        const mapped = new Float64Array(3);
        for (let index = 0; index < data.length; index += 4) {
          const red = data[index] / 255;
          const green = data[index + 1] / 255;
          const blue = data[index + 2] / 255;
          sampleInto(state, red, green, blue, mapped);
          if (intensity === 1) {
            data[index] = mapped[0] * 255;
            data[index + 1] = mapped[1] * 255;
            data[index + 2] = mapped[2] * 255;
          } else {
            data[index] = (red + (mapped[0] - red) * intensity) * 255;
            data[index + 1] = (green + (mapped[1] - green) * intensity) * 255;
            data[index + 2] = (blue + (mapped[2] - blue) * intensity) * 255;
          }
        }
        return data;
      },
    });
  }

  function sample(lut, rgb) {
    return createTransform(lut).sample(rgb);
  }

  function applyPixels(data, lut, options) {
    return createTransform(lut).applyPixels(data, options);
  }

  return Object.freeze({ createTransform, sample, applyPixels, contract });
});
