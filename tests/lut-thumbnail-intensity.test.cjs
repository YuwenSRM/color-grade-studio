'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'color-grade', 'workbench', 'filter-library.js'),
  'utf8'
);

test('LUT library thumbnails remain fixed full-strength samples', () => {
  const thumbnailBranch = source.slice(
    source.indexOf("if (variant.kind === 'lut') {", source.indexOf('function runThumbnail'))
  );
  assert.match(thumbnailBranch, /intensity: 1,/);
  assert.doesNotMatch(source, /refreshLutThumbnails/);
});
