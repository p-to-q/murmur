"use client";

/**
 * MurmurTide — the water layer for Vibe cards.
 *
 * WebGL2 renders the primary side-on tide. Canvas 2D keeps the same
 * visual contract as a low-power / unsupported-browser fallback. Stars and
 * meteors intentionally live in MurmurWave so each layer can evolve alone.
 */

import { useEffect, useRef, useState } from "react";

export interface MurmurTideProps {
  deepColor: string;
  midColor: string;
  lightColor: string;
  seed: number;
  intensity?: number;
  isPlaying?: boolean;
  isEngaged?: boolean;
  /** Horizon position as a fraction of canvas height from the top. */
  waveY?: number;
  className?: string;
}

type TideState = {
  intensity: number;
  isPlaying: boolean;
  isEngaged: boolean;
};

type TideRenderer = {
  resize: (width: number, height: number, dpr: number) => void;
  render: (time: number, energy: number) => void;
  dispose: () => void;
};

const VERTEX_SHADER = `#version 300 es
  layout(location = 0) in vec2 aPosition;
  out vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision highp float;

  in vec2 vUv;
  out vec4 outColor;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uWaveY;
  uniform float uSeed;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uLight;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
    for (int octave = 0; octave < 5; octave++) {
      value += noise21(p) * amplitude;
      p = rotation * p * 2.03 + 17.17;
      amplitude *= 0.5;
    }
    return value;
  }

  float gaussian(float value, float width) {
    return exp(-pow(value / max(width, 0.0001), 2.0));
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float seed = mod(uSeed, 997.0) * 0.013;

    // One side-on swell, not a top-down field: the water line rises toward
    // the right and gathers into a single shoulder before the card edge.
    float rhythmBreath = 0.84 + sin(uTime * 0.62 + seed * 0.5) * 0.16;
    float longSwell = fbm(vec2(uv.x * 1.72 * aspect + seed, uTime * 0.11));
    float middleSwell = sin(uv.x * 5.2 - uTime * 0.52 + seed * 0.72);
    float fineSwell = sin(uv.x * 10.6 + uTime * 1.18 + seed * 2.0);
    float capillary = sin(uv.x * 18.8 - uTime * 1.8 + seed * 3.4);
    float crestCenter = 0.8
      + sin(uTime * 0.31 + seed) * 0.04
      + sin(uTime * 0.1 + seed * 1.8) * 0.012;
    float diagonalRise = (uv.x - 0.5) * (0.185 + uEnergy * 0.04);
    float crestShoulder = gaussian(uv.x - crestCenter, 0.22);
    float preCrestTrough = gaussian(uv.x - (crestCenter - 0.24), 0.22);
    float surface = 1.0 - uWaveY
      + diagonalRise
      + (longSwell - 0.5) * (0.038 + uEnergy * 0.016)
      + middleSwell * (0.012 + uEnergy * 0.004)
      + fineSwell * 0.0055 * rhythmBreath
      + capillary * 0.0026 * (0.65 + uEnergy * 0.35)
      + crestShoulder * (0.062 + uEnergy * 0.034 + rhythmBreath * 0.005)
      - preCrestTrough * 0.021;

    float signedDepth = surface - uv.y;
    float waterMask = smoothstep(-0.02, 0.014, signedDepth);
    float depth = clamp(signedDepth / max(surface, 0.1), 0.0, 1.0);

    // A narrow luminous lip gives the eye a side-view silhouette. Two broken
    // submerged echoes suggest volume without turning into contour-map bands.
    float rim = exp(-abs(signedDepth) * 98.0);
    float rimBreak = noise21(vec2(uv.x * 13.0 + seed, uTime * 0.16));
    float surfaceLight = rim
      * (0.64 + crestShoulder * (0.2 + uEnergy * 0.1))
      * (0.82 + rimBreak * 0.18);
    float foam = rim * smoothstep(
      0.28,
      0.78,
      rimBreak + crestShoulder * (0.18 + uEnergy * 0.16)
    );
    float echoWobble = (noise21(vec2(uv.x * 7.0 - uTime * 0.13, seed)) - 0.5) * 0.018;
    float echoNear = exp(-abs(signedDepth - 0.075 - echoWobble) * 66.0);
    float echoDeep = exp(-abs(signedDepth - 0.19 - echoWobble * 1.4) * 48.0);
    float echoBreak = smoothstep(
      0.32,
      0.78,
      noise21(vec2(uv.x * 8.5 + seed * 1.7, signedDepth * 7.0 - uTime * 0.11))
    );
    float submergedEcho = (echoNear * 0.72 + echoDeep * 0.36) * echoBreak;
    float crestVolume = crestShoulder
      * smoothstep(0.015, 0.14, signedDepth)
      * (1.0 - smoothstep(0.2, 0.42, signedDepth));
    float suspendedLight = smoothstep(
      0.72,
      0.96,
      fbm(vec2(uv.x * 6.2 - uTime * 0.18, signedDepth * 8.0 + seed))
    ) * smoothstep(0.02, 0.34, signedDepth);

    vec3 waterColor = mix(
      uDeep * 0.92,
      uDeep * 0.58,
      smoothstep(0.04, 0.94, depth)
    );
    waterColor = mix(
      waterColor,
      uMid * 0.72,
      submergedEcho * 0.16 + crestVolume * 0.1 + suspendedLight * 0.08
    );
    waterColor = mix(
      waterColor,
      uLight,
      surfaceLight * 0.82
        + foam * (0.24 + uEnergy * 0.1)
        + submergedEcho * 0.18
        + crestVolume * (0.1 + uEnergy * 0.08)
        + suspendedLight * 0.08
    );

    float alpha = waterMask * (
      0.22
        + depth * 0.23
        + uEnergy * 0.045
        + submergedEcho * 0.07
        + crestVolume * 0.035
    );
    alpha = max(alpha, surfaceLight * (0.58 + uEnergy * 0.08));

    if (alpha <= 0.002) discard;
    outColor = vec4(waterColor, alpha);
  }
`;

