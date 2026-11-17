import { h, color, fill, number } from '../util.js';
import { t } from '../i18n.js';
import { createMap, siteMarker, routeLine, resolve } from './map.js';

// BL.Optim VRP: each staff member's day as a route on the map, from their departure place
// through the day's activities and back, in the colour of the staff member. Beside the map,
// the days of the horizon with each staff member's visits and times. A day can be singled out.

const clockOf = (text) => {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(text || '');
  return match ? `${match[2]}:${match[3]}` : '–';
};

export function mount(root) {
  let current = null;
  let shownDay = 'all';
  const mapEl = h('div', { class: 'map' });
  const side = h('div', { class: 'bl-side' });
  const head = h('div');
  fill(root, head, h('div', { class: 'split' }, mapEl, side));
  const view = createMap(mapEl);

  function render(plan) {
    const places = new Map((plan.places || []).map((place) => [place.id, place]));
    const staffIndex = new Map(plan.staff.map((member, i) => [member.id, i]));
    const activityPlace = new Map(plan.activities.map((activity) => [activity.id, activity.place]));
    const routes = plan.routes || [];
    const visibleRoutes = routes.filter((route) => shownDay === 'all' || route.day === Number(shownDay));
    const owner = new Map();
    visibleRoutes.forEach((route) => route.visits.forEach((visit) => owner.set(visit.of, route)));
    const point = (id) => {
      const place = places.get(id);
      return place ? [place.latitude, place.longitude] : null;
    };

    view.routes.clearLayers();
    view.sites.clearLayers();
    for (const route of visibleRoutes) {
      const member = plan.staff[staffIndex.get(route.staff)];
      const home = member?.departure ? point(member.departure) : null;
      const stops = route.visits.map((visit) => point(activityPlace.get(visit.of))).filter(Boolean);
      const line = [...(home ? [home] : []), ...stops, ...(home ? [home] : [])];
      if (line.length > 1) routeLine(line, resolve(color(staffIndex.get(route.staff))), { dashed: shownDay === 'all' && route.day % 2 === 1 }).addTo(view.routes);
    }
    const plannedIds = new Set(routes.flatMap((route) => route.visits.map((visit) => visit.of)));
    for (const activity of plan.activities) {
      const at = point(activity.place);
      if (!at) continue;
      const route = owner.get(activity.id);
      const hidden = !route && plannedIds.has(activity.id);
      siteMarker(at, {
        cls: route ? '' : hidden ? 'unvisited faded' : 'unvisited',
        colour: route ? color(staffIndex.get(route.staff)) : null,
        size: 10 + Math.min(10, Math.round((activity.duration || 0) / 30)),
        label: `${activity.id} · ${activity.type || '–'} · ${route ? `${route.staff}, ${t('blvrp.day', { n: route.day + 1 })}` : t('blvrp.unplanned')}`,
      }).addTo(view.sites);
    }
    plan.staff.forEach((member, i) => {
      const at = member.departure ? point(member.departure) : null;
      if (at) siteMarker(at, { cls: 'depot', colour: color(i), size: 14, label: `${member.name || member.id} · ${t('blvrp.home')}` }).addTo(view.sites);
    });
    view.fit([...places.values()].map((place) => [place.latitude, place.longitude]));

    const days = [...new Set(routes.map((route) => route.day))].sort((a, b) => a - b);
    const summary = plan.summary || {};
    fill(head,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, t('blvrp.kpi.planned')), h('b', {},
          t('blvrp.kpi.planned.value', { planned: summary.planned ?? 0, all: summary.parts ?? plan.activities.length }))),
        h('div', { class: 'kpi' }, h('small', {}, t('blvrp.kpi.travel')), h('b', {}, summary.travelMinutes != null
          ? t('blvrp.kpi.travel.value', { hours: number(summary.travelMinutes / 60, 1) }) : '–')),
        h('div', { class: 'kpi' }, h('small', {}, t('blvrp.kpi.distance')), h('b', {}, summary.kilometres != null
          ? `${number(summary.kilometres, 1)} km` : '–')),
        h('div', { class: 'kpi' }, h('small', {}, t('blvrp.kpi.routes')), h('b', {}, routes.length))),
      h('div', { class: 'hint' },
        h('div', { class: 'legend' }, plan.staff.map((member, i) => h('span', { style: { '--c': color(i) } }, h('i'), member.name || member.id))),
        h('label', { class: 'bl-day' }, t('blvrp.show'), ' ',
          h('select', { onchange: (e) => { shownDay = e.target.value; render(current); } },
            h('option', { value: 'all', selected: shownDay === 'all' }, t('blvrp.allDays')),
            Array.from({ length: summary.days ? Math.max(summary.days, ...days.map((d) => d + 1)) : days.length }, (_, d) => d)
              .map((d) => h('option', { value: String(d), selected: shownDay === String(d) }, t('blvrp.day', { n: d + 1 })))))),
      h('p', { class: 'hint' }, t(routes.length ? 'blvrp.hint' : 'blvrp.hint.pending')));

    fill(side, (shownDay === 'all' ? days : [Number(shownDay)]).map((day) => h('div', { class: 'card route bl-day-card' },
      h('div', { class: 'product-head' }, h('strong', {}, t('blvrp.day', { n: day + 1 }))),
      routes.filter((route) => route.day === day).map((route) => h('div', { class: 'bl-route', style: { '--c': color(staffIndex.get(route.staff)) } },
        h('div', { class: 'bl-route-head' }, h('i', { class: 'dot' }), h('b', {}, plan.staff[staffIndex.get(route.staff)]?.name || route.staff),
          h('span', { class: 'muted' }, t('blvrp.route', { work: number((route.workMinutes || 0) / 60, 1), travel: route.travelMinutes ?? 0,
            km: number(route.kilometres || 0, 1) }))),
        h('ol', { class: 'bl-stops' }, route.visits.map((visit) => h('li', {},
          h('span', { class: 'time' }, `${clockOf(visit.arrival)}–${clockOf(visit.end)}`), ' ', visit.activity,
          visit.travelMinutes ? h('span', { class: 'muted' }, ` · ${t('blvrp.travel', { n: visit.travelMinutes })}`) : null))))))),
    routes.length === 0 ? h('div', { class: 'card bl-waiting' }, h('strong', {}, t('blvrp.waiting', { count: plan.activities.length }))) : null);
  }

  return {
    update(plan) {
      current = plan;
      render(plan);
      setTimeout(() => view.resize(), 0);
    },
  };
}

/** What changed between two plans: activities moved to another staff member or day. */
export function diff(prev, next) {
  if (!prev) return [];
  const where = (plan) => {
    const result = new Map();
    (plan.routes || []).forEach((route) => route.activities.forEach((id) => result.set(id, `${route.staff} ${t('blvrp.day', { n: route.day + 1 })}`)));
    return result;
  };
  const before = where(prev);
  const out = [];
  for (const [id, place] of where(next)) {
    const was = before.get(id);
    if (was !== place && out.length < 30) out.push({ what: id, text: `${was || '–'} → ${place}` });
  }
  return out;
}
