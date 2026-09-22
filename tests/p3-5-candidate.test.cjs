'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const candidate = path.join(root, 'dist', 'standalone-candidate');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

test('P3-5 candidate has deterministic audit metadata and required disclosure files', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'MANIFEST.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.build.deterministic, true);
  assert.equal(manifest.build.timestamp, null);
  assert.match(manifest.build.packageLockSha256, /^[a-f0-9]{64}$/);
  const paths = new Set(manifest.files.map((entry) => entry.path));
  for (const required of [
    'README.md',
    '使用说明.md',
    'SBOM.json',
    'LICENSES/application-assets.md',
    'docs/release-notes.md',
    'docs/support.md',
    'docs/privacy.md',
    'ColorGradeStudio.vbs',
    'ColorGradeStudio.cmd',
    'ColorGradeStudio.ps1',
    'app/index.html',
  ]) {
    assert.ok(paths.has(required), `candidate missing ${required}`);
  }
  for (const legacyEntry of ['start.ps1', 'start.cmd', 'start-server.cjs', 'server.cjs']) {
    assert.ok(!paths.has(legacyEntry), `candidate includes obsolete ${legacyEntry}`);
  }
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(candidate, entry.path));
    assert.equal(bytes.length, entry.bytes, `${entry.path} byte count`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.path} hash`);
  }
});

test('P3-5 candidate documents its review-only runtime and core/UI boundary', () => {
  const releaseNotes = fs.readFileSync(path.join(candidate, 'docs', 'release-notes.md'), 'utf8');
  const privacy = fs.readFileSync(path.join(candidate, 'docs', 'privacy.md'), 'utf8');
  const support = fs.readFileSync(path.join(candidate, 'docs', 'support.md'), 'utf8');
  assert.match(releaseNotes, /not an externally released installer/i);
  assert.match(releaseNotes, /not wired into this standalone page/i);
  assert.match(privacy, /IndexedDB/i);
  assert.match(privacy, /Back up my filters/i);
  assert.match(support, /SDR sRGB only/i);
});

test('P3-5 launcher is loopback-only and rejects port collisions', () => {
  const launcher = fs.readFileSync(path.join(candidate, 'ColorGradeStudio.ps1'), 'utf8');
  assert.match(launcher, /\$DefaultPort = 4174/);
  assert.match(launcher, /\$listener\.Prefixes\.Add\("http:\/\/127\.0\.0\.1:\$DefaultPort\/"\)/);
  assert.match(launcher, /端口 \$DefaultPort 已被其他应用占用/);
  assert.doesNotMatch(launcher, /0\.0\.0\.0/);
});

test('P3-5 candidate audit rejects unlisted files and nested environment files', () => {
  const injected = path.join(candidate, 'app', '.env.audit-test');
  fs.writeFileSync(injected, 'SHOULD_NOT_SHIP=true\n', 'utf8');
  try {
    assert.throws(
      () =>
        execFileSync(process.execPath, ['scripts/check-standalone-candidate.cjs'], {
          cwd: root,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      /Standalone candidate audit failed/
    );
  } finally {
    fs.rmSync(injected, { force: true });
  }
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, ['scripts/check-standalone-candidate.cjs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    })
  );
});
