import * as THREE from 'three';

const DEG = Math.PI / 180;
const WAVE_COUNT = 6;

// Sky/water palette keyed by sun elevation in degrees.
const PALETTE = [
  { elev: -20, zenith: '#0a1530', horizon: '#18264c', sun: '#000000', ambient: '#6c84bc', deep: '#05194a', shallow: '#1a4fa6' },
  { elev: -9,  zenith: '#0c1640', horizon: '#2a3466', sun: '#000000', ambient: '#6a7cb4', deep: '#05194a', shallow: '#1a4fa2' },
  { elev: -3,  zenith: '#1f2c63', horizon: '#b0587a', sun: '#ff5a30', ambient: '#7a70a0', deep: '#0a2458', shallow: '#2a64ba' },
  { elev: 2,   zenith: '#35589a', horizon: '#f38a4c', sun: '#ff8a48', ambient: '#9a90a8', deep: '#0a2860', shallow: '#2f6ec6' },
  { elev: 9,   zenith: '#3a72c0', horizon: '#f5c38c', sun: '#ffd09a', ambient: '#8f9ab0', deep: '#02205a', shallow: '#0f5cc4' },
  { elev: 25,  zenith: '#2f6fd0', horizon: '#a9d2f0', sun: '#fff2dc', ambient: '#a8c0d8', deep: '#011f5e', shallow: '#0866d8' },
  { elev: 60,  zenith: '#2766d2', horizon: '#c2e2f8', sun: '#ffffff', ambient: '#b8d0e6', deep: '#01226a', shallow: '#0a6fe6' },
].map((k) => ({
  elev: k.elev,
  zenith: new THREE.Color(k.zenith),
  horizon: new THREE.Color(k.horizon),
  sun: new THREE.Color(k.sun),
  ambient: new THREE.Color(k.ambient),
  deep: new THREE.Color(k.deep),
  shallow: new THREE.Color(k.shallow),
}));

const STORM_GREY = new THREE.Color('#3a4250');
const CLOUD_GREY = new THREE.Color('#8f9aa6');

/**
 * Holds the smoothed weather state and the uniforms shared by every material.
 * Weather changes ease in over several seconds so transitions look natural.
 */
