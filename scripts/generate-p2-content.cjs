'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.join(root, 'assets', 'color-grade', 'p2-builtin-filters');
const size = 17;

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeLut({ id, title, scenes, transform }) {
  const rows = [
    '# Real Landscape P2 self-developed content. Do not label as an official or original brand LUT.',
    '# License: project-owned content, redistribution permitted with this notice.',
    `TITLE "${title}"`,
    `# Internal ID: ${id}`,
    'LUT_3D_SIZE 17',
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        const output = transform(red / (size - 1), green / (size - 1), blue / (size - 1));
        rows.push(output.map((value) => clamp(value).toFixed(7)).join(' '));
      }
    }
  }
  const file = path.join(outputDirectory, `${id}.cube`);
  fs.writeFileSync(file, `${rows.join('\n')}\n`, 'utf8');
  return {
    id,
    title,
    scenes,
    path: path.relative(root, file).replace(/\\/g, '/'),
    sha256: hash(file),
    bytes: fs.statSync(file).size,
    gridSize: size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    ordering: 'red-fastest',
    interpolation: 'trilinear',
  };
}

fs.mkdirSync(outputDirectory, { recursive: true });
const entries = [
  writeLut({
    id: 'soft-portrait',
    title: '柔和肖像',
    scenes: ['人像', '日常'],
    transform: (red, green, blue) => [
      red * 1.015 + green * 0.012 + 0.008,
      green * 1.002 + red * 0.004 + 0.002,
      blue * 0.96 + red * 0.012 + 0.006,
    ],
  }),
  writeLut({
    id: 'clear-landscape',
    title: '清澈风景',
    scenes: ['风景', '天空', '植被'],
    transform: (red, green, blue) => [
      red * 0.975 + green * 0.008,
      green * 1.045 + blue * 0.012,
      blue * 1.04 + green * 0.008 + 0.004,
    ],
  }),
  writeLut({
    id: 'gentle-highlight',
    title: '柔光层次',
    scenes: ['静物', '高光', '城市'],
    transform: (red, green, blue) => {
      const soften = (value) => value + 0.075 * value * (1 - value);
      return [soften(red) * 1.01, soften(green), soften(blue) * 0.985 + red * 0.006];
    },
  }),
];
const manifest = {
  schemaVersion: 1,
  generatedOn: new Date().toISOString().slice(0, 10),
  author: 'Real Landscape',
  origin: 'self-developed',
  license: 'project-owned; redistribution permitted with LICENSE.md',
  entries,
};
fs.writeFileSync(
  path.join(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(JSON.stringify(manifest, null, 2));
