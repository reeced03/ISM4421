# Trailhead Weather

Live weather for all 63 U.S. National Parks, built on the free [Open-Meteo](https://open-meteo.com/) APIs (no API key needed). It's a static site with no build step, ready to deploy on Netlify.

## Features

- **Overview of every park**: current temperature, feels-like, conditions, wind, humidity, precipitation chance and a 5-day strip. All 63 parks load in a single Open-Meteo request.
- **Summary tiles**: warmest, coldest, gustiest and wettest park right now, plus counts of parks with advisories or active precipitation.
- **Three views**: cards, an interactive temperature map (Leaflet) and a comparison table.
- **Search, filter and sort** by name/state, region, favorites, advisories, temperature, wind, precipitation chance, UV or park age.
- **Park detail**: local time, current conditions, pressure, UV, sunrise/sunset and daylight, US AQI (Open-Meteo Air Quality API), an interactive 48-hour temperature and precipitation chart, and a 7-day forecast.
- **Derived advisories**: heat, cold, high wind, thunderstorms, heavy rain or snow, high UV.
- °F/°C toggle, light/dark theme, starred favorites (saved in your browser), and shareable deep links (`/#park=yellowstone`).
- Responses are cached in `sessionStorage` for 15 minutes and refreshed automatically.

## Project layout

```
index.html        Page shell
css/styles.css    Earthy theme (light + dark)
js/parks.js       The 63 national parks: coordinates, states, region, year established
js/weather.js     Open-Meteo client, weather codes, icons, unit conversion, advisories
js/app.js         UI: rendering, filters, map, detail dialog, hourly chart
netlify.toml      Netlify publish + header settings
```

## Run locally

The app uses ES modules, so serve it over HTTP instead of opening the file directly:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Deploy to Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this repository.
2. Leave the build command empty and set the publish directory to `.` (both are already set in `netlify.toml`).
3. Deploy.

Or drag and drop the project folder onto [app.netlify.com/drop](https://app.netlify.com/drop).

## Data and attribution

- Weather: [Open-Meteo Forecast API](https://open-meteo.com/en/docs) and [Air Quality API](https://open-meteo.com/en/docs/air-quality-api), CC BY 4.0.
- Map tiles: © OpenStreetMap contributors, © CARTO.
- Park coordinates are approximate centroids. Conditions within large parks vary a lot with elevation, so check [nps.gov](https://www.nps.gov/) for official alerts and closures.
- Open-Meteo's free tier is for non-commercial use. For commercial use, see their [pricing](https://open-meteo.com/en/pricing).
