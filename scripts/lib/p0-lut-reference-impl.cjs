'use strict';

// Independent reference implementation for the P0-3 LUT benchmark.
//
// This module intentionally does not import the production parser
// (assets/color-grade/color-grade-lut.js) or the production renderer
// (assets/color-grade/color-grade-lut-renderer.js). It re-implements the frozen v1 contract from
// the documented reference algorithm so that the production code can be checked
// against a second, deliberately simple implementation. It also exposes two
// intentionally wrong variants ("blue-fastest" ordering and nearest-neighbour
// sampling) that the pixel error benchmark uses as negative controls.

const ORDERINGS = Object.freeze(['red-fastest', 'blue-fastest']);
const INTERPOLATIONS = Object.freeze(['trilinear', 'nearest']);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function stripComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (character === '#' && !quoted) return line.slice(0, index);
  }
  return line;
}

function parseTriplet(tokens, directive, label) {
  invariant(tokens.length === 4, `${label}: invalid ${directive}`);
  const values = tokens.slice(1).map(Number);
  invariant(values.every(Number.isFinite), `${label}: non-finite ${directive}`);
  return values;
}

// Parses a CUBE file that P0-2 already classifies as accepted. It is not a general
// validator: malformed input throws instead of returning a structured error.
function parseAcceptedCube(bytes, label = 'cube') {
  const text = Buffer.from(bytes).toString('utf8').replace(/^﻿/, '');
  let title = null;
  let gridSize = null;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const values = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    if (line.startsWith('TITLE')) {
      const match = /^TITLE\s+"(.*)"$/.exec(line);
      invariant(match, `${label}: invalid TITLE`);
      title = match[1];
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens[0] === 'LUT_3D_SIZE') {
      invariant(tokens.length === 2 && /^\d+$/.test(tokens[1]), `${label}: invalid size`);
      gridSize = Number(tokens[1]);
      continue;
    }
    if (tokens[0] === 'DOMAIN_MIN') {
      domainMin = parseTriplet(tokens, 'DOMAIN_MIN', label);
      continue;
    }
    if (tokens[0] === 'DOMAIN_MAX') {
      domainMax = parseTriplet(tokens, 'DOMAIN_MAX', label);
      continue;
    }

    invariant(tokens.length === 3, `${label}: invalid data row`);
    const row = tokens.map(Number);
    invariant(row.every(Number.isFinite), `${label}: non-finite data row`);
    values.push(...row);
  }

  invariant(Number.isInteger(gridSize), `${label}: missing grid size`);
  invariant(values.length === gridSize ** 3 * 3, `${label}: data count mismatch`);
  invariant(
    domainMin.every((minimum, channel) => minimum < domainMax[channel]),
    `${label}: invalid domain`
  );
  invariant(
    values.every((value) => value >= 0 && value <= 1),
    `${label}: non-SDR value`
  );

  return { title, gridSize, domainMin, domainMax, values };
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function gridCoordinate(value, minimum, maximum, gridSize) {
  if (value <= minimum) return 0;
  if (value >= maximum) return gridSize - 1;
  return ((value - minimum) / (maximum - minimum)) * (gridSize - 1);
}

// Offset of one grid point. `red-fastest` is the CUBE convention frozen by the
// contract; `blue-fastest` exists only as a negative control.
function tableOffset(lut, red, green, blue, ordering) {
  const size = lut.gridSize;
  if (ordering === 'blue-fastest') return (red * size * size + green * size + blue) * 3;
  return (blue * size * size + green * size + red) * 3;
}

function gridPositions(lut, rgb) {
  return rgb.map((value, channel) =>
    gridCoordinate(value, lut.domainMin[channel], lut.domainMax[channel], lut.gridSize)
  );
}

