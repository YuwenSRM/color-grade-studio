'use strict';

// Fixed 8x6 RGBA8 swatch chart for the P0-3 LUT reference benchmark. The swatch
// table is frozen: changing any value changes the input hash recorded in
// `reference-outputs.json`, so bump `id` and regenerate if it ever has to move.

const id = 'p0-synthetic-rgba-chart-v1';
const width = 8;

const rows = Object.freeze([
  [
    ['black', 0, 0, 0, 255],
    ['gray-16', 16, 16, 16, 255],
    ['gray-32', 32, 32, 32, 255],
    ['gray-64', 64, 64, 64, 255],
    ['gray-96', 96, 96, 96, 255],
    ['gray-128', 128, 128, 128, 255],
    ['gray-192', 192, 192, 192, 255],
    ['white', 255, 255, 255, 255],
  ],
  [
    ['red', 255, 0, 0, 255],
    ['green', 0, 255, 0, 255],
    ['blue', 0, 0, 255, 255],
    ['yellow', 255, 255, 0, 255],
    ['cyan', 0, 255, 255, 255],
    ['magenta', 255, 0, 255, 255],
    ['orange', 255, 128, 0, 255],
    ['violet', 128, 0, 255, 255],
  ],
  [
    ['dark-skin', 115, 82, 68, 255],
    ['light-skin', 194, 150, 130, 255],
    ['blue-sky', 98, 122, 157, 255],
    ['foliage', 87, 108, 67, 255],
    ['blue-flower', 133, 128, 177, 255],
    ['bluish-green', 103, 189, 170, 255],
    ['ochre', 214, 126, 44, 255],
    ['muted-purple', 80, 91, 166, 255],
  ],
  [
    ['deep-shadow', 8, 16, 28, 255],
    ['warm-highlight', 250, 222, 184, 255],
    ['snow', 236, 242, 248, 255],
    ['sunset', 224, 92, 62, 255],
    ['forest', 30, 86, 52, 255],
    ['water', 24, 132, 168, 255],
    ['clouds', 172, 181, 194, 255],
    ['earth', 126, 92, 61, 255],
  ],
  [
    ['domain-below-min', 63, 63, 63, 255],
    ['domain-near-min', 64, 64, 64, 255],
    ['mid-low', 96, 96, 96, 255],
    ['mid-gray', 128, 128, 128, 255],
    ['domain-near-max', 191, 191, 191, 255],
    ['domain-above-max', 192, 192, 192, 255],
    ['split-green-blue', 32, 224, 128, 255],
    ['split-red-blue', 224, 32, 128, 255],
  ],
  [
    ['transparent-cyan', 12, 200, 244, 0],
    ['alpha-one-rose', 243, 45, 127, 1],
    ['alpha-64-sky', 71, 143, 219, 64],
    ['alpha-127-earth', 198, 102, 36, 127],
    ['alpha-128-leaf', 45, 210, 98, 128],
    ['alpha-192-violet', 167, 37, 226, 192],
    ['alpha-254-lime', 91, 174, 53, 254],
    ['opaque-yellow', 230, 230, 20, 255],
  ],
]);

const height = rows.length;
const probeIndices = Object.freeze([0, 5, 7, 8, 17, 25, 32, 33, 36, 37, 40, 43]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function build() {
  invariant(
    rows.every((row) => row.length === width),
    `Every chart row must be ${width} pixels`
  );
  const swatches = rows.flat();
  const names = new Set();
  const values = [];
  for (const [name, ...rgba] of swatches) {
    invariant(!names.has(name), `Duplicate swatch name: ${name}`);
    invariant(
      rgba.length === 4 &&
        rgba.every((value) => Number.isInteger(value) && value >= 0 && value <= 255),
      `Invalid swatch: ${name}`
    );
    names.add(name);
    values.push(...rgba);
  }
  return Uint8ClampedArray.from(values);
}

const probes = Object.freeze(probeIndices.map((index) => ({ index, name: rows.flat()[index][0] })));

const swatchNames = Object.freeze(rows.flat().map(([name]) => name));

module.exports = Object.freeze({ id, width, height, rows, probes, swatchNames, build });
