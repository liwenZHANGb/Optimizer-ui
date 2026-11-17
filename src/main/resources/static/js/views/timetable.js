import { h, color, flip, fill } from '../util.js';
import { t } from '../i18n.js';

// Academic timetabling: the week as a grid, one row per time slot and one column per room,
// teacher or group. A lesson is a card in the colour of its subject; a red outline marks a
// clash (a room, a teacher or a group in two places at once) or a room that is too small.

const AXES = { room: (lesson) => lesson.room, teacher: (lesson) => lesson.teacher, group: (lesson) => lesson.group };
const label = (slot) => `${slot.day} ${slot.start}`;

/** The lessons that break a hard rule, by id, with the reasons. */
function problems(plan) {
  const found = new Map();
  const add = (lesson, reason) => found.set(lesson.id, [...(found.get(lesson.id) || []), reason]);
  const capacity = new Map(plan.rooms.map((room) => [room.name, room.capacity]));
  const away = new Set((plan.unavailable || []).map((u) => `${u.teacher}|${u.timeslot}`));
  const placed = plan.lessons.filter((lesson) => lesson.timeslot);
  for (const lesson of placed) {
    if (lesson.room && lesson.students > capacity.get(lesson.room)) add(lesson, 'timetable.problem.capacity');
    if (away.has(`${lesson.teacher}|${lesson.timeslot}`)) add(lesson, 'timetable.problem.unavailable');
  }
  const seen = new Map();
  for (const lesson of placed) {
    for (const [axis, reason] of [['room', 'timetable.problem.room'], ['teacher', 'timetable.problem.teacher'], ['group', 'timetable.problem.group']]) {
      const value = AXES[axis](lesson);
      if (!value) continue;
      const slot = `${axis}|${lesson.timeslot}|${value}`;
      const other = seen.get(slot);
      if (other) { add(lesson, reason); if (!(found.get(other.id) || []).includes(reason)) add(other, reason); }
      else seen.set(slot, lesson);
    }
  }
  return found;
}

export function mount(root) {
  let current = null;
  let axis = 'room';

  function render(plan) {
    const subjects = [...new Set(plan.lessons.map((lesson) => lesson.subject))].sort();
    const columns = axis === 'room' ? plan.rooms.map((room) => room.name) : [...new Set(plan.lessons.map(AXES[axis]))].sort();
    const capacity = new Map(plan.rooms.map((room) => [room.name, room.capacity]));
    const away = new Set((plan.unavailable || []).map((u) => `${u.teacher}|${u.timeslot}`));
    const wrong = problems(plan);
    const unplaced = plan.lessons.filter((lesson) => !lesson.timeslot || !lesson.room);

    const card = (lesson) => {
      const reasons = wrong.get(lesson.id) || [];
      // The column says one of the three; the card says the other two.
      const details = [axis !== 'group' ? lesson.group : null, axis !== 'teacher' ? lesson.teacher : null,
        axis !== 'room' ? lesson.room : null].filter(Boolean);
      return h('div', { class: `lesson ${reasons.length ? 'bad' : ''}`, dataset: { key: lesson.id },
        style: { '--c': color(subjects.indexOf(lesson.subject)) },
        title: [lesson.id, t('timetable.students', { count: lesson.students }), ...reasons.map((reason) => t(reason))].join(' · ') },
      h('b', {}, lesson.subject), h('span', {}, details.join(' · ')));
    };

    const days = [...new Set(plan.timeslots.map((slot) => slot.day))];
    const grid = h('div', { class: 'week', style: { 'grid-template-columns': `92px repeat(${columns.length}, minmax(132px, 1fr))` } },
      h('div', { class: 'week-head corner' }),
      columns.map((column) => h('div', { class: 'week-head' }, h('strong', {}, column),
        axis === 'room' ? h('small', {}, t('timetable.seats', { count: capacity.get(column) })) : null)),
      days.flatMap((day) => plan.timeslots.filter((slot) => slot.day === day).flatMap((slot, index) => [
        h('div', { class: `week-time ${index === 0 ? 'day-start' : ''}` }, index === 0 ? h('strong', {}, day) : null,
          h('span', {}, slot.end ? `${slot.start} – ${slot.end}` : slot.start)),
        columns.map((column) => h('div', {
          class: `week-cell ${index === 0 ? 'day-start' : ''} ${axis === 'teacher' && away.has(`${column}|${label(slot)}`) ? 'away' : ''}`,
          title: axis === 'teacher' && away.has(`${column}|${label(slot)}`) ? t('timetable.away', { teacher: column }) : null,
        }, plan.lessons.filter((lesson) => lesson.timeslot === label(slot) && AXES[axis](lesson) === column).map(card))),
      ])));

    const clashes = [...wrong.values()].filter((reasons) => reasons.some((reason) => reason !== 'timetable.problem.capacity'
      && reason !== 'timetable.problem.unavailable')).length;
    fill(root,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, t('timetable.kpi.placed')), h('b', {}, t('timetable.kpi.placed.value', { placed: plan.lessons.length - unplaced.length, all: plan.lessons.length }))),
        h('div', { class: 'kpi' }, h('small', {}, t('timetable.kpi.clashes')), h('b', { class: clashes ? 'bad' : '' }, clashes)),
        h('div', { class: 'kpi' }, h('small', {}, t('timetable.kpi.other')), h('b', {}, wrong.size - clashes))),
      h('div', { class: 'hint' },
        h('div', { class: 'segmented', role: 'group', 'aria-label': t('timetable.view') },
          ['room', 'teacher', 'group'].map((choice) => h('button', { type: 'button', 'aria-pressed': String(axis === choice),
            onclick: () => { axis = choice; render(plan); } }, t(`timetable.view.${choice}`)))),
        h('div', { class: 'legend' }, subjects.map((subject) => h('span', { style: { '--c': color(subjects.indexOf(subject)) } }, h('i'), subject)))),
      h('p', { class: 'hint' }, t('timetable.hint')),
      h('div', { class: 'card week-wrap' }, grid),
      unplaced.length ? h('div', { class: 'card route', style: { 'margin-top': '10px' } },
        h('div', { class: 'route-head' }, h('strong', {}, t('timetable.unplaced')), h('span', { class: 'muted' }, t('timetable.lessons', { count: unplaced.length }))),
        h('div', { class: 'stops' }, unplaced.map((lesson) => h('span', { class: 'chip', dataset: { key: lesson.id },
          style: { '--c': color(subjects.indexOf(lesson.subject)) }, title: `${lesson.teacher} · ${t('timetable.students', { count: lesson.students })}` },
        `${lesson.subject} · ${lesson.group}`)))) : null);
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set(changes(current, plan).map((change) => change.id));
      flip(root, () => render(plan), moved, animate && current !== null);
      current = plan;
    },
  };
}

function changes(prev, next) {
  if (!prev) return [];
  const before = new Map(prev.lessons.map((lesson) => [lesson.id, lesson]));
  return next.lessons.filter((lesson) => {
    const was = before.get(lesson.id);
    return was && (was.timeslot !== lesson.timeslot || was.room !== lesson.room);
  }).map((lesson) => ({ id: lesson.id, from: before.get(lesson.id), to: lesson }));
}

export function diff(prev, next) {
  const place = (lesson) => (lesson.timeslot ? `${lesson.timeslot} · ${lesson.room || '?'}` : t('timetable.notPlaced'));
  return changes(prev, next).map((change) => ({ what: change.id, text: `${place(change.from)} → ${place(change.to)}` }));
}
