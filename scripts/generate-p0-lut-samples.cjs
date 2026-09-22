const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const fixturesRoot = path.join(projectRoot, 'tests', 'fixtures', 'luts');

const clamp = (value) => Math.min(1, Math.max(0, value));
const formatNumber = (value) => {
  const normalized = Math.abs(value) < 0.0000005 ? 0 : value;
  return normalized.toFixed(6);
};

const entries = [];

function writeFixture(relativePath, content, metadata) {
  const absolutePath = path.join(fixturesRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${content.trimEnd()}\n`, 'utf8');
  entries.push({ relativePath: relativePath.replaceAll('\\', '/'), ...metadata });
}

function copyExternalFixture({ relativePath, sourcePath, metadata }) {
  const absolutePath = path.join(fixturesRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.copyFileSync(sourcePath, absolutePath);
  entries.push({ relativePath: relativePath.replaceAll('\\', '/'), ...metadata });
}

function create3dCube({
  relativePath,
  title,
  size,
  transform,
  domainMin = [0, 0, 0],
  domainMax = [1, 1, 1],
  metadata,
}) {
  const lines = [
    '# Generated for Real Landscape P0 LUT compatibility testing.',
    '# RGB order: red changes fastest, followed by green, then blue.',
    `TITLE "${title}"`,
    `LUT_3D_SIZE ${size}`,
    `DOMAIN_MIN ${domainMin.map(formatNumber).join(' ')}`,
    `DOMAIN_MAX ${domainMax.map(formatNumber).join(' ')}`,
    '',
  ];

  for (let blueIndex = 0; blueIndex < size; blueIndex += 1) {
    for (let greenIndex = 0; greenIndex < size; greenIndex += 1) {
      for (let redIndex = 0; redIndex < size; redIndex += 1) {
        const position = [redIndex, greenIndex, blueIndex].map((index, channel) => {
          const unit = index / (size - 1);
          return domainMin[channel] + unit * (domainMax[channel] - domainMin[channel]);
        });
        lines.push(transform(position).map(formatNumber).join(' '));
      }
    }
  }

  writeFixture(relativePath, lines.join('\n'), {
    title,
    lutType: '3d',
    gridSize: size,
    domainMin,
    domainMax,
    ...metadata,
  });
}

const identity = (rgb) => rgb;
const warmPortrait = ([red, green, blue]) => [
  clamp(red * 1.025 + green * 0.012),
  clamp(green * 1.005 + red * 0.004),
  clamp(blue * 0.94 + green * 0.012),
];
const coolLandscape = ([red, green, blue]) => [
  clamp(red * 0.955 + green * 0.006),
  clamp(green * 1.015 + blue * 0.006),
  clamp(blue * 1.045 + green * 0.008),
];
const contrastCurve = (value) => clamp(value + 0.18 * (value - 0.5) * 4 * value * (1 - value));
const cleanContrast = ([red, green, blue]) => [
  contrastCurve(red),
  contrastCurve(green),
  contrastCurve(blue),
];

for (const size of [17, 33, 65]) {
  create3dCube({
    relativePath: `valid/identity-${size}.cube`,
    title: `P0 Identity ${size}`,
    size,
    transform: identity,
    metadata: {
      sampleClass: 'valid-identity',
      expectedStatus: 'accepted',
      expectedCode: 'valid-3d-cube',
      inputColorSpace: 'sRGB SDR (normalized test values)',
      outputColorSpace: 'sRGB SDR (normalized test values)',
      author: 'Real Landscape P0 fixture generator',
      source: 'project-generated',
    },
  });
}

for (const sample of [
  ['creative/warm-portrait-17.cube', 'P0 Warm Portrait', warmPortrait],
  ['creative/cool-landscape-17.cube', 'P0 Cool Landscape', coolLandscape],
  ['creative/clean-contrast-17.cube', 'P0 Clean Contrast', cleanContrast],
]) {
  create3dCube({
    relativePath: sample[0],
    title: sample[1],
    size: 17,
    transform: sample[2],
    metadata: {
      sampleClass: 'valid-creative',
      expectedStatus: 'accepted',
      expectedCode: 'valid-3d-cube',
      inputColorSpace: 'sRGB SDR',
      outputColorSpace: 'sRGB SDR',
      author: 'Real Landscape P0 fixture generator',
      source: 'project-generated',
      notes: 'Synthetic compatibility sample; not a camera-brand emulation.',
    },
  });
}

create3dCube({
  relativePath: 'edge/domain-quarter-to-three-quarters-4.cube',
  title: 'P0 Partial Positive Domain',
  size: 4,
  domainMin: [0.25, 0.25, 0.25],
  domainMax: [0.75, 0.75, 0.75],
  transform: identity,
  metadata: {
    sampleClass: 'valid-domain-edge',
    expectedStatus: 'accepted',
    expectedCode: 'valid-3d-cube-custom-domain',
    inputColorSpace: 'unspecified numeric test domain',
    outputColorSpace: 'unspecified numeric test domain',
    author: 'Real Landscape P0 fixture generator',
    source: 'project-generated',
  },
});

create3dCube({
  relativePath: 'edge/domain-negative-to-positive-4.cube',
  title: 'P0 Signed Domain',
  size: 4,
  domainMin: [-1, -1, -1],
  domainMax: [1, 1, 1],
  transform: identity,
  metadata: {
    sampleClass: 'valid-format-unsupported-render-range',
    expectedStatus: 'recognized-but-rejected-for-p1-sdr',
    expectedCode: 'unsupported-sdr-value-range',
    inputColorSpace: 'unspecified signed numeric test domain',
    outputColorSpace: 'unspecified signed numeric test domain',
    author: 'Real Landscape P0 fixture generator',
    source: 'project-generated',
    notes:
      'The syntax is valid; P1 SDR policy should reject values outside 0..1 without truncating them.',
  },
});

const cube2Header = (title) => [
  `TITLE "${title}"`,
  'LUT_3D_SIZE 2',
  'DOMAIN_MIN 0.000000 0.000000 0.000000',
  'DOMAIN_MAX 1.000000 1.000000 1.000000',
  '',
];
const cube2Rows = [
  '0.000000 0.000000 0.000000',
  '1.000000 0.000000 0.000000',
  '0.000000 1.000000 0.000000',
  '1.000000 1.000000 0.000000',
  '0.000000 0.000000 1.000000',
  '1.000000 0.000000 1.000000',
  '0.000000 1.000000 1.000000',
  '1.000000 1.000000 1.000000',
];

const invalidFixtures = [
  {
    file: 'invalid/missing-data-row.cube',
    title: 'P0 Missing Data Row',
    content: [...cube2Header('P0 Missing Data Row'), ...cube2Rows.slice(0, -1)].join('\n'),
    code: 'data-count-mismatch',
  },
  {
    file: 'invalid/extra-data-row.cube',
    title: 'P0 Extra Data Row',
    content: [...cube2Header('P0 Extra Data Row'), ...cube2Rows, cube2Rows[0]].join('\n'),
    code: 'data-count-mismatch',
  },
  {
    file: 'invalid/non-finite-value.cube',
    title: 'P0 Non-finite Value',
    content: [
      ...cube2Header('P0 Non-finite Value'),
      ...cube2Rows.slice(0, 3),
      'NaN 1.000000 0.000000',
      ...cube2Rows.slice(4),
    ].join('\n'),
    code: 'non-finite-data',
  },
  {
    file: 'invalid/one-dimensional.cube',
    title: 'P0 One-dimensional LUT',
    content: [
      'TITLE "P0 One-dimensional LUT"',
      'LUT_1D_SIZE 2',
      '0.000000 0.000000 0.000000',
      '1.000000 1.000000 1.000000',
    ].join('\n'),
    code: 'unsupported-1d-lut',
  },
  {
    file: 'invalid/combined-one-and-three-dimensional.cube',
    title: 'P0 Combined 1D and 3D LUT',
    content: [
      'TITLE "P0 Combined 1D and 3D LUT"',
      'LUT_1D_SIZE 2',
      'LUT_3D_SIZE 2',
      '0.000000 0.000000 0.000000',
      '1.000000 1.000000 1.000000',
      ...cube2Rows,
    ].join('\n'),
    code: 'unsupported-combined-lut',
  },
  {
    file: 'invalid/unknown-directive.cube',
    title: 'P0 Unknown Directive',
    content: [
      ...cube2Header('P0 Unknown Directive'),
      'PROJECT_ONLY_DIRECTIVE 1',
      ...cube2Rows,
    ].join('\n'),
    code: 'unsupported-directive',
  },
  {
    file: 'invalid/reversed-domain.cube',
    title: 'P0 Reversed Domain',
    content: [
      'TITLE "P0 Reversed Domain"',
      'LUT_3D_SIZE 2',
      'DOMAIN_MIN 1.000000 1.000000 1.000000',
      'DOMAIN_MAX 0.000000 0.000000 0.000000',
      '',
      ...cube2Rows,
    ].join('\n'),
    code: 'invalid-domain-order',
  },
  {
    file: 'invalid/wrong-column-count.cube',
    title: 'P0 Wrong Column Count',
    content: [
      ...cube2Header('P0 Wrong Column Count'),
      '0.000000 0.000000 0.000000 1.000000',
      ...cube2Rows.slice(1),
    ].join('\n'),
    code: 'invalid-data-column-count',
  },
];

for (const fixture of invalidFixtures) {
  writeFixture(fixture.file, fixture.content, {
    title: fixture.title,
    sampleClass: 'invalid-or-unsupported',
    expectedStatus: 'rejected',
    expectedCode: fixture.code,
    lutType:
      fixture.code === 'unsupported-1d-lut'
        ? '1d'
        : fixture.code === 'unsupported-combined-lut'
          ? '1d-and-3d'
          : '3d',
    gridSize: 2,
    inputColorSpace: 'test-only',
    outputColorSpace: 'test-only',
    author: 'Real Landscape P0 fixture generator',
    source: 'project-generated',
  });
}

const externalSourceRoot = path.join(fixturesRoot, 'external-source');
if (fs.existsSync(externalSourceRoot)) {
  for (const fixture of [
    {
      sourceFile: 'ocio-iridas-3d.cube',
      outputFile: 'external/ocio-iridas-3d.cube',
      title: 'OpenColorIO IRIDAS 3D test LUT',
      lutType: '3d',
      gridSize: 2,
      expectedStatus: 'recognized-but-rejected-for-p1-sdr',
      expectedCode: 'unsupported-sdr-value-range',
      notes:
        'Valid real-world CUBE dialect sample with non-default domains and output values above 1.',
    },
    {
      sourceFile: 'ocio-iridas-1d.cube',
      outputFile: 'external/ocio-iridas-1d.cube',
      title: 'OpenColorIO IRIDAS 1D test LUT',
      lutType: '1d',
      gridSize: 5,
      expectedStatus: 'rejected',
      expectedCode: 'unsupported-1d-lut',
      notes: 'Valid 1D CUBE dialect sample, intentionally outside the P1 3D subset.',
    },
    {
      sourceFile: 'ocio-resolve-1d3d.cube',
      outputFile: 'external/ocio-resolve-1d3d.cube',
      title: 'OpenColorIO Resolve combined 1D/3D test LUT',
      lutType: '1d-and-3d',
      gridSize: 3,
      expectedStatus: 'rejected',
      expectedCode: 'unsupported-combined-lut',
      notes:
        'Valid Resolve-style combined LUT using input-range directives, outside the P1 subset.',
    },
  ]) {
    const sourcePath = path.join(externalSourceRoot, fixture.sourceFile);
    if (!fs.existsSync(sourcePath)) continue;
    copyExternalFixture({
      relativePath: fixture.outputFile,
      sourcePath,
      metadata: {
        title: fixture.title,
        sampleClass: 'external-format-reference',
        expectedStatus: fixture.expectedStatus,
        expectedCode: fixture.expectedCode,
        lutType: fixture.lutType,
        gridSize: fixture.gridSize,
        inputColorSpace: 'test numeric domain; not a display color-space declaration',
        outputColorSpace: 'test numeric domain; not a display color-space declaration',
        author: 'OpenColorIO contributors',
        source:
          'https://github.com/AcademySoftwareFoundation/OpenColorIO/tree/main/tests/data/files',
        license: 'BSD-3-Clause; see external-source/NOTICE.txt',
        notes: fixture.notes,
      },
    });
  }
}

const manifestEntries = entries
  .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  .map((entry) => {
    const absolutePath = path.join(fixturesRoot, entry.relativePath);
    const bytes = fs.readFileSync(absolutePath);
    return {
      path: entry.relativePath,
      ...Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'relativePath')),
      bytes: bytes.length,
      lines: fs.readFileSync(absolutePath, 'utf8').trimEnd().split(/\r?\n/).length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  });

const manifest = {
  schemaVersion: 1,
  fixtureSet: 'Real Landscape P0-1 LUT samples',
  generatedFor: 'personal learning and local compatibility research',
  generatedOn: '2026-09-10',
  rgbOrdering: 'red-fastest, green-middle, blue-slowest',
  entries: manifestEntries,
};

fs.writeFileSync(
  path.join(fixturesRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);

const accepted = manifestEntries.filter((entry) => entry.expectedStatus === 'accepted').length;
const boundary = manifestEntries.filter(
  (entry) => entry.expectedStatus === 'recognized-but-rejected-for-p1-sdr'
).length;
const rejected = manifestEntries.filter((entry) => entry.expectedStatus === 'rejected').length;
console.log(
  `Generated ${manifestEntries.length} LUT fixtures: ${accepted} accepted, ${boundary} policy boundary, ${rejected} rejected.`
);
