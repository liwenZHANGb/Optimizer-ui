import { h, color, flip, fill } from '../util.js';
import { t } from '../i18n.js';

// Job shop scheduling: a Gantt chart. One row per machine (or per job), one bar per
// operation in the colour of its job, the due time of each job and the end of the last
// operation as vertical lines.

const key = (job, step) => `${job.name}#${step + 1}`;

export function mount(root) {
  let current = null;
  let mode = 'machine';

  function render(plan) {
    const scheduled = plan.makespan !== undefined && plan.makespan !== null;
    const jobColor = (job) => color(plan.jobs.indexOf(job));
    // What is shown before anything is scheduled: the steps of each job laid end to end.
    const bars = plan.jobs.flatMap((job) => {
      let clock = 0;
      return job.operations.map((operation, step) => {
        const start = scheduled ? operation.start : clock;
        clock = start + operation.duration;
        return { job, step, operation, start, end: start + operation.duration };
      });
    });
    const horizon = Math.max(1, ...bars.map((bar) => bar.end), ...plan.jobs.map((job) => job.dueTime || 0)) * 1.04;
    const at = (time) => `${(time / horizon) * 100}%`;
    const unit = horizon <= 60 ? 5 : horizon <= 150 ? 10 : horizon <= 400 ? 25 : Math.ceil(horizon / 12 / 50) * 50;
    const ticks = [];
    for (let time = 0; time <= horizon; time += unit) ticks.push(time);

    const byJob = mode === 'job' || !scheduled;
    const rows = byJob
      ? plan.jobs.map((job) => ({ label: job.name, tone: jobColor(job), job, bars: bars.filter((bar) => bar.job === job),
        meta: scheduled ? (job.tardiness > 0 ? t('jobshop.late', { n: job.tardiness }) : t('jobshop.ends', { time: job.completion }))
          : t('jobshop.steps', { count: job.operations.length }) }))
      : plan.machines.map((machine) => {
        const mine = bars.filter((bar) => bar.operation.machine === machine);
        const busy = mine.reduce((sum, bar) => sum + bar.operation.duration, 0);
        return { label: machine, tone: null, bars: mine,
          meta: t('jobshop.busy', { percent: plan.makespan ? Math.round((busy / plan.makespan) * 100) : 0 }) };
      });

    const row = (line) => h('div', { class: 'gantt-row' },
      h('div', { class: 'gantt-who', style: line.tone ? { '--c': line.tone } : {} },
        h('strong', {}, line.tone ? h('i', { class: 'dot' }) : null, line.label),
        h('small', { class: line.job?.tardiness > 0 ? 'bad' : '' }, line.meta)),
      h('div', { class: 'gantt-track' },
        ticks.map((time) => h('div', { class: 'tick', style: { left: at(time) } })),
        line.job?.dueTime ? h('div', { class: 'due', style: { left: at(line.job.dueTime) },
          title: t('jobshop.due', { job: line.job.name, time: line.job.dueTime }) }) : null,
        scheduled ? h('div', { class: 'makespan', style: { left: at(plan.makespan) } }) : null,
        line.bars.map((bar) => h('div', {
          class: `gantt-bar ${scheduled ? '' : 'pending'} ${scheduled && bar.job.tardiness > 0 && bar.step === bar.job.operations.length - 1 ? 'late' : ''}`,
          dataset: { key: key(bar.job, bar.step) },
          style: { '--c': jobColor(bar.job), left: at(bar.start), width: `calc(${at(bar.end - bar.start)} - 2px)` },
          title: t(scheduled ? 'jobshop.bar' : 'jobshop.bar.pending', { job: bar.job.name, step: bar.step + 1, machine: bar.operation.machine,
            start: bar.start, end: bar.end, duration: bar.operation.duration }),
        }, h('span', {}, byJob ? bar.operation.machine : bar.job.name)))));

    const late = plan.jobs.filter((job) => job.tardiness > 0).length;
    fill(root,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, t('jobshop.kpi.makespan')), h('b', {}, scheduled ? plan.makespan : '–')),
        h('div', { class: 'kpi' }, h('small', {}, t('jobshop.kpi.late')), h('b', {}, scheduled ? t('jobshop.kpi.late.value', { late, all: plan.jobs.length }) : '–')),
        h('div', { class: 'kpi' }, h('small', {}, t('jobshop.kpi.tardiness')), h('b', {}, scheduled ? plan.totalTardiness : '–'))),
      h('div', { class: 'hint' },
        h('div', { class: 'legend' }, plan.jobs.map((job) => h('span', { style: { '--c': jobColor(job) } }, h('i'), job.name))),
        scheduled ? h('div', { class: 'segmented', role: 'group', 'aria-label': t('jobshop.view') },
          ['machine', 'job'].map((choice) => h('button', { type: 'button', 'aria-pressed': String(mode === choice),
            onclick: () => { mode = choice; render(plan); } }, t(`jobshop.view.${choice}`)))) : null),
      h('p', { class: 'hint' }, t(scheduled ? 'jobshop.hint' : 'jobshop.hint.pending')),
      h('div', { class: 'card gantt' },
        rows.map(row),
        h('div', { class: 'gantt-row axis-row' }, h('div', { class: 'gantt-who' }),
          h('div', { class: 'gantt-track' }, ticks.map((time) => h('span', { class: 'tick-label', style: { left: at(time) } }, time))))));
  }

  return {
    update(plan, { animate = true } = {}) {
      const moved = new Set();
      if (current) {
        plan.jobs.forEach((job, j) => job.operations.forEach((operation, step) => {
          if (current.jobs[j]?.operations[step]?.start !== operation.start) moved.add(key(job, step));
        }));
      }
      flip(root, () => render(plan), new Set(), animate && current !== null && moved.size > 0);
      current = plan;
    },
  };
}

/** What changed between two plans, in words: the jobs that end at another time. */
export function diff(prev, next) {
  if (!prev) return [];
  const out = [];
  const before = new Map(prev.jobs.map((job) => [job.name, job.completion]));
  for (const job of next.jobs) {
    const was = before.get(job.name);
    if (was !== undefined && was !== null && job.completion !== null && job.completion !== undefined && was !== job.completion) {
      out.push({ what: job.name, text: t('jobshop.diff', { from: was, to: job.completion }) });
    }
  }
  return out;
}
