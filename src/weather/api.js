// Open-Meteo: free, no API key, CORS enabled. https://open-meteo.com/
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'ocean-cube-weather-v1';

export class CityNotFoundError extends Error {}

/** Resolves "City name" or "lat,lon" into { name, latitude, longitude }. */
export async function geocode(query, language) {
  const coords = String(query).match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) {
    return { name: `${coords[1]}, ${coords[2]}`, latitude: Number(coords[1]), longitude: Number(coords[2]) };
  }

  const cacheKey = `ocean-cube-geo:${language}:${query.trim().toLowerCase()}`;
  const cached = readStorage(cacheKey);
  if (cached) return cached;

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query.trim())}&count=1&format=json&language=${language}`;
  const data = await getJson(url);
  const hit = data.results && data.results[0];
  if (!hit) throw new CityNotFoundError(query);

  const place = { name: hit.name, latitude: hit.latitude, longitude: hit.longitude };
  writeStorage(cacheKey, place);
  return place;
}

/**
 * Current conditions plus yesterday/today/tomorrow sunrise and sunset as unix
 * seconds, so the day/night phase can be computed at any moment (also after midnight).
 */
export async function fetchForecast(place) {
  const current = [
    'temperature_2m', 'relative_humidity_2m', 'is_day', 'weather_code', 'cloud_cover',
    'precipitation', 'rain', 'snowfall', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  ].join(',');
  const url = `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}`
    + `&current=${current}&daily=sunrise,sunset&timezone=auto&timeformat=unixtime`
    + '&wind_speed_unit=ms&past_days=1&forecast_days=2';
  const data = await getJson(url);
  const c = data.current;

  const report = {
    place: place.name,
    fetchedAt: Date.now(),
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    isDay: c.is_day === 1,
    code: c.weather_code,
    cloudCover: c.cloud_cover,
    precipitation: c.precipitation,
    rain: c.rain,
    snowfall: c.snowfall,
    windSpeed: c.wind_speed_10m,      // m/s
    windGusts: c.wind_gusts_10m,      // m/s
    windDirection: c.wind_direction_10m, // degrees, where the wind comes FROM
    sunrise: (data.daily.sunrise || []).filter(Boolean),
    sunset: (data.daily.sunset || []).filter(Boolean),
  };
  writeStorage(CACHE_KEY, report);
  return report;
}

export function loadCachedReport() {
  return readStorage(CACHE_KEY);
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the wallpaper works without it.
  }
}
