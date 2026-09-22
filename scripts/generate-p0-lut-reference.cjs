const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const fixturesRoot = path.join(projectRoot, 'tests', 'fixtures', 'luts');
const manifestPath = path.join(fixturesRoot, 'manifest.json');
const outputPath = path.join(fixturesRoot, 'reference-outputs.json');

function formatJson(value, indent = 0) {
  const nextIndent = indent + 2;
  if (Array.isArray(value)) {
    const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    if (value.every((item) => typeof item === 'number') && indent + inline.length <= 100) {
      return inline;
    }
    if (!value.length) return '[]';
    const items = value.map((item) => `${' '.repeat(nextIndent)}${formatJson(item, nextIndent)}`);
    return `[\n${items.join(',\n')}\n${' '.repeat(indent)}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const properties = entries.map(
      ([key, item]) =>
        `${' '.repeat(nextIndent)}${JSON.stringify(key)}: ${formatJson(item, nextIndent)}`
    );
    return `{\n${properties.join(',\n')}\n${' '.repeat(indent)}}`;
  }
  return JSON.stringify(value);
}

const chartWidth = 8;
const chartRows = [
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
];
const probeIndices = [0, 5, 7, 8, 17, 25, 32, 33, 36, 37, 40, 43];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function typedArrayBytes(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function rgbaHex(values, offset) {
  let result = '';
  for (let channel = 0; channel < 4; channel += 1) {
    result += values[offset + channel].toString(16).padStart(2, '0');
  }
  return result;
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

function parseTriplet(tokens, directive, fixturePath) {
  invariant(tokens.length === 4, `${fixturePath}: invalid ${directive}`);
  const values = tokens.slice(1).map(Number);
  invariant(values.every(Number.isFinite), `${fixturePath}: non-finite ${directive}`);
  return values;
}

// This intentionally does not import the production parser or LUT renderer.
function parseAcceptedCube(bytes, fixturePath) {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
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
      invariant(match, `${fixturePath}: invalid TITLE`);
      title = match[1];
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens[0] === 'LUT_3D_SIZE') {
      invariant(tokens.length === 2 && /^\d+$/.test(tokens[1]), `${fixturePath}: invalid size`);
      gridSize = Number(tokens[1]);
      continue;
    }
    if (tokens[0] === 'DOMAIN_MIN') {
      domainMin = parseTriplet(tokens, 'DOMAIN_MIN', fixturePath);
      continue;
    }
    if (tokens[0] === 'DOMAIN_MAX') {
      domainMax = parseTriplet(tokens, 'DOMAIN_MAX', fixturePath);
      continue;
    }

    invariant(tokens.length === 3, `${fixturePath}: invalid data row`);
    const row = tokens.map(Number);
    invariant(row.every(Number.isFinite), `${fixturePath}: non-finite data row`);
    values.push(...row);
  }

  invariant(Number.isInteger(gridSize), `${fixturePath}: missing grid size`);
  invariant(values.length === gridSize ** 3 * 3, `${fixturePath}: data count mismatch`);
  invariant(
    domainMin.every((minimum, channel) => minimum < domainMax[channel]),
    `${fixturePath}: invalid domain`
  );
  invariant(
    values.every((value) => value >= 0 && value <= 1),
    `${fixturePath}: non-SDR value`
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

function sampleTrilinear(lut, rgb) {
  const positions = rgb.map((value, channel) =>
    gridCoordinate(value, lut.domainMin[channel], lut.domainMax[channel], lut.gridSize)
  );
  const lower = positions.map(Math.floor);
  const upper = lower.map((value) => Math.min(value + 1, lut.gridSize - 1));
  const mix = positions.map((value, channel) => value - lower[channel]);

  const sample = (red, green, blue, channel) => {
    const pixelIndex = (blue * lut.gridSize * lut.gridSize + green * lut.gridSize + red) * 3;
    return lut.values[pixelIndex + channel];
  };

  const output = new Array(3);
  for (let channel = 0; channel < 3; channel += 1) {
    const lowerGreen = lerp(
      lerp(
        sample(lower[0], lower[1], lower[2], channel),
        sample(upper[0], lower[1], lower[2], channel),
        mix[0]
      ),
      lerp(
        sample(lower[0], upper[1], lower[2], channel),
        sample(upper[0], upper[1], lower[2], channel),
        mix[0]
      ),
      mix[1]
    );
    const upperGreen = lerp(
      lerp(
        sample(lower[0], lower[1], upper[2], channel),
        sample(upper[0], lower[1], upper[2], channel),
        mix[0]
      ),
      lerp(
        sample(lower[0], upper[1], upper[2], channel),
        sample(upper[0], upper[1], upper[2], channel),
        mix[0]
      ),
      mix[1]
    );
    output[channel] = lerp(lowerGreen, upperGreen, mix[2]);
  }
  return output;
}

function renderChart(input, lut) {
  const output = new Uint8ClampedArray(input.length);
  for (let offset = 0; offset < input.length; offset += 4) {
    const mapped = sampleTrilinear(lut, [
      input[offset] / 255,
      input[offset + 1] / 255,
      input[offset + 2] / 255,
    ]);
    output[offset] = mapped[0] * 255;
    output[offset + 1] = mapped[1] * 255;
    output[offset + 2] = mapped[2] * 255;
    output[offset + 3] = input[offset + 3];
  }
  return output;
}

function buildChart() {
  invariant(
    chartRows.every((row) => row.length === chartWidth),
    'Every chart row must be 8 pixels'
  );
  const swatches = chartRows.flat();
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
  return { swatches, values: Uint8ClampedArray.from(values) };
}

function probeMap(swatches, values) {
  return Object.fromEntries(
    probeIndices.map((index) => [`${index}:${swatches[index][0]}`, rgbaHex(values, index * 4)])
  );
}

function domainText(values) {
  return values.join(' ');
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const accepted = manifest.entries.filter((entry) => entry.expectedStatus === 'accepted');
  invariant(accepted.length === 7, `Expected 7 accepted LUTs, received ${accepted.length}`);

  const chart = buildChart();
  const inputBytes = typedArrayBytes(chart.values);
  const outputs = accepted.map((entry) => {
    const fixturePath = path.join(fixturesRoot, ...entry.path.split('/'));
    const lutBytes = fs.readFileSync(fixturePath);
    invariant(sha256(lutBytes) === entry.sha256, `${entry.path}: LUT SHA-256 mismatch`);
    const lut = parseAcceptedCube(lutBytes, entry.path);
    invariant(lut.title === entry.title, `${entry.path}: title mismatch`);
    invariant(lut.gridSize === entry.gridSize, `${entry.path}: grid size mismatch`);
    invariant(
      domainText(lut.domainMin) === domainText(entry.domainMin),
      `${entry.path}: DOMAIN_MIN mismatch`
    );
    invariant(
      domainText(lut.domainMax) === domainText(entry.domainMax),
      `${entry.path}: DOMAIN_MAX mismatch`
    );

    const rendered = renderChart(chart.values, lut);
    for (let offset = 3; offset < rendered.length; offset += 4) {
      invariant(rendered[offset] === chart.values[offset], `${entry.path}: alpha changed`);
    }

    if (entry.sampleClass === 'valid-identity') {
      invariant(
        typedArrayBytes(rendered).equals(inputBytes),
        `${entry.path}: identity LUT changed reference bytes`
      );
    }

    return {
      fixturePath: entry.path,
      title: lut.title,
      gridSize: lut.gridSize,
      domainMin: lut.domainMin,
      domainMax: lut.domainMax,
      lutSha256: entry.sha256,
      outputByteLength: rendered.byteLength,
      outputSha256: sha256(typedArrayBytes(rendered)),
      probes: probeMap(chart.swatches, rendered),
    };
  });

  invariant(
    new Set(outputs.map((entry) => entry.outputSha256)).size === 5,
    'Expected three shared identity hashes and four distinct transformed hashes'
  );

  const report = {
    schemaVersion: 1,
    fixtureSet: manifest.fixtureSet,
    referenceContract: {
      version: 1,
      implementation:
        'Independent Node.js generator; imports neither production parser nor renderer',
      ordering: 'red-fastest, green-middle, blue-slowest',
      interpolation: 'trilinear',
      inputEncoding: 'normalized sRGB byte divided by 255',
      domainMapping: 'per-channel DOMAIN_MIN/DOMAIN_MAX with clamp-to-edge',
      intensity: 1,
      outputQuantization: 'multiply by 255 and assign to Uint8ClampedArray',
      alphaHandling: 'preserve the input alpha byte exactly',
      hashEncoding: 'lowercase SHA-256 of raw RGBA bytes',
      probeEncoding: 'eight lowercase hexadecimal RGBA digits',
    },
    input: {
      id: 'p0-synthetic-rgba-chart-v1',
      width: chartWidth,
      height: chartRows.length,
      pixelCount: chart.swatches.length,
      byteLength: chart.values.byteLength,
      layout: 'row-major, left-to-right and top-to-bottom',
      sha256: sha256(inputBytes),
      swatches: Object.fromEntries(
        chart.swatches.map(([name], index) => [
          `${index}:${name}`,
          rgbaHex(chart.values, index * 4),
        ])
      ),
    },
    probeIndices,
    outputs,
  };

  fs.writeFileSync(outputPath, `${formatJson(report)}\n`, 'utf8');
  console.log(`Generated ${path.relative(projectRoot, outputPath)} for ${outputs.length} LUTs.`);
  console.log(`Input: ${chartWidth}x${chartRows.length} RGBA8, SHA-256 ${report.input.sha256}`);
  for (const entry of outputs) console.log(`${entry.fixturePath}: ${entry.outputSha256}`);
}

main();
