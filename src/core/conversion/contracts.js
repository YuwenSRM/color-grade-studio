(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorTransformConversionContracts = api;
})(globalThis, function () {
  'use strict';

  // P3-1 boundary only: P3-2 supplies CUBE/Hald bakers and writers behind this contract.
  const conversionContract = Object.freeze({
    version: 1,
    acceptedLossKinds: Object.freeze([
      'format-rewrite',
      'grid-resample',
      'pipeline-bake',
      'color-space-bake',
    ]),
    progress: Object.freeze({ completed: 'non-negative integer', total: 'positive integer' }),
    cancellation: 'AbortSignal checked between work units',
    memory: 'caller supplies a byte budget; implementations reject work above it',
    workerRecovery:
      'worker failures return a structured recoverable failure and retain the source document',
  });

  const codes = Object.freeze({
    invalidTask: 'invalid-conversion-task',
    cancelled: 'operation-aborted',
    memoryBudgetExceeded: 'memory-budget-exceeded',
  });

  class ConversionTaskError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'ConversionTaskError';
      this.code = code;
      this.stage = 'conversion-contract';
      this.details = Object.freeze({ ...details });
    }
  }

  function createTaskGuard({ signal, onProgress, memoryBudgetBytes = Infinity } = {}) {
    if (!Number.isSafeInteger(memoryBudgetBytes) && memoryBudgetBytes !== Infinity) {
      throw new ConversionTaskError(
        codes.invalidTask,
        'memoryBudgetBytes must be a safe integer or Infinity.'
      );
    }
    function checkpoint(completed, total) {
      if (signal?.aborted) {
        throw new ConversionTaskError(codes.cancelled, 'The conversion was cancelled.', {
          completed,
          total,
        });
      }
      if (
        !Number.isSafeInteger(completed) ||
        !Number.isSafeInteger(total) ||
        completed < 0 ||
        total < 1 ||
        completed > total
      ) {
        throw new ConversionTaskError(codes.invalidTask, 'Progress values are invalid.', {
          completed,
          total,
        });
      }
      if (typeof onProgress === 'function') onProgress(Object.freeze({ completed, total }));
    }
    function reserve(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > memoryBudgetBytes) {
        throw new ConversionTaskError(
          codes.memoryBudgetExceeded,
          'The conversion exceeds its memory budget.',
          { bytes, memoryBudgetBytes }
        );
      }
    }
    return Object.freeze({ checkpoint, reserve, memoryBudgetBytes });
  }

  return Object.freeze({ conversionContract, codes, ConversionTaskError, createTaskGuard });
});
