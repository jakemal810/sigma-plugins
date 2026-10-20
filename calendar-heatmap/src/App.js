import './App.css';
import { Chart } from 'frappe-charts';
import {
  client,
  useConfig,
  useElementColumns,
  useElementData,
} from "@sigmacomputing/plugin";
import * as React from 'react';

const PALETTES = {
  Green: ['#ebedf0', '#c6e48b', '#7bc96f', '#239a3b', '#196127'],
  Blue: ['#ebedf0', '#c9dcf0', '#7fa9d9', '#3a73b8', '#0b3c7d'],
};

client.config.configureEditorPanel([
  { name: "source", type: "element" },
  { name: "dimension", type: "column", source: "source", allowMultiple: false },
  { name: "measures", type: "column", source: "source", allowMultiple: false },
  { name: "title", type: "text" },
  { name: "countLabel", type: "text" },
  { name: "palette", type: "dropdown", values: Object.keys(PALETTES), defaultValue: "Green" },
]);

// Sigma sends dates as UTC-midnight epoch ms; frappe buckets days in local time.
// Re-anchor each day to local noon so it lands on the right calendar day.
function toLocalDay(ts) {
  const d = new Date(ts);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
}

function App() {
  const config = useConfig();
  const columns = useElementColumns(config.source);
  const sigmaData = useElementData(config.source);

  const ref = React.useRef(null);
  const chart = React.useRef(null);
  const data = React.useMemo(() => {
    const dimension = config.dimension;
    const measure = config.measures;

    const data = {};
    let start = null;
    let end = null;
    if (sigmaData?.[dimension] && sigmaData?.[measure]) {
      for (let idx = 0; idx < sigmaData[dimension].length; ++idx) {
        const ts = sigmaData[dimension][idx];
        const val = sigmaData[measure][idx];
        if (ts == null) continue;
        const day = toLocalDay(ts);
        const key = Math.floor(day.getTime() / 1000);
        data[key] = (data[key] || 0) + (Number(val) || 0);
        start = !start || day < start ? day : start;
        end = !end || day > end ? day : end;
      }
    }

    return {
      dataPoints: data,
      start: start || undefined,
      end: end || undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, config.dimension, config.measures, sigmaData]);

  const palette = PALETTES[config.palette] || PALETTES.Green;

  React.useEffect(() => {
    ref.current.innerHTML = '';
    const c = new Chart(ref.current, {
      type: 'heatmap',
      countLabel: config.countLabel || '',
      colors: palette,
      data,
    });
    // Frappe draws at a fixed pixel size and redraws on every resize/update.
    // After each draw, crop the viewBox to the drawn content and let the SVG
    // scale to fill the element.
    const draw = c.draw.bind(c);
    c.draw = (...args) => {
      draw(...args);
      const svg = c.svg;
      if (!svg) return;
      const box = svg.getBBox();
      if (!box.width || !box.height) return;
      const pad = 4;
      svg.setAttribute('viewBox',
        `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    };
    c.draw();
    chart.current = c;
    return () => c.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.countLabel, config.palette]);

  React.useEffect(() => {
    chart.current.update(data);
  }, [data]);

  return (
    <div className="App">
      {config.title ? <div className="App-title">{config.title}</div> : null}
      <div className="App-chart" ref={ref} />
    </div>
  );
}

export default App;
