import { h, fill, debounce, number } from './util.js';
import { t, tApi, tMessage, translatePage, onLanguageChange, setLanguage, language, LANGUAGES } from './i18n.js';
import { renderSettings, renderConstraints } from './settings.js';
import { openRuleBuilder } from './rules.js';
import { renderScore, renderAnalysis, drawChart } from './score.js';
import * as tasks from './views/tasks.js';
import * as stock from './views/stock.js';
import * as vrp from './views/vrp.js';
import * as carpool from './views/carpool.js';

// The controller: one use case at a time, a plan on screen, a job streaming improvements.
// Every improvement is kept as a frame, so the search can be watched live and replayed.
//
// Nothing on screen is kept as text: status, banner and feed are kept as what they say, and
// worded when drawn, so that changing the language rewords the whole page in place.

const USE_CASES = [
  { id: 'task-assignment', view: tasks, editable: true,
    icon: 'M4 6h10M4 12h7M4 18h12M18 5v4m-2-2h4M17 15l2 2 3-4' },
  { id: 'vrp', view: vrp, editable: true,
    icon: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z' },
  { id: 'stock', view: stock, editable: false,
    icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { id: 'carpooling', view: carpool, editable: false,
    icon: 'M5 16l1.5-5.5A2 2 0 018.4 9h7.2a2 2 0 011.9 1.5L19 16M4 16h16v3H4zM7.5 19v1.5m9-1.5v1.5M9 5.5a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0' },
];
const SUN = 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7l1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2l-1.4-1.4M12 16a4 4 0 100-8 4 4 0 000 8z';
const MOON = 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z';

const $ = (id) => document.getElementById(id);
const state = {
  useCase: null, config: null, settings: {}, constraints: [], vocabulary: null, rules: [],
  frames: [], shown: -1, view: null, job: null, stream: null,
  running: false, starting: false, playing: true, finished: null,
  // Guards against answers that arrive late: a use case selection, and an analysis, are numbered.
  epoch: 0, analysis: 0,
  status: () => '', banner: null, feed: [],
};

// ---- API -------------------------------------------------------------------------------------
// Everything goes through the REST API of lw-optimizer: this page holds no optimization logic.
// Its address comes from /config.js, written by the server from its lw.api-url setting.

const API = (window.LW_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

/** A request that did not succeed: the kind of failure, and the API's own words when it gave some. */
class ApiError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.code = code;
    this.detail = detail;
  }
}

async function call(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError('unreachable');
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    if (response.ok) throw new ApiError('http', `${response.status} ${response.statusText}`);
  }
  if (!response.ok) throw new ApiError(data?.code || 'http', data?.message || `${response.status} ${response.statusText}`);
  return data;
}

/** An error in the language of the page. The API's detail is its own technical wording, kept as it is. */
function wording(error) {
  if (!(error instanceof ApiError)) return () => String(error?.message || error);
  if (error.code === 'unreachable') return () => t('error.unreachable', { url: API });
  return () => `${tApi(`error.${error.code}`, t('error.http'))} ${error.detail}`;
}

const base = () => `${API}/api/${state.useCase.id}`;
const api = (path) => `${base()}${path}`;

/** What is sent to solve or to score: the settings and constraints of the panel, and a plan. */
const request = (plan) => ({
  settings: state.settings,
  constraints: state.constraints.map(({ key, enabled, level, weight }) => ({ key, enabled, level, weight })),
  plan,
});

// ---- Shell: navigation, language, theme ------------------------------------------------------

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

function renderNav() {
  fill($('nav'), USE_CASES.map((useCase) => h('button', {
    class: 'rail-item', type: 'button', 'aria-current': useCase === state.useCase ? 'page' : null,
    title: t(`usecase.${useCase.id}.title`), onclick: () => select(useCase),
  }, icon(useCase.icon), h('span', {}, t(`usecase.${useCase.id}.label`)))));
}

function renderHeader() {
  if (!state.useCase) return;
  $('title').textContent = t(`usecase.${state.useCase.id}.title`);
  $('summary').textContent = t(`usecase.${state.useCase.id}.summary`);
  document.title = `${t(`usecase.${state.useCase.id}.title`)} · LW Optimizer`;
}

