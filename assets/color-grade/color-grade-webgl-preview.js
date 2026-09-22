(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorGradeWebglPreview = api;
})(globalThis, function () {
  'use strict';

  // This is deliberately a display-only renderer. CPU/Worker remains the source
  // of truth for exports and settled 1100px previews.
  const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      // ImageData and the visible canvas both use a top-left origin. WebGL
      // textures and readback use a bottom-left origin, so convert exactly once.
      vec2 screenUv = a_position * 0.5 + 0.5;
      v_uv = vec2(screenUv.x, 1.0 - screenUv.y);
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_source;
    uniform vec4 u_profile; // b, c, s, w
    uniform float u_profileHue;
    uniform vec4 u_deltaA; // exposure, contrast, highlights, shadows
    uniform vec4 u_deltaB; // black, saturation, vibrance, temperature
    uniform vec2 u_deltaC; // tint, clarity
    uniform vec4 u_shadow;
    uniform vec4 u_mid;
    uniform vec4 u_high;
    uniform float u_balance;
    uniform float u_intensity;

    float unit(float value) { return clamp(value, 0.0, 1.0); }
    float smooth(float start, float end, float value) {
      float t = unit((value - start) / (end - start));
      return t * t * (3.0 - 2.0 * t);
    }
    vec3 hsl(float hue, float saturation, float lightness) {
      float chroma = (1.0 - abs(2.0 * lightness - 1.0)) * saturation;
      float segment = mod(mod(hue, 360.0) + 360.0, 360.0) / 60.0;
      float second = chroma * (1.0 - abs(mod(segment, 2.0) - 1.0));
      vec3 rgb;
      if (segment < 1.0) rgb = vec3(chroma, second, 0.0);
      else if (segment < 2.0) rgb = vec3(second, chroma, 0.0);
      else if (segment < 3.0) rgb = vec3(0.0, chroma, second);
      else if (segment < 4.0) rgb = vec3(0.0, second, chroma);
      else if (segment < 5.0) rgb = vec3(second, 0.0, chroma);
      else rgb = vec3(chroma, 0.0, second);
      return rgb + vec3(lightness - chroma * 0.5);
    }
    vec3 wheel(vec3 color, float tone, vec4 wheelValue, float weight) {
      float amount = wheelValue.w * weight;
      if (amount == 0.0) return color;
      vec3 tint = hsl(wheelValue.x, wheelValue.y, 0.5 + wheelValue.z * 0.5);
      return mix(color, tint * 255.0, amount);
    }
    void main() {
      vec4 sample = texture2D(u_source, v_uv);
      vec3 original = sample.rgb * 255.0;
      float baseLight = (u_profile.x - 1.0) * 255.0;
      float warmth = (u_profile.w - 1.0) * 52.0 + u_deltaB.w * 0.55;
      float tint = u_deltaC.x * 0.38;
      vec3 color = original + vec3(baseLight + warmth + tint, baseLight - tint * 0.45, baseLight - warmth * 0.62);
      float lum = (color.r + color.g + color.b) / 3.0;
      color = vec3(lum) + (color - vec3(lum)) * u_profile.y;
      lum = (color.r + color.g + color.b) / 3.0;
      float normal = lum / 255.0;
      float highlight = (u_deltaA.z / 100.0) * max(0.0, (normal - 0.5) * 2.0) * 48.0;
      float shadow = (u_deltaA.w / 100.0) * max(0.0, (0.5 - normal) * 2.0) * 52.0;
      float black = (u_deltaB.x / 100.0) * max(0.0, 1.0 - normal) * 35.0;
      color += vec3(u_deltaA.x * 1.85 + highlight + shadow - black);
      lum = (color.r + color.g + color.b) / 3.0;
      color = vec3(lum) + (color - vec3(lum)) * (1.0 + u_deltaA.y / 150.0);
      if (u_profileHue != 0.0) {
        float angle = radians(u_profileHue);
        float u = cos(angle); float v = sin(angle);
        mat3 rotation = mat3(
          0.213 + 0.787*u - 0.213*v, 0.213 - 0.213*u + 0.143*v, 0.213 - 0.213*u - 0.787*v,
          0.715 - 0.715*u - 0.715*v, 0.715 + 0.285*u + 0.140*v, 0.715 - 0.715*u + 0.715*v,
          0.072 - 0.072*u + 0.928*v, 0.072 - 0.072*u - 0.283*v, 0.072 + 0.928*u + 0.072*v
        );
        color = rotation * color;
      }
      lum = (color.r + color.g + color.b) / 3.0;
      float vivid = 1.0 + (u_deltaB.z / 100.0) * (1.0 - min(1.0, (max(color.r, max(color.g, color.b)) - min(color.r, min(color.g, color.b))) / 150.0));
      color = vec3(lum) + (color - vec3(lum)) * (u_profile.z * (1.0 + u_deltaB.y / 130.0) * vivid);
      float tone = lum / 255.0;
      float pivot = clamp(u_balance, -100.0, 100.0) / 200.0;
      float shadowWeight = 1.0 - smooth(0.12 + pivot, 0.56 + pivot, tone);
      float highlightWeight = smooth(0.44 + pivot, 0.88 + pivot, tone);
      color = wheel(color, tone, u_shadow, shadowWeight);
      color = wheel(color, tone, u_mid, max(0.0, 1.0 - shadowWeight - highlightWeight));
      color = wheel(color, tone, u_high, highlightWeight);
      if (u_deltaC.y != 0.0) color += vec3((lum - 128.0) * (u_deltaC.y / 100.0) * 0.18);
      color = clamp(color, 0.0, 255.0) / 255.0;
      gl_FragColor = vec4(mix(original / 255.0, color, u_intensity), sample.a);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    const message = gl.getShaderInfoLog(shader) || 'WebGL shader compilation failed.';
    gl.deleteShader(shader);
    throw new Error(message);
  }

  function program(gl) {
    const value = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(value, vertex);
    gl.attachShader(value, fragment);
    gl.linkProgram(value);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (gl.getProgramParameter(value, gl.LINK_STATUS)) return value;
    const message = gl.getProgramInfoLog(value) || 'WebGL shader linking failed.';
    gl.deleteProgram(value);
    throw new Error(message);
  }

  function number(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function vec4(value, fourth = 0) {
    return [
      number(value?.hue),
      number(value?.saturation) / 100,
      number(value?.lightness) / 100,
      number(value?.intensity) / 100 || fourth,
    ];
  }

  function supportedSettings(settings) {
    return (
      !settings ||
      ((!settings.gradingModel || settings.gradingModel === 'studio-v2') &&
        (!settings.toneModel || settings.toneModel === 'standard-v2'))
    );
  }

  class Preview {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.options = options;
      this.gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        preserveDrawingBuffer: true,
      });
      if (!this.gl) throw new Error('WebGL is unavailable.');
      this.glProgram = program(this.gl);
      this.sourceData = null;
      this.width = 0;
      this.height = 0;
      this.lost = false;
      this.verifiedSource = null;
      this.canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this.lost = true;
        this.options.onLost?.();
      });
      this.initialize();
    }

    initialize() {
      const gl = this.gl;
      gl.useProgram(this.glProgram);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      const position = gl.getAttribLocation(this.glProgram, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.uniforms = Object.fromEntries(
        [
          'u_source',
          'u_profile',
          'u_profileHue',
          'u_deltaA',
          'u_deltaB',
          'u_deltaC',
          'u_shadow',
          'u_mid',
          'u_high',
          'u_balance',
          'u_intensity',
        ].map((key) => [key, gl.getUniformLocation(this.glProgram, key)])
      );
      gl.uniform1i(this.uniforms.u_source, 0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    }

    isUsable() {
      return !this.lost && !this.disposed;
    }

    upload(source) {
      if (
        this.sourceData === source.data &&
        this.width === source.width &&
        this.height === source.height
      )
        return;
      const gl = this.gl;
      this.width = source.width;
      this.height = source.height;
      this.canvas.width = source.width;
      this.canvas.height = source.height;
      gl.viewport(0, 0, source.width, source.height);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        source.width,
        source.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source.data
      );
      this.sourceData = source.data;
      this.verifiedSource = null;
      this.canvas.dataset.webglSourceUploads = String(
        Number(this.canvas.dataset.webglSourceUploads || 0) + 1
      );
    }

    draw({ source, profile, settings, intensity = 1 }) {
      if (!this.isUsable() || !source?.data || !supportedSettings(settings)) return false;
      try {
        this.upload(source);
        const gl = this.gl;
        const delta = settings?.delta || {};
        const grading = settings?.grading || {};
        gl.useProgram(this.glProgram);
        gl.uniform4f(
          this.uniforms.u_profile,
          number(profile?.b, 1),
          number(profile?.c, 1),
          number(profile?.s, 1),
          number(profile?.w, 1)
        );
        gl.uniform1f(this.uniforms.u_profileHue, number(profile?.t));
        gl.uniform4f(
          this.uniforms.u_deltaA,
          number(delta.exposure),
          number(delta.contrast),
          number(delta.highlights),
          number(delta.shadows)
        );
        gl.uniform4f(
          this.uniforms.u_deltaB,
          number(delta.black),
          number(delta.saturation),
          number(delta.vibrance),
          number(delta.temperature)
        );
        gl.uniform2f(this.uniforms.u_deltaC, number(delta.tint), number(delta.clarity));
        gl.uniform4fv(this.uniforms.u_shadow, vec4(grading.shadows));
        gl.uniform4fv(this.uniforms.u_mid, vec4(grading.midtones));
        gl.uniform4fv(this.uniforms.u_high, vec4(grading.highlights));
        gl.uniform1f(this.uniforms.u_balance, number(grading.balance));
        gl.uniform1f(this.uniforms.u_intensity, Math.max(0, Math.min(1, number(intensity, 1))));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.canvas.dataset.webglDraws = String(Number(this.canvas.dataset.webglDraws || 0) + 1);
        return gl.getError() === gl.NO_ERROR;
      } catch (error) {
        this.options.onError?.(error);
        return false;
      }
    }

    // Readback is intentionally limited to the first frame for an uploaded source.
    // It guards semantic drift before future frames become uniform-only draws.
    verify(renderer, { source, profile, settings, intensity }) {
      if (this.verifiedSource === source.data) return true;
      if (!renderer?.applyPixels || !this.draw({ source, profile, settings, intensity }))
        return false;
      const expected = new Uint8ClampedArray(source.data);
      renderer.applyPixels(expected, profile, settings);
      if (intensity !== 1) {
        for (let index = 0; index < expected.length; index += 4) {
          expected[index] = source.data[index] + (expected[index] - source.data[index]) * intensity;
          expected[index + 1] =
            source.data[index + 1] + (expected[index + 1] - source.data[index + 1]) * intensity;
          expected[index + 2] =
            source.data[index + 2] + (expected[index + 2] - source.data[index + 2]) * intensity;
          expected[index + 3] = source.data[index + 3];
        }
      }
      const actual = new Uint8Array(expected.length);
      this.gl.readPixels(
        0,
        0,
        source.width,
        source.height,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        actual
      );
      let maximum = 0;
      for (let y = 0; y < source.height; y += 1) {
        const gpuRow = source.height - 1 - y;
        for (let x = 0; x < source.width * 4; x += 1) {
          const difference = Math.abs(
            expected[y * source.width * 4 + x] - actual[gpuRow * source.width * 4 + x]
          );
          if (difference > maximum) maximum = difference;
        }
      }
      this.canvas.dataset.webglMaximumDifference = String(maximum);
      if (maximum > 3) return false;
      this.verifiedSource = source.data;
      return true;
    }

    dispose() {
      this.disposed = true;
      try {
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch (_) {}
    }
  }

  function create(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
      return new Preview(canvas, options);
    } catch (_) {
      return null;
    }
  }

  return Object.freeze({ create, Preview, supportedSettings });
});
