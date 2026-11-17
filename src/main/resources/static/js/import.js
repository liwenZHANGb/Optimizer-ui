import { h, fill } from './util.js';
import { t, tApi } from './i18n.js';

/**
 * The import dialog: says which tables and columns the use case reads, offers an example
 * file to start from, and sends the chosen files to the API, which reads them and answers
 * with a plan or with what is wrong, down to the table, the row and the column.
 *
 * @param ctx.useCase    id of the use case
 * @param ctx.url        (path) => address of an operation of that use case
 * @param ctx.onImported called with the plan and the names of the files once they are read
 */
export async function openImport(dialog, ctx) {
  const ui = { format: null, options: [], values: {}, files: [], busy: false, error: null };
  const body = h('div', { class: 'sheet-main import' });

  const describe = (key, fallback) => tApi(`import.${ctx.useCase}.${key}`, fallback);

  async function send() {
    if (ui.busy || ui.files.length === 0) return;
    ui.busy = true; ui.error = null; draw();
    try {
      const form = new FormData();
      ui.files.forEach((file) => form.append('files', file, file.name));
      ui.options.forEach((field) => form.append(field.key, String(ui.values[field.key] ?? '').trim()));
      let response;
      try {
        response = await fetch(ctx.url('/import'), { method: 'POST', body: form });
      } catch (error) {
        throw new Error(t('rules.error.unreachable'));
      }
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (error) { /* reported with the status below */ }
      if (!response.ok) throw new Error(`${tApi(`error.${data?.code}`, t('error.http'))} ${data?.message || `${response.status} ${response.statusText}`}`);
      dialog.close();
      ctx.onImported(data, ui.files.map((file) => file.name));
      return;
    } catch (error) {
      ui.error = error.message;
    }
    ui.busy = false;
    draw();
  }

  function choose(list) {
    const files = [...list].filter((file) => /\.(xlsx|csv|txt)$/i.test(file.name));
    ui.error = files.length < list.length ? t('import.wrongType') : null;
    // One workbook replaces everything; CSV files add up, one per table.
    const workbook = files.find((file) => /\.xlsx$/i.test(file.name));
    ui.files = workbook ? [workbook] : [...ui.files.filter((file) => !/\.xlsx$/i.test(file.name)
      && !files.some((other) => other.name === file.name)), ...files];
    draw();
  }

  function draw() {
    const picker = h('input', { type: 'file', multiple: true, accept: '.xlsx,.csv', hidden: true,
      onchange: (e) => { choose(e.target.files); e.target.value = ''; } });
    const drop = h('div', { class: 'dropzone', role: 'button', tabindex: '0',
      onclick: () => picker.click(),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } },
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); choose(e.dataTransfer.files); } },
    h('strong', {}, t('import.drop')), h('span', { class: 'muted' }, t('import.drop.help')));

    fill(body,
      h('section', { class: 'sheet-section' },
        h('h3', {}, t('import.files')),
        h('p', { class: 'muted' }, tApi(`import.${ctx.useCase}.help`, t('import.help'))),
        drop, picker,
        ui.files.length ? h('ul', { class: 'file-list' }, ui.files.map((file) => h('li', {},
          h('span', {}, file.name), h('span', { class: 'muted' }, ` · ${file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}`),
          h('button', { class: 'icon-x', type: 'button', title: t('import.remove'), 'aria-label': t('import.remove'),
            onclick: () => { ui.files = ui.files.filter((other) => other !== file); draw(); } }, '×')))) : null,
        ui.options.length ? h('div', { class: 'import-options' },
          h('h3', {}, t('import.options')),
          ui.options.map((field) => h('div', { class: 'field' },
            h('label', { for: `io-${field.key}` }, tApi(`import.option.${field.key}`, field.label)),
            h('div', { class: 'control' },
              h('input', { id: `io-${field.key}`, type: field.type === 'number' ? 'number' : 'text', value: ui.values[field.key] ?? '',
                min: field.min ?? null, max: field.max ?? null, step: field.step ?? null,
                oninput: (e) => { ui.values[field.key] = e.target.value; } }),
              field.unit ? h('span', { class: 'unit' }, tApi(`unit.${field.unit}`, field.unit)) : null),
            h('div', { class: 'help' }, tApi(`import.option.${field.key}.help`, field.help))))) : null,
        ui.error ? h('div', { class: 'finding bad' }, h('i', {}, '✕'), h('div', {}, ui.error)) : null,
        h('div', { class: 'sheet-actions' }, h('span', {}),
          h('button', { class: 'btn primary', type: 'button', disabled: ui.busy || ui.files.length === 0, onclick: send },
            t(ui.busy ? 'import.sending' : 'import.send')))),
      h('section', { class: 'sheet-section' },
        h('h3', {}, t('import.format')),
        h('p', { class: 'muted' }, t('import.format.help')),
        h('div', { class: 'row' },
          h('a', { class: 'btn ghost small', href: ctx.url('/import/example.xlsx'), download: '' }, t('import.example.xlsx')),
          h('span', { class: 'muted' }, t('import.example.csv')),
          (ui.format || []).map((table) => h('a', { class: 'example', download: '',
            href: `${ctx.url('/import/example.csv')}?table=${encodeURIComponent(table.name)}` }, `${table.name}.csv`))),
        !ui.format ? h('p', { class: 'muted' }, t('status.loading')) : ui.format.map((table) => h('div', { class: 'import-table' },
          h('div', { class: 'form-head' }, h('label', {}, table.name),
            h('span', { class: `badge ${table.required ? '' : 'custom'}` }, t(table.required ? 'import.required' : 'import.optional')),
            h('span', { class: 'muted' }, describe(table.name, table.description))),
          h('table', { class: 'violations' },
            h('thead', {}, h('tr', {}, h('th', {}, t('import.column')), h('th', {}, t('import.type')), h('th', {}, t('import.meaning')))),
            h('tbody', {}, table.columns.map((column) => h('tr', {},
              h('td', {}, h('code', {}, column.name), column.required ? null : h('span', { class: 'muted' }, ` ${t('import.optional').toLowerCase()}`)),
              h('td', {}, tApi(`import.type.${column.type}`, column.type)),
              h('td', {}, describe(`${table.name}.${column.name}`, column.description))))))))));
  }

  dialog.setAttribute('aria-label', t('import.title'));
  fill(dialog,
    h('header', { class: 'sheet-head' },
      h('div', {}, h('h2', {}, t('import.title')), h('p', { class: 'muted' }, t(`usecase.${ctx.useCase}.title`))),
      h('span', { style: { flex: '1' } }),
      h('button', { class: 'icon-x large', type: 'button', 'aria-label': t('action.close'), title: t('action.close'), onclick: () => dialog.close() }, '×')),
    h('div', { class: 'sheet-body single' }, body));
  draw();
  dialog.showModal();
  try {
    const response = await fetch(ctx.url('/import/format'));
    if (!response.ok) throw new Error(`${response.status}`);
    ui.format = await response.json();
    // What can be chosen beyond the files; an API that does not know the question has no option.
    const options = await fetch(ctx.url('/import/options'));
    if (options.ok) {
      const answer = await options.json();
      ui.options = answer.fields || [];
      ui.values = { ...(answer.defaults || {}) };
    }
  } catch (error) {
    ui.format = [];
    ui.error = t('rules.error.unreachable');
  }
  draw();
}
