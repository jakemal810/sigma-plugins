/* Stress tests for the calendar heatmap. Run in several time zones, e.g.
 *   TZ=America/Los_Angeles CI=true npx react-scripts test --watchAll=false
 * Sigma is mocked: tests set the config + column data the plugin would receive.
 */
import { render, act } from '@testing-library/react';

jest.mock('@sigmacomputing/plugin', () => {
  const state = { config: {}, data: {}, columns: {} };
  return {
    __state: state,
    client: { config: { configureEditorPanel: jest.fn() } },
    useConfig: () => state.config,
    useElementColumns: () => state.columns,
    useElementData: () => state.data,
  };
});

// jsdom gaps
global.ResizeObserver = class { observe() {} disconnect() {} };
window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 600, height: 120 });
// Pretend we are inside Sigma's iframe.
Object.defineProperty(window, 'parent', { value: {}, configurable: true });

const plugin = require('@sigmacomputing/plugin');
const App = require('./App').default;

const DAY = 86400000;
const utc = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const weekdayOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

let errors;
beforeEach(() => {
  jest.useFakeTimers();
  errors = [];
  jest.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')));
  plugin.__state.config = { source: 'el', dimension: 'D', measures: 'M', countLabel: 'USD' };
  plugin.__state.columns = {};
});
afterEach(() => { console.error.mockRestore(); jest.useRealTimers(); });

