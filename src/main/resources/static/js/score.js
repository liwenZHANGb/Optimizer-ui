import { h, number, token } from './util.js';
import { t, tApi } from './i18n.js';

/** The three levels of the score, coloured by what they mean. */
export function renderScore(el, score) {
  el.replaceChildren();
  if (!score) return;
  const cell = (label, value, cls) => h('div', { class: `score-cell ${cls}` }, h('small', {}, label), h('b', {}, number(value)));
  el.append(
    cell(t('level.hard'), score.hard, score.hard < 0 ? 'bad' : 'ok'),
    cell(t('level.medium'), score.medium, score.medium < 0 ? 'warn' : ''),
    cell(t('level.soft'), score.soft, ''));
  el.title = t(score.feasible ? 'score.feasible' : 'score.infeasible', { score: score.text });
}

/** A weight as the API writes it ("2soft"), in words. */
export function weightText(weight) {
  const parts = /^(-?\d+)(hard|medium|soft)$/.exec(weight);
  return parts ? `${number(parts[1])} ${t(`level.${parts[2]}`).toLowerCase()}` : weight;
}

/** One line per constraint: how many times it matched and what it costs on its level. */
export function renderAnalysis(el, lines) {
  el.replaceChildren();
  if (!lines || lines.length === 0) {
    el.append(h('p', { class: 'muted' }, t('score.none')));
    return;
  }
  const largest = {};
  for (const line of lines) largest[line.level] = Math.max(largest[line.level] || 0, Math.abs(line.points));
  for (const line of lines) {
    const share = largest[line.level] ? Math.abs(line.points) / largest[line.level] * 100 : 0;
    el.append(h('div', { class: `line ${line.level} ${line.points !== 0 ? 'hit' : ''}` },
      h('div', { class: 'line-head' }, h('span', {}, tApi(`constraint.${line.key}`, line.name)),
        h('span', {}, `${number(line.points)} ${t(`level.${line.level}`).toLowerCase()}`)),
      h('div', { class: 'line-meta' }, t('score.line', { weight: weightText(line.weight), matches: t('score.matches', { count: line.matches, n: number(line.matches) }) })),
      h('div', { class: 'line-bar' }, h('i', { style: { width: `${share}%` } }))));
  }
}

/**
 * The search at a glance: the soft cost of every improvement, left to right, the highest
 * cost at the top and the lowest at the bottom. Frames that are not yet feasible (or still
 * leave more undone than the final plan) sit on the top edge, marked with a dot.
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
  const y = (f) => {
    if (!settled(f)) return 3;
    return max === min ? height / 2 : height - 4 - ((-f.score.soft - min) / (max - min)) * (height - 10);
  };
  const ns = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', frames.map((f, i) => `${x(i).toFixed(1)},${y(f).toFixed(1)}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', token('--accent-hover'));
  line.setAttribute('stroke-width', '1.6');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);
  frames.forEach((f, i) => {
    if (settled(f)) return;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', 3);
    dot.setAttribute('r', 1.8);
    dot.setAttribute('fill', token(f.score.hard < 0 ? '--bad' : '--warn'));
    svg.append(dot);
  });
  if (shown >= 0 && shown < frames.length) {
    const cursor = document.createElementNS(ns, 'line');
    cursor.setAttribute('x1', x(shown));
    cursor.setAttribute('x2', x(shown));
    cursor.setAttribute('y1', 0);
    cursor.setAttribute('y2', height);
    cursor.setAttribute('stroke', token('--pin'));
    cursor.setAttribute('stroke-opacity', '.55');
    svg.append(cursor);
  }
}
