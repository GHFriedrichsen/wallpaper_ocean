import * as THREE from 'three';
import { ENV_UNIFORMS, NOISE, SKY_COLOR } from './glsl.js';

// The backdrop is drawn from a virtual camera that looks up at the sky, so the
// horizon stays straight near the bottom of the screen while the real camera
// looks down at the cube.
const VERT = /* glsl */ `
uniform vec3 uSkyRight;
uniform vec3 uSkyUp;
uniform vec3 uSkyForward;
uniform vec2 uSkyScale;
varying vec3 vDir;
void main() {
  vDir = uSkyForward + uSkyRight * position.x * uSkyScale.x + uSkyUp * position.y * uSkyScale.y;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
${ENV_UNIFORMS}
${NOISE}
${SKY_COLOR}
uniform int uOctaves;
uniform float uCloudTime;
varying vec3 vDir;

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= uOctaves) break;
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

// Open sea below the horizon, so the cube floats over an endless ocean.
vec3 openSea(vec3 dir) {
  float down = -dir.y;
  vec2 p = dir.xz / max(down, 0.004) * 0.6;
  float fade = smoothstep(0.0, 0.22, down);
  float amp = 0.06 + 0.22 * uWind + 0.25 * uStorm;
  float base = atan(uWindDir.y, uWindDir.x);
  vec2 g = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ang = base + (fi - 2.0) * 0.55;
    vec2 d = vec2(cos(ang), sin(ang));
    float k = 1.3 * pow(1.8, fi);
    float th = k * dot(d, p) - uTime * sqrt(k) * 0.9 + fi * 2.1;
    g += amp * 0.5 * cos(th) * d;
  }
  g *= fade;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 r = reflect(dir, n);
  r.y = abs(r.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, -dir), 0.0), 5.0);
  vec3 light = uAmbient * 0.8 + uSunColor * (0.25 + 0.5 * max(uSunDir.y, 0.0));
  vec3 water = mix(uDeepColor, uShallowColor, 0.22) * light + vec3(0.01, 0.025, 0.07) * uNight;
  vec3 refl = mix(skyGradient(r), uHorizon * 0.9, uCloud * 0.5);
  vec3 col = mix(water, refl, fres);
  float glitter = pow(max(dot(r, uSunDir), 0.0), 500.0) * step(0.0, uSunDir.y) * (1.0 - uCloud * 0.85);
  col += uSunColor * glitter * 4.0;
  float moonR = max(dot(r, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (pow(moonR, 400.0) * 2.0 + pow(moonR, 30.0) * 0.12) * uNight * (1.0 - uCloud * 0.9);
  float caps = smoothstep(0.72, 0.95, vnoise(p * 3.0 + uTime * 0.2)) * smoothstep(0.4, 1.0, uWind + uStorm * 0.6) * fade;
  col = mix(col, light * 0.9, caps * 0.45);
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.25 * fres;
  // Aerial perspective: the far sea melts into the horizon.
  col = mix(col, uHorizon * 0.8 + uDeepColor * 0.2, smoothstep(0.06, 0.0, down) * 0.75);
  return col;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyGradient(dir);

  // Stars and moon, hidden by daylight and clouds.
  float clear = 1.0 - smoothstep(0.3, 0.9, uCloud);
  if (uNight > 0.01) {
    vec3 sp = dir * 260.0;
    vec3 cell = floor(sp);
    float star = hash13(cell);
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.0 + star * 3.0) + star * 40.0);
    float s = smoothstep(0.9965, 1.0, star) * smoothstep(0.65, 0.2, length(fract(sp) - 0.5)) * twinkle;
    col += vec3(0.9, 0.95, 1.0) * s * uNight * clear * smoothstep(-0.05, 0.25, dir.y) * 1.4;

    float moon = dot(dir, uMoonDir);
    float disc = smoothstep(0.99982, 0.99988, moon);
    float craters = 0.82 + 0.18 * vnoise(dir.xy * 1400.0);
    col = mix(col, vec3(0.93, 0.94, 0.98) * craters, disc * uNight * (1.0 - uCloud * 0.97));
    col += vec3(0.5, 0.6, 0.85) * pow(max(moon, 0.0), 2000.0) * 0.35 * uNight * (1.0 - uCloud * 0.9);
  }

  // Sun disc.
  float sunDisc = smoothstep(0.99975, 0.99985, dot(dir, uSunDir));
  col += uSunColor * sunDisc * 2.0 * (1.0 - uCloud * 0.9) * step(-0.02, uSunDir.y);

  if (dir.y < 0.0) col = openSea(dir);

  // Cloud layer projected on a plane above the camera.
  if (dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.12) * 0.9;
    vec2 drift = uWindDir * uCloudTime;
    float n = fbm(uv + drift);
    float n2 = fbm(uv * 2.1 - drift * 1.4 + 3.0);
    float coverage = mix(0.78, 0.25, uCloud);
    float density = smoothstep(coverage, coverage + 0.25 + uCloud * 0.2, n * 0.7 + n2 * 0.3);
    density *= smoothstep(0.0, 0.12, dir.y);
    float shade = smoothstep(0.2, 0.9, n2);
    vec3 lit = mix(uHorizon, vec3(1.0), 0.55) * (0.6 + 0.4 * max(uSunDir.y + 0.2, 0.0)) + uSunColor * 0.25;
    lit *= 1.0 - uNight * 0.85;
    vec3 dark = mix(uZenith, vec3(0.2, 0.22, 0.26), 0.5) * (1.0 - uNight * 0.8) * (1.0 - uStorm * 0.5);
    vec3 cloudCol = mix(lit, dark, shade * (0.4 + uCloud * 0.5 + uStorm * 0.3));
    // Lightning illuminates the clouds from inside.
    cloudCol += vec3(0.75, 0.8, 1.0) * uFlash * (0.6 + shade);
    col = mix(col, cloudCol, density * (0.75 + 0.25 * uCloud));
  }

  // Haze near the horizon (fog, rain).
  float haze = (uFog * 0.85 + uRain * 0.3) * smoothstep(0.5, -0.1, dir.y);
  col = mix(col, uFogColor, clamp(haze, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(env, quality) {
    this.uniforms = {
      ...env.uniforms,
      uOctaves: { value: quality.cloudOctaves },
      uCloudTime: { value: 0 },
      uSkyRight: { value: new THREE.Vector3() },
      uSkyUp: { value: new THREE.Vector3() },
      uSkyForward: { value: new THREE.Vector3() },
      uSkyScale: { value: new THREE.Vector2(1, 1) },
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.mesh.renderOrder = -10;
    this.horizonNdc = -0.3;
    this.mesh.frustumCulled = false;
  }

  update(dt, camera, env) {
    // Virtual camera: same heading as the real one, tilted up so the horizon sits
    // about a third of the way up the screen, with open sea below it.
    const yaw = Math.atan2(camera.position.x, camera.position.z);
    const pitch = 0.22 - (camera.position.y / camera.position.length() - 0.37) * 0.5;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(35));
    this.horizonNdc = -Math.tan(pitch) / tanHalf;
    const u = this.uniforms;
    u.uSkyForward.value.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    u.uSkyRight.value.set(Math.cos(yaw), 0, -Math.sin(yaw));
    u.uSkyUp.value.crossVectors(u.uSkyRight.value, u.uSkyForward.value);
    u.uSkyScale.value.set(tanHalf * camera.aspect, tanHalf);
    // Clouds drift with the wind (faster when windy).
    this.uniforms.uCloudTime.value += dt * (0.01 + env.windFactor * 0.05);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
