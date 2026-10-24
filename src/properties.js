import { DEFAULTS } from './config.js';

/**
 * Collects settings from Wallpaper Engine (window.wallpaperPropertyListener) and,
 * when running in a normal browser, from URL query parameters
 * (e.g. index.html?weather=storm&time=night&quality=ultra).
 */
export function createProperties(onChange) {
  const values = { ...DEFAULTS };
  const general = { fps: 0, weLanguage: null, paused: false };

  // URL aliases make browser testing quicker.
  const aliases = { lang: 'uilanguage', weather: 'weatheroverride', time: 'timeoverride', fps: 'fpslimit', hud: 'showhud', fish: 'fishcount' };
  const params = new URLSearchParams(location.search);
  for (const [rawKey, raw] of params) {
    const key = aliases[rawKey] || rawKey;
    if (!(key in DEFAULTS)) continue;
    values[key] = coerce(DEFAULTS[key], raw);
  }

  window.wallpaperPropertyListener = {
    applyUserProperties(props) {
      const changed = [];
      if (props.language) general.weLanguage = props.language.value;
      for (const key of Object.keys(props)) {
        if (!(key in DEFAULTS)) continue;
        const next = coerce(DEFAULTS[key], props[key].value);
        if (next !== values[key]) {
          values[key] = next;
          changed.push(key);
        }
      }
      if (props.language) changed.push('uilanguage');
      if (changed.length) onChange(changed);
    },
    applyGeneralProperties(props) {
      if (props.fps) {
        general.fps = props.fps;
        onChange(['fpslimit']);
      }
    },
    setPaused(isPaused) {
      general.paused = isPaused;
      onChange(['paused']);
    },
  };

  return { values, general };
}

function coerce(defaultValue, raw) {
  if (typeof defaultValue === 'boolean') return raw === true || raw === 'true' || raw === '1' || raw === 1;
  if (typeof defaultValue === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
  }
  return raw == null ? defaultValue : String(raw);
}
