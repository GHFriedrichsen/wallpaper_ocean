import * as THREE from 'three';
import { CUBE } from '../config.js';
import { ENV_UNIFORMS } from './glsl.js';

const HALF = CUBE.size / 2;
const BOUNDS = {
  min: new THREE.Vector3(-HALF + 0.14, CUBE.sandTop + 0.12, -HALF + 0.14),
  max: new THREE.Vector3(HALF - 0.14, CUBE.waterLevel - 0.14, HALF - 0.14),
};

const COLORS = ['#ff7a1a', '#ffd23f', '#2bb3ff', '#ff4f6d', '#9b6bff', '#f4f4f4', '#28d9a0', '#ff9d5c'];

const VERT = /* glsl */ `
${ENV_UNIFORMS}
attribute float aSwim;
attribute float aGlow;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vColor;
varying float vGlow;
void main() {
  vec3 p = position;
  // Body wave: stronger towards the tail.
  float tail = clamp((0.25 - p.x) / 0.75, 0.0, 1.0);
  p.z += sin(aSwim - p.x * 7.0) * 0.09 * tail * tail;
  vLocal = position;
  vColor = instanceColor;
  vGlow = aGlow;
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
${ENV_UNIFORMS}
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vColor;
varying float vGlow;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 base = vColor;
  // Lighter belly, a couple of stripes and an eye.
  base = mix(base, vec3(0.95), smoothstep(0.0, -0.12, vLocal.y) * 0.6);
  float stripe = smoothstep(0.02, 0.0, abs(fract(vLocal.x * 4.0 + 0.3) - 0.5) - 0.06);
  base = mix(base, vec3(1.0), stripe * 0.35 * step(vLocal.x, 0.3));
  float eye = smoothstep(0.035, 0.02, length(vLocal.xy - vec2(0.36, 0.035)));
  base = mix(base, vec3(0.02), eye);

  float depth = clamp((uLevel - vWorld.y) / 1.1, 0.0, 1.0);
  vec3 light = uAmbient * 0.7 + uSunColor * (0.25 + 0.6 * max(dot(N, uSunDir), 0.0)) * (1.0 - depth * 0.6);
  vec3 col = base * light;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uShallowColor * rim * 0.4;
  // At night the fish glow softly.
  col += vColor * (0.25 + rim) * uNight * 0.5 * vGlow;
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.2;
  col = mix(col, uDeepColor * light, depth * 0.35);
  gl_FragColor = vec4(col, 1.0);
}
`;

function fishGeometry() {
  const parts = [];

  const body = new THREE.SphereGeometry(1, 18, 12);
  body.scale(0.38, 0.15, 0.065);
  body.translate(0.07, 0, 0);
  parts.push(body.toNonIndexed());

  const fins = new THREE.BufferGeometry();
  const finPositions = [
    // tail
    -0.26, 0, 0, -0.5, 0.14, 0, -0.44, 0, 0,
    -0.26, 0, 0, -0.44, 0, 0, -0.5, -0.14, 0,
    // dorsal fin
    0.18, 0.13, 0, -0.12, 0.13, 0, -0.04, 0.24, 0,
    // belly fin
    0.05, -0.12, 0, -0.08, -0.12, 0, -0.06, -0.19, 0,
  ];
  fins.setAttribute('position', new THREE.Float32BufferAttribute(finPositions, 3));
  fins.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(finPositions.length / 3).fill([0, 0, 1]).flat(), 3));
  parts.push(fins);

  const positions = [];
  const normals = [];
  for (const g of parts) {
    positions.push(...g.attributes.position.array);
    normals.push(...g.attributes.normal.array);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}

