'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = require('../scripts/standalone-runtime-manifest.cjs');
const dist = path.join(root, 'dist', 'standalone');
const candidate = path.join(root, 'dist', 'standalone-candidate');

test('runtimeBuildId and candidateSourceId are deterministic source-derived identifiers', () => {
  const first = manifest.createRuntimeBuild(root);
  const second = manifest.createRuntimeBuild(root);
  assert.deepEqual(first, second);
  assert.match(first.runtimeBuildId, /^[a-f0-9]{64}$/);
  const candidateFirst = manifest.createCandidateSource(root, first.runtimeBuildId);
  const candidateSecond = manifest.createCandidateSource(root, second.runtimeBuildId);
  assert.deepEqual(candidateFirst, candidateSecond);
  assert.match(candidateFirst.candidateSourceId, /^[a-f0-9]{64}$/);
});

test('built standalone and candidate artifacts carry the current identical BUILD.json', (t) => {
  const sourceBuild = path.join(dist, 'BUILD.json');
  const candidateBuild = path.join(candidate, 'app', 'BUILD.json');
  if (!fs.existsSync(sourceBuild) || !fs.existsSync(candidateBuild)) {
    t.skip('release artifacts are built by verify:standalone-release');
    return;
  }
  const expected = manifest.createRuntimeBuild(root);
  const sourceBytes = fs.readFileSync(sourceBuild);
  assert.equal(JSON.stringify(JSON.parse(sourceBytes)), JSON.stringify(expected));
  assert.deepEqual(fs.readFileSync(candidateBuild), sourceBytes);
  const packageManifest = JSON.parse(
    fs.readFileSync(path.join(candidate, 'MANIFEST.json'), 'utf8')
  );
  assert.equal(packageManifest.build.runtimeBuildId, expected.runtimeBuildId);
  assert.equal(
    packageManifest.build.candidateSourceId,
    manifest.createCandidateSource(root, expected.runtimeBuildId).candidateSourceId
  );
});
