(function (root, factory) {
  const dependencies =
    typeof module === 'object' && module.exports
      ? {
          model: require('./transform-document.js'),
          cpu: require('../lut/cpu-reference-processor.js'),
        }
      : { model: root.ColorTransformDocument, cpu: root.ColorTransformCpu };
  const api = factory(dependencies);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudioV2 = api;
})(globalThis, function (dependencies) {
  'use strict';

  const { model, cpu } = dependencies;

  if (!model || !cpu)
    throw new Error('StudioV2 requires ColorTransformDocument and ColorTransformCpu.');

  const renderEngineVersion = 'studio-v2';
  const schemaVersion = 1;
  const hslBands = Object.freeze([
    'red',
    'orange',
    'yellow',
    'green',
    'aqua',
    'blue',
    'purple',
    'magenta',
  ]);
  const codes = Object.freeze({
    invalidSettings: 'invalid-studio-settings',
    invalidPixels: 'invalid-studio-pixels',
    invalidHistory: 'invalid-studio-history',
    unsupportedNode: 'studio-v2-unsupported-node',
  });
  const controls = Object.freeze({
    exposure: Object.freeze({ min: -5, max: 5, default: 0, bakeable: true }),
    contrast: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    highlights: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    shadows: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    whites: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    blacks: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    temperature: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    tint: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    saturation: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    vibrance: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
    lutIntensity: Object.freeze({ min: 0, max: 1, default: 1, bakeable: true }),
    wheelStrength: Object.freeze({ min: 0, max: 100, default: 100, bakeable: true }),
    wheelBalance: Object.freeze({ min: -100, max: 100, default: 0, bakeable: true }),
  });
  const contract = Object.freeze({
    version: schemaVersion,
    renderEngineVersion,
    precision: 'float64',
    workingColorSpace: 'srgb-sdr',
    workingDomain: '[0,1] normalized SDR RGB',
    clipping: 'clamp-to-[0,1] before HSL/color-wheel operations and at final output',
    order: Object.freeze([
      'base-effect-lut',
      'exposure',
      'contrast',
      'highlights-shadows-whites-blacks',
      'temperature-tint',
      'saturation-vibrance',
      'rgb-curves',
      'hsl-bands',
      'tonal-color-wheels',
      'final-clamp',
    ]),
    bakeability: Object.freeze({
      pointwise: true,
      bakeableControls: Object.freeze(Object.keys(controls)),
      excludedEffects: Object.freeze([
        'crop',
        'resize',
        'sharpen',
        'denoise',
        'vignette',
        'grain',
        'masks',
        'local-adjustments',
        'image-statistics',
      ]),
    }),
    histogram: 'post-process observation only; it never changes RGB output',
  });

  class StudioV2Error extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'StudioV2Error';
      this.code = code;
      this.stage = 'studio-v2';
      this.details = Object.freeze({ ...details });
    }
  }
  function fail(code, message, details) {
    throw new StudioV2Error(code, message, details);
  }
  function clamp(value, min = 0, max = 1) {
    return value <= min ? min : value >= max ? max : value;
  }
  function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      fail(codes.invalidSettings, `${label} must be finite.`);
    return value;
  }
  function control(name, value) {
    const definition = controls[name];
    const number = value === undefined ? definition.default : finite(value, name);
    if (number < definition.min || number > definition.max) {
      fail(
        codes.invalidSettings,
        `${name} must be from ${definition.min} through ${definition.max}.`,
        { name, value: number }
      );
    }
    return number;
  }
  function identityCurve() {
    return Object.freeze([
      [0, 0],
      [1, 1],
    ]);
  }
  function curve(value, name) {
    const points = value === undefined ? identityCurve() : value;
    if (!Array.isArray(points) || points.length < 2 || points.length > 32) {
      fail(codes.invalidSettings, `${name} must contain 2 through 32 control points.`);
    }
    const normalized = points.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2)
        fail(codes.invalidSettings, `${name}[${index}] must be [x, y].`);
      const x = finite(point[0], `${name}[${index}][0]`);
      const y = finite(point[1], `${name}[${index}][1]`);
      if (x < 0 || x > 1 || y < 0 || y > 1)
        fail(codes.invalidSettings, `${name} points must remain in [0,1].`);
      return [x, y, index];
    });
    normalized.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    const deduped = [];
    // Repeated x coordinates are deterministic: the last supplied point replaces earlier points.
    for (const point of normalized) {
      if (deduped.length && deduped[deduped.length - 1][0] === point[0])
        deduped[deduped.length - 1] = point;
      else deduped.push(point);
    }
    if (deduped[0][0] !== 0 || deduped[deduped.length - 1][0] !== 1) {
      fail(codes.invalidSettings, `${name} must include deterministic endpoints at x=0 and x=1.`);
    }
    return Object.freeze(deduped.map(([x, y]) => Object.freeze([x, y])));
  }
  function hslBand(value, name) {
    const source = value || {};
    if (source === null || typeof source !== 'object' || Array.isArray(source))
      fail(codes.invalidSettings, `${name} must be an object.`);
    const result = {};
    for (const field of ['hue', 'saturation', 'lightness']) {
      const number = source[field] === undefined ? 0 : finite(source[field], `${name}.${field}`);
      if (number < -100 || number > 100)
        fail(codes.invalidSettings, `${name}.${field} must be from -100 through 100.`);
      result[field] = number;
    }
    return Object.freeze(result);
  }
  function wheel(value, name) {
    const source = value || {};
    if (source === null || typeof source !== 'object' || Array.isArray(source))
      fail(codes.invalidSettings, `${name} must be an object.`);
    const hue = source.hue === undefined ? 0 : finite(source.hue, `${name}.hue`);
    const saturation =
      source.saturation === undefined ? 0 : finite(source.saturation, `${name}.saturation`);
    if (hue < 0 || hue > 360 || saturation < 0 || saturation > 100) {
      fail(codes.invalidSettings, `${name} hue must be 0..360 and saturation must be 0..100.`);
    }
    return Object.freeze({ hue, saturation });
  }
  function emptySettings() {
    const hsl = {};
    for (const band of hslBands) hsl[band] = hslBand();
    return {
      schemaVersion,
      renderEngineVersion,
      ...Object.fromEntries(Object.keys(controls).map((name) => [name, controls[name].default])),
      curves: {
        rgb: identityCurve(),
        red: identityCurve(),
        green: identityCurve(),
        blue: identityCurve(),
      },
      hsl,
      wheels: { shadows: wheel(), midtones: wheel(), highlights: wheel() },
    };
  }
  function createSettings(input = {}) {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      fail(codes.invalidSettings, 'Settings must be an object.');
    const defaults = emptySettings();
    const allowed = new Set([...Object.keys(defaults), 'schemaVersion', 'renderEngineVersion']);
    for (const key of Object.keys(input))
      if (!allowed.has(key))
        fail(codes.unsupportedNode, `studio-v2 does not support ${key}.`, { key });
    if (input.schemaVersion !== undefined && input.schemaVersion !== schemaVersion)
      fail(codes.invalidSettings, 'Unsupported studio-v2 schema version.');
    if (
      input.renderEngineVersion !== undefined &&
      input.renderEngineVersion !== renderEngineVersion
    )
      fail(codes.invalidSettings, 'Unsupported render engine version.');
    const result = { schemaVersion, renderEngineVersion };
    for (const name of Object.keys(controls)) result[name] = control(name, input[name]);
    const inputCurves = input.curves === undefined ? {} : input.curves;
    if (inputCurves === null || typeof inputCurves !== 'object' || Array.isArray(inputCurves))
      fail(codes.invalidSettings, 'curves must be an object.');
    for (const key of Object.keys(inputCurves)) {
      if (!['rgb', 'red', 'green', 'blue'].includes(key)) {
        fail(codes.unsupportedNode, `Unknown RGB curve ${key}.`);
      }
    }
    result.curves = Object.freeze({
      rgb: curve(inputCurves.rgb, 'curves.rgb'),
      red: curve(inputCurves.red, 'curves.red'),
      green: curve(inputCurves.green, 'curves.green'),
      blue: curve(inputCurves.blue, 'curves.blue'),
    });
    const inputHsl = input.hsl === undefined ? {} : input.hsl;
    if (inputHsl === null || typeof inputHsl !== 'object' || Array.isArray(inputHsl))
      fail(codes.invalidSettings, 'hsl must be an object.');
    for (const key of Object.keys(inputHsl))
      if (!hslBands.includes(key)) fail(codes.unsupportedNode, `Unknown HSL band ${key}.`);
    result.hsl = Object.freeze(
      Object.fromEntries(hslBands.map((band) => [band, hslBand(inputHsl[band], `hsl.${band}`)]))
    );
    const inputWheels = input.wheels === undefined ? {} : input.wheels;
    if (inputWheels === null || typeof inputWheels !== 'object' || Array.isArray(inputWheels))
      fail(codes.invalidSettings, 'wheels must be an object.');
    for (const key of Object.keys(inputWheels))
      if (!['shadows', 'midtones', 'highlights'].includes(key))
        fail(codes.unsupportedNode, `Unknown color wheel ${key}.`);
    result.wheels = Object.freeze({
      shadows: wheel(inputWheels.shadows, 'wheels.shadows'),
      midtones: wheel(inputWheels.midtones, 'wheels.midtones'),
      highlights: wheel(inputWheels.highlights, 'wheels.highlights'),
    });
    return Object.freeze(result);
  }
  function plainSettings(settings) {
    const value = createSettings(settings);
    return JSON.parse(JSON.stringify(value));
  }
  function serialize(settings) {
    return JSON.stringify(plainSettings(settings));
  }
  function deserialize(text) {
    if (typeof text !== 'string')
      fail(codes.invalidSettings, 'Copied studio-v2 settings must be JSON text.');
    try {
      return createSettings(JSON.parse(text));
    } catch (error) {
      if (error instanceof StudioV2Error) throw error;
      fail(codes.invalidSettings, 'Copied studio-v2 settings are not valid JSON.');
    }
  }
  function rgbToHsl(red, green, blue) {
    const max = Math.max(red, green, blue),
      min = Math.min(red, green, blue),
      delta = max - min;
    let hue = 0;
    if (delta > 0) {
      if (max === red) hue = ((green - blue) / delta) % 6;
      else if (max === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue = (hue * 60 + 360) % 360;
    }
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    return [hue, Number.isFinite(saturation) ? saturation : 0, lightness];
  }
  function hslToRgb(hue, saturation, lightness) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const segment = (((hue % 360) + 360) % 360) / 60;
    const second = chroma * (1 - Math.abs((segment % 2) - 1));
    let rgb =
      segment < 1
        ? [chroma, second, 0]
        : segment < 2
          ? [second, chroma, 0]
          : segment < 3
            ? [0, chroma, second]
            : segment < 4
              ? [0, second, chroma]
              : segment < 5
                ? [second, 0, chroma]
                : [chroma, 0, second];
    const match = lightness - chroma / 2;
    return [rgb[0] + match, rgb[1] + match, rgb[2] + match];
  }
  function curveValue(points, value) {
    const x = clamp(value);
    for (let index = 1; index < points.length; index += 1) {
      if (x <= points[index][0]) {
        const [leftX, leftY] = points[index - 1],
          [rightX, rightY] = points[index];
        return leftY + ((x - leftX) / (rightX - leftX)) * (rightY - leftY);
      }
    }
    return points[points.length - 1][1];
  }
  function luma(rgb) {
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  function scaleAroundLuma(rgb, factor) {
    const light = luma(rgb);
    return [
      light + (rgb[0] - light) * factor,
      light + (rgb[1] - light) * factor,
      light + (rgb[2] - light) * factor,
    ];
  }
  function bandWeight(hue, center) {
    const distance = Math.abs(((hue - center + 180) % 360) - 180);
    return clamp(1 - distance / 45);
  }
  const hslCenters = Object.freeze({
    red: 0,
    orange: 30,
    yellow: 60,
    green: 120,
    aqua: 180,
    blue: 240,
    purple: 280,
    magenta: 320,
  });
  function applyHsl(rgb, settings) {
    let [hue, saturation, lightness] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    let hueShift = 0,
      saturationShift = 0,
      lightnessShift = 0;
    for (const band of hslBands) {
      const weight = bandWeight(hue, hslCenters[band]),
        adjustment = settings.hsl[band];
      hueShift += adjustment.hue * 1.8 * weight;
      saturationShift += (adjustment.saturation / 100) * weight;
      lightnessShift += (adjustment.lightness / 100) * weight;
    }
    return hslToRgb(
      hue + hueShift,
      clamp(saturation * (1 + saturationShift)),
      clamp(lightness + lightnessShift)
    );
  }
  function wheelWeights(lightness, balance) {
    const pivot = balance / 200;
    const shadow = clamp((0.5 - lightness - pivot) * 2);
    const highlight = clamp((lightness - 0.5 - pivot) * 2);
    return [shadow, clamp(1 - shadow - highlight), highlight];
  }
  function applyWheels(rgb, settings) {
    const [shadowWeight, middleWeight, highlightWeight] = wheelWeights(
      luma(rgb),
      settings.wheelBalance
    );
    const wheels = [settings.wheels.shadows, settings.wheels.midtones, settings.wheels.highlights];
    const weights = [shadowWeight, middleWeight, highlightWeight];
    const strength = settings.wheelStrength / 100;
    let red = rgb[0],
      green = rgb[1],
      blue = rgb[2];
    for (let index = 0; index < wheels.length; index += 1) {
      const amount = (wheels[index].saturation / 100) * weights[index] * strength;
      if (amount === 0) continue;
      const tint = hslToRgb(wheels[index].hue, 1, 0.5);
      red += (tint[0] - 0.5) * amount;
      green += (tint[1] - 0.5) * amount;
      blue += (tint[2] - 0.5) * amount;
    }
    return [red, green, blue];
  }
  function applyManual(rgb, settings) {
    let output = [rgb[0], rgb[1], rgb[2]];
    const exposure = 2 ** settings.exposure;
    output = output.map((value) => value * exposure);
    const contrast = 1 + settings.contrast / 100;
    output = output.map((value) => 0.5 + (value - 0.5) * contrast);
    const light = luma(output);
    const adjust = (amount, weight) => (amount / 100) * weight;
    const tone =
      adjust(settings.shadows, (1 - clamp(light * 2)) ** 2) +
      adjust(settings.highlights, clamp((light - 0.5) * 2) ** 2) +
      adjust(settings.blacks, (1 - clamp(light * 4)) ** 2) +
      adjust(settings.whites, clamp((light - 0.75) * 4) ** 2);
    output = output.map((value) => value + tone);
    // White balance is an explicit creative SDR approximation, not an ICC/CAT color-management transform.
    output[0] *= 1 + settings.temperature / 300;
    output[2] *= 1 - settings.temperature / 300;
    output[1] *= 1 + settings.tint / 500;
    output = scaleAroundLuma(output, 1 + settings.saturation / 100);
    const chroma = Math.max(...output) - Math.min(...output);
    output = scaleAroundLuma(output, 1 + (settings.vibrance / 100) * (1 - clamp(chroma)));
    output = output.map((value) => curveValue(settings.curves.rgb, value));
    output = [
      curveValue(settings.curves.red, output[0]),
      curveValue(settings.curves.green, output[1]),
      curveValue(settings.curves.blue, output[2]),
    ];
    output = applyHsl(
      output.map((value) => clamp(value)),
      settings
    );
    output = applyWheels(
      output.map((value) => clamp(value)),
      settings
    );
    return Float64Array.of(clamp(output[0]), clamp(output[1]), clamp(output[2]));
  }
  function createProcessor({ settings = {}, baseDocument = null } = {}) {
    const frozenSettings = createSettings(settings);
    if (baseDocument && baseDocument.schemaVersion !== model.schemaVersion)
      fail(codes.invalidSettings, 'baseDocument must be a v2 ColorTransformDocument.');
    if (
      baseDocument &&
      ['inputColorSpace', 'outputColorSpace', 'workingColorSpace'].some(
        (field) => baseDocument.colorContract?.[field] !== 'srgb-sdr'
      )
    ) {
      fail(codes.invalidSettings, 'studio-v2 baseDocument must explicitly use SDR sRGB.', {
        colorContract: baseDocument.colorContract,
      });
    }
    const baseProcessor = baseDocument ? cpu.createProcessor(baseDocument) : null;
    function applyRgb(rgb) {
      if (
        (!Array.isArray(rgb) && !ArrayBuffer.isView(rgb)) ||
        rgb.length !== 3 ||
        [...rgb].some((value) => !Number.isFinite(value))
      ) {
        fail(codes.invalidSettings, 'RGB input must have three finite values.');
      }
      const input = Float64Array.from(rgb);
      const base = baseProcessor
        ? baseProcessor.applyRgb(input, { intensity: frozenSettings.lutIntensity })
        : input;
      return applyManual(base, frozenSettings);
    }
    return Object.freeze({
      contract,
      settings: frozenSettings,
      applyRgb,
      applyRgba(rgba) {
        if (
          (!Array.isArray(rgba) && !ArrayBuffer.isView(rgba)) ||
          rgba.length !== 4 ||
          [...rgba].some((value) => !Number.isFinite(value))
        )
          fail(codes.invalidSettings, 'RGBA input must have four finite values.');
        const rgb = applyRgb(ArrayBuffer.isView(rgba) ? rgba.subarray(0, 3) : rgba.slice(0, 3));
        return Float64Array.of(rgb[0], rgb[1], rgb[2], rgba[3]);
      },
      applyPixels(pixels) {
        if (!(pixels instanceof Float64Array) || pixels.length % 4 !== 0)
          fail(codes.invalidPixels, 'Pixels must be a Float64Array of RGBA samples.');
        const output = new Float64Array(pixels.length);
        for (let offset = 0; offset < pixels.length; offset += 4)
          output.set(this.applyRgba(pixels.subarray(offset, offset + 4)), offset);
        return output;
      },
      compareRgb(rgb) {
        return Object.freeze({ before: Float64Array.from(rgb), after: applyRgb(rgb) });
      },
    });
  }
  function createHistogram(pixels, options = {}) {
    if (!(pixels instanceof Float64Array) || pixels.length % 4 !== 0)
      fail(codes.invalidPixels, 'Histogram input must be a Float64Array of RGBA samples.');
    const bins = options.bins === undefined ? 256 : options.bins;
    if (!Number.isSafeInteger(bins) || bins < 2 || bins > 4096)
      fail(codes.invalidPixels, 'Histogram bins must be an integer from 2 through 4096.');
    const processor = options.processor || null;
    const red = new Uint32Array(bins),
      green = new Uint32Array(bins),
      blue = new Uint32Array(bins);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const sample = processor
        ? processor.applyRgba(pixels.subarray(offset, offset + 4))
        : pixels.subarray(offset, offset + 4);
      red[Math.min(bins - 1, Math.floor(clamp(sample[0]) * bins))] += 1;
      green[Math.min(bins - 1, Math.floor(clamp(sample[1]) * bins))] += 1;
      blue[Math.min(bins - 1, Math.floor(clamp(sample[2]) * bins))] += 1;
    }
    return Object.freeze({ bins, red, green, blue, pixels: pixels.length / 4 });
  }
  function toBakerDocument({ settings = {}, baseDocument = null, size = 65 } = {}) {
    if (![17, 33, 65].includes(size))
      fail(codes.invalidSettings, 'studio-v2 baking grids are 17, 33, or 65.');
    const processor = createProcessor({ settings, baseDocument });
    const values = new Float64Array(size ** 3 * 3);
    let at = 0;
    for (let blue = 0; blue < size; blue += 1)
      for (let green = 0; green < size; green += 1)
        for (let red = 0; red < size; red += 1) {
          const result = processor.applyRgb([
            red / (size - 1),
            green / (size - 1),
            blue / (size - 1),
          ]);
          values[at++] = result[0];
          values[at++] = result[1];
          values[at++] = result[2];
        }
    return model.createColorTransformDocument({
      source: {
        format: 'studio-v2-parameters',
        dialect: 'v1',
        filename: null,
        byteLength: null,
        sha256: null,
      },
      colorContract: baseDocument?.colorContract || {
        inputColorSpace: 'srgb-sdr',
        outputColorSpace: 'srgb-sdr',
        workingColorSpace: 'srgb-sdr',
      },
      transforms: [{ type: 'lut3d', size, values, ordering: 'red-fastest' }],
      metadata: {
        renderEngineVersion,
        bakedFrom: 'studio-v2-pointwise-graph',
        pipelineBake: true,
        settings: plainSettings(processor.settings),
        excludedNodes: [...contract.bakeability.excludedEffects],
      },
      compatibility: { photoColorSpace: 'srgb-sdr' },
    });
  }
  class StudioHistory {
    constructor(initial = {}) {
      this.entries = [serialize(initial)];
      this.cursor = 0;
    }
    current() {
      return deserialize(this.entries[this.cursor]);
    }
    commit(next) {
      const serialized = serialize(next);
      if (serialized !== this.entries[this.cursor]) {
        this.entries.splice(this.cursor + 1);
        this.entries.push(serialized);
        this.cursor += 1;
      }
      return this.current();
    }
    undo() {
      if (this.cursor > 0) this.cursor -= 1;
      return this.current();
    }
    redo() {
      if (this.cursor < this.entries.length - 1) this.cursor += 1;
      return this.current();
    }
    canUndo() {
      return this.cursor > 0;
    }
    canRedo() {
      return this.cursor < this.entries.length - 1;
    }
    copy() {
      return this.entries[this.cursor];
    }
    paste(text) {
      return this.commit(deserialize(text));
    }
    reset() {
      return this.commit({});
    }
  }
  return Object.freeze({
    schemaVersion,
    renderEngineVersion,
    codes,
    controls,
    contract,
    hslBands,
    StudioV2Error,
    createSettings,
    serialize,
    deserialize,
    createProcessor,
    createHistogram,
    toBakerDocument,
    StudioHistory,
  });
});
