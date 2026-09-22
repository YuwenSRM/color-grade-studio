'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'color-grade', 'color-grade-intent.js'),
    'utf8'
  ),
  context
);
const Intent = context.window.ColorGradeIntent;

test('P3 intent parser recognizes bilingual looks and deterministic native commands', () => {
  assert.deepEqual([...Intent.parse('暖调胶片').looks], ['look.warm-film']);
  assert.deepEqual([...Intent.parse('Tokyo night').looks], ['look.tokyo-night']);
  assert.deepEqual([...Intent.parse('Teal & Orange').looks], ['look.teal-orange']);
  const result = Intent.parse('曝光 +20 Contrast -10 Exposure = 5', { exposure: 2, contrast: 9 });
  assert.deepEqual({ ...result.intentPatch }, { exposure: 5, contrast: -1 });
  assert.equal(result.executable, true);
});

test('P3 intent parser clamps once, limits commands, and leaves unsupported units as search-only', () => {
  assert.equal(Intent.parse('Temp -15', { temperature: 8 }).intentPatch.temperature, -7);
  assert.equal(Intent.parse('Exposure +500', { exposure: 0 }).intentPatch.exposure, 100);
  for (const value of ['Exposure +0.7 EV', 'Temp +400 K', 'Blue Sat -12']) {
    const result = Intent.parse(value, { exposure: 17, temperature: 3 });
    assert.equal(result.executable, false, value);
    assert.deepEqual({ ...result.intentPatch }, {}, value);
    assert.equal(result.unsupported, true, value);
  }
});
