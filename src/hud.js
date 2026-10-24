import { t, getLanguage } from './i18n.js';

const LOCALES = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' };
const ICONS = {
  clear: '☀', mainlyClear: '🌤', partly: '⛅', cloudy: '☁', fog: '🌫', drizzle: '🌦',
  rain: '🌧', heavyRain: '🌧', snow: '❄', storm: '⛈', windy: '💨',
};
const NIGHT_ICONS = { clear: '☾', mainlyClear: '☾' };

/** Small glass panel with city, time, temperature and condition. */
export class Hud {
  constructor() {
    this.el = document.getElementById('hud');
    this.status = document.getElementById('status');
    this.state = { report: null, key: null, override: false, units: 'metric', night: false, message: null };
    setInterval(() => this.render(), 15000);
  }

  setVisible(visible, position) {
    this.el.hidden = !visible;
    this.el.className = `hud ${position}`;
    this.status.className = `status ${position}`;
  }

  update(patch) {
    Object.assign(this.state, patch);
    this.render();
  }

  render() {
    const { report, key, override, units, night, message } = this.state;
    const locale = LOCALES[getLanguage()];
    const time = new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const icon = (night && NIGHT_ICONS[key]) || ICONS[key] || '';

    let temp = '';
    let details = '';
    if (report && !override) {
      const imperial = units === 'imperial';
      const value = imperial ? report.temperature * 9 / 5 + 32 : report.temperature;
      temp = `${Math.round(value)}°${imperial ? 'F' : 'C'}`;
      const wind = imperial ? report.windSpeed * 2.23694 : report.windSpeed * 3.6;
      details = `${t('wind')} ${Math.round(wind)} ${imperial ? 'mph' : 'km/h'} · ${t('humidity')} ${Math.round(report.humidity)}%`;
    }

    this.el.innerHTML = `
      <div class="hud-top"><span class="hud-city">${escapeHtml(override ? t('preview') : report?.place || '')}</span><span class="hud-time">${time}</span></div>
      <div class="hud-main"><span class="hud-icon">${icon}</span><span class="hud-temp">${temp}</span><span class="hud-cond">${key ? t(key) : ''}</span></div>
      ${details ? `<div class="hud-details">${details}</div>` : ''}`;

    this.status.textContent = message ? t(message) : '';
    this.status.hidden = !message;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