const TIDE_FRAME_INTERVAL_MS = 1000 / 30;
const LOW_POWER_TIDE_FRAME_INTERVAL_MS = 1000 / 24;
const MAX_TIDE_PIXEL_RATIO = 1.25;
const LOW_POWER_TIDE_PIXEL_RATIO = 1;

export function MurmurTide({
  deepColor,
  midColor,
  lightColor,
  seed,
  intensity = 0.55,
  isPlaying = false,
  isEngaged = false,
  waveY = 0.58,
  className,
}: MurmurTideProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendererMode, setRendererMode] = useState<"webgl2" | "canvas2d">(
    "webgl2",
  );
  const stateRef = useRef<TideState>({ intensity, isPlaying, isEngaged });
  const requestFrameRef = useRef<() => void>(() => {});

  useEffect(() => {
    stateRef.current = { intensity, isPlaying, isEngaged };
    requestFrameRef.current();
  }, [intensity, isPlaying, isEngaged]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer =
      rendererMode === "webgl2"
        ? createWebGLRenderer(canvas, {
            deepColor,
            midColor,
            lightColor,
            seed,
            waveY,
          })
        : createCanvasRenderer(canvas, {
            deepColor,
            midColor,
            lightColor,
            seed,
            waveY,
          });

    if (!renderer) {
      if (rendererMode === "webgl2") {
        const fallbackTimer = window.setTimeout(
          () => setRendererMode("canvas2d"),
          0,
        );
        return () => window.clearTimeout(fallbackTimer);
      }
      return;
    }

    const motionPreference = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    let reduceMotion = motionPreference?.matches ?? false;
    const lowPowerDevice =
      typeof navigator.hardwareConcurrency === "number" &&
      navigator.hardwareConcurrency <= 4;
    // Three cards are visible at once. A restrained pixel budget plus a
    // 30 fps cadence keeps the shader feeling fluid without competing with
    // the audio preview or the star canvas for the main visual budget.
    const dpr = Math.min(
      window.devicePixelRatio || 1,
      lowPowerDevice ? LOW_POWER_TIDE_PIXEL_RATIO : MAX_TIDE_PIXEL_RATIO,
    );
    const frameInterval = lowPowerDevice
      ? LOW_POWER_TIDE_FRAME_INTERVAL_MS
      : TIDE_FRAME_INTERVAL_MS;
    canvas.dataset.tideSamplingScale = dpr.toFixed(2);
    canvas.dataset.tideFrameCap = reduceMotion
      ? "static"
      : lowPowerDevice
        ? "24"
        : "30";
    let width = 1;
    let height = 1;
    let raf = 0;
    let inViewport = true;
    let documentVisible = !document.hidden;
    let lastNow = performance.now();
    let lastFrameAt = 0;
    let sceneTime = 0;
    let energy = 0.12;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      renderer.resize(width, height, dpr);
    };
    resize();

    const stopFrames = () => {
      if (raf === 0) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const requestNextFrame = () => {
      if (raf !== 0 || !inViewport || !documentVisible) return;
      raf = requestAnimationFrame(tick);
    };
    requestFrameRef.current = requestNextFrame;

    const tick = (now: number) => {
      raf = 0;
      if (
        !reduceMotion &&
        lastFrameAt !== 0 &&
        now - lastFrameAt < frameInterval
      ) {
        requestNextFrame();
        return;
      }
      lastFrameAt = now;
      const delta = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      const state = stateRef.current;
      const targetEnergy = state.isPlaying
        ? 0.82 + state.intensity * 0.16
        : state.isEngaged
          ? 0.34 + state.intensity * 0.12
          : 0.12 + state.intensity * 0.08;
      if (reduceMotion) {
        energy = targetEnergy;
      } else {
        energy += (targetEnergy - energy) * Math.min(1, delta * 3.8);
        const tempo = state.isPlaying ? 2.05 : state.isEngaged ? 1.52 : 1.08;
        sceneTime += delta * tempo;
      }
      renderer.render(sceneTime, energy);
      if (!reduceMotion) requestNextFrame();
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      requestNextFrame();
    });
    resizeObserver.observe(canvas);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry?.isIntersecting ?? true;
        if (inViewport) requestNextFrame();
        else stopFrames();
      },
      { rootMargin: "120px" },
    );
    intersectionObserver.observe(canvas);

    const handleVisibilityChange = () => {
      documentVisible = !document.hidden;
      lastNow = performance.now();
      if (documentVisible) requestNextFrame();
      else stopFrames();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      lastFrameAt = 0;
      canvas.dataset.tideFrameCap = reduceMotion
        ? "static"
        : lowPowerDevice
          ? "24"
          : "30";
      requestNextFrame();
    };
    motionPreference?.addEventListener?.("change", handleMotionPreferenceChange);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      stopFrames();
      setRendererMode("canvas2d");
    };
    if (rendererMode === "webgl2") {
      canvas.addEventListener("webglcontextlost", handleContextLost);
    }

    requestNextFrame();

    return () => {
      requestFrameRef.current = () => {};
      stopFrames();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      motionPreference?.removeEventListener?.(
        "change",
        handleMotionPreferenceChange,
      );
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      renderer.dispose();
    };
  }, [deepColor, lightColor, midColor, rendererMode, seed, waveY]);

  return (
    <canvas
      key={rendererMode}
      ref={canvasRef}
      className={className}
      data-tide-renderer={rendererMode}
      aria-hidden
    />
  );
}

