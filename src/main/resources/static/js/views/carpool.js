import { h, color, flip, clock, number } from '../util.js';
import { createMap, siteMarker, routeLine, resolve } from './map.js';

// Carpooling: the trips on a map, and one timeline per driver from departure to arrival,
// with each pickup at the minute it happens and the driver's deadline as a yellow line.

export function mount(root) {
  let current = null;
  const mapEl = h('div', { class: 'map' });
  const side = h('div', {});
  root.replaceChildren(h('div', { class: 'split' }, mapEl, side));
  const view = createMap(mapEl);

  function drawMap(plan, moved) {
    const riders = new Map(plan.riders.map((r) => [r.name, r]));
    const destination = [plan.destination.latitude, plan.destination.longitude];
    const driverOf = new Map();
    view.routes.clearLayers();
    view.sites.clearLayers();
    plan.drivers.forEach((driver, index) => {
      const home = [driver.home.latitude, driver.home.longitude];
      const stops = (driver.pickups || []).map((name) => riders.get(name)).filter(Boolean);
      stops.forEach((r) => driverOf.set(r.name, index));
      routeLine([home, ...stops.map((r) => [r.pickup.latitude, r.pickup.longitude]), destination],
        resolve(color(index)), { dashed: stops.length === 0 }).addTo(view.routes);
      siteMarker(home, { cls: 'home', colour: color(index), size: 11,
        label: `${driver.name} leaves ${driver.home.name} at ${clock(driver.departureMinute)}` }).addTo(view.sites);
    });
    plan.riders.forEach((rider) => {
      const index = driverOf.get(rider.name);
      siteMarker([rider.pickup.latitude, rider.pickup.longitude], {
        cls: `${index === undefined ? 'unvisited' : ''} ${moved.has(rider.name) ? 'pulse' : ''}`,
        colour: index === undefined ? null : color(index), size: 13,
        label: `${rider.name}, ${rider.pickup.name} · ready ${clock(rider.readyMinute)}`
          + (index === undefined ? '' : ` · with ${plan.drivers[index].name}`),
      }).addTo(view.sites);
    });
    siteMarker(destination, { cls: 'depot', size: 15, label: plan.destination.name }).addTo(view.sites);
    view.fit([destination, ...plan.drivers.map((d) => [d.home.latitude, d.home.longitude]),
      ...plan.riders.map((r) => [r.pickup.latitude, r.pickup.longitude])]);
  }

  function drawSide(plan) {
    const start = Math.floor((Math.min(...plan.drivers.map((d) => d.departureMinute)) - 5) / 15) * 15;
    const end = Math.ceil((Math.max(...plan.drivers.map((d) => Math.max(d.latestArrivalMinute, d.arrivalMinute || 0))) + 5) / 15) * 15;
    const at = (minute) => `${((minute - start) / (end - start)) * 100}%`;
    const ticks = [];
    for (let m = start; m <= end; m += 15) ticks.push(m);
    const conflicts = new Set((plan.conflicts || []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

    const trip = (driver, index) => {
      const pickups = driver.pickups || [];
      const clash = (name) => pickups.some((other) => conflicts.has(`${name}|${other}`));
      const arrival = driver.arrivalMinute ?? driver.departureMinute;
      return h('div', { class: `card trip ${driver.minutesLate > 0 ? 'late' : ''}`, style: { '--c': color(index) } },
        h('div', { class: 'trip-who' },
          h('strong', {}, driver.name),
          h('small', {}, `${pickups.length} of ${driver.seats} seats · ${number(driver.km ?? 0, 1)} km`),
          h('small', {}, driver.minutesLate > 0 ? `${driver.minutesLate} min late` : `arrives ${clock(arrival)}`)),
        h('div', { class: 'trip-track' },
          ticks.map((m) => h('div', { class: 'tick', style: { left: at(m) } }, m % 30 === 0 ? h('span', {}, clock(m)) : null)),
          h('div', { class: 'deadline', style: { left: at(driver.latestArrivalMinute) }, title: `Must arrive by ${clock(driver.latestArrivalMinute)}` }),
          h('div', { class: 'ride', style: { left: at(driver.departureMinute), width: `calc(${at(arrival)} - ${at(driver.departureMinute)})` } }),
          (driver.stops || []).map((stop, i) => h('div', {
            class: 'stop', style: { left: at(stop.minute), top: `${i % 2 === 0 ? 8 : 38}px` },
          }, h('span', {
            class: `chip ${clash(stop.rider) || stop.detourMinutes > 0 ? 'bad' : ''}`, dataset: { key: stop.rider },
            style: { '--c': color(index) },
            title: `${stop.rider} picked up at ${clock(stop.minute)}`
              + (stop.detourMinutes > 0 ? ` · ${stop.detourMinutes} min more than tolerated in the car` : '')
              + (clash(stop.rider) ? ' · shares the car with someone they would rather avoid' : ''),
          }, stop.rider))),
          h('div', { class: 'arrive', style: { left: at(arrival) }, title: `Arrives at ${clock(arrival)}` })));
    };

    const waiting = plan.riders.filter((r) => !plan.drivers.some((d) => (d.pickups || []).includes(r.name)));
    side.replaceChildren(...[
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'Distance driven'), h('b', {}, `${number(plan.totalKm || 0, 1)} km`)),
        h('div', { class: 'kpi' }, h('small', {}, 'Riders with a lift'), h('b', {}, `${plan.riders.length - waiting.length} of ${plan.riders.length}`)),
        h('div', { class: 'kpi' }, h('small', {}, 'Cars late'), h('b', {}, plan.drivers.filter((d) => d.minutesLate > 0).length))),
      h('p', { class: 'hint' }, 'Each row is a driver from departure to arrival. Yellow line: the deadline. A red outline marks a long detour or an unwanted companion.'),
      h('div', { class: 'timeline' }, plan.drivers.map(trip)),
      waiting.length > 0 ? h('div', { class: 'card route', style: { 'margin-top': '8px' } },
        h('div', { class: 'route-head' }, h('strong', {}, 'Waiting for a lift')),
        h('div', { class: 'stops' }, waiting.map((r) => h('span', { class: 'chip', dataset: { key: r.name } }, r.name)))) : null].filter(Boolean));
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set(changes(current, plan).map((c) => c.rider));
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
    plan.drivers.forEach((d) => (d.pickups || []).forEach((name) => owner.set(name, d.name)));
    return owner;
  };
  const before = where(prev);
  const after = where(next);
  return next.riders
    .filter((r) => before.get(r.name) !== after.get(r.name))
    .map((r) => ({ rider: r.name, from: before.get(r.name), to: after.get(r.name) }));
}

export function diff(prev, next) {
  return changes(prev, next).map((c) => ({ what: c.rider, text: `${c.from || 'no lift'} → ${c.to || 'no lift'}` }));
}