function sampleTrilinear(lut, rgb, ordering = 'red-fastest') {
  const positions = gridPositions(lut, rgb);
  const lower = positions.map(Math.floor);
  const upper = lower.map((value) => Math.min(value + 1, lut.gridSize - 1));
  const mix = positions.map((value, channel) => value - lower[channel]);
  const at = (red, green, blue, channel) =>
    lut.values[tableOffset(lut, red, green, blue, ordering) + channel];

  const output = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const lowerGreen = lerp(
      lerp(
        at(lower[0], lower[1], lower[2], channel),
        at(upper[0], lower[1], lower[2], channel),
        mix[0]
      ),
      lerp(
        at(lower[0], upper[1], lower[2], channel),
        at(upper[0], upper[1], lower[2], channel),
        mix[0]
      ),
      mix[1]
    );
    const upperGreen = lerp(
      lerp(
        at(lower[0], lower[1], upper[2], channel),
        at(upper[0], lower[1], upper[2], channel),
        mix[0]
      ),
      lerp(
        at(lower[0], upper[1], upper[2], channel),
        at(upper[0], upper[1], upper[2], channel),
        mix[0]
      ),
      mix[1]
    );
    output[channel] = lerp(lowerGreen, upperGreen, mix[2]);
  }
  return output;
}

// Negative control: snaps to the nearest grid point instead of interpolating.
function sampleNearest(lut, rgb, ordering = 'red-fastest') {
  const nearest = gridPositions(lut, rgb).map(Math.round);
  const offset = tableOffset(lut, nearest[0], nearest[1], nearest[2], ordering);
  return [lut.values[offset], lut.values[offset + 1], lut.values[offset + 2]];
}

function normalizeOptions(options = {}) {
  const intensity = options.intensity === undefined ? 1 : options.intensity;
  const ordering = options.ordering || 'red-fastest';
  const interpolation = options.interpolation || 'trilinear';
  invariant(
    Number.isFinite(intensity) && intensity >= 0 && intensity <= 1,
    'intensity must be a number from 0 through 1'
  );
  invariant(ORDERINGS.includes(ordering), `unknown ordering ${ordering}`);
  invariant(INTERPOLATIONS.includes(interpolation), `unknown interpolation ${interpolation}`);
  return { intensity, ordering, interpolation };
}

// Renders RGBA8 input to an unquantized Float64Array on the 0-255 scale. Alpha is
// copied through. Quantization is the caller's job (see renderRgba) so that the
// benchmark can measure the quantization step separately.
function renderFloat(input, lut, options) {
  invariant(input.length % 4 === 0, 'RGBA input length must be divisible by four');
  const { intensity, ordering, interpolation } = normalizeOptions(options);
  const sampler = interpolation === 'nearest' ? sampleNearest : sampleTrilinear;
  const output = new Float64Array(input.length);

  for (let offset = 0; offset < input.length; offset += 4) {
    const rgb = [input[offset] / 255, input[offset + 1] / 255, input[offset + 2] / 255];
    if (intensity === 0) {
      output[offset] = input[offset];
      output[offset + 1] = input[offset + 1];
      output[offset + 2] = input[offset + 2];
    } else {
      const mapped = sampler(lut, rgb, ordering);
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          intensity === 1
            ? mapped[channel]
            : rgb[channel] + (mapped[channel] - rgb[channel]) * intensity;
        output[offset + channel] = value * 255;
      }
    }
    output[offset + 3] = input[offset + 3];
  }
  return output;
}

// Quantizes with Uint8ClampedArray assignment (round-half-to-even, clamp 0-255),
// exactly like the frozen contract.
function quantize(floatRgba) {
  const output = new Uint8ClampedArray(floatRgba.length);
  for (let index = 0; index < floatRgba.length; index += 1) output[index] = floatRgba[index];
  return output;
}

function renderRgba(input, lut, options) {
  const { intensity } = normalizeOptions(options);
  if (intensity === 0) return new Uint8ClampedArray(input);
  return quantize(renderFloat(input, lut, options));
}

module.exports = Object.freeze({
  ORDERINGS,
  INTERPOLATIONS,
  invariant,
  parseAcceptedCube,
  sampleTrilinear,
  sampleNearest,
  renderFloat,
  renderRgba,
  quantize,
});
