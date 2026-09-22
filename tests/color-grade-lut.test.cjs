const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  validateText,
  validateBytes,
  validateFile,
  CubeLutError,
  limits,
  codes,
} = require('../assets/color-grade/color-grade-lut.js');

const fixturesRoot = path.join(__dirname, 'fixtures', 'luts');
const manifest = JSON.parse(fs.readFileSync(path.join(fixturesRoot, 'manifest.json'), 'utf8'));
const maxFileBytes = 20 * 1024 * 1024;

const identityRows = ['0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'];

function cube2({
  title = 'Inline fixture',
  includeTitle = true,
  domainMin,
  domainMax,
  rows = identityRows,
  prefix = [],
  suffix = [],
} = {}) {
  const lines = [...prefix];
  if (includeTitle) lines.push(`TITLE "${title}"`);
  lines.push('LUT_3D_SIZE 2');
  if (domainMin) lines.push(`DOMAIN_MIN ${domainMin.join(' ')}`);
  if (domainMax) lines.push(`DOMAIN_MAX ${domainMax.join(' ')}`);
  lines.push(...rows, ...suffix);
  return `${lines.join('\n')}\n`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertErrorShape(result, expected = {}) {
  assert.equal(result.ok, false);
  assert.equal(result.status, expected.status || 'rejected');
  if (expected.code) assert.equal(result.code, expected.code);
  assert.equal(typeof result.code, 'string');
  assert.ok(Object.values(codes).includes(result.code), `${result.code} must be exported in codes`);
  assert.ok(result.error instanceof CubeLutError);
  assert.ok(result.error instanceof Error);
  assert.equal(result.error.code, result.code);
  assert.equal(typeof result.error.stage, 'string');
  assert.ok(result.error.stage.length > 0);
  assert.ok(Object.hasOwn(result.error, 'line'));
  assert.ok(result.error.line === null || Number.isInteger(result.error.line));
  assert.ok(Object.hasOwn(result.error, 'directive'));
  assert.ok(result.error.directive === null || typeof result.error.directive === 'string');
  assert.ok(Object.hasOwn(result.error, 'details'));
  assert.equal(result.stage, result.error.stage);
  assert.equal(result.line, result.error.line);
  assert.equal(result.directive, result.error.directive);
  assert.deepEqual(result.details, result.error.details);
  if (expected.line !== undefined) assert.equal(result.error.line, expected.line);
  if (expected.directive !== undefined) assert.equal(result.error.directive, expected.directive);
}

function assertAccepted(result, expected = {}) {
  assert.equal(result.ok, true);
  assert.equal(result.status, 'accepted');
  assert.equal(result.code, expected.code || 'valid-3d-cube');
  assert.equal(result.lut.title, expected.title === undefined ? 'Inline fixture' : expected.title);
  assert.equal(result.lut.gridSize, expected.gridSize || 2);
  assert.deepEqual(Array.from(result.lut.domainMin), expected.domainMin || [0, 0, 0]);
  assert.deepEqual(Array.from(result.lut.domainMax), expected.domainMax || [1, 1, 1]);
  assert.ok(result.lut.values instanceof Float64Array);
  assert.equal(result.lut.values.length, (expected.gridSize || 2) ** 3 * 3);
  assert.equal(result.lut.ordering, 'red-fastest');
  assert.match(result.lut.sha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof result.lut.sourceBytes, 'number');
}

function fileLike(name, bytes, declaredSize = bytes.byteLength) {
  let reads = 0;
  return {
    file: {
      name,
      size: declaredSize,
      async arrayBuffer() {
        reads += 1;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    },
    reads: () => reads,
  };
}

test('exports the synchronous parser contract and frozen P0 limits', () => {
  assert.equal(typeof validateText, 'function');
  assert.equal(typeof validateBytes, 'function');
  assert.equal(typeof validateFile, 'function');
  assert.equal(typeof CubeLutError, 'function');
  assert.equal(CubeLutError.prototype instanceof Error, true);
  assert.equal(limits.minGridSize, 2);
  assert.equal(limits.maxGridSize, 65);
  assert.equal(limits.maxFileBytes, maxFileBytes);

  for (const code of [
    'valid-3d-cube',
    'valid-3d-cube-custom-domain',
    'data-count-mismatch',
    'non-finite-data',
    'unsupported-1d-lut',
    'unsupported-combined-lut',
    'unsupported-directive',
    'invalid-domain-order',
    'invalid-data-column-count',
    'unsupported-sdr-value-range',
    'file-too-large',
    'empty-file',
    'invalid-text-encoding',
    'read-failed',
    'operation-aborted',
    'unsupported-file-extension',
    'missing-3d-size',
    'invalid-grid-size',
    'duplicate-directive',
    'directive-after-data',
    'invalid-directive-arguments',
    'invalid-title',
    'data-before-size',
    'invalid-number',
  ]) {
    assert.ok(Object.values(codes).includes(code), `${code} must be exported in codes`);
  }
});

test('exposes the validator through its browser global without page integration', () => {
  const context = vm.createContext({ TextDecoder, TextEncoder });
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'color-grade', 'color-grade-lut.js'),
    'utf8'
  );
  vm.runInContext(source, context);

  assert.equal(typeof context.ColorGradeLut.validateText, 'function');
  assert.equal(Object.isFrozen(context.ColorGradeLut), true);
  const result = context.ColorGradeLut.validateText(cube2({ title: 'Browser UMD' }));
  assert.equal(result.ok, true);
  assert.equal(result.lut.title, 'Browser UMD');
});

