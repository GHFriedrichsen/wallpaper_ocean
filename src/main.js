import * as THREE from 'three';
import { CUBE, QUALITY } from './config.js';
import { createProperties } from './properties.js';
import { resolveLanguage, setLanguage } from './i18n.js';
import { Environment } from './environment.js';
import { Hud } from './hud.js';
import { geocode, fetchForecast, loadCachedReport, CityNotFoundError } from './weather/api.js';
import { targetsFromReport, targetsFromOverride, solarPhase, phaseFromOverride } from './weather/conditions.js';
import { RippleSim } from './scene/rippleSim.js';
import { Ocean } from './scene/ocean.js';
import { Tank } from './scene/tank.js';
import { Fish } from './scene/fish.js';
import { MarineLife } from './scene/marine.js';
import { Sky } from './scene/sky.js';
import { Precipitation } from './scene/precipitation.js';
import { Lightning } from './scene/lightning.js';
import { ENV_UNIFORMS } from './scene/glsl.js';

// All colors are authored in display space; skip color conversions entirely.
THREE.ColorManagement.enabled = false;

const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.getElementById('status').textContent = 'WebGL is not available.';
  document.getElementById('status').hidden = false;
  throw err;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
const env = new Environment();
const hud = new Hud();
const props = createProperties(onPropertiesChanged);
const settings = props.values;

// ---------------------------------------------------------------------------
// World (rebuilt when the quality changes)

let world = null;
let fish = null;
let marine = null;
let quality = QUALITY[settings.quality] || QUALITY.high;

function pixelRatio() {
  return Math.min(2, (window.devicePixelRatio || 1) * quality.pixelRatio);
}

function buildWorld() {
  if (world) {
    for (const part of Object.values(world)) {
      if (part.group || part.mesh) scene.remove(part.group || part.mesh);
      part.dispose();
    }
  }
  quality = QUALITY[settings.quality] || QUALITY.high;
  renderer.setPixelRatio(pixelRatio());

  const sim = new RippleSim(renderer, quality.simSize);
  world = {
    sim,
    sky: new Sky(env, quality),
    tank: new Tank(env, quality),
    ocean: new Ocean(env, sim, quality.waterSegments),
    precipitation: new Precipitation(env, quality, pixelRatio()),
    lightning: new Lightning(),
    overlay: createOverlay(),
  };
  for (const part of Object.values(world)) {
    if (part.group || part.mesh) scene.add(part.group || part.mesh);
  }
}

function buildLife() {
  for (const old of [fish, marine]) {
    if (!old) continue;
    scene.remove(old.group);
    old.dispose();
  }
  const count = (v) => Math.max(0, Math.round(v));
  fish = new Fish(env, count(settings.fishcount));
  marine = new MarineLife(env, count(settings.whalecount), count(settings.sharkcount));
  scene.add(fish.group, marine.group);
}