function renderPrefs() {
  fill($('language'), LANGUAGES.map(([code, short, full]) =>
    h('option', { value: code, title: full, selected: code === language() }, short)));
  const dark = document.documentElement.dataset.theme !== 'light';
  // The button shows what a click gives: the other theme.
  $('theme-icon').setAttribute('d', dark ? SUN : MOON);
  $('theme-label').textContent = t(dark ? 'prefs.theme.light' : 'prefs.theme.dark');
  $('theme').title = t(dark ? 'prefs.theme.toLight' : 'prefs.theme.toDark');
  $('theme').setAttribute('aria-label', $('theme').title);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('lw.theme', theme); } catch (error) { /* the choice lasts for this visit only */ }
  renderPrefs();
  redraw();           // the map and the chart take their colours from the theme
}

/** The language changed: everything on screen is worded again, in place. */
function reword() {
  translatePage();
  renderNav();
  renderPrefs();
  renderHeader();
  renderSolve();
  if (state.config) {
    renderSettings($('tab-settings'), state.config, state.settings, settingChanged);
    drawConstraints();
  }
  if (state.view) {
    // Views build their own texts: mount a fresh one on the plan that is on screen.
    state.view.destroy?.();
    mountView();
  }
  redraw();
}

/** Draws the plan on screen again, as it is, with everything around it. */
function redraw() {
  const frame = state.frames[state.shown];
  if (frame && state.view) {
    state.view.update(frame.plan, { animate: false });
    renderScore($('score'), frame.score);
    renderAnalysis($('analysis'), frame.analysis);
  }
  renderFeed();
  renderBanner();
  refreshPlayer();
}

// ---- Banner and status -----------------------------------------------------------------------

function renderBanner() {
  const banner = $('banner');
  banner.hidden = !state.banner;
  banner.classList.toggle('notice', state.banner?.tone === 'notice');
  banner.textContent = state.banner ? state.banner.text() : '';
}

/** Shows what went wrong, or clears the banner with null. */
function fail(error) {
  state.banner = error ? { text: typeof error === 'function' ? error : wording(error), tone: 'error' } : null;
  renderBanner();
}

/** Something to know that is not an error. */
function notice(text) {
  state.banner = { text, tone: 'notice' };
  renderBanner();
}

function setStatus(text) {
  state.status = text;
  refreshPlayer();
}

// ---- Use case selection ----------------------------------------------------------------------

/** Leaves the run in progress, if any: the page stops listening and asks the server to stop it. */
function abandonRun() {
  const job = state.job && (state.running || state.starting) ? `${base()}/jobs/${state.job}` : null;
  closeStream();
  setRunning(false);
  state.job = null;
  state.finished = null;
  if (job) call('DELETE', job).catch(() => {});
}

function mountView() {
  fill($('stage'));
  state.view = state.useCase.view.mount($('stage'), {
    // A plan can be edited when nothing is solving and the display has caught up with the run.
    editable: () => state.useCase.editable && !state.running && !state.starting && !replaying(),
    onEdit: edited,
    geocode: (address) => call('GET', `${api('/geocode')}?address=${encodeURIComponent(address)}`),
    fail,
  });
}

async function select(useCase) {
  if (state.useCase) abandonRun();
  const epoch = ++state.epoch;
  state.useCase = useCase;
  history.replaceState(null, '', `#${useCase.id}`);
  renderNav();
  renderHeader();
  fail(null);
  state.view?.destroy?.();
  state.view = null;
  state.frames = [];
  state.shown = -1;
  state.feed = [];
  renderFeed();
  renderScore($('score'), null);
  fill($('stage'), h('p', { class: 'muted' }, t('status.loading')));
  setStatus(() => t('status.loading'));
  try {
    const [config, plan, vocabulary, rules] = await Promise.all([call('GET', api('/configuration')),
      call('GET', api('/problem')), call('GET', api('/rules/vocabulary')), call('GET', api('/rules'))]);
    if (epoch !== state.epoch) return;         // another use case was chosen meanwhile
    state.config = config;
    state.vocabulary = vocabulary;
    state.rules = rules;
    state.settings = { ...config.defaults };
    state.constraints = JSON.parse(JSON.stringify(config.constraints));
    renderSettings($('tab-settings'), config, state.settings, settingChanged);
    drawConstraints();
    mountView();
    await present(plan, () => t('status.loaded'));
  } catch (error) {
    if (epoch !== state.epoch) return;
    fill($('stage'));
    setStatus(() => t('status.unavailable'));
    fail(error);
  }
}

