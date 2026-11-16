import { h, fill, keepFocus, number } from './util.js';
import { t, tApi, tMessage } from './i18n.js';

/**
 * The rule builder: a rule is described in a sentence or assembled from building blocks,
 * previewed in its structured form, validated, tested on the plan on screen, then activated.
 *
 * Nothing is decided here. The page only edits a description of the rule (plain text fields)
 * and shows what the API answers: interpretation, validation, test and activation all happen
 * on the server, which checks everything again when a rule is activated.
 *
 * The rule language itself (names of attributes, AND, MAX...) is the same in every language
 * of the interface; what the API says about a rule comes with a code and is worded here.
 */

const COMPARISONS = ['>=', '<=', '>', '<', '==', '!='];
const SEVERITY = { ERROR: ['bad', '✕'], WARNING: ['warn', '!'], INFO: ['info', 'i'] };
const TYPE_WORDS = ['number', 'text', 'boolean'];

/** Items by the value of a key, in order of first appearance. */
function groupBy(items, key) {
  const groups = {};
  for (const item of items) (groups[key(item)] ||= []).push(item);
  return groups;
}

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

/** The operators a value of a given type can be compared with. */
const operatorsFor = (type) => (type === 'boolean' ? ['true', 'false'] : type === 'text' ? ['==', '!='] : COMPARISONS);

/** Makes a row consistent with the type of the value it starts with. */
function normalise(row, types) {
  const type = types.get(row.left);
  const allowed = operatorsFor(type);
  if (!allowed.includes(row.op)) row.op = allowed[0];
  if (type === 'boolean') {
    row.right = '';
    row.not = false;
  }
  return row;
}

/** One condition as a row of blocks, or null when it does not fit one. */
function parseRow(text, types) {
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
      const op = ['>=', '<=', '==', '!='].find((candidate) => body.startsWith(candidate, i)) || (c === '>' || c === '<' ? c : null);
      if (!op) continue;
      const left = body.slice(0, i).trim();
      const right = body.slice(i + op.length).trim();
      const type = types.get(left);
      if (!type) return null;
      if (type === 'boolean') {
        // pinned(t) == FALSE is the row "pinned is false"; anything else about a yes/no value stays as text.
        const literal = /^(TRUE|FALSE)$/i.exec(right);
        if (!literal || (op !== '==' && op !== '!=')) return null;
        const holds = (literal[1].toUpperCase() === 'TRUE') === (op === '==');
        return { not: false, left, op: holds !== not ? 'true' : 'false', right: '' };
      }
      if (!operatorsFor(type).includes(op)) return null;
      return { not, left, op, right };
    }
  }
  return types.get(body) === 'boolean' ? { not: false, left: body, op: not ? 'false' : 'true', right: '' } : null;
}

/** The blocks of a condition, or null when it is too elaborate for blocks and stays as text. */
function toBlocks(text, types, fallbackJoin) {
  if (!text.trim()) return { join: fallbackJoin, rows: [] };
  const any = splitTop(text, 'OR');
  const all = splitTop(text, 'AND');
  if (any.length > 1 && any.some((part) => splitTop(part, 'AND').length > 1)) return null;
  const join = any.length > 1 ? 'OR' : 'AND';
  const rows = (any.length > 1 ? any : all).map((part) => parseRow(part, types));
  return rows.every(Boolean) ? { join: rows.length > 1 ? join : fallbackJoin, rows } : null;
}