/** A small school of fish with simple steering (wander, flocking, walls, fleeing the mouse). */
export class Fish {
  constructor(env, count) {
    this.count = count;
    this.group = new THREE.Group();
    if (count === 0) return;

    const geo = fishGeometry();
    this.swim = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.swim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSwim', this.swim);
    const glow = new Float32Array(count).map(() => 0.4 + Math.random() * 0.6);
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: { ...env.uniforms, uLevel: { value: CUBE.waterLevel } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    this.fish = [];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const pos = new THREE.Vector3(
        THREE.MathUtils.lerp(BOUNDS.min.x, BOUNDS.max.x, Math.random()),
        THREE.MathUtils.lerp(BOUNDS.min.y, BOUNDS.max.y, Math.random()),
        THREE.MathUtils.lerp(BOUNDS.min.z, BOUNDS.max.z, Math.random()),
      );
      const angle = Math.random() * Math.PI * 2;
      this.fish.push({
        pos,
        vel: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(0.2),
        size: 0.17 + Math.random() * 0.11,
        wanderSeed: Math.random() * 100,
        cruise: 0.14 + Math.random() * 0.1,
        swim: Math.random() * 10,
      });
      color.set(COLORS[i % COLORS.length]);
      this.mesh.setColorAt(i, color);
    }
    this.mesh.instanceColor.needsUpdate = true;

    this.tmp = { steer: new THREE.Vector3(), diff: new THREE.Vector3(), m: new THREE.Matrix4(), f: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), s: new THREE.Vector3() };
  }

  /** threat: { x, z } in world space where the mouse touches the water, or null. */
  update(dt, time, env, threat) {
    if (!this.count) return;
    const { steer, diff, m, f, r, u, s } = this.tmp;
    const up = new THREE.Vector3(0, 1, 0);
    const storm = env.current.storm;
    const night = env.uniforms.uNight.value;
    // In storms the fish stay deep, at night they slow down.
    const preferredY = THREE.MathUtils.lerp(-0.1, BOUNDS.min.y + 0.15, storm);
    const pace = (1 - night * 0.35) * (1 + storm * 0.4);

    for (let i = 0; i < this.count; i++) {
      const fish = this.fish[i];
      steer.set(0, 0, 0);

      // Wander.
      const w = time * 0.3 + fish.wanderSeed;
      steer.x += Math.sin(w * 1.3) * 0.12;
      steer.z += Math.cos(w * 0.9) * 0.12;
      steer.y += Math.sin(w * 0.7) * 0.04 + (preferredY - fish.pos.y) * 0.15;

      // Flocking with neighbours.
      for (let j = 0; j < this.count; j++) {
        if (j === i) continue;
        const other = this.fish[j];
        diff.subVectors(fish.pos, other.pos);
        const d = diff.length();
        if (d < 0.25 && d > 1e-5) steer.addScaledVector(diff, (0.25 - d) * 6 / d);
        else if (d < 0.5) {
          steer.addScaledVector(other.vel, 0.08);
          steer.addScaledVector(diff, -0.04);
        }
      }

      // Keep away from the glass, sand and surface.
      for (const axis of ['x', 'y', 'z']) {
        const lo = fish.pos[axis] - BOUNDS.min[axis];
        const hi = BOUNDS.max[axis] - fish.pos[axis];
        if (lo < 0.2) steer[axis] += (0.2 - lo) * 6;
        if (hi < 0.2) steer[axis] -= (0.2 - hi) * 6;
      }

      // Flee the mouse when it disturbs the water nearby.
      let flee = 0;
      if (threat) {
        diff.set(fish.pos.x - threat.x, 0, fish.pos.z - threat.z);
        const d = diff.length();
        const depth = CUBE.waterLevel - fish.pos.y;
        if (d < 0.55 && depth < 0.8) {
          flee = (0.55 - d) / 0.55;
          steer.addScaledVector(diff.normalize(), flee * 3);
          steer.y -= flee * 1.2;
        }
      }

      fish.vel.addScaledVector(steer, dt);
      const maxSpeed = (fish.cruise * 1.8 + flee * 0.9) * pace;
      const minSpeed = fish.cruise * 0.6 * pace;
      const speed = THREE.MathUtils.clamp(fish.vel.length(), minSpeed, maxSpeed);
      fish.vel.setLength(speed);
      fish.vel.y = THREE.MathUtils.clamp(fish.vel.y, -speed * 0.5, speed * 0.5);
      fish.pos.addScaledVector(fish.vel, dt);
      fish.pos.clamp(BOUNDS.min, BOUNDS.max);

      fish.swim += dt * (6 + speed * 30);
      this.swim.array[i] = fish.swim;

      f.copy(fish.vel).normalize();
      r.crossVectors(f, up).normalize();
      u.crossVectors(r, f);
      m.makeBasis(f, u, s.crossVectors(f, u));
      m.scale(s.setScalar(fish.size));
      m.setPosition(fish.pos);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.swim.needsUpdate = true;
  }

  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
