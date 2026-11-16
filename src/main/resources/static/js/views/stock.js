import { h, color, number, fill } from '../util.js';
import { t } from '../i18n.js';

// Stock management: one panel per product. Bars are the stock at the end of each period,
// labels above them the orders placed, the dashed line the safety stock. Below, how full the
// warehouse is in each period.

export function mount(root) {
  let built = null;   // DOM kept between frames so that bars glide from one plan to the next

  function build(plan) {
    const periods = Array.from({ length: plan.periods }, (_, i) => i);
    const period = (index) => t('stock.period.short', { n: index + 1 });
    const products = plan.products.map((product, index) => {
      const bars = periods.map(() => ({ i: h('i'), em: h('em', { class: 'none' }) }));
      const safety = h('div', { class: 'safety' }, h('span', {}, t('stock.safety', { n: product.safetyStock })));
      const el = h('div', { class: 'card product', style: { '--c': color(index) } },
        h('div', { class: 'product-head' },
          h('strong', {}, product.name),
          h('span', {}, t('stock.product', { lot: product.lotSize, max: product.lotSize * product.maxLots, initial: product.initialStock }))),
        h('div', { class: 'bars' }, safety, bars.map((bar) => h('div', { class: 'bar' }, bar.i, bar.em))),
        h('div', { class: 'axis' }, periods.map((index2) => h('span', {}, period(index2)))),
        h('div', { class: 'axis dim', title: t('stock.demand.title') }, product.demand.map((quantity) => h('span', {}, quantity))));
      return { el, bars, safety };
    });
    const cells = periods.map(() => ({ el: h('div', { class: 'cell' }), i: h('i'), span: h('span') }));
    cells.forEach((cell) => cell.el.append(cell.i, cell.span));
    const kpis = h('div', { class: 'kpis' });
    fill(root,
      kpis,
      h('p', { class: 'hint' }, t('stock.hint')),
      h('div', { class: 'products' }, products.map((product) => product.el)),
      h('div', { class: 'card warehouse' },
        h('div', { class: 'product-head' }, h('strong', {}, t('stock.warehouse')),
          h('span', {}, t('stock.warehouse.help', { capacity: plan.warehouseCapacity }))),
        h('div', { class: 'cells' }, cells.map((cell) => cell.el)),
        h('div', { class: 'axis' }, periods.map((index) => h('span', {}, period(index))))));
    return { products, cells, kpis, shape: shape(plan) };
  }

  const shape = (plan) => `${plan.periods}|${plan.products.map((product) => product.name).join(',')}`;

  return {
    update(plan) {
      if (!built || built.shape !== shape(plan)) built = build(plan);
      let orders = 0;
      let below = 0;
      plan.products.forEach((product, p) => {
        const stock = product.stock || product.demand.map(() => 0);
        const quantities = product.orders || product.demand.map(() => 0);
        const top = Math.max(product.safetyStock, ...stock.map(Math.abs), 1) * 1.25;
        built.products[p].safety.style.bottom = `${(product.safetyStock / top) * 100}%`;
        stock.forEach((level, index) => {
          const { i, em } = built.products[p].bars[index];
          const height = (Math.abs(level) / top) * 100;
          i.style.height = `${height}%`;
          i.parentElement.className = `bar ${level < 0 ? 'out' : level < product.safetyStock ? 'low' : ''}`;
          i.parentElement.title = [
            t('stock.bar', { product: product.name, period: index + 1, level }),
            level < 0 ? t('stock.bar.out') : null,
            t('stock.bar.demand', { n: product.demand[index] }),
            quantities[index] ? t('stock.bar.order', { n: quantities[index] }) : null].filter(Boolean).join(', ');
          em.textContent = quantities[index] ? `+${quantities[index]}` : '';
          em.className = quantities[index] ? '' : 'none';
          em.style.bottom = `calc(${height}% + 4px)`;
          if (quantities[index]) orders += 1;
          if (level < product.safetyStock) below += 1;
        });
      });
      const capacity = plan.warehouseCapacity;
      (plan.warehouseLoad || []).forEach((volume, index) => {
        const cell = built.cells[index];
        if (!cell) return;
        cell.i.style.height = `${capacity > 0 ? Math.min(100, (volume / capacity) * 100) : 0}%`;
        cell.el.className = `cell ${volume > capacity ? 'over' : ''}`;
        cell.span.textContent = volume;
        cell.el.title = t('stock.cell', { period: index + 1, volume, capacity });
      });
      const peak = Math.max(0, ...(plan.warehouseLoad || [0]));
      fill(built.kpis,
        h('div', { class: 'kpi' }, h('small', {}, t('stock.kpi.orders')), h('b', {}, orders)),
        h('div', { class: 'kpi' }, h('small', {}, t('stock.kpi.below')), h('b', {}, below)),
        h('div', { class: 'kpi' }, h('small', {}, t('stock.kpi.peak')), h('b', {}, `${capacity > 0 ? number((peak / capacity) * 100) : 0}%`)));
    },
  };
}

export function diff(prev, next) {
  if (!prev) return [];
  const out = [];
  next.products.forEach((product, p) => {
    const before = prev.products[p]?.orders || [];
    (product.orders || []).forEach((quantity, index) => {
      if ((before[index] || 0) !== (quantity || 0)) {
        out.push({ what: `${product.name} ${t('stock.period.short', { n: index + 1 })}`,
          text: t('stock.diff', { from: before[index] || 0, to: quantity || 0 }) });
      }
    });
  });
  return out;
}
