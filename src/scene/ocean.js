import * as THREE from 'three';
import { CUBE } from '../config.js';
import { ENV_UNIFORMS, NOISE, SKY_COLOR, WAVES } from './glsl.js';

const HALF = CUBE.size / 2;

const COMMON = /* glsl */ `
${ENV_UNIFORMS}
${NOISE}
${WAVES}
uniform sampler2D uSim;
uniform vec2 uSimTexel;
uniform float uRippleAmp;
uniform float uLevel;
uniform float uHalf;

vec2 simUv(vec2 xz) {
  return clamp(xz / (2.0 * uHalf) + 0.5, 0.0, 1.0);
}
float surfaceHeight(vec2 xz) {
  vec2 g;
  return uLevel + waveHeight(xz, g) + texture2D(uSim, simUv(xz)).r * uRippleAmp;
}
`;

const SURFACE_VERT = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec2 vSimUv;
void main() {
  vec3 p = position;
  p.y = surfaceHeight(p.xz);
  vSimUv = simUv(p.xz);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SURFACE_FRAG = /* glsl */ `
${COMMON}
${SKY_COLOR}
varying vec3 vWorld;
varying vec2 vSimUv;

// Small, fast capillary waves that only affect the normal (no geometry cost).
vec2 detailGradient(vec2 p) {
  vec2 g = vec2(0.0);
  float a = 0.0012 + 0.0035 * uWind + 0.002 * uRain + 0.002 * uStorm;
  float base = atan(uWindDir.y, uWindDir.x);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ang = base + (fi - 1.5) * 0.7;
    vec2 d = vec2(cos(ang), sin(ang));
    float k = 16.0 * pow(1.55, fi);
    float th = k * dot(d, p) - uTime * sqrt(0.25 * k) * 1.4 + fi * 1.7;
    g += a * k * cos(th) * d / (1.0 + fi * 0.5);
  }
  return g;
}

void main() {
  vec2 grad;
  float h = waveHeight(vWorld.xz, grad);
  vec4 sim = texture2D(uSim, vSimUv);
  float hl = texture2D(uSim, vSimUv - vec2(uSimTexel.x, 0.0)).r;
  float hr = texture2D(uSim, vSimUv + vec2(uSimTexel.x, 0.0)).r;
  float hd = texture2D(uSim, vSimUv - vec2(0.0, uSimTexel.y)).r;
  float hu = texture2D(uSim, vSimUv + vec2(0.0, uSimTexel.y)).r;
  float texelWorld = 2.0 * uHalf * uSimTexel.x;
  vec2 rippleGrad = vec2(hr - hl, hu - hd) * uRippleAmp / (2.0 * texelWorld);
  float rippleSlope = length(rippleGrad);
  grad += rippleGrad;
  grad += detailGradient(vWorld.xz);

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float NdotV = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 reflection = skyGradient(R);
  // Clouds make reflections greyer and flatter.
  reflection = mix(reflection, uHorizon * 0.9, uCloud * 0.45);

  float crest = clamp(h * 7.0 + 0.45, 0.0, 1.0);
  float sunUp = max(uSunDir.y, 0.0);
  vec3 light = uAmbient * 0.85 + uSunColor * (0.3 + 0.55 * sunUp);
  light = max(light, vec3(0.42, 0.48, 0.62)); // keep the blue readable at dusk and night
  vec3 body = mix(uDeepColor, uShallowColor, 0.35 + 0.55 * crest) * light * 1.15;
  // Light scattering through the thin tops of the waves.
  float scatter = pow(max(dot(V, -uSunDir), 0.0), 4.0) * crest;
  body += uShallowColor * uSunColor * scatter * 0.6;

  vec3 col = mix(body, reflection, fresnel * 0.85);

  float specSun = pow(max(dot(R, uSunDir), 0.0), 380.0) * step(0.0, uSunDir.y);
  col += uSunColor * specSun * 3.5 * (1.0 - uCloud * 0.85);
  float specMoon = pow(max(dot(R, uMoonDir), 0.0), 260.0);
  col += vec3(0.7, 0.78, 1.0) * specMoon * 1.2 * uNight * (1.0 - uCloud * 0.95);
  col += vec3(0.85, 0.9, 1.0) * uFlash * 0.35 * fresnel;

  // Foam: on wave crests (wind), around ripples and along the glass.
  float foamNoise = vnoise(vWorld.xz * 22.0 + uTime * 0.6) * 0.6 + vnoise(vWorld.xz * 55.0 - uTime) * 0.4;
  float rough = smoothstep(0.25, 1.0, uWind + uStorm * 0.6);
  float crestFoam = smoothstep(0.62, 0.95, crest) * rough;
  float rippleFoam = smoothstep(0.35, 1.2, rippleSlope) * 0.6;
  vec2 edge = min(vSimUv, 1.0 - vSimUv);
  float edgeFoam = smoothstep(0.03, 0.0, min(edge.x, edge.y)) * (0.35 + rough * 0.5);
  float foam = clamp((crestFoam + rippleFoam + edgeFoam) * smoothstep(0.35, 0.75, foamNoise), 0.0, 1.0);
  col = mix(col, light * 1.05 + vec3(0.04), foam * 0.85);

  // Bioluminescence: at night, disturbed water glows blue-green.
  float disturb = smoothstep(0.06, 0.45, rippleSlope);
  float sparkle = vnoise(vWorld.xz * 40.0 + uTime * 2.0);
  col += vec3(0.1, 0.85, 1.0) * disturb * (0.5 + sparkle) * uNight * 0.9;

  col = mix(col, uFogColor, uFog * 0.35);
  float alpha = mix(0.86, 0.98, fresnel) ;
  gl_FragColor = vec4(col, alpha);
}
`;

const WALL_VERT = /* glsl */ `
${COMMON}
attribute float aTop;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  p.y = mix(p.y, surfaceHeight(p.xz), aTop);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WALL_FRAG = /* glsl */ `
${COMMON}
uniform float uFloor;
varying vec3 vWorld;
void main() {
  float d = max(surfaceHeight(vWorld.xz) - vWorld.y, 0.0);
  float depth01 = clamp(d / (uLevel - uFloor), 0.0, 1.0);
  float sunUp = max(uSunDir.y, 0.0);
  vec3 light = uAmbient * 0.8 + uSunColor * (0.2 + 0.55 * sunUp);
  light = max(light, vec3(0.42, 0.48, 0.62));
  // Bright blue near the surface sinking into a dark abyss.
  vec3 col = mix(uShallowColor * 1.25, uDeepColor * 0.4, pow(depth01, 0.9)) * light;

  // Shafts of light coming through the surface.
  float along = vWorld.x + vWorld.z;
  float shafts = vnoise(vec2(along * 5.0 + d * 1.5 * uWindDir.x, uTime * 0.25));
  shafts = pow(shafts, 3.0) * (1.0 - depth01 * 0.85) * (1.0 - uCloud * 0.8) * sunUp;
  col += uSunColor * shafts * 0.45;

  // Bright line right under the surface.
  col += (uSunColor * 0.35 + uAmbient * 0.3) * smoothstep(0.03, 0.0, d);

  // Drifting plankton specks that glow at night.
  vec2 sp = vec2(along * 45.0, vWorld.y * 45.0 + uTime * 0.6);
  vec2 cell = floor(sp);
  float speck = step(0.992, hash12(cell)) * smoothstep(0.45, 0.1, length(fract(sp) - 0.5));
  float pulse = 0.6 + 0.4 * sin(uTime * 2.0 + hash12(cell + 5.0) * 30.0);
  col += speck * pulse * (vec3(0.6, 0.8, 0.9) * 0.12 * (1.0 - uNight) + vec3(0.1, 0.9, 1.0) * 0.45 * uNight) * (1.0 - depth01 * 0.5);

  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.25 * (1.0 - depth01);
  col = mix(col, uFogColor, uFog * 0.3);
  float alpha = mix(0.4, 0.95, smoothstep(0.0, 0.85, depth01));
  gl_FragColor = vec4(col, alpha);
}
`;

function buildWallGeometry(segments) {
  const positions = [];
  const tops = [];
  const indices = [];
  const sides = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // outward normals (x, z)
  for (const [nx, nz] of sides) {
    const rx = nz;
    const rz = -nx;
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const s = -HALF + (i / segments) * CUBE.size;
      const x = nx * HALF + rx * s;
      const z = nz * HALF + rz * s;
      positions.push(x, CUBE.sandTop, z, x, CUBE.waterLevel, z);
      tops.push(0, 1);
    }
    for (let i = 0; i < segments; i++) {
      const b0 = base + i * 2;
      const t0 = b0 + 1;
      const b1 = b0 + 2;
      const t1 = b0 + 3;
      indices.push(b0, b1, t1, b0, t1, t0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aTop', new THREE.Float32BufferAttribute(tops, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

export class Ocean {
  constructor(env, sim, segments) {
    this.group = new THREE.Group();
    const uniforms = {
      ...env.uniforms,
      uSim: { value: sim.texture },
      uSimTexel: { value: new THREE.Vector2(1 / sim.size, 1 / sim.size) },
      uRippleAmp: { value: 1.0 },
      uLevel: { value: CUBE.waterLevel },
      uHalf: { value: HALF },
      uFloor: { value: CUBE.sandTop },
    };
    this.uniforms = uniforms;
    this.sim = sim;

    const surfaceGeo = new THREE.PlaneGeometry(CUBE.size, CUBE.size, segments, segments);
    surfaceGeo.rotateX(-Math.PI / 2);
    surfaceGeo.translate(0, CUBE.waterLevel, 0);
    this.surface = new THREE.Mesh(surfaceGeo, new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
    }));
    this.surface.renderOrder = 12;

    const wallGeo = buildWallGeometry(segments);
    const wallMaterial = (side) => new THREE.ShaderMaterial({
      uniforms,
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      transparent: true,
      side,
    });
    // Inner faces of the far walls first, then the near walls, so the volume reads as thick.
    this.wallsBack = new THREE.Mesh(wallGeo, wallMaterial(THREE.BackSide));
    this.wallsBack.renderOrder = 10;
    this.wallsFront = new THREE.Mesh(wallGeo, wallMaterial(THREE.FrontSide));
    this.wallsFront.renderOrder = 11;

    for (const m of [this.surface, this.wallsBack, this.wallsFront]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  update() {
    // The ping-pong target changes every simulation pass.
    this.uniforms.uSim.value = this.sim.texture;
  }

  /** Approximate surface height in JS (waves only), used by fish and splashes. */
  static heightAt(env, x, z) {
    const waves = env.uniforms.uWaves.value;
    const phases = env.uniforms.uWavePhase.value;
    const sharp = env.uniforms.uWaveSharp.value;
    let h = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const th = w.z * (w.x * x + w.y * z) - phases[i];
      const u = Math.max(0.5 + 0.5 * Math.sin(th), 1e-4);
      h += w.w * (2 * Math.pow(u, sharp) - 1);
    }
    return CUBE.waterLevel + h;
  }

  dispose() {
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.wallsBack.geometry.dispose();
    this.wallsBack.material.dispose();
    this.wallsFront.material.dispose();
  }
}
