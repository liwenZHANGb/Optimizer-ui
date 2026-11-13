import { h } from './util.js';

/**
 * The solver form, generated from the fields the API describes: each field knows its type,
 * its bounds and when it applies (the genetic algorithm settings only show for that engine).
 */
export function renderSettings(el, config, values, onChange) {
  const draw = () => {
    el.replaceChildren();
    el.append(h('div', { class: 'panel-actions' }, h('button', {
      class: 'btn ghost small', type: 'button',
      onclick: () => { Object.assign(values, config.defaults); onChange(); draw(); },
    }, 'Restore defaults')));

    let group = null;
    for (const field of config.fields) {
      if (field.whenKey && values[field.whenKey] !== field.whenValue) continue;
      if (field.group !== group) {
        group = field.group;
        el.append(h('h2', {}, group));
      }
      el.append(row(field));
    }
  };

  const row = (field) => {
    const id = `f-${field.key}`;
    const set = (value) => {
      values[field.key] = value;
      onChange();
      // A select can show or hide other fields (engine, travel source).
      if (field.type === 'select') draw(); else wrapper.classList.toggle('changed', changed());
    };
    const changed = () => String(values[field.key] ?? '') !== String(config.defaults[field.key] ?? '');
    let control;
    if (field.type === 'select') {
      control = h('select', { id, onchange: (e) => set(e.target.value) },
        field.options.map((o) => h('option', { value: o.value, selected: o.value === values[field.key] }, o.label)));
    } else if (field.type === 'boolean') {
      control = h('input', { id, type: 'checkbox', class: 'switch', checked: values[field.key] === 'true',
        onchange: (e) => set(String(e.target.checked)) });
    } else if (field.type === 'number') {
      control = h('input', { id, type: 'number', min: field.min, max: field.max, step: field.step,
        value: values[field.key] ?? '', placeholder: field.required ? '' : 'none',
        oninput: (e) => set(e.target.value) });
    } else {
      control = h('input', { id, type: 'text', value: values[field.key] ?? '', oninput: (e) => set(e.target.value) });
    }
    const wrapper = h('div', { class: `field ${changed() ? 'changed' : ''}` },
      h('label', { for: id }, field.label),
      h('div', { class: 'control' }, control, field.unit ? h('span', { class: 'unit' }, field.unit) : null),
      field.help ? h('div', { class: 'help' }, field.help) : null);
    return wrapper;
  };

  draw();
}

/** Each constraint: on or off, its nature (hard, medium, soft) and its weight. */
export function renderConstraints(el, constraints, defaults, onChange) {
  const draw = () => {
    el.replaceChildren();
    el.append(h('div', { class: 'panel-actions' }, h('button', {
      class: 'btn ghost small', type: 'button',
      onclick: () => { constraints.splice(0, constraints.length, ...JSON.parse(JSON.stringify(defaults))); onChange(); draw(); },
    }, 'Restore defaults')));
    el.append(h('p', { class: 'muted', style: { 'margin-bottom': '6px' } },
      'A hard rule must hold. Medium counts what could not be planned. Soft is cost: its weight says how much.'));
    constraints.forEach((constraint) => el.append(row(constraint)));
  };

  const row = (constraint) => {
    const levels = h('div', { class: 'segmented', role: 'group', 'aria-label': `Nature of ${constraint.name}` },
      ['hard', 'medium', 'soft'].map((level) => h('button', {
        type: 'button', dataset: { level }, 'aria-pressed': String(constraint.level === level),
        onclick: () => { constraint.level = level; onChange(); draw(); },
      }, level[0].toUpperCase() + level.slice(1))));
    const weightId = `w-${constraint.key}`;
    return h('div', { class: `constraint ${constraint.enabled ? '' : 'off'}` },
      h('div', { class: 'constraint-head' },
        h('input', { type: 'checkbox', class: 'switch', checked: constraint.enabled, 'aria-label': `Enable ${constraint.name}`,
          onchange: (e) => { constraint.enabled = e.target.checked; onChange(); draw(); } }),
        h('strong', {}, constraint.name)),
      h('div', { class: 'constraint-body' },
        levels,
        h('label', { for: weightId }, 'Weight'),
        h('input', { id: weightId, type: 'number', min: 0, step: 1, value: constraint.weight,
          oninput: (e) => { constraint.weight = Math.max(0, Number(e.target.value) || 0); onChange(); } })));
  };

  draw();
}
