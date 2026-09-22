const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
class LocalResources extends ResourceLoader {
  fetch(url) {
    const filename = path.join(root, new URL(url).pathname);
    return fs.existsSync(filename) ? Promise.resolve(fs.readFileSync(filename)) : null;
  }
}

async function editor({ failWorker = false } = {}) {
  const errors = [];
  const renders = [];
  const encodes = [];
  const observers = [];
  // Alpha of every decoded source pixel; tests lower it to simulate a transparent PNG.
  const sourceAlpha = { value: 255 };
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'color-grade.html'), 'utf8'), {
    url: 'http://localhost/color-grade.html',
    runScripts: 'dangerously',
    resources: new LocalResources(),
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole().on('jsdomError', (error) => errors.push(error.message)),
    beforeParse(window) {
      window.localStorage.setItem('landscape-language', 'zh');
      window.matchMedia = () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      // Browsers provide these Web Platform UTF-8 codecs; JSDOM does not expose them by default.
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.fetch = async (input) => {
        const rawUrl = typeof input === 'string' ? input : input?.url || '';
        const url = new URL(rawUrl, window.location.href);
        const filename = path.join(root, url.pathname.replace(/^\/+/, ''));
        if (fs.existsSync(filename)) {
          const bytes = fs.readFileSync(filename);
          return {
            ok: true,
            arrayBuffer: async () => new window.Uint8Array(bytes).buffer,
            json: async () => JSON.parse(bytes.toString('utf8')),
          };
        }
        return { ok: true, json: async () => ({ authenticated: false }) };
      };
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.IntersectionObserver = class {
        constructor(callback) {
          this.callback = callback;
          this.elements = [];
          observers.push(this);
        }
        observe(element) {
          this.elements.push(element);
        }
        disconnect() {
          this.elements = [];
        }
      };
      if (failWorker) {
        window.Worker = class {
          constructor() {
            throw new Error('Worker blocked by browser policy');
          }
        };
      }
      // JSDOM has no canvas engine. Keep real buffer sizes and the real editor pipeline,
      // while avoiding native drawing; pixel correctness is tested in renderer tests.
      window.HTMLCanvasElement.prototype.getContext = function () {
        if (this.testContext) return this.testContext;
        const canvas = this;
        const pixels = (width, height, alpha = 0) => {
          const data = new Uint8ClampedArray(width * height * 4);
          if (alpha) for (let index = 3; index < data.length; index += 4) data[index] = alpha;
          return { width, height, data };
        };
        this.testContext = {
          canvas,
          drawImage() {},
          clearRect() {},
          createImageData: pixels,
          getImageData: (_x, _y, width, height) => pixels(width, height, sourceAlpha.value),
          putImageData(data) {
            canvas.lastPixels = data;
          },
        };
        return this.testContext;
      };
      window.HTMLCanvasElement.prototype.toBlob = function (callback, mime) {
        encodes.push({ width: this.width, height: this.height, mime });
        callback(new window.Blob(['test image'], { type: mime }));
      };
    },
  });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(errors, []);
  const { window } = dom;
  window.LandscapeColorImport = { ...window.LandscapeColorImport };
  window.ColorGradeRenderer.applyPixels = (pixels) => {
    renders.push(pixels.length / 4);
    return pixels;
  };
  const complete = async (width = 4000, height = 3000, name = 'large.jpg') => {
    window.LandscapeColorImport.load = async () => ({ naturalWidth: width, naturalHeight: height });
    await window.loadFile({ name, size: 1024, type: 'image/jpeg' });
  };
  const show = (count) => {
    const observer = [...observers]
      .reverse()
      .find((candidate) =>
        candidate.elements.some((element) => element.classList.contains('variant'))
      );
    const targetObserver = observer || observers.at(-1);
    assert.ok(targetObserver, 'the page must initialize its intersection observers');
    targetObserver.callback(
      targetObserver.elements.slice(0, count).map((target) => ({ target, isIntersecting: true }))
    );
  };
  const close = () => {
    window.dispatchEvent(new window.Event('pagehide'));
    dom.window.close();
  };
  const setSourceAlpha = (alpha) => {
    sourceAlpha.value = alpha;
  };
  return {
    window,
    doc: window.document,
    complete,
    show,
    setSourceAlpha,
    renders,
    encodes,
    errors,
    close,
  };
}

