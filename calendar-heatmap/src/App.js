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

// Local noon on a calendar date, or null if the date doesn't exist (Feb 31).
function localNoon(y, m, d) {
  const day = new Date(y, m - 1, d, 12);
  if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) return null;
  return day;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const HAS_ZONE_RE = /(?:Z|[+-]\d{2}:?\d{2}|\bGMT\b|\bUTC\b)\s*$/i;

// Map a Sigma date value to local noon on its calendar day (frappe buckets days
// in local time; noon keeps DST shifts from moving it). Returns null if invalid.
// - Epoch ms / Date (what Sigma sends): the UTC date.
// - Strings with a zone: the UTC date, same as epoch values.
// - Strings without a zone: the date as written, whatever the viewer's zone.
function toLocalDay(value) {
  if (typeof value === 'string') {
    const s = value.trim();
    const m = ISO_RE.exec(s);
    if (m) {
      if (!localNoon(+m[1], +m[2], +m[3])) return null;
      if (!m[6]) return localNoon(+m[1], +m[2], +m[3]);
    } else if (!HAS_ZONE_RE.test(s)) {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return null;
      return localNoon(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return localNoon(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Never draw more than this many years; frappe draws one SVG square per day,
// so one stray date (1900-01-01, 9999-12-31) would otherwise freeze the page.
const MAX_YEARS = 10;

// Neumaier compensated sum: exact enough that cents add up and tiny values
// aren't lost. Round once at the end to drop float noise (0.1 + 0.2).
function addTo(acc, x) {
  const t = acc.sum + x;
  acc.c += Math.abs(acc.sum) >= Math.abs(x) ? (acc.sum - t) + x : (x - t) + acc.sum;
  acc.sum = t;
}
const total = acc => Number((acc.sum + acc.c).toPrecision(15));

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const smallFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 });
const formatValue = n => (n !== 0 && Math.abs(n) < 1 ? smallFormat : numberFormat).format(n);

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
      const value = formatValue(Number(square.getAttribute('data-value')) || 0);
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

  // Frappe's constructor registers resize listeners before its first draw. If
  // that draw throws, the caller never gets the instance and can't destroy() it,
  // so clean up here before passing the error on.
  setup() {
    try {
      super.setup();
    } catch (e) {
      this.destroy();
      throw e;
    }
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

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const latestAllowed = new Date(today);
    latestAllowed.setFullYear(latestAllowed.getFullYear() + MAX_YEARS);

    const days = new Map(); // key -> { day, acc, rows }
    let skipped = 0;
    let end = null;
    const dates = sigmaData?.[dimension];
    const values = sigmaData?.[measure];
    if (Array.isArray(dates) && Array.isArray(values)) {
      for (let idx = 0; idx < dates.length; ++idx) {
        const ts = dates[idx];
        if (ts == null) continue;
        const day = toLocalDay(ts);
        if (!day) continue;
        if (day > latestAllowed) { skipped++; continue; }
        const key = dayKey(day);
        let entry = days.get(key);
        if (!entry) days.set(key, entry = { day, acc: { sum: 0, c: 0 }, rows: 0 });
        const val = Number(values[idx]);
        if (Number.isFinite(val)) addTo(entry.acc, val);
        entry.rows++;
        if (!end || day > end) end = day;
      }
    }

    const dataPoints = {};
    let start = null;
    if (end) {
      // Keep at most MAX_YEARS, ending at the latest date.
      const earliestAllowed = new Date(end);
      earliestAllowed.setFullYear(earliestAllowed.getFullYear() - MAX_YEARS);
      earliestAllowed.setDate(earliestAllowed.getDate() + 1);
      for (const [key, { day, acc, rows }] of days) {
        if (day < earliestAllowed) { skipped += rows; continue; }
        dataPoints[key] = total(acc);
        if (!start || day < start) start = day;
      }
    } else {
      // No data: show an empty rolling year ending today.
      end = today;
      start = new Date(end);
      start.setDate(start.getDate() - 364);
    }

    return { dataPoints, start, end, skipped };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, config.dimension, config.measures, sigmaData]);

  const palette = PALETTES[config.palette] || PALETTES.Green;

  const options = React.useRef();
  options.current = { countLabel: config.countLabel || '', colors: palette, data };

  // (Re)build the chart from the current options. A build that fails leaves no
  // chart; the next data change tries again.
  const build = React.useCallback(() => {
    if (chart.current) chart.current.destroy();
    chart.current = null;
    try {
      ref.current.innerHTML = '';
      const { countLabel, colors, data } = options.current;
      const c = new CalendarHeatmap(ref.current, { type: 'heatmap', countLabel, colors, data });
      c.builtWith = data;
      chart.current = c;
      setFailed(false);
    } catch (e) {
      console.error('Calendar heatmap failed to render', e);
      setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    build();
  }, [build, config.countLabel, config.palette]);

  React.useEffect(() => () => {
    if (chart.current) chart.current.destroy();
    chart.current = null;
  }, []);

  React.useEffect(() => {
    const c = chart.current;
    if (!c) { build(); return; }
    if (c.builtWith === data) return; // just built with this data
    try {
      c.update(data);
      setFailed(false);
    } catch (e) {
      console.error('Calendar heatmap failed to update', e);
      build();
    }
  }, [build, data]);

  const skipped = IN_SIGMA ? data.skipped : 0;

  return (
    <div className="App">
      {IN_SIGMA && config.title ? <div className="App-title">{config.title}</div> : null}
      {!IN_SIGMA ? <div className="App-title">Daily amount (sample data)</div> : null}
      {skipped ? (
        <div className="App-note">
          {skipped === 1 ? '1 row is' : `${skipped.toLocaleString()} rows are`} outside this range.
        </div>
      ) : null}
      {failed ? <div className="App-error">This chart couldn't be displayed.</div> : null}
      <div className="App-chart" ref={ref} />
    </div>
  );
}

export default App;
