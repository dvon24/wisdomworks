/**
 * Weather forecasts for agent tools. Backed by Open-Meteo —
 * https://open-meteo.com — which is free, no API key, ~10k req/day.
 *
 * Two-step:
 *   1. geocodeLocation(name)     — text → {lat, lon, country, admin1}
 *   2. fetchForecast(lat, lon, days) — coords → daily forecast
 *
 * Combined helper getWeather() does both and formats a chat-ready
 * summary string. Returns null if geocoding fails so the caller can
 * surface a useful error.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

export interface GeocodedPlace {
  name: string;
  country?: string;
  admin1?: string;     // State / province / region
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface DailyForecast {
  date: string;            // ISO date (YYYY-MM-DD)
  weatherCode: number;     // WMO weather code
  description: string;     // Human-readable
  tempMaxC: number;
  tempMinC: number;
  precipitationProbabilityMax: number;  // 0-100
  windSpeedMaxKmh: number;
}

export interface WeatherSummary {
  place: GeocodedPlace;
  current: {
    temperatureC: number;
    description: string;
    windSpeedKmh: number;
  } | null;
  daily: DailyForecast[];
}

// WMO weather codes → English description.
// Reference: https://open-meteo.com/en/docs#weathervariables
const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function describeWmo(code: number): string {
  return WMO_CODES[code] ?? `Weather code ${code}`;
}

export async function geocodeLocation(name: string): Promise<GeocodedPlace | null> {
  if (!name?.trim()) return null;
  try {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(name.trim())}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.results?.[0];
    if (!r) return null;
    return {
      name: r.name,
      country: r.country,
      admin1: r.admin1,
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone,
    };
  } catch (err) {
    console.warn('[weather] geocode failed:', err);
    return null;
  }
}

export async function getWeather(
  location: string,
  daysAhead: number = 3,
): Promise<WeatherSummary | null> {
  const place = await geocodeLocation(location);
  if (!place) return null;

  const clampedDays = Math.min(Math.max(daysAhead, 0), 7);
  // Open-Meteo's forecast_days param includes today. Caller's "daysAhead=0"
  // means "just today" so we request 1; "daysAhead=3" means "today + 3 more"
  // so we request 4. Cap at 8 (their max for free tier varies, 7-16 days).
  const forecastDays = clampedDays + 1;

  try {
    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      timezone: place.timezone ?? 'auto',
      forecast_days: String(forecastDays),
      current: 'temperature_2m,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    });
    const res = await fetch(`${FORECAST_URL}?${params.toString()}`);
    if (!res.ok) {
      console.warn('[weather] forecast failed:', res.status);
      return { place, current: null, daily: [] };
    }
    const data = await res.json();

    const current = data?.current
      ? {
          temperatureC: data.current.temperature_2m,
          description: describeWmo(data.current.weather_code),
          windSpeedKmh: data.current.wind_speed_10m,
        }
      : null;

    const dailyRaw = data?.daily;
    const daily: DailyForecast[] = [];
    if (dailyRaw && Array.isArray(dailyRaw.time)) {
      for (let i = 0; i < dailyRaw.time.length; i++) {
        daily.push({
          date: dailyRaw.time[i],
          weatherCode: dailyRaw.weather_code[i],
          description: describeWmo(dailyRaw.weather_code[i]),
          tempMaxC: dailyRaw.temperature_2m_max[i],
          tempMinC: dailyRaw.temperature_2m_min[i],
          precipitationProbabilityMax: dailyRaw.precipitation_probability_max?.[i] ?? 0,
          windSpeedMaxKmh: dailyRaw.wind_speed_10m_max?.[i] ?? 0,
        });
      }
    }

    return { place, current, daily };
  } catch (err) {
    console.warn('[weather] forecast exception:', err);
    return { place, current: null, daily: [] };
  }
}

/**
 * Convert a WeatherSummary to a chat-ready string. Used by the get_weather
 * agent tool's return content. Concise — let the model riff on it.
 */
export function formatWeatherSummary(summary: WeatherSummary): string {
  const placeName = [summary.place.name, summary.place.admin1, summary.place.country]
    .filter(Boolean)
    .join(', ');

  const lines: string[] = [`Weather for ${placeName}:`];

  if (summary.current) {
    lines.push(
      `  Now: ${summary.current.temperatureC.toFixed(0)}°C, ${summary.current.description}, wind ${summary.current.windSpeedKmh.toFixed(0)} km/h`,
    );
  }

  for (const d of summary.daily) {
    const date = new Date(d.date);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    lines.push(
      `  ${dayName}: ${d.tempMinC.toFixed(0)}-${d.tempMaxC.toFixed(0)}°C, ${d.description}, ${d.precipitationProbabilityMax}% precip, wind to ${d.windSpeedMaxKmh.toFixed(0)} km/h`,
    );
  }

  return lines.join('\n');
}
