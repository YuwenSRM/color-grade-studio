const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ColorGradeHald = require('../assets/color-grade/color-grade-hald.js');
const ColorGradeLut = require('../assets/color-grade/color-grade-lut.js');
const ColorGradeLutRenderer = require('../assets/color-grade/color-grade-lut-renderer.js');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'docs', 'reference', 'p2-evidence');
const width = 960;
const height = 640;

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function setPixel(pixels, x, y, red, green, blue) {
  const offset = (y * width + x) * 4;
  pixels[offset] = clampByte(red);
  pixels[offset + 1] = clampByte(green);
  pixels[offset + 2] = clampByte(blue);
  pixels[offset + 3] = 255;
}

function gradient(start, end, amount) {
  return start.map((channel, index) => channel + (end[index] - channel) * amount);
}

function createReviewPixels() {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const skin = [
    [71, 45, 35],
    [111, 73, 55],
    [151, 101, 76],
    [190, 133, 99],
    [222, 171, 132],
  ];
  const saturated = [
    [224, 60, 52],
    [246, 185, 50],
    [75, 170, 92],
    [45, 137, 206],
    [116, 75, 185],
    [212, 64, 139],
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let color;
      if (y < 160) {
        const value = (x / (width - 1)) * 255;
        color = [value, value, value];
      } else if (y < 288) {
        color = skin[Math.min(skin.length - 1, Math.floor((x / width) * skin.length))];
      } else if (y < 448) {
        const horizontal = x / (width - 1);
        const vertical = (y - 288) / 159;
        const sky = gradient([40, 105, 181], [180, 224, 246], horizontal);
        const vegetation = gradient([29, 70, 38], [129, 166, 69], horizontal);
        color = gradient(sky, vegetation, vertical);
      } else if (y < 544) {
        color =
          saturated[Math.min(saturated.length - 1, Math.floor((x / width) * saturated.length))];
      } else {
        const value = 172 + (x / (width - 1)) * 83;
        const warm = (y - 544) / 95;
        color = [value, value - warm * 10, value - warm * 23];
      }
      setPixel(pixels, x, y, color[0], color[1], color[2]);
    }
  }
  return pixels;
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writePng(filename, pixels, text) {
  const bytes = ColorGradeHald.encodePngRgba(width, height, pixels, text);
  fs.writeFileSync(path.join(evidenceDir, filename), bytes);
  return {
    path: `docs/reference/p2-evidence/${filename}`,
    bytes: bytes.length,
    sha256: hash(bytes),
  };
}

function renderLut(entry, source) {
  const sourcePath = path.join(root, entry.path);
  const checked = ColorGradeLut.validateBytes(fs.readFileSync(sourcePath));
  if (!checked.ok) throw new Error(`${entry.id}: ${checked.error?.message || checked.code}`);
  const pixels = new Uint8ClampedArray(source);
  ColorGradeLutRenderer.applyPixels(pixels, checked.lut, { intensity: 1 });
  return pixels;
}

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const source = createReviewPixels();
  const manifest = {
    schemaVersion: 1,
    purpose: 'Project-owned synthetic SDR color-review image set for P2 local research.',
    generatedOn: '2026-09-12',
    dimensions: [width, height],
    colorSpace: 'sRGB SDR',
    assetType: 'synthetic-color-review-image',
    checks: [
      'grayscale',
      'skin-tone-reference',
      'sky-vegetation',
      'saturated-color',
      'highlight-rolloff',
    ],
    source: writePng('source-color-review.png', source, {
      Format: 'real-landscape-p2-color-review',
      ColorSpace: 'sRGB SDR',
      AssetType: 'synthetic-color-review-image',
      Stage: 'input',
    }),
    outputs: [],
  };
  const builtins = JSON.parse(
    fs.readFileSync(
      path.join(root, 'assets', 'color-grade', 'p2-builtin-filters', 'manifest.json'),
      'utf8'
    )
  );
  for (const entry of builtins.entries) {
    const pixels = renderLut(entry, source);
    manifest.outputs.push({
      id: entry.id,
      preview: writePng(`${entry.id}-preview.png`, pixels, {
        Format: 'real-landscape-p2-color-review',
        ColorSpace: 'sRGB SDR',
        AssetType: 'synthetic-color-review-image',
        Stage: 'preview',
        SourceLutSha256: entry.sha256,
      }),
      export: writePng(`${entry.id}-export.png`, pixels, {
        Format: 'real-landscape-p2-color-review',
        ColorSpace: 'sRGB SDR',
        AssetType: 'synthetic-color-review-image',
        Stage: 'export',
        SourceLutSha256: entry.sha256,
      }),
    });
  }
  fs.writeFileSync(
    path.join(evidenceDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  console.log(`Generated ${manifest.outputs.length} P2 color-review output pairs.`);
}

main();
