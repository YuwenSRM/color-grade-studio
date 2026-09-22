(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorGradeLut = api;
})(globalThis, function () {
  'use strict';

  const limits = Object.freeze({
    maxFileBytes: 20 * 1024 * 1024,
    minGridSize: 2,
    maxGridSize: 65,
  });

  const codes = Object.freeze({
    valid3dCube: 'valid-3d-cube',
    valid3dCubeCustomDomain: 'valid-3d-cube-custom-domain',
    fileTooLarge: 'file-too-large',
    emptyFile: 'empty-file',
    unsupportedFileExtension: 'unsupported-file-extension',
    invalidTextEncoding: 'invalid-text-encoding',
    readFailed: 'read-failed',
    operationAborted: 'operation-aborted',
    unsupported1dLut: 'unsupported-1d-lut',
    unsupportedCombinedLut: 'unsupported-combined-lut',
    unsupportedDirective: 'unsupported-directive',
    missing3dSize: 'missing-3d-size',
    invalidGridSize: 'invalid-grid-size',
    duplicateDirective: 'duplicate-directive',
    directiveAfterData: 'directive-after-data',
    invalidDirectiveArguments: 'invalid-directive-arguments',
    invalidTitle: 'invalid-title',
    dataBeforeSize: 'data-before-size',
    invalidNumber: 'invalid-number',
    nonFiniteData: 'non-finite-data',
    dataCountMismatch: 'data-count-mismatch',
    invalidDataColumnCount: 'invalid-data-column-count',
    invalidDomainOrder: 'invalid-domain-order',
    unsupportedSdrValueRange: 'unsupported-sdr-value-range',
  });

  const messages = Object.freeze({
    [codes.fileTooLarge]: 'The LUT file exceeds the 20 MiB limit.',
    [codes.emptyFile]: 'The LUT file is empty.',
    [codes.unsupportedFileExtension]: 'Only .cube files are supported.',
    [codes.invalidTextEncoding]: 'The LUT file is not valid UTF-8 text.',
    [codes.readFailed]: 'The LUT file could not be read.',
    [codes.operationAborted]: 'The LUT file operation was cancelled.',
    [codes.unsupported1dLut]: '1D CUBE LUTs are not supported.',
    [codes.unsupportedCombinedLut]: 'Combined 1D and 3D CUBE LUTs are not supported.',
    [codes.unsupportedDirective]: 'The CUBE file contains an unsupported directive.',
    [codes.missing3dSize]: 'The CUBE file does not declare LUT_3D_SIZE.',
    [codes.invalidGridSize]: 'LUT_3D_SIZE must be an integer from 2 through 65.',
    [codes.duplicateDirective]: 'A singleton CUBE directive is repeated.',
    [codes.directiveAfterData]: 'CUBE directives must appear before the data rows.',
    [codes.invalidDirectiveArguments]: 'A CUBE directive has invalid arguments.',
    [codes.invalidTitle]: 'TITLE must contain one quoted string.',
    [codes.dataBeforeSize]: 'CUBE data rows cannot appear before LUT_3D_SIZE.',
    [codes.invalidNumber]: 'The CUBE file contains an invalid decimal number.',
    [codes.nonFiniteData]: 'The CUBE file contains a non-finite number.',
    [codes.dataCountMismatch]: 'The number of CUBE data rows does not match the grid size.',
    [codes.invalidDataColumnCount]: 'Each CUBE data row must contain exactly three numbers.',
    [codes.invalidDomainOrder]: 'Each DOMAIN_MIN channel must be less than DOMAIN_MAX.',
    [codes.unsupportedSdrValueRange]: 'The LUT contains values outside the supported SDR range.',
  });

  const decimalPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
  const nonFinitePattern = /^[+-]?(?:nan|infinity)$/i;
  const singletonDirectives = new Set(['TITLE', 'LUT_3D_SIZE', 'DOMAIN_MIN', 'DOMAIN_MAX']);
  const sha256Constants = Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  class CubeLutError extends Error {
    constructor(code, stage, { line = null, directive = null, details = {} } = {}) {
      super(messages[code] || 'The CUBE file is invalid.');
      this.name = 'CubeLutError';
      this.code = code;
      this.stage = stage;
      this.line = line;
      this.directive = directive;
      this.details = Object.freeze({ ...details });
    }
  }

  function failure(code, stage, metadata, status = 'rejected') {
    const error = new CubeLutError(code, stage, metadata);
    return Object.freeze({
      ok: false,
      status,
      code,
      stage: error.stage,
      line: error.line,
      directive: error.directive,
      details: error.details,
      error,
    });
  }

  function success(lut) {
    const customDomain =
      lut.domainMin.some((value) => value !== 0) || lut.domainMax.some((value) => value !== 1);
    return Object.freeze({
      ok: true,
      status: 'accepted',
      code: customDomain ? codes.valid3dCubeCustomDomain : codes.valid3dCube,
      lut: Object.freeze(lut),
    });
  }

  function asBytes(input) {
    try {
      if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      }
      const tag = Object.prototype.toString.call(input);
      if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') {
        return new Uint8Array(input);
      }
    } catch (_error) {
      return null;
    }
    return null;
  }

  function encodeUtf8(text) {
    return new TextEncoder().encode(text);
  }

  function decodeUtf8(bytes) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function rotateRight(value, count) {
    return (value >>> count) | (value << (32 - count));
  }

  // A synchronous implementation keeps validateText deterministic in both browsers and Node.
  function sha256Hex(bytes) {
    const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.byteLength] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bytes.byteLength / 0x20000000), false);
    view.setUint32(paddedLength - 4, (bytes.byteLength << 3) >>> 0, false);

    const hash = Uint32Array.from([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
      0x5be0cd19,
    ]);
    const words = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        words[index] = view.getUint32(offset + index * 4, false);
      }
      for (let index = 16; index < 64; index += 1) {
        const previous15 = words[index - 15];
        const previous2 = words[index - 2];
        const sigma0 =
          rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
        const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }

      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temporary1 = (h + sum1 + choice + sha256Constants[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }

      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }

    return Array.from(hash, (value) => value.toString(16).padStart(8, '0')).join('');
  }

  function stripComment(line) {
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (escaped) {
        escaped = false;
      } else if (quoted && character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === '#' && !quoted) {
        return line.slice(0, index);
      }
    }
    return line;
  }

  function firstToken(line) {
    const match = /^\S+/.exec(line);
    return match ? match[0] : '';
  }

  function parseTitle(line) {
    const value = line.slice('TITLE'.length).trim();
    if (!value.startsWith('"')) return null;

    let escaped = false;
    for (let index = 1; index < value.length; index += 1) {
      const character = value[index];
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        if (value.slice(index + 1).trim()) return null;
        return value.slice(1, index).replace(/\\(["\\])/g, '$1');
      }
    }
    return null;
  }

  function isOutsideSdrRange(token) {
    const unsigned = token.replace(/^[+-]/, '');
    const [mantissa, exponentText] = unsigned.split(/[eE]/);
    const digits = mantissa.replace('.', '');
    const firstNonZero = digits.search(/[1-9]/);
    if (firstNonZero === -1) return false;
    if (token.startsWith('-')) return true;

    const decimalPosition = mantissa.includes('.') ? mantissa.indexOf('.') : mantissa.length;
    const exponent = exponentText === undefined ? 0 : Number(exponentText);
    const integerDigits = decimalPosition + exponent - firstNonZero;
    if (integerDigits !== 1) return integerDigits > 1;

    const significant = digits.slice(firstNonZero);
    return significant[0] > '1' || (significant[0] === '1' && /[1-9]/.test(significant.slice(1)));
  }

  function parseNumber(token, line, directive) {
    if (nonFinitePattern.test(token)) {
      return failure(codes.nonFiniteData, 'syntax', { line, directive, details: { token } });
    }
    if (!decimalPattern.test(token)) {
      return failure(codes.invalidNumber, 'syntax', { line, directive, details: { token } });
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      return failure(codes.nonFiniteData, 'syntax', { line, directive, details: { token } });
    }
    return value;
  }

  function visitLines(text, visitor) {
    let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    let line = 1;
    for (let index = start; index <= text.length; index += 1) {
      const character = index < text.length ? text.charCodeAt(index) : -1;
      if (character !== -1 && character !== 10 && character !== 13) continue;

      const result = visitor(stripComment(text.slice(start, index)).trim(), line);
      if (result) return result;
      if (character === 13 && text.charCodeAt(index + 1) === 10) index += 1;
      start = index + 1;
      line += 1;
    }
    return null;
  }

  function classifyLutType(text) {
    let oneDimensional = null;
    let threeDimensional = null;
    let hasContent = false;
    visitLines(text, (content, line) => {
      if (!content) return null;
      hasContent = true;
      const directive = firstToken(content);
      if (directive === 'LUT_1D_SIZE' && !oneDimensional) oneDimensional = { line, directive };
      if (directive === 'LUT_3D_SIZE' && !threeDimensional) threeDimensional = { line, directive };
      return null;
    });
    if (!hasContent) return failure(codes.emptyFile, 'file');
    if (oneDimensional && threeDimensional) {
      const decisive =
        oneDimensional.line > threeDimensional.line ? oneDimensional : threeDimensional;
      return failure(codes.unsupportedCombinedLut, 'type', {
        line: decisive.line,
        directive: decisive.directive,
      });
    }
    if (oneDimensional) {
      return failure(codes.unsupported1dLut, 'type', {
        line: oneDimensional.line,
        directive: 'LUT_1D_SIZE',
      });
    }
    return null;
  }

  function parseCube(text, bytes) {
    const typeFailure = classifyLutType(text);
    if (typeFailure) return typeFailure;

    const seen = new Map();
    let title = null;
    let gridSize = null;
    let domainMin = [0, 0, 0];
    let domainMax = [1, 1, 1];
    let domainMinLine = null;
    let domainMaxLine = null;
    let values = null;
    let rowCount = 0;
    let dataStarted = false;
    let firstOutOfRangeDomain = null;
    let firstOutOfRangeData = null;

    const parseFailure = visitLines(text, (content, line) => {
      if (!content) return null;
      const directive = firstToken(content);
      const isDirective = singletonDirectives.has(directive);
      const looksNumeric = /^[+\-.0-9]/.test(directive) || nonFinitePattern.test(directive);

      if (isDirective) {
        if (dataStarted) {
          return failure(codes.directiveAfterData, 'structure', {
            line,
            directive,
          });
        }
        if (seen.has(directive)) {
          return failure(codes.duplicateDirective, 'structure', {
            line,
            directive,
            details: { firstLine: seen.get(directive) },
          });
        }
        seen.set(directive, line);

        if (directive === 'TITLE') {
          title = parseTitle(content);
          if (title === null) {
            return failure(codes.invalidTitle, 'syntax', {
              line,
              directive,
            });
          }
          return null;
        }

        const tokens = content.split(/\s+/);
        if (directive === 'LUT_3D_SIZE') {
          if (tokens.length !== 2) {
            return failure(codes.invalidDirectiveArguments, 'syntax', {
              line,
              directive,
              details: { expected: 1, actual: tokens.length - 1 },
            });
          }
          if (!/^\d+$/.test(tokens[1])) {
            return failure(codes.invalidGridSize, 'structure', {
              line,
              directive,
            });
          }
          gridSize = Number(tokens[1]);
          if (
            !Number.isSafeInteger(gridSize) ||
            gridSize < limits.minGridSize ||
            gridSize > limits.maxGridSize
          ) {
            return failure(codes.invalidGridSize, 'structure', {
              line,
              directive,
              details: { value: tokens[1] },
            });
          }
          return null;
        }

        if (tokens.length !== 4) {
          return failure(codes.invalidDirectiveArguments, 'syntax', {
            line,
            directive,
            details: { expected: 3, actual: tokens.length - 1 },
          });
        }
        const parsedDomain = [];
        for (let channel = 0; channel < 3; channel += 1) {
          const token = tokens[channel + 1];
          const parsed = parseNumber(token, line, directive);
          if (typeof parsed !== 'number') return parsed;
          parsedDomain.push(parsed);
          if (!firstOutOfRangeDomain && isOutsideSdrRange(token)) {
            firstOutOfRangeDomain = { line, directive, channel, value: parsed, token };
          }
        }
        if (directive === 'DOMAIN_MIN') {
          domainMin = parsedDomain;
          domainMinLine = line;
        } else {
          domainMax = parsedDomain;
          domainMaxLine = line;
        }
        return null;
      }

      if (!looksNumeric) {
        return failure(codes.unsupportedDirective, 'syntax', {
          line,
          directive,
        });
      }
      if (gridSize === null) {
        return failure(codes.dataBeforeSize, 'structure', { line });
      }

      dataStarted = true;
      const tokens = content.split(/\s+/);
      if (tokens.length !== 3) {
        return failure(codes.invalidDataColumnCount, 'structure', {
          line,
          details: { expected: 3, actual: tokens.length },
        });
      }

      const expectedRows = gridSize ** 3;
      if (rowCount >= expectedRows) {
        return failure(codes.dataCountMismatch, 'structure', {
          line,
          details: { expected: expectedRows, actual: rowCount + 1 },
        });
      }
      if (!values) values = new Float64Array(expectedRows * 3);
      for (let channel = 0; channel < 3; channel += 1) {
        const parsed = parseNumber(tokens[channel], line, null);
        if (typeof parsed !== 'number') return parsed;
        values[rowCount * 3 + channel] = parsed;
        if (!firstOutOfRangeData && isOutsideSdrRange(tokens[channel])) {
          firstOutOfRangeData = { line, channel, value: parsed, token: tokens[channel] };
        }
      }
      rowCount += 1;
      return null;
    });
    if (parseFailure) return parseFailure;

    if (gridSize === null) {
      return failure(codes.missing3dSize, 'structure', {
        directive: 'LUT_3D_SIZE',
      });
    }
    const expectedRows = gridSize ** 3;
    if (rowCount !== expectedRows) {
      return failure(codes.dataCountMismatch, 'structure', {
        details: { expected: expectedRows, actual: rowCount },
      });
    }

    for (let channel = 0; channel < 3; channel += 1) {
      if (domainMin[channel] >= domainMax[channel]) {
        const declaredLine = domainMaxLine || domainMinLine;
        return failure(codes.invalidDomainOrder, 'domain', {
          line: declaredLine,
          directive: domainMaxLine ? 'DOMAIN_MAX' : domainMinLine ? 'DOMAIN_MIN' : null,
          details: {
            channel,
            minimum: domainMin[channel],
            maximum: domainMax[channel],
            domainMinLine,
            domainMaxLine,
          },
        });
      }
    }

    if (firstOutOfRangeDomain || firstOutOfRangeData) {
      const range = firstOutOfRangeDomain || firstOutOfRangeData;
      return failure(
        codes.unsupportedSdrValueRange,
        'policy',
        {
          line: range.line,
          directive: range.directive || null,
          details: { channel: range.channel, value: range.value, token: range.token },
        },
        'recognized-but-rejected-for-p1-sdr'
      );
    }

    return success({
      title,
      gridSize,
      domainMin: Object.freeze(domainMin.slice()),
      domainMax: Object.freeze(domainMax.slice()),
      values,
      ordering: 'red-fastest',
      sha256: sha256Hex(bytes),
      sourceBytes: bytes.byteLength,
    });
  }

  function validateBytes(input) {
    const bytes = asBytes(input);
    if (!bytes) return failure(codes.readFailed, 'file');
    if (bytes.byteLength > limits.maxFileBytes) {
      return failure(codes.fileTooLarge, 'file', {
        details: { maximum: limits.maxFileBytes, actual: bytes.byteLength },
      });
    }
    if (!bytes.byteLength) return failure(codes.emptyFile, 'file');

    let text;
    try {
      text = decodeUtf8(bytes);
    } catch (_error) {
      return failure(codes.invalidTextEncoding, 'decode');
    }
    return parseCube(text, bytes);
  }

  function validateText(input) {
    if (typeof input !== 'string') return failure(codes.invalidTextEncoding, 'decode');
    const bytes = encodeUtf8(input);
    if (bytes.byteLength > limits.maxFileBytes) {
      return failure(codes.fileTooLarge, 'file', {
        details: { maximum: limits.maxFileBytes, actual: bytes.byteLength },
      });
    }
    return parseCube(input, bytes);
  }

  async function validateFile(file, options = {}) {
    if (!file || typeof file.arrayBuffer !== 'function') {
      return failure(codes.readFailed, 'file');
    }
    if (typeof file.name === 'string' && !/\.cube$/i.test(file.name)) {
      return failure(codes.unsupportedFileExtension, 'file', {
        details: { name: file.name },
      });
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return failure(codes.readFailed, 'file');
    }
    if (file.size > limits.maxFileBytes) {
      return failure(codes.fileTooLarge, 'file', {
        details: { maximum: limits.maxFileBytes, actual: file.size },
      });
    }
    if (!file.size) return failure(codes.emptyFile, 'file');
    if (options.signal && options.signal.aborted) {
      return failure(codes.operationAborted, 'file');
    }

    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (_error) {
      if (options.signal && options.signal.aborted) {
        return failure(codes.operationAborted, 'file');
      }
      return failure(codes.readFailed, 'file');
    }
    if (options.signal && options.signal.aborted) {
      return failure(codes.operationAborted, 'file');
    }
    return validateBytes(buffer);
  }

  return Object.freeze({
    validateText,
    validateBytes,
    validateFile,
    CubeLutError,
    limits,
    codes,
  });
});
