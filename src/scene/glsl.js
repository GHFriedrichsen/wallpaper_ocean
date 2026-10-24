// GLSL snippets shared by several materials. Uniform names match Environment.uniforms.

export const ENV_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uAmbient;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFogColor;
uniform float uCloud;
uniform float uRain;
uniform float uSnow;
uniform float uStorm;
uniform float uFog;
uniform float uNight;
uniform float uFlash;
uniform float uWind;
uniform vec2 uWindDir;
`;

export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// Simple sky model used by the background and by water reflections.
export const SKY_COLOR = /* glsl */ `
vec3 skyGradient(vec3 dir) {
  float h = dir.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.7, h));
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.5, h));
  float sunAmt = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(sunAmt, 6.0) * 0.35 + pow(sunAmt, 64.0) * 0.6) * (1.0 - uCloud * 0.6);
  float moonAmt = max(dot(dir, uMoonDir), 0.0);
  col += vec3(0.35, 0.45, 0.7) * pow(moonAmt, 24.0) * 0.25 * uNight;
  return col;
}
`;

export const WAVES = /* glsl */ `
#define WAVE_COUNT 6
uniform vec4 uWaves[WAVE_COUNT];   // dir.xy, wavenumber, amplitude
uniform float uWavePhase[WAVE_COUNT];
uniform float uWaveSharp;

// Sum of sharpened sine waves. Returns height, writes the xz gradient.
float waveHeight(vec2 p, out vec2 grad) {
  float h = 0.0;
  grad = vec2(0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 w = uWaves[i];
    float th = w.z * dot(w.xy, p) - uWavePhase[i];
    float s = sin(th);
    float c = cos(th);
    float u = max(0.5 + 0.5 * s, 1e-4);
    float pu = pow(u, uWaveSharp - 1.0);
    h += w.w * (2.0 * pu * u - 1.0);
    grad += w.w * uWaveSharp * pu * c * w.z * w.xy;
  }
  return h;
}
`;