function rowText(row, types) {
  if (!row.left) return '';
  normalise(row, types);
  if (row.op === 'true') return row.left;
  if (row.op === 'false') return `NOT ${row.left}`;
  let right = row.right.trim();
  if (types.get(row.left) === 'text' && right && !/^["']/.test(right) && !types.has(right)) right = `"${right.replaceAll('"', '')}"`;
  const text = `${row.left} ${row.op} ${right}`;
  return row.not ? `NOT (${text})` : text;
}

const fromBlocks = (blocks, types) => blocks.rows.map((row) => rowText(row, types)).filter(Boolean).join(` ${blocks.join} `);

// ---- What the API says, in the language of the page -----------------------------------------------

const positional = (values) => Object.fromEntries(values.map((value) =>
  (TYPE_WORDS.includes(value) ? t(`type.${value}`) : value)).entries());

function findingText(item) {
  if (item.code !== 'not-well-formed') return tMessage('finding', item);
  // The values: the part of the rule, the code of the problem, then what that code mentions.
  const [part, code, ...values] = item.arguments || [];
  const detail = tApi(`syntax.${code}`, null, positional(values));
  if (detail === null) return item.message;
  return part ? `${part}: ${detail}` : detail;
}

/** How a part of a sentence was read. The level a modal verb gives ("hard", "soft") is worded too. */
function noteText(note) {
  if (!String(note.code).startsWith('modal')) return tMessage('note', note);
  const [phrase, level] = note.arguments || [];
  return tMessage('note', { ...note, arguments: [phrase, t(`level.${level}`).toLowerCase()] });
}

// ---- The dialog -----------------------------------------------------------------------------------

/**
 * @param ctx.useCase     id of the use case, for the wording of its vocabulary
 * @param ctx.url         (path) => address of an operation of that use case
 * @param ctx.vocabulary  what rules may refer to, from GET /rules/vocabulary
 * @param ctx.request     () => the plan on screen with the settings and constraints of the panel
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

  const describe = (key, fallback) => tApi(`vocab.${ctx.useCase}.${key}`, fallback);
  const entity = () => vocabulary.entities.find((candidate) => candidate.name === draft.entity);
  /** Everything that has a value for the entity of the rule: its attributes, those it links to, the parameters. */
  const values = () => {
    const self = entity();
    const isEntity = (type) => vocabulary.entities.some((candidate) => candidate.name === type);
    const list = [];
    for (const attribute of self.attributes) {
      if (!isEntity(attribute.type)) {
        list.push({ usage: attribute.usage, type: attribute.type, label: attribute.name,
          description: describe(`${self.name}.${attribute.name}`, attribute.description), group: self.name });
      }
    }
    for (const link of self.attributes) {
      const linked = vocabulary.entities.find((candidate) => candidate.name === link.type);
      for (const attribute of linked?.attributes ?? []) {
        if (!isEntity(attribute.type)) {
          list.push({ usage: `${attribute.name}(${link.usage})`, type: attribute.type, label: `${link.name} · ${attribute.name}`,
            description: describe(`${linked.name}.${attribute.name}`, attribute.description),
            group: t('rules.blocks.linked', { linked: linked.name, entity: self.name }) });
        }
      }
    }
    for (const parameter of vocabulary.parameters) {
      list.push({ usage: parameter.name, type: parameter.type, label: parameter.name,
        description: describe(`param.${parameter.name}`, parameter.description), group: t('rules.blocks.plan') });
    }
    return list;
  };
  const types = () => new Map(values().map((value) => [value.usage, value.type]));
  const rule = () => ({ ...draft, weight: Math.max(1, Math.round(Number(draft.weight)) || 1), penalty: ui.customPenalty ? draft.penalty : '' });
  const key = () => JSON.stringify(rule());
  const fresh = () => ui.check && ui.checkedKey === key();

  async function post(path, body) {
    let response;
    try {
      response = await fetch(ctx.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
    } catch (error) {
      throw new Error(t('rules.error.unreachable'));
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (error) { /* not JSON: reported with the status below */ }
    // 422 is an answer, not a failure: the rule was examined and not let through.
    if (!response.ok && response.status !== 422) {
      throw new Error(`${tApi(`error.${data?.code}`, t('error.http'))} ${data?.message || `${response.status} ${response.statusText}`}`);
    }
    return { status: response.status, data };
  }

  // ---- actions ----

  let timer = null;
  function changed({ redraw = false } = {}) {
    const known = types();
    for (const field of ['exclusion', 'expression']) {
      if (!ui.editors[field].text) draft[field] = fromBlocks(ui.editors[field].blocks, known);
    }
    ui.accept = false;
    ui.error = null;
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
      if (asked !== key()) return;
      ui.error = error.message;
    }
    drawPreview(); drawSteps();
  }

  async function interpret() {
    if (!ui.sentence.trim() || ui.busy) return;
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
    const known = types();
    for (const [field, join] of [['exclusion', 'OR'], ['expression', 'AND']]) {
      const blocks = toBlocks(draft[field], known, join);
      ui.editors[field] = blocks ? { text: false, blocks } : { text: true, blocks: { join, rows: [] } };
    }
  }

  async function test() {
    if (ui.busy) return;
    ui.busy = 'test'; ui.error = null; drawPreview();
    const asked = key();
    try {
      const { data } = await post('/rules/test', { ...ctx.request(), rule: rule(), solve: true });
      if (asked === key()) {
        ui.check = data; ui.checkedKey = asked; ui.testedKey = data.status === 'ERRORS' ? null : asked;
      }
    } catch (error) {
      ui.error = error.message;
    }
    ui.busy = null;
    drawPreview(); drawSteps();
  }

  async function activate() {
    if (ui.busy) return;
    ui.busy = 'activate'; ui.error = null; drawPreview();
    try {
      const { status, data } = await post('/rules', { ...ctx.request(), rule: rule(), acceptWarnings: ui.accept });
      if (status === 422) {
        ui.check = data; ui.checkedKey = key();
        ui.error = t(data.status === 'ERRORS' ? 'rules.refused.errors' : 'rules.refused.warnings');
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
    const known = types();
    if (!editor.text && known.has(usage)) {
      editor.blocks.rows.push(normalise({ not: false, left: usage, op: '>=', right: '' }, known));
      changed({ redraw: true });
    }
  }

  // ---- drawing ----

  const steps = h('ol', { class: 'steps' });
  const sentence = h('section', { class: 'sheet-section' });
  const form = h('section', { class: 'sheet-section' });
  const preview = h('section', { class: 'sheet-section' });
  const palette = h('aside', { class: 'blocks', 'aria-label': t('rules.blocks') });

  function drawSteps() {
    const defined = Boolean(draft.expression.trim() && draft.name.trim());
    const valid = defined && fresh() && ui.check.status !== 'ERRORS';
    const tested = valid && ui.testedKey === key();
    const done = [defined, defined, valid, tested, false];
    const current = done.indexOf(false);
    fill(steps, [1, 2, 3, 4, 5].map((step, i) =>
      h('li', { class: done[i] ? 'done' : i === current ? 'current' : '' }, h('i', {}, done[i] ? '✓' : String(step)), t(`rules.step.${step}`))));
  }

  function drawSentence() {
    const area = h('textarea', { rows: 3, placeholder: t('rules.describe.placeholder', { example: vocabulary.examples[0] || '' }),
      'aria-label': t('rules.describe.label'),
      oninput: (e) => { ui.sentence = e.target.value; }, onfocus: (e) => { ui.target = e.target; } }, ui.sentence);
    const result = ui.interpretation;
    const english = t('rules.describe.english');
    fill(sentence,
      h('h3', {}, t('rules.describe')),
      h('p', { class: 'muted' }, t('rules.describe.help'), english ? ` ${english}` : null),
      area,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', type: 'button', disabled: ui.busy === 'interpret', onclick: interpret },
          t(ui.busy === 'interpret' ? 'rules.interpreting' : 'rules.interpret')),
        h('span', { class: 'muted' }, t('rules.try')),
        vocabulary.examples.map((example) => h('button', { class: 'example', type: 'button',
          onclick: () => { ui.sentence = example; drawSentence(); } }, example))),
      result && !result.understood ? h('div', { class: 'finding bad' }, h('i', {}, '✕'),
        h('div', {}, h('b', {}, `${t('rules.notUnderstood')} `), result.problems.map((problem) => tMessage('problem', problem)).join(' '))) : null,
      result && result.understood ? h('details', { class: 'notes', open: result.problems.length > 0 },
        h('summary', {}, t('rules.understood', { count: result.notes.length })),
        h('ul', {}, result.notes.map((note) => h('li', {}, noteText(note)))),
        result.problems.map((problem) => h('div', { class: 'finding warn' }, h('i', {}, '!'), h('div', {}, tMessage('problem', problem))))) : null);
  }

  function condition(field, title, help) {
    const editor = ui.editors[field];
    const known = values();
    const knownTypes = types();
    const body = h('div', { class: 'condition' });
    if (editor.text) {
      body.append(h('input', { type: 'text', class: 'mono', value: draft[field], spellcheck: 'false', dataset: { focus: `${field}-text` },
        placeholder: field === 'exclusion' ? t('rules.exclusion.none') : t('rules.expression.example', { example: `${known[0]?.usage} >= 1` }),
        'aria-label': title, oninput: (e) => { draft[field] = e.target.value; changed(); },
        onfocus: (e) => { ui.target = e.target; } }));
    } else {
      editor.blocks.rows.forEach((row, index) => {
        normalise(row, knownTypes);
        const type = knownTypes.get(row.left);
        const flag = type === 'boolean';
        body.append(h('div', { class: 'block-row' },
          index > 0 ? h('span', { class: `joiner ${editor.blocks.join.toLowerCase()}` }, editor.blocks.join) : null,
          h('select', { 'aria-label': t('rules.row.value'), dataset: { focus: `${field}-${index}-left` },
            onchange: (e) => { row.left = e.target.value; changed({ redraw: true }); } },
            Object.entries(groupBy(known, (value) => value.group)).map(([group, items]) => h('optgroup', { label: group },
              items.map((value) => h('option', { value: value.usage, selected: value.usage === row.left }, value.label))))),
          h('select', { 'aria-label': t('rules.row.comparison'), dataset: { focus: `${field}-${index}-op` },
            onchange: (e) => { row.op = e.target.value; changed(); } },
            operatorsFor(type).map((op) => h('option', { value: op, selected: op === row.op }, t(`rules.op.${op}`)))),
          flag ? null : h('input', { type: 'text', class: 'mono', value: row.right, spellcheck: 'false', dataset: { focus: `${field}-${index}-right` },
            placeholder: t(type === 'text' ? 'rules.row.text' : 'rules.row.number'), 'aria-label': t('rules.row.right'),
            oninput: (e) => { row.right = e.target.value; changed(); }, onfocus: (e) => { ui.target = e.target; } }),
          flag ? null : h('button', { class: `toggle ${row.not ? 'on' : ''}`, type: 'button', title: t('rules.row.negate'),
            dataset: { focus: `${field}-${index}-not` },
            'aria-pressed': String(row.not), onclick: () => { row.not = !row.not; changed({ redraw: true }); } }, 'NOT'),
          h('button', { class: 'icon-x', type: 'button', title: t('rules.row.remove'), 'aria-label': t('rules.row.remove'),
            onclick: () => { editor.blocks.rows.splice(index, 1); changed({ redraw: true }); } }, '×')));
      });
      body.append(h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', type: 'button', dataset: { focus: `${field}-add` }, onclick: () => {
          editor.blocks.rows.push(normalise({ not: false, left: known[0].usage, op: '>=', right: '' }, knownTypes));
          changed({ redraw: true });
        } }, t('rules.row.add')),
        editor.blocks.rows.length > 1 ? h('div', { class: 'segmented', role: 'group', 'aria-label': t('rules.join') },
          ['AND', 'OR'].map((join) => h('button', { type: 'button', dataset: { focus: `${field}-join-${join}` },
            'aria-pressed': String(editor.blocks.join === join),
            onclick: () => { editor.blocks.join = join; changed({ redraw: true }); } }, t(`rules.join.${join}`)))) : null));
    }
    return h('div', { class: 'form-block' },
      h('div', { class: 'form-head' }, h('label', {}, title), h('span', { class: 'muted' }, help),
        h('button', { class: 'link', type: 'button', dataset: { focus: `${field}-mode` }, onclick: () => {
          if (editor.text) {
            const blocks = toBlocks(draft[field], knownTypes, editor.blocks.join);
            if (!blocks) { ui.error = t('rules.tooElaborate'); drawPreview(); return; }
            ui.editors[field] = { text: false, blocks };
          } else {
            editor.text = true;
          }
          drawForm();
        } }, t(editor.text ? 'rules.useBlocks' : 'rules.editText'))),
      body);
  }

  function drawForm() {
    const self = entity();
    keepFocus(form, () => fill(form,
      h('h3', {}, t('rules.build')),
      h('div', { class: 'form-grid' },
        h('label', { for: 'rule-name' }, t('rules.name')),
        h('input', { id: 'rule-name', type: 'text', value: draft.name, maxlength: 80, placeholder: t('rules.name.placeholder'),
          dataset: { focus: 'name' },
          oninput: (e) => { draft.name = e.target.value; changed(); }, onfocus: () => { ui.target = null; } }),
        h('label', { for: 'rule-entity' }, t('rules.entity')),
        h('select', { id: 'rule-entity', dataset: { focus: 'entity' }, onchange: (e) => {
          draft.entity = e.target.value;
          ui.editors.exclusion = { text: false, blocks: { join: 'OR', rows: [] } };
          ui.editors.expression = { text: false, blocks: { join: 'AND', rows: [] } };
          draft.penalty = '';
          ui.customPenalty = false;
          changed({ redraw: true }); drawPalette();
        } }, vocabulary.entities.map((candidate) => h('option', { value: candidate.name, selected: candidate.name === draft.entity },
          `${candidate.name} - ${describe(candidate.name, candidate.description)}`))),
        h('label', {}, t('rules.nature')),
        h('div', { class: 'row' },
          h('div', { class: 'segmented', role: 'group', 'aria-label': t('rules.nature') },
            vocabulary.levels.map((level) => h('button', { type: 'button', dataset: { level, focus: `level-${level}` },
              'aria-pressed': String(draft.level === level),
              onclick: () => { draft.level = level; changed({ redraw: true }); } }, t(`level.${level}`)))),
          h('label', { for: 'rule-weight', class: 'muted' }, t('constraints.weight')),
          h('input', { id: 'rule-weight', type: 'number', min: 1, step: 1, value: draft.weight, style: { width: '84px' },
            dataset: { focus: 'weight' }, oninput: (e) => { draft.weight = e.target.value; changed(); } }),
          h('span', { class: 'muted' }, t(draft.level === 'hard' ? 'rules.nature.rule' : 'rules.nature.objective')))),
      condition('expression', t('rules.expression'), t('rules.expression.help', { entity: self.name, alias: self.alias })),
      condition('exclusion', t('rules.exclusion'), t('rules.exclusion.help')),
      h('div', { class: 'form-block' },
        h('div', { class: 'form-head' }, h('label', {}, t('rules.penalty')), h('span', { class: 'muted' }, t('rules.penalty.help'))),
        h('div', { class: 'row' },
          h('div', { class: 'segmented', role: 'group', 'aria-label': t('rules.penalty') },
            [[false, 'rules.penalty.distance'], [true, 'rules.penalty.own']].map(([custom, label]) => h('button', { type: 'button',
              dataset: { focus: `penalty-${custom}` },
              'aria-pressed': String(ui.customPenalty === custom), onclick: () => {
                ui.customPenalty = custom;
                if (custom && !draft.penalty) draft.penalty = ui.check?.suggestedPenalty || '';
                changed({ redraw: true });
              } }, t(label))))),
        ui.customPenalty ? h('input', { type: 'text', class: 'mono', value: draft.penalty, spellcheck: 'false',
          dataset: { focus: 'penalty' },
          'aria-label': t('rules.penalty.formula'), placeholder: t('rules.penalty.placeholder'),
          oninput: (e) => { draft.penalty = e.target.value; changed(); }, onfocus: (e) => { ui.target = e.target; } }) : null)));
  }

  function finding(item) {
    const [tone, mark] = SEVERITY[item.severity] || SEVERITY.INFO;
    const example = Object.entries(item.example || {});
    return h('div', { class: `finding ${tone}` }, h('i', {}, mark), h('div', {}, findingText(item),
      example.length ? h('div', { class: 'values' }, h('span', { class: 'muted' }, t('rules.forExample')),
        example.map(([name, value]) => h('code', {}, `${name} = ${value}`))) : null));
  }

  /** What will be checked, in a sentence, from the rule as the server spells it. */
  function explanation(checked) {
    const weight = `${number(checked.weight)} ${t(`level.${checked.level}`).toLowerCase()}`;
    const params = { entity: checked.entity, alias: entity().alias, exclusion: checked.exclusion, expression: checked.expression,
      penalty: checked.penalty, weight };
    return t(checked.exclusion ? 'rules.explain.except' : 'rules.explain', params);
  }

  function drawPreview() {
    const check = fresh() ? ui.check : null;
    const stale = ui.check && !check;
    const local = `ENTITY: ${draft.entity}\nEXCLUSION: ${draft.exclusion || 'none'}\nEXPRESSION: ${draft.expression || '…'}\n`
      + `PENALTY: ${ui.customPenalty ? draft.penalty || '…' : '…'}`;
    const tested = check && ui.testedKey === key();
    const onPlan = tested ? check.plan : null;
    const trial = tested ? check.trial : null;
    const canActivate = tested && check.status !== 'ERRORS' && (check.status === 'OK' || ui.accept) && !ui.busy;

    keepFocus(preview, () => fill(preview,
      h('h3', {}, t('rules.preview')),
      h('pre', { class: 'structured' }, check?.text || local),
      check?.rule ? h('p', { class: 'explain' }, explanation(check.rule)) : null,
      !draft.expression.trim() ? h('p', { class: 'muted' }, t('rules.preview.empty'))
        : stale || !ui.check ? h('p', { class: 'muted' }, t('rules.checking'))
        : h('div', { class: `verdict ${check.status.toLowerCase()}` },
          check.status === 'OK' ? t('rules.verdict.ok', { cases: number(check.cases) })
            : t(check.status === 'WARNINGS' ? 'rules.verdict.warnings' : 'rules.verdict.errors')),
      check ? check.findings.map(finding) : null,
      ui.error ? h('div', { class: 'finding bad' }, h('i', {}, '✕'), h('div', {}, ui.error)) : null,

      onPlan ? h('div', { class: 'result' },
        h('h4', {}, t('rules.onPlan')),
        h('div', { class: 'stats' },
          stat(onPlan.violated, t('rules.onPlan.broken'), onPlan.violated ? 'bad' : ''), stat(onPlan.satisfied, t('rules.onPlan.satisfied'), 'ok'),
          stat(onPlan.excluded, t('rules.onPlan.exempt')), stat(onPlan.notApplicable, t('rules.onPlan.notConcerned'))),
        h('p', { class: 'muted' }, t('rules.onPlan.score', { without: onPlan.scoreWithout.text, with: onPlan.scoreWith.text })),
        onPlan.violations.length ? h('table', { class: 'violations' },
          h('thead', {}, h('tr', {}, h('th', {}, draft.entity), h('th', {}, t('rules.penalty')), h('th', {}, t('rules.values')))),
          h('tbody', {}, onPlan.violations.map((violation) => h('tr', {}, h('td', {}, violation.entity), h('td', {}, String(violation.penalty)),
            h('td', {}, Object.entries(violation.values).map(([name, value]) => h('code', {}, `${name} = ${value}`))))))) : null) : null,
      trial ? h('div', { class: 'result' },
        h('h4', {}, t('rules.trial', { seconds: number(trial.seconds, 1) })),
        h('div', { class: 'compare' },
          h('div', {}, h('small', {}, t('rules.trial.without')), h('b', {}, trial.without.text)),
          h('div', { class: trial.with.feasible ? '' : 'bad' }, h('small', {}, t('rules.trial.with')), h('b', {}, trial.with.text)),
          h('div', { class: trial.violations ? 'warn' : 'ok' }, h('small', {}, t('rules.trial.still')), h('b', {}, String(trial.violations))))) : null,

      h('div', { class: 'sheet-actions' },
        check?.status === 'WARNINGS' && tested ? h('label', { class: 'accept' },
          h('input', { type: 'checkbox', checked: ui.accept, dataset: { focus: 'accept' },
            onchange: (e) => { ui.accept = e.target.checked; drawPreview(); } }),
          t('rules.accept')) : h('span', {}),
        h('button', { class: 'btn ghost', type: 'button', dataset: { focus: 'test' },
          disabled: !check || check.status === 'ERRORS' || Boolean(ui.busy), onclick: test },
        t(ui.busy === 'test' ? 'rules.testing' : tested ? 'rules.testAgain' : 'rules.test')),
        h('button', { class: 'btn primary', type: 'button', dataset: { focus: 'activate' }, disabled: !canActivate, onclick: activate,
          title: tested ? '' : t('rules.activate.first') }, t(ui.busy === 'activate' ? 'rules.activating' : 'rules.activate')))));
  }

  const stat = (count, label, tone = '') => h('div', { class: `stat ${tone}` }, h('b', {}, String(count)), h('small', {}, label));

  function drawPalette(filter = '') {
    const self = entity();
    const match = (...texts) => texts.join(' ').toLowerCase().includes(filter.toLowerCase());
    const block = (usage, type, description) => h('button', { class: 'bblock', type: 'button', draggable: 'true',
      title: t('rules.blocks.use'),
      onmousedown: (e) => e.preventDefault(),        // keep the cursor where it is in the field being edited
      ondragstart: (e) => e.dataTransfer.setData('text/plain', usage),
      onclick: () => insert(usage) },
      h('span', { class: 'bblock-head' }, h('code', {}, usage), type ? h('span', { class: 'type' }, tApi(`type.${type}`, type)) : null),
      h('span', { class: 'bblock-text' }, description));
    const section = (title, blocks) => (blocks.length ? [h('h4', {}, `${title} (${blocks.length})`), blocks] : []);
    const known = values().filter((value) => match(value.usage, value.description));
    const operators = [['AND', t('op.AND')], ['OR', t('op.OR')], ['NOT', t('op.NOT')],
      ...vocabulary.comparisons.map((comparison) => [comparison, t(`rules.op.${comparison}`)])].filter(([name, text]) => match(name, text));
    const functions = vocabulary.functions.filter((fn) => match(fn.name, tApi(`fn.${fn.name}`, fn.description)));
    fill(palette,
      h('h3', {}, t('rules.blocks')),
      h('input', { type: 'text', placeholder: t('rules.blocks.search'), value: filter, 'aria-label': t('rules.blocks.search'),
        oninput: (e) => { const at = e.target.selectionStart; drawPalette(e.target.value);
          const input = palette.querySelector('input'); input.focus(); input.setSelectionRange(at, at); } }),
      h('p', { class: 'muted' }, t('rules.blocks.help', { entity: self.name })),
      h('div', { class: 'blocks-list' },
        Object.entries(groupBy(known, (value) => value.group)).map(([group, items]) =>
          section(group, items.map((value) => block(value.usage, value.type, value.description)))),
        section(t('rules.blocks.operators'), operators.map(([name, text]) => block(name, null, text))),
        section(t('rules.blocks.functions'), functions.map((fn) => block(fn.usage, null, tApi(`fn.${fn.name}`, fn.description))))));
  }

  dialog.setAttribute('aria-label', t('rules.title'));
  fill(dialog,
    h('header', { class: 'sheet-head' },
      h('div', {}, h('h2', {}, t('rules.title')), h('p', { class: 'muted' }, t(`usecase.${ctx.useCase}.title`))),
      steps,
      h('button', { class: 'icon-x large', type: 'button', 'aria-label': t('action.close'), title: t('action.close'), onclick: () => dialog.close() }, '×')),
    h('div', { class: 'sheet-body' }, h('div', { class: 'sheet-main' }, sentence, form, preview), palette));
  drawSteps(); drawSentence(); drawForm(); drawPreview(); drawPalette();
  dialog.showModal();
}
