import { h } from './util.js';
import { renderSettings, renderConstraints } from './settings.js';
import { openRuleBuilder } from './rules.js';
import { renderScore, renderAnalysis, drawChart } from './score.js';
import * as tasks from './views/tasks.js';
import * as stock from './views/stock.js';
import * as vrp from './views/vrp.js';
import * as carpool from './views/carpool.js';

// The controller: one use case at a time, a plan on screen, a job streaming improvements.
// Every improvement is kept as a frame, so the search can be watched live and replayed.

const USE_CASES = [
  { id: 'task-assignment', label: 'Tasks', title: 'Task assignment', view: tasks, editable: true,
    summary: 'Give every task to an employee who has the skill, within their hours, at the lowest cost and with an even workload.',
    icon: 'M4 6h10M4 12h7M4 18h12M18 5v4m-2-2h4M17 15l2 2 3-4' },
  { id: 'vrp', label: 'Routing', title: 'Vehicle routing', view: vrp, editable: true,
    summary: 'Route a fleet from one depot: every customer served if capacity allows, no vehicle overloaded, as little driving as possible.',
    icon: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z' },
  { id: 'stock', label: 'Stock', title: 'Stock management', view: stock, editable: false,
    summary: 'Decide what to order in each period so that demand is always served and the warehouse never overflows, at the lowest cost.',
    icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { id: 'carpooling', label: 'Carpool', title: 'Carpooling', view: carpool, editable: false,
    summary: 'Decide which driver picks up which riders, and in which order, so that everybody reaches the campus on time.',
    icon: 'M5 16l1.5-5.5A2 2 0 018.4 9h7.2a2 2 0 011.9 1.5L19 16M4 16h16v3H4zM7.5 19v1.5m9-1.5v1.5M9 5.5a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0' },
];

const $ = (id) => document.getElementById(id);
const state = {
  useCase: null, config: null, settings: {}, constraints: [], vocabulary: null, rules: [],
  frames: [], shown: -1, view: null, job: null, stream: null,
  running: false, playing: true, timer: null,
};

// ---- API -------------------------------------------------------------------------------------
// Everything goes through the REST API of lw-optimizer: this page holds no optimization logic.
// Its address comes from /config.js, written by the server from its lw.api-url setting.

const API = (window.LW_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

async function call(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`The optimizer API at ${API} cannot be reached. Start it from the lw-optimizer repository `
      + 'with "./mvnw -pl optimizer-api spring-boot:run", or set its address with lw.api-url.');
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || `${response.status} ${response.statusText}`);
  return data;
}

const api = (path) => `${API}/api/${state.useCase.id}${path}`;

/** What is sent to solve or to score: the settings and constraints of the panel, and the plan on screen. */
const request = (plan) => ({
  settings: state.settings,
  constraints: state.constraints.map(({ key, enabled, level, weight }) => ({ key, enabled, level, weight })),
  plan,
});

// ---- Use case selection ----------------------------------------------------------------------

function renderNav() {
  $('nav').replaceChildren(...USE_CASES.map((useCase) => h('button', {
    class: 'rail-item', type: 'button', 'aria-current': useCase === state.useCase ? 'page' : null,
    title: useCase.title, onclick: () => select(useCase),
  }, icon(useCase.icon), h('span', {}, useCase.label))));
}

function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.7');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

async function select(useCase) {
  if (state.running) await stop();
  closeStream();
  state.useCase = useCase;
  history.replaceState(null, '', `#${useCase.id}`);
  renderNav();
  $('title').textContent = useCase.title;
  $('summary').textContent = useCase.summary;
  fail(null);
  $('stage').replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    const [config, plan, vocabulary, rules] = await Promise.all([call('GET', api('/configuration')),
      call('GET', api('/problem')), call('GET', api('/rules/vocabulary')), call('GET', api('/rules'))]);
    state.config = config;
    state.vocabulary = vocabulary;
    state.rules = rules;
    state.settings = { ...config.defaults };
    state.constraints = JSON.parse(JSON.stringify(config.constraints));
    renderSettings($('tab-settings'), config, state.settings, () => {});
    drawConstraints();
    $('stage').replaceChildren();
    state.view = useCase.view.mount($('stage'), {
      editable: () => useCase.editable && !state.running,
      onEdit: edited,
      geocode: (address) => call('GET', `${api('/geocode')}?address=${encodeURIComponent(address)}`),
      fail,
    });
    $('feed').replaceChildren(h('li', { class: 'empty' }, 'Nothing yet: press Solve.'));
    await present(plan, 'Problem loaded');
  } catch (error) {
    fail(error.message);
  }
}