test('keeps diagnostics available after a Worker-style structured clone', () => {
  const result = validateText('LUT_3D_SIZE 2\n0 0 0 0\n');
  assertErrorShape(result, {
    code: 'invalid-data-column-count',
    line: 2,
  });

  const cloned = structuredClone(result);
  assert.equal(cloned.code, result.code);
  assert.equal(cloned.stage, result.stage);
  assert.equal(cloned.line, result.line);
  assert.equal(cloned.directive, result.directive);
  assert.deepEqual(cloned.details, result.details);
});

test('validates every P0-1 manifest sample once, including the 65-point LUT', () => {
  const seen = new Set();

  for (const entry of manifest.entries) {
    assert.equal(seen.has(entry.path), false, `${entry.path}: duplicate manifest path`);
    seen.add(entry.path);

    const bytes = fs.readFileSync(path.join(fixturesRoot, ...entry.path.split('/')));
    const result = validateBytes(bytes);
    assert.equal(result.ok, entry.expectedStatus === 'accepted', `${entry.path}: ok`);
    assert.equal(result.status, entry.expectedStatus, `${entry.path}: status`);
    assert.equal(result.code, entry.expectedCode, `${entry.path}: code`);

    if (!result.ok) {
      assertErrorShape(result, {
        code: entry.expectedCode,
        status: entry.expectedStatus,
      });
      continue;
    }

    assertAccepted(result, {
      code: entry.expectedCode,
      title: entry.title,
      gridSize: entry.gridSize,
      domainMin: entry.domainMin,
      domainMax: entry.domainMax,
    });
    assert.equal(result.lut.values.length, entry.gridSize ** 3 * 3, `${entry.path}: values`);
    assert.equal(result.lut.sourceBytes, entry.bytes, `${entry.path}: source bytes`);
    assert.equal(result.lut.sha256, entry.sha256, `${entry.path}: SHA-256`);
  }

  assert.equal(seen.size, 19);
});

test('keeps type and line-error precedence stable for representative fixtures', () => {
  const cases = [
    ['invalid/combined-one-and-three-dimensional.cube', 'unsupported-combined-lut', 3],
    ['external/ocio-resolve-1d3d.cube', 'unsupported-combined-lut', 3],
    ['invalid/one-dimensional.cube', 'unsupported-1d-lut', 2],
    ['invalid/non-finite-value.cube', 'non-finite-data', 9],
    ['invalid/unknown-directive.cube', 'unsupported-directive', 6],
    ['invalid/wrong-column-count.cube', 'invalid-data-column-count', 6],
    ['invalid/reversed-domain.cube', 'invalid-domain-order', 4],
    ['invalid/extra-data-row.cube', 'data-count-mismatch', 14],
  ];

  for (const [relativePath, code, line] of cases) {
    const bytes = fs.readFileSync(path.join(fixturesRoot, ...relativePath.split('/')));
    assertErrorShape(validateBytes(bytes), { code, line });
  }

  assert.equal(
    manifest.entries.find(
      (entry) => entry.path === 'invalid/combined-one-and-three-dimensional.cube'
    ).lutType,
    '1d-and-3d'
  );
  assert.equal(
    manifest.entries.find((entry) => entry.path === 'invalid/one-dimensional.cube').lutType,
    '1d'
  );
});

