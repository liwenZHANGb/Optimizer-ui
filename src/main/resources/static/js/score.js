import { h, number } from './util.js';

/** The three levels of the score, coloured by what they mean. */
export function renderScore(el, score) {
  el.replaceChildren();
  if (!score) return;
  const cell = (label, value, cls) => h('div', { class: `score-cell ${cls}` }, h('small', {}, label), h('b', {}, number(value)));
  el.append(
    cell('Hard', score.hard, score.hard < 0 ? 'bad' : 'ok'),
    cell('Medium', score.medium, score.medium < 0 ? 'warn' : ''),
    cell('Soft', score.soft, ''));
  el.title = score.feasible ? `${score.text} - feasible` : `${score.text} - a hard rule is broken`;
}

/** One line per constraint: how many times it matched and what it costs on its level. */
export function renderAnalysis(el, lines) {
  el.replaceChildren();
  if (!lines || lines.length === 0) {
    el.append(h('p', { class: 'muted' }, 'No constraint is active.'));
    return;
  }
  const largest = {};
  for (const line of lines) largest[line.level] = Math.max(largest[line.level] || 0, Math.abs(line.points));
  for (const line of lines) {
    const share = largest[line.level] ? Math.abs(line.points) / largest[line.level] * 100 : 0;
    el.append(h('div', { class: `line ${line.level} ${line.points !== 0 ? 'hit' : ''}` },
      h('div', { class: 'line-head' }, h('span', {}, line.name), h('span', {}, `${number(line.points)} ${line.level}`)),
      h('div', { class: 'line-meta' }, `weight ${line.weight} · ${number(line.matches)} match${line.matches === 1 ? '' : 'es'}`),
      h('div', { class: 'line-bar' }, h('i', { style: { width: `${share}%` } }))));
  }
}

/**
 * The search at a glance: the soft cost of every improvement, left to right. Frames that
 * are not yet feasible (or still leave more undone than the final plan) sit on the top edge.
 */
export function drawChart(svg, frames, shown) {
  const width = svg.clientWidth || 600;
  const height = 32;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();
  if (frames.length < 2) return;
  const last = frames[frames.length - 1].score;
  const settled = (f) => f.score.hard >= 0 && f.score.medium === last.medium;
  const costs = frames.filter(settled).map((f) => -f.score.soft);
  const min = Math.min(...costs);
  const max = Math.max(...costs);
  const x = (i) => (i / (frames.length - 1)) * (width - 2) + 1;
  // Cost goes down as the search improves: the highest cost is at the top, the lowest at the bottom.
  const y = (f) => {
    if (!settled(f)) return 3;
    return max === min ? height / 2 : height - 4 - ((-f.score.soft - min) / (max - min)) * (height - 10);
  };
  const ns = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', frames.map((f, i) => `${x(i).toFixed(1)},${(height - y(f) + 3).toFixed(1)}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#5a92f7');
  line.setAttribute('stroke-width', '1.6');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);
  frames.forEach((f, i) => {
    if (settled(f)) return;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', 3);
    dot.setAttribute('r', 1.8);
    dot.setAttribute('fill', f.score.hard < 0 ? '#f2706b' : '#f5b942');
    svg.append(dot);
  });
  if (shown >= 0 && shown < frames.length) {
    const cursor = document.createElementNS(ns, 'line');
    cursor.setAttribute('x1', x(shown));
    cursor.setAttribute('x2', x(shown));
    cursor.setAttribute('y1', 0);
    cursor.setAttribute('y2', height);
    cursor.setAttribute('stroke', '#fff');
    cursor.setAttribute('stroke-opacity', '.55');
    svg.append(cursor);
  }
}