/** Puts the ready-made problem back on screen. The settings and the constraints of the panel are kept. */
async function resetPlan() {
  if (!state.useCase) return;
  if (!state.config) return select(state.useCase);          // nothing was loaded yet: start over
  abandonRun();
  const epoch = state.epoch;
  try {
    fail(null);
    const plan = await call('GET', api('/problem'));
    if (epoch !== state.epoch) return;
    state.feed = [];
    renderFeed();
    await present(plan, () => t('status.loaded'));
  } catch (error) {
    if (epoch === state.epoch) fail(error);
  }
}

// ---- Constraints and user-defined rules ------------------------------------------------------

function drawConstraints() {
  const useCase = state.useCase;
  const address = base();
  renderConstraints($('tab-constraints'), state.constraints, state.config.constraints, rescoreSoon, {
    rules: state.rules,
    onNew: () => openRuleBuilder($('rule-dialog'), {
      useCase: useCase.id,
      vocabulary: state.vocabulary,
      url: (path) => `${address}${path}`,
      request: () => request(currentPlan()),
      onActivated: (rule) => reloadConstraints(() => t('rules.activated', { name: rule.rule.name })),
    }),
    onRemove: async (constraint) => {
      if (!window.confirm(t('rules.remove.confirm', { name: constraint.name }))) return;
      try {
        await call('DELETE', `${address}/rules/${encodeURIComponent(constraint.key)}`);
        await reloadConstraints(() => t('rules.removed', { name: constraint.name }));
      } catch (error) {
        fail(error);
      }
    },
  });
}

/** The set of constraints changed on the server: reload it, keeping what was tuned in the panel. */
async function reloadConstraints(message) {
  const epoch = state.epoch;
  try {
    const [config, rules] = await Promise.all([call('GET', api('/configuration')), call('GET', api('/rules'))]);
    if (epoch !== state.epoch) return;
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
    if (message && epoch === state.epoch) notice(message);
  } catch (error) {
    if (epoch === state.epoch) fail(error);
  }
}

/** A setting of the panel changed. Those of the problem itself change what the plan on screen is worth. */
function settingChanged(key) {
  if (key === null || key.startsWith('problem.')) rescoreSoon();
}

// ---- Showing a plan that is not part of a run: the problem, or a plan edited by hand ---------

const replaying = () => state.playing && state.shown < state.frames.length - 1;

/** The plan actions apply to: the one on screen, or the last of a run that is still being replayed. */
const currentPlan = () => (replaying() ? state.frames[state.frames.length - 1] : state.frames[state.shown])?.plan;

/** Scores a plan and makes it the plan on screen. Returns false when the answer came too late to matter. */
async function present(plan, status) {
  const epoch = state.epoch;
  const sequence = ++state.analysis;
  const snapshot = await call('POST', api('/analysis'), request(plan));
  if (epoch !== state.epoch || sequence !== state.analysis) return false;
  state.frames = [snapshot];
  state.shown = -1;
  state.job = null;
  state.finished = null;
  show(0, { animate: true });
  setStatus(status);
  return true;
}

/** The user moved or pinned something: show it at once, then score it. */
async function edited(plan) {
  if (state.running || state.starting) return;
  const before = state.frames[state.shown];
  if (!before || JSON.stringify(before.plan) === JSON.stringify(plan)) return;      // nothing changed
  const epoch = state.epoch;
  const sequence = ++state.analysis;
  // The edit is on screen before the server has scored it, so that the next edit starts from
  // it. Loads, distances and the score follow with the answer.
  state.frames = [{ ...before, plan }];
  state.shown = -1;
  state.job = null;
  state.finished = null;
  show(0, { animate: true });
  pushFeed(before.plan, plan, () => t('feed.byHand'));
  setStatus(() => t('status.edited'));
  fail(null);
  try {
    const snapshot = await call('POST', api('/analysis'), request(plan));
    if (epoch !== state.epoch || sequence !== state.analysis) return;
    state.frames = [snapshot];
    state.shown = -1;
    show(0, { animate: false });
  } catch (error) {
    if (epoch !== state.epoch || sequence !== state.analysis) return;
    // The server refused the edit: back to the plan it was made from.
    state.frames = [before];
    state.shown = -1;
    show(0, { animate: false });
    state.feed.shift();
    renderFeed();
    setStatus(() => t('status.loaded'));
    fail(error);
  }
}

