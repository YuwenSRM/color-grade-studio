'use strict';

const fs = require('node:fs');
const path = require('node:path');

const required = [
  ['P3_12MP_IMAGE', 12],
  ['P3_24MP_IMAGE', 24],
];
const fixtures = required.map(([name, megapixels]) => ({
  name,
  megapixels,
  path: process.env[name] || '',
}));
const missing = fixtures.filter((fixture) => !fixture.path || !fs.existsSync(fixture.path));

if (missing.length) {
  console.log(
    JSON.stringify(
      {
        status: 'skipped',
        reason: 'Authorized 12MP and 24MP SDR sRGB fixtures were not both supplied.',
        required: required.map(([name]) => name),
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(
  JSON.stringify(
    {
      status: 'blocked',
      reason:
        'Fixtures were supplied, but this candidate has no approved P95 or memory budget to certify.',
      fixtures: fixtures.map((fixture) => ({
        megapixels: fixture.megapixels,
        filename: path.basename(fixture.path),
        bytes: fs.statSync(fixture.path).size,
      })),
    },
    null,
    2
  )
);
