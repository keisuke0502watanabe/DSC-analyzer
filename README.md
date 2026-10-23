# DSC-analyzer

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21812143.svg)](https://doi.org/10.5281/zenodo.21812143)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Static single-file HTML tool for visualizing and analyzing DSC data
(heat flow, temperature- and time-dependent workflows, thermal-event and
isothermal-Avrami feature extraction, IndexedDB cache, project save, DB
export/import).

## Current app (use this)

- **`webapp/dsc_analyzer_v10.html`** — tabbed UI (DB · **Review** · Combined · Patterns · Series · Feature DB) with Analysis Mode (Tm / ΔHm / ΔSm), isothermal Avrami kinetics, reusable fit presets, and the v10 triage layer — per-file workflow status (raw-checked / analysed / excluded) plus a keyboard-driven Review mode for walking a large cache one run at a time.

## DSC waterfall (standalone)

**`webapp/dsc_waterfall.html`** — choose DSC files (Pyris .txt / Shimadzu .txt, .tad) or drop a whole folder, and the
cooling, isothermal and heating segments are stacked as a waterfall. Filter by sample, operator, number of steps, segment
type, rate, highest temperature reached before the segment, hold temperature Ta and hold time; sort, label, and save
the plot as PNG. Everything is read inside the browser and nothing is uploaded (each file is reduced to its segments
and then dropped, so a few GB of raw data still fits).

- Sample name, mass, operator and date come from the file header (Sample ID / Sample Weight / Operator ID /
  Data Collected; for Shimadzu 試料名 / 試料量 / オペレータ名 / 収集日). Samples can also be grouped by folder name.
- Segmentation and heat-flow processing (mW/mg, exotherm up, each segment zeroed at its start) are the same as
  `dsc_waterfall_html.py` in the tagkit analysis library; checked field by field on 263 runs / 1222 segments.
- Built by [`waterfall/build.py`](waterfall/build.py) (`python3 waterfall/build.py` rebuilds it).

## Launch on http://localhost (recommended)

Opening the app as `file://` lets Chrome evict the IndexedDB cache (your DB /
projects) under disk pressure. Serving it over `http://localhost` is a proper
origin, so the browser keeps your data far more reliably. Double-clickable
launchers start a local Python server (port **8754**) and open the app:

- **macOS** — double-click **`launchers_mac/DSC-localhost.command`**
- **Linux / generic** — `bash launchers_mac/DSC-localhost.sh`
- **Windows** — double-click **`launchers_win/DSC-localhost.bat`**

They serve the repo root and open `http://localhost:8754/webapp/dsc_analyzer_v10.html`.
You can close the launcher window; the server keeps running.

Manual alternative:

```bash
python3 -m http.server 8754
```

Then open `http://localhost:8754/webapp/dsc_analyzer_v10.html`.

## Moving data between machines (e.g. iPad / remote)

Use **DB Export** to write the whole IndexedDB (files + projects + features)
to a JSON file, and **DB Import** on the other machine to load it. Fit presets
are stored per-browser in `localStorage`.

## Legacy pages

Older versions (`v4`–`v8`) and alternate UIs live under **`webapp/`** and
**`webapp/old-version/`**. They are kept for reference; the maintained entry
point is `dsc_analyzer_v10.html`.

## Usage

1. Launch via the localhost launcher above (or serve `webapp/` over HTTP).
2. Load DSC data from the UI (drop zone or file cache).
3. Analyze in the per-series Analysis Mode; save features to the Feature DB.



## License

MIT License — see [LICENSE](LICENSE).

## Acknowledgements

This work was supported by JSPS KAKENHI Grant Number 23K04683.

The code in this repository was developed with the assistance of
Claude (Anthropic) via Claude Code. The analysis design, validation
against measured data, and scientific interpretation are the author's own.