test('accepts BOM, CRLF, tabs, inline comments, hashes inside TITLE, and exponent numbers', () => {
  const text = [
    '\uFEFF# header comment',
    'TITLE\t"Hash # remains"\t# trailing title comment',
    'LUT_3D_SIZE\t2\t# grid',
    'DOMAIN_MIN\t0\t0.0\t+0e0 # minimum',
    'DOMAIN_MAX\t1.\t1e0\t+1.0E+0 # maximum',
    '',
    '+0e0\t.0\t0. # row 0',
    '1e0\t0\t0 # row 1',
    '0\t+1.0\t.5 # row 2',
    '1\t1\t0 # row 3',
    '0\t0\t1 # row 4',
    '1\t0\t1 # row 5',
    '0\t1\t1 # row 6',
    '1\t1\t1 # row 7',
    '',
  ].join('\r\n');

  const result = validateText(text);
  assertAccepted(result, { title: 'Hash # remains' });
  assert.equal(result.lut.sourceBytes, Buffer.byteLength(text, 'utf8'));
  assert.equal(result.lut.sha256, sha256(Buffer.from(text, 'utf8')));
});

test('preserves ordinary backslashes and supported escapes in TITLE', () => {
  const pathTitle = validateText(cube2({ title: 'C:\\LUTs\\Look' }));
  assertAccepted(pathTitle, { title: 'C:\\LUTs\\Look' });

  const escapedTitle = validateText(cube2({ title: 'A \\"quoted\\" \\\\ look' }));
  assertAccepted(escapedTitle, { title: 'A "quoted" \\ look' });
});

test('TITLE is optional and omitted domains default independently to normalized SDR', () => {
  const noMetadata = validateText(cube2({ includeTitle: false }));
  assertAccepted(noMetadata, { title: null });

  const minimumOnly = validateText(cube2({ domainMin: [0.25, 0.125, 0.5] }));
  assertAccepted(minimumOnly, {
    code: 'valid-3d-cube-custom-domain',
    domainMin: [0.25, 0.125, 0.5],
    domainMax: [1, 1, 1],
  });

  const maximumOnly = validateText(cube2({ domainMax: [0.75, 0.875, 0.5] }));
  assertAccepted(maximumOnly, {
    code: 'valid-3d-cube-custom-domain',
    domainMin: [0, 0, 0],
    domainMax: [0.75, 0.875, 0.5],
  });
});

test('recognized directives may be reordered before data but never appear after data starts', () => {
  const reordered = [
    'DOMAIN_MAX 0.75 0.8 0.9',
    'TITLE "Reordered headers"',
    'LUT_3D_SIZE 2',
    'DOMAIN_MIN 0.1 0.2 0.3',
    ...identityRows,
    '',
  ].join('\n');
  assertAccepted(validateText(reordered), {
    code: 'valid-3d-cube-custom-domain',
    title: 'Reordered headers',
    domainMin: [0.1, 0.2, 0.3],
    domainMax: [0.75, 0.8, 0.9],
  });

  const afterData = [
    'LUT_3D_SIZE 2',
    identityRows[0],
    'DOMAIN_MIN 0 0 0',
    ...identityRows.slice(1),
  ].join('\n');
  const result = validateText(afterData);
  assertErrorShape(result, {
    code: 'directive-after-data',
    line: 3,
    directive: 'DOMAIN_MIN',
  });
});

