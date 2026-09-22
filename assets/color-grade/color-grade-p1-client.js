(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorGradeP1WorkerClient = api;
})(globalThis, function () {
  'use strict';
  const protocolVersion = 1;
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  class P1WorkerClientError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'P1WorkerClientError';
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  }
  function error(code, message, details) {
    return new P1WorkerClientError(code, message, details);
  }
  function validId(value) {
    return typeof value === 'string' && idPattern.test(value);
  }
  function sourceRequest(value) {
    if (
      !value ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 0 ||
      !Number.isSafeInteger(value.width) ||
      !Number.isSafeInteger(value.height) ||
      value.width < 1 ||
      value.height < 1 ||
      !(value.buffer instanceof ArrayBuffer) ||
      value.buffer.byteLength !== value.width * value.height * 4
    )
      throw error('invalid-source', '源图像数据无效。');
    return value;
  }
  class Client {
    constructor(worker) {
      this.worker = worker;
      this.pending = new Map();
      this.sequence = 0;
      this.closed = false;
      this.readyGeneration = -1;
      this.highestGeneration = -1;
      this.ready = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      worker.onmessage = ({ data }) => this.receive(data);
      worker.onerror = () => this.fail(error('worker-unavailable', 'LUT 渲染服务不可用。'));
      worker.onmessageerror = () =>
        this.fail(error('worker-unavailable', 'LUT 渲染服务返回了无效数据。'));
    }
    request(type, payload, transfer, expected) {
      if (this.closed) return Promise.reject(error('client-closed', 'LUT 渲染服务已关闭。'));
      const requestId = `${type}-${++this.sequence}`;
      return new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject, expected, type });
        try {
          this.worker.postMessage({ type, requestId, ...payload }, transfer);
        } catch (_) {
          this.pending.delete(requestId);
          reject(error('post-failed', '无法提交 LUT 渲染任务。'));
        }
      });
    }
    receive(message) {
      if (!message || message.protocolVersion !== protocolVersion) {
        this.fail(error('protocol-mismatch', 'LUT 渲染协议不兼容。'));
        return;
      }
      if (message.type === 'ready') {
        if (message.protocol?.version !== protocolVersion)
          this.fail(error('protocol-mismatch', 'LUT 渲染协议不兼容。'));
        else this.resolveReady(message.protocol);
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.type === 'error') {
        pending.reject(
          error(message.code || 'worker-failed', message.message || 'LUT 渲染失败。', message)
        );
        return;
      }
      if (pending.expected !== message.type) {
        pending.reject(error('invalid-worker-response', 'LUT 渲染返回无效结果。'));
        return;
      }
      if (message.type === 'source-ready') this.readyGeneration = message.generation;
      pending.resolve(message);
    }
    fail(reason) {
      if (this.closed) return;
      this.closed = true;
      this.rejectReady(reason);
      for (const entry of this.pending.values()) entry.reject(reason);
      this.pending.clear();
      try {
        this.worker.terminate();
      } catch (_) {}
    }
    afterReady(callback) {
      return this.ready.then(callback);
    }
    validateLut(lutId, bytes) {
      if (!validId(lutId) || !(bytes instanceof ArrayBuffer))
        return Promise.reject(error('invalid-lut', 'LUT 数据无效。'));
      return this.afterReady(() =>
        this.request('validate-lut', { lutId, buffer: bytes }, [bytes], 'lut-validated')
      );
    }
    validateParameters(bytes) {
      if (!(bytes instanceof ArrayBuffer))
        return Promise.reject(error('invalid-json', '参数滤镜数据无效。'));
      return this.afterReady(() =>
        this.request('validate-parameters', { buffer: bytes }, [bytes], 'parameters-validated')
      );
    }
    setSource(value) {
      let source;
      try {
        source = sourceRequest(value);
      } catch (reason) {
        return Promise.reject(reason);
      }
      if (source.generation <= this.highestGeneration)
        return Promise.reject(error('invalid-generation', '源图像版本必须递增。'));
      this.highestGeneration = source.generation;
      for (const [id, pending] of this.pending)
        if (pending.type === 'render' || pending.type === 'set-source') {
          this.pending.delete(id);
          pending.reject(error('operation-superseded', '新图像已替换当前渲染任务。'));
        }
      return this.afterReady(() =>
        this.request('set-source', source, [source.buffer], 'source-ready')
      );
    }
    render({ id, generation, basis, settings }) {
      if (
        !validId(id) ||
        !Number.isSafeInteger(generation) ||
        generation !== this.readyGeneration ||
        !basis ||
        !['lut', 'parameters'].includes(basis.kind)
      )
        return Promise.reject(error('invalid-render-request', 'LUT 渲染请求无效。'));
      return this.afterReady(() =>
        this.request('render', { id, generation, basis, settings }, undefined, 'rendered')
      );
    }
    disposeLut(lutId) {
      if (!validId(lutId)) return Promise.reject(error('invalid-lut', 'LUT 标识无效。'));
      return this.afterReady(() =>
        this.request('dispose-lut', { lutId }, undefined, 'lut-disposed')
      );
    }
    close() {
      this.fail(error('client-closed', 'LUT 渲染服务已关闭。'));
    }
  }
  function create({
    workerFactory,
    workerUrl = 'assets/color-grade/color-grade-p1-worker.js',
  } = {}) {
    const factory = workerFactory || ((url) => new Worker(url));
    if (typeof factory !== 'function') throw error('invalid-worker-factory', 'Worker 工厂无效。');
    return new Client(factory(workerUrl));
  }
  return Object.freeze({ create, Client, P1WorkerClientError, protocolVersion });
});
