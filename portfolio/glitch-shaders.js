/**
 * glitch-shaders.js
 * ─────────────────────────────────────────────────────────────
 * GLSL vertex and fragment shaders for the full-screen WebGL
 * post-processing pass (Three.js PlaneGeometry + ShaderMaterial).
 *
 * Effects implemented in the fragment shader:
 *   • Color-channel RGB offset (chromatic aberration)
 *   • Scan-line darkening pass
 *   • Pixel-shift noise (horizontal block displacement)
 *   • Vignette
 *   • Time-driven intensity so glitches fire in random bursts
 */

export const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fragmentShader = /* glsl */`
  // ── Uniforms ────────────────────────────────────────────────
  uniform sampler2D uScene;      // rendered scene texture
  uniform float     uTime;       // elapsed seconds
  uniform float     uGlitch;     // glitch burst intensity [0..1]
  uniform float     uScroll;     // normalized scroll [0..1]
  uniform vec2      uMouse;      // normalised mouse position [0..1]
  uniform vec2      uResolution; // viewport in pixels

  varying vec2 vUv;

  // ── Hash / noise helpers ─────────────────────────────────────
  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Smooth noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }

  // ── Scan-line effect ─────────────────────────────────────────
  float scanline(vec2 uv, float lineCount, float strength) {
    float lines = sin(uv.y * lineCount * 3.14159);
    return 1.0 - strength * (0.5 - 0.5 * lines);
  }

  // ── Glitch block shift ───────────────────────────────────────
  vec2 blockShift(vec2 uv, float intensity) {
    float blockSize = 0.04 + 0.08 * hash(floor(uTime * 3.0));
    float row       = floor(uv.y / blockSize);
    float trigger   = hash(row + floor(uTime * 4.0));
    if (trigger < intensity * 0.7) {
      float shift = (hash(row * 2.0 + 1.0) - 0.5) * 0.06 * intensity;
      uv.x = fract(uv.x + shift);
    }
    return uv;
  }

  // ── Chromatic aberration ─────────────────────────────────────
  vec3 chromaOffset(sampler2D tex, vec2 uv, float amount) {
    vec2 dir = (uv - 0.5) * amount;
    float r = texture2D(tex, uv + dir * vec2(1.0,  0.3)).r;
    float g = texture2D(tex, uv                         ).g;
    float b = texture2D(tex, uv - dir * vec2(1.0,  0.3)).b;
    return vec3(r, g, b);
  }

  // ── Vignette ─────────────────────────────────────────────────
  float vignette(vec2 uv, float strength) {
    vec2  d = uv - 0.5;
    float r = dot(d, d);
    return 1.0 - r * strength;
  }

  // ── Digital noise ─────────────────────────────────────────────
  float digitalNoise(vec2 uv, float t) {
    vec2 bigGrid  = floor(uv * 4.0);
    vec2 tileTime = vec2(floor(t * 8.0));
    return hash2(bigGrid + tileTime);
  }

  // ── Main ─────────────────────────────────────────────────────
  void main() {
    vec2 uv = vUv;

    // --- Glitch burst pulse (fires ~3x/sec randomly)
    float burstCycle = floor(uTime * 3.0);
    float burstRand  = hash(burstCycle * 7.4);
    float burst      = step(0.82, burstRand) * uGlitch;

    // --- Block pixel shift
    vec2 shiftedUv = blockShift(uv, burst);

    // --- Chromatic aberration (always on, stronger during burst)
    float chromaAmount = 0.006 + burst * 0.018;
    vec3  col = chromaOffset(uScene, shiftedUv, chromaAmount);

    // --- Scan-lines
    float scan = scanline(uv, uResolution.y * 0.5, 0.12 + burst * 0.08);
    col *= scan;

    // --- Horizontal drift bar (rare, strong)
    float barT   = floor(uTime * 2.0 + 0.5);
    float barPos = hash(barT * 3.7);
    float barW   = 0.015 + hash(barT) * 0.04;
    if (burst > 0.5 && abs(uv.y - barPos) < barW) {
      float barShift = (hash(barT * 9.1) - 0.5) * 0.12;
      col = chromaOffset(uScene, vec2(fract(uv.x + barShift), uv.y), 0.025);
      col = mix(col, col.gbr, 0.4); // hue rotate
    }

    // --- Digital noise (during burst)
    if (burst > 0.4) {
      float n = digitalNoise(uv, uTime);
      col     = mix(col, vec3(n * 0.2, n * 1.0, n * 0.6), burst * 0.08);
    }

    // --- Vignette
    col *= vignette(uv, 1.6);

    // --- Subtle brightness pulse tied to glitch
    col *= 1.0 + burst * 0.08 * sin(uTime * 60.0);

    // --- Mouse parallax micro-distortion
    vec2  mouseOffset = (uMouse - 0.5) * 0.003;
    vec3  mouseCol = chromaOffset(uScene, clamp(uv + mouseOffset, 0.0, 1.0), 0.002);
    col = mix(col, mouseCol, 0.3);

    gl_FragColor = vec4(col, 1.0);
  }
`;
