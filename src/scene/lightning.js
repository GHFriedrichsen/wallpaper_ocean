import * as THREE from 'three';

// Bolts live in screen space (x in -aspect..aspect, y in -1..1) because they
// belong to the sky backdrop, which is drawn from its own virtual camera.
const VERT = /* glsl */ `
uniform float uAspect;
attribute float aCore;
varying float vCore;
void main() {
  vCore = aCore;
  gl_Position = vec4(position.x / uAspect, position.y, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uIntensity;
varying float vCore;
void main() {
  vec3 col = mix(vec3(0.55, 0.65, 1.0), vec3(1.0), vCore);
  gl_FragColor = vec4(col * uIntensity, uIntensity * mix(0.35, 1.0, vCore));
}
`;

/** Builds a jagged bolt (with branches) as flat screen-space ribbons. */
function boltGeometry(start, end) {
  const positions = [];
  const cores = [];

  const ribbon = (points, width) => {
    for (const [w, core] of [[width * 6, 0], [width, 1]]) {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * w;
        const ny = (dx / len) * w;
        const quad = [
          [a.x - nx, a.y - ny, a.z], [a.x + nx, a.y + ny, a.z], [b.x + nx, b.y + ny, b.z],
          [a.x - nx, a.y - ny, a.z], [b.x + nx, b.y + ny, b.z], [b.x - nx, b.y - ny, b.z],
        ];
        quad.forEach((p) => { positions.push(...p); cores.push(core); });
      }
    }
  };

  const subdivide = (a, b, depth, spread) => {
    let pts = [a, b];
    for (let d = 0; d < depth; d++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const mid = pts[i].clone().lerp(pts[i + 1], 0.5);
        mid.x += (Math.random() - 0.5) * spread;
        mid.y += (Math.random() - 0.5) * spread * 0.25;
        next.push(mid, pts[i + 1]);
      }
      pts = next;
      spread *= 0.55;
    }
    return pts;
  };

  const main = subdivide(start, end, 6, 0.5);
  ribbon(main, 0.0025);
  const branches = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < branches; i++) {
    const from = main[Math.floor(main.length * (0.15 + Math.random() * 0.5))];
    const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.25 - Math.random() * 0.4, 0));
    ribbon(subdivide(from, to, 4, 0.2), 0.0014);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aCore', new THREE.Float32BufferAttribute(cores, 1));
  return geo;
}

/** Random lightning strikes in the background during storms; drives env.flash. */
export class Lightning {
  constructor() {
    this.group = new THREE.Group();
    this.material = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0 }, uAspect: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      // Not "transparent" so it is drawn with the sky, before the cube covers it.
      transparent: false,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide, // ribbon winding depends on the bolt direction
      blending: THREE.AdditiveBlending,
    });
    this.bolt = null;
    this.timer = 3;
    this.life = 0;
    this.flickers = [];
  }

  strike(env) {
    if (this.bolt) {
      this.group.remove(this.bolt);
      this.bolt.geometry.dispose();
    }
    // Strike away from the cube in the middle of the screen, ending at the horizon.
    const aspect = this.material.uniforms.uAspect.value;
    const side = Math.random() < 0.5 ? -1 : 1;
    const minX = Math.min(0.62, aspect * 0.5);
    const x = side * (minX + Math.random() * Math.max(0.05, aspect - minX - 0.08));
    const start = new THREE.Vector3(x, 1.05, 0);
    const end = new THREE.Vector3(x + (Math.random() - 0.5) * 0.5, -0.72 - Math.random() * 0.06, 0);
    this.bolt = new THREE.Mesh(boltGeometry(start, end), this.material);
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = -5;
    this.group.add(this.bolt);
    this.life = 0;
    // A real strike flickers a few times.
    this.flickers = [0, 0.08 + Math.random() * 0.05, 0.2 + Math.random() * 0.1];
    if (Math.random() < 0.5) this.flickers.push(0.38 + Math.random() * 0.1);
    env.flash = 1;
  }

  update(dt, env, aspect) {
    this.material.uniforms.uAspect.value = aspect;
    const storm = env.current.storm;
    if (storm > 0.3) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.strike(env);
        this.timer = (2.5 + Math.random() * 9) / storm;
      }
    }

    if (!this.bolt) return;
    this.life += dt;
    let intensity = 0;
    for (const t of this.flickers) {
      const age = this.life - t;
      if (age >= 0) intensity = Math.max(intensity, Math.exp(-age * 14));
    }
    for (const t of this.flickers) {
      if (this.life >= t && this.life - dt < t) env.flash = Math.max(env.flash, 0.7 + Math.random() * 0.3);
    }
    this.material.uniforms.uIntensity.value = intensity;
    if (this.life > 1.2) {
      this.group.remove(this.bolt);
      this.bolt.geometry.dispose();
      this.bolt = null;
    }
  }

  dispose() {
    if (this.bolt) this.bolt.geometry.dispose();
    this.material.dispose();
  }
}
