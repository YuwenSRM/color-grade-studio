'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const Hald = require('../assets/color-grade/color-grade-hald.js');
const Lut = require('../assets/color-grade/color-grade-lut.js');
const ThreeDl = require('../assets/color-grade/color-grade-3dl.js');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(
  root,
  'docs',
  'reference',
  'p2-evidence',
  'p2-exchange-acceptance.json'
);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function loadCube(relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  const parsed = Lut.validateBytes(bytes);
  if (!parsed.ok) throw new Error(`${relativePath}: ${parsed.error?.message || parsed.code}`);
  return parsed.lut;
}

function exchangeInput(lut) {
  return {
    lut,
    inputColorSpace: 'sRGB SDR',
    outputColorSpace: 'sRGB SDR',
    compatibilityStatus: 'applicable',
  };
}

async function verifyCancellation(lut) {
  const controller = new AbortController();
  const pending = Hald.encodeHaldPngAsync(exchangeInput(lut), { signal: controller.signal });
  controller.abort();
  try {
    await pending;
    return false;
  } catch (error) {
    return error instanceof Hald.HaldError && error.code === 'operation-aborted';
  }
}

async function main() {
  const cases = [];
  for (const size of [33, 65]) {
    const inputPath = `tests/fixtures/luts/valid/identity-${size}.cube`;
    const lut = loadCube(inputPath);
    const before = Array.from(lut.values);
    const started = performance.now();
    const encoded = Hald.encodeHaldPng(exchangeInput(lut));
    const decoded = Hald.decodeHaldPng(encoded.bytes);
    const comparison = Hald.compareLutSamples(exchangeInput(lut), decoded, size);
    cases.push({
      inputPath,
      sourceLutSha256: lut.sha256,
      gridSize: size,
      hald: {
        level: encoded.level,
        dimensions: [encoded.dimension, encoded.dimension],
        bytes: encoded.bytes.length,
        sha256: sha256(encoded.bytes),
        metadata: decoded.text,
      },
      elapsedMilliseconds: Math.round((performance.now() - started) * 10) / 10,
      maximumSampleError: comparison.maximumError,
      quantizationLimit: comparison.quantizationLimit,
      sourceValuesUnchanged: before.every((value, index) => value === lut.values[index]),
    });
  }

  const identity17 = loadCube('tests/fixtures/luts/valid/identity-17.cube');
  const customDomain = loadCube('tests/fixtures/luts/edge/domain-quarter-to-three-quarters-4.cube');
  let incompatibleColorCode = null;
  let customDomainCode = null;
  try {
    Hald.encodeHaldPng({ ...exchangeInput(identity17), outputColorSpace: 'unknown' });
  } catch (error) {
    incompatibleColorCode = error.code || null;
  }
  try {
    Hald.encodeHaldPng(exchangeInput(customDomain));
  } catch (error) {
    customDomainCode = error.code || null;
  }

  const threeDlManifest = JSON.parse(
    fs.readFileSync(
      path.join(root, 'tests', 'fixtures', '3dl', 'external-source', 'manifest.json'),
      'utf8'
    )
  );
  const threeDl = threeDlManifest.entries.map((entry) => {
    const bytes = fs.readFileSync(path.join(root, entry.path));
    const result = ThreeDl.detectText(bytes.toString('utf8'), {
      filename: path.basename(entry.path),
    });
    return {
      id: entry.id,
      sourceSha256: sha256(bytes),
      status: result.status,
      code: result.code,
      dialect: result.dialect,
      gridSize: result.gridSize,
      outputRange: result.outputRange,
      rowCountMatchesGrid: result.rowCountMatchesGrid,
    };
  });

  const report = {
    schemaVersion: 1,
    generatedOn: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      initialRssBytes: process.memoryUsage().rss,
    },
    scope:
      'P2 local exchange validation; the memory value is Node process RSS, not browser process memory.',
    hald: {
      cases,
      cancellationHonored: await verifyCancellation(identity17),
      incompatibleColorCode,
      customDomainCode,
    },
    threeDl,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(root, outputPath), report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
