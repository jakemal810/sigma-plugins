import './App.css';
import { Heatmap } from 'frappe-charts';
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

// Outside Sigma (opening the plugin URL directly) show a year of sample values
// so the layout can be checked without a workbook.
const IN_SIGMA = window.parent !== window;
function sampleData() {
  const dataPoints = {};
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  let seed = 7;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    seed = (seed * 9301 + 49297) % 233280;
    const r = seed / 233280;
    if (r > 0.35) dataPoints[dayKey(d)] = Math.round(r * r * 12000);
  }
  return { dataPoints, start, end };
}

const pad2 = n => (n > 9 ? '' : '0') + n;
// Same key format frappe uses for a local calendar day.
const dayKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Sigma sends dates as UTC-midnight epoch ms; frappe buckets days in local time.
// Re-anchor each day to local noon so it lands on the right calendar day.
// Returns null for values that are not a valid date.
function toLocalDay(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
}

// Strip float noise from sums (0.1 + 0.2) without losing real precision.
const clean = n => Math.round(n * 1e6) / 1e6;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const escapeHtml = s => String(s).replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Frappe's Heatmap with three fixes. Everything else is stock frappe-charts 1.6.2.
class CalendarHeatmap extends Heatmap {
  // Frappe steps from one week column to the next by parsing a "YYYY-MM-DD"
  // string, which JS reads as UTC midnight. West of UTC (all of the Americas)
  // that is the previous local day, so every later column starts a day early:
  // days sit on the wrong weekday row and some dates are drawn twice. Rebuild
  // the columns with local-date arithmetic, and always end each month with
  // exactly one blank spacer column (frappe only adds one after some months).
  getDomainConfig(startDate, endDate) {
    const month = startDate.getMonth();
    const last = endDate || new Date(startDate.getFullYear(), month + 1, 0);
    const lastMs = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59).getTime();
    const week = new Date(startDate.getFullYear(), month, startDate.getDate() - startDate.getDay(), 12);
    const cols = [];
    while (week.getTime() <= lastMs) {
      cols.push(this.getCol(week, month));
      week.setDate(week.getDate() + 7);
    }
    cols.push(Array.from({ length: 7 }, () => ({})));
    return { index: month, cols };
  }

  // Frappe adds another mousemove listener on every update (one more per filter
  // change, forever). Bind once; format the number and escape the label.
  bindTooltip() {
    if (this.tooltipBound) return;
    this.tooltipBound = true;
    this.container.addEventListener('mousemove', e => {
      const square = e.target;
      if (!square.classList || !square.classList.contains('day')) return;
      const date = square.getAttribute('data-date');
      if (!date) return;
      const [y, m, d] = date.split('-').map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(undefined,
        { month: 'short', day: 'numeric', year: 'numeric' });
      const value = numberFormat.format(Number(square.getAttribute('data-value')) || 0);
      const gOff = this.container.getBoundingClientRect();
      const pOff = square.getBoundingClientRect();
      this.tip.setValues(pOff.left - gOff.left + pOff.width / 2, pOff.top - gOff.top, {
        name: ' on ' + label,
        value: escapeHtml((value + ' ' + this.countLabel).trim()),
        valueFirst: 1,
      }, []);
      this.tip.showTip();
    });
  }

  // Frappe draws at a fixed pixel size and redraws on every resize/update.
  // After each draw, crop the viewBox to the drawn content and let the SVG
  // scale to fill the element.
  draw(...args) {
    super.draw(...args);
    const svg = this.svg;
    if (!svg) return;
    let box;
    try { box = svg.getBBox(); } catch (e) { return; } // not rendered (hidden)
    if (!box.width || !box.height) return;
    const pad = 4;
    svg.setAttribute('viewBox',
      `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
}

function App() {
  const config = useConfig();
  const columns = useElementColumns(config.source);
  const sigmaData = useElementData(config.source);

  const ref = React.useRef(null);
  const chart = React.useRef(null);
  const [failed, setFailed] = React.useState(false);
  const data = React.useMemo(() => {
    if (!IN_SIGMA) return sampleData();
    const dimension = config.dimension;
    const measure = config.measures;

    const data = {};
    let start = null;
    let end = null;
    const dates = sigmaData?.[dimension];
    const values = sigmaData?.[measure];
    if (Array.isArray(dates) && Array.isArray(values)) {
      for (let idx = 0; idx < dates.length; ++idx) {
        const ts = dates[idx];
        if (ts == null) continue;
        const day = toLocalDay(ts);
        if (!day) continue;
        const key = dayKey(day);
        const val = Number(values[idx]);
        data[key] = clean((data[key] || 0) + (Number.isFinite(val) ? val : 0));
        start = !start || day < start ? day : start;
        end = !end || day > end ? day : end;
      }
    }
    if (!start) {
      // No data: show an empty rolling year ending today.
      end = new Date();
      end.setHours(12, 0, 0, 0);
      start = new Date(end);
      start.setDate(start.getDate() - 364);
    }

    return { dataPoints: data, start, end };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, config.dimension, config.measures, sigmaData]);

  const palette = PALETTES[config.palette] || PALETTES.Green;

  React.useEffect(() => {
    let c;
    try {
      ref.current.innerHTML = '';
      c = new CalendarHeatmap(ref.current, {
        type: 'heatmap',
        countLabel: config.countLabel || '',
        colors: palette,
        data,
      });
      chart.current = c;
      setFailed(false);
    } catch (e) {
      console.error('Calendar heatmap failed to render', e);
      chart.current = null;
      setFailed(true);
    }
    return () => { if (c) c.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.countLabel, config.palette]);

  React.useEffect(() => {
    if (!chart.current) return;
    try {
      chart.current.update(data);
      setFailed(false);
    } catch (e) {
      console.error('Calendar heatmap failed to update', e);
      setFailed(true);
    }
  }, [data]);

  return (
    <div className="App">
      {IN_SIGMA && config.title ? <div className="App-title">{config.title}</div> : null}
      {!IN_SIGMA ? <div className="App-title">Daily amount (sample data)</div> : null}
      {failed ? <div className="App-error">This chart couldn't be displayed.</div> : null}
      <div className="App-chart" ref={ref} />
    </div>
  );
}

export default App;
