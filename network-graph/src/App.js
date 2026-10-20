import './App.css';
import * as d3 from 'd3';
import { client, useConfig, useElementData } from '@sigmacomputing/plugin';
import * as React from 'react';

client.config.configureEditorPanel([
  { name: 'source', type: 'element' },
  { name: 'from', type: 'column', source: 'source', allowMultiple: false },
  { name: 'to', type: 'column', source: 'source', allowMultiple: false },
  { name: 'value', type: 'column', source: 'source', allowMultiple: false },
  { name: 'title', type: 'text' },
  { name: 'valueLabel', type: 'text', defaultValue: '' },
  { name: 'maxNodes', type: 'dropdown', values: ['All', '6', '8', '10', '12', '15', '20'], defaultValue: 'All' },
  { name: 'nodeOrder', type: 'dropdown', values: ['Spread largest', 'Largest first', 'Alphabetical'], defaultValue: 'Spread largest' },
]);

const NODE_COLOR = '#3A78C9';
const EDGE_COLOR = '#8DB3E2';
const OTHER = 'Other';

// Outside Sigma (opening the plugin URL directly) show sample flows so the
// layout can be checked without a workbook.
const IN_SIGMA = window.parent !== window;
const SAMPLE = [
  ['EUR', 'GBP', 140], ['GBP', 'EUR', 30], ['EUR', 'USD', 60], ['USD', 'GBP', 40],
  ['EUR', 'THB', 25], ['EUR', 'ISK', 18], ['USD', 'KRW', 22], ['EUR', 'ZAR', 20],
  ['EUR', 'CAD', 8], ['EUR', 'CHF', 6], ['JPY', 'EUR', 3], ['AUD', 'USD', 2],
];

// Sum the value per (from, to) pair, or count rows when no value column is set.
function buildGraph(rows, maxNodes, nodeOrder) {
  const pairs = new Map();
  for (const [from, to, v] of rows) {
    if (from == null || to == null || from === '' || to === '') continue;
    const key = `${from}\u0000${to}`;
    pairs.set(key, (pairs.get(key) || 0) + v);
  }

  const totals = new Map();
  for (const [key, v] of pairs) {
    const [from, to] = key.split('\u0000');
    totals.set(from, (totals.get(from) || 0) + v);
    if (to !== from) totals.set(to, (totals.get(to) || 0) + v);
  }

  // Keep the largest N nodes and fold the rest into "Other".
  let keep = null;
  const limit = parseInt(maxNodes, 10);
  if (limit && totals.size > limit) {
    keep = new Set([...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit - 1)
      .map(([id]) => id));
  }
  const bucket = id => (!keep || keep.has(id) ? id : OTHER);

  const links = new Map();
  for (const [key, v] of pairs) {
    const [rawFrom, rawTo] = key.split('\u0000');
    const from = bucket(rawFrom);
    const to = bucket(rawTo);
    if (from === to) continue; // self-loops aren't drawn
    const k = `${from}\u0000${to}`;
    links.set(k, (links.get(k) || 0) + v);
  }

  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, sent: 0, received: 0 });
    return nodes.get(id);
  };
  const edges = [];
  for (const [k, v] of links) {
    const [from, to] = k.split('\u0000');
    node(from).sent += v;
    node(to).received += v;
    edges.push({ source: from, target: to, value: v });
  }

  const list = [...nodes.values()].map(n => ({ ...n, total: n.sent + n.received }));
  list.sort((a, b) => {
    if (a.id === OTHER) return 1;
    if (b.id === OTHER) return -1;
    return nodeOrder === 'Alphabetical' ? a.id.localeCompare(b.id) : b.total - a.total;
  });
  if (nodeOrder !== 'Alphabetical' && nodeOrder !== 'Largest first') {
    // Spread: walk the circle in golden-ratio steps so the biggest nodes
    // land far apart instead of next to each other.
    const n = list.length;
    const slots = new Array(n);
    const step = (Math.sqrt(5) - 1) / 2;
    const taken = new Set();
    list.forEach((node, i) => {
      let p = Math.floor(((i * step) % 1) * n);
      while (taken.has(p)) p = (p + 1) % n;
      taken.add(p);
      slots[p] = node;
    });
    return { nodes: slots, edges };
  }
  return { nodes: list, edges };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

function formatValue(v) {
  return Math.abs(v) >= 10000 ? d3.format('.3~s')(v) : d3.format(',.4~r')(v);
}

