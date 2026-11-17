import { h, keepFocus } from './util.js';
import { t, tApi } from './i18n.js';
import { weightText } from './score.js';

/** The setting that chooses the engine. */
export const ENGINE = 'solver.engine';

/**
 * Engines kept for benchmarking only: they solve a fixed mathematical formulation of the
 * problem and know nothing of the configurable constraints nor of user-defined rules.
 */
export const BENCHMARK_ENGINES = ['ortools', 'choco'];

/** The benchmark engine the settings choose, or null when the engine works from the constraints. */
export const benchmarkEngine = (values) => (BENCHMARK_ENGINES.includes(values?.[ENGINE]) ? values[ENGINE] : null);

/** An ⓘ that explains itself on hover and on keyboard focus. */
function info(text) {
  return h('span', { class: 'info', tabindex: 0, role: 'note', 'aria-label': text, 'data-tip': text }, 'i');
}

/**
 * The solver form, generated from the fields the API describes: each field knows its type,
 * its bounds and when it applies (the genetic algorithm settings only show for that engine).
 * Labels and help are worded in the language of the page, by the key of the field.
 */
export function renderSettings(el, config, values, onChange) {
  const draw = () => keepFocus(el, () => {
    el.replaceChildren();
    el.append(h('div', { class: 'panel-actions' }, h('button', {
      class: 'btn ghost small', type: 'button', dataset: { focus: 'restore' },
      onclick: () => { Object.assign(values, config.defaults); onChange(null); draw(); },
    }, t('action.restore'))));

    let group = null;
    for (const field of config.fields) {
      if (field.whenKey && values[field.whenKey] !== field.whenValue) continue;
      if (field.group !== group) {
        group = field.group;
        el.append(h('h2', {}, tApi(`group.${group}`, group)));
      }
      el.append(row(field));
    }
  });

  const row = (field) => {
    const id = `f-${field.key}`;
    const set = (value) => {
      values[field.key] = value;
      onChange(field.key);
      // A select can show or hide other fields (engine, travel source).
      if (field.type === 'select') draw(); else wrapper.classList.toggle('changed', changed());
    };
    const changed = () => String(values[field.key] ?? '') !== String(config.defaults[field.key] ?? '');
    const label = tApi(`field.${field.key}`, field.label);
    let control;
    if (field.type === 'select') {
      control = h('select', { id, dataset: { focus: id }, onchange: (e) => set(e.target.value) },
        field.options.map((o) => h('option', { value: o.value, selected: o.value === values[field.key] },
          tApi(`field.${field.key}.${o.value}`, o.label))));
    } else if (field.type === 'boolean') {
      control = h('input', { id, dataset: { focus: id }, type: 'checkbox', class: 'switch', checked: values[field.key] === 'true',
        onchange: (e) => set(String(e.target.checked)) });
    } else if (field.type === 'number') {
      control = h('input', { id, dataset: { focus: id }, type: 'number', min: field.min, max: field.max, step: field.step,
        value: values[field.key] ?? '', placeholder: field.required ? '' : t('settings.none'),
        oninput: (e) => set(e.target.value) });
    } else {
      control = h('input', { id, dataset: { focus: id }, type: 'text', value: values[field.key] ?? '', oninput: (e) => set(e.target.value) });
    }
    const isEngine = field.key === ENGINE;
    const benchmark = isEngine ? benchmarkEngine(values) : null;
    const wrapper = h('div', { class: `field ${changed() ? 'changed' : ''}` },
      h('div', { class: 'field-label' },
        h('label', { for: id, 'data-edited': t('settings.edited') }, label),
        isEngine ? info(t('engine.benchmark.tip')) : null),
      h('div', { class: 'control' }, control, field.unit ? h('span', { class: 'unit' }, tApi(`unit.${field.unit}`, field.unit)) : null),
      field.help ? h('div', { class: 'help' }, tApi(`field.${field.key}.help`, field.help)) : null,
      benchmark ? h('div', { class: 'field-note', role: 'status' },
        t('engine.benchmark.note', { engine: tApi(`engine.${benchmark}`, benchmark) })) : null);
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
 * @param extras.onRemove removes a user-defined rule, given its constraint
 * @param extras.locked   why the constraints cannot be configured now (a benchmark engine is
 *                        chosen), or null: when set, the panel is shown read-only with that reason
 */
export function renderConstraints(el, constraints, defaults, onChange, extras = {}) {
  const stored = new Map((extras.rules || []).map((rule) => [rule.rule.key, rule]));
  const name = (constraint) => (constraint.custom ? constraint.name : tApi(`constraint.${constraint.key}`, constraint.name));
  const locked = extras.locked || null;

  const draw = () => keepFocus(el, () => {
    el.replaceChildren();
    el.append(h('div', { class: 'panel-actions' },
      extras.onNew ? h('button', {
        class: 'btn primary small', type: 'button', dataset: { focus: 'new' }, onclick: extras.onNew,
        disabled: Boolean(locked), title: locked ? t('rules.new.locked') : null,
      }, t('rules.new')) : null,
      h('button', {
        class: 'btn ghost small', type: 'button', dataset: { focus: 'restore' }, disabled: Boolean(locked),
        onclick: () => { constraints.splice(0, constraints.length, ...JSON.parse(JSON.stringify(defaults))); onChange(); draw(); },
      }, t('action.restore'))));
    if (locked) el.append(h('div', { class: 'locked-note', role: 'status' }, h('strong', {}, t('constraints.locked.title')), ' ', locked));
    // A disabled fieldset disables every control in it at once; the rule details still open.
    const set = h('fieldset', { class: 'constraint-set', disabled: Boolean(locked) });
    const groups = [
      ['constraints.rules', 'constraints.rules.help', constraints.filter((c) => c.level === 'hard')],
      ['constraints.objectives', 'constraints.objectives.help', constraints.filter((c) => c.level !== 'hard')],
    ];
    for (const [title, help, members] of groups) {
      set.append(h('h2', {}, `${t(title)} (${members.length})`), h('p', { class: 'muted group-help' }, t(help)));
      members.forEach((constraint) => set.append(row(constraint)));
      if (!members.length) set.append(h('p', { class: 'muted' }, t('constraints.none')));
    }
    el.append(set);
  });

  const monitoring = (rule) => {
    if (!rule?.jobs) return t('rules.monitor.never');
    const last = rule.lastViolations
      ? t('rules.monitor.broken', { count: rule.lastViolations, score: rule.lastScore })
      : t('rules.monitor.satisfied');
    return `${t('rules.monitor.jobs', { count: rule.jobs })} · ${last}`;
  };

  const row = (constraint) => {
    const label = name(constraint);
    const levels = h('div', { class: 'segmented', role: 'group', 'aria-label': t('constraints.nature', { name: label }) },
      ['hard', 'medium', 'soft'].map((level) => h('button', {
        type: 'button', dataset: { level, focus: `l-${constraint.key}-${level}` }, 'aria-pressed': String(constraint.level === level),
        onclick: () => { constraint.level = level; onChange(); draw(); },
      }, t(`level.${level}`))));
    const weightId = `w-${constraint.key}`;
    const rule = stored.get(constraint.key);
    return h('div', { class: `constraint ${constraint.enabled ? '' : 'off'}` },
      h('div', { class: 'constraint-head' },
        h('input', { type: 'checkbox', class: 'switch', checked: constraint.enabled, dataset: { focus: `e-${constraint.key}` },
          'aria-label': t('constraints.enable', { name: label }),
          onchange: (e) => { constraint.enabled = e.target.checked; onChange(); draw(); } }),
        h('strong', {}, label),
        h('span', { class: `badge ${constraint.custom ? 'custom' : ''}` }, t(constraint.custom ? 'constraints.custom' : 'constraints.standard'))),
      h('div', { class: 'constraint-body' },
        levels,
        h('label', { for: weightId }, t('constraints.weight')),
        h('input', { id: weightId, dataset: { focus: weightId }, type: 'number', min: 0, step: 1, value: constraint.weight,
          oninput: (e) => { constraint.weight = Math.max(0, Math.round(Number(e.target.value)) || 0); onChange(); } })),
      constraint.custom ? h('details', { class: 'rule-details' },
        h('summary', {}, monitoring(rule)),
        h('pre', { class: 'structured' }, constraint.definition || ''),
        rule?.rule.source ? h('p', { class: 'muted' }, t('rules.from', { sentence: rule.rule.source })) : null,
        extras.onRemove ? h('button', { class: 'btn ghost small danger', type: 'button',
          onclick: () => extras.onRemove(constraint) }, t('rules.remove')) : null) : null);
  };

  draw();
}

export { weightText };
