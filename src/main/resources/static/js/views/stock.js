import { h, color, number } from '../util.js';

// Stock management: one panel per product. Bars are the stock at the end of each period,
// white labels the orders placed, the dashed line the safety stock. Below, how full the
// warehouse is in each period.

export function mount(root) {
  let built = null;   // DOM kept between frames so that bars glide from one plan to the next

  function build(plan) {
    const periods = Array.from({ length: plan.periods }, (_, i) => i);
    const products = plan.products.map((product, index) => {
      const bars = periods.map(() => ({ i: h('i'), em: h('em', { class: 'none' }) }));
      const safety = h('div', { class: 'safety' }, h('span', {}, `safety ${product.safetyStock}`));
      const el = h('div', { class: 'card product', style: { '--c': color(index) } },
        h('div', { class: 'product-head' },
          h('strong', {}, product.name),
          h('span', {}, `lots of ${product.lotSize} · up to ${product.lotSize * product.maxLots} per order · starts at ${product.initialStock}`)),
        h('div', { class: 'bars' }, safety, bars.map((b) => h('div', { class: 'bar' }, b.i, b.em))),
        h('div', { class: 'axis' }, periods.map((t) => h('span', {}, `P${t + 1}`))),
        h('div', { class: 'axis dim', title: 'Demand of the period' }, product.demand.map((d) => h('span', {}, d))));
      return { el, bars, safety };
    });
    const cells = periods.map(() => ({ el: h('div', { class: 'cell' }), i: h('i'), span: h('span') }));
    cells.forEach((c) => c.el.append(c.i, c.span));
    const kpis = h('div', { class: 'kpis' });
    root.replaceChildren(
      kpis,
      h('p', { class: 'hint' }, 'Bars: stock at the end of each period. White labels: orders placed. Grey figures: demand.'),
      h('div', { class: 'products' }, products.map((p) => p.el)),
      h('div', { class: 'card warehouse' },
        h('div', { class: 'product-head' }, h('strong', {}, 'Warehouse'),
          h('span', {}, `space used at the end of each period, capacity ${plan.warehouseCapacity}`)),
        h('div', { class: 'cells' }, cells.map((c) => c.el)),
        h('div', { class: 'axis' }, periods.map((t) => h('span', {}, `P${t + 1}`)))));
    return { products, cells, kpis, shape: shape(plan) };
  }

  const shape = (plan) => `${plan.periods}|${plan.products.map((p) => p.name).join(',')}`;

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
        stock.forEach((level, t) => {
          const { i, em } = built.products[p].bars[t];
          const height = (Math.abs(level) / top) * 100;
          i.style.height = `${height}%`;
          i.parentElement.className = `bar ${level < 0 ? 'out' : level < product.safetyStock ? 'low' : ''}`;
          i.parentElement.title = `${product.name}, period ${t + 1}: stock ${level}`
            + (level < 0 ? ' (demand not served)' : '') + `, demand ${product.demand[t]}`
            + (quantities[t] ? `, order ${quantities[t]}` : '');
          em.textContent = quantities[t] ? `+${quantities[t]}` : '';
          em.className = quantities[t] ? '' : 'none';
          em.style.bottom = `calc(${height}% + 4px)`;
          if (quantities[t]) orders += 1;
          if (level < product.safetyStock) below += 1;
        });
      });
      (plan.warehouseLoad || []).forEach((volume, t) => {
        const cell = built.cells[t];
        cell.i.style.height = `${Math.min(100, (volume / plan.warehouseCapacity) * 100)}%`;
        cell.el.className = `cell ${volume > plan.warehouseCapacity ? 'over' : ''}`;
        cell.span.textContent = volume;
        cell.el.title = `Period ${t + 1}: ${volume} of ${plan.warehouseCapacity}`;
      });
      const peak = Math.max(0, ...(plan.warehouseLoad || [0]));
      built.kpis.replaceChildren(
        h('div', { class: 'kpi' }, h('small', {}, 'Orders placed'), h('b', {}, orders)),
        h('div', { class: 'kpi' }, h('small', {}, 'Periods below safety stock'), h('b', {}, below)),
        h('div', { class: 'kpi' }, h('small', {}, 'Peak warehouse use'), h('b', {}, `${number((peak / plan.warehouseCapacity) * 100)}%`)));
    },
  };
}

export function diff(prev, next) {
  if (!prev) return [];
  const out = [];
  next.products.forEach((product, p) => {
    const before = prev.products[p]?.orders || [];
    (product.orders || []).forEach((quantity, t) => {
      if ((before[t] || 0) !== quantity) {
        out.push({ what: `${product.name} P${t + 1}`, text: `order ${before[t] || 0} → ${quantity}` });
      }
    });
  });
  return out;
}
