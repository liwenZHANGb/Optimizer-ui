import { h } from './util.js';

/**
 * The rule builder: a rule is described in a sentence or assembled from building blocks,
 * previewed in its structured form, validated, tested on the plan on screen, then activated.
 *
 * Nothing is decided here. The page only edits a description of the rule (plain text fields)
 * and shows what the API answers: interpretation, validation, test and activation all happen
 * on the server, which checks everything again when a rule is activated.
 */

const COMPARISONS = [['>=', 'is at least'], ['<=', 'is at most'], ['>', 'is more than'], ['<', 'is less than'],
  ['==', 'equals'], ['!=', 'differs from']];
/** Items by the value of a key, in order of first appearance. */
function groupBy(items, key) {
  const groups = {};
  for (const item of items) (groups[key(item)] ||= []).push(item);
  return groups;
}

/** Replaces the content of an element; nested lists are flattened and empty entries left out. */
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
}

const SEVERITY = { ERROR: ['bad', '✕'], WARNING: ['warn', '!'], INFO: ['info', 'i'] };

// ---- Between the text of a condition and its blocks -----------------------------------------------

/** Splits at the top level (outside parentheses and quotes) on a word such as AND. */
function splitTop(text, word) {
  const parts = [];
  let depth = 0, quote = null, start = 0;
  const upper = text.toUpperCase();
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && upper.startsWith(` ${word} `, i)) {
      parts.push(text.slice(start, i));
      start = i + word.length + 2;
      i = start - 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

function parseRow(text, known) {
  let body = text.trim();
  let not = false;
  const negated = /^NOT\s+(.*)$/i.exec(body);
  if (negated) { not = true; body = negated[1].trim(); }
  if (body.startsWith('(') && body.endsWith(')') && splitTop(body.slice(1, -1), 'AND').length === 1
      && splitTop(body.slice(1, -1), 'OR').length === 1) body = body.slice(1, -1).trim();
  let depth = 0, quote = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0) {
      const op = ['>=', '<=', '==', '!='].find((o) => body.startsWith(o, i)) || (c === '>' || c === '<' ? c : null);
      if (op) {
        const left = body.slice(0, i).trim();
        return known.has(left) ? { not, left, op, right: body.slice(i + op.length).trim() } : null;
      }
    }
  }
  return known.has(body) ? { not: false, left: body, op: not ? 'false' : 'true', right: '' } : null;
}

/** The blocks of a condition, or null when it is too elaborate for blocks and stays as text. */
function toBlocks(text, known, fallbackJoin) {
  if (!text.trim()) return { join: fallbackJoin, rows: [] };
  const any = splitTop(text, 'OR');
  const all = splitTop(text, 'AND');
  if (any.length > 1 && any.some((part) => splitTop(part, 'AND').length > 1)) return null;
  const join = any.length > 1 ? 'OR' : 'AND';
  const rows = (any.length > 1 ? any : all).map((part) => parseRow(part, known));
  return rows.every(Boolean) ? { join: rows.length > 1 ? join : fallbackJoin, rows } : null;
}

