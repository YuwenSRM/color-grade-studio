(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorGradeLutWorkerClient = api;
})(globalThis, function () {
  'use strict';

  const protocolVersion = 1;
  const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

  class LutWorkerClientError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'LutWorkerClientError';
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  }

  function clientError(code, message, details) {
    return new LutWorkerClientError(code, message, details);
  }

  function isIdentifier(value) {
    return typeof value === 'string' && identifierPattern.test(value);
  }

  function isGeneration(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function toArrayBuffer(value, name) {
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return value;
    if (ArrayBuffer.isView(value)) {
      const copy = new Uint8Array(value.byteLength);
      copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return copy.buffer;
    }
    throw clientError('invalid-input', `${name} must be an ArrayBuffer or TypedArray.`);
  }

  function assertSource(source) {
    if (!source || typeof source !== 'object') {
      throw clientError('invalid-source', 'A source object is required.');
    }
    const { generation, width, height } = source;
    const requiredByteLength = width * height * 4;
    if (
      !isGeneration(generation) ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      !Number.isSafeInteger(requiredByteLength)
    ) {
      throw clientError(
        'invalid-source',
        'Source dimensions must describe a safe RGBA pixel buffer.'
      );
    }
    const buffer = toArrayBuffer(source.buffer, 'source.buffer');
    if (buffer.byteLength !== requiredByteLength) {
      throw clientError('invalid-source', 'Source pixel bytes do not match its dimensions.');
    }
    return { generation, width, height, buffer };
  }

  class LutWorkerClient {
    constructor(worker) {
      if (
        !worker ||
        typeof worker.postMessage !== 'function' ||
        typeof worker.terminate !== 'function'
      ) {
        throw clientError('invalid-worker', 'A Worker-compatible instance is required.');
      }
      this.worker = worker;
      this.pending = new Map();
      this.sequence = 0;
      this.closed = false;
      this.highestSourceGeneration = -1;
      this.readySourceGeneration = -1;
      this.protocol = null;
      this.ready = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      worker.onmessage = (event) => this.handleMessage(event?.data);
      worker.onerror = () =>
        this.fail(clientError('worker-unavailable', 'The LUT worker is unavailable.'));
      worker.onmessageerror = () =>
        this.fail(
          clientError('worker-unavailable', 'The LUT worker returned an unreadable response.')
        );
    }

    nextRequestId(prefix) {
      this.sequence += 1;
      return `${prefix}-${this.sequence}`;
    }

    afterReady(callback) {
      return this.protocol ? callback() : this.ready.then(callback);
    }

    request(type, payload, transfer, metadata = {}) {
      if (this.closed)
        return Promise.reject(clientError('client-closed', 'The LUT worker client is closed.'));
      const requestId = this.nextRequestId(type);
      return new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject, type, ...metadata });
        try {
          this.worker.postMessage({ type, requestId, ...payload }, transfer);
        } catch (_error) {
          this.pending.delete(requestId);
          reject(clientError('post-failed', 'The LUT worker request could not be sent.', { type }));
        }
      });
    }

    rejectPending(predicate, error) {
      for (const [requestId, request] of this.pending) {
        if (!predicate(request)) continue;
        this.pending.delete(requestId);
        request.reject(error);
      }
    }

    handleMessage(message) {
      if (!message || message.protocolVersion !== protocolVersion) {
        this.fail(
          clientError('protocol-mismatch', 'The LUT worker protocol version is incompatible.')
        );
        return;
      }
      if (message.type === 'ready') {
        if (message.protocol?.version !== protocolVersion) {
          this.fail(
            clientError('protocol-mismatch', 'The LUT worker reported an incompatible protocol.')
          );
          return;
        }
        this.protocol = message.protocol;
        this.resolveReady(message.protocol);
        return;
      }

      const request = this.pending.get(message.requestId);
      if (!request) return;
      this.pending.delete(message.requestId);
      if (message.type === 'error') {
        request.reject(
          clientError(
            message.code || 'worker-failed',
            message.message || 'The LUT worker failed.',
            message
          )
        );
        return;
      }
      const expectedType = {
        'validate-lut': 'lut-validated',
        'set-source': 'source-ready',
        render: 'rendered',
        'dispose-lut': 'lut-disposed',
      }[request.type];
      if (message.type !== expectedType) {
        request.reject(
          clientError(
            'invalid-worker-response',
            'The LUT worker returned an unexpected response.',
            message
          )
        );
        return;
      }
      if (
        (request.type === 'validate-lut' && message.lutId !== request.lutId) ||
        (request.type === 'set-source' && message.generation !== request.generation) ||
        (request.type === 'render' &&
          (message.generation !== request.generation ||
            message.id !== request.id ||
            message.lutId !== request.lutId)) ||
        (request.type === 'dispose-lut' && message.lutId !== request.lutId)
      ) {
        request.reject(
          clientError(
            'invalid-worker-response',
            'The LUT worker response does not match the pending request.',
            message
          )
        );
        return;
      }
      if (request.type === 'set-source') this.readySourceGeneration = message.generation;
      request.resolve(message);
    }

    fail(error) {
      if (this.closed) return;
      this.closed = true;
      this.rejectReady(error);
      this.rejectPending(() => true, error);
      try {
        this.worker.terminate();
      } catch (_) {
        // Termination is best-effort after a worker failure.
      }
    }

    validateLut(lutId, bytes) {
      if (!isIdentifier(lutId)) {
        return Promise.reject(
          clientError('invalid-lut-id', 'lutId must be a non-empty ASCII identifier.')
        );
      }
      let buffer;
      try {
        buffer = toArrayBuffer(bytes, 'bytes');
      } catch (error) {
        return Promise.reject(error);
      }
      return this.afterReady(() =>
        this.request('validate-lut', { lutId, buffer }, [buffer], { lutId }).then((response) => ({
          result: response.result,
          evictedLutId: response.evictedLutId,
        }))
      );
    }

    setSource(source) {
      let prepared;
      try {
        prepared = assertSource(source);
      } catch (error) {
        return Promise.reject(error);
      }
      if (prepared.generation <= this.highestSourceGeneration) {
        return Promise.reject(
          clientError(
            'invalid-generation',
            'Source generations must increase for each image replacement.',
            {
              generation: prepared.generation,
              previousGeneration: this.highestSourceGeneration,
            }
          )
        );
      }
      this.highestSourceGeneration = prepared.generation;
      const superseded = clientError(
        'operation-superseded',
        'A newer source image replaced this request.',
        {
          generation: prepared.generation,
        }
      );
      this.rejectPending(
        (request) => request.type === 'render' || request.type === 'set-source',
        superseded
      );
      return this.afterReady(() =>
        this.request('set-source', prepared, [prepared.buffer], { generation: prepared.generation })
      );
    }

    render({ id, generation, lutId, intensity = undefined }) {
      if (!isIdentifier(id) || !isIdentifier(lutId) || !isGeneration(generation)) {
        return Promise.reject(
          clientError(
            'invalid-render-request',
            'id, lutId, and generation are required for rendering.'
          )
        );
      }
      if (generation !== this.readySourceGeneration) {
        return Promise.reject(
          clientError(
            'source-not-ready',
            'The requested source generation is not ready in the LUT worker.',
            {
              generation,
              readySourceGeneration: this.readySourceGeneration,
            }
          )
        );
      }
      if (
        !Number.isFinite(intensity === undefined ? 1 : intensity) ||
        intensity < 0 ||
        intensity > 1
      ) {
        return Promise.reject(
          clientError('invalid-render-options', 'LUT intensity must be from 0 through 1.')
        );
      }
      return this.afterReady(() =>
        this.request('render', { id, generation, lutId, intensity }, undefined, {
          generation,
          id,
          lutId,
        })
      );
    }

    disposeLut(lutId) {
      if (!isIdentifier(lutId)) {
        return Promise.reject(
          clientError('invalid-lut-id', 'lutId must be a non-empty ASCII identifier.')
        );
      }
      return this.afterReady(() =>
        this.request('dispose-lut', { lutId }, undefined, { lutId }).then(
          (response) => response.disposed
        )
      );
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      const error = clientError('client-closed', 'The LUT worker client is closed.');
      this.rejectReady(error);
      this.rejectPending(() => true, error);
      this.worker.terminate();
    }
  }

  function create({
    workerFactory,
    workerUrl = 'assets/color-grade/color-grade-lut-worker.js',
  } = {}) {
    const factory = workerFactory || ((url) => new Worker(url));
    if (typeof factory !== 'function') {
      throw clientError('invalid-worker-factory', 'workerFactory must be a function.');
    }
    return new LutWorkerClient(factory(workerUrl));
  }

  return Object.freeze({ create, LutWorkerClient, LutWorkerClientError, protocolVersion });
});
