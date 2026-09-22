'use strict';

importScripts('../color-grade/color-grade-renderer.js');

let generation = -1;
let width = 0;
let height = 0;
let sourcePixels = null;

self.onmessage = ({ data: message }) => {
  const { type, generation: requestedGeneration, id } = message;
  if (requestedGeneration < generation) return;
  try {
    if (type === 'init') {
      generation = requestedGeneration;
      width = message.width;
      height = message.height;
      sourcePixels = null;
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1 ||
        !(message.buffer instanceof ArrayBuffer) ||
        message.buffer.byteLength !== width * height * 4
      ) {
        throw new Error('Invalid thumbnail pixel buffer.');
      }
      sourcePixels = new Uint8ClampedArray(message.buffer);
      return;
    }
    if (type !== 'render' || requestedGeneration !== generation || !sourcePixels) return;
    const pixels = new Uint8ClampedArray(sourcePixels);
    self.ColorGradeRenderer.applyPixels(pixels, message.profile, message.settings);
    self.postMessage({ type: 'rendered', generation, id, width, height, buffer: pixels.buffer }, [
      pixels.buffer,
    ]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      generation: requestedGeneration,
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