/** Constraints or problem settings changed: the plan on screen is worth a different score. */
async function rescore() {
  if (state.running || state.starting || state.shown < 0) return;
  const epoch = state.epoch;
  const sequence = ++state.analysis;
  const index = state.shown;
  try {
    fail(null);
    const snapshot = await call('POST', api('/analysis'), request(state.frames[index].plan));
    if (epoch !== state.epoch || sequence !== state.analysis || !state.frames[index]) return;
    state.frames[index] = { ...state.frames[index], plan: snapshot.plan, score: snapshot.score, analysis: snapshot.analysis };
    if (state.shown === index) redraw();
  } catch (error) {
    if (epoch === state.epoch && sequence === state.analysis) fail(error);
  }
}

const rescoreSoon = debounce(rescore, 220);

// ---- Solving ---------------------------------------------------------------------------------

async function solve() {
  if (state.running) return stop();
  if (state.starting || !state.view || !state.config) return;
  const epoch = state.epoch;
  const jobs = api('/jobs');
  state.starting = true;
  $('solve').disabled = true;
  fail(null);
  try {
    const job = await call('POST', jobs, request(currentPlan()));
    if (epoch !== state.epoch) {
      call('DELETE', `${jobs}/${job.id}`).catch(() => {});       // the use case changed: that job is nobody's
      return;
    }
    state.job = job.id;
    state.frames = [];
    state.shown = -1;
    state.finished = null;
    state.feed = [];
    renderFeed();
    setRunning(true);
    openTab('analysis');
    setStatus(() => t('status.solving'));
    const stream = new EventSource(`${jobs}/${job.id}/events`);
    state.stream = stream;
    const mine = () => state.stream === stream;
    stream.addEventListener('snapshot', (event) => {
      if (!mine()) return;
      state.frames.push(JSON.parse(event.data));
      refreshPlayer();
    });
    stream.addEventListener('done', (event) => {
      stream.close();
      if (mine()) finish(JSON.parse(event.data));
    });
    stream.addEventListener('failed', (event) => {
      stream.close();
      if (!mine()) return;
      const failed = JSON.parse(event.data);
      finish(null);
      fail(() => `${t('error.job')} ${failed.error}`);
    });
    // An EventSource reconnects by itself and would replay the job from its start: close it for good.
    stream.onerror = () => {
      stream.close();
      if (mine() && state.running) {
        finish(null);
        fail(() => t('error.connection'));
      }
    };
  } catch (error) {
    if (epoch === state.epoch) fail(error);
  } finally {
    state.starting = false;
    $('solve').disabled = false;
  }
}

async function stop() {
  if (!state.job) return;
  try {
    await call('DELETE', api(`/jobs/${state.job}`));
  } catch (error) {
    fail(error);
  }
}

function finish(job) {
  closeStream();
  setRunning(false);
  state.finished = job ? { engine: job.engine, reason: job.terminationReason } : { stopped: true };
  refreshPlayer();
  // Editing becomes possible again: redraw the plan on screen with its handles.
  if (state.shown >= 0 && !replaying()) redraw();
  if (job?.warnings?.length) {
    notice(() => job.warnings.map((warning) => tMessage('warning', warning.code === 'rules-not-optimized'
      ? { ...warning, arguments: [tApi(`engine.${warning.arguments[0]}`, warning.arguments[0]), ...warning.arguments.slice(1)] }
      : warning)).join(' '));
  }
  // The job was recorded against the user-defined rules it applied: show their new figures.
  if (job && state.rules.length) {
    const epoch = state.epoch;
    call('GET', api('/rules')).then((rules) => {
      if (epoch !== state.epoch) return;
      state.rules = rules;
      drawConstraints();
    }).catch(() => {});
  }
}

function closeStream() {
  if (state.stream) state.stream.close();
  state.stream = null;
}

function renderSolve() {
  const button = $('solve');
  button.textContent = t(state.running ? 'action.stop' : 'action.solve');
  button.classList.toggle('stop', state.running);
}

function setRunning(running) {
  state.running = running;
  state.playing = true;
  renderSolve();
}

// ---- Playback: every improvement is a frame --------------------------------------------------

function show(index, { animate = true } = {}) {
  const frame = state.frames[index];
  if (!frame || !state.view) return;
  const from = state.shown;
  const previous = from >= 0 && from !== index ? state.frames[from]?.plan : null;
  state.shown = index;
  state.view.update(frame.plan, { animate });
  if (previous && animate && index > from) pushFeed(previous, frame.plan, () => t('feed.step', { step: number(frame.step) }));
  renderScore($('score'), frame.score);
  renderAnalysis($('analysis'), frame.analysis);
  refreshPlayer();
}