// Full-screen layer for mist, lightning flashes and a soft vignette over everything.
function createOverlay() {
  const material = new THREE.ShaderMaterial({
    uniforms: env.uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${ENV_UNIFORMS}
      varying vec2 vUv;
      void main() {
        float mist = uFog * (0.22 + 0.25 * (1.0 - vUv.y)) + uRain * 0.06;
        float vignette = smoothstep(0.45, 1.0, length(vUv - 0.5) * 1.35) * (0.25 + uStorm * 0.25);
        vec3 col = mix(uFogColor, vec3(1.0), uFlash * 0.6);
        float alpha = clamp(mist + uFlash * 0.18, 0.0, 1.0);
        col = mix(col, vec3(0.0), vignette / max(alpha + vignette, 1e-3));
        gl_FragColor = vec4(col, clamp(alpha + vignette, 0.0, 1.0));
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 100;
  return { mesh, dispose: () => { mesh.geometry.dispose(); material.dispose(); } };
}

// ---------------------------------------------------------------------------
// Weather

let report = loadCachedReport();
let refreshTimer = null;
let fetchToken = 0;

function applyWeather() {
  const override = settings.weatheroverride !== 'auto';
  let targets;
  if (override) targets = targetsFromOverride(settings.weatheroverride, report?.windDirection ?? 90);
  else if (report) targets = targetsFromReport(report);
  else targets = targetsFromOverride('mainlyClear');
  env.setWeather(targets);
  hud.update({ report, key: targets.key, override, units: settings.units });
}

function applySolarPhase(immediate = false) {
  const phase = phaseFromOverride(settings.timeoverride)
    || solarPhase(Date.now() / 1000, report?.sunrise, report?.sunset);
  env.setSolarPhase(phase, immediate);
  hud.update({ night: !phase.isDay });
}

async function refreshWeather() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshWeather, Math.max(5, settings.refreshminutes) * 60 * 1000);
  const token = ++fetchToken;
  const city = settings.city.trim();
  if (!city) {
    hud.update({ message: settings.weatheroverride === 'auto' ? 'noCity' : null });
    return;
  }
  if (!report) hud.update({ message: 'loading' });
  try {
    const place = await geocode(city, resolveLanguage(settings.uilanguage, props.general.weLanguage));
    const fresh = await fetchForecast(place);
    if (token !== fetchToken) return;
    report = fresh;
    hud.update({ message: null });
  } catch (err) {
    if (token !== fetchToken) return;
    console.warn('[ocean-cube] weather update failed:', err);
    hud.update({ message: err instanceof CityNotFoundError ? 'cityNotFound' : 'offline' });
  }
  applyWeather();
  applySolarPhase();
}

// ---------------------------------------------------------------------------
// Properties

function applyLanguage() {
  setLanguage(resolveLanguage(settings.uilanguage, props.general.weLanguage));
  hud.render();
}

let paused = false;

function onPropertiesChanged(keys) {
  const has = (...k) => k.some((key) => keys.includes(key));
  if (has('uilanguage')) applyLanguage();
  if (has('quality')) {
    buildWorld();
    resize();
  }
  if (has('fishcount', 'whalecount', 'sharkcount')) buildLife();
  if (has('showhud', 'hudposition')) hud.setVisible(settings.showhud, settings.hudposition);
  if (has('weatheroverride', 'units')) applyWeather();
  if (has('timeoverride')) applySolarPhase();
  if (has('city', 'refreshminutes')) {
    if (has('city')) report = null;
    refreshWeather();
  } else if (has('uilanguage')) {
    refreshWeather();
  }
  if (has('paused')) {
    paused = props.general.paused;
    if (!paused) {
      lastTime = performance.now();
      requestAnimationFrame(frame);
    }
  }
}

// ---------------------------------------------------------------------------
// Mouse: parallax and ripples

const pointer = { ndc: new THREE.Vector2(), smooth: new THREE.Vector2(), moved: false, down: false, active: false };
const raycaster = new THREE.Raycaster();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUBE.waterLevel);
const hit = new THREE.Vector3();
let lastWater = null;
let threat = null;
let threatTimer = 0;

function onPointerMove(e) {
  pointer.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointer.moved = true;
  pointer.active = true;
}
window.addEventListener('mousemove', onPointerMove);
window.addEventListener('mousedown', (e) => { onPointerMove(e); pointer.down = true; });
document.addEventListener('mouseleave', () => { pointer.active = false; lastWater = null; });

// Zoom: mouse wheel or pinch. The camera always stays outside the cube and above
// the water, so zooming never goes underwater.
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.4;
const zoom = { target: 1, value: 1 };
function zoomBy(factor) {
  zoom.target = THREE.MathUtils.clamp(zoom.target * factor, ZOOM_MIN, ZOOM_MAX);
}
window.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomBy(Math.exp(-e.deltaY * 0.0012));
}, { passive: false });

// Touch (phones/tablets): tap splashes, dragging draws ripples and steers the camera,
// two fingers pinch to zoom. Only touches on the scene itself count, so on-page
// controls keep working.
let pinchDistance = 0;
const touchSpread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  lastWater = null;
  if (e.touches.length >= 2) {
    pinchDistance = touchSpread(e.touches);
    pointer.down = false;
    return;
  }
  onPointerMove(e.touches[0]);
  pointer.down = true;
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length >= 2) {
    const d = touchSpread(e.touches);
    if (pinchDistance > 0) zoomBy(d / pinchDistance);
    pinchDistance = d;
    return;
  }
  onPointerMove(e.touches[0]);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) pinchDistance = 0;
  if (e.touches.length === 0) {
    pointer.active = false;
    lastWater = null;
  }
});

function waterPoint() {
  raycaster.setFromCamera(pointer.ndc, camera);
  if (!raycaster.ray.intersectPlane(waterPlane, hit)) return null;
  const half = CUBE.size / 2;
  if (Math.abs(hit.x) > half || Math.abs(hit.z) > half) return null;
  return { x: hit.x, z: hit.z };
}

function toUv(p) {
  return [p.x / CUBE.size + 0.5, p.z / CUBE.size + 0.5];
}

