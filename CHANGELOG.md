# Changelog

Versions follow [Semantic Versioning](https://semver.org): MAJOR.MINOR.PATCH,
set in `manifest.json` (the one place it is written; the panel's footer and
the IPC `status` read it from there). Each release is tagged `vMAJOR.MINOR.PATCH`.

- **MAJOR**: a change that breaks what a user set up: a setting renamed or
  removed, the saved place's format, the IPC calls.
- **MINOR**: a new feature or a visible change to what the widget shows.
- **PATCH**: a fix that changes nothing else.

## 1.0.0 — 2026-10-12

First release: a port to France of
[Rain Radar Denmark](https://github.com/diegogardini/omarchy-rain-radar-denmark-widget)
1.3.0 by diegogardini, whose nowcast, chance-of-rain model, graph and panel it
keeps.

- **Radar:** RainViewer's composite (Météo-France's radars over France), four
  map tiles every 10 minutes, no API key. `helpers/radar-convert.py` turns
  their colours back into mm/h with Python's standard library alone.
- **Map:** mainland France and Corsica with their neighbours, the Atlantic and
  the Channel kept in the data so rain arriving from the west is carried in.
  The pin's graph sits over the Bay of Biscay.
- **Places:** the 34,746 communes of mainland France and Corsica, searched
  without accents or hyphens ("st etienne"), each with its department.
- **Français:** the panel speaks French by default; "English" at the end of
  the footer switches, and the choice is saved.
- No fixed-echo mask yet: none has been measured for the French radars.
