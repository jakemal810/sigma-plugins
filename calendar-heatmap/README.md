# Calendar Heatmap — Sigma plugin

A calendar heatmap (GitHub-contributions style) for Sigma workbooks, built on [frappe-charts](https://frappe.io/charts). Adapted from the `frappe-heatmap` sample in [sigmacomputing/sigma-sample-plugins](https://github.com/sigmacomputing/sigma-sample-plugins).

Changes from the sample:

- Days are bucketed by their UTC date, so values no longer shift a day earlier in US time zones.
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

## Run locally

```bash
npm install
npm run build
npm run serve   # serves build/ on http://localhost:3000
```

In Sigma, register the plugin (Administration → Account → Custom Plugins) with `http://localhost:3000` as the URL. It renders only in a browser on the machine running the server.