/** Remembers what changed between two plans; it is put into words when the feed is drawn. */
function pushFeed(previous, next, when) {
  const view = state.useCase.view;
  if (view.diff(previous, next).length === 0) return;
  state.feed.unshift({ changes: () => view.diff(previous, next), when });
  state.feed.length = Math.min(state.feed.length, 30);
  renderFeed();
}

function renderFeed() {
  if (state.feed.length === 0) {
    fill($('feed'), h('li', { class: 'empty' }, t('feed.empty')));
    return;
  }
  fill($('feed'), state.feed.map((entry) => {
    const changes = entry.changes();
    const when = h('span', { class: 'muted' }, ` · ${entry.when()}`);
    return [
      changes.length > 4 ? h('li', {}, t('feed.more', { count: changes.length - 4 }), when.cloneNode(true)) : null,
      changes.slice(0, 4).map((change) => h('li', {}, h('b', {}, change.what), ` ${change.text}`, when.cloneNode(true))),
    ];
  }));
}

function statusText(behind) {
  if (state.running) return behind > 0 ? t('status.ahead', { count: behind }) : t('status.solving');
  if (state.finished) {
    const done = state.finished.stopped ? t('status.stopped') : t('status.done', {
      engine: tApi(`engine.${state.finished.engine}`, state.finished.engine),
      reason: tApi(`reason.${state.finished.reason}`, String(state.finished.reason || '').toLowerCase().replaceAll('_', ' ')),
    });
    return behind > 0 && state.playing ? `${done} · ${t('status.replaying')}` : done;
  }
  return state.status();
}

function refreshPlayer() {
  const count = state.frames.length;
  const scrub = $('scrub');
  scrub.max = Math.max(0, count - 1);
  scrub.value = Math.max(0, state.shown);
  scrub.disabled = count < 2;
  $('reset').disabled = state.running || state.starting;
  drawChart($('chart'), state.frames, state.shown);
  const frame = state.frames[state.shown];
  $('frame-label').textContent = !frame ? (state.running ? t('player.waiting') : t('player.none'))
    : count < 2 ? frame.score.text
    : t('player.frame', { index: state.shown, last: count - 1, step: number(frame.step), seconds: number(frame.elapsedMs / 1000, 2) });
  const behind = count - 1 - state.shown;
  $('status').textContent = statusText(behind);
  $('play-icon').setAttribute('d', state.playing && behind > 0 ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M7 5v14l12-7z');
}

/** Advances the display towards the latest frame, skipping ahead when the search outruns it. */
function tick() {
  try {
    const behind = state.frames.length - 1 - state.shown;
    if (state.playing && behind > 0) {
      show(state.shown + Math.max(1, Math.ceil(behind / 45)));
    }
  } catch (error) {
    // One frame that cannot be drawn must not stop the display for good.
    fail(error);
  }
  setTimeout(tick, Number($('speed').value));
}

// ---- Wiring ----------------------------------------------------------------------------------

function openTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    $(`tab-${tab.dataset.tab}`).hidden = !selected;
  });
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => openTab(tab.dataset.tab)));
$('solve').addEventListener('click', solve);
$('reset').addEventListener('click', resetPlan);
$('play').addEventListener('click', () => {
  // At the end of a finished run, play starts the replay over.
  if (!state.running && state.shown >= state.frames.length - 1 && state.frames.length > 1) {
    state.playing = true;
    show(0, { animate: false });
  } else {
    state.playing = !state.playing;
    // Pausing settles the display on a plan, which can then be edited: draw its handles.
    redraw();
  }
});
$('scrub').addEventListener('input', (event) => {
  state.playing = false;
  show(Number(event.target.value), { animate: false });
});
$('language').addEventListener('change', (event) => setLanguage(event.target.value));
$('theme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
window.addEventListener('resize', () => drawChart($('chart'), state.frames, state.shown));
onLanguageChange(reword);

$('api-docs').href = `${API}/swagger-ui.html`;
translatePage();
renderPrefs();
renderSolve();
select(USE_CASES.find((useCase) => `#${useCase.id}` === location.hash) || USE_CASES[0]);
tick();
