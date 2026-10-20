# Network Graph — Sigma plugin

A circular node-link diagram for flows between categories, such as payments from one currency to another. Built with [D3](https://d3js.org).

- Nodes sit around a circle and are sized by total volume (sent + received).
- Edges are curved, directed (arrowheads) and sized by value. A→B and B→A bend apart.
- Hovering a node highlights its connections. Tooltips show sent/received per node and the value per edge.
- Self-loops (A→A) are not drawn.

## Editor panel

| Option | Type | Notes |
| --- | --- | --- |
| source | element | Table with one row per flow, or a grouped level of From/To |
| from | column | Source node |
| to | column | Target node |
| value | column | Optional. Summed per From→To pair; rows are counted when unset |
| title | text | Shown above the chart |
| valueLabel | text | Unit in tooltips, e.g. `payments` |
| maxNodes | dropdown | `All` or a cap; smaller nodes fold into "Other" |
| nodeOrder | dropdown | `Spread largest` (default), `Largest first`, `Alphabetical` |

Opened outside Sigma, the plugin renders sample data so the layout can be checked in a browser.

## Run locally

```bash
npm install
npm run build
npm run serve   # serves build/ on http://localhost:3001
```

Register the plugin in Sigma with `http://localhost:3001` as the URL.
