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

/**
 * Each constraint: on or off, its nature (hard, medium, soft) and its weight. Hard ones are
 * the rules a plan must follow, the others the objectives it is scored on. Constraints that
 * come with the use case are standard; those added by a user are custom, and show how they
 * have behaved in the jobs that applied them.
 *
 * @param extras.rules    the user-defined rules as the API lists them, with their monitoring figures
 * @param extras.onNew    opens the rule builder
 * @param extras.onRemove removes a user-defined rule, given its key
 */
export function renderConstraints(el, constraints, defaults, onChange, extras = {}) {
  const stored = new Map((extras.rules || []).map((rule) => [rule.rule.key, rule]));

  const draw = () => {
    el.replaceChildren();
    el.append(h('div', { class: 'panel-actions' },
      extras.onNew ? h('button', { class: 'btn primary small', type: 'button', onclick: extras.onNew }, '+ New rule') : null,
      h('button', {
        class: 'btn ghost small', type: 'button',
        onclick: () => { constraints.splice(0, constraints.length, ...JSON.parse(JSON.stringify(defaults))); onChange(); draw(); },
      }, 'Restore defaults')));
    const groups = [
      ['Rules', 'What a plan must follow. Breaking one makes the plan infeasible.', constraints.filter((c) => c.level === 'hard')],
      ['Objectives', 'What a plan is scored on. Medium counts what could not be planned; soft is cost, and its weight says how much.',
        constraints.filter((c) => c.level !== 'hard')],
    ];
    for (const [title, help, members] of groups) {
      el.append(h('h2', {}, `${title} (${members.length})`), h('p', { class: 'muted group-help' }, help));
      members.forEach((constraint) => el.append(row(constraint)));
      if (!members.length) el.append(h('p', { class: 'muted' }, 'None.'));
    }
  };

  const row = (constraint) => {
    const levels = h('div', { class: 'segmented', role: 'group', 'aria-label': `Nature of ${constraint.name}` },
      ['hard', 'medium', 'soft'].map((level) => h('button', {
        type: 'button', dataset: { level }, 'aria-pressed': String(constraint.level === level),
        onclick: () => { constraint.level = level; onChange(); draw(); },
      }, level[0].toUpperCase() + level.slice(1))));
    const weightId = `w-${constraint.key}`;
    const rule = stored.get(constraint.key);
    return h('div', { class: `constraint ${constraint.enabled ? '' : 'off'}` },
      h('div', { class: 'constraint-head' },
        h('input', { type: 'checkbox', class: 'switch', checked: constraint.enabled, 'aria-label': `Enable ${constraint.name}`,
          onchange: (e) => { constraint.enabled = e.target.checked; onChange(); draw(); } }),
        h('strong', {}, constraint.name),
        h('span', { class: `badge ${constraint.custom ? 'custom' : ''}` }, constraint.custom ? 'Custom' : 'Standard')),
      h('div', { class: 'constraint-body' },
        levels,
        h('label', { for: weightId }, 'Weight'),
        h('input', { id: weightId, type: 'number', min: 0, step: 1, value: constraint.weight,
          oninput: (e) => { constraint.weight = Math.max(0, Number(e.target.value) || 0); onChange(); } })),
      constraint.custom ? h('details', { class: 'rule-details' },
        h('summary', {}, rule?.jobs
          ? `Applied in ${rule.jobs} job${rule.jobs === 1 ? '' : 's'} · last: ${rule.lastViolations ? `broken ${rule.lastViolations} time${rule.lastViolations === 1 ? '' : 's'}, ${rule.lastScore}` : 'satisfied'}`
          : 'Not applied in a job yet'),
        h('pre', { class: 'structured' }, constraint.definition || ''),
        rule?.rule.source ? h('p', { class: 'muted' }, `From: "${rule.rule.source}"`) : null,
        extras.onRemove ? h('button', { class: 'btn ghost small danger', type: 'button',
          onclick: () => extras.onRemove(constraint) }, 'Remove this rule') : null) : null);
  };

  draw();
}
