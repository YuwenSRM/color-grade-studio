'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const runtimeFiles = Object.freeze([
  'assets/color-grade/color-grade-3dl.js',
  'assets/color-grade/color-grade-builtin-catalog.js',
  'assets/color-grade/color-grade-intent.js',
  'assets/color-grade/color-grade-hald.js',
  'assets/color-grade/color-grade-lut-library.js',
  'assets/color-grade/color-grade-lut-renderer.js',
  'assets/color-grade/color-grade-lut.js',
  'assets/color-grade/color-grade-mode-standalone.js',
  'assets/color-grade/color-grade-p1-client.js',
  'assets/color-grade/color-grade-p1-worker.js',
  'assets/color-grade/color-grade-renderer.js',
  'assets/color-grade/color-grade-webgl-preview.js',
  'assets/shared/custom-select.js',
  'assets/color-grade/color-grade-i18n.js',
  'assets/locales/color-grade-en-US.js',
  'assets/locales/color-grade-look-aliases.js',
  'assets/locales/color-grade-zh-CN.js',
  'assets/color-grade/p2-builtin-filters.js',
  'assets/pages/color-grade-import.js',
  'assets/pages/color-grade-worker.js',
  'assets/color-grade/workbench/catalog.js',
  'assets/color-grade/workbench/state.js',
  'assets/color-grade/workbench/preview-renderer.js',
  'assets/color-grade/workbench/filter-library.js',
  'assets/color-grade/workbench/interactions-crop-export.js',
  'assets/pages/color-grade.js',
  'assets/shared/theme-controller.js',
  'assets/shared/ui-utils.js',
]);

const runtimeDirectories = Object.freeze(['assets/color-grade/p2-builtin-filters']);
const buildInputs = Object.freeze([
  'color-grade.html',
  'vite.standalone.config.mjs',
  'assets/shared/i18n.css',
  'assets/shared/select-ui.css',
  'assets/shared/theme.css',
  'assets/color-grade/workbench/styles/base.css',
  'assets/color-grade/workbench/styles/controls.css',
  'assets/color-grade/workbench/styles/library-dialogs.css',
  'assets/color-grade/workbench/styles/responsive.css',
  ...runtimeFiles,
  ...runtimeDirectories,
]);
const candidateSourceInputs = Object.freeze([
  'assets/color-grade/p2-builtin-filters/LICENSE.md',
  'docs/privacy.md',
  'docs/release-notes.md',
  'docs/support.md',
  'docs/launcher.md',
  'docs/standalone.md',
  'launcher/powershell/ColorGradeStudio.cmd',
  'launcher/powershell/ColorGradeStudio.ps1',
  'launcher/powershell/ColorGradeStudio.vbs',
  'package-lock.json',
  'package.json',
  'scripts/check-standalone-candidate.cjs',
  'scripts/package-standalone-candidate.cjs',
  'scripts/standalone-runtime-manifest.cjs',
  'vite.standalone.config.mjs',
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedPath(value) {
  return value.replaceAll(path.sep, '/');
}

function filesIn(root, relative) {
  const directory = path.join(root, relative);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = path.join(relative, entry.name);
      return entry.isDirectory() ? filesIn(root, child) : [normalizedPath(child)];
    });
}

function sourceEntries(root, inputs) {
  const expanded = inputs.flatMap((relative) => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) throw new Error(`Runtime manifest input is missing: ${relative}`);
    return fs.statSync(absolute).isDirectory() ? filesIn(root, relative) : [relative];
  });
  return [...new Set(expanded)]
    .sort((left, right) => left.localeCompare(right))
    .map((relative) => ({
      path: normalizedPath(relative),
      sha256: sha256(fs.readFileSync(path.join(root, relative))),
    }));
}

function idFor(entries) {
  return sha256(Buffer.from(JSON.stringify(entries), 'utf8'));
}

function createRuntimeBuild(root) {
  const inputs = sourceEntries(root, buildInputs);
  return Object.freeze({ schemaVersion: 1, runtimeBuildId: idFor(inputs), inputs });
}

function createCandidateSource(root, runtimeBuildId) {
  const inputs = sourceEntries(root, candidateSourceInputs);
  const material = [...inputs, { path: 'runtimeBuildId', sha256: runtimeBuildId }].sort(
    (left, right) => left.path.localeCompare(right.path)
  );
  return Object.freeze({ candidateSourceId: idFor(material), inputs: material });
}

function standaloneOutputFiles(root) {
  return [
    'index.html',
    'BUILD.json',
    ...runtimeFiles,
    ...runtimeDirectories.flatMap((relative) => filesIn(root, relative)),
  ].sort((left, right) => left.localeCompare(right));
}

module.exports = Object.freeze({
  buildInputs,
  candidateSourceInputs,
  createCandidateSource,
  createRuntimeBuild,
  runtimeDirectories,
  runtimeFiles,
  sha256,
  standaloneOutputFiles,
});