test('preserves row order and declares red as the fastest-changing cube axis', () => {
  const rows = [
    '0.01 0.02 0.03',
    '0.11 0.12 0.13',
    '0.21 0.22 0.23',
    '0.31 0.32 0.33',
    '0.41 0.42 0.43',
    '0.51 0.52 0.53',
    '0.61 0.62 0.63',
    '0.71 0.72 0.73',
  ];
  const result = validateText(cube2({ title: 'Asymmetric axis probe', rows }));
  assertAccepted(result, { title: 'Asymmetric axis probe' });
  assert.equal(result.lut.ordering, 'red-fastest');

  const expected = rows.flatMap((row) => row.split(' ').map(Number));
  expected.forEach((value, index) => {
    assert.ok(Math.abs(result.lut.values[index] - value) < 1e-6, `value ${index}`);
  });
});

test('keeps parsed decimal precision for later storage and rendering decisions', () => {
  const precise = 0.12345678912345678;
  const result = validateText(cube2({ rows: [`${precise} 0 0`, ...identityRows.slice(1)] }));
  assertAccepted(result);
  assert.equal(result.lut.values[0], precise);
});

test('accepts grid endpoints and rejects sizes outside the 2..65 integer range', () => {
  assertAccepted(validateText(cube2()), { gridSize: 2 });

  const identity65 = manifest.entries.find((entry) => entry.path === 'valid/identity-65.cube');
  assert.equal(identity65.gridSize, limits.maxGridSize);
  assert.equal(identity65.expectedStatus, 'accepted');

  const invalid = ['1', '66', '2.0', '2.5'];
  const results = invalid.map((size) => validateText(`LUT_3D_SIZE ${size}\n`));
  results.forEach((result) =>
    assertErrorShape(result, {
      code: 'invalid-grid-size',
      line: 1,
      directive: 'LUT_3D_SIZE',
    })
  );

  for (const line of ['LUT_3D_SIZE', 'LUT_3D_SIZE 2 extra']) {
    assertErrorShape(validateText(`${line}\n`), {
      code: 'invalid-directive-arguments',
      line: 1,
      directive: 'LUT_3D_SIZE',
    });
  }

  assertErrorShape(validateText('TITLE "No size"\n'), {
    code: 'missing-3d-size',
    directive: 'LUT_3D_SIZE',
  });
  assertErrorShape(validateText(`${identityRows.join('\n')}\n`), {
    code: 'data-before-size',
    line: 1,
  });
});

test('rejects each repeated singleton directive with one stable duplicate code', () => {
  const cases = [
    ['TITLE', ['TITLE "First"', 'TITLE "Second"', 'LUT_3D_SIZE 2', ...identityRows]],
    ['LUT_3D_SIZE', ['LUT_3D_SIZE 2', 'LUT_3D_SIZE 2', ...identityRows]],
    ['DOMAIN_MIN', ['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MIN 0 0 0', ...identityRows]],
    ['DOMAIN_MAX', ['LUT_3D_SIZE 2', 'DOMAIN_MAX 1 1 1', 'DOMAIN_MAX 1 1 1', ...identityRows]],
  ];
  const results = cases.map(([directive, lines]) => {
    const result = validateText(`${lines.join('\n')}\n`);
    const directiveLines = lines
      .map((line, index) => (line.startsWith(directive) ? index + 1 : null))
      .filter(Boolean);
    const secondLine = directiveLines[1];
    assertErrorShape(result, {
      code: 'duplicate-directive',
      line: secondLine,
      directive,
    });
    return result;
  });

  assert.equal(new Set(results.map((result) => result.code)).size, 1);
});

test('uses strict decimal grammar and distinguishes malformed from non-finite data', () => {
  const malformed = ['0x0', '1_0', '1oops', '--1', '0,5'].map((token) =>
    validateText(cube2({ rows: [`${token} 0 0`, ...identityRows.slice(1)] }))
  );
  malformed.forEach((result) =>
    assertErrorShape(result, {
      code: 'invalid-number',
      line: 3,
    })
  );

  for (const token of ['NaN', 'Infinity', '+Infinity', '-Infinity', '1e309']) {
    const result = validateText(cube2({ rows: [`${token} 0 0`, ...identityRows.slice(1)] }));
    assertErrorShape(result, { code: 'non-finite-data', line: 3 });
  }
});

