import * as THREE from 'three';
import { CUBE } from '../config.js';
import { ENV_UNIFORMS, NOISE } from './glsl.js';

const SHARK = 0;
const WHALE = 1;

// Parts: 0 body, 1 fin, 2 pectoral fin / flipper, 3 tail.
const VERT = /* glsl */ `
${ENV_UNIFORMS}
uniform float uSwim;
uniform float uBend;
uniform float uKind;
attribute float aT;
attribute float aPart;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vT;
varying float vPart;
void main() {
  vec3 p = position;
  float t = aT;
  float tail = pow(clamp((t - 0.25) / 0.75, 0.0, 1.5), 2.0);
  if (uKind < 0.5) {
    // Sharks sweep their tail side to side.
    p.z += sin(uSwim - t * 5.5) * 0.07 * tail;
  } else {
    // Whales beat their flukes up and down; flippers move slowly.
    p.y += sin(uSwim - t * 3.0) * 0.05 * tail;
    if (aPart > 1.5 && aPart < 2.5) p.y += sin(uSwim * 0.5 + 1.0) * 0.08 * abs(p.z);
  }
  // Curve the body along the turn.
  p.z += uBend * (t - 0.3) * (t - 0.3) * 0.6;
  vLocal = position;
  vT = t;
  vPart = aPart;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
${ENV_UNIFORMS}
${NOISE}
uniform float uKind;
uniform float uLevel;
uniform float uDepthRange;
uniform vec3 uTop;
uniform vec3 uBelly;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vT;
varying float vPart;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);

  // Countershading: dark back, pale belly, with a soft wavy border.
  float border = vLocal.y + 0.012 * sin(vLocal.x * 38.0);
  vec3 base = mix(uBelly, uTop, smoothstep(-0.035, 0.03, border));
  if (uKind > 0.5) {
    // Humpback: throat grooves, mottled skin, pale flipper undersides.
    float grooves = step(0.5, fract(vLocal.z * 70.0)) * step(vLocal.y, -0.02) * step(vT, 0.5);
    base *= 1.0 - grooves * 0.15;
    base *= 0.85 + 0.3 * vnoise(vLocal.xz * 30.0 + vLocal.y * 20.0);
    if (vPart > 1.5 && vPart < 2.5) base = mix(base, uBelly, 0.55);
  } else {
    base *= 0.92 + 0.12 * vnoise(vLocal.xy * 50.0);
  }
  float eye = smoothstep(0.016, 0.008, length(vec2(vLocal.x - (uKind > 0.5 ? 0.39 : 0.42), vLocal.y - 0.005)));
  base = mix(base, vec3(0.02), eye * step(0.5, abs(vLocal.z) * 30.0));

  float depth = clamp((uLevel - vWorld.y) / uDepthRange, 0.0, 1.0);
  vec3 light = uAmbient * 0.7 + uSunColor * (0.2 + 0.6 * max(dot(N, uSunDir), 0.0)) * (1.0 - depth * 0.7);
  vec3 col = base * light;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uShallowColor * rim * 0.35;
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.15;
  // Fade into the deep blue the further down they swim.
  col = mix(col, uDeepColor * light * 0.8, depth * 0.65);
  gl_FragColor = vec4(col, 1.0);
}
`;

function profileAt(samples, t) {
  for (let i = 1; i < samples.length; i++) {
    if (t <= samples[i][0]) {
      const [t0, r0] = samples[i - 1];
      const [t1, r1] = samples[i];
      return r0 + (r1 - r0) * ((t - t0) / (t1 - t0));
    }
  }
  return samples[samples.length - 1][1];
}

/** Unit-length body along X (head at +0.5, tail at -0.5) from a radius profile. */
function body(samples, radius, width, height, flatBelly) {
  const rings = 32;
  const sides = 20;
  const positions = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = profileAt(samples, t) * radius;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      let y = Math.sin(a) * r * height;
      if (y < 0) y *= 1 - flatBelly;
      positions.push(0.5 - t, y, Math.cos(a) * r * width);
    }
  }
  const indices = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/** Flat fins from triangles [[x,y,z],[x,y,z],[x,y,z]]; mirrored copies for paired fins. */