function rowText(row, types) {
  if (!row.left) return '';
  if (row.op === 'true') return row.left;
  if (row.op === 'false') return `NOT ${row.left}`;
  let right = row.right.trim();
  if (types.get(row.left) === 'text' && right && !/^["']/.test(right) && !types.has(right)) right = `"${right}"`;
  const text = `${row.left} ${row.op} ${right}`;
  return row.not ? `NOT (${text})` : text;
}

const fromBlocks = (blocks, types) => blocks.rows.map((row) => rowText(row, types)).filter(Boolean).join(` ${blocks.join} `);

// ---- The dialog -----------------------------------------------------------------------------------

/**
 * @param ctx.url        (path) => address of an operation of the current use case
 * @param ctx.vocabulary what rules may refer to, from GET /rules/vocabulary
 * @param ctx.request    () => the plan on screen with the settings and constraints of the panel
 * @param ctx.onActivated called with the stored rule once it is active
 */
export function openRuleBuilder(dialog, ctx) {
  const { vocabulary } = ctx;
  const draft = { name: '', description: '', entity: vocabulary.entities[0].name, exclusion: '', expression: '',
    penalty: '', level: 'hard', weight: 1, source: '' };
  const ui = { sentence: '', interpretation: null, customPenalty: false, check: null, checkedKey: null,
    testedKey: null, accept: false, busy: null, error: null, target: null,
    editors: { exclusion: { text: false, blocks: { join: 'OR', rows: [] } },
      expression: { text: false, blocks: { join: 'AND', rows: [] } } } };

  const entity = () => vocabulary.entities.find((e) => e.name === draft.entity);
  /** Everything that has a value for the entity of the rule: its attributes, those it links to, the parameters. */
  const values = () => {
    const self = entity();
    const list = [];
    for (const a of self.attributes) {
      const linked = vocabulary.entities.find((e) => e.name === a.type);
      if (!linked) list.push({ usage: a.usage, type: a.type, label: a.name, description: a.description, group: self.name });
    }
    for (const a of self.attributes) {
      const linked = vocabulary.entities.find((e) => e.name === a.type);
      for (const b of linked?.attributes ?? []) {
        if (!vocabulary.entities.some((e) => e.name === b.type)) {
          list.push({ usage: `${b.name}(${a.usage})`, type: b.type, label: `${a.name} · ${b.name}`,
            description: b.description, group: `${linked.name} of the ${self.name.toLowerCase()}` });
        }
      }
    }
    for (const p of vocabulary.parameters) {
      list.push({ usage: p.name, type: p.type, label: p.name, description: p.description, group: 'Plan' });
    }
    return list;
  };
  const types = () => new Map(values().map((v) => [v.usage, v.type]));
  const rule = () => ({ ...draft, weight: Number(draft.weight) || 1, penalty: ui.customPenalty ? draft.penalty : '' });
  const key = () => JSON.stringify(rule());
  const fresh = () => ui.check && ui.checkedKey === key();

  async function post(path, body) {
    let response;
    try {
      response = await fetch(ctx.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
    } catch (error) {
      throw new Error('The optimizer API cannot be reached.');
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    // 422 is an answer, not a failure: the rule was examined and not let through.
    if (!response.ok && response.status !== 422) throw new Error(data?.message || `${response.status} ${response.statusText}`);
    return { status: response.status, data };
  }

  // ---- actions ----

  let timer = null;
  function changed({ redraw = false } = {}) {
    for (const field of ['exclusion', 'expression']) {
      if (!ui.editors[field].text) draft[field] = fromBlocks(ui.editors[field].blocks, types());
    }
    ui.accept = false;
    clearTimeout(timer);
    timer = setTimeout(validate, 450);
    if (redraw) drawForm();
    drawPreview();
    drawSteps();
  }

  async function validate() {
    if (!draft.expression.trim()) { ui.check = null; drawPreview(); drawSteps(); return; }
    const asked = key();
    try {
      const { data } = await post('/rules/validate', { rule: rule() });
      if (asked !== key()) return;          // the rule changed while the answer was on its way
      ui.check = data; ui.checkedKey = asked; ui.error = null;
    } catch (error) {
      ui.error = error.message;
    }
    drawPreview(); drawSteps();
  }

  async function interpret() {
    if (!ui.sentence.trim()) return;
    ui.busy = 'interpret'; ui.error = null; drawSentence();
    try {
      const { data } = await post('/rules/interpret', { text: ui.sentence });
      ui.interpretation = data;
      if (data.understood) {
        Object.assign(draft, { ...data.rule, weight: data.rule.weight ?? 1 });
        ui.customPenalty = false;
        load();
      }
    } catch (error) {
      ui.error = error.message;
    }
    ui.busy = null;
    drawSentence(); drawPalette(); changed({ redraw: true });
  }

  /** Puts the texts of the draft into blocks where they are simple enough. */
  function load() {
    const known = new Set(values().map((v) => v.usage));
    for (const [field, join] of [['exclusion', 'OR'], ['expression', 'AND']]) {
      const blocks = toBlocks(draft[field], known, join);
      ui.editors[field] = blocks ? { text: false, blocks } : { text: true, blocks: { join, rows: [] } };
    }
  }

  async function test() {
    ui.busy = 'test'; ui.error = null; drawPreview();
    const asked = key();
    try {
      const { data } = await post('/rules/test', { ...ctx.request(), rule: rule(), solve: true });
      ui.check = data; ui.checkedKey = asked; ui.testedKey = data.status === 'ERRORS' ? null : asked;
    } catch (error) {
      ui.error = error.message;
    }
    ui.busy = null;
    drawPreview(); drawSteps();
  }

  async function activate() {
    ui.busy = 'activate'; ui.error = null; drawPreview();
    try {
      const { status, data } = await post('/rules', { ...ctx.request(), rule: rule(), acceptWarnings: ui.accept });
      if (status === 422) {
        ui.check = data; ui.checkedKey = key();
        ui.error = data.status === 'ERRORS' ? 'The server refused the rule: it has errors.'
          : 'The server found warnings: accept them to activate the rule.';
      } else {
        dialog.close();
        ctx.onActivated(data);
        return;
      }
    } catch (error) {
      ui.error = error.message;
    }
    ui.busy = null;
    drawPreview(); drawSteps();
  }

  /** A building block was picked: it goes where the cursor was, or becomes a new condition. */
  function insert(usage) {
    const target = ui.target;
    if (target && target.isConnected && target.matches('input[type="text"], textarea')) {
      const at = target.selectionStart ?? target.value.length;
      const before = target.value.slice(0, at);
      const glue = before && !/[\s(,]$/.test(before) ? ' ' : '';
      target.setRangeText(glue + usage, at, target.selectionEnd ?? at, 'end');
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.focus();
      return;
    }
    const editor = ui.editors.expression;
    if (!editor.text && types().has(usage)) {
      editor.blocks.rows.push({ not: false, left: usage, op: types().get(usage) === 'boolean' ? 'true' : '>=', right: '' });
      changed({ redraw: true });
    }
  }

  // ---- drawing ----

  const steps = h('ol', { class: 'steps' });
  const sentence = h('section', { class: 'sheet-section' });
  const form = h('section', { class: 'sheet-section' });
  const preview = h('section', { class: 'sheet-section' });
  const palette = h('aside', { class: 'blocks', 'aria-label': 'Building blocks' });

  function drawSteps() {
    const defined = Boolean(draft.expression.trim() && draft.name.trim());
    const valid = fresh() && ui.check.status !== 'ERRORS';
    const tested = valid && ui.testedKey === key();
    const done = [defined, defined, valid, tested, false];
    const current = done.indexOf(false);
    fill(steps, ...['Describe or build', 'Preview', 'Validate', 'Test', 'Activate'].map((label, i) =>
      h('li', { class: done[i] ? 'done' : i === current ? 'current' : '' }, h('i', {}, done[i] ? '✓' : String(i + 1)), label)));
  }

  function drawSentence() {
    const area = h('textarea', { rows: 3, placeholder: 'For example: ' + (vocabulary.examples[0] || ''),
      'aria-label': 'The rule as a sentence',
      oninput: (e) => { ui.sentence = e.target.value; }, onfocus: (e) => { ui.target = e.target; } }, ui.sentence);
    const result = ui.interpretation;
    fill(sentence, 
      h('h3', {}, 'Describe it'),
      h('p', { class: 'muted' }, 'Write the rule as a sentence. It is turned into the structured form below, which you '
        + 'can then correct. Or skip this and build the rule from the blocks.'),
      area,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', type: 'button', disabled: ui.busy === 'interpret', onclick: interpret },
          ui.busy === 'interpret' ? 'Reading…' : 'Interpret'),
        h('span', { class: 'muted' }, 'Try:'),
        vocabulary.examples.map((example) => h('button', { class: 'chip', type: 'button',
          onclick: () => { ui.sentence = example; drawSentence(); } }, example))),
      result && !result.understood ? h('div', { class: 'finding bad' }, h('i', {}, '✕'),
        h('div', {}, h('b', {}, 'Not understood. '), result.problems.join(' '))) : null,
      result && result.understood ? h('details', { class: 'notes', open: result.problems.length > 0 },
        h('summary', {}, `Understood. How it was read (${result.notes.length})`),
        h('ul', {}, result.notes.map((note) => h('li', {}, note))),
        result.problems.map((problem) => h('div', { class: 'finding warn' }, h('i', {}, '!'), h('div', {}, problem)))) : null);
  }

  function condition(field, title, help) {
    const editor = ui.editors[field];
    const known = values();
    const body = h('div', { class: 'condition' });
    if (editor.text) {
      body.append(h('input', { type: 'text', class: 'mono', value: draft[field], spellcheck: 'false',
        placeholder: field === 'exclusion' ? 'nobody is exempt' : `for example ${known[0]?.usage} >= 1`,
        'aria-label': title, oninput: (e) => { draft[field] = e.target.value; changed(); },
        onfocus: (e) => { ui.target = e.target; } }));
    } else {
      editor.blocks.rows.forEach((row, index) => {
        const type = types().get(row.left);
        const flag = type === 'boolean';
        const operators = flag ? [['true', 'is true'], ['false', 'is false']] : COMPARISONS.filter(([op]) =>
          type !== 'text' || op === '==' || op === '!=');
        if (!operators.some(([op]) => op === row.op)) row.op = operators[0][0];
        body.append(h('div', { class: 'block-row' },
          index > 0 ? h('span', { class: `joiner ${editor.blocks.join.toLowerCase()}` }, editor.blocks.join) : null,
          h('select', { 'aria-label': 'Value', onchange: (e) => { row.left = e.target.value; changed({ redraw: true }); } },
            Object.entries(groupBy(known, (v) => v.group)).map(([group, items]) => h('optgroup', { label: group },
              items.map((v) => h('option', { value: v.usage, selected: v.usage === row.left }, v.label))))),
          h('select', { 'aria-label': 'Comparison', onchange: (e) => { row.op = e.target.value; changed(); } },
            operators.map(([op, label]) => h('option', { value: op, selected: op === row.op }, label))),
          flag ? null : h('input', { type: 'text', class: 'mono', value: row.right, spellcheck: 'false',
            placeholder: type === 'text' ? 'a text' : 'a number or a value', 'aria-label': 'Compared with',
            oninput: (e) => { row.right = e.target.value; changed(); }, onfocus: (e) => { ui.target = e.target; } }),
          flag ? null : h('button', { class: `toggle ${row.not ? 'on' : ''}`, type: 'button', title: 'Negate this condition',
            'aria-pressed': String(row.not), onclick: () => { row.not = !row.not; changed({ redraw: true }); } }, 'NOT'),
          h('button', { class: 'icon-x', type: 'button', title: 'Remove this condition', 'aria-label': 'Remove this condition',
            onclick: () => { editor.blocks.rows.splice(index, 1); changed({ redraw: true }); } }, '×')));
      });
      body.append(h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
          editor.blocks.rows.push({ not: false, left: known[0].usage, op: '>=', right: '' });
          changed({ redraw: true });
        } }, '+ Condition'),
        editor.blocks.rows.length > 1 ? h('div', { class: 'segmented', role: 'group', 'aria-label': 'How the conditions combine' },
          [['AND', 'All of them'], ['OR', 'Any of them']].map(([join, label]) => h('button', { type: 'button',
            'aria-pressed': String(editor.blocks.join === join),
            onclick: () => { editor.blocks.join = join; changed({ redraw: true }); } }, label))) : null));
    }
    return h('div', { class: 'form-block' },
      h('div', { class: 'form-head' }, h('label', {}, title), h('span', { class: 'muted' }, help),
        h('button', { class: 'link', type: 'button', onclick: () => {
          if (editor.text) {
            const blocks = toBlocks(draft[field], new Set(known.map((v) => v.usage)), editor.blocks.join);
            if (!blocks) { ui.error = 'This condition is too elaborate for blocks: it stays as text.'; drawPreview(); return; }
            ui.editors[field] = { text: false, blocks };
          } else {
            editor.text = true;
          }
          drawForm();
        } }, editor.text ? 'Use blocks' : 'Edit as text')),
      body);
  }

  function drawForm() {
    const self = entity();
    fill(form, 
      h('h3', {}, 'Build it'),
      h('div', { class: 'form-grid' },
        h('label', { for: 'rule-name' }, 'Name'),
        h('input', { id: 'rule-name', type: 'text', value: draft.name, maxlength: 80, placeholder: 'A short name for the rule',
          oninput: (e) => { draft.name = e.target.value; changed(); }, onfocus: () => { ui.target = null; } }),
        h('label', { for: 'rule-entity' }, 'Applies to each'),
        h('select', { id: 'rule-entity', onchange: (e) => {
          draft.entity = e.target.value;
          ui.editors.exclusion = { text: false, blocks: { join: 'OR', rows: [] } };
          ui.editors.expression = { text: false, blocks: { join: 'AND', rows: [] } };
          changed({ redraw: true }); drawPalette();
        } }, vocabulary.entities.map((e) => h('option', { value: e.name, selected: e.name === draft.entity },
          `${e.name} - ${e.description}`))),
        h('label', {}, 'Nature'),
        h('div', { class: 'row' },
          h('div', { class: 'segmented', role: 'group', 'aria-label': 'Nature of the rule' },
            vocabulary.levels.map((level) => h('button', { type: 'button', dataset: { level },
              'aria-pressed': String(draft.level === level),
              onclick: () => { draft.level = level; changed({ redraw: true }); } }, level[0].toUpperCase() + level.slice(1)))),
          h('label', { for: 'rule-weight', class: 'muted' }, 'Weight'),
          h('input', { id: 'rule-weight', type: 'number', min: 1, step: 1, value: draft.weight, style: { width: '84px' },
            oninput: (e) => { draft.weight = e.target.value; changed(); } }),
          h('span', { class: 'muted' }, draft.level === 'hard' ? 'A rule: it must hold.' : 'An objective: breaking it costs points.'))),
      condition('expression', 'Must hold', `for each ${self.name.toLowerCase()} (${self.alias})`),
      condition('exclusion', 'Except when', 'those are exempt'),
      h('div', { class: 'form-block' },
        h('div', { class: 'form-head' }, h('label', {}, 'Penalty'), h('span', { class: 'muted' }, 'what one violation costs, times the weight')),
        h('div', { class: 'row' },
          h('div', { class: 'segmented', role: 'group', 'aria-label': 'Penalty' },
            [[false, 'Distance to the rule'], [true, 'My own formula']].map(([custom, label]) => h('button', { type: 'button',
              'aria-pressed': String(ui.customPenalty === custom), onclick: () => {
                ui.customPenalty = custom;
                if (custom && !draft.penalty) draft.penalty = ui.check?.suggestedPenalty || '';
                changed({ redraw: true });
              } }, label)))),
        ui.customPenalty ? h('input', { type: 'text', class: 'mono', value: draft.penalty, spellcheck: 'false',
          'aria-label': 'Penalty formula', placeholder: 'a number: 0 when the rule holds, positive when it is broken',
          oninput: (e) => { draft.penalty = e.target.value; changed(); }, onfocus: (e) => { ui.target = e.target; } }) : null));
  }

  function finding(item) {
    const [tone, mark] = SEVERITY[item.severity];
    const example = Object.entries(item.example || {});
    return h('div', { class: `finding ${tone}` }, h('i', {}, mark), h('div', {}, item.message,
      example.length ? h('div', { class: 'example' }, h('span', { class: 'muted' }, 'For example '),
        example.map(([name, value]) => h('code', {}, `${name} = ${value}`))) : null));
  }

  function drawPreview() {
    const check = fresh() ? ui.check : null;
    const stale = ui.check && !check;
    const local = `ENTITY: ${draft.entity}\nEXCLUSION: ${draft.exclusion || 'none'}\nEXPRESSION: ${draft.expression || '…'}\n`
      + `PENALTY: ${ui.customPenalty ? draft.penalty || '…' : 'distance to the rule'}`;
    const tested = check && ui.testedKey === key();
    const onPlan = tested ? check.plan : null;
    const trial = tested ? check.trial : null;
    const canActivate = tested && check.status !== 'ERRORS' && (check.status === 'OK' || ui.accept) && !ui.busy;

    fill(preview, 
      h('h3', {}, 'Preview and checks'),
      h('pre', { class: 'structured' }, check?.text || local),
      check?.explanation ? h('p', { class: 'explain' }, check.explanation) : null,
      !draft.expression.trim() ? h('p', { class: 'muted' }, 'Say what must hold to see the checks.')
        : stale || !ui.check ? h('p', { class: 'muted' }, 'Checking…')
        : h('div', { class: `verdict ${check.status.toLowerCase()}` },
          check.status === 'OK' ? `Valid. Tried on ${check.cases.toLocaleString('en-GB')} combinations of values.`
            : check.status === 'WARNINGS' ? 'Valid, with warnings.' : 'Not valid: it cannot be activated as it is.'),
      check ? check.findings.map(finding) : null,
      ui.error ? h('div', { class: 'finding bad' }, h('i', {}, '✕'), h('div', {}, ui.error)) : null,

      onPlan ? h('div', { class: 'result' },
        h('h4', {}, 'On the plan on screen'),
        h('div', { class: 'stats' },
          stat(onPlan.violated, 'break it', onPlan.violated ? 'bad' : ''), stat(onPlan.satisfied, 'satisfy it', 'ok'),
          stat(onPlan.excluded, 'exempt'), stat(onPlan.notApplicable, 'not concerned')),
        h('p', { class: 'muted' }, `Score ${onPlan.scoreWithout.text} without the rule, ${onPlan.scoreWith.text} with it.`),
        onPlan.violations.length ? h('table', { class: 'violations' },
          h('thead', {}, h('tr', {}, h('th', {}, draft.entity), h('th', {}, 'Penalty'), h('th', {}, 'Values'))),
          h('tbody', {}, onPlan.violations.map((v) => h('tr', {}, h('td', {}, v.entity), h('td', {}, String(v.penalty)),
            h('td', {}, Object.entries(v.values).map(([name, value]) => h('code', {}, `${name} = ${value}`))))))) : null) : null,
      trial ? h('div', { class: 'result' },
        h('h4', {}, `Trial optimization, ${trial.seconds} s each`),
        h('div', { class: 'compare' },
          h('div', {}, h('small', {}, 'Without the rule'), h('b', {}, trial.without.text)),
          h('div', { class: trial.with.feasible ? '' : 'bad' }, h('small', {}, 'With the rule'), h('b', {}, trial.with.text)),
          h('div', { class: trial.violations ? 'warn' : 'ok' }, h('small', {}, 'Still broken'), h('b', {}, String(trial.violations))))) : null,

      h('div', { class: 'sheet-actions' },
        check?.status === 'WARNINGS' && tested ? h('label', { class: 'accept' },
          h('input', { type: 'checkbox', checked: ui.accept, onchange: (e) => { ui.accept = e.target.checked; drawPreview(); } }),
          'I have read the warnings and want to activate the rule anyway') : h('span', {}),
        h('button', { class: 'btn ghost', type: 'button', disabled: !check || check.status === 'ERRORS' || Boolean(ui.busy),
          onclick: test }, ui.busy === 'test' ? 'Testing…' : tested ? 'Test again' : 'Test on the current plan'),
        h('button', { class: 'btn primary', type: 'button', disabled: !canActivate, onclick: activate,
          title: tested ? '' : 'Test the rule first' }, ui.busy === 'activate' ? 'Activating…' : 'Activate rule')));
  }

  const stat = (count, label, tone = '') => h('div', { class: `stat ${tone}` }, h('b', {}, String(count)), h('small', {}, label));

  function drawPalette(filter = '') {
    const self = entity();
    const match = (...texts) => texts.join(' ').toLowerCase().includes(filter.toLowerCase());
    const block = (usage, type, description) => h('button', { class: 'block', type: 'button', draggable: 'true',
      title: 'Click to insert, or drag into a field',
      onmousedown: (e) => e.preventDefault(),        // keep the cursor where it is in the field being edited
      ondragstart: (e) => e.dataTransfer.setData('text/plain', usage),
      onclick: () => insert(usage) },
      h('span', { class: 'block-head' }, h('code', {}, usage), type ? h('span', { class: 'type' }, type) : null),
      h('span', { class: 'block-text' }, description));
    const section = (title, blocks) => blocks.length ? [h('h4', {}, `${title} (${blocks.length})`), blocks] : [];
    const known = values().filter((v) => match(v.usage, v.description));
    const list = h('div', { class: 'blocks-list' },
      Object.entries(groupBy(known, (v) => v.group)).flatMap(([group, items]) =>
        section(group, items.map((v) => block(v.usage, v.type, v.description)))),
      section('Operators', [['AND', 'both conditions hold'], ['OR', 'at least one holds'], ['NOT', 'the opposite'],
        ...vocabulary.comparisons.map((c) => [c, 'comparison'])].filter(([name, text]) => match(name, text))
        .map(([name, text]) => block(name, null, text))),
      section('Functions', vocabulary.functions.filter((f) => match(f.name, f.description))
        .map((f) => block(f.usage, null, f.description))));
    fill(palette, 
      h('h3', {}, 'Building blocks'),
      h('input', { type: 'text', placeholder: 'Search', value: filter, 'aria-label': 'Search the building blocks',
        oninput: (e) => { const at = e.target.selectionStart; drawPalette(e.target.value);
          const input = palette.querySelector('input'); input.focus(); input.setSelectionRange(at, at); } }),
      h('p', { class: 'muted' }, `What a rule about ${/^[aeiou]/i.test(self.name) ? 'an' : 'a'} ${self.name.toLowerCase()} can read. Click a block to insert it where the cursor is, or drag it into a field.`),
      list);
  }

  fill(dialog, 
    h('header', { class: 'sheet-head' },
      h('div', {}, h('h2', {}, 'New rule'), h('p', { class: 'muted' }, ctx.title)),
      steps,
      h('button', { class: 'icon-x large', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, '×')),
    h('div', { class: 'sheet-body' }, h('div', { class: 'sheet-main' }, sentence, form, preview), palette));
  drawSteps(); drawSentence(); drawForm(); drawPreview(); drawPalette();
  dialog.showModal();
}
