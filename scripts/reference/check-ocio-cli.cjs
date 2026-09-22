'use strict';

const { execFileSync } = require('node:child_process');

const command = process.env.OCIO_BAKELUT || 'ociobakelut';
try {
  const output = execFileSync(command, ['--help'], { encoding: 'utf8', windowsHide: true });
  if (!/bake|lut/i.test(output)) throw new Error('unexpected command output');
  console.log(JSON.stringify({ command, status: 'available', scope: 'development-and-CI-only' }));
} catch (error) {
  console.error(
    `OpenColorIO reference CLI is unavailable (${command}). Install a reviewed OpenColorIO build and set OCIO_BAKELUT to ociobakelut before P3-1 conversion comparisons.`
  );
  process.exitCode = 1;
}
