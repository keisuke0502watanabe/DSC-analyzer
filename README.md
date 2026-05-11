# DSC-analyzer

Static HTML tools for visualizing and analyzing DSC data.

## Current app (use this)

- **`webapp/dsc_analyzer_db_Heatflow_tempdep_timedep.html`** — Database-style analyzer for heat flow with temperature- and time-dependent workflows (IndexedDB cache, project save, DB export/import).

Open it in a normal browser. For reliable behavior (IndexedDB, CDN scripts), serve the folder over HTTP instead of `file://`, for example:

```bash
cd webapp
python3 -m http.server 8766
```

Then open `http://127.0.0.1:8766/dsc_analyzer_db_Heatflow_tempdep_timedep.html`.

## Legacy pages

Older and alternate UIs live under **`webapp/old-version/`** (single-file, multi-file, time/temp, earlier DB variants, etc.). They are kept for reference; the maintained entry point is the Heatflow DB page above.

## Usage

1. Go to `webapp/` (or serve it as above).
2. Open **`dsc_analyzer_db_Heatflow_tempdep_timedep.html`**.
3. Load DSC data from the UI (drop zone or file cache).
