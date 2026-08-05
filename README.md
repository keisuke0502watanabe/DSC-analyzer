# DSC-analyzer

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21812143.svg)](https://doi.org/10.5281/zenodo.21812143)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Static single-file HTML tool for visualizing and analyzing DSC data
(heat flow, temperature- and time-dependent workflows, thermal-event and
isothermal-Avrami feature extraction, IndexedDB cache, project save, DB
export/import).

## Current app (use this)

- **`webapp/dsc_analyzer_v9.html`** — tabbed UI (DB · Combined · Patterns · Series · Feature DB · Avrami) with Analysis Mode (Tm / ΔHm / ΔSm), isothermal Avrami kinetics, and reusable fit presets.

## Launch on http://localhost (recommended)

Opening the app as `file://` lets Chrome evict the IndexedDB cache (your DB /
projects) under disk pressure. Serving it over `http://localhost` is a proper
origin, so the browser keeps your data far more reliably. Double-clickable
launchers start a local Python server (port **8754**) and open the app:

- **macOS** — double-click **`launchers_mac/DSC-localhost.command`**
- **Linux / generic** — `bash launchers_mac/DSC-localhost.sh`
- **Windows** — double-click **`launchers_win/DSC-localhost.bat`**

They serve the repo root and open `http://localhost:8754/webapp/dsc_analyzer_v9.html`.
You can close the launcher window; the server keeps running.

Manual alternative:

```bash
python3 -m http.server 8754
```

Then open `http://localhost:8754/webapp/dsc_analyzer_v9.html`.

## Moving data between machines (e.g. iPad / remote)

Use **DB Export** to write the whole IndexedDB (files + projects + features)
to a JSON file, and **DB Import** on the other machine to load it. Fit presets
are stored per-browser in `localStorage`.

## Legacy pages

Older versions (`v4`–`v8`) and alternate UIs live under **`webapp/`** and
**`webapp/old-version/`**. They are kept for reference; the maintained entry
point is `dsc_analyzer_v9.html`.

## Usage

1. Launch via the localhost launcher above (or serve `webapp/` over HTTP).
2. Load DSC data from the UI (drop zone or file cache).
3. Analyze in the per-series Analysis Mode; save features to the Feature DB.



## License

MIT License — see [LICENSE](LICENSE).

## Acknowledgements

This work was supported by JSPS KAKENHI Grant Number 23K04683.
