import * as THREE from 'three';
import { ENV_UNIFORMS } from './glsl.js';

// Rain and snow fill a big box around the cube so they cover the whole screen,
// passing in front of and behind the cube.
const BOX_MIN = new THREE.Vector3(-16, -9, -14);
const BOX_SIZE = new THREE.Vector3(32, 20, 22);

const RAIN_VERT = /* glsl */ `
${ENV_UNIFORMS}
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uOffset;
uniform vec3 uVelocity;
uniform float uDensity;
attribute vec3 aSeed;
attribute float aEnd;
attribute float aRand;
varying float vEnd;
void main() {
  if (aRand > uDensity) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 p = uBoxMin + aSeed * uBoxSize + uOffset;
  p = uBoxMin + mod(p - uBoxMin, uBoxSize);
  float len = 0.35 + 0.25 * aRand + uStorm * 0.2;
  p -= normalize(uVelocity) * len * aEnd;
  vEnd = aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
${ENV_UNIFORMS}
varying float vEnd;
void main() {
  vec3 col = mix(uAmbient, vec3(0.85, 0.9, 1.0), 0.4) + vec3(0.9) * uFlash;
  float alpha = (1.0 - vEnd) * (0.28 + uFlash * 0.4);
  gl_FragColor = vec4(col, alpha);
}
`;

const SNOW_VERT = /* glsl */ `
${ENV_UNIFORMS}
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uOffset;
uniform float uDensity;
uniform float uPixelRatio;
attribute vec3 aSeed;
attribute float aRand;
varying float vAlpha;
void main() {
  if (aRand > uDensity) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 p = uBoxMin + aSeed * uBoxSize + uOffset;
  p.x += sin(uTime * (0.5 + aRand) + aRand * 30.0) * 0.4;
  p.z += cos(uTime * (0.4 + aRand) + aRand * 20.0) * 0.4;
  p = uBoxMin + mod(p - uBoxMin, uBoxSize);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.06 + aRand * 0.06) * uPixelRatio * 800.0 / -mv.z;
  vAlpha = 0.85;
  gl_Position = projectionMatrix * mv;
}
`;

const SNOW_FRAG = /* glsl */ `
${ENV_UNIFORMS}
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  vec3 col = mix(uAmbient, vec3(1.0), 0.6) + uFlash * 0.5;
  gl_FragColor = vec4(col, a);
}
`;

function seeds(count, perDrop) {
  const seed = new Float32Array(count * perDrop * 3);
  const rand = new Float32Array(count * perDrop);
  const end = new Float32Array(count * perDrop);
  for (let i = 0; i < count; i++) {
    const s = [Math.random(), Math.random(), Math.random()];
    const r = Math.random();
    for (let k = 0; k < perDrop; k++) {
      const idx = i * perDrop + k;
      seed.set(s, idx * 3);
      rand[idx] = r;
      end[idx] = k;
    }
  }
  return { seed, rand, end };
}

export class Precipitation {
  constructor(env, quality, pixelRatio) {
    this.group = new THREE.Group();
    this.rainOffset = new THREE.Vector3();
    this.snowOffset = new THREE.Vector3();

    const r = seeds(quality.rainCount, 2);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quality.rainCount * 6), 3));
    rainGeo.setAttribute('aSeed', new THREE.BufferAttribute(r.seed, 3));
    rainGeo.setAttribute('aRand', new THREE.BufferAttribute(r.rand, 1));
    rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(r.end, 1));
    this.rainUniforms = {
      ...env.uniforms,
      uBoxMin: { value: BOX_MIN },
      uBoxSize: { value: BOX_SIZE },
      uOffset: { value: this.rainOffset },
      uVelocity: { value: new THREE.Vector3(0, -1, 0) },
      uDensity: { value: 0 },
    };
    this.rain = new THREE.LineSegments(rainGeo, new THREE.ShaderMaterial({
      uniforms: this.rainUniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
      transparent: true, depthWrite: false,
    }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 30;
    this.group.add(this.rain);

    const s = seeds(quality.snowCount, 1);
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quality.snowCount * 3), 3));
    snowGeo.setAttribute('aSeed', new THREE.BufferAttribute(s.seed, 3));
    snowGeo.setAttribute('aRand', new THREE.BufferAttribute(s.rand, 1));
    this.snowUniforms = {
      ...env.uniforms,
      uBoxMin: { value: BOX_MIN },
      uBoxSize: { value: BOX_SIZE },
      uOffset: { value: this.snowOffset },
      uDensity: { value: 0 },
      uPixelRatio: { value: pixelRatio },
    };
    this.snow = new THREE.Points(snowGeo, new THREE.ShaderMaterial({
      uniforms: this.snowUniforms, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG,
      transparent: true, depthWrite: false,
    }));
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 31;
    this.group.add(this.snow);
  }

  setPixelRatio(pr) {
    this.snowUniforms.uPixelRatio.value = pr;
  }

  update(dt, env) {
    const c = env.current;
    const wind = env.uniforms.uWindDir.value;
    const push = 1 + c.wind * 0.45;

    const vel = this.rainUniforms.uVelocity.value.set(wind.x * push, -(14 + c.storm * 4), wind.y * push);
    this.rainOffset.addScaledVector(vel, dt);
    wrap(this.rainOffset);
    this.rainUniforms.uDensity.value = c.rain;
    this.rain.visible = c.rain > 0.005;

    this.snowOffset.x += wind.x * push * 0.4 * dt;
    this.snowOffset.y -= 1.1 * dt;
    this.snowOffset.z += wind.y * push * 0.4 * dt;
    wrap(this.snowOffset);
    this.snowUniforms.uDensity.value = c.snow;
    this.snow.visible = c.snow > 0.005;
  }

  dispose() {
    for (const m of [this.rain, this.snow]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

// Keep offsets small so float precision never degrades in long sessions.
// Wrapping by whole box sizes is invisible because the shader wraps too.
function wrap(v) {
  v.x %= BOX_SIZE.x;
  v.y %= BOX_SIZE.y;
  v.z %= BOX_SIZE.z;
}
