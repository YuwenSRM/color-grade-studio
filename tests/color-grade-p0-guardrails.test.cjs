'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const manifest = require('../scripts/standalone-runtime-manifest.cjs');
const contracts = JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'fixtures', 'color-grade-p0-contracts.json'), 'utf8')
);

function loadClassicLocale(relative, context) {
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), context, {
    filename: relative,
  });
}

function shape(value) {
  if (typeof value === 'function') return 'function';
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, shape(value[key])])
    );
  return typeof value;
}

test('P0 runtime manifest is the sole standalone file and build-input authority', () => {
  assert.ok(manifest.runtimeFiles.includes('assets/locales/color-grade-zh-CN.js'));
  assert.ok(manifest.runtimeFiles.includes('assets/locales/color-grade-en-US.js'));
  assert.ok(manifest.runtimeFiles.includes('assets/locales/color-grade-look-aliases.js'));
  assert.ok(manifest.runtimeFiles.includes('assets/color-grade/color-grade-mode-standalone.js'));
  assert.ok(manifest.runtimeFiles.includes('assets/color-grade/color-grade-builtin-catalog.js'));
  assert.ok(!manifest.runtimeFiles.includes('assets/pages/color-grade-full-integration.js'));
  assert.ok(manifest.buildInputs.includes('color-grade.html'));
  assert.ok(manifest.buildInputs.includes('assets/color-grade/workbench/styles/base.css'));
  assert.ok(
    manifest
      .standaloneOutputFiles(root)
      .includes('assets/color-grade/color-grade-builtin-catalog.js')
  );
});

test('P0 locale scaffolds are classic scripts with identical schemas', () => {
  const context = { window: {} };
  loadClassicLocale('assets/locales/color-grade-zh-CN.js', context);
  loadClassicLocale('assets/locales/color-grade-en-US.js', context);
  const locales = context.window.ColorGradeLocales;
  assert.deepEqual(shape(locales['zh-CN']), shape(locales['en-US']));
  assert.equal(locales['zh-CN'].meta.locale, 'zh-CN');
  assert.equal(locales['en-US'].meta.locale, 'en-US');
});

test('P0 keeps full integrations out of the standalone workbench dependency graph', () => {
  const shared = fs.readFileSync(
    path.join(root, 'assets', 'color-grade', 'workbench', 'catalog.js'),
    'utf8'
  );
  const full = fs.readFileSync(
    path.join(root, 'assets', 'pages', 'color-grade-full-integration.js'),
    'utf8'
  );
  const standaloneMode = fs.readFileSync(
    path.join(root, 'assets', 'color-grade', 'color-grade-mode-standalone.js'),
    'utf8'
  );
  assert.match(shared, /ColorGradeAppMode/);
  assert.doesNotMatch(shared, /LandscapeApi|\/api\/|uploadImage\(/);
  assert.match(full, /LandscapeApi/);
  assert.match(standaloneMode, /mode: 'standalone'/);
});

test('P0 reserves mode and alias modules for non-localized implementation data', () => {
  const sources = [
    'assets/color-grade/color-grade-mode-full.js',
    'assets/color-grade/color-grade-mode-standalone.js',
    'assets/locales/color-grade-look-aliases.js',
  ];
  for (const relative of sources) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    // Look aliases are semantic search data. They deliberately include both
    // languages but must never define a visible UI attribute.
    assert.doesNotMatch(
      source,
      /(?:title|placeholder|aria-label)\s*[:=]\s*['"][A-Za-z]/,
      `${relative} must not add visible English copy`
    );
  }
});

test('P0 freezes the v1 Worker message compatibility and user LUT v1 data boundary', () => {
  const worker = fs.readFileSync(
    path.join(root, 'assets', 'color-grade', 'color-grade-p1-worker.js'),
    'utf8'
  );
  const client = fs.readFileSync(
    path.join(root, 'assets', 'color-grade', 'color-grade-p1-client.js'),
    'utf8'
  );
  const library = fs.readFileSync(
    path.join(root, 'assets', 'color-grade', 'color-grade-lut-library.js'),
    'utf8'
  );
  assert.equal(contracts.p1Worker.protocolVersion, 1);
  assert.match(worker, /type: 'error', protocolVersion, requestId, code, message/);
  assert.match(worker, /type: 'ready',\s*protocolVersion/);
  assert.match(client, /message\.message/);
  assert.match(library, /schemaVersion: 1/);
  for (const field of contracts.userLutRecordV1.forbiddenLocalizedFields)
    assert.doesNotMatch(library, new RegExp(`\\b${field}\\b`));
});

test('P2 catalog sidecar has stable builtin IDs without touching the user LUT schema', () => {
  const catalog = fs.readFileSync(
    path.join(root, 'assets', 'color-grade', 'color-grade-builtin-catalog.js'),
    'utf8'
  );
  assert.match(catalog, /labelKey: 'cg\.catalog\.builtin\.name'/);
  assert.match(catalog, /descriptionKey: 'cg\.catalog\.builtin\.description'/);
  assert.match(catalog, /forPreset/);
  assert.match(catalog, /forLut/);
  assert.doesNotMatch(catalog, /schemaVersion/);
});
