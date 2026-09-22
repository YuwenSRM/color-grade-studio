'use strict';

// P1 is intentionally a separate Worker protocol so the P0 worker can remain frozen.
importScripts(
  'color-grade-lut.js',
  'color-grade-lut-renderer.js',
  'color-grade-renderer.js',
  'color-grade-lut-library.js'
);

const protocolVersion = 1;
const maximumCachedLuts = 4;
const neutralProfile = Object.freeze({ b: 1, c: 1, s: 1, w: 1, t: 0 });
let source = null;
let sourceGeneration = -1;
const transforms = new Map();

function error(requestId, code, message, extra = {}) {
  self.postMessage({ type: 'error', protocolVersion, requestId, code, message, ...extra });
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function validSource(message) {
  return (
    Number.isSafeInteger(message.generation) &&
    message.generation >= 0 &&
    Number.isSafeInteger(message.width) &&
    message.width > 0 &&
    Number.isSafeInteger(message.height) &&
    message.height > 0 &&
    message.buffer instanceof ArrayBuffer &&
    message.buffer.byteLength === message.width * message.height * 4
  );
}

function profile(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['b', 'c', 's', 'w', 't']) {
    if (!Number.isFinite(value[key])) return null;
    result[key] = value[key];
  }
  return result;
}

function settings(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') return null;
  const delta = value.delta;
  if (
    delta !== undefined &&
    (!delta ||
      typeof delta !== 'object' ||
      Object.values(delta).some((item) => !Number.isFinite(item)))
  )
    return null;
  for (const key of ['shadow', 'mid', 'high']) {
    if (
      value[key] !== undefined &&
      (!Array.isArray(value[key]) ||
        value[key].length !== 3 ||
        value[key].some((item) => !Number.isFinite(item)))
    )
      return null;
  }
  for (const key of ['shadowAmount', 'midAmount', 'highAmount'])
    if (value[key] !== undefined && !Number.isFinite(value[key])) return null;
  if (value.toneModel !== undefined && !['legacy-v1', 'standard-v2'].includes(value.toneModel))
    return null;
  return value;
}

function touch(lutId) {
  const transform = transforms.get(lutId);
  if (!transform) return null;
  transforms.delete(lutId);
  transforms.set(lutId, transform);
  return transform;
}

function blendFromSource(output, original, intensity) {
  if (intensity === 1) return;
  for (let index = 0; index < output.length; index += 4) {
    output[index] = original[index] + (output[index] - original[index]) * intensity;
    output[index + 1] = original[index + 1] + (output[index + 1] - original[index + 1]) * intensity;
    output[index + 2] = original[index + 2] + (output[index + 2] - original[index + 2]) * intensity;
  }
}

self.onmessage = ({ data: message }) => {
  if (!message || typeof message !== 'object') return;
  const { type, requestId } = message;
  try {
    if (type === 'validate-lut') {
      if (!validId(message.lutId) || !(message.buffer instanceof ArrayBuffer)) {
        error(requestId, 'invalid-lut', 'LUT 请求无效。');
        return;
      }
      const result = self.ColorGradeLut.validateBytes(message.buffer);
      let evictedLutId = null;
      if (result.ok) {
        const transform = self.ColorGradeLutRenderer.createTransform(result.lut);
        transforms.delete(message.lutId);
        transforms.set(message.lutId, transform);
        if (transforms.size > maximumCachedLuts) {
          evictedLutId = transforms.keys().next().value;
          transforms.delete(evictedLutId);
        }
      }
      self.postMessage({
        type: 'lut-validated',
        protocolVersion,
        requestId,
        lutId: message.lutId,
        result,
        evictedLutId,
      });
      return;
    }
    if (type === 'validate-parameters') {
      if (!(message.buffer instanceof ArrayBuffer)) {
        error(requestId, 'invalid-json', '参数滤镜请求无效。');
        return;
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(message.buffer);
      const result = self.LandscapeLutLibrary.validateParameterFilterText(text);
      self.postMessage({
        type: 'parameters-validated',
        protocolVersion,
        requestId,
        result,
      });
      return;
    }
    if (type === 'set-source') {
      if (!validSource(message) || message.generation <= sourceGeneration) {
        error(requestId, 'invalid-source', '源图像数据无效。');
        return;
      }
      source = {
        pixels: new Uint8ClampedArray(message.buffer),
        width: message.width,
        height: message.height,
      };
      sourceGeneration = message.generation;
      self.postMessage({
        type: 'source-ready',
        protocolVersion,
        requestId,
        generation: sourceGeneration,
        width: source.width,
        height: source.height,
      });
      return;
    }
    if (type === 'render') {
      if (
        !source ||
        message.generation !== sourceGeneration ||
        !validId(message.id) ||
        !message.basis ||
        typeof message.basis !== 'object'
      )
        return;
      const output = new Uint8ClampedArray(source.pixels);
      const manual = settings(message.settings);
      if (manual === null) {
        error(requestId, 'invalid-render-options', '手动调整参数无效。');
        return;
      }
      if (message.basis.kind === 'lut') {
        const intensity = message.basis.intensity === undefined ? 1 : message.basis.intensity;
        const transform = touch(message.basis.lutId);
        if (!transform) {
          error(requestId, 'lut-not-loaded', 'LUT 尚未加载。');
          return;
        }
        if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
          error(requestId, 'invalid-render-options', 'LUT 强度必须在 0 到 1 之间。');
          return;
        }
        // LUT strength is a complete effect mix: 0% is the untouched source and
        // 100% is the fully rendered LUT plus any current manual adjustments.
        if (intensity) {
          transform.applyPixels(output);
          self.ColorGradeRenderer.applyPixels(output, neutralProfile, manual);
          blendFromSource(output, source.pixels, intensity);
        }
      } else if (message.basis.kind === 'parameters') {
        const base = profile(message.basis.parameters);
        const intensity = message.basis.intensity === undefined ? 1 : message.basis.intensity;
        if (!base) {
          error(requestId, 'invalid-render-options', '参数滤镜无效。');
          return;
        }
        if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
          error(requestId, 'invalid-render-options', '滤镜强度必须在 0 到 1 之间。');
          return;
        }
        self.ColorGradeRenderer.applyPixels(output, base, manual);
        blendFromSource(output, source.pixels, intensity);
      } else {
        error(requestId, 'invalid-render-options', '未知基础滤镜类型。');
        return;
      }
      self.postMessage(
        {
          type: 'rendered',
          protocolVersion,
          requestId,
          id: message.id,
          generation: sourceGeneration,
          width: source.width,
          height: source.height,
          buffer: output.buffer,
        },
        [output.buffer]
      );
      return;
    }
    if (type === 'dispose-lut') {
      if (!validId(message.lutId)) {
        error(requestId, 'invalid-lut', 'LUT 标识无效。');
        return;
      }
      const disposed = transforms.delete(message.lutId);
      self.postMessage({
        type: 'lut-disposed',
        protocolVersion,
        requestId,
        lutId: message.lutId,
        disposed,
      });
    }
  } catch (caught) {
    error(
      requestId,
      typeof caught?.code === 'string' ? caught.code : 'worker-failed',
      caught instanceof Error ? caught.message : String(caught)
    );
  }
};

self.postMessage({
  type: 'ready',
  protocolVersion,
  protocol: {
    version: protocolVersion,
    maximumCachedLuts,
    renderOrder: 'base-effect-then-manual-adjustments',
  },
});