test('rejects empty input and an unterminated TITLE with distinct structural errors', () => {
  assertErrorShape(validateText(''), { code: 'empty-file' });
  assertErrorShape(validateText('  \r\n# comment only\r\n'), { code: 'empty-file' });
  assertErrorShape(validateText('TITLE "Unterminated\nLUT_3D_SIZE 2\n'), {
    code: 'invalid-title',
    line: 1,
    directive: 'TITLE',
  });
});

test('validates domain ordering per channel', () => {
  for (const [minimum, maximum] of [
    [
      [0, 0.5, 0],
      [1, 0.5, 1],
    ],
    [
      [0.6, 0, 0],
      [0.5, 1, 1],
    ],
  ]) {
    const result = validateText(cube2({ domainMin: minimum, domainMax: maximum }));
    assertErrorShape(result, {
      code: 'invalid-domain-order',
      directive: 'DOMAIN_MAX',
    });
  }

  const minimumOnly = validateText(cube2({ domainMin: [1, 0, 0] }));
  assertErrorShape(minimumOnly, {
    code: 'invalid-domain-order',
    line: 3,
    directive: 'DOMAIN_MIN',
  });
});

test('rejects out-of-range SDR domains and samples without clipping either', () => {
  const domainResult = validateText(
    cube2({
      domainMin: [-0.01, 0, 0],
      domainMax: [1, 1, 1],
    })
  );
  assertErrorShape(domainResult, {
    code: 'unsupported-sdr-value-range',
    status: 'recognized-but-rejected-for-p1-sdr',
  });

  for (const token of ['-0.0001', '1.0001', '-1e-9999', '1.00000000000000000001']) {
    const result = validateText(cube2({ rows: [`${token} 0 0`, ...identityRows.slice(1)] }));
    assertErrorShape(result, {
      code: 'unsupported-sdr-value-range',
      status: 'recognized-but-rejected-for-p1-sdr',
    });
  }

  for (const token of ['-0', '-0.000e9999', '0.0001e-9999', '1.00000000000000000000']) {
    assertAccepted(validateText(cube2({ rows: [`${token} 0 0`, ...identityRows.slice(1)] })));
  }
});

test('validateText hashes its exact UTF-8 bytes and validateBytes hashes raw newline bytes', () => {
  const lfText = cube2({ title: 'Hash probe' });
  const crlfText = lfText.replaceAll('\n', '\r\n');
  const noFinalNewlineText = lfText.trimEnd();
  const lfBytes = Buffer.from(lfText, 'utf8');
  const crlfBytes = Buffer.from(crlfText, 'utf8');
  const bomBytes = Buffer.from(`\uFEFF${lfText}`, 'utf8');

  const fromText = validateText(lfText);
  const fromLfBytes = validateBytes(lfBytes);
  const fromCrlfBytes = validateBytes(crlfBytes);
  const fromBomBytes = validateBytes(bomBytes);
  const withoutFinalNewline = validateText(noFinalNewlineText);
  assertAccepted(fromText, { title: 'Hash probe' });
  assertAccepted(fromLfBytes, { title: 'Hash probe' });
  assertAccepted(fromCrlfBytes, { title: 'Hash probe' });
  assertAccepted(fromBomBytes, { title: 'Hash probe' });
  assertAccepted(withoutFinalNewline, { title: 'Hash probe' });
  assert.equal(fromText.lut.sha256, sha256(lfBytes));
  assert.equal(fromLfBytes.lut.sha256, sha256(lfBytes));
  assert.equal(fromCrlfBytes.lut.sha256, sha256(crlfBytes));
  assert.equal(fromBomBytes.lut.sha256, sha256(bomBytes));
  assert.notEqual(fromLfBytes.lut.sha256, fromCrlfBytes.lut.sha256);
  assert.notEqual(fromLfBytes.lut.sha256, fromBomBytes.lut.sha256);
  assert.equal(fromText.lut.sourceBytes, lfBytes.byteLength);
  assert.equal(fromCrlfBytes.lut.sourceBytes, crlfBytes.byteLength);
});

