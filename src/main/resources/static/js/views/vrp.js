import { h, color, clone, flip, draggable, dropTarget, lockIcon, number } from '../util.js';
import { createMap, siteMarker, routeLine, resolve } from './map.js';

// Vehicle routing: the routes on an OpenStreetMap map, and each route as an ordered list of
// stops. Drag a stop to another route or position; click a stop to pin the route up to it;
// switch "Pin route" to freeze a whole route. Then solve again.

export function mount(root, ctx) {
  let current = null;
  const mapEl = h('div', { class: 'map' });
  const side = h('div', {});
  root.replaceChildren(h('div', { class: 'split' }, mapEl, side));
  const view = createMap(mapEl);

  const vehicleOf = (plan) => {
    const owner = new Map();
    plan.vehicles.forEach((vehicle, index) => (vehicle.visits || []).forEach((name) => owner.set(name, index)));
    return owner;
  };

  function drawMap(plan, moved) {
    const owner = vehicleOf(plan);
    const byName = new Map(plan.customers.map((c) => [c.name, c]));
    const depot = [plan.depot.latitude, plan.depot.longitude];
    view.routes.clearLayers();
    view.sites.clearLayers();
    plan.vehicles.forEach((vehicle, index) => {
      const visits = (vehicle.visits || []).map((name) => byName.get(name)).filter(Boolean);
      if (visits.length === 0) return;
      const points = [depot, ...visits.map((c) => [c.latitude, c.longitude]), depot];
      const colour = resolve(color(index));
      const pinned = vehicle.pinned ? visits.length : vehicle.pinnedVisits || 0;
      routeLine(points, colour).addTo(view.routes);
      if (pinned > 0) {
        // The part of the route that is settled is drawn heavier.
        routeLine(points.slice(0, pinned + 1), '#ffffff', { weight: 6 }).setStyle({ opacity: 0.35 }).addTo(view.routes);
      }
    });
    plan.customers.forEach((customer) => {
      const index = owner.get(customer.name);
      const size = 10 + Math.round(Math.min(customer.demand, 30) / 3);
      siteMarker([customer.latitude, customer.longitude], {
        cls: `${index === undefined ? 'unvisited' : ''} ${moved.has(customer.name) ? 'pulse' : ''}`,
        colour: index === undefined ? null : color(index),
        size,
        label: `${customer.name} · demand ${customer.demand}${index === undefined ? ' · not visited' : ` · ${plan.vehicles[index].name}`}`,
      }).addTo(view.sites);
    });
    siteMarker(depot, { cls: 'depot', size: 14, label: plan.depot.name }).addTo(view.sites);
    view.fit([depot, ...plan.customers.map((c) => [c.latitude, c.longitude])]);
  }

  function drawSide(plan) {
    const editable = ctx.editable();
    const byName = new Map(plan.customers.map((c) => [c.name, c]));
    const edit = (change) => {
      const next = clone(plan);
      change(next);
      ctx.onEdit(next);
    };

    /** Moves a customer to a route, before the stop `before` or at the end; null route means "not visited". */
    const move = (name, toVehicle, before) => edit((next) => {
      for (const vehicle of next.vehicles) {
        const at = (vehicle.visits || []).indexOf(name);
        if (at >= 0) {
          vehicle.visits.splice(at, 1);
          if (at < vehicle.pinnedVisits) vehicle.pinnedVisits -= 1;
        }
      }
      if (toVehicle === null) return;
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
        title: `${name} · demand ${customer ? customer.demand : '?'}`
          + (editable && !vehicle.pinned ? (pinned ? ' · pinned: click to release from here' : ' · click to pin the route up to here') : ''),
      }, pinned ? lockIcon() : null, name);
      if (editable && !vehicle.pinned) {
        if (!pinned) draggable(chip, name);
        dropTarget(chip, (key) => { if (key !== name) move(key, vIndex, name); });
        chip.addEventListener('click', () => edit((next) => {
          const v = next.vehicles[vIndex];
          v.pinnedVisits = index + 1 === v.pinnedVisits ? index : index + 1;
        }));
      }
      return chip;
    };

    const route = (vehicle, vIndex) => {
      const visits = vehicle.visits || [];
      const stops = h('div', { class: 'stops' },
        h('span', { class: 'end' }, 'Depot'),
        visits.flatMap((name, i) => [h('span', { class: 'arrow' }, '›'), stop(vehicle, vIndex, name, i)]),
        h('span', { class: 'arrow' }, '›'), h('span', { class: 'end' }, 'Depot'));
      if (editable && !vehicle.pinned) dropTarget(stops, (key) => move(key, vIndex, null));
      return h('div', { class: `card route ${vehicle.pinned ? 'pinned' : ''}`, style: { '--c': color(vIndex) } },
        h('div', { class: 'route-head' },
          h('strong', {}, vehicle.name),
          h('span', { class: 'muted' }, `${visits.length} stop${visits.length === 1 ? '' : 's'}`),
          h('span', { class: 'spacer' }),
          editable && visits.length > 0 ? h('label', { class: 'muted', style: { display: 'flex', gap: '7px', 'align-items': 'center', 'font-size': '12px' } },
            'Pin route',
            h('input', { type: 'checkbox', class: 'switch', checked: vehicle.pinned,
              onchange: (e) => edit((next) => { next.vehicles[vIndex].pinned = e.target.checked; }) })) : null),
        h('div', { class: 'route-figures' },
          h('span', {}, `load ${vehicle.load ?? 0} / ${vehicle.capacity}`),
          h('span', {}, `${number(vehicle.km ?? 0, 1)} km`),
          h('span', {}, `${vehicle.minutes ?? 0} min`)),
        h('div', { class: `meter ${vehicle.load > vehicle.capacity ? 'over' : ''}` },
          h('i', { style: { width: `${Math.min(100, ((vehicle.load || 0) / vehicle.capacity) * 100)}%` } })),
        stops);
    };

    const unvisitedNames = plan.unvisited || plan.customers.map((c) => c.name).filter((n) => !vehicleOf(plan).has(n));
    const unvisited = h('div', { class: 'stops' }, unvisitedNames.map((name) => {
      const chip = h('span', { class: 'chip', dataset: { key: name }, title: `${name} · demand ${byName.get(name)?.demand}` }, name);
      if (editable) draggable(chip, name);
      return chip;
    }));
    if (editable) dropTarget(unvisited, (key) => move(key, null, null));

    // Geocoding: a new customer is given by its address; OpenStreetMap finds where it is.
    const address = h('input', { type: 'text', placeholder: 'Address of a new customer', 'aria-label': 'Address of a new customer' });
    const demand = h('input', { type: 'number', min: 1, max: 100, value: 10, 'aria-label': 'Demand', title: 'Demand' });
    const add = h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
      if (!address.value.trim()) return;
      add.disabled = true;
      add.textContent = 'Locating…';
      try {
        const found = await ctx.geocode(address.value.trim());
        edit((next) => {
          let name = address.value.split(',')[0].trim();
          while (next.customers.some((c) => c.name === name)) name += ' 2';
          next.customers.push({ name, address: address.value.trim(), latitude: found.latitude, longitude: found.longitude,
            demand: Number(demand.value) || 1 });
        });
      } catch (error) {
        ctx.fail(error.message);
        add.disabled = false;
        add.textContent = 'Add';
      }
    } }, 'Add');

    side.replaceChildren(...[
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'Driving time'), h('b', {}, `${Math.floor((plan.totalMinutes || 0) / 60)} h ${String((plan.totalMinutes || 0) % 60).padStart(2, '0')}`)),
        h('div', { class: 'kpi' }, h('small', {}, 'Distance'), h('b', {}, `${number(plan.totalKm || 0, 1)} km`)),
        h('div', { class: 'kpi' }, h('small', {}, 'Not visited'), h('b', {}, unvisitedNames.length))),
      h('p', { class: 'hint' }, `Travel times: ${plan.travelSource || 'not computed yet'}`),
      editable ? h('p', { class: 'hint' }, 'Drag a stop to another route or position. Click a stop to pin the route up to it.') : null,
      h('div', { class: `routes ${editable ? 'editable' : ''}` },
        plan.vehicles.map(route),
        h('div', { class: 'card route' },
          h('div', { class: 'route-head' }, h('strong', {}, 'Not visited'),
            h('span', { class: 'muted' }, unvisitedNames.length === 0 ? 'everyone is served' : `${unvisitedNames.length} customer${unvisitedNames.length === 1 ? '' : 's'}`)),
          unvisited,
          editable ? h('div', { class: 'adder' }, address, demand, add) : null))].filter(Boolean));
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set(changes(current, plan).map((c) => c.customer));
      drawMap(plan, animate ? moved : new Set());
      flip(side, () => drawSide(plan), moved, animate && current !== null);
      current = plan;
      view.resize();
    },
  };
}

function changes(prev, next) {
  if (!prev) return [];
  const where = (plan) => {
    const owner = new Map();
    plan.vehicles.forEach((v) => (v.visits || []).forEach((name) => owner.set(name, v.name)));
    return owner;
  };
  const before = where(prev);
  const after = where(next);
  return next.customers
    .filter((c) => before.get(c.name) !== after.get(c.name))
    .map((c) => ({ customer: c.name, from: before.get(c.name), to: after.get(c.name) }));
}

export function diff(prev, next) {
  return changes(prev, next).map((c) => ({
    what: c.customer,
    text: `${c.from || 'not visited'} → ${c.to || 'not visited'}`,
  }));
}