// ---- Constraints and user-defined rules ------------------------------------------------------

function drawConstraints() {
  renderConstraints($('tab-constraints'), state.constraints, state.config.constraints, rescore, {
    rules: state.rules,
    onNew: () => openRuleBuilder($('rule-dialog'), {
      title: state.useCase.title,
      vocabulary: state.vocabulary,
      url: api,
      request: () => request(state.frames[state.shown]?.plan),
      onActivated: (rule) => reloadConstraints(`The rule "${rule.rule.name}" is active: it now takes part in every optimization.`),
    }),
    onRemove: async (constraint) => {
      if (!window.confirm(`Remove the rule "${constraint.name}"? It will no longer be applied.`)) return;
      try {
        await call('DELETE', api(`/rules/${constraint.key}`));
        await reloadConstraints(`The rule "${constraint.name}" was removed.`);
      } catch (error) {
        fail(error.message);
      }
    },
  });
}

/** The set of constraints changed on the server: reload it, keeping what was tuned in the panel. */
async function reloadConstraints(message) {
  try {
    const [config, rules] = await Promise.all([call('GET', api('/configuration')), call('GET', api('/rules'))]);
    const tuned = new Map(state.constraints.map((constraint) => [constraint.key, constraint]));
    state.config = config;
    state.rules = rules;
    state.constraints = JSON.parse(JSON.stringify(config.constraints)).map((constraint) => {
      const mine = tuned.get(constraint.key);
      return mine ? { ...constraint, enabled: mine.enabled, level: mine.level, weight: mine.weight } : constraint;
    });
    drawConstraints();
    openTab('constraints');
    await rescore();
    if (message) notice(message);
  } catch (error) {
    fail(error.message);
  }
}

// ---- Showing a plan that is not part of a run: the problem, or a plan edited by hand ---------

async function present(plan, label) {
  const snapshot = await call('POST', api('/analysis'), request(plan));
  state.frames = [snapshot];
  state.shown = -1;
  state.job = null;
  show(0, { animate: true });
  $('status').textContent = label;
}

/** The user moved or pinned something: score the edited plan and make it the plan on screen. */
async function edited(plan) {
  if (state.running) return;
  try {
    fail(null);
    const previous = state.frames[state.shown]?.plan;
    await present(plan, 'Edited by hand · solve to optimize from here');
    note(state.useCase.view.diff(previous, state.frames[0].plan), 'by hand');
  } catch (error) {
    fail(error.message);
  }
}

/** Constraints changed: the plan on screen is worth a different score. */
async function rescore() {
  if (state.running || state.shown < 0) return;
  try {
    fail(null);
    const snapshot = await call('POST', api('/analysis'), request(state.frames[state.shown].plan));
    renderScore($('score'), snapshot.score);
    renderAnalysis($('analysis'), snapshot.analysis);
  } catch (error) {
    fail(error.message);
  }
}

// ---- Solving ---------------------------------------------------------------------------------

async function solve() {
  if (state.running) return stop();
  const plan = state.frames[state.shown]?.plan;
  fail(null);
  try {
    const job = await call('POST', api('/jobs'), request(plan));
    state.job = job.id;
    state.frames = [];
    state.shown = -1;
    setRunning(true);
    openTab('analysis');
    $('feed').replaceChildren();
    $('status').textContent = 'Solving…';
    const stream = new EventSource(api(`/jobs/${job.id}/events`));
    state.stream = stream;
    stream.addEventListener('snapshot', (event) => {
      state.frames.push(JSON.parse(event.data));
      refreshPlayer();
    });
    stream.addEventListener('done', (event) => finish(JSON.parse(event.data)));
    stream.addEventListener('failed', (event) => {
      finish(null);
      fail(JSON.parse(event.data).error);
    });
    stream.onerror = () => { if (state.running) { finish(null); fail('The connection to the server was lost.'); } };
  } catch (error) {
    fail(error.message);
  }
}

async function stop() {
  if (!state.job) return;
  try {
    await call('DELETE', api(`/jobs/${state.job}`));
  } catch (error) {
    fail(error.message);
  }
}

function finish(job) {
  closeStream();
  setRunning(false);
  state.done = job ? `Done · ${job.engine} · ${job.terminationReason.toLowerCase().replaceAll('_', ' ')}` : 'Stopped';
  refreshPlayer();
  // Editing becomes possible again: redraw the plan on screen with its handles.
  if (state.shown >= 0) show(state.shown, { animate: false });
  if (job?.warnings?.length) notice(job.warnings.join(' '));
  // The job was recorded against the user-defined rules it applied: show their new figures.
  if (job && state.rules.length) {
    call('GET', api('/rules')).then((rules) => { state.rules = rules; drawConstraints(); }).catch(() => {});
  }
}

