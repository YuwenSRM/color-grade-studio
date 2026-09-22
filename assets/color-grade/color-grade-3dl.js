(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorGrade3dl = api;
})(globalThis, function () {
  'use strict';

  const codes = Object.freeze({
    unsupportedExtension: 'unsupported-3dl-extension',
    invalidText: 'invalid-3dl-text',
    unknownDialect: 'unknown-3dl-dialect',
    incompleteMesh: 'incomplete-3dl-mesh',
    unsupportedDialect: 'unsupported-3dl-dialect',
  });

  function result(code, details = {}) {
    return Object.freeze({
      ok: code === codes.unsupportedDialect,
      status: code === codes.unsupportedDialect ? 'detected-unsupported' : 'rejected',
      code,
      ...details,
    });
  }

  function parseTriplet(line) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== 3) return null;
    const values = tokens.map(Number);
    return values.every(Number.isFinite) ? values : null;
  }

  function allLines(text) {
    return text
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((raw, index) => ({ raw, line: index + 1, text: raw.trim() }));
  }

  function dataRows(lines, startIndex) {
    return lines
      .slice(startIndex)
      .map((entry) => ({ ...entry, values: parseTriplet(entry.text) }))
      .filter((entry) => entry.values);
  }

  function declaredLustreGrid(lines, meshIndex) {
    for (const entry of lines.slice(meshIndex + 1)) {
      const cubed = /^#\s*(\d+)\s+cubed\b/i.exec(entry.text);
      if (cubed) return { gridSize: Number(cubed[1]), line: entry.line, source: 'comment-cubed' };
      const rows = /^#\s*(\d+)\s+rows\b/i.exec(entry.text);
      if (rows) {
        const gridSize = Math.round(Math.cbrt(Number(rows[1])));
        if (gridSize ** 3 === Number(rows[1]))
          return { gridSize, line: entry.line, source: 'comment-row-count' };
      }
    }
    return null;
  }

  function detectText(text, { filename = '' } = {}) {
    if (typeof text !== 'string' || !text.trim()) return result(codes.invalidText, { filename });
    const lines = allLines(text);
    const marker = lines.find((entry) => entry.text.toUpperCase() === '3DMESH');
    if (!marker) return result(codes.unknownDialect, { filename, lineCount: lines.length });
    const mesh = lines.find((entry) => /^MESH\s+\d+\s+\d+$/i.test(entry.text));
    if (!mesh) return result(codes.incompleteMesh, { filename, markerLine: marker.line });
    const meshNumbers = mesh.text.split(/\s+/).slice(1).map(Number);
    const meshIndex = lines.indexOf(mesh);
    const dialect = meshNumbers[0] === 5 ? 'lustre-3dmesh' : 'discreet-3dmesh';
    let grid;
    let rows;
    if (dialect === 'lustre-3dmesh') {
      const declared = declaredLustreGrid(lines, meshIndex);
      const firstDataIndex = lines.findIndex(
        (entry, index) => index > meshIndex && Boolean(parseTriplet(entry.text))
      );
      if (!declared || firstDataIndex < 0)
        return result(codes.incompleteMesh, {
          filename,
          markerLine: marker.line,
          meshLine: mesh.line,
        });
      grid = { line: declared.line, gridSize: declared.gridSize, source: declared.source };
      rows = dataRows(lines, firstDataIndex);
    } else {
      const gridEntry = lines.slice(meshIndex + 1).find((entry) => {
        const triplet = parseTriplet(entry.text);
        return (
          triplet &&
          triplet.every(Number.isSafeInteger) &&
          triplet[0] === triplet[1] &&
          triplet[1] === triplet[2] &&
          triplet[0] >= 2
        );
      });
      if (!gridEntry)
        return result(codes.incompleteMesh, {
          filename,
          markerLine: marker.line,
          meshLine: mesh.line,
        });
      grid = {
        line: gridEntry.line,
        gridSize: parseTriplet(gridEntry.text)[0],
        source: 'grid-triplet',
      };
      rows = dataRows(lines, lines.indexOf(gridEntry) + 1);
    }
    const gridSize = grid.gridSize;
    const outputMinimum = rows.length ? Math.min(...rows.flatMap((entry) => entry.values)) : null;
    const outputMaximum = rows.length ? Math.max(...rows.flatMap((entry) => entry.values)) : null;
    return result(codes.unsupportedDialect, {
      filename,
      dialect,
      markerLine: marker.line,
      meshLine: mesh.line,
      gridLine: grid.line,
      gridSource: grid.source,
      mesh: Object.freeze(meshNumbers),
      gridSize,
      expectedRows: gridSize ** 3,
      dataRows: rows.length,
      rowCountMatchesGrid: rows.length === gridSize ** 3,
      outputRange: outputMinimum === null ? null : Object.freeze([outputMinimum, outputMaximum]),
      reason:
        'P2 仅探测 .3dl 方言；尚未冻结轴序、数值归一化和 sRGB SDR 转换规则，因此不会导入或应用。',
    });
  }

  async function detectFile(file, { signal } = {}) {
    if (signal?.aborted) return result('operation-aborted');
    if (!file || typeof file.name !== 'string' || typeof file.text !== 'function')
      return result(codes.invalidText);
    if (!/\.3dl$/i.test(file.name))
      return result(codes.unsupportedExtension, { filename: file.name });
    try {
      const text = await file.text();
      if (signal?.aborted) return result('operation-aborted', { filename: file.name });
      return detectText(text, { filename: file.name });
    } catch (_) {
      return result(codes.invalidText, { filename: file.name });
    }
  }

  return Object.freeze({ codes, detectText, detectFile });
});
