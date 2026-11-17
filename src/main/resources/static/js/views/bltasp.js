import { h, color, fill, flip, number } from '../util.js';
import { t } from '../i18n.js';

// BL.Optim TASP: the week as a Gantt chart, one row per staff member. Each day takes the same
// width and shows the office hours (earliest opening to latest closing); bars are activities in
// the colour of their nature, absences are hatched. Before solving, the activities wait below.

const DAY_MINUTES = 24 * 60;

/** Minutes since midnight and calendar date of a zoned date-time such as 2026-03-02T08:00+01:00[Europe/Paris]. */
function clockOf(text) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(text || '');
  return match ? { date: match[1], minutes: Number(match[2]) * 60 + Number(match[3]) } : null;
}

const toMinutes = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

const pad = (n) => String(n).padStart(2, '0');
const hm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** The dates of the days of the horizon, from its start. */
function daysOf(plan) {
  const start = clockOf(plan.horizon.start);
  const count = plan.summary?.days ?? 1;
  const first = new Date(`${start.date}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(first.getTime() + i * 86400000).toISOString().slice(0, 10));
}

/** Earliest opening and latest closing of the office over the week, in minutes; the whole day without office hours. */
function officeSpan(plan) {
  const hours = (plan.horizon.office || []).flatMap((day) => day.hours.map((interval) => interval.split('-').map(toMinutes)));
  if (hours.length === 0) return [0, DAY_MINUTES];
  const open = Math.min(...hours.map(([from]) => from));
  const close = Math.max(...hours.map(([, to]) => to));
  return [Math.max(0, open - 30), Math.min(DAY_MINUTES, close + 30)];
}

export function mount(root) {
  let current = null;

  function render(plan) {
    const days = daysOf(plan);
    const [open, close] = officeSpan(plan);
    const span = close - open;
    const at = (date, minutes) => {
      const day = Math.max(0, days.indexOf(date));
      const inDay = Math.min(Math.max(minutes, open), close) - open;
      return ((day + inDay / span) / days.length) * 100;
    };
    const types = [...new Set(plan.activities.map((activity) => activity.type || ''))];
    const typeOf = new Map(plan.activities.map((activity) => [activity.id, activity.type || '']));
    const activityOf = new Map(plan.activities.map((activity) => [activity.id, activity]));
    const tone = (assignment) => color(types.indexOf(typeOf.get(assignment.of) ?? ''));
    const assignments = plan.assignments || [];
    const planned = assignments.filter((a) => a.staff && a.start);
    const waiting = assignments.filter((a) => !(a.staff && a.start));

    const bar = (assignment) => {
      const from = clockOf(assignment.start);
      const to = clockOf(assignment.end);
      const left = at(from.date, from.minutes);
      const right = to.date === from.date ? at(to.date, to.minutes) : at(from.date, close);
      const activity = activityOf.get(assignment.of);
      return h('div', {
        class: 'gantt-bar', dataset: { key: assignment.activity },
        style: { '--c': tone(assignment), left: `${left}%`, width: `calc(${Math.max(right - left, 0.4)}% - 2px)` },
        title: t('bltasp.bar', { activity: assignment.activity, type: activity?.type || '–', from: hm(from.minutes), to: hm(to.minutes),
          day: from.date, priority: activity?.priority ?? 0 }),
      }, h('span', {}, assignment.activity));
    };

    const absence = (interval) => {
      const from = clockOf(interval.start);
      const to = clockOf(interval.end);
      if (!from || !to) return [];
      const pieces = [];
      for (const date of days) {
        if (date < from.date || date > to.date) continue;
        const start = date === from.date ? from.minutes : open;
        const end = date === to.date ? to.minutes : close;
        if (end <= open || start >= close) continue;
        const left = at(date, start);
        pieces.push(h('div', { class: 'absence', style: { left: `${left}%`, width: `${at(date, end) - left}%` },
          title: t('bltasp.absence', { from: `${from.date} ${hm(from.minutes)}`, to: `${to.date} ${hm(to.minutes)}` }) }));
      }
      return pieces;
    };

    const rows = plan.staff.map((member) => {
      const mine = planned.filter((a) => a.staff === member.id);
      const minutes = mine.reduce((sum, a) => {
        const from = clockOf(a.start);
        const to = clockOf(a.end);
        return sum + (to.date === from.date ? to.minutes - from.minutes : 0);
      }, 0);
      return h('div', { class: 'gantt-row' },
        h('div', { class: 'gantt-who' },
          h('strong', {}, member.name || member.id),
          h('small', {}, [member.team, member.specialization].filter(Boolean).join(' · ')),
          h('small', {}, t('bltasp.work', { hours: number(minutes / 60, 1), count: mine.length }))),
        h('div', { class: 'gantt-track' },
          days.map((date, i) => h('div', { class: 'tick day', style: { left: `${(i / days.length) * 100}%` } })),
          (member.unavailabilities || []).flatMap(absence),
          mine.map(bar)));
    });

    fill(root,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, t('bltasp.kpi.planned')), h('b', {},
          t('bltasp.kpi.planned.value', { planned: planned.length, all: assignments.length }))),
        h('div', { class: 'kpi' }, h('small', {}, t('bltasp.kpi.activities')), h('b', {}, plan.summary?.activities ?? plan.activities.length)),
        h('div', { class: 'kpi' }, h('small', {}, t('bltasp.kpi.staff')), h('b', {}, plan.staff.length)),
        h('div', { class: 'kpi' }, h('small', {}, t('bltasp.kpi.days')), h('b', {}, days.length))),
      h('div', { class: 'hint' }, h('div', { class: 'legend' },
        types.map((type, i) => h('span', { style: { '--c': color(i) } }, h('i'), type || '–')))),
      h('p', { class: 'hint' }, t(planned.length ? 'bltasp.hint' : 'bltasp.hint.pending', { from: hm(open), to: hm(close) })),
      h('div', { class: 'card gantt bl-gantt' },
        rows,
        h('div', { class: 'gantt-row axis-row' }, h('div', { class: 'gantt-who' }),
          h('div', { class: 'gantt-track' }, days.map((date, i) => h('span', { class: 'tick-label day-label',
            style: { left: `${((i + 0.5) / days.length) * 100}%` } }, date.slice(5)))))),
      waiting.length ? h('div', { class: 'card bl-waiting' },
        h('strong', {}, t('bltasp.waiting', { count: waiting.length })),
        h('div', { class: 'chips' }, waiting.map((a) => {
          const activity = activityOf.get(a.of);
          return h('span', { class: 'chip', style: { '--c': tone(a) },
            title: t('bltasp.chip', { type: activity?.type || '–', minutes: activity?.duration ?? 0 }) }, a.activity);
        }))) : null);
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set();
      if (current) {
        const before = new Map((current.assignments || []).map((a) => [a.activity, `${a.staff}|${a.start}`]));
        (plan.assignments || []).forEach((a) => { if (before.get(a.activity) !== `${a.staff}|${a.start}`) moved.add(a.activity); });
      }
      flip(root, () => render(plan), new Set(), animate && current !== null && moved.size > 0);
      current = plan;
    },
  };
}

/** What changed between two plans, in words: activities given to someone else, or moved in time. */
export function diff(prev, next) {
  if (!prev) return [];
  const before = new Map((prev.assignments || []).map((a) => [a.activity, a]));
  const out = [];
  for (const a of next.assignments || []) {
    const was = before.get(a.activity);
    if (!was || (was.staff === a.staff && was.start === a.start)) continue;
    const when = (x) => (x?.start ? `${x.staff} ${clockOf(x.start).date.slice(5)} ${hm(clockOf(x.start).minutes)}` : '–');
    if (out.length < 30) out.push({ what: a.activity, text: `${when(was)} → ${when(a)}` });
  }
  return out;
}