function closeStream() {
  if (state.stream) state.stream.close();
  state.stream = null;
}

function setRunning(running) {
  state.running = running;
  state.playing = true;
  const button = $('solve');
  button.textContent = running ? 'Stop' : 'Solve';
  button.classList.toggle('stop', running);
  $('reset').disabled = running;
}

// ---- Playback: every improvement is a frame --------------------------------------------------

function show(index, { animate = true } = {}) {
  const frame = state.frames[index];
  if (!frame) return;
  const previous = state.shown >= 0 && state.shown !== index ? state.frames[state.shown]?.plan : null;
  state.view.update(frame.plan, { animate });
  if (previous && animate && index > state.shown) note(state.useCase.view.diff(previous, frame.plan), `step ${frame.step}`);
  state.shown = index;
  renderScore($('score'), frame.score);
  renderAnalysis($('analysis'), frame.analysis);
  refreshPlayer();
}

/** Adds what changed to the feed, most recent first. */
function note(changes, when) {
  const feed = $('feed');
  feed.querySelector('.empty')?.remove();
  const shown = changes.slice(0, 4);
  for (const change of shown.reverse()) {
    feed.prepend(h('li', {}, h('b', {}, change.what), ` ${change.text}`, h('span', { class: 'muted' }, ` · ${when}`)));
  }
  if (changes.length > 4) feed.prepend(h('li', {}, `${changes.length - 4} more changes`, h('span', { class: 'muted' }, ` · ${when}`)));
  while (feed.children.length > 40) feed.lastChild.remove();
}

function refreshPlayer() {
  const count = state.frames.length;
  const scrub = $('scrub');
  scrub.max = Math.max(0, count - 1);
  scrub.value = Math.max(0, state.shown);
  scrub.disabled = count < 2;
  drawChart($('chart'), state.frames, state.shown);
  const frame = state.frames[state.shown];
  $('frame-label').textContent = !frame ? 'Waiting for the first plan…'
    : count < 2 ? frame.score.text
    : `Improvement ${state.shown} of ${count - 1} · step ${frame.step} · ${(frame.elapsedMs / 1000).toFixed(2)} s`;
  const behind = count - 1 - state.shown;
  if (state.running) $('status').textContent = behind > 0 ? `Solving… ${behind} improvement${behind === 1 ? '' : 's'} ahead of the display` : 'Solving…';
  else if (state.job) $('status').textContent = behind > 0 && state.playing ? `${state.done} · replaying` : state.done;
  $('play-icon').setAttribute('d', state.playing && behind > 0 ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M7 5v14l12-7z');
}

/** Advances the display towards the latest frame, skipping ahead when the search outruns it. */
function tick() {
  const behind = state.frames.length - 1 - state.shown;
  if (state.playing && behind > 0) {
    show(state.shown + Math.max(1, Math.ceil(behind / 45)));
  }
  state.timer = setTimeout(tick, Number($('speed').value));
}

// ---- Wiring ----------------------------------------------------------------------------------

function openTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    $(`tab-${tab.dataset.tab}`).hidden = !selected;
  });
}

function fail(message) {
  const banner = $('banner');
  banner.hidden = !message;
  banner.classList.remove('notice');
  banner.textContent = message || '';
}

/** Something to know that is not an error. */
function notice(message) {
  fail(message);
  $('banner').classList.add('notice');
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => openTab(tab.dataset.tab)));
$('solve').addEventListener('click', solve);
$('reset').addEventListener('click', () => select(state.useCase));
$('play').addEventListener('click', () => {
  // At the end of a finished run, play starts the replay over.
  if (!state.running && state.shown >= state.frames.length - 1 && state.frames.length > 1) {
    show(0, { animate: false });
    state.playing = true;
  } else {
    state.playing = !state.playing;
  }
  refreshPlayer();
});
$('scrub').addEventListener('input', (event) => {
  state.playing = false;
  show(Number(event.target.value), { animate: false });
});
window.addEventListener('resize', () => drawChart($('chart'), state.frames, state.shown));

$('api-docs').href = `${API}/swagger-ui.html`;
select(USE_CASES.find((useCase) => `#${useCase.id}` === location.hash) || USE_CASES[0]);
tick();
