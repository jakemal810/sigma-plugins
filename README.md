# Sigma plugins

Custom Sigma Computing plugins, one folder per plugin.

| Plugin | What it draws | Local port |
| --- | --- | --- |
| [frappe-heatmap](frappe-heatmap) | Calendar heatmap (GitHub-contributions style) | 3000 |
| [network-graph](network-graph) | Circular node-link diagram of flows | 3001 |

Each folder is a standalone React app. To run one:

```bash
cd <plugin>
npm install
npm run build
npm run serve
```

Then register it in Sigma (Administration → Account → Custom Plugins) with the local URL. Plugins served from localhost render only in a browser on the same machine.
