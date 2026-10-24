/**
 * Targets the scene eases toward. All intensities are 0..1, wind in m/s,
 * windDirection in degrees (meteorological: where the wind comes from).
 */
const PRESETS = {
  clear:       { cloud: 0.0,  rain: 0,    snow: 0,   storm: 0, fog: 0,   wind: 3 },
  mainlyClear: { cloud: 0.2,  rain: 0,    snow: 0,   storm: 0, fog: 0,   wind: 3 },
  partly:      { cloud: 0.45, rain: 0,    snow: 0,   storm: 0, fog: 0,   wind: 4 },
  cloudy:      { cloud: 0.9,  rain: 0,    snow: 0,   storm: 0, fog: 0.1, wind: 5 },
  fog:         { cloud: 0.8,  rain: 0,    snow: 0,   storm: 0, fog: 1,   wind: 1 },
  drizzle:     { cloud: 0.85, rain: 0.25, snow: 0,   storm: 0, fog: 0.2, wind: 4 },
  rain:        { cloud: 0.95, rain: 0.6,  snow: 0,   storm: 0, fog: 0.15, wind: 7 },
  heavyRain:   { cloud: 1.0,  rain: 1.0,  snow: 0,   storm: 0.2, fog: 0.2, wind: 10 },
  snow:        { cloud: 0.9,  rain: 0,    snow: 0.8, storm: 0, fog: 0.25, wind: 4 },
  storm:       { cloud: 1.0,  rain: 1.0,  snow: 0,   storm: 1, fog: 0.1, wind: 16 },
  windy:       { cloud: 0.35, rain: 0,    snow: 0,   storm: 0, fog: 0,   wind: 18 },
};

/** WMO weather code (used by Open-Meteo) -> preset key. */
export function conditionFromCode(code) {
  if (code === 0) return 'clear';
  if (code === 1) return 'mainlyClear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 61 || code === 66 || code === 80) return 'rain';
  if (code === 63 || code === 81) return 'rain';
  if (code === 65 || code === 67 || code === 82) return 'heavyRain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'partly';
}

/** Builds scene targets from a live report, refining presets with measured values. */
export function targetsFromReport(report) {
  const key = conditionFromCode(report.code);
  const base = PRESETS[key];
  const cloud = Math.max(base.cloud * 0.6, (report.cloudCover ?? base.cloud * 100) / 100);
  // Precipitation in mm/h: ~0.5 light, ~4 moderate, 8+ heavy.
  const measuredRain = report.rain != null ? Math.min(1, report.rain / 8) : 0;
  const rain = base.rain > 0 ? Math.max(base.rain * 0.7, measuredRain) : 0;
  const wind = report.windSpeed ?? base.wind;
  const gusts = report.windGusts ?? wind;

  return {
    key: wind >= 10 && base.storm === 0 && base.rain === 0 && base.snow === 0 ? 'windy' : key,
    cloud: clamp01(cloud),
    rain: clamp01(rain),
    snow: base.snow,
    storm: base.storm,
    fog: base.fog,
    wind: Math.max(wind, gusts * 0.6),
    windDirection: report.windDirection ?? 90,
  };
}

/** Targets for the "force weather" (test mode) property. */
export function targetsFromOverride(key, windDirection = 90) {
  const base = PRESETS[key] || PRESETS.clear;
  return { key, ...base, windDirection };
}

/**
 * Day/night phase from sunrise/sunset unix seconds.
 * Returns { isDay, progress } where progress goes 0..1 across the day or the night.
 */
export function solarPhase(nowSec, sunrise = [], sunset = []) {
  for (let i = 0; i < sunrise.length; i++) {
    if (sunset[i] && nowSec >= sunrise[i] && nowSec < sunset[i]) {
      return { isDay: true, progress: (nowSec - sunrise[i]) / (sunset[i] - sunrise[i]) };
    }
  }
  const lastSet = sunset.filter((s) => s <= nowSec).pop();
  const nextRise = sunrise.find((r) => r > nowSec);
  if (lastSet && nextRise) {
    return { isDay: false, progress: (nowSec - lastSet) / (nextRise - lastSet) };
  }
  // No usable data (offline or polar day/night): assume 06:00 - 18:00 local time.
  const d = new Date(nowSec * 1000);
  const hours = d.getHours() + d.getMinutes() / 60;
  if (hours >= 6 && hours < 18) return { isDay: true, progress: (hours - 6) / 12 };
  return { isDay: false, progress: ((hours + 6) % 24) / 12 };
}

/** Fixed phases for the "force time of day" property. */
export function phaseFromOverride(key) {
  switch (key) {
    case 'dawn': return { isDay: true, progress: 0.02 };
    case 'day': return { isDay: true, progress: 0.4 };
    case 'dusk': return { isDay: true, progress: 0.97 };
    case 'night': return { isDay: false, progress: 0.5 };
    default: return null;
  }
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}
