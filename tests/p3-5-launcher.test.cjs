'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const candidate = path.join(root, 'dist', 'standalone-candidate');

test('candidate includes the no-Node loopback launcher and documents its boundary', () => {
  const launcher = path.join(candidate, 'ColorGradeStudio.ps1');
  const command = path.join(candidate, 'ColorGradeStudio.cmd');
  const hiddenEntry = path.join(candidate, 'ColorGradeStudio.vbs');
  const readme = path.join(candidate, 'README.md');
  const guide = path.join(candidate, 'docs', 'launcher.md');

  for (const file of [launcher, command, hiddenEntry, readme, guide]) {
    assert.ok(fs.existsSync(file), `missing candidate launcher artifact: ${path.basename(file)}`);
  }

  const source = fs.readFileSync(launcher, 'utf8');
  assert.match(source, /http:\/\/127\.0\.0\.1:\$DefaultPort\//);
  assert.match(source, /Get-ValidatedPackage/);
  assert.match(source, /Security\.Cryptography\.SHA256/);
  assert.match(source, /ColorGradeStudio\\Launcher/);
  assert.doesNotMatch(source, /0\.0\.0\.0|--root|--static-dir/i);
  assert.match(fs.readFileSync(hiddenEntry, 'utf8'), /WindowStyle Hidden/);
  assert.match(fs.readFileSync(readme, 'utf8'), /Node\.js is not needed/);
});