async function until(check, message, timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(typeof message === 'function' ? message() : message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('filter cards omit image previews and thumbnail work until a photo is imported', async () => {
  const app = await editor();
  try {
    await until(
      () => app.doc.querySelectorAll('.variant').length === 24,
      'filter library did not initialize'
    );
    assert.equal(app.doc.querySelectorAll('.variant canvas').length, 0);
    assert.equal(app.renders.length, 0);
    assert.equal(app.doc.querySelector('#variants').getAttribute('aria-busy'), 'false');
    assert.ok(
      app.doc.querySelectorAll('.variant').length > 0 &&
        Array.from(app.doc.querySelectorAll('.variant')).every((card) =>
          card.classList.contains('no-preview')
        )
    );
    app.show(24);
    assert.equal(app.renders.length, 0);
    assert.equal(app.doc.querySelectorAll('.variant canvas').length, 0);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('P2 self-developed builtin is searchable, favorite-compatible and exports Hald without a photo', async () => {
  const app = await editor();
  try {
    const search = app.doc.querySelector('#filterSearch');
    search.value = '柔和肖像';
    search.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () => app.doc.querySelectorAll('.variant').length === 1,
      'P2 builtin was not searchable'
    );
    const card = app.doc.querySelector('.variant');
    assert.match(card.textContent, /内置 · 自研/);
    assert.equal(card.variant.id, 'p2-soft-portrait');
    assert.match(card.textContent, /柔和肖像/);
    assert.match(card.textContent, /自研风格模拟/);
    card.click();
    assert.equal(app.doc.querySelector('#exportHald').disabled, false);
    assert.match(app.doc.querySelector('#haldInfo').textContent, /Level 8 · sRGB SDR/);
    assert.equal(app.doc.querySelector('.applied-filter-intensity').textContent, '滤镜强度 100%');
    const intensity = app.doc.querySelector('#filterIntensityInput');
    intensity.value = '65';
    intensity.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(app.doc.querySelector('.applied-filter-intensity-value').textContent, '65%');
    assert.equal(app.doc.querySelectorAll('.variant canvas').length, 0);
    const builtinResponse = await app.window.fetch(
      'assets/color-grade/p2-builtin-filters/soft-portrait.cube'
    );
    const builtinValidation = app.window.ColorGradeLut.validateBytes(
      await builtinResponse.arrayBuffer()
    );
    assert.equal(
      builtinValidation.ok,
      true,
      builtinValidation.error?.message || builtinValidation.code
    );

    let downloads = 0;
    app.window.URL.createObjectURL = () => 'blob:p2-hald';
    app.window.URL.revokeObjectURL = () => {};
    app.window.HTMLAnchorElement.prototype.click = function () {
      downloads += 1;
    };
    app.doc.querySelector('#exportHald').click();
    await until(
      () => /Hald CLUT 已导出/.test(app.doc.querySelector('#haldInfo').textContent),
      () =>
        `Hald export did not complete: ${app.doc.querySelector('#haldInfo').textContent}; ${app.doc.querySelector('#editorToast').textContent}`,
      8000
    );
    assert.equal(downloads, 1);
    assert.equal(app.doc.querySelector('#exportHald').disabled, false);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('LUT strength is isolated by LUT identity when switching and returning', async () => {
  const app = await editor();
  try {
    await until(
      () => app.doc.querySelectorAll('.variant').length >= 3,
      'filter library did not initialize'
    );
    const search = app.doc.querySelector('#filterSearch');
    search.value = '柔和肖像';
    search.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(() => app.doc.querySelectorAll('.variant').length === 1, 'first LUT was not found');
    app.doc.querySelector('.variant').click();
    const intensity = app.doc.querySelector('#filterIntensityInput');
    intensity.value = '35';
    intensity.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(intensity.value, '35');
    search.value = '清澈风景';
    search.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () => app.doc.querySelectorAll('.variant').length === 1,
      'second LUT was not found'
    );
    app.doc.querySelector('.variant').click();
    assert.equal(intensity.value, '100', 'a newly selected LUT starts at full strength');
    search.value = '柔和肖像';
    search.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () => app.doc.querySelectorAll('.variant').length === 1,
      'first LUT was not found again'
    );
    app.doc.querySelector('.variant').click();
    assert.equal(intensity.value, '35', 'returning to a LUT restores its confirmed strength');
  } finally {
    app.close();
  }
});

test('the shared filter intensity control mixes built-in parameter filters and hides for neutral', async () => {
  const app = await editor();
  try {
    await app.complete();
    const control = app.doc.querySelector('#filterIntensity');
    const input = app.doc.querySelector('#filterIntensityInput');
    assert.equal(control.hidden, false);
    assert.equal(app.window.getComputedStyle(control).display, 'grid');
    assert.equal(input.getAttribute('aria-valuetext'), '滤镜强度 100%');
    assert.equal(control.hasAttribute('aria-describedby'), false);
    assert.equal(input.hasAttribute('aria-describedby'), false);

    let endpointRenders = 0;
    app.window.ColorGradeRenderer.applyPixels = (pixels) => {
      endpointRenders += 1;
      pixels[0] = 200;
      return pixels;
    };
    // A content mutation rebuilds F560 once; subsequent strength inputs only mix it.
    const exposure = app.doc.querySelector('#exposure');
    exposure.value = '1';
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () => app.doc.querySelector('#mainCanvas').lastPixels?.data[0] === 200,
      'parameter endpoint was not rendered'
    );
    const renderedEndpointCount = endpointRenders;
    input.value = '0';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () => app.doc.querySelector('#mainCanvas').lastPixels?.data[0] === 0,
      '0% was not mixed'
    );
    assert.equal(input.getAttribute('aria-valuetext'), '滤镜强度 0%');

    input.value = '100';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () => app.doc.querySelector('#mainCanvas').lastPixels?.data[0] === 200,
      '100% parameter effect was not rendered'
    );
    assert.equal(
      endpointRenders,
      renderedEndpointCount,
      'strength-only inputs must not rebuild the parameter endpoint'
    );

    app.window.eval('neutralBaseActive = true; syncFilterIntensityUi()');
    assert.equal(control.hidden, true);
    assert.equal(app.window.getComputedStyle(control).display, 'none');
  } finally {
    app.close();
  }
});

test('A1 parameter-filter endpoints preserve source alpha at 0, 50 and 100 percent', async () => {
  const app = await editor();
  try {
    app.setSourceAlpha(137);
    await app.complete();
    app.window.ColorGradeRenderer.applyPixels = (pixels) => {
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = 200;
        pixels[index + 3] = 0;
      }
      return pixels;
    };
    const exposure = app.doc.querySelector('#exposure');
    exposure.value = '8';
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () => app.doc.querySelector('#mainCanvas').lastPixels?.data[0] === 200,
      'parameter endpoint did not become available'
    );
    const intensity = app.doc.querySelector('#filterIntensityInput');
    for (const [value, expectedRed] of [
      ['0', 0],
      ['50', 100],
      ['100', 200],
    ]) {
      intensity.value = value;
      intensity.dispatchEvent(new app.window.Event('input', { bubbles: true }));
      await until(
        () => app.doc.querySelector('#mainCanvas').lastPixels?.data[0] === expectedRed,
        `${value}% parameter endpoint did not commit`
      );
      assert.equal(
        app.doc.querySelector('#mainCanvas').lastPixels.data[3],
        137,
        `${value}% must retain original alpha`
      );
    }
  } finally {
    app.close();
  }
});

