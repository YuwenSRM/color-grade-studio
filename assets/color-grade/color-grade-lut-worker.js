'use strict';

importScripts('color-grade-lut.js', 'color-grade-lut-renderer.js');

const protocol = Object.freeze({
  version: 1,
  maximumCachedLuts: 4,
  lutIds: 'non-empty ASCII strings up to 128 characters',
  cachePolicy: 'least-recently-used',
});

let generation = -1;
let sourcePixels = null;
const transforms = new Map();

function isIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isRequestId(value) {
  return isIdentifier(value);
}

function isGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function post(type, payload = {}, transfer = undefined) {
  const message = { type, protocolVersion: protocol.version, ...payload };
  if (transfer?.length) self.postMessage(message, transfer);
  else self.postMessage(message);
}

function postError({ requestId = null, id = null, requestedGeneration = null, code, message }) {
  post('error', { requestId, id, generation: requestedGeneration, code, message });
}

function serializeValidation(result) {
  if (result.ok) {
    const { title, gridSize, domainMin, domainMax, ordering, sha256, sourceBytes } = result.lut;
    return {
      ok: true,
      status: result.status,
      code: result.code,
      lut: {
        title,
        gridSize,
        domainMin: Array.from(domainMin),
        domainMax: Array.from(domainMax),
        ordering,
        sha256,
        sourceBytes,
      },
    };
  }
  return {
    ok: false,
    status: result.status,
    code: result.code,
    stage: result.stage,
    line: result.line,
    directive: result.directive,
    details: { ...result.details },
  };
}

function storeTransform(lutId, transform) {
  transforms.delete(lutId);
  transforms.set(lutId, transform);
  let evictedLutId = null;
  if (transforms.size > protocol.maximumCachedLuts) {
    evictedLutId = transforms.keys().next().value;
    transforms.delete(evictedLutId);
  }
  return evictedLutId;
}

function takeTransform(lutId) {
  const transform = transforms.get(lutId);
  if (!transform) return null;
  transforms.delete(lutId);
  transforms.set(lutId, transform);
  return transform;
}

function handleValidate(message) {
  const { requestId, lutId, buffer } = message;
  if (!isRequestId(requestId) || !isIdentifier(lutId) || !(buffer instanceof ArrayBuffer)) {
    postError({
      requestId: isRequestId(requestId) ? requestId : null,
      code: 'invalid-request',
      message: 'validate-lut requires a requestId, lutId, and ArrayBuffer.',
    });
    return;
  }

  const result = self.ColorGradeLut.validateBytes(buffer);
  let evictedLutId = null;
  if (result.ok) {
    try {
      evictedLutId = storeTransform(lutId, self.ColorGradeLutRenderer.createTransform(result.lut));
    } catch (_error) {
      postError({
        requestId,
        code: 'transform-creation-failed',
        message: 'The validated LUT could not be prepared for rendering.',
      });
      return;
    }
  }
  post('lut-validated', {
    requestId,
    lutId,
    result: serializeValidation(result),
    evictedLutId,
  });
}

function handleSource(message) {
  const { requestId, generation: requestedGeneration, width, height, buffer } = message;
  const requiredByteLength = width * height * 4;
  if (
    !isRequestId(requestId) ||
    !isGeneration(requestedGeneration) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(requiredByteLength) ||
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength !== requiredByteLength
  ) {
    postError({
      requestId: isRequestId(requestId) ? requestId : null,
      requestedGeneration: isGeneration(requestedGeneration) ? requestedGeneration : null,
      code: 'invalid-source',
      message: 'set-source requires matching positive dimensions and an RGBA ArrayBuffer.',
    });
    return;
  }
  if (requestedGeneration < generation) return;

  generation = requestedGeneration;
  sourcePixels = new Uint8ClampedArray(buffer);
  post('source-ready', { requestId, generation, width, height });
}

function handleRender(message) {
  const { requestId, id, generation: requestedGeneration, lutId } = message;
  if (
    !isRequestId(requestId) ||
    !isIdentifier(id) ||
    !isGeneration(requestedGeneration) ||
    !isIdentifier(lutId)
  ) {
    postError({
      requestId: isRequestId(requestId) ? requestId : null,
      id: isIdentifier(id) ? id : null,
      requestedGeneration: isGeneration(requestedGeneration) ? requestedGeneration : null,
      code: 'invalid-request',
      message: 'render requires requestId, id, generation, and lutId.',
    });
    return;
  }
  if (requestedGeneration !== generation || !sourcePixels) return;

  const intensity = message.intensity === undefined ? 1 : message.intensity;
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
    postError({
      requestId,
      id,
      requestedGeneration,
      code: 'invalid-render-options',
      message: 'LUT intensity must be from 0 through 1.',
    });
    return;
  }
  const transform = takeTransform(lutId);
  if (!transform) {
    postError({
      requestId,
      id,
      requestedGeneration,
      code: 'lut-not-loaded',
      message: 'The requested LUT is not available in the worker cache.',
    });
    return;
  }

  try {
    const output = new Uint8ClampedArray(sourcePixels);
    transform.applyPixels(output, { intensity });
    post('rendered', { requestId, id, generation, lutId, intensity, buffer: output.buffer }, [
      output.buffer,
    ]);
  } catch (_error) {
    postError({
      requestId,
      id,
      requestedGeneration,
      code: 'render-failed',
      message: 'The LUT could not be rendered.',
    });
  }
}

function handleDispose(message) {
  const { requestId, lutId } = message;
  if (!isRequestId(requestId) || !isIdentifier(lutId)) {
    postError({
      requestId: isRequestId(requestId) ? requestId : null,
      code: 'invalid-request',
      message: 'dispose-lut requires a requestId and lutId.',
    });
    return;
  }
  const disposed = transforms.delete(lutId);
  post('lut-disposed', { requestId, lutId, disposed });
}

self.onmessage = ({ data: message }) => {
  try {
    if (!message || typeof message !== 'object') {
      postError({ code: 'invalid-request', message: 'Worker messages must be objects.' });
      return;
    }
    if (message.type === 'validate-lut') handleValidate(message);
    else if (message.type === 'set-source') handleSource(message);
    else if (message.type === 'render') handleRender(message);
    else if (message.type === 'dispose-lut') handleDispose(message);
    else
      postError({
        requestId: isRequestId(message.requestId) ? message.requestId : null,
        code: 'invalid-request',
        message: 'Unsupported worker message type.',
      });
  } catch (_error) {
    postError({
      requestId: isRequestId(message?.requestId) ? message.requestId : null,
      code: 'worker-failed',
      message: 'The LUT worker could not process the request.',
    });
  }
};

post('ready', { protocol });
