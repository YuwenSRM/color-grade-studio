const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Lut = require('../assets/color-grade/color-grade-lut.js');
const LutRenderer = require('../assets/color-grade/color-grade-lut-renderer.js');
const Renderer = require('../assets/color-grade/color-grade-renderer.js');

const root = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(
  path.join(root, 'tests', 'fixtures', 'luts', 'valid', 'identity-33.cube')
);
const parsed = Lut.validateBytes(fixture);
if (!parsed.ok) throw new Error(parsed.message || 'Benchmark LUT is invalid.');
const transform = LutRenderer.createTransform(parsed.lut);
const manualSettings = { delta: { exposure: 12, contrast: -8, saturation: 6 } };
const neutral = { b: 1, c: 1, s: 1, w: 1, t: 0 };

function makePixels(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    const pixel = index / 4;
    pixels[index] = (pixel * 17) & 255;
    pixels[index + 1] = (pixel * 37) & 255;
    pixels[index + 2] = (pixel * 73) & 255;
    pixels[index + 3] = 255;
  }
  return pixels;
}

const runCount = Math.max(1, Number(process.env.P1_BENCHMARK_RUNS || 5));

function percentile(samples, ratio) {
  const sorted = samples.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function benchmark(label, width, height) {
  const source = makePixels(width, height);
  const samples = Array.from({ length: runCount }, () => {
    const pixels = new Uint8ClampedArray(source);
    const started = process.hrtime.bigint();
    transform.applyPixels(pixels, { intensity: 0.5 });
    Renderer.applyPixels(pixels, neutral, manualSettings);
    return Number(process.hrtime.bigint() - started) / 1e6;
  });
  return {
    label,
    width,
    height,
    pixels: width * height,
    runs: samples.map((milliseconds) => Math.round(milliseconds * 10) / 10),
    p95Milliseconds: Math.round(percentile(samples, 0.95) * 10) / 10,
  };
}

const results = [
  benchmark('12MP preview (1100px long edge)', 1100, 825),
  benchmark('24MP preview (1100px long edge)', 1100, 733),
  benchmark('12MP original-size export core', 4000, 3000),
  benchmark('24MP original-size export core', 6000, 4000),
];
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model || 'unknown',
      },
      lut: { gridSize: parsed.lut.gridSize, intensity: 0.5, manualSettings },
      results,
      note: 'Synthetic SDR RGBA8 core-render benchmark. Preview dimensions match the page long-edge limit. Browser decode, Canvas transfer, Worker scheduling and encoded image export remain separate browser acceptance measurements.',
    },
    null,
    2
  )
);
