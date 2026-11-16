import { h, color, flip, clock, number, fill } from '../util.js';
import { t } from '../i18n.js';
import { createMap, siteMarker, routeLine, resolve } from './map.js';

// Carpooling: the trips on a map, and one timeline per driver from departure to arrival,
// with each pickup at the minute it happens and the driver's deadline as a line.

export function mount(root) {
  let current = null;
  const mapEl = h('div', { class: 'map' });
  const side = h('div', {});
  fill(root, h('div', { class: 'split' }, mapEl, side));
  const view = createMap(mapEl);

  function drawMap(plan, moved) {
    const riders = new Map(plan.riders.map((rider) => [rider.name, rider]));
    const destination = [plan.destination.latitude, plan.destination.longitude];
    const driverOf = new Map();
    view.routes.clearLayers();
    view.sites.clearLayers();
    plan.drivers.forEach((driver, index) => {
      const home = [driver.home.latitude, driver.home.longitude];
      const stops = (driver.pickups || []).map((name) => riders.get(name)).filter(Boolean);
      stops.forEach((rider) => driverOf.set(rider.name, index));
      routeLine([home, ...stops.map((rider) => [rider.pickup.latitude, rider.pickup.longitude]), destination],
        resolve(color(index)), { dashed: stops.length === 0 }).addTo(view.routes);
      siteMarker(home, { cls: 'home', colour: color(index), size: 11,
        label: t('carpool.map.driver', { driver: driver.name, place: driver.home.name, time: clock(driver.departureMinute) }) }).addTo(view.sites);
    });
    plan.riders.forEach((rider) => {
      const index = driverOf.get(rider.name);
      siteMarker([rider.pickup.latitude, rider.pickup.longitude], {
        cls: `${index === undefined ? 'unvisited' : ''} ${moved.has(rider.name) ? 'pulse' : ''}`,
        colour: index === undefined ? null : color(index), size: 13,
        label: [t('carpool.map.rider', { rider: rider.name, place: rider.pickup.name, time: clock(rider.readyMinute) }),
          index === undefined ? null : t('carpool.map.with', { driver: plan.drivers[index].name })].filter(Boolean).join(' · '),
      }).addTo(view.sites);
    });
    siteMarker(destination, { cls: 'depot', size: 15, label: plan.destination.name }).addTo(view.sites);
    view.fit([destination, ...plan.drivers.map((driver) => [driver.home.latitude, driver.home.longitude]),
      ...plan.riders.map((rider) => [rider.pickup.latitude, rider.pickup.longitude])]);
  }

  function drawSide(plan) {
    const departures = plan.drivers.map((driver) => driver.departureMinute);
    const arrivals = plan.drivers.map((driver) => Math.max(driver.latestArrivalMinute, driver.arrivalMinute || 0));
    const start = Math.floor(((departures.length ? Math.min(...departures) : 0) - 5) / 15) * 15;
    const end = Math.max(start + 15, Math.ceil(((arrivals.length ? Math.max(...arrivals) : 60) + 5) / 15) * 15);
    const at = (minute) => `${((minute - start) / (end - start)) * 100}%`;
    const ticks = [];
    for (let minute = start; minute <= end; minute += 15) ticks.push(minute);
    const conflicts = new Set((plan.conflicts || []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

    const trip = (driver, index) => {
      const pickups = driver.pickups || [];
      const clash = (name) => pickups.some((other) => conflicts.has(`${name}|${other}`));
      const arrival = driver.arrivalMinute ?? driver.departureMinute;
      return h('div', { class: `card trip ${driver.minutesLate > 0 ? 'late' : ''}`, style: { '--c': color(index) } },
        h('div', { class: 'trip-who' },
          h('strong', {}, driver.name),
          h('small', {}, t('carpool.seats', { used: pickups.length, seats: driver.seats, km: number(driver.km ?? 0, 1) })),
          h('small', {}, driver.minutesLate > 0 ? t('carpool.late', { n: driver.minutesLate }) : t('carpool.arrives', { time: clock(arrival) }))),
        h('div', { class: 'trip-track' },
          ticks.map((minute) => h('div', { class: 'tick', style: { left: at(minute) } }, minute % 30 === 0 ? h('span', {}, clock(minute)) : null)),
          h('div', { class: 'deadline', style: { left: at(driver.latestArrivalMinute) }, title: t('carpool.deadline', { time: clock(driver.latestArrivalMinute) }) }),
          h('div', { class: 'ride', style: { left: at(driver.departureMinute), width: `calc(${at(arrival)} - ${at(driver.departureMinute)})` } }),
          (driver.stops || []).map((stop, i) => h('div', {
            class: 'stop', style: { left: at(stop.minute), top: `${i % 2 === 0 ? 8 : 38}px` },
          }, h('span', {
            class: `chip ${clash(stop.rider) || stop.detourMinutes > 0 ? 'bad' : ''}`, dataset: { key: stop.rider },
            style: { '--c': color(index) },
            title: [t('carpool.pickup', { rider: stop.rider, time: clock(stop.minute) }),
              stop.detourMinutes > 0 ? t('carpool.detour', { n: stop.detourMinutes }) : null,
              clash(stop.rider) ? t('carpool.clash') : null].filter(Boolean).join(' · '),
          }, stop.rider))),
          h('div', { class: 'arrive', style: { left: at(arrival) }, title: t('carpool.arrives', { time: clock(arrival) }) })));
    };

    const waiting = plan.riders.filter((rider) => !plan.drivers.some((driver) => (driver.pickups || []).includes(rider.name)));
    fill(side,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, t('carpool.kpi.distance')), h('b', {}, t('unit.kilometres', { n: number(plan.totalKm || 0, 1) }))),
        h('div', { class: 'kpi' }, h('small', {}, t('carpool.kpi.lift')), h('b', {}, t('carpool.kpi.lift.value', { served: plan.riders.length - waiting.length, all: plan.riders.length }))),
        h('div', { class: 'kpi' }, h('small', {}, t('carpool.kpi.late')), h('b', {}, plan.drivers.filter((driver) => driver.minutesLate > 0).length))),
      h('p', { class: 'hint' }, t('carpool.hint')),
      h('div', { class: 'timeline' }, plan.drivers.map(trip)),
      waiting.length > 0 ? h('div', { class: 'card route', style: { 'margin-top': '8px' } },
        h('div', { class: 'route-head' }, h('strong', {}, t('carpool.waiting'))),
        h('div', { class: 'stops' }, waiting.map((rider) => h('span', { class: 'chip', dataset: { key: rider.name } }, rider.name)))) : null);
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set(changes(current, plan).map((change) => change.rider));
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
    plan.drivers.forEach((driver) => (driver.pickups || []).forEach((name) => owner.set(name, driver.name)));
    return owner;
  };
  const before = where(prev);
  const after = where(next);
  return next.riders
    .filter((rider) => before.get(rider.name) !== after.get(rider.name))
    .map((rider) => ({ rider: rider.name, from: before.get(rider.name), to: after.get(rider.name) }));
}

export function diff(prev, next) {
  return changes(prev, next).map((change) => ({
    what: change.rider,
    text: `${change.from || t('carpool.noLift')} → ${change.to || t('carpool.noLift')}`,
  }));
}
