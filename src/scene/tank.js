import * as THREE from 'three';
import { CUBE } from '../config.js';
import { ENV_UNIFORMS, NOISE } from './glsl.js';

const HALF = CUBE.size / 2;

const LIT_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SAND_FRAG = /* glsl */ `
${ENV_UNIFORMS}
${NOISE}
uniform float uLevel;
uniform int uCausticIter;
varying vec3 vWorld;
varying vec3 vNormal;

// Tileable water caustics (after joltz0r, Shadertoy MdlXz8).
float caustic(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    if (n >= uCausticIter) break;
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= float(uCausticIter);
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

void main() {
  vec3 N = normalize(vNormal);
  float grain = hash12(floor(vWorld.xz * 300.0 + vWorld.y * 300.0)) * 0.08;
  vec3 sand = vec3(0.84, 0.74, 0.55) * (0.92 + grain);
  // Darker layers on the sides of the sand block.
  float layers = 0.85 + 0.15 * sin(vWorld.y * 90.0 + vnoise(vWorld.xz * 8.0) * 3.0);
  sand *= mix(1.0, layers, 1.0 - abs(N.y));

  float depth = uLevel - vWorld.y;
  vec3 waterTint = mix(uShallowColor, uDeepColor, clamp(depth * 0.6, 0.0, 1.0));
  float sunUp = max(uSunDir.y, 0.0);
  vec3 light = uAmbient * 0.9 + uSunColor * (0.15 + max(dot(N, uSunDir), 0.0) * 0.6);
  vec3 col = sand * light;
  col = mix(col, waterTint * light * 1.4, 0.35 * step(0.5, N.y));

  float c = caustic(vWorld.xz * 0.55 + uWindDir * uTime * 0.02, uTime * (0.35 + uWind * 0.4));
  float causticStrength = sunUp * (1.0 - uCloud * 0.85) * step(0.5, N.y);
  col += uSunColor * c * causticStrength * 0.55;
  col += vec3(0.1, 0.8, 1.0) * c * uNight * 0.05 * step(0.5, N.y);
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.2;
  col = mix(col, uFogColor, uFog * 0.3);
  gl_FragColor = vec4(col, 1.0);
}
`;

const ROCK_FRAG = /* glsl */ `
${ENV_UNIFORMS}
${NOISE}
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 N = normalize(vNormal);
  float n = vnoise(vWorld.xz * 18.0 + vWorld.y * 11.0);
  vec3 base = mix(vec3(0.32, 0.33, 0.35), vec3(0.45, 0.43, 0.4), n);
  base = mix(base, vec3(0.2, 0.42, 0.25), smoothstep(0.3, 0.9, N.y) * 0.5); // moss on top
  vec3 light = uAmbient * 0.6 + uSunColor * max(dot(N, uSunDir), 0.0) * 0.7;
  vec3 col = base * light;
  col = mix(col, uShallowColor * light, 0.35);
  col = mix(col, uFogColor, uFog * 0.3);
  gl_FragColor = vec4(col, 1.0);
}
`;

const WEED_VERT = /* glsl */ `
${ENV_UNIFORMS}
attribute float aHeight;
attribute float aPhase;
varying float vH;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  float k = aHeight * aHeight;
  float sway = sin(uTime * (0.8 + uWind * 1.2) + aPhase + aHeight * 3.0) * (0.04 + uWind * 0.06 + uStorm * 0.05);
  p.x += sway * k + uWindDir.x * 0.05 * k * (uWind + uStorm);
  p.z += cos(uTime * 0.7 + aPhase) * 0.03 * k + uWindDir.y * 0.05 * k * (uWind + uStorm);
  vH = aHeight;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WEED_FRAG = /* glsl */ `
