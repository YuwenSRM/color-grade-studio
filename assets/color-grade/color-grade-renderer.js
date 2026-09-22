(function (root, factory) {
  const renderer = factory();
  if (typeof module === 'object' && module.exports) module.exports = renderer;
  else root.ColorGradeRenderer = renderer;
})(globalThis, function () {
  'use strict';

  const defaults = {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    black: 0,
    saturation: 0,
    vibrance: 0,
    temperature: 0,
    tint: 0,
    clarity: 0,
  };
  const standardToneModel = 'standard-v2';
  const studioGradeModel = 'studio-v2';

  function clamp(value) {
    return Math.max(0, Math.min(255, value));
  }

  function unit(value) {
    return Math.max(0, Math.min(1, value));
  }

  // The editor's H/S/L wheels are versioned separately from legacy RGB wheel
  // values. Keeping this small transform here makes preview, both Workers and
  // export share one pixel contract without changing old saved edits.
  function hslToRgb(hue, saturation, lightness) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const segment = (((hue % 360) + 360) % 360) / 60;
    const second = chroma * (1 - Math.abs((segment % 2) - 1));
    const rgb =
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

  function smoothstep(start, end, value) {
    const t = unit((value - start) / (end - start));
    return t * t * (3 - 2 * t);
  }

  function studioWheelWeights(tone, balance) {
    const pivot = Math.max(-100, Math.min(100, Number(balance) || 0)) / 200;
    const shadows = 1 - smoothstep(0.12 + pivot, 0.56 + pivot, tone);
    const highlights = smoothstep(0.44 + pivot, 0.88 + pivot, tone);
    return [shadows, Math.max(0, 1 - shadows - highlights), highlights];
  }

  function validStudioWheel(value) {
    const wheel = value || {};
    return {
      hue: Math.max(0, Math.min(360, Number(wheel.hue) || 0)),
      saturation: Math.max(0, Math.min(100, Number(wheel.saturation) || 0)),
      lightness: Math.max(-100, Math.min(100, Number(wheel.lightness) || 0)),
      intensity: Math.max(0, Math.min(100, Number(wheel.intensity) || 0)),
    };
  }

  function applyStudioWheels(r, g, b, tone, grading) {
    const wheels = [
      validStudioWheel(grading?.shadows),
      validStudioWheel(grading?.midtones),
      validStudioWheel(grading?.highlights),
    ];
    const weights = studioWheelWeights(tone, grading?.balance);
    for (let index = 0; index < wheels.length; index += 1) {
      const wheel = wheels[index];
      const amount = (wheel.intensity / 100) * weights[index];
      if (!amount) continue;
      const tint = hslToRgb(wheel.hue, wheel.saturation / 100, 0.5 + wheel.lightness / 200);
      r = r * (1 - amount) + tint[0] * 255 * amount;
      g = g * (1 - amount) + tint[1] * 255 * amount;
      b = b * (1 - amount) + tint[2] * 255 * amount;
    }
    return [r, g, b];
  }

  // Shared by the full-size preview and thumbnail worker so their colors stay identical.
  function applyPixels(data, p, settings = {}) {
    const e = { ...defaults, ...settings.delta },
      shadow = settings.shadow || [0, 0, 0],
      mid = settings.mid || [0, 0, 0],
      high = settings.high || [0, 0, 0],
      sa = settings.shadowAmount || 0,
      ma = settings.midAmount || 0,
      ha = settings.highAmount || 0;
    const baseLight = (p.b - 1) * 255,
      warmth = (p.w - 1) * 52 + e.temperature * 0.55,
      tint = e.tint * 0.38,
      hue = (p.t * Math.PI) / 180,
      expo = e.exposure * 1.85,
      con = 1 + e.contrast / 150,
      sat = 1 + e.saturation / 130,
      clarity = e.clarity / 100,
      u = Math.cos(hue),
      v = Math.sin(hue),
      rrR = 0.213 + 0.787 * u - 0.213 * v,
      rrG = 0.715 - 0.715 * u - 0.715 * v,
      rrB = 0.072 - 0.072 * u + 0.928 * v,
      ggR = 0.213 - 0.213 * u + 0.143 * v,
      ggG = 0.715 + 0.285 * u + 0.14 * v,
      ggB = 0.072 - 0.072 * u - 0.283 * v,
      bbR = 0.213 - 0.213 * u - 0.787 * v,
      bbG = 0.715 - 0.715 * u + 0.715 * v,
      bbB = 0.072 + 0.928 * u + 0.072 * v;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] + baseLight + warmth + tint,
        g = data[i + 1] + baseLight - tint * 0.45,
        b = data[i + 2] + baseLight - warmth * 0.62;
      let lum = (r + g + b) / 3;
      r = lum + (r - lum) * p.c;
      g = lum + (g - lum) * p.c;
      b = lum + (b - lum) * p.c;
      lum = (r + g + b) / 3;
      const normal = lum / 255;
      const hMod = (e.highlights / 100) * Math.max(0, (normal - 0.5) * 2) * 48,
        sMod = (e.shadows / 100) * Math.max(0, (0.5 - normal) * 2) * 52,
        black = (e.black / 100) * Math.max(0, 1 - normal) * 35;
      // legacy-v1 stored positive highlights as a recovery operation. New editor
      // operations opt into standard-v2, where positive values brighten highlights.
      // Keeping the legacy default preserves existing unversioned edits.
      const highlightDirection = settings.toneModel === standardToneModel ? 1 : -1;
      r += expo + highlightDirection * hMod + sMod - black;
      g += expo + highlightDirection * hMod + sMod - black;
      b += expo + highlightDirection * hMod + sMod - black;
      lum = (r + g + b) / 3;
      r = lum + (r - lum) * con;
      g = lum + (g - lum) * con;
      b = lum + (b - lum) * con;
      if (hue) {
        const rr = rrR * r + rrG * g + rrB * b,
          gg = ggR * r + ggG * g + ggB * b,
          bb = bbR * r + bbG * g + bbB * b;
        r = rr;
        g = gg;
        b = bb;
      }
      lum = (r + g + b) / 3;
      const vivid =
          1 + (e.vibrance / 100) * (1 - Math.min(1, (Math.max(r, g, b) - Math.min(r, g, b)) / 150)),
        mult = p.s * sat * vivid;
      r = lum + (r - lum) * mult;
      g = lum + (g - lum) * mult;
      b = lum + (b - lum) * mult;
      const tone = lum / 255;
      if (settings.gradingModel === studioGradeModel) {
        [r, g, b] = applyStudioWheels(r, g, b, tone, settings.grading);
      } else {
        const rgb = tone < 0.38 ? shadow : tone > 0.64 ? high : mid,
          amt = tone < 0.38 ? sa : tone > 0.64 ? ha : ma,
          weight =
            amt *
            (tone < 0.38
              ? 1 - tone / 0.38
              : tone > 0.64
                ? (tone - 0.64) / 0.36
                : 1 - Math.abs(tone - 0.51) / 0.13);
        r = r * (1 - weight) + rgb[0] * weight;
        g = g * (1 - weight) + rgb[1] * weight;
        b = b * (1 - weight) + rgb[2] * weight;
      }
      if (clarity) {
        const boost = (lum - 128) * clarity * 0.18;
        r += boost;
        g += boost;
        b += boost;
      }
      data[i] = clamp(r);
      data[i + 1] = clamp(g);
      data[i + 2] = clamp(b);
    }
    return data;
  }

  return { applyPixels, standardToneModel, studioGradeModel, hslToRgb, studioWheelWeights };
});