export class Environment {
  constructor() {
    this.current = { cloud: 0.2, rain: 0, snow: 0, storm: 0, fog: 0, wind: 4, windAngle: 0 };
    this.target = { ...this.current };
    this.sunElevation = 30 * DEG;
    this.targetSunElevation = this.sunElevation;
    this.sunAzimuthProgress = 0.4;
    this.targetSunAzimuthProgress = 0.4;
    this.wavePhases = new Float32Array(WAVE_COUNT);
    this.flash = 0;

    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color() },
      uDeepColor: { value: new THREE.Color() },
      uShallowColor: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uCloud: { value: 0 },
      uRain: { value: 0 },
      uSnow: { value: 0 },
      uStorm: { value: 0 },
      uFog: { value: 0 },
      uNight: { value: 0 },
      uFlash: { value: 0 },
      uWind: { value: 0 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uWaves: { value: Array.from({ length: WAVE_COUNT }, () => new THREE.Vector4()) },
      uWavePhase: { value: this.wavePhases },
      uWaveSharp: { value: 1 },
    };
  }

  /** targets: output of targetsFromReport / targetsFromOverride. */
  setWeather(targets) {
    Object.assign(this.target, {
      cloud: targets.cloud,
      rain: targets.rain,
      snow: targets.snow,
      storm: targets.storm,
      fog: targets.fog,
      wind: targets.wind,
      // Meteorological direction is where wind comes FROM; waves travel the other way.
      // North is -Z (into the screen), east is +X.
      windAngle: (targets.windDirection + 180) * DEG,
    });
  }

  /** phase: { isDay, progress } from solarPhase / phaseFromOverride. */
  setSolarPhase(phase, immediate = false) {
    const p = Math.min(1, Math.max(0, phase.progress));
    const arc = Math.sin(Math.PI * p);
    this.targetSunElevation = phase.isDay
      ? (-1.5 + arc * 63) * DEG
      : (-1.5 - arc * 40) * DEG;
    // At night the "azimuth" keeps moving so the moon crosses the sky too.
    this.targetSunAzimuthProgress = phase.isDay ? p : 1 - p;
    if (immediate) {
      this.sunElevation = this.targetSunElevation;
      this.sunAzimuthProgress = this.targetSunAzimuthProgress;
    }
  }

  snap() {
    Object.assign(this.current, this.target);
  }

  get windFactor() {
    return Math.min(1, this.current.wind / 20);
  }

  update(dt, time) {
    const c = this.current;
    const tg = this.target;
    const k = 1 - Math.exp(-dt / 4); // ~4 s time constant
    for (const key of ['cloud', 'rain', 'snow', 'storm', 'fog', 'wind']) {
      c[key] += (tg[key] - c[key]) * k;
    }
    let dAngle = tg.windAngle - c.windAngle;
    dAngle = Math.atan2(Math.sin(dAngle), Math.cos(dAngle));
    c.windAngle += dAngle * k;

    const ks = 1 - Math.exp(-dt / 3);
    this.sunElevation += (this.targetSunElevation - this.sunElevation) * ks;
    this.sunAzimuthProgress += (this.targetSunAzimuthProgress - this.sunAzimuthProgress) * ks;

    this.flash = Math.max(0, this.flash - dt * 3);

    this.updateUniforms(dt, time);
  }

  updateUniforms(dt, time) {
    const u = this.uniforms;
    const c = this.current;
    u.uTime.value = time;

    // Sun travels from east (-X) to west (+X), a little behind the cube so it shows in the sky.
    const e = this.sunElevation;
    const az = Math.PI * this.sunAzimuthProgress;
    const horiz = new THREE.Vector2(-Math.cos(az), -0.75).normalize();
    u.uSunDir.value.set(horiz.x * Math.cos(e), Math.sin(e), horiz.y * Math.cos(e)).normalize();
    // Keep the moon in the visible band of sky above the cube.
    const moonE = 0.66 + 0.06 * Math.sin(az);
    u.uMoonDir.value.set(horiz.x * Math.cos(moonE) * 0.9, Math.sin(moonE), horiz.y * Math.cos(moonE)).normalize();

    samplePalette(e / DEG, u);

    const night = smoothstep(-2, -12, e / DEG);
    u.uNight.value = night;

    // Clouds and storms desaturate and darken everything.
    const greyAmount = c.cloud * 0.55 + c.storm * 0.35;
    const grey = CLOUD_GREY.clone().lerp(STORM_GREY, c.storm).multiplyScalar(1 - night * 0.85);
    for (const key of ['uZenith', 'uHorizon', 'uAmbient']) {
      u[key].value.lerp(grey, greyAmount * (key === 'uAmbient' ? 0.5 : 1));
    }
    // Clouds dull the water, but it stays a deep ocean blue.
    u.uDeepColor.value.lerp(new THREE.Color('#0c1a3a').multiplyScalar(1 - night * 0.6), greyAmount * 0.4);
    u.uShallowColor.value.lerp(new THREE.Color('#2a4f86').multiplyScalar(1 - night * 0.6), greyAmount * 0.45);
    u.uSunColor.value.multiplyScalar(1 - Math.min(0.92, c.cloud * 0.75 + c.storm * 0.4));
    u.uAmbient.value.multiplyScalar(1 - c.storm * 0.35);
    // Never let the cube disappear completely in dark scenes.
    const amb = u.uAmbient.value;
    amb.setRGB(Math.max(amb.r, 0.32), Math.max(amb.g, 0.37), Math.max(amb.b, 0.48));

    // Lightning lights up the whole scene for a moment.
    const flash = this.flash;
    if (flash > 0) {
      const f = new THREE.Color('#dfe6ff');
      u.uZenith.value.lerp(f, flash * 0.5);
      u.uHorizon.value.lerp(f, flash * 0.6);
      u.uAmbient.value.lerp(f, flash * 0.7);
    }
    u.uFlash.value = flash;

    u.uFogColor.value.copy(u.uHorizon.value).lerp(new THREE.Color('#9aa4ad').multiplyScalar(1 - night * 0.85), 0.5);
    u.uCloud.value = c.cloud;
    u.uRain.value = c.rain;
    u.uSnow.value = c.snow;
    u.uStorm.value = c.storm;
    u.uFog.value = c.fog;

    const wf = this.windFactor;
    u.uWind.value = wf;
    u.uWindDir.value.set(Math.sin(c.windAngle), -Math.cos(c.windAngle));
    this.updateWaves(dt, wf, c.storm);
  }

  updateWaves(dt, wf, storm) {
    const u = this.uniforms;
    const base = c2v(u.uWindDir.value);
    const angles = [0, 0.55, -0.4, 0.9, -0.85, 0.2];
    const lengths = [1.7, 1.15, 0.82, 0.6, 0.43, 0.3];
    const weights = [1.0, 0.75, 0.6, 0.45, 0.35, 0.25];
    const amp = 0.008 + 0.06 * Math.pow(wf, 1.2) + 0.04 * storm;
    const stretch = 0.75 + 0.5 * wf;
    const speed = 1 + 0.3 * storm;
    for (let i = 0; i < WAVE_COUNT; i++) {
      const a = base + angles[i] * (1 - 0.4 * wf);
      const lambda = lengths[i] * stretch;
      const kWave = (2 * Math.PI) / lambda;
      const omega = Math.sqrt(0.25 * kWave) * speed;
      this.wavePhases[i] = (this.wavePhases[i] + omega * dt) % (Math.PI * 2000);
      u.uWaves.value[i].set(Math.cos(a), Math.sin(a), kWave, amp * weights[i] * (lambda / 1.7) * 1.25);
    }
    u.uWaveSharp.value = 1 + 1.6 * Math.min(1, wf + storm * 0.5);
  }
}

function c2v(v) {
  return Math.atan2(v.y, v.x);
}

function samplePalette(elevDeg, u) {
  let i = 0;
  while (i < PALETTE.length - 2 && elevDeg > PALETTE[i + 1].elev) i++;
  const a = PALETTE[i];
  const b = PALETTE[i + 1];
  const t = Math.min(1, Math.max(0, (elevDeg - a.elev) / (b.elev - a.elev)));
  u.uZenith.value.copy(a.zenith).lerp(b.zenith, t);
  u.uHorizon.value.copy(a.horizon).lerp(b.horizon, t);
  u.uSunColor.value.copy(a.sun).lerp(b.sun, t);
  u.uAmbient.value.copy(a.ambient).lerp(b.ambient, t);
  u.uDeepColor.value.copy(a.deep).lerp(b.deep, t);
  u.uShallowColor.value.copy(a.shallow).lerp(b.shallow, t);
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