function render(svgEl, tipEl, graph, width, height, valueLabel) {
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  svg.attr('width', width).attr('height', height);
  if (!graph.nodes.length || width < 50 || height < 50) return;

  const unit = valueLabel ? ` ${esc(valueLabel)}` : '';
  const cx = width / 2;
  const cy = height / 2;
  const labelRoom = 44;
  const maxTotal = d3.max(graph.nodes, n => n.total) || 1;
  const outer = Math.max(20, Math.min(width, height) / 2 - labelRoom);
  const maxR = Math.max(6, Math.min(30, outer * 0.16));
  const R = outer - maxR;
  const rScale = d3.scaleSqrt().domain([0, maxTotal]).range([3.5, maxR]);
  const maxEdge = d3.max(graph.edges, e => e.value) || 1;
  const wScale = d3.scaleSqrt().domain([0, maxEdge]).range([0.6, Math.max(3, maxR * 0.35)]);

  // Start at the bottom and go clockwise.
  const pos = new Map();
  graph.nodes.forEach((n, i) => {
    const a = Math.PI / 2 + (i / graph.nodes.length) * 2 * Math.PI;
    pos.set(n.id, { ...n, a, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), r: rScale(n.total) });
  });

  svg.append('defs').append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 10)
    .attr('markerUnits', 'userSpaceOnUse')
    .attr('markerWidth', 8)
    .attr('markerHeight', 8)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L10,0L0,4')
    .attr('fill', EDGE_COLOR);

  // Curve each edge toward the centre and slightly to its left, so A→B and
  // B→A don't overlap. Trim the ends to the node edges.
  const edgePath = e => {
    const s = pos.get(e.source);
    const t = pos.get(e.target);
    const mx = (s.x + t.x) / 2;
    const my = (s.y + t.y) / 2;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = 0.12 * len;
    const qx = cx + (mx - cx) * 0.55 + (dy / len) * bend;
    const qy = cy + (my - cy) * 0.55 - (dx / len) * bend;
    const trim = (p, d) => {
      const vx = qx - p.x;
      const vy = qy - p.y;
      const l = Math.hypot(vx, vy) || 1;
      return [p.x + (vx / l) * d, p.y + (vy / l) * d];
    };
    const [x0, y0] = trim(s, s.r + 1);
    const [x1, y1] = trim(t, t.r + 2);
    return `M${x0},${y0}Q${qx},${qy} ${x1},${y1}`;
  };

  const tip = d3.select(tipEl);
  const showTip = (event, html) => {
    tip.html(html).style('opacity', 1);
    const box = svgEl.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    let x = event.clientX - box.left + 12;
    if (x + tw > width) x = event.clientX - box.left - tw - 12;
    tip.style('left', `${x}px`).style('top', `${event.clientY - box.top + 12}px`);
  };
  const hideTip = () => tip.style('opacity', 0);

  const edgeSel = svg.append('g')
    .attr('fill', 'none')
    .selectAll('path')
    .data([...graph.edges].sort((a, b) => b.value - a.value))
    .join('path')
    .attr('class', 'edge')
    .attr('d', edgePath)
    .attr('stroke', EDGE_COLOR)
    .attr('stroke-width', e => wScale(e.value))
    .attr('stroke-opacity', 0.75)
    .attr('marker-end', 'url(#arrow)')
    .on('mousemove', (event, e) => showTip(event,
      `<b>${esc(e.source)} → ${esc(e.target)}</b><br>${formatValue(e.value)}${unit}`))
    .on('mouseleave', hideTip);

  const nodeSel = svg.append('g')
    .selectAll('g')
    .data([...pos.values()])
    .join('g')
    .attr('class', 'node')
    .attr('transform', n => `translate(${n.x},${n.y})`);

  nodeSel.append('circle')
    .attr('r', n => n.r)
    .attr('fill', NODE_COLOR);

  nodeSel.append('text')
    .attr('class', 'label')
    .attr('dy', '0.35em')
    .each(function (n) {
      const deg = (n.a * 180) / Math.PI;
      const left = Math.cos(n.a) < 0;
      const off = n.r + 6;
      d3.select(this)
        .attr('transform', `rotate(${left ? deg + 180 : deg})`)
        .attr('x', left ? -off : off)
        .attr('text-anchor', left ? 'end' : 'start')
        .text(n.id);
    });

  // Hovering a node highlights its edges.
  nodeSel
    .on('mousemove', (event, n) => {
      edgeSel.attr('stroke-opacity', e => (e.source === n.id || e.target === n.id ? 0.95 : 0.12));
      nodeSel.attr('opacity', m => (m.id === n.id || graph.edges.some(e =>
        (e.source === n.id && e.target === m.id) || (e.target === n.id && e.source === m.id)) ? 1 : 0.35));
      showTip(event, `<b>${esc(n.id)}</b><br>Sent: ${formatValue(n.sent)}${unit}<br>Received: ${formatValue(n.received)}${unit}`);
    })
    .on('mouseleave', () => {
      edgeSel.attr('stroke-opacity', 0.75);
      nodeSel.attr('opacity', 1);
      hideTip();
    });
}

function useSize(ref) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function App() {
  const config = useConfig();
  const data = useElementData(config.source);
  const boxRef = React.useRef(null);
  const svgRef = React.useRef(null);
  const tipRef = React.useRef(null);
  const { width, height } = useSize(boxRef);

  const graph = React.useMemo(() => {
    let rows = [];
    if (!IN_SIGMA) {
      rows = SAMPLE;
    } else if (data?.[config.from] && data?.[config.to]) {
      const from = data[config.from];
      const to = data[config.to];
      const val = config.value ? data[config.value] : null;
      rows = from.map((f, i) => [f, to[i], val ? Number(val[i]) || 0 : 1]);
    }
    return buildGraph(rows, config.maxNodes, config.nodeOrder);
  }, [data, config.from, config.to, config.value, config.maxNodes, config.nodeOrder]);

  React.useEffect(() => {
    render(svgRef.current, tipRef.current, graph, width, height, config.valueLabel);
  }, [graph, width, height, config.valueLabel]);

  const title = IN_SIGMA ? config.title : 'Number of Payments by Currency (sample data)';
  return (
    <div className="App">
      {title ? <div className="App-title">{title}</div> : null}
      <div className="App-chart" ref={boxRef}>
        <svg ref={svgRef} />
        <div className="App-tip" ref={tipRef} />
      </div>
    </div>
  );
}

export default App;
