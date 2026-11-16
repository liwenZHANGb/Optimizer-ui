import { h, color, clone, flip, draggable, dropTarget, lockIcon, number, token, fill } from '../util.js';
import { t } from '../i18n.js';
import { createMap, siteMarker, routeLine, resolve } from './map.js';

// Vehicle routing: the routes on an OpenStreetMap map, and each route as an ordered list of
// stops. Drag a stop to another route or position; click a stop to pin the route up to it;
// switch "Pin route" to freeze a whole route. Then solve again.

/** Where travel times come from, as the API describes it, in the language of the page. */
function travelSource(text) {
  if (!text) return t('vrp.source.none');
  const straight = /^straight line x ([\d.]+) at ([\d.]+) km\/h$/.exec(text);
  if (straight) return t('vrp.source.straight', { factor: straight[1], speed: straight[2] });
  const random = /^random, ([\d.]+) to ([\d.]+) min between sites \(seed (-?\d+)\)$/.exec(text);
  if (random) return t('vrp.source.random', { min: random[1], max: random[2], seed: random[3] });
  const roads = /^roads \(OSRM, (.*)\)$/.exec(text);
  return roads ? t('vrp.source.roads', { server: roads[1] }) : text;
}

export function mount(root, ctx) {
  let current = null;
  const mapEl = h('div', { class: 'map' });
  const side = h('div', {});
  fill(root, h('div', { class: 'split' }, mapEl, side));
  const view = createMap(mapEl);

  const vehicleOf = (plan) => {
    const owner = new Map();
    plan.vehicles.forEach((vehicle, index) => (vehicle.visits || []).forEach((name) => owner.set(name, index)));
    return owner;
  };

  function drawMap(plan, moved) {
    const owner = vehicleOf(plan);
    const byName = new Map(plan.customers.map((customer) => [customer.name, customer]));
    const depot = [plan.depot.latitude, plan.depot.longitude];
    view.routes.clearLayers();
    view.sites.clearLayers();
    plan.vehicles.forEach((vehicle, index) => {
      const visits = (vehicle.visits || []).map((name) => byName.get(name)).filter(Boolean);
      if (visits.length === 0) return;
      const points = [depot, ...visits.map((customer) => [customer.latitude, customer.longitude]), depot];
      const pinned = vehicle.pinned ? visits.length : vehicle.pinnedVisits || 0;
      routeLine(points, resolve(color(index))).addTo(view.routes);
      if (pinned > 0) {
        // The part of the route that is settled is drawn heavier.
        routeLine(points.slice(0, pinned + 1), token('--pin'), { weight: 6 }).setStyle({ opacity: 0.35 }).addTo(view.routes);
      }
    });
    plan.customers.forEach((customer) => {
      const index = owner.get(customer.name);
      const size = 10 + Math.round(Math.min(customer.demand, 30) / 3);
      siteMarker([customer.latitude, customer.longitude], {
        cls: `${index === undefined ? 'unvisited' : ''} ${moved.has(customer.name) ? 'pulse' : ''}`,
        colour: index === undefined ? null : color(index),
        size,
        label: `${customer.name} · ${t('vrp.demand', { n: customer.demand })} · ${index === undefined ? t('vrp.unvisited') : plan.vehicles[index].name}`,
      }).addTo(view.sites);
    });
    siteMarker(depot, { cls: 'depot', size: 14, label: plan.depot.name }).addTo(view.sites);
    view.fit([depot, ...plan.customers.map((customer) => [customer.latitude, customer.longitude])]);
  }

  function drawSide(plan) {
    const editable = ctx.editable();
    const byName = new Map(plan.customers.map((customer) => [customer.name, customer]));
    const edit = (change) => {
      const next = clone(plan);
      change(next);
      return ctx.onEdit(next);
    };

    /** Moves a customer to a route, before the stop `before` or at the end; null route means "not visited". */
    const move = (name, toVehicle, before) => edit((next) => {
      for (const vehicle of next.vehicles) {
        const at = (vehicle.visits || []).indexOf(name);
        if (at >= 0) {
          vehicle.visits.splice(at, 1);
          if (at < (vehicle.pinnedVisits || 0)) vehicle.pinnedVisits -= 1;
        }
      }
      if (next.unvisited) next.unvisited = next.unvisited.filter((other) => other !== name);
      if (toVehicle === null) {
        if (next.unvisited) next.unvisited.push(name);
        return;
      }
      const target = next.vehicles[toVehicle];
      target.visits = target.visits || [];
      let at = before ? target.visits.indexOf(before) : target.visits.length;
      if (at < 0) at = target.visits.length;
      // Nothing is inserted into the pinned start of a route.
      target.visits.splice(Math.max(at, target.pinnedVisits || 0), 0, name);
    });

    const stop = (vehicle, vIndex, name, index) => {
      const pinned = vehicle.pinned || index < (vehicle.pinnedVisits || 0);
      const customer = byName.get(name);
      const chip = h('span', {
        class: `chip ${pinned ? 'pinned' : ''}`, dataset: { key: name }, style: { '--c': color(vIndex) },
        title: [`${name} · ${t('vrp.demand', { n: customer ? customer.demand : '?' })}`,
          editable && !vehicle.pinned ? t(pinned ? 'vrp.hint.pinned' : 'vrp.hint.free') : null].filter(Boolean).join(' · '),
      }, pinned ? lockIcon() : null, name);
      if (editable && !vehicle.pinned) {
        if (!pinned) draggable(chip, name);
        dropTarget(chip, (key) => { if (key !== name) move(key, vIndex, name); });
        chip.addEventListener('click', () => edit((next) => {
          const mine = next.vehicles[vIndex];
          mine.pinnedVisits = index + 1 === (mine.pinnedVisits || 0) ? index : index + 1;
        }));
      }
      return chip;
    };

    const route = (vehicle, vIndex) => {
      const visits = vehicle.visits || [];
      const load = vehicle.load ?? 0;
      const stops = h('div', { class: 'stops' },
        h('span', { class: 'end' }, t('vrp.depot')),
        visits.flatMap((name, i) => [h('span', { class: 'arrow' }, '›'), stop(vehicle, vIndex, name, i)]),
        h('span', { class: 'arrow' }, '›'), h('span', { class: 'end' }, t('vrp.depot')));
      if (editable && !vehicle.pinned) dropTarget(stops, (key) => move(key, vIndex, null));
      return h('div', { class: `card route ${vehicle.pinned ? 'pinned' : ''}`, style: { '--c': color(vIndex) } },
        h('div', { class: 'route-head' },
          h('strong', {}, vehicle.name),
          h('span', { class: 'muted' }, t('vrp.stops', { count: visits.length })),
          h('span', { class: 'spacer' }),
          editable && visits.length > 0 ? h('label', { class: 'muted', style: { display: 'flex', gap: '7px', 'align-items': 'center', 'font-size': '12px' } },
            t('vrp.pinRoute'),
            h('input', { type: 'checkbox', class: 'switch', checked: vehicle.pinned,
              onchange: (e) => edit((next) => { next.vehicles[vIndex].pinned = e.target.checked; }) })) : null),
        h('div', { class: 'route-figures' },
          h('span', {}, t('vrp.load', { load, capacity: vehicle.capacity })),
          h('span', {}, t('unit.kilometres', { n: number(vehicle.km ?? 0, 1) })),
          h('span', {}, t('unit.minutes', { n: vehicle.minutes ?? 0 }))),
        h('div', { class: `meter ${load > vehicle.capacity ? 'over' : ''}` },
          h('i', { style: { width: `${vehicle.capacity > 0 ? Math.min(100, (load / vehicle.capacity) * 100) : 0}%` } })),
        stops);
    };

    const routed = vehicleOf(plan);
    const unvisitedNames = plan.customers.map((customer) => customer.name).filter((name) => !routed.has(name));
    const unvisited = h('div', { class: 'stops' }, unvisitedNames.map((name) => {
      const chip = h('span', { class: 'chip', dataset: { key: name }, title: `${name} · ${t('vrp.demand', { n: byName.get(name)?.demand ?? '?' })}` }, name);
      if (editable) draggable(chip, name);
      return chip;
    }));
    if (editable) dropTarget(unvisited, (key) => move(key, null, null));

    // Geocoding: a new customer is given by its address; OpenStreetMap finds where it is.
    const address = h('input', { type: 'text', placeholder: t('vrp.address'), 'aria-label': t('vrp.address') });
    const demand = h('input', { type: 'number', min: 1, max: 100, value: 10, 'aria-label': t('vrp.demand.label'), title: t('vrp.demand.label') });
    const add = h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
      const typed = address.value.trim();
      if (!typed) return;
      add.disabled = true;
      add.textContent = t('vrp.locating');
      try {
        const found = await ctx.geocode(typed);
        await edit((next) => {
          let name = typed.split(',')[0].trim() || typed;
          while (next.customers.some((customer) => customer.name === name)) name += ' 2';
          next.customers.push({ name, address: typed, latitude: found.latitude, longitude: found.longitude,
            demand: Math.max(1, Math.round(Number(demand.value)) || 1) });
          if (next.unvisited) next.unvisited.push(name);
        });
      } catch (error) {
        ctx.fail(error);
      } finally {
        // Still here when nothing was redrawn: the button must not stay busy.
        add.disabled = false;
        add.textContent = t('vrp.add');
      }
    } }, t('vrp.add'));

    const minutes = plan.totalMinutes || 0;
    fill(side,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, t('vrp.kpi.time')), h('b', {}, t('unit.hoursMinutes', { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') }))),
        h('div', { class: 'kpi' }, h('small', {}, t('vrp.kpi.distance')), h('b', {}, t('unit.kilometres', { n: number(plan.totalKm || 0, 1) }))),
        h('div', { class: 'kpi' }, h('small', {}, t('vrp.unvisited.title')), h('b', {}, unvisitedNames.length))),
      h('p', { class: 'hint' }, t('vrp.source', { source: travelSource(plan.travelSource) })),
      editable ? h('p', { class: 'hint' }, t('vrp.hint')) : null,
      h('div', { class: `routes ${editable ? 'editable' : ''}` },
        plan.vehicles.map(route),
        h('div', { class: 'card route' },
          h('div', { class: 'route-head' }, h('strong', {}, t('vrp.unvisited.title')),
            h('span', { class: 'muted' }, unvisitedNames.length === 0 ? t('vrp.allServed') : t('vrp.customers', { count: unvisitedNames.length }))),
          unvisited,
          editable ? h('div', { class: 'adder' }, address, demand, add) : null)));
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set(changes(current, plan).map((change) => change.customer));
      drawMap(plan, animate ? moved : new Set());
      flip(side, () => drawSide(plan), moved, animate && current !== null);
      current = plan;
      view.resize();
    },
    destroy() { view.remove(); },
  };
}

function changes(prev, next) {
  if (!prev) return [];
  const where = (plan) => {
    const owner = new Map();
    plan.vehicles.forEach((vehicle) => (vehicle.visits || []).forEach((name) => owner.set(name, vehicle.name)));
    return owner;
  };
  const before = where(prev);
  const after = where(next);
  return next.customers
    .filter((customer) => before.get(customer.name) !== after.get(customer.name))
    .map((customer) => ({ customer: customer.name, from: before.get(customer.name), to: after.get(customer.name) }));
}

export function diff(prev, next) {
  return changes(prev, next).map((change) => ({
    what: change.customer,
    text: `${change.from || t('vrp.unvisited')} → ${change.to || t('vrp.unvisited')}`,
  }));
}