test('the preview status stays pending until the requested high-quality endpoint settles', async () => {
  const app = await editor();
  try {
    await app.complete();
    app.window.eval(`
      pendingHighQualityPreviewSequence = highQualityPreviewSequence + 1;
      requestedIntensity = 0.65;
      presentedIntensity = 0.65;
      setIntensityPresentationBusy(true);
      setIntensityPresentationBusy(false);
    `);
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(
      app.doc.querySelector('#filterIntensity').getAttribute('aria-busy'),
      'true',
      'the 560px commit cannot clear status while its 1100px request is pending'
    );
    app.window.eval(`
      pendingHighQualityPreviewSequence = 0;
      setIntensityPresentationBusy(false);
    `);
    await until(
      () => app.doc.querySelector('#filterIntensity').getAttribute('aria-busy') === 'false',
      'the status did not settle after the high-quality request completed'
    );
    const previousSequence = app.window.eval('highQualityPreviewSequence');
    app.window.eval(`
      pendingHighQualityPreviewSequence = highQualityPreviewSequence;
      requestedIntensity = 0.4;
      presentedIntensity = 0.4;
    `);
    const input = app.doc.querySelector('#filterIntensityInput');
    input.value = '41';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(
      app.window.eval('pendingHighQualityPreviewSequence'),
      0,
      'a new drag must invalidate a stale high-quality request'
    );
    assert.ok(
      app.window.eval('highQualityPreviewSequence') > previousSequence,
      'the stale high-quality result must fail its sequence check'
    );
    await until(
      () =>
        app.window.eval(
          'interactiveEndpoint && interactiveEndpointMatchesCurrent(interactiveEndpoint) && mixFrameId === null'
        ),
      'the replacement interactive endpoint did not settle'
    );
    // Let the delayed presentation-state cleanup finish before closing JSDOM.
    await new Promise((resolve) => setTimeout(resolve, 140));
  } finally {
    app.close();
  }
});

test('a new LUT strength drag cancels queued and active high-quality work without touching other jobs', async () => {
  const app = await editor();
  try {
    await app.complete();
    app.window.eval(`(() => {
      const rejected = [];
      const client = { close() {} };
      p1LutClient = client;
      p1RenderQueue = [
        { priority: 'high-quality', reject: (error) => rejected.push(['queued', error.code]) },
        { priority: 'interactive', reject: (error) => rejected.push(['interactive', error.code]) },
        { priority: 'thumbnail', reject: (error) => rejected.push(['thumbnail', error.code]) },
      ];
      p1ActiveRenderJob = { priority: 'high-quality', client };
      window.__highQualityCancellationTrace = { rejected };
    })()`);
    const input = app.doc.querySelector('#filterIntensityInput');
    input.value = '99';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    const result = JSON.parse(
      app.window.eval(`(() => {
      const { rejected } = window.__highQualityCancellationTrace;
      const remaining = p1RenderQueue.map((job) => job.priority);
      const activeYielded = p1ActiveRenderJob.yielded;
      p1RenderQueue = [];
      p1ActiveRenderJob = null;
      p1LutClient = null;
      return JSON.stringify({ rejected, remaining, activeYielded });
    })()`)
    );
    assert.deepEqual(result.rejected, [['queued', 'render-superseded']]);
    assert.deepEqual(result.remaining, ['interactive', 'thumbnail']);
    assert.equal(result.activeYielded, 'cancel');
  } finally {
    app.close();
  }
});

