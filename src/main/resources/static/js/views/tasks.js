import { h, color, clone, flip, draggable, dropTarget, number } from '../util.js';

// Task assignment: one lane per employee, one block per task, as wide as the task is long.
// Drag a block to another lane to reassign it; click it to pin it where it is.

const short = (name) => name.split('-')[0];

export function mount(root, ctx) {
  let current = null;

  function render(plan, moved) {
    const skills = [...new Set(plan.tasks.map((t) => t.requiredSkill))].sort();
    const skillColor = (skill) => color(skills.indexOf(skill));
    const scale = Math.max(...plan.employees.map((e) => Math.max(e.capacityHours, e.load || 0)), 1) * 1.08;
    const editable = ctx.editable();

    const edit = (change) => {
      const next = clone(plan);
      change(next);
      ctx.onEdit(next);
    };
    const assign = (taskName, employee) => edit((next) => {
      const task = next.tasks.find((t) => t.name === taskName);
      if (task.employee === employee) return;
      task.employee = employee;
      if (!employee) task.pinned = false;
    });

    const block = (task) => {
      const el = h('div', {
        class: `block ${task.pinned ? 'pinned' : ''} ${task.lacksSkill ? 'bad' : ''}`,
        dataset: { key: task.name },
        style: { '--c': skillColor(task.requiredSkill), width: `calc(${(task.hours / scale) * 100}% - 6px)` },
        title: `${task.name} · ${task.requiredSkill} · ${task.hours} h`
          + (task.lacksSkill ? ' · the employee lacks this skill' : '')
          + (editable ? (task.pinned ? ' · pinned: click to release' : ' · click to pin, drag to reassign') : ''),
      }, h('b', {}, short(task.name)), h('span', {}, `${task.requiredSkill} · ${task.hours}h`));
      if (editable) {
        draggable(el, task.name);
        if (task.employee) {
          el.addEventListener('click', () => edit((next) => {
            const t = next.tasks.find((x) => x.name === task.name);
            t.pinned = !t.pinned;
          }));
        }
      }
      return el;
    };

    const lane = (employee, index) => {
      const tasks = plan.tasks.filter((t) => t.employee === employee.name);
      const allPinned = tasks.length > 0 && tasks.every((t) => t.pinned);
      const track = h('div', {
        class: 'lane-track',
        style: { 'background-size': `${(4 / scale) * 100}% 100%` },
      },
        h('div', { class: 'cap', style: { left: `${(employee.capacityHours / scale) * 100}%` } },
          h('span', {}, `${employee.capacityHours} h`)),
        tasks.map(block));
      if (editable) dropTarget(track, (key) => assign(key, employee.name));
      return h('div', { class: 'card lane', style: { '--c': color(index) } },
        h('div', { class: 'lane-who' },
          h('div', { class: 'lane-name' }, h('span', { class: 'avatar' }, employee.name.slice(0, 2)), employee.name),
          h('div', { class: 'lane-meta' },
            h('span', {}, `${employee.load ?? 0} / ${employee.capacityHours} h`),
            h('span', {}, `${employee.hourlyCost} per hour`)),
          h('div', { class: `meter ${employee.load > employee.capacityHours ? 'over' : ''}` },
            h('i', { style: { width: `${Math.min(100, ((employee.load || 0) / employee.capacityHours) * 100)}%` } })),
          h('div', { class: 'lane-skills' }, employee.skills.join(' · ')),
          editable && tasks.length > 0 ? h('button', {
            class: 'btn ghost small', type: 'button', style: { 'margin-top': '9px' },
            title: allPinned ? 'Let the solver move these tasks again' : 'Keep every task of this employee where it is',
            onclick: () => edit((next) => next.tasks.filter((t) => t.employee === employee.name)
              .forEach((t) => { t.pinned = !allPinned; })),
          }, allPinned ? 'Release all' : 'Pin all') : null),
        track);
    };

    const unassigned = plan.tasks.filter((t) => !t.employee);
    const waiting = h('div', { class: 'lane-track', style: { 'background-image': 'none' } }, unassigned.map(block));
    if (editable) dropTarget(waiting, (key) => assign(key, null));

    root.replaceChildren(
      h('div', { class: 'hint' },
        h('div', { class: 'legend' }, skills.map((s) => h('span', { style: { '--c': skillColor(s) } }, h('i'), s))),
        editable ? h('span', {}, 'Drag a task to another lane to reassign it. Click it to pin it. Then solve again.') : null),
      h('div', { class: `lanes ${editable ? 'editable' : ''}` },
        plan.employees.map(lane),
        unassigned.length > 0 || editable ? h('div', { class: 'card lane unassigned' },
          h('div', { class: 'lane-who' }, h('div', { class: 'lane-name' }, 'Not assigned'),
            h('div', { class: 'lane-meta' }, h('span', {}, `${unassigned.length} task${unassigned.length === 1 ? '' : 's'}`))),
          waiting) : null));
    void moved;
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set(changes(current, plan).map((c) => c.task));
      flip(root, () => render(plan, moved), moved, animate && current !== null);
      current = plan;
    },
  };
}

function changes(prev, next) {
  if (!prev) return [];
  const before = new Map(prev.tasks.map((t) => [t.name, t.employee]));
  return next.tasks
    .filter((t) => before.has(t.name) && before.get(t.name) !== t.employee)
    .map((t) => ({ task: t.name, from: before.get(t.name), to: t.employee }));
}

/** What changed between two plans, in words. */
export function diff(prev, next) {
  return changes(prev, next).map((c) => ({
    what: c.task,
    text: `${c.from || 'not assigned'} → ${c.to || 'not assigned'}`,
  }));
}

export function kpis(plan) {
  const assigned = plan.tasks.filter((t) => t.employee).length;
  return `${assigned} of ${plan.tasks.length} tasks assigned · labour cost ${number(plan.cost || 0)}`;
}
