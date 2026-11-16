import { h, color, clone, flip, draggable, dropTarget, fill } from '../util.js';
import { t } from '../i18n.js';

// Task assignment: one lane per employee, one block per task, as wide as the task is long.
// Drag a block to another lane to reassign it; click it to pin it where it is.

const short = (name) => name.split('-')[0];

export function mount(root, ctx) {
  let current = null;

  function render(plan) {
    const skills = [...new Set(plan.tasks.map((task) => task.requiredSkill))].sort();
    const skillColor = (skill) => color(skills.indexOf(skill));
    const scale = Math.max(...plan.employees.map((e) => Math.max(e.capacityHours, e.load || 0)), 1) * 1.08;
    const editable = ctx.editable();

    const edit = (change) => {
      const next = clone(plan);
      change(next);
      ctx.onEdit(next);
    };
    const assign = (taskName, employee) => edit((next) => {
      const task = next.tasks.find((candidate) => candidate.name === taskName);
      if (!task || task.employee === employee) return;
      task.employee = employee;
      if (!employee) {
        delete task.employee;
        task.pinned = false;
      }
    });

    const block = (task) => {
      const el = h('div', {
        class: `block ${task.pinned ? 'pinned' : ''} ${task.lacksSkill ? 'bad' : ''}`,
        dataset: { key: task.name },
        style: { '--c': skillColor(task.requiredSkill), width: `calc(${(task.hours / scale) * 100}% - 6px)` },
        title: [`${task.name} · ${task.requiredSkill} · ${t('unit.hours', { n: task.hours })}`,
          task.lacksSkill ? t('tasks.lacksSkill') : null,
          editable ? t(task.pinned ? 'tasks.hint.pinned' : 'tasks.hint.free') : null].filter(Boolean).join(' · '),
      }, h('b', {}, short(task.name)), h('span', {}, `${task.requiredSkill} · ${t('unit.hours', { n: task.hours })}`));
      if (editable) {
        draggable(el, task.name);
        if (task.employee) {
          el.addEventListener('click', () => edit((next) => {
            const mine = next.tasks.find((candidate) => candidate.name === task.name);
            mine.pinned = !mine.pinned;
          }));
        }
      }
      return el;
    };

    const lane = (employee, index) => {
      const tasks = plan.tasks.filter((task) => task.employee === employee.name);
      const allPinned = tasks.length > 0 && tasks.every((task) => task.pinned);
      const load = employee.load ?? 0;
      const track = h('div', {
        class: 'lane-track',
        style: { 'background-size': `${(4 / scale) * 100}% 100%` },
      },
        h('div', { class: 'cap', style: { left: `${(employee.capacityHours / scale) * 100}%` } },
          h('span', {}, t('unit.hours', { n: employee.capacityHours }))),
        tasks.map(block));
      if (editable) dropTarget(track, (key) => assign(key, employee.name));
      return h('div', { class: 'card lane', style: { '--c': color(index) } },
        h('div', { class: 'lane-who' },
          h('div', { class: 'lane-name' }, h('span', { class: 'avatar' }, employee.name.slice(0, 2)), employee.name),
          h('div', { class: 'lane-meta' },
            h('span', {}, `${load} / ${t('unit.hours', { n: employee.capacityHours })}`),
            h('span', {}, t('tasks.perHour', { n: employee.hourlyCost }))),
          h('div', { class: `meter ${load > employee.capacityHours ? 'over' : ''}` },
            h('i', { style: { width: `${employee.capacityHours > 0 ? Math.min(100, (load / employee.capacityHours) * 100) : 0}%` } })),
          h('div', { class: 'lane-skills' }, (employee.skills || []).join(' · ')),
          editable && tasks.length > 0 ? h('button', {
            class: 'btn ghost small', type: 'button', style: { 'margin-top': '9px' },
            title: t(allPinned ? 'tasks.releaseAll.title' : 'tasks.pinAll.title'),
            onclick: () => edit((next) => next.tasks.filter((task) => task.employee === employee.name)
              .forEach((task) => { task.pinned = !allPinned; })),
          }, t(allPinned ? 'tasks.releaseAll' : 'tasks.pinAll')) : null),
        track);
    };

    const unassigned = plan.tasks.filter((task) => !task.employee);
    const waiting = h('div', { class: 'lane-track', style: { 'background-image': 'none' } }, unassigned.map(block));
    if (editable) dropTarget(waiting, (key) => assign(key, null));

    fill(root,
      h('div', { class: 'hint' },
        h('div', { class: 'legend' }, skills.map((skill) => h('span', { style: { '--c': skillColor(skill) } }, h('i'), skill))),
        editable ? h('span', {}, t('tasks.hint')) : null),
      h('div', { class: `lanes ${editable ? 'editable' : ''}` },
        plan.employees.map(lane),
        unassigned.length > 0 || editable ? h('div', { class: 'card lane unassigned' },
          h('div', { class: 'lane-who' }, h('div', { class: 'lane-name' }, t('tasks.unassigned.title')),
            h('div', { class: 'lane-meta' }, h('span', {}, t('tasks.count', { count: unassigned.length })))),
          waiting) : null));
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set(changes(current, plan).map((change) => change.task));
      flip(root, () => render(plan), moved, animate && current !== null);
      current = plan;
    },
  };
}

function changes(prev, next) {
  if (!prev) return [];
  const before = new Map(prev.tasks.map((task) => [task.name, task.employee]));
  return next.tasks
    .filter((task) => before.has(task.name) && (before.get(task.name) || null) !== (task.employee || null))
    .map((task) => ({ task: task.name, from: before.get(task.name), to: task.employee }));
}

/** What changed between two plans, in words. */
export function diff(prev, next) {
  return changes(prev, next).map((change) => ({
    what: change.task,
    text: `${change.from || t('tasks.unassigned')} → ${change.to || t('tasks.unassigned')}`,
  }));
}