test('SHA-256 stays exact across padding-block boundaries and UTF-8 titles', () => {
  const base = cube2({ title: '\u8272\u5f69\u6d4b\u8bd5' });
  for (let padding = 0; padding <= 70; padding += 1) {
    const text = `# ${'x'.repeat(padding)}\n${base}`;
    const result = validateText(text);
    assertAccepted(result, { title: '\u8272\u5f69\u6d4b\u8bd5' });
    assert.equal(result.lut.sha256, sha256(Buffer.from(text, 'utf8')), `padding ${padding}`);
  }
});

test('validateBytes rejects malformed UTF-8 instead of replacement-decoding it', () => {
  const invalidUtf8 = Uint8Array.from([0xef, 0xbb, 0xbf, 0xc3, 0x28]);
  const result = validateBytes(invalidUtf8);
  assertErrorShape(result, { code: 'invalid-text-encoding' });
});

test('validateBytes accepts an ArrayBuffer created in another browser realm', () => {
  const foreignBuffer = vm.runInNewContext('new TextEncoder().encode(text).buffer', {
    TextEncoder,
    text: cube2({ title: 'Cross-realm bytes' }),
  });
  assertAccepted(validateBytes(foreignBuffer), { title: 'Cross-realm bytes' });
});

test('validateFile checks extension and the 20 MiB limit before reading', async () => {
  const unreadable = (name, size) => {
    let reads = 0;
    return {
      file: {
        name,
        size,
        async arrayBuffer() {
          reads += 1;
          throw new Error('arrayBuffer must not be called');
        },
      },
      reads: () => reads,
    };
  };

  const tooLarge = unreadable('oversized.cube', limits.maxFileBytes + 1);
  const tooLargeResult = await validateFile(tooLarge.file);
  assertErrorShape(tooLargeResult, { code: 'file-too-large' });
  assert.equal(tooLarge.reads(), 0);

  const empty = unreadable('empty.cube', 0);
  assertErrorShape(await validateFile(empty.file), { code: 'empty-file' });
  assert.equal(empty.reads(), 0);

  for (const name of ['look.txt', 'look.cube.txt', 'look']) {
    const wrongExtension = unreadable(name, 1);
    const result = await validateFile(wrongExtension.file);
    assertErrorShape(result, { code: 'unsupported-file-extension' });
    assert.equal(wrongExtension.reads(), 0, name);
    assert.notEqual(result.code, tooLargeResult.code);
  }
});

test('validateFile accepts a case-insensitive .cube suffix at the exact size limit', async () => {
  const bytes = Buffer.from(cube2({ title: 'File boundary' }), 'utf8');
  const input = fileLike('user-look.CuBe', bytes, limits.maxFileBytes);
  const result = await validateFile(input.file);
  assertAccepted(result, { title: 'File boundary' });
  assert.equal(input.reads(), 1);
  assert.equal(result.lut.sourceBytes, bytes.byteLength);
  assert.equal(result.lut.sha256, sha256(bytes));
});

test('validateFile returns structured decode, read, and cancellation failures', async () => {
  const malformed = fileLike('malformed.cube', Uint8Array.from([0xef, 0xbb, 0xbf, 0xc3, 0x28]));
  assertErrorShape(await validateFile(malformed.file), {
    code: 'invalid-text-encoding',
  });
  assert.equal(malformed.reads(), 1);

  let failedReads = 0;
  const readFailure = await validateFile({
    name: 'unreadable.cube',
    size: 1,
    async arrayBuffer() {
      failedReads += 1;
      throw new Error('disk read failed');
    },
  });
  assertErrorShape(readFailure, { code: 'read-failed' });
  assert.equal(failedReads, 1);

  const controller = new AbortController();
  controller.abort();
  const aborted = fileLike('cancelled.cube', Buffer.from(cube2(), 'utf8'));
  assertErrorShape(await validateFile(aborted.file, { signal: controller.signal }), {
    code: 'operation-aborted',
  });
  assert.equal(aborted.reads(), 0);
});