function createWebGLRenderer(
  canvas: HTMLCanvasElement,
  options: {
    deepColor: string;
    midColor: string;
    lightColor: string;
    seed: number;
    waveY: number;
  },
): TideRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    premultipliedAlpha: false,
    stencil: false,
  });
  if (!gl) return null;

  const debugRendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererName = String(
    debugRendererInfo
      ? gl.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
  );
  if (isSoftwareWebGLRenderer(rendererName)) {
    canvas.dataset.tideGpu = "software";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  canvas.dataset.tideGpu = "hardware";

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    resolution: gl.getUniformLocation(program, "uResolution"),
    time: gl.getUniformLocation(program, "uTime"),
    energy: gl.getUniformLocation(program, "uEnergy"),
    waveY: gl.getUniformLocation(program, "uWaveY"),
    seed: gl.getUniformLocation(program, "uSeed"),
    deep: gl.getUniformLocation(program, "uDeep"),
    mid: gl.getUniformLocation(program, "uMid"),
    light: gl.getUniformLocation(program, "uLight"),
  };
  if (Object.values(uniforms).some((value) => value === null)) {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    return null;
  }

  const deep = hexToRgb01(options.deepColor);
  const mid = hexToRgb01(options.midColor);
  const light = hexToRgb01(options.lightColor);
  let bufferWidth = 1;
  let bufferHeight = 1;

  gl.useProgram(program);
  gl.uniform1f(uniforms.waveY, options.waveY);
  gl.uniform1f(uniforms.seed, options.seed);
  gl.uniform3f(uniforms.deep, ...deep);
  gl.uniform3f(uniforms.mid, ...mid);
  gl.uniform3f(uniforms.light, ...light);
  // The shader draws a single full-screen primitive into a transparent
  // canvas. Blending it against that empty buffer would apply alpha twice
  // (including to the destination alpha), making the water almost invisible
  // once the browser composites the canvas over the card.
  gl.disable(gl.BLEND);

  return {
    resize(width, height, dpr) {
      bufferWidth = Math.max(1, Math.floor(width * dpr));
      bufferHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
      if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
      gl.viewport(0, 0, bufferWidth, bufferHeight);
    },
    render(time, energy) {
      gl.viewport(0, 0, bufferWidth, bufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, bufferWidth, bufferHeight);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.energy, energy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

function createCanvasRenderer(
  canvas: HTMLCanvasElement,
  options: {
    deepColor: string;
    midColor: string;
    lightColor: string;
    seed: number;
    waveY: number;
  },
): TideRenderer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let width = 1;
  let height = 1;
  let dpr = 1;

  const surfaceAt = (x: number, time: number, energy: number) => {
    const nx = x / Math.max(width, 1);
    const rhythmBreath = 0.84 + Math.sin(time * 0.62 + options.seed * 0.5) * 0.16;
    const broad = valueNoise1D(nx * 1.72 + time * 0.11, options.seed);
    const medium = Math.sin(nx * Math.PI * 5.2 - time * 0.52 + options.seed * 0.72);
    const fine = Math.sin(nx * Math.PI * 10.6 + time * 1.18 + options.seed * 2);
    const capillary = Math.sin(nx * Math.PI * 18.8 - time * 1.8 + options.seed * 3.4);
    const crestCenter =
      0.8 +
      Math.sin(time * 0.31 + options.seed) * 0.04 +
      Math.sin(time * 0.1 + options.seed * 1.8) * 0.012;
    const crest = Math.exp(-Math.pow((nx - crestCenter) / 0.22, 2));
    const trough = Math.exp(
      -Math.pow((nx - (crestCenter - 0.24)) / 0.22, 2),
    );
    const diagonalRise =
      (nx - 0.5) * height * (0.185 + energy * 0.04);
    return (
      height * options.waveY +
      -diagonalRise +
      (broad - 0.5) * height * (0.038 + energy * 0.016) +
      medium * height * (0.012 + energy * 0.004) +
      fine * height * 0.0055 * rhythmBreath +
      capillary * height * 0.0026 * (0.65 + energy * 0.35) +
      -crest * height * (0.062 + energy * 0.034 + rhythmBreath * 0.005) +
      trough * height * 0.021
    );
  };

  return {
    resize(nextWidth, nextHeight, nextDpr) {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    render(time, energy) {
      ctx.clearRect(0, 0, width, height);

      const gradient = ctx.createLinearGradient(0, height * options.waveY, 0, height);
      gradient.addColorStop(0, hexAlpha(options.deepColor, 0.3 + energy * 0.05));
      gradient.addColorStop(0.42, hexAlpha(options.deepColor, 0.4 + energy * 0.05));
      gradient.addColorStop(1, hexAlpha(options.deepColor, 0.54 + energy * 0.05));

      ctx.beginPath();
      for (let x = 0; x <= width + 4; x += 4) {
        const y = surfaceAt(x, time, energy);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.save();
      ctx.globalCompositeOperation = "screen";

      const drawContour = (
        depthRatio: number,
        alpha: number,
        lineWidth: number,
        seedOffset: number,
      ) => {
        ctx.beginPath();
        for (let x = 0; x <= width + 4; x += 4) {
          const surface = surfaceAt(x, time, energy);
          const nx = x / Math.max(width, 1);
          const current =
            depthRatio === 0
              ? 0
              : (valueNoise1D(
                    nx * (5.2 + depthRatio * 3.4) - time * 0.13,
                    options.seed + seedOffset,
                  ) -
                    0.5) *
                  height *
                  0.018;
          const y = surface + height * depthRatio + current;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineCap = "round";
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = hexAlpha(options.lightColor, alpha);
        ctx.stroke();
      };

      // One readable lip plus two interrupted echoes. This preserves the
      // side-on silhouette in browsers that fall back from WebGL2.
      ctx.shadowColor = hexAlpha(options.lightColor, 0.4 + energy * 0.1);
      ctx.shadowBlur = 14;
      drawContour(0, 0.38 + energy * 0.07, 1.55, 11);
      ctx.shadowBlur = 0;
      ctx.setLineDash([Math.max(28, width * 0.075), Math.max(16, width * 0.04)]);
      ctx.lineDashOffset = -time * 13;
      drawContour(0.085, 0.07 + energy * 0.025, 1, 29);
      ctx.lineDashOffset = time * 7;
      drawContour(0.2, 0.04 + energy * 0.018, 0.85, 47);
      ctx.setLineDash([]);
      ctx.restore();
    },
    dispose() {},
  };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

export function isSoftwareWebGLRenderer(rendererName: string): boolean {
  const normalized = rendererName.toLowerCase();
  return [
    "swiftshader",
    "llvmpipe",
    "softpipe",
    "software rasterizer",
    "microsoft basic render driver",
  ].some((marker) => normalized.includes(marker));
}

function valueNoise1D(value: number, seed: number): number {
  const left = Math.floor(value);
  const fraction = value - left;
  const eased = fraction * fraction * (3 - 2 * fraction);
  return lerp(hash1D(left, seed), hash1D(left + 1, seed), eased);
}

function hash1D(value: number, seed: number): number {
  const hashed = Math.sin(value * 127.1 + seed * 311.7) * 43758.5453;
  return hashed - Math.floor(hashed);
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function hexToRgb01(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function hexAlpha(hex: string, alpha01: number): string {
  const alpha = Math.max(0, Math.min(255, Math.round(alpha01 * 255)));
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  return `#${value}${alpha.toString(16).padStart(2, "0")}`;
}