test('a 1100px request uses an immutable snapshot and cannot overwrite a newer interactive frame', async () => {
  const app = await editor();
  try {
    await app.complete();
    const exposure = app.doc.querySelector('#exposure');
    const baseline = Number(exposure.value);
    const originalProfileBrightness = app.window.eval('variants[selected].p.b');
    const renders = [];
    app.window.ColorGradeRenderer.applyPixels = (pixels, profile, settings) => {
      renders.push({
        pixels: pixels.length / 4,
        brightness: profile.b,
        exposure: settings?.delta?.exposure,
      });
      pixels[0] = Math.round(128 + (settings?.delta?.exposure || 0));
      return pixels;
    };

    exposure.value = String(baseline + 11);
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () => app.window.eval('interactiveEndpoint && interactiveEndpoint.width === 560'),
      'the first interactive endpoint did not settle'
    );
    const snapshotExposure = app.window.eval(
      'currentRenderSettings(variants[selected].p).delta.exposure'
    );
    const sequenceBeforeHighQuality = app.window.eval('highQualityPreviewSequence');
    app.window.eval('scheduleHighQualityEndpoint({ variant: variants[selected], manual: true })');
    assert.equal(app.window.eval('highQualityPreviewSequence'), sequenceBeforeHighQuality + 1);

    // Mutate both state layers before the Promise-backed 1100px render can commit.
    app.window.eval('variants[selected].p.b = 9');
    exposure.value = String(baseline + 43);
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(
      () =>
        app.window.eval(
          'interactiveEndpoint && interactiveEndpoint.gradingRevision === gradingRevision && mixFrameId === null'
        ),
      'the replacement interactive endpoint did not settle'
    );

    const highQualityRender = renders.find((render) => render.pixels === 1100 * 825);
    assert.deepEqual(
      highQualityRender,
      { pixels: 1100 * 825, brightness: originalProfileBrightness, exposure: snapshotExposure },
      'the 1100px renderer must retain the request-time profile and settings'
    );
    assert.equal(
      app.doc.querySelector('#mainCanvas').width,
      560,
      'a stale 1100px result must not replace the newer 560px interactive frame'
    );
    assert.equal(app.window.eval('pendingHighQualityPreviewSequence'), 0);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('range pointerup requests one deduplicated 1100px endpoint before change', async () => {
  const app = await editor();
  try {
    await app.complete();
    const intensity = app.doc.querySelector('#filterIntensityInput');
    intensity.value = '62';
    intensity.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    const afterInput = app.window.eval('highQualityPreviewSequence');
    intensity.dispatchEvent(new app.window.Event('pointerup', { bubbles: true }));
    const afterPointerUp = app.window.eval('highQualityPreviewSequence');
    assert.equal(afterPointerUp, afterInput + 1, 'pointerup must request the settled endpoint');
    intensity.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(
      app.window.eval('highQualityPreviewSequence'),
      afterPointerUp,
      'change after pointerup must reuse the same immutable endpoint request'
    );
    await until(
      () => app.doc.querySelector('#mainCanvas').width === 1100,
      'the settled high-quality endpoint did not commit'
    );
    await new Promise((resolve) => setTimeout(resolve, 140));
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('a pending 100% LUT endpoint retains a frame and falls back to source when none exists', async () => {
  const app = await editor();
  try {
    await app.complete();
    app.window.eval(`
      interactiveEndpoint = null;
      requestedIntensity = 1;
      presentedIntensity = 0;
      previewHasContent = false;
      renderInteractiveEffect = () => new Promise(() => {});
      startInteractiveEndpoint({ variant: variants[selected], manual: true, invalidateContent: false });
    `);
    await until(
      () => app.doc.querySelector('#mainCanvas').lastPixels?.width === 560,
      'a pending full-strength LUT endpoint must immediately paint the source fallback'
    );
    const main = app.doc.querySelector('#mainCanvas');
    assert.equal(main.lastPixels.data[0], 0, 'the fallback must use ungraded source pixels');
    assert.equal(app.window.eval('previewHasContent'), true);
    assert.equal(
      app.doc.querySelector('#filterIntensity').getAttribute('aria-busy'),
      'true',
      'the fallback must not claim that the requested 100% endpoint is ready'
    );
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('a 1100px CPU hand-off prepares pixels before retiring the visible GPU frame', async () => {
  const app = await editor();
  try {
    await app.complete();
    const main = app.doc.querySelector('#mainCanvas');
    const gpu = app.doc.querySelector('#interactiveCanvas');
    let gpuWasVisibleWhilePreparing = false;
    const context = main.getContext('2d');
    const createImageData = context.createImageData.bind(context);
    context.createImageData = (...args) => {
      gpuWasVisibleWhilePreparing = gpu.classList.contains('is-active');
      return createImageData(...args);
    };
    gpu.classList.add('is-active');
    main.style.visibility = 'hidden';
    app.window.eval(`
      gpuInteractiveState = { revision: contentRevision };
      stage.dataset.interactiveRenderer = 'webgl';
      putPreviewPixels(new Uint8ClampedArray(1100 * 825 * 4).fill(73), 1100, 825, 1100);
    `);
    assert.equal(gpuWasVisibleWhilePreparing, true);
    assert.equal(gpu.classList.contains('is-active'), false);
    assert.equal(main.style.visibility, '');
    assert.deepEqual([main.width, main.height], [1100, 825]);
    assert.equal(main.lastPixels.data[0], 73);
    assert.equal(app.window.eval('previewHasContent'), true);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('interactive endpoint mixing preserves source alpha at 0, 50 and 100 percent', async () => {
  const app = await editor();
  try {
    const result = app.window.eval(`(() => {
      const source = new Uint8ClampedArray([10, 30, 50, 37, 200, 100, 0, 211]);
      const effect = new Uint8ClampedArray([110, 130, 150, 99, 0, 40, 240, 3]);
      return [0, 0.5, 1].map((intensity) => {
        const mixed = new Uint8ClampedArray(effect);
        blendFilterIntensity(mixed, source, intensity);
        return Array.from(mixed);
      });
    })()`);
    assert.deepEqual(Array.from(result[0]), [10, 30, 50, 37, 200, 100, 0, 211]);
    assert.deepEqual(Array.from(result[1]), [60, 80, 100, 37, 100, 70, 120, 211]);
    assert.deepEqual(Array.from(result[2]), [110, 130, 150, 37, 0, 40, 240, 211]);
    assert.deepEqual(
      Array.from([
        result[0][3],
        result[1][3],
        result[2][3],
        result[0][7],
        result[1][7],
        result[2][7],
      ]),
      [37, 37, 37, 211, 211, 211],
      'the compositor must retain endpoint alpha rather than interpolate it'
    );
  } finally {
    app.close();
  }
});

test('new editor adjustments use standard highlights and the tone palette maps rightward to positive', async () => {
  const app = await editor();
  try {
    const toneModel = app.window.eval(
      'currentRenderSettings({ b: 1, c: 1, s: 1, w: 1, t: 0 }).toneModel'
    );
    assert.equal(toneModel, 'standard-v2');
    app.window.eval("applyQuadrantPalette('tone', 1, 0.5)");
    assert.ok(Number(app.doc.querySelector('#highlights').value) > 0);
    assert.match(app.doc.querySelector('#highlightsV').textContent, /^\+/);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('manual colour inputs share the revisioned interactive preview scheduler', async () => {
  const app = await editor();
  try {
    await app.complete();
    const revision = () => app.window.eval('gradingRevision');
    const initialRevision = revision();
    const exposure = app.doc.querySelector('#exposure');
    exposure.value = '12';
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(
      revision(),
      initialRevision + 1,
      'basic adjustments must commit a grading revision'
    );

    const hue = app.doc.querySelector('#shadowHue');
    hue.value = '218';
    hue.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(revision(), initialRevision + 2, 'HSL controls must use the same scheduler');

    app.window.eval("applyQuadrantPalette('color', 0.8, 0.2)");
    assert.equal(
      revision(),
      initialRevision + 3,
      'palette interactions must use the same scheduler'
    );

    const intensity = app.doc.querySelector('#filterIntensityInput');
    intensity.value = '43';
    intensity.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(
      revision(),
      initialRevision + 3,
      'strength-only inputs must retain the cached endpoint'
    );

    await until(
      () =>
        app.window.eval(
          'interactiveEndpoint && interactiveEndpoint.gradingRevision === gradingRevision'
        ),
      'the endpoint did not commit the newest grading revision'
    );
    assert.equal(app.window.eval('interactiveEndpoint.width'), 560);
    assert.equal(app.window.eval('interactiveEndpoint.height'), 420);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('studio-v2 grade tabs keep one accessible panel visible and preserve synchronized controls', async () => {
  const app = await editor();
  try {
    await app.complete();
    const tabs = [...app.doc.querySelectorAll('.grade-tone-tab')];
    assert.equal(tabs.length, 3);
    assert.equal(tabs[0].getAttribute('role'), 'tab');
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
    assert.equal(app.doc.querySelector('#gradeTonePanelShadow').hidden, false);
    assert.equal(app.doc.querySelector('#gradeTonePanelMid').hidden, true);
    tabs[0].dispatchEvent(
      new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    assert.equal(app.doc.activeElement, tabs[1]);
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
    tabs[1].dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
    assert.equal(app.doc.querySelector('#gradeTonePanelShadow').hidden, true);
    assert.equal(app.doc.querySelector('#gradeTonePanelMid').hidden, false);
    const colorInput = app.doc.querySelector('#midColor');
    let pickerFallbackCalls = 0;
    colorInput.click = () => {
      pickerFallbackCalls += 1;
    };
    app.doc.querySelector('[data-grade-color-picker="mid"]').click();
    assert.equal(
      pickerFallbackCalls,
      1,
      'current-color button must retain the native picker fallback'
    );
    const hue = app.doc.querySelector('#shadowHue');
    const saturation = app.doc.querySelector('#shadowSat');
    const lightness = app.doc.querySelector('#shadowLight');
    const amount = app.doc.querySelector('#shadowAmt');
    const balance = app.doc.querySelector('#gradeBalance');
    assert.equal(hue.type, 'number');
    assert.equal(saturation.type, 'number');
    assert.equal(lightness.type, 'number');
    hue.value = '218';
    saturation.value = '36';
    lightness.value = '8';
    amount.value = '24';
    balance.value = '-18';
    for (const input of [hue, saturation, lightness, amount, balance])
      input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(app.doc.querySelector('#shadowHue').value, '218');
    assert.equal(app.doc.querySelector('#shadowSat').value, '36');
    assert.equal(app.doc.querySelector('#shadowLight').value, '8');
    assert.equal(app.doc.querySelector('#shadowAmtInput').value, '24');
    assert.equal(app.doc.querySelector('#gradeBalanceInput'), null);
    assert.equal(app.doc.querySelector('#gradeBalanceV').textContent, '-18');
    assert.equal(balance.getAttribute('aria-valuenow'), '-18');
    assert.equal(balance.getAttribute('aria-valuetext'), '全局平衡，阴影至高光，-18');
    assert.deepEqual(
      [...app.doc.querySelectorAll('.grade-balance-scale span')].map((node) => node.textContent),
      ['阴影', '中性', '高光']
    );
    const resetAll = app.doc.querySelector('[data-grade-reset="all"]');
    const gradingGroup = resetAll.closest('.color-grading-group');
    assert.equal(gradingGroup.open, true);
    assert.equal(resetAll.textContent.trim(), '↺');
    assert.equal(resetAll.closest('summary').classList.contains('adjustment-group-heading'), true);
    assert.equal(resetAll.getAttribute('aria-label'), '重置色彩分级');
    assert.equal(resetAll.getAttribute('title'), '重置色彩分级');
    resetAll.click();
    assert.equal(gradingGroup.open, true, 'section reset must not toggle its details summary');
    assert.equal(app.doc.querySelector('#shadowHue').value, '210');
    assert.equal(app.doc.querySelector('#gradeBalance').value, '0');
    assert.equal(app.doc.querySelector('#gradeBalanceV').textContent, '0');
    assert.equal(app.doc.querySelector('#gradeBalance').getAttribute('aria-valuenow'), '0');
    app.window.ColorGradeI18n.setLocale('en-US');
    assert.equal(app.doc.querySelector('#gradeBalanceV').textContent, '0');
    assert.equal(
      app.doc.querySelector('#gradeBalance').getAttribute('aria-valuetext'),
      'Global balance, shadows to highlights, 0'
    );
    assert.deepEqual(
      [...app.doc.querySelectorAll('.grade-balance-scale span')].map((node) => node.textContent),
      ['Shadows', 'Neutral', 'Highlights']
    );
    for (const tab of tabs) {
      tab.click();
      const panel = app.doc.querySelector(`#${tab.getAttribute('aria-controls')}`);
      assert.equal(panel.hidden, false);
      assert.doesNotMatch(
        panel.textContent,
        /[\u3400-\u9fff]/,
        `${tab.id} must not retain Chinese static copy after switching to English`
      );
    }
    const gradeCss = fs.readFileSync(
      path.join(root, 'assets', 'color-grade', 'workbench', 'styles', 'controls.css'),
      'utf8'
    );
    assert.match(gradeCss, /grid-template-columns: repeat\(3, minmax\(72px, 1fr\)\)/);
    assert.match(gradeCss, /\.grade-tone-panel\[hidden\]/);
    app.doc.querySelector('#apply').click();
    app.doc.querySelectorAll('.variant')[1].click();
    app.doc.querySelectorAll('.variant')[0].click();
    assert.equal(app.doc.querySelector('#shadowHue').value, '210');
    assert.equal(app.doc.querySelector('#gradeBalance').value, '0');
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('2.35:1 crop and comparison views are preview-only controls', async () => {
  const app = await editor();
  try {
    const coordinates = ['cropX', 'cropY', 'cropWidth', 'cropHeight'];
    assert.equal(app.doc.querySelector('#cropGeometry'), null);
    coordinates.forEach((id) => assert.equal(app.doc.querySelector(`#${id}`), null));
    await app.complete(4000, 3000);
    const crop = app.doc.querySelector('#cropAspect');
    crop.value = '2.35:1';
    crop.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(crop.value, '2.35:1');
    assert.match(app.doc.querySelector('#cropHint').textContent, /比例将保持固定/);
    const stage = app.doc.querySelector('#stage');
    stage.dispatchEvent(
      new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    assert.equal(app.doc.querySelector('#undoCrop').disabled, false);
    app.doc.querySelector('#undoCrop').click();
    assert.equal(crop.value, '2.35:1');
    app.doc.querySelector('#applyCrop').click();
    assert.equal(crop.value, 'native');
    assert.equal(app.doc.querySelector('#comparisonDivider').hidden, true);
    app.doc.querySelector('#compareOriginal').click();
    assert.equal(app.doc.querySelector('#stage').dataset.comparison, 'original');
    assert.equal(app.doc.querySelector('#comparisonCanvas').hidden, false);
    app.doc.querySelector('#compareSplitVertical').click();
    const divider = app.doc.querySelector('#comparisonDivider');
    assert.equal(divider.hidden, false);
    divider.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(divider.getAttribute('aria-valuenow'), '100');
    app.doc.querySelector('#compareSplitHorizontal').click();
    assert.equal(divider.getAttribute('aria-orientation'), 'horizontal');
    app.doc.querySelector('#compareEffect').click();
    assert.equal(app.doc.querySelector('#comparisonCanvas').hidden, true);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('preview and thumbnails use a neutral matte; checkerboard only for real alpha pixels', async () => {
  const app = await editor();
  try {
    const stage = app.doc.querySelector('#stage');
    const variants = app.doc.querySelector('#variants');
    assert.equal(stage.classList.contains('has-alpha'), false);
    assert.equal(app.doc.querySelectorAll('.variant canvas').length, 0);
    // Opaque photos (JPEG, WebP, plain PNG) must never show the checkerboard.
    await app.complete(2400, 3600, 'portrait.png');
    assert.equal(stage.classList.contains('empty'), false);
    assert.equal(stage.classList.contains('has-alpha'), false);
    assert.equal(variants.classList.contains('has-alpha'), false);
    app.show(4);
    await until(
      () => app.doc.querySelectorAll('.variant:not(.is-pending) canvas').length >= 4,
      'thumbnails did not render'
    );
    assert.equal(variants.classList.contains('has-alpha'), false);
    // A decoded source with alpha < 255 turns the checkerboard on for both regions.
    app.setSourceAlpha(128);
    await app.complete(800, 600, 'cutout.png');
    assert.equal(stage.classList.contains('has-alpha'), true);
    assert.equal(variants.classList.contains('has-alpha'), true);
    // Applying a crop keeps the state in sync with the current source.
    app.doc.querySelector('#applyCrop').click();
    assert.equal(stage.classList.contains('has-alpha'), true);
    // Replacing with an opaque photo removes it again; detection follows pixels, not names.
    app.setSourceAlpha(255);
    await app.complete(800, 600, 'opaque.png');
    assert.equal(stage.classList.contains('has-alpha'), false);
    assert.equal(variants.classList.contains('has-alpha'), false);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('12 MP and 24 MP imports show one full preview before any offscreen preset is rendered', async () => {
  const app = await editor();
  try {
    for (const [width, height] of [
      [4000, 3000],
      [6000, 4000],
    ]) {
      app.renders.length = 0;
      await app.complete(width, height);
      const main = app.doc.querySelector('#mainCanvas');
      assert.deepEqual([main.width, main.height], [1100, Math.round((height * 1100) / width)]);
      assert.equal(app.doc.querySelector('#stage').getAttribute('aria-busy'), 'false');
      assert.equal(app.doc.querySelector('#importStatus').hidden, true);
      assert.equal(app.doc.querySelector('#apply').disabled, false);
      assert.equal(app.doc.querySelectorAll('.variant').length, 24);
      assert.equal(app.doc.querySelector('#variantPageStatus').textContent, '1 / 4 页');
      assert.equal(
        app.renders.length,
        1,
        'import must not transform all 76 high-resolution presets'
      );
      assert.ok(
        Array.from(app.doc.querySelectorAll('.variant canvas')).every(
          (canvas) => canvas.width === 1 && canvas.height === 1
        )
      );
    }
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

for (const failWorker of [false, true]) {
  test(`visible preset thumbnails render lazily at 320 px with ${failWorker ? 'failed' : 'unavailable'} worker`, async () => {
    const app = await editor({ failWorker });
    try {
      await app.complete();
      app.show(3);
      await until(
        () => app.doc.querySelectorAll('.variant:not(.is-pending)').length === 3,
        'visible thumbnails did not finish with the main-thread fallback'
      );
      assert.equal(app.renders.length, 4);
      assert.ok(app.renders.slice(1).every((count) => count === 320 * 240));
      const thumbnails = Array.from(app.doc.querySelectorAll('.variant canvas'));
      assert.equal(thumbnails.filter((canvas) => canvas.width === 320).length, 3);
      app.doc.querySelector('#clearFilters').click();
      assert.equal(
        app.doc.querySelector('.variant canvas'),
        thumbnails[0],
        'filter redraw must reuse the thumbnail buffer'
      );
      assert.equal(app.doc.querySelector('#mainCanvas').width, 1100);
      assert.deepEqual(app.errors, []);
    } finally {
      app.close();
    }
  });
}

test('rapid A/B replacement ignores stale A and stays busy until B becomes ready', async () => {
  const app = await editor();
  try {
    const jobs = [];
    app.window.LandscapeColorImport.load = (file, { signal }) =>
      new Promise((resolve) => jobs.push({ file, signal, resolve }));
    const pendingA = app.window.loadFile({ name: 'A.jpg', size: 1, type: 'image/jpeg' });
    const pendingB = app.window.loadFile({ name: 'B.jpg', size: 1, type: 'image/jpeg' });
    assert.equal(jobs[0].signal.aborted, true);
    assert.equal(app.doc.querySelector('#stage').getAttribute('aria-busy'), 'true');
    assert.equal(app.doc.querySelector('#apply').disabled, true);
    jobs[0].resolve({ naturalWidth: 800, naturalHeight: 600 });
    await pendingA;
    assert.equal(app.doc.querySelector('#stage').getAttribute('aria-busy'), 'true');
    jobs[1].resolve({ naturalWidth: 6000, naturalHeight: 4000 });
    await pendingB;
    assert.equal(app.doc.querySelector('#fileName').textContent, 'B.jpg');
    assert.match(app.doc.querySelector('#fileInfo').textContent, /6000 × 4000/);
    assert.equal(app.renders.length, 1);
    assert.equal(app.doc.querySelector('#stage').getAttribute('aria-busy'), 'false');
  } finally {
    app.close();
  }
});

test('failed or cancelled replacement preserves the current image and permits a later import', async () => {
  const app = await editor();
  try {
    await app.complete(4000, 3000, 'original.jpg');
    app.window.LandscapeColorImport.load = async () => {
      throw new Error('图片解码失败，请选择有效的图片。');
    };
    await app.window.loadFile({ name: 'broken.png', size: 7, type: 'image/png' });
    assert.equal(app.doc.querySelector('#fileName').textContent, 'original.jpg');
    assert.equal(app.doc.querySelector('#mainCanvas').width, 1100);
    assert.equal(app.doc.querySelector('#apply').disabled, false);
    assert.equal(
      app.doc.querySelector('#editorToast').textContent,
      '图片读取失败，请选择有效的图片。'
    );
    let finish;
    let signal;
    app.window.LandscapeColorImport.load = (_file, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const pending = app.window.loadFile({ name: 'cancelled.jpg', size: 1, type: 'image/jpeg' });
    app.doc.querySelector('#cancelImport').click();
    assert.equal(signal.aborted, true);
    assert.equal(app.doc.querySelector('#stage').getAttribute('aria-busy'), 'false');
    finish({ naturalWidth: 800, naturalHeight: 600 });
    await pending;
    assert.equal(app.doc.querySelector('#fileName').textContent, 'original.jpg');
    await app.complete(2400, 3600, 'recovered.jpg');
    assert.equal(app.doc.querySelector('#fileName').textContent, 'recovered.jpg');
    assert.deepEqual(
      [app.doc.querySelector('#mainCanvas').width, app.doc.querySelector('#mainCanvas').height],
      [733, 1100]
    );
  } finally {
    app.close();
  }
});

test('selection, apply, crop, undo and original export retain full preview and source dimensions', async () => {
  const app = await editor();
  try {
    await app.complete();
    app.show(2);
    await until(
      () => app.doc.querySelectorAll('.variant:not(.is-pending)').length === 2,
      'thumbnails not ready'
    );
    app.doc.querySelectorAll('.variant')[1].click();
    await until(
      () =>
        app.doc.querySelector('#mainCanvas').width === 560 &&
        app.doc.querySelector('#mainCanvas').height === 420,
      'selected filter did not commit a 560px interaction endpoint'
    );
    const exposure = app.doc.querySelector('#exposure');
    exposure.value = '15';
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.doc.querySelector('#apply').click();
    await app.window.createExportBlob('original');
    assert.deepEqual(app.encodes.at(-1), { width: 4000, height: 3000, mime: 'image/png' });
    const aspect = app.doc.querySelector('#cropAspect');
    aspect.value = '1:1';
    aspect.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    app.doc.querySelector('#applyCrop').click();
    await until(
      () =>
        app.doc.querySelector('#mainCanvas').width === 560 &&
        app.doc.querySelector('#mainCanvas').height === 560,
      'cropped filter did not rebuild a 560px interaction endpoint'
    );
    await app.window.createExportBlob('original');
    assert.deepEqual(app.encodes.at(-1), { width: 3000, height: 3000, mime: 'image/png' });
    assert.ok(
      Array.from(app.doc.querySelectorAll('.variant canvas')).every(
        (canvas) => Math.max(canvas.width, canvas.height) <= 320
      )
    );
    app.doc.querySelector('#undoCrop').click();
    await app.window.createExportBlob('original');
    assert.deepEqual(app.encodes.at(-1), { width: 4000, height: 3000, mime: 'image/png' });
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('cancelling an export discards a pending encoded Blob without downloading it', async () => {
  const app = await editor();
  try {
    await app.complete();
    let completeEncode;
    let downloads = 0;
    app.window.HTMLCanvasElement.prototype.toBlob = function (callback) {
      completeEncode = () => callback(new app.window.Blob(['late image'], { type: 'image/png' }));
    };
    app.window.HTMLAnchorElement.prototype.click = function () {
      downloads += 1;
    };
    app.doc.querySelector('#download').click();
    await until(() => typeof completeEncode === 'function', 'export did not reach image encoding');
    assert.equal(app.doc.querySelector('#cancelExport').hidden, false);
    assert.equal(app.doc.querySelector('#download').disabled, true);
    app.doc.querySelector('#cancelExport').click();
    await until(
      () => app.doc.querySelector('#cancelExport').hidden,
      'export cancellation did not settle'
    );
    assert.match(app.doc.querySelector('#status').textContent, /已取消导出/);
    completeEncode();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(downloads, 0);
    assert.equal(app.doc.querySelector('#download').disabled, false);
  } finally {
    app.close();
  }
});

test('an image export keeps the click-time filter settings while its Blob is pending', async () => {
  const app = await editor();
  try {
    await app.complete();
    const exposure = app.doc.querySelector('#exposure');
    const baseline = Number(exposure.value);
    let capturedPixel = null;
    let finishEncode;
    app.window.ColorGradeRenderer.applyPixels = (pixels, _profile, settings) => {
      pixels[0] = 128 + Math.round(settings?.delta?.exposure || 0);
      return pixels;
    };
    app.window.HTMLCanvasElement.prototype.toBlob = function (callback) {
      capturedPixel = this.lastPixels.data[0];
      finishEncode = () => callback(new app.window.Blob(['snapshot'], { type: 'image/png' }));
    };
    exposure.value = String(baseline + 17);
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.doc.querySelector('#download').click();
    // This input occurs after createExportSnapshot captured its deep-copied settings.
    exposure.value = String(baseline + 63);
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await until(() => typeof finishEncode === 'function', 'export did not reach image encoding');
    assert.equal(capturedPixel, 145, 'the output must retain the click-time +17 exposure delta');
    finishEncode();
    await until(() => app.doc.querySelector('#cancelExport').hidden, 'export did not settle');
  } finally {
    app.close();
  }
});

test('refreshing the crop preserves applied adjustments when switching presets', async () => {
  const app = await editor();
  try {
    await app.complete();
    const exposure = app.doc.querySelector('#exposure');
    exposure.value = '27';
    exposure.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.doc.querySelector('#shadowAmt').value = '18';
    app.doc.querySelector('#apply').click();
    app.doc.querySelector('#zoomIn').click();
    app.doc.querySelectorAll('.variant')[1].click();
    app.doc.querySelectorAll('.variant')[0].click();
    assert.equal(exposure.value, '27');
    assert.equal(app.doc.querySelector('#shadowAmt').value, '18');
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('returning from the back-forward cache resumes lazy thumbnail rendering', async () => {
  const app = await editor();
  try {
    await app.complete();
    app.window.dispatchEvent(new app.window.Event('pagehide'));
    app.window.dispatchEvent(new app.window.PageTransitionEvent('pageshow', { persisted: true }));
    app.show(2);
    await until(
      () => app.doc.querySelectorAll('.variant:not(.is-pending)').length === 2,
      'thumbnail loading did not resume after navigation'
    );
    assert.equal(app.doc.querySelector('#apply').disabled, false);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});

test('filter library pagination creates only one 24-item page and resets after a new filter', async () => {
  const app = await editor();
  try {
    await app.complete();
    assert.equal(app.doc.querySelectorAll('.variant').length, 24);
    app.doc.querySelector('#nextVariantPage').click();
    assert.equal(app.doc.querySelector('#variantPageStatus').textContent, '2 / 4 页');
    assert.equal(app.doc.querySelectorAll('.variant').length, 24);
    const search = app.doc.querySelector('#filterSearch');
    search.value = 'Provia';
    search.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(app.doc.querySelector('#variantPageStatus').textContent, '1 / 1 页');
    assert.equal(app.doc.querySelectorAll('.variant').length, 1);
    assert.deepEqual(app.errors, []);
  } finally {
    app.close();
  }
});
