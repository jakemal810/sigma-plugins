# Calendar Heatmap — Sigma plugin

A calendar heatmap (GitHub-contributions style) for Sigma workbooks, built on [frappe-charts](https://frappe.io/charts). Adapted from the `frappe-heatmap` sample in [sigmacomputing/sigma-sample-plugins](https://github.com/sigmacomputing/sigma-sample-plugins).

Changes from the sample:

- Days are bucketed by their UTC date, so values no longer shift a day earlier in US time zones.
- Week columns are built with local-date arithmetic. Stock frappe parses `YYYY-MM-DD` as UTC, so west of UTC every column after the first started a day early (wrong weekday rows, repeated dates).
- The tooltip handler is bound once (stock frappe adds another listener on every data update), and the value is number-formatted and HTML-escaped.
- Invalid dates and non-numeric values are skipped; float noise in sums is removed; a render error shows a short message instead of a blank element and retries on the next data change.
- At most 10 years are drawn, ending at the latest date, and dates more than 10 years in the future are ignored, so one stray date (1900-01-01, 9999-12-31) can't freeze the page. A note says how many rows were left out.
- Sums use compensated summation, so cents add up exactly and tiny values aren't lost.
- Date strings without a time zone keep the date as written; strings with a zone, and epoch values, use their UTC date.
- The chart scales to fill the Sigma element and no longer clips the last weeks.
- New editor options: `title`, `countLabel` (tooltip unit), and `palette` (Green / Blue).

## Editor panel

| Option | Type | Notes |
| --- | --- | --- |
| source | element | Table with one row per day (or per event; values are summed by day) |
| dimension | column | Date column |
| measures | column | Numeric column |
| title | text | Shown above the chart |
| countLabel | text | Unit in the tooltip, e.g. `USD` |
| palette | dropdown | `Green` (default) or `Blue` |

## Hosting

Every push to `main` builds, tests and deploys to GitHub Pages:
`https://jakemal810.github.io/sigma-plugins/calendar-heatmap/`. Register that URL in Sigma (Administration → Account → Custom Plugins) so every viewer can load the plugin.

## Run locally

```bash
npm install
npm run build
npm run serve   # serves build/ on http://localhost:3000
```

Stress tests (`src/heatmap.stress.test.js`) cover layout, data edge cases and lifecycle. Run them with `CI=true npx react-scripts test --watchAll=false`, setting `TZ` to try other time zones (on Windows, Node only honors `TZ=UTC`; CI runs seven zones).

For local development, set the plugin's dev URL in Sigma to `http://localhost:3000`. That works only in a browser on the machine running the server.