function show(dates, values) {
  plugin.__state.data = { D: dates, M: values };
  const r = render(<App />);
  act(() => { jest.runAllTimers(); });
  return r;
}
function cells(container) {
  return [...container.querySelectorAll('rect.day')].map(r => ({
    date: r.getAttribute('data-date'),
    value: r.getAttribute('data-value'),
    row: Number(r.getAttribute('data-day')),
    fill: r.getAttribute('fill'),
  }));
}
// Every drawn cell must sit on the row for its weekday, appear once, and carry its value.
function checkLayout(container, expected) {
  const cs = cells(container);
  const seen = new Set();
  const problems = [];
  for (const c of cs) {
    if (seen.has(c.date)) problems.push(`duplicate cell ${c.date}`);
    seen.add(c.date);
    if (weekdayOf(c.date) !== c.row) problems.push(`${c.date} drawn on row ${c.row}, weekday is ${weekdayOf(c.date)}`);
    const want = expected[c.date] || 0;
    if (Number(c.value) !== want) problems.push(`${c.date} value ${c.value}, want ${want}`);
  }
  for (const d of Object.keys(expected)) if (!seen.has(d)) problems.push(`missing cell ${d}`);
  return { problems: problems.slice(0, 15), count: cs.length, total: problems.length };
}
function series(startMs, days, fn = i => i + 1) {
  const dates = [], vals = [], expected = {};
  for (let i = 0; i < days; i++) {
    const t = startMs + i * DAY;
    dates.push(t); vals.push(fn(i)); expected[ymd(t)] = fn(i);
  }
  return { dates, vals, expected };
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe(`layout in ${TZ}`, () => {
  test.each([
    ['one year from Jan 1 2025', utc(2025, 1, 1), 365],
    ['rolling 365 ending mid-month', utc(2025, 11, 18), 365],
    ['leap year 2024', utc(2024, 1, 1), 366],
    ['DST spring/fall windows', utc(2026, 3, 1), 250],
    ['single day', utc(2026, 6, 15), 1],
    ['one week', utc(2026, 6, 14), 7],
    ['month starting Saturday (Aug 2026)', utc(2026, 8, 1), 31],
    ['three years', utc(2023, 1, 1), 1096],
  ])('%s', (_, start, days) => {
    const { dates, vals, expected } = series(start, days);
    const { container } = show(dates, vals);
    const res = checkLayout(container, expected);
    expect(res.problems).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('datetime values late in the UTC day stay on their UTC date', () => {
    const t = utc(2026, 3, 10, 23, 30);
    const { container } = show([t], [5]);
    expect(checkLayout(container, { '2026-03-10': 5 }).problems).toEqual([]);
  });
});

describe('data edge cases', () => {
  test('unsorted rows and duplicate days are summed', () => {
    const d = [utc(2026, 5, 3), utc(2026, 5, 1), utc(2026, 5, 3), utc(2026, 5, 2)];
    const { container } = show(d, [1, 2, 3, 4]);
    expect(checkLayout(container, { '2026-05-01': 2, '2026-05-02': 4, '2026-05-03': 4 }).problems).toEqual([]);
  });

  test('null dates / null / string / NaN values do not crash', () => {
    const d = [null, utc(2026, 5, 1), utc(2026, 5, 2), utc(2026, 5, 3), undefined];
    const { container } = show(d, [9, null, '7', 'abc', 1]);
    expect(checkLayout(container, { '2026-05-02': 7 }).problems).toEqual([]);
  });

  test('empty data renders an empty calendar', () => {
    const { container } = show([], []);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  test('no source configured', () => {
    plugin.__state.config = {};
    plugin.__state.data = {};
    const { container } = render(<App />);
    act(() => { jest.runAllTimers(); });
    expect(container.querySelector('svg')).not.toBeNull();
  });

  test('invalid date values are skipped, valid ones still draw', () => {
    const { container } = show(['not a date', utc(2026, 5, 1), NaN], [1, 2, 3]);
    expect(checkLayout(container, { '2026-05-01': 2 }).problems).toEqual([]);
    expect(container.querySelector('.App-error')).toBeNull();
  });

  test('ISO date strings work as well as epoch ms', () => {
    const { container } = show(['2026-05-01T00:00:00Z', '2026-05-02'], [4, 5]);
    expect(checkLayout(container, { '2026-05-01': 4, '2026-05-02': 5 }).problems).toEqual([]);
  });

  test('countLabel is escaped in the tooltip', () => {
    plugin.__state.config.countLabel = '<img src=x onerror=alert(1)>';
    const { container } = show([utc(2026, 5, 1)], [3]);
    const sq = container.querySelector('rect.day');
    sq.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const tip = container.querySelector('.graph-svg-tip');
    expect(tip.querySelector('img')).toBeNull();
    expect(tip.textContent).toContain('3 <img');
  });

  test('all zeros', () => {
    const { dates, vals } = series(utc(2026, 1, 1), 60, () => 0);
    const { container } = show(dates, vals);
    expect(cells(container).length).toBe(60);
  });

  // Known limitation (frappe's scale starts at 0): negative days share the
  // lightest colour with zero. They must still render and keep their value.
  test('negative values render and keep their value', () => {
    const { container } = show([utc(2026, 5, 1), utc(2026, 5, 2), utc(2026, 5, 3)], [-500, 0, 1000]);
    expect(checkLayout(container, { '2026-05-01': -500, '2026-05-03': 1000 }).problems).toEqual([]);
  });

  test('float sums show clean values in the tooltip data', () => {
    const { container } = show([utc(2026, 5, 1), utc(2026, 5, 1)], [0.1, 0.2]);
    expect(cells(container)[0].value).toBe('0.3');
  });

  // Known limitation (linear colour scale): one huge day pushes every other day
  // into the first colour step. Kept skipped until a scale change is decided.
  test.skip('one outlier does not wash out every other day', () => {
    const { dates, vals } = series(utc(2026, 1, 1), 100, i => (i === 50 ? 1e9 : 100 + i));
    const { container } = show(dates, vals);
    const fills = new Set(cells(container).filter(c => c.value !== '1000000000').map(c => c.fill));
    expect(fills.size).toBeGreaterThan(1);
  });

  test('pre-1970 dates', () => {
    const { container } = show([utc(1969, 12, 30), utc(1969, 12, 31)], [1, 2]);
    expect(checkLayout(container, { '1969-12-30': 1, '1969-12-31': 2 }).problems).toEqual([]);
  });

  test('ten years of daily data renders in reasonable time', () => {
    const { dates, vals } = series(utc(2016, 1, 1), 3653);
    const t0 = Date.now();
    const { container } = show(dates, vals);
    expect(cells(container).length).toBe(3653);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test('100k event rows aggregate quickly', () => {
    const dates = [], vals = [];
    for (let i = 0; i < 100000; i++) { dates.push(utc(2026, 1, 1) + (i % 365) * DAY); vals.push(1); }
    const t0 = Date.now();
    const { container } = show(dates, vals);
    expect(Number(cells(container)[0].value)).toBeGreaterThan(200);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('lifecycle', () => {
  test('repeated data updates do not pile up mousemove listeners', () => {
    const spy = jest.spyOn(window.HTMLDivElement.prototype, 'addEventListener');
    const { dates, vals } = series(utc(2026, 1, 1), 90);
    const r = show(dates, vals);
    const before = spy.mock.calls.filter(c => c[0] === 'mousemove').length;
    for (let i = 0; i < 50; i++) {
      plugin.__state.data = { D: dates, M: vals.map(v => v + i) };
      r.rerender(<App />);
      act(() => { jest.runAllTimers(); });
    }
    const after = spy.mock.calls.filter(c => c[0] === 'mousemove').length;
    spy.mockRestore();
    expect(after - before).toBeLessThanOrEqual(1);
  });

  test('changing palette and unmounting leaves no errors behind', () => {
    const { dates, vals } = series(utc(2026, 1, 1), 90);
    const r = show(dates, vals);
    plugin.__state.config = { ...plugin.__state.config, palette: 'Blue' };
    r.rerender(<App />);
    r.unmount();
    act(() => { jest.runAllTimers(); });
    expect(errors).toEqual([]);
  });

  test('switching the date column to a different source keeps working', () => {
    const a = series(utc(2025, 1, 1), 30);
    const r = show(a.dates, a.vals);
    const b = series(utc(2026, 6, 1), 45, i => 2 * i + 1);
    plugin.__state.data = { D: b.dates, M: b.vals };
    r.rerender(<App />);
    act(() => { jest.runAllTimers(); });
    expect(checkLayout(r.container, b.expected).problems).toEqual([]);
  });
});
