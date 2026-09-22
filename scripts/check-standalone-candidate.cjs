'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const runtimeManifest = require('./standalone-runtime-manifest.cjs');

const root = path.resolve(__dirname, '..');
const standalone = path.join(root, 'dist', 'standalone');
const candidate = path.join(root, 'dist', 'standalone-candidate');
const manifestPath = path.join(candidate, 'MANIFEST.json');
const forbidden =
  /(^|\/)\.env(?:\.[^/]+)?(?:\/|$)|(^|\/)(?:data|uploads|image-library|node_modules|tests)(?:\/|$)|(^|\/)(?:serve\.js|package-lock\.json)$/i;
const remoteNetworkCall = /(?:fetch|WebSocket|EventSource)\s*\(\s*['"`](?:https?:)?\/\//i;
const apiReference = /LandscapeApi|\/api\/|uploadImage\(/;
const forbiddenRoute =
  /(?:^|['"`])(?:\.\.?\/)?(?:login|account)(?:\.html)?(?:[?#][^'"`]*)?(?=['"`])/i;
const forbiddenAccountUi = /\b(?:colorAccount|colorLogin)\b/;
const launcherFiles = ['ColorGradeStudio.cmd', 'ColorGradeStudio.ps1', 'ColorGradeStudio.vbs'];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

function relative(file) {
  return path.relative(candidate, file).replaceAll(path.sep, '/');
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Candidate package is missing. Run npm run package:standalone first.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.build.deterministic, true);
  assert.equal(manifest.build.timestamp, null);
  assert.ok(
    Array.isArray(manifest.files) && manifest.files.length > 0,
    'manifest has no package files'
  );
  const failures = [];
  const sourceBuildPath = path.join(standalone, 'BUILD.json');
  const candidateBuildPath = path.join(candidate, 'app', 'BUILD.json');
  if (!fs.existsSync(sourceBuildPath) || !fs.existsSync(candidateBuildPath)) {
    failures.push('BUILD.json: source or candidate build record is missing');
  } else {
    const expectedBuild = runtimeManifest.createRuntimeBuild(root);
    const sourceBuild = fs.readFileSync(sourceBuildPath);
    const candidateBuild = fs.readFileSync(candidateBuildPath);
    if (sourceBuild.compare(candidateBuild) !== 0)
      failures.push('BUILD.json: candidate app differs from current standalone output');
    let parsedBuild;
    try {
      parsedBuild = JSON.parse(sourceBuild.toString('utf8'));
    } catch (_) {
      failures.push('BUILD.json: current standalone build record is invalid');
    }
    if (parsedBuild && JSON.stringify(parsedBuild) !== JSON.stringify(expectedBuild))
      failures.push('BUILD.json: current standalone output is stale');
    if (manifest.build.runtimeBuildId !== expectedBuild.runtimeBuildId)
      failures.push('runtimeBuildId: candidate was not built from the current runtime inputs');
    const expectedCandidate = runtimeManifest.createCandidateSource(
      root,
      expectedBuild.runtimeBuildId
    );
    if (manifest.build.candidateSourceId !== expectedCandidate.candidateSourceId)
      failures.push('candidateSourceId: candidate package inputs are stale');
  }
  for (const launcher of launcherFiles) {
    if (!fs.existsSync(path.join(candidate, launcher)))
      failures.push(`${launcher}: launcher entry is missing`);
  }
  const manifestPaths = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || !entry.path || manifestPaths.has(entry.path)) {
      failures.push(`${entry?.path || '<invalid>'}: invalid or duplicate manifest path`);
      continue;
    }
    manifestPaths.add(entry.path);
    if (forbidden.test(entry.path)) failures.push(`${entry.path}: forbidden package path`);
    const file = path.resolve(candidate, entry.path);
    if (!file.startsWith(`${candidate}${path.sep}`) || !fs.existsSync(file)) {
      failures.push(`${entry.path}: manifest target missing`);
      continue;
    }
    const content = fs.readFileSync(file);
    if (content.length !== entry.bytes || sha256(content) !== entry.sha256) {
      failures.push(`${entry.path}: hash mismatch`);
    }
    if (/\.(?:html|js|cjs|css)$/i.test(entry.path)) {
      const text = content.toString('utf8');
      if (apiReference.test(text)) failures.push(`${entry.path}: full-project API reference`);
      if (entry.path.startsWith('app/') && forbiddenRoute.test(text))
        failures.push(`${entry.path}: login or account route reference`);
      if (entry.path.startsWith('app/') && forbiddenAccountUi.test(text))
        failures.push(`${entry.path}: full-mode account UI`);
      if (entry.path.startsWith('app/') && remoteNetworkCall.test(text)) {
        failures.push(`${entry.path}: unexpected remote network call`);
      }
    }
  }
  const actualPaths = new Set(
    files(candidate)
      .map(relative)
      .filter((entry) => entry !== 'MANIFEST.json')
  );
  for (const entry of actualPaths) {
    if (!manifestPaths.has(entry)) failures.push(`${entry}: package file missing from manifest`);
    if (forbidden.test(entry)) failures.push(`${entry}: forbidden package path`);
  }
  for (const entry of manifestPaths) {
    if (!actualPaths.has(entry)) failures.push(`${entry}: manifest path missing from package`);
  }
  const launcher = path.join(candidate, 'ColorGradeStudio.ps1');
  if (fs.existsSync(launcher)) {
    const source = fs.readFileSync(launcher, 'utf8');
    if (!source.includes('http://127.0.0.1:'))
      failures.push('ColorGradeStudio.ps1: launcher is not pinned to loopback');
    if (!source.includes('Get-ValidatedPackage'))
      failures.push('ColorGradeStudio.ps1: launcher is missing package validation');
  }
  if (failures.length)
    throw new Error(`Standalone candidate audit failed:\n${failures.join('\n')}`);
  console.log(
    JSON.stringify({ files: manifest.files.length, status: 'candidate-audited' }, null, 2)
  );
}

main();