function fins(triangles, mirror) {
  const positions = [];
  for (const tri of triangles) {
    positions.push(...tri.flat());
    if (mirror) positions.push(...tri.map(([x, y, z]) => [x, y, -z]).flat());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function merge(parts) {
  const positions = [];
  const normals = [];
  const ts = [];
  const kinds = [];
  for (const [geo, part] of parts) {
    const pos = geo.attributes.position.array;
    positions.push(...pos);
    normals.push(...geo.attributes.normal.array);
    for (let i = 0; i < pos.length; i += 3) {
      ts.push(0.5 - pos[i]);
      kinds.push(part);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(kinds, 1));
  return geo;
}

function sharkGeometry() {
  const profile = [[0, 0], [0.04, 0.3], [0.12, 0.65], [0.3, 1], [0.5, 0.82], [0.7, 0.48], [0.85, 0.2], [0.93, 0.12], [1, 0.06]];
  return merge([
    [body(profile, 0.1, 0.85, 1, 0.25), 0],
    [fins([
      [[0.14, 0.085, 0], [-0.05, 0.08, 0], [-0.09, 0.25, 0]],      // dorsal fin
      [[-0.2, 0.05, 0], [-0.26, 0.04, 0], [-0.28, 0.1, 0]],        // second dorsal
    ]), 1],
    [fins([[[0.22, -0.04, 0.07], [0.11, -0.045, 0.07], [-0.02, -0.13, 0.27]]], true), 2],
    [fins([
      [[-0.42, 0.015, 0], [-0.47, 0, 0], [-0.63, 0.25, 0]],        // upper tail lobe
      [[-0.44, -0.01, 0], [-0.48, 0, 0], [-0.58, -0.14, 0]],       // lower tail lobe
    ]), 3],
  ]);
}

function whaleGeometry() {
  const profile = [[0, 0.02], [0.03, 0.45], [0.1, 0.8], [0.25, 1], [0.45, 0.93], [0.65, 0.66], [0.8, 0.36], [0.9, 0.17], [0.97, 0.09], [1, 0.06]];
  return merge([
    [body(profile, 0.12, 1, 0.82, 0.15), 0],
    [fins([[[-0.12, 0.075, 0], [-0.21, 0.06, 0], [-0.21, 0.115, 0]]]), 1],      // small dorsal hump
    [fins([
      [[0.25, -0.05, 0.09], [0.17, -0.06, 0.09], [-0.05, -0.17, 0.41]],         // long humpback flippers
      [[0.25, -0.05, 0.09], [-0.05, -0.17, 0.41], [-0.01, -0.15, 0.42]],
    ], true), 2],
    [fins([
      [[-0.43, 0, 0.015], [-0.61, 0, 0.25], [-0.53, 0, 0.03]],                 // flukes
      [[-0.53, 0, 0.03], [-0.61, 0, 0.25], [-0.59, 0, 0.1]],
    ], true), 3],
  ]);
}

/**
 * A creature that cruises along a slowly wandering loop inside the tank.
 * Loops (rather than steering) keep big bodies smooth and away from the glass.
 */
class Swimmer {
  constructor(kind, mesh, material, opts) {
    Object.assign(this, opts);
    this.kind = kind;
    this.mesh = mesh;
    this.material = material;
    this.pos = new THREE.Vector3();
    this.forward = new THREE.Vector3(1, 0, 0);
    this.swim = Math.random() * 10;
    this.place(0);
  }

  pathAt(theta, out) {
    const r = this.radius + this.radiusVar * Math.sin(theta * 0.37 + this.phase);
    let y = this.yMid + this.yAmp * Math.sin(theta * this.yFreq + this.phase);
    if (this.surfacing) y += 0.3 * Math.pow(Math.max(0, Math.sin(theta * 0.23 + this.phase * 2)), 6);
    y = Math.min(y, CUBE.waterLevel - this.length * 0.14);
    return out.set(Math.cos(theta) * r + this.offset.x, y, Math.sin(theta) * r + this.offset.y);
  }

  place(dt) {
    this.theta = (this.theta ?? Math.random() * Math.PI * 2) + this.dir * (this.speed / this.radius) * dt;
    this.pathAt(this.theta, this.pos);
    const ahead = this.pathAt(this.theta + this.dir * 0.05, new THREE.Vector3());
    this.forward.subVectors(ahead, this.pos).normalize();
    const r = this.radius + this.radiusVar * Math.sin(this.theta * 0.37 + this.phase);
    this.material.uniforms.uBend.value = this.dir * 0.83 * this.length / r;
  }

  update(dt, pace) {
    this.place(dt * pace);
    this.swim += dt * this.beat * pace;
    this.material.uniforms.uSwim.value = this.swim;

    const f = this.forward;
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f);
    const m = new THREE.Matrix4().makeBasis(f, up, new THREE.Vector3().crossVectors(f, up));
    m.scale(new THREE.Vector3().setScalar(this.length));
    m.setPosition(this.pos);
    this.mesh.matrix.copy(m);
  }
}

/** Whales and sharks. */
export class MarineLife {
  constructor(env, whales, sharks) {
    this.group = new THREE.Group();
    this.swimmers = [];
    this.geometries = [];

    const make = (kind, geo, top, belly, opts) => {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...env.uniforms,
          uSwim: { value: 0 },
          uBend: { value: 0 },
          uKind: { value: kind },
          uLevel: { value: CUBE.waterLevel },
          uDepthRange: { value: CUBE.waterLevel - CUBE.sandTop },
          uTop: { value: new THREE.Color(top) },
          uBelly: { value: new THREE.Color(belly) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.swimmers.push(new Swimmer(kind, mesh, material, opts));
    };

    const midY = (CUBE.waterLevel + CUBE.sandTop) / 2;
    if (whales > 0) {
      const geo = whaleGeometry();
      this.geometries.push(geo);
      const whaleOpts = [
        { length: 0.95, radius: 0.48, radiusVar: 0.08, speed: 0.07, dir: 1, yMid: midY + 0.05, yAmp: 0.18, yFreq: 0.5, phase: 0.3, beat: 1.4, surfacing: true, offset: new THREE.Vector2(0, 0) },
        { length: 0.7, radius: 0.42, radiusVar: 0.06, speed: 0.08, dir: 1, yMid: midY - 0.15, yAmp: 0.15, yFreq: 0.6, phase: 3.4, beat: 1.7, surfacing: false, offset: new THREE.Vector2(0.05, -0.05) },
      ];
      for (let i = 0; i < Math.min(whales, whaleOpts.length); i++) make(WHALE, geo, '#33475a', '#d4dde2', whaleOpts[i]);
    }
    if (sharks > 0) {
      const geo = sharkGeometry();
      this.geometries.push(geo);
      const sharkOpts = [
        // Each shark keeps to its own depth band / radius so they rarely cross the whales.
        { length: 0.46, radius: 0.55, radiusVar: 0.12, speed: 0.17, dir: -1, yMid: midY - 0.4, yAmp: 0.06, yFreq: 0.9, phase: 1.1, beat: 4.5, offset: new THREE.Vector2(0, 0) },
        { length: 0.4, radius: 0.32, radiusVar: 0.1, speed: 0.15, dir: -1, yMid: midY + 0.35, yAmp: 0.08, yFreq: 1.2, phase: 2.2, beat: 5, offset: new THREE.Vector2(-0.05, 0.05) },
        { length: 0.36, radius: 0.25, radiusVar: 0.05, speed: 0.12, dir: 1, yMid: midY - 0.45, yAmp: 0.05, yFreq: 0.7, phase: 4.0, beat: 5.5, offset: new THREE.Vector2(0, 0) },
        { length: 0.4, radius: 0.68, radiusVar: 0.04, speed: 0.16, dir: 1, yMid: midY + 0.38, yAmp: 0.05, yFreq: 1.0, phase: 5.3, beat: 4.8, offset: new THREE.Vector2(0, 0) },
      ];
      for (let i = 0; i < Math.min(sharks, sharkOpts.length); i++) make(SHARK, geo, '#5b6b78', '#e6ebee', sharkOpts[i]);
    }
  }

  update(dt, env) {
    // Big animals keep their calm pace; storms make them a bit faster.
    const pace = 1 + env.current.storm * 0.3;
    for (const s of this.swimmers) s.update(dt, pace);
  }

  /** Positions fish should flee from. */
  predators() {
    return this.swimmers.map((s) => ({ pos: s.pos, radius: s.length * (s.kind === SHARK ? 0.9 : 0.7) }));
  }

  /** Points where whales break the surface (for ripples). */
  surfacePoints() {
    const points = [];
    for (const s of this.swimmers) {
      if (s.kind !== WHALE) continue;
      const back = s.pos.y + s.length * 0.1;
      if (back > CUBE.waterLevel - 0.1) {
        points.push({ x: s.pos.x + s.forward.x * s.length * 0.25, z: s.pos.z + s.forward.z * s.length * 0.25, strength: (back - (CUBE.waterLevel - 0.1)) * 0.25 });
      }
    }
    return points;
  }

  dispose() {
    for (const s of this.swimmers) s.material.dispose();
    for (const g of this.geometries) g.dispose();
  }
}