${ENV_UNIFORMS}
varying float vH;
varying vec3 vWorld;
void main() {
  vec3 base = mix(vec3(0.1, 0.38, 0.16), vec3(0.45, 0.8, 0.3), vH);
  vec3 light = uAmbient * 0.8 + uSunColor * 0.6 * max(uSunDir.y, 0.0);
  vec3 col = base * light + vec3(0.05, 0.6, 0.5) * uNight * vH * 0.25;
  col = mix(col, uShallowColor * light, 0.3);
  col = mix(col, uFogColor, uFog * 0.3);
  gl_FragColor = vec4(col, 1.0);
}
`;

const GLASS_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GLASS_FRAG = /* glsl */ `
${ENV_UNIFORMS}
${NOISE}
uniform float uHalf;
uniform float uBottom;
uniform float uTop;
uniform float uWet;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 N = normalize(vNormal);
  // The cube is open on top so rain can fall into the water.
  if (N.y > 0.5 && vWorld.y > uTop - 0.01) discard;
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);

  // Bright bevel along the edges of each face.
  vec3 a = abs(vWorld);
  vec3 edgeDist = vec3(uHalf) - a;
  edgeDist.y = min(vWorld.y - uBottom, uTop - vWorld.y);
  vec3 masked = mix(edgeDist, vec3(1.0), abs(N));
  float edge = smoothstep(0.025, 0.0, min(min(masked.x, masked.y), masked.z));

  vec3 sky = mix(uHorizon, uZenith, 0.5);
  vec3 col = sky * 0.6 + uSunColor * 0.4;
  float spec = pow(max(dot(reflect(-V, N), uSunDir), 0.0), 120.0) * (1.0 - uCloud * 0.8);

  // Raindrops running down the glass when it rains.
  float drops = 0.0;
  if (uWet > 0.01) {
    vec2 st = vec2(dot(vWorld.xz, vec2(-N.z, N.x)) + N.y * vWorld.x, vWorld.y);
    vec2 cell = vec2(floor(st.x * 28.0), 0.0);
    float speed = 0.15 + hash12(cell) * 0.35;
    float y = fract(st.y * 1.5 + uTime * speed + hash12(cell + 7.0));
    float xIn = abs(fract(st.x * 28.0) - 0.5);
    drops = smoothstep(0.12, 0.0, xIn) * smoothstep(0.0, 0.04, y) * smoothstep(0.1, 0.04, y) * step(0.55, hash12(cell + 3.0));
    drops *= uWet * (1.0 - abs(N.y));
  }

  float alpha = 0.04 + fres * 0.22 + edge * 0.35 + spec * 0.6 + drops * 0.35;
  col += uSunColor * spec * 2.0 + vec3(0.9, 0.95, 1.0) * uFlash * 0.4;
  col = mix(col, vec3(1.0), edge * 0.4);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.9));
}
`;

function rockGeometry(seed, radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 9 + seed) * Math.cos(v.y * 7 + seed * 2) * Math.sin(v.z * 8 + seed * 3);
    v.multiplyScalar(1 + n * 0.25);
    v.y *= 0.6;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function weedGeometry(rng, count) {
  const positions = [];
  const heights = [];
  const phases = [];
  const indices = [];
  for (let s = 0; s < count; s++) {
    const bx = (rng() * 2 - 1) * (HALF - 0.15);
    const bz = (rng() * 2 - 1) * (HALF - 0.15);
    const height = 0.22 + rng() * 0.38;
    const width = 0.025 + rng() * 0.02;
    const angle = rng() * Math.PI;
    const phase = rng() * Math.PI * 2;
    const ax = Math.cos(angle) * width;
    const az = Math.sin(angle) * width;
    const seg = 8;
    const base = positions.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const taper = 1 - t * 0.8;
      const y = CUBE.sandTop + t * height;
      positions.push(bx - ax * taper, y, bz - az * taper, bx + ax * taper, y, bz + az * taper);
      heights.push(t, t);
      phases.push(phase, phase);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geo.setIndex(indices);
  return geo;
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Glass cube, sand floor with caustics, rocks and seaweed. */
export class Tank {
  constructor(env, quality) {
    this.group = new THREE.Group();
    this.disposables = [];
    const rng = mulberry32(7);

    const sandUniforms = {
      ...env.uniforms,
      uLevel: { value: CUBE.waterLevel },
      uCausticIter: { value: quality.causticIter },
    };
    const sandHeight = CUBE.sandTop - CUBE.bottom;
    const sandGeo = new THREE.BoxGeometry(CUBE.size, sandHeight, CUBE.size, 1, 1, 1);
    sandGeo.translate(0, CUBE.bottom + sandHeight / 2, 0);
    this.add(new THREE.Mesh(sandGeo, new THREE.ShaderMaterial({
      uniforms: sandUniforms, vertexShader: LIT_VERT, fragmentShader: SAND_FRAG,
    })));

    const rockMat = new THREE.ShaderMaterial({ uniforms: env.uniforms, vertexShader: LIT_VERT, fragmentShader: ROCK_FRAG });
    const rocks = [
      [-0.55, -0.45, 0.22], [-0.3, -0.62, 0.12], [0.6, 0.35, 0.18], [0.45, 0.6, 0.1], [-0.65, 0.55, 0.14], [0.1, -0.2, 0.08],
    ];
    rocks.forEach(([x, z, r], i) => {
      const rock = new THREE.Mesh(rockGeometry(i * 3.7 + 1, r), rockMat);
      rock.position.set(x, CUBE.sandTop + r * 0.2, z);
      rock.rotation.y = rng() * Math.PI;
      this.add(rock);
    });

    const weed = new THREE.Mesh(weedGeometry(rng, 14), new THREE.ShaderMaterial({
      uniforms: env.uniforms, vertexShader: WEED_VERT, fragmentShader: WEED_FRAG, side: THREE.DoubleSide,
    }));
    weed.frustumCulled = false;
    this.add(weed);

    this.glassUniforms = {
      ...env.uniforms,
      uHalf: { value: HALF + 0.012 },
      uBottom: { value: CUBE.bottom - 0.012 },
      uTop: { value: CUBE.top },
      uWet: { value: 0 },
    };
    const glassGeo = new THREE.BoxGeometry(CUBE.size + 0.024, CUBE.top - CUBE.bottom + 0.012, CUBE.size + 0.024);
    glassGeo.translate(0, (CUBE.top + CUBE.bottom - 0.012) / 2, 0);
    const glass = (side, order) => {
      const m = new THREE.Mesh(glassGeo, new THREE.ShaderMaterial({
        uniforms: this.glassUniforms, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG,
        transparent: true, depthWrite: false, side,
      }));
      m.renderOrder = order;
      return m;
    };
    this.add(glass(THREE.BackSide, 5));
    this.add(glass(THREE.FrontSide, 20));

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(glassGeo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    edges.renderOrder = 21;
    this.edges = edges;
    this.add(edges);
  }

  add(mesh) {
    this.group.add(mesh);
    this.disposables.push(mesh);
  }

  update(env) {
    this.glassUniforms.uWet.value = Math.max(env.current.rain, env.current.storm);
    const night = env.uniforms.uNight.value;
    this.edges.material.opacity = 0.35 - night * 0.2 + env.flash * 0.5;
  }

  dispose() {
    const seen = new Set();
    for (const m of this.disposables) {
      for (const r of [m.geometry, m.material]) {
        if (!seen.has(r)) {
          seen.add(r);
          r.dispose();
        }
      }
    }
  }
}
