import en from './lang/en.js';
import fr from './lang/fr.js';
import zh from './lang/zh.js';

// The three languages of the interface. English is the reference: a key missing from another
// language falls back to it, so a new text is never blank.
//
// Texts of the page are looked up by key with t(). Texts that come from the API in English
// (labels of settings, names of constraints, findings about a rule) are looked up by a key
// derived from their identifier with tApi(); when a language has no entry, the API's own
// text is shown. Names of things in the data (employees, towns) and the rule language itself
// are not translated.

const DICTIONARIES = { en, fr, zh };
const LOCALES = { en: 'en-GB', fr: 'fr-FR', zh: 'zh-CN' };
export const LANGUAGES = [['en', 'EN', 'English'], ['fr', 'FR', 'Français'], ['zh', '中文', '中文（简体）']];

let current = DICTIONARIES[document.documentElement.dataset.language] ? document.documentElement.dataset.language : 'en';
const listeners = [];

export const language = () => current;
export const locale = () => LOCALES[current];

export function setLanguage(code) {
  if (!DICTIONARIES[code] || code === current) return;
  current = code;
  try { localStorage.setItem('lw.language', code); } catch (error) { /* the choice lasts for this visit only */ }
  document.documentElement.dataset.language = code;
  document.documentElement.lang = code === 'zh' ? 'zh-Hans' : code;
  listeners.forEach((listener) => listener());
}

export function onLanguageChange(listener) {
  listeners.push(listener);
}

function entry(key) {
  return DICTIONARIES[current][key] ?? en[key];
}

function fill(text, params) {
  return text.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined || params[name] === null ? whole : params[name]));
}

/**
 * The text of a key, with {name} replaced by params.name. An entry that is an object holds
 * plural forms and is chosen with params.count: { one: '{count} task', other: '{count} tasks' }.
 */
export function t(key, params = {}) {
  let text = entry(key);
  if (text === undefined) return key;
  if (typeof text === 'object') {
    text = text[new Intl.PluralRules(locale()).select(Number(params.count))] ?? text.other;
  }
  return fill(text, params);
}

/** True when the current language, or English, has the key. */
export const has = (key) => entry(key) !== undefined;

/** A text the API gave in English: translated when the key is known, the API's own otherwise. */
export function tApi(key, fallback, params = {}) {
  return has(key) ? t(key, params) : fallback;
}

/**
 * A message of the API that comes with a code and the values it mentions ({code, arguments,
 * text}): worded in the current language from `prefix.code`, with {0}, {1}... for the values.
 */
export function tMessage(prefix, message) {
  return tApi(`${prefix}.${message.code}`, message.text ?? message.message ?? '', Object.fromEntries((message.arguments || []).entries()));
}

/** Fills the texts written in the page itself: data-i18n for content, data-i18n-title for title and label. */
export function translatePage(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', el.title);
  });
}

export const number = (value, digits = 0) =>
  Number(value).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
