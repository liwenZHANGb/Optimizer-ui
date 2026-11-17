import { h, fill, number } from '../util.js';
import { t, tApi, tMessage } from '../i18n.js';

// Stock sizing: the cost against its theoretical minimum, the six business rules and how far
// the plan breaks them, the list of article-store series and, for the one selected, its
// periods: the band between stock min and stock max, the stock it starts and ends with, and
// its demand.

const SHOWN = 150;
const keyOf = (series) => `${series.site}/${series.article}`;
const money = (value) => (value === null || value === undefined ? '–' : number(value, 2));
const brokenIn = (series) => series.periods.reduce((count, period) => count + (period.broken ? 1 : 0), 0);
const decided = (series) => series.periods.every((period) => period.stockMin !== undefined && period.stockMin !== null);
/** The day a period starts, without its year when it is a date. */
const shortLabel = (period) => (/^\d{4}-\d{2}-\d{2}$/.test(period.label || '') ? period.label.slice(5) : period.label);

export function mount(root) {
  let plan = null;
  let selected = null;
  let filter = '';
  let only = 'all';

  const kpis = h('div', { class: 'kpis' });
  const notes = h('div');
  const rules = h('div', { class: 'ss-rules' });
  const tools = h('div', { class: 'ss-tools' });
  const rows = h('div', { class: 'ss-rows' });
  const detail = h('div', { class: 'card ss-detail' });
  fill(root, kpis, notes, rules,
    h('div', { class: 'ss-layout' }, h('div', { class: 'card ss-list' }, tools, rows), detail));

  function drawSummary() {
    const summary = plan.summary || {};
    const kpi = (label, value, tone) => h('div', { class: 'kpi' }, h('small', {}, label), h('b', { class: tone || null }, value));
    fill(kpis,
      kpi(t('stocksizing.kpi.cost'), money(summary.cost)),
      kpi(t('stocksizing.kpi.minimum'), money(summary.minimumCost)),
      kpi(t('stocksizing.kpi.index'), summary.performanceIndex ? `${number(summary.performanceIndex * 100, 2)}%` : '–'),
      kpi(t('stocksizing.kpi.series'), t('stocksizing.kpi.series.value', { decided: summary.decided ?? 0, all: summary.series ?? plan.series.length })),
      kpi(t('stocksizing.kpi.periods'), number(summary.periods ?? 0)),
      summary.unsolvable ? kpi(t('stocksizing.kpi.unsolvable'), summary.unsolvable, 'bad') : null);
    fill(notes, (plan.warnings || []).map((warning) =>
      h('p', { class: 'hint ss-warning' }, tMessage('stocksizing.warning', warning))));
    fill(rules, (summary.rules || []).map((rule) => h('div', {
      class: `ss-rule ${rule.periods ? (rule.level === 'disabled' ? 'off' : 'broken') : ''}`,
      title: rule.periods ? t('stocksizing.rule.broken', { periods: rule.periods, units: number(rule.units) }) : t('stocksizing.rule.kept') },
    h('span', {}, tApi(`constraint.${rule.key}`, rule.name)),
    h('span', { class: `badge ${rule.level === 'hard' ? '' : 'custom'}` }, t(`stocksizing.level.${rule.level}`)),
    h('b', {}, rule.periods ? number(rule.periods) : '✓'))));
  }

  function matching() {
    const words = filter.trim().toLowerCase();
    return plan.series.filter((series) => (!words || keyOf(series).toLowerCase().includes(words))
      && (only === 'all' || (only === 'unsolvable' && series.unsolvable) || (only === 'broken' && brokenIn(series) > 0)));
  }

  function drawList() {
    const found = matching();
    fill(rows,
      h('table', { class: 'violations ss-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, t('stocksizing.col.article')), h('th', {}, t('stocksizing.col.site')),
          h('th', { class: 'num' }, t('stocksizing.col.periods')), h('th', { class: 'num' }, t('stocksizing.col.demand')),
          h('th', { class: 'num' }, t('stocksizing.col.cost')), h('th', { class: 'num' }, t('stocksizing.col.gap')), h('th', {}, ''))),
        h('tbody', {}, found.slice(0, SHOWN).map((series) => {
          const broken = brokenIn(series);
          const gap = series.cost !== undefined && series.cost !== null ? series.cost - series.minimumCost : null;
          return h('tr', { class: keyOf(series) === selected ? 'on' : null, tabindex: '0',
            onclick: () => choose(series),
            onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(series); } } },
          h('td', {}, h('code', {}, series.article)), h('td', {}, series.site || '–'),
          h('td', { class: 'num' }, series.periods.length),
          h('td', { class: 'num' }, number(series.periods.reduce((sum, period) => sum + period.demand, 0))),
          h('td', { class: 'num' }, money(series.cost)),
          h('td', { class: 'num' }, gap === null ? '–' : number(gap, 2)),
          h('td', {}, series.unsolvable ? h('span', { class: 'ss-chip bad' }, t('stocksizing.state.unsolvable'))
            : broken ? h('span', { class: 'ss-chip warn' }, t('stocksizing.state.broken', { n: broken }))
              : decided(series) ? h('span', { class: 'ss-chip ok' }, '✓') : null));
        }))),
      found.length > SHOWN ? h('p', { class: 'muted ss-more' }, t('stocksizing.more', { shown: SHOWN, all: number(found.length) })) : null,
      found.length === 0 ? h('p', { class: 'muted ss-more' }, t('stocksizing.none')) : null);
  }

  function drawTools() {
    fill(tools,
      h('input', { type: 'search', value: filter, placeholder: t('stocksizing.search'), 'aria-label': t('stocksizing.search'),
        oninput: (e) => { filter = e.target.value; drawList(); } }),
      h('select', { 'aria-label': t('stocksizing.filter'), onchange: (e) => { only = e.target.value; drawList(); } },
        ['all', 'broken', 'unsolvable'].map((value) => h('option', { value, selected: value === only }, t(`stocksizing.filter.${value}`)))));
  }

  function choose(series) {
    selected = keyOf(series);
    drawList();
    drawDetail();
  }

  function drawDetail() {
    const series = plan.series.find((one) => keyOf(one) === selected) || plan.series[0];
    if (!series) { fill(detail); return; }
    const done = decided(series);
    const top = Math.max(1, ...series.periods.flatMap((period) =>
      [period.demand, period.stockMax || 0, period.initialStock || 0, period.projectedStock || 0])) * 1.15;
    const percent = (value) => `${(Math.max(0, value) / top) * 100}%`;
    fill(detail,
      h('div', { class: 'product-head' },
        h('strong', {}, series.site ? `${series.article} · ${series.site}` : series.article),
        h('span', {}, t(series.openingStockFromData === false ? 'stocksizing.opening.default' : 'stocksizing.opening', { n: number(series.openingStock) }))),
      series.unsolvable ? h('p', { class: 'hint ss-warning' }, `${t('stocksizing.state.unsolvable')}: ${series.unsolvable}`) : null,
      h('div', { class: 'ss-chart' }, series.periods.map((period) => {
        const title = [
          `${period.label}: ${t('stocksizing.tip.demand', { n: number(period.demand) })}`,
          done ? t('stocksizing.tip.policy', { min: number(period.stockMin), max: number(period.stockMax) }) : null,
          done && period.initialStock !== undefined ? t('stocksizing.tip.stock', { from: number(period.initialStock), to: number(period.projectedStock) }) : null,
          period.replenishment ? t('stocksizing.tip.order', { n: number(period.replenishment) }) : null,
          ...(period.broken || []).map((key) => `✕ ${tApi(`constraint.${key}`, key)}`)].filter(Boolean).join('\n');
        return h('div', { class: `ss-col ${period.broken ? 'broken' : ''}`, title },
          done ? h('i', { class: 'ss-band', style: { bottom: percent(period.stockMin), height: percent(period.stockMax - period.stockMin) } }) : null,
          h('i', { class: 'ss-demand', style: { height: percent(period.demand) } }),
          done && period.initialStock !== undefined ? h('i', { class: 'ss-start', style: { bottom: percent(period.initialStock) } }) : null,
          done && period.projectedStock !== undefined
            ? h('i', { class: `ss-end ${period.projectedStock < 0 ? 'out' : ''}`, style: { bottom: percent(period.projectedStock) } }) : null,
          period.replenishment ? h('em', {}, `+${number(period.replenishment)}`) : null);
      })),
      h('div', { class: 'ss-axis' }, series.periods.map((period) => h('span', {}, shortLabel(period)))),
      h('div', { class: 'ss-legend' },
        h('span', {}, h('i', { class: 'ss-band' }), t('stocksizing.legend.band')),
        h('span', {}, h('i', { class: 'ss-demand' }), t('stocksizing.legend.demand')),
        h('span', {}, h('i', { class: 'ss-start' }), t('stocksizing.legend.start')),
        h('span', {}, h('i', { class: 'ss-end' }), t('stocksizing.legend.end'))),
      h('div', { class: 'ss-periods' }, h('table', { class: 'violations ss-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, t('stocksizing.col.period')), h('th', { class: 'num' }, t('stocksizing.col.demand')),
          h('th', { class: 'num' }, t('stocksizing.col.price')), h('th', { class: 'num' }, t('stocksizing.col.min')),
          h('th', { class: 'num' }, t('stocksizing.col.max')), h('th', { class: 'num' }, t('stocksizing.col.start')),
          h('th', { class: 'num' }, t('stocksizing.col.order')), h('th', { class: 'num' }, t('stocksizing.col.end')))),
        h('tbody', {}, series.periods.map((period) => h('tr', { class: period.broken ? 'broken' : null },
          h('td', {}, period.label), h('td', { class: 'num' }, number(period.demand)),
          h('td', { class: 'num' }, number(period.price, 2)),
          ...[period.stockMin, period.stockMax, period.initialStock, period.replenishment, period.projectedStock]
            .map((value) => h('td', { class: 'num' }, value === undefined || value === null ? '–' : number(value)))))))),
      h('p', { class: 'muted ss-cost' }, done && series.cost !== undefined
        ? t('stocksizing.detail.cost', { cost: money(series.cost), minimum: money(series.minimumCost) })
        : t('stocksizing.detail.pending')));
  }

  return {
    update(next) {
      plan = next;
      if (!plan.series.some((series) => keyOf(series) === selected)) selected = plan.series[0] ? keyOf(plan.series[0]) : null;
      drawSummary();
      drawTools();
      drawList();
      drawDetail();
    },
  };
}

export function diff(prev, next) {
  if (!prev) return [];
  const before = new Map(prev.series.map((series) => [keyOf(series), series]));
  const out = [];
  let more = 0;
  next.series.forEach((series) => {
    const old = before.get(keyOf(series));
    series.periods.forEach((period, index) => {
      const was = old?.periods[index] || {};
      if ((was.stockMin ?? null) === (period.stockMin ?? null) && (was.stockMax ?? null) === (period.stockMax ?? null)) return;
      if (out.length >= 30) { more += 1; return; }
      const pair = (one) => (one.stockMin === undefined || one.stockMin === null ? '–' : `(${one.stockMin}, ${one.stockMax})`);
      out.push({ what: `${series.article} ${shortLabel(period)}`, text: `${pair(was)} → ${pair(period)}` });
    });
  });
  if (more) out.push({ what: '…', text: t('stocksizing.diff.more', { n: number(more) }) });
  return out;
}