function handleMouseRipples(dt) {
  threatTimer -= dt;
  if (threatTimer <= 0) threat = null;
  if (!settings.mouseripples || !(pointer.moved || pointer.down)) return;

  const p = waterPoint();
  if (p) {
    const [u, v] = toUv(p);
    if (pointer.down) {
      world.sim.addDrop(u, v, 0.07, 0.08);
    } else if (lastWater) {
      const [lu, lv] = toUv(lastWater);
      const dist = Math.hypot(u - lu, v - lv);
      const steps = Math.min(6, Math.ceil(dist / 0.012));
      const strength = 0.012 + Math.min(0.025, (dist / Math.max(dt, 1e-3)) * 0.01);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        world.sim.addDrop(lu + (u - lu) * k, lv + (v - lv) * k, 0.03, strength / Math.sqrt(steps));
      }
    }
    threat = p;
    threatTimer = 1.5;
  }
  lastWater = p;
  pointer.moved = false;
  pointer.down = false;
}

// Whales gliding just under the surface push the water up.
let whaleTimer = 0;
function handleWhaleRipples(dt) {
  whaleTimer -= dt;
  if (whaleTimer > 0) return;
  whaleTimer = 0.2;
  for (const p of marine.surfacePoints()) {
    const [u, v] = toUv(p);
    world.sim.addDrop(u, v, 0.07, Math.min(0.03, p.strength));
  }
}

let rainAccumulator = 0;
function handleRainRipples(dt) {
  const c = env.current;
  const rate = c.rain * 140 + c.storm * 60 + c.snow * 10;
  rainAccumulator += rate * dt;
  while (rainAccumulator >= 1) {
    rainAccumulator -= 1;
    const big = c.snow > c.rain ? 0.4 : 1;
    world.sim.addDrop(Math.random(), Math.random(), 0.008 + Math.random() * 0.01, (0.003 + Math.random() * 0.005) * big);
  }
}

// ---------------------------------------------------------------------------
// Camera

const lookTarget = new THREE.Vector3(0, -0.05, 0);

function updateCamera(dt, time) {
  const k = 1 - Math.exp(-dt * 2.5);
  const target = pointer.active ? pointer.ndc : new THREE.Vector2(0, 0);
  pointer.smooth.lerp(target, k);
  const strength = settings.parallax / 100;

  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  // Pull back on narrow (portrait) screens so the cube still fits the width.
  const fit = aspect < 1.3 ? Math.pow(1.3 / aspect, 0.7) : 1;
  zoom.value += (zoom.target - zoom.value) * (1 - Math.exp(-dt * 6));
  const MIN_DISTANCE = 3.6; // the cube's corners are ~1.75 from its center
  const distance = Math.max(MIN_DISTANCE, (7.2 * fit) / (Math.max(0.3, settings.cubescale / 100) * zoom.value));
  const azimuth = pointer.smooth.x * 0.45 * strength + Math.sin(time * 0.05) * 0.06;
  const elevation = 0.38 - pointer.smooth.y * 0.14 * strength + Math.sin(time * 0.037) * 0.02;
  camera.position.set(
    Math.sin(azimuth) * Math.cos(elevation) * distance,
    Math.sin(elevation) * distance,
    Math.cos(azimuth) * Math.cos(elevation) * distance,
  );
  camera.lookAt(lookTarget);
}

function resize() {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
  world?.precipitation.setPixelRatio(pixelRatio());
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Main loop

let lastTime = performance.now();
let lastRender = 0;
let elapsed = 0;
let solarTimer = 0;

function frameInterval() {
  const limit = settings.fpslimit > 0 ? settings.fpslimit : props.general.fps || 0;
  return limit > 0 ? 1000 / limit : 0;
}

function frame(now) {
  if (paused) return;
  requestAnimationFrame(frame);

  const interval = frameInterval();
  if (interval && now - lastRender < interval - 1) return;
  lastRender = interval ? now - ((now - lastRender) % interval) : now;

  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;

  solarTimer -= dt;
  if (solarTimer <= 0) {
    applySolarPhase();
    solarTimer = 20;
  }

  env.update(dt, elapsed);
  updateCamera(dt, elapsed);
  handleMouseRipples(dt);
  handleRainRipples(dt);
  handleWhaleRipples(dt);

  world.sim.update(dt);
  world.ocean.update();
  world.tank.update(env);
  world.sky.update(dt, camera, env);
  world.precipitation.update(dt, env);
  world.lightning.update(dt, env, camera.aspect, world.sky.horizonNdc);
  marine.update(dt, env);
  fish.update(dt, elapsed, env, threat, marine.predators());

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Start

applyLanguage();
buildWorld();
buildLife();
resize();
hud.setVisible(settings.showhud, settings.hudposition);
applyWeather();
applySolarPhase(true);
env.snap();
refreshWeather();
requestAnimationFrame(frame);

// Handy for testing in the browser console.
window.oceanCube = { env, settings, renderer, zoom, get world() { return world; }, getMarine: () => marine, refreshWeather, applyWeather, onPropertiesChanged };
