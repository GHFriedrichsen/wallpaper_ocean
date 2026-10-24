import * as THREE from 'three';

const MAX_DROPS = 24;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DROP_FRAG = /* glsl */ `
#define MAX_DROPS ${MAX_DROPS}
uniform sampler2D uState;
uniform vec4 uDrops[MAX_DROPS]; // uv.xy, radius, strength
uniform int uDropCount;
varying vec2 vUv;
void main() {
  vec4 info = texture2D(uState, vUv);
  for (int i = 0; i < MAX_DROPS; i++) {
    if (i >= uDropCount) break;
    vec4 d = uDrops[i];
    float k = max(0.0, 1.0 - length(d.xy - vUv) / d.z);
    k = 0.5 - cos(k * 3.14159265) * 0.5;
    info.r += k * d.w;
  }
  gl_FragColor = info;
}
`;

// Height field wave equation (r = height, g = velocity). Walls reflect waves,
// just like a real tank.
const STEP_FRAG = /* glsl */ `
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDamping;
varying vec2 vUv;
void main() {
  vec4 info = texture2D(uState, vUv);
  float avg = (
    texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r +
    texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r +
    texture2D(uState, vUv - vec2(0.0, uTexel.y)).r +
    texture2D(uState, vUv + vec2(0.0, uTexel.y)).r
  ) * 0.25;
  info.g += (avg - info.r) * 2.0;
  info.g *= uDamping;
  info.r += info.g;
  info.r *= 0.9995;
  gl_FragColor = info;
}
`;

/** GPU ripple simulation driven by the mouse, raindrops and fish. */
export class RippleSim {
  constructor(renderer, size) {
    this.renderer = renderer;
    this.size = size;
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.targets = [new THREE.WebGLRenderTarget(size, size, opts), new THREE.WebGLRenderTarget(size, size, opts)];
    this.index = 0;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);

    this.dropMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: DROP_FRAG,
      uniforms: {
        uState: { value: null },
        uDrops: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()) },
        uDropCount: { value: 0 },
      },
    });
    this.stepMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: STEP_FRAG,
      uniforms: {
        uState: { value: null },
        uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
        uDamping: { value: 0.993 },
      },
    });

    this.pending = [];
    this.accumulator = 0;
    this.clear();
  }

  get texture() {
    return this.targets[this.index].texture;
  }

  clear() {
    const prevTarget = this.renderer.getRenderTarget();
    const prevColor = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const t of this.targets) {
      this.renderer.setRenderTarget(t);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(prevColor, prevAlpha);
  }

  /** u, v in 0..1 across the water surface. */
  addDrop(u, v, radius, strength) {
    if (this.pending.length >= MAX_DROPS) return;
    this.pending.push([u, v, radius, strength]);
  }

  pass(material) {
    material.uniforms.uState.value = this.targets[this.index].texture;
    this.quad.material = material;
    this.index = 1 - this.index;
    this.renderer.setRenderTarget(this.targets[this.index]);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    if (this.pending.length) {
      const drops = this.dropMaterial.uniforms.uDrops.value;
      this.pending.forEach((d, i) => drops[i].set(d[0], d[1], d[2], d[3]));
      this.dropMaterial.uniforms.uDropCount.value = this.pending.length;
      this.pending.length = 0;
      this.pass(this.dropMaterial);
    }

    // Fixed time step keeps wave speed independent of the frame rate.
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    // Scale steps with resolution so ripples cross the cube at the same speed on every quality.
    const step = 256 / (90 * this.size);
    while (this.accumulator >= step) {
      this.pass(this.stepMaterial);
      this.accumulator -= step;
    }

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.dropMaterial.dispose();
    this.stepMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
