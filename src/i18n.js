const STRINGS = {
  en: {
    clear: 'Clear sky',
    mainlyClear: 'Mainly clear',
    partly: 'Partly cloudy',
    cloudy: 'Overcast',
    fog: 'Fog',
    drizzle: 'Drizzle',
    rain: 'Rain',
    heavyRain: 'Heavy rain',
    snow: 'Snow',
    storm: 'Thunderstorm',
    windy: 'Windy',
    wind: 'Wind',
    humidity: 'Humidity',
    loading: 'Loading weather…',
    cityNotFound: 'City not found',
    offline: 'Offline — showing last known weather',
    noCity: 'Set your city in the wallpaper properties',
    preview: 'Preview mode',
  },
  pt: {
    clear: 'Céu limpo',
    mainlyClear: 'Predominantemente limpo',
    partly: 'Parcialmente nublado',
    cloudy: 'Nublado',
    fog: 'Neblina',
    drizzle: 'Garoa',
    rain: 'Chuva',
    heavyRain: 'Chuva forte',
    snow: 'Neve',
    storm: 'Tempestade',
    windy: 'Ventania',
    wind: 'Vento',
    humidity: 'Umidade',
    loading: 'Carregando clima…',
    cityNotFound: 'Cidade não encontrada',
    offline: 'Sem conexão — mostrando o último clima conhecido',
    noCity: 'Defina sua cidade nas propriedades do wallpaper',
    preview: 'Modo de teste',
  },
  es: {
    clear: 'Despejado',
    mainlyClear: 'Mayormente despejado',
    partly: 'Parcialmente nublado',
    cloudy: 'Nublado',
    fog: 'Niebla',
    drizzle: 'Llovizna',
    rain: 'Lluvia',
    heavyRain: 'Lluvia intensa',
    snow: 'Nieve',
    storm: 'Tormenta',
    windy: 'Ventoso',
    wind: 'Viento',
    humidity: 'Humedad',
    loading: 'Cargando el clima…',
    cityNotFound: 'Ciudad no encontrada',
    offline: 'Sin conexión — mostrando el último clima conocido',
    noCity: 'Configura tu ciudad en las propiedades del fondo',
    preview: 'Modo de prueba',
  },
};

let current = 'en';

/** Accepts "auto", "en", "pt", "es" or a locale like "pt-br" / "es-es". */
export function resolveLanguage(choice, fallbackLocale) {
  const pick = (code) => {
    const short = String(code || '').toLowerCase().slice(0, 2);
    return STRINGS[short] ? short : null;
  };
  if (choice && choice !== 'auto') return pick(choice) || 'en';
  return pick(fallbackLocale) || pick(navigator.language) || 'en';
}

export function setLanguage(lang) {
  current = STRINGS[lang] ? lang : 'en';
}

export function getLanguage() {
  return current;
}

export function t(key) {
  return STRINGS[current][key] ?? STRINGS.en[key] ?? key;
}
