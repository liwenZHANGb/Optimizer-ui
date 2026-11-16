// Runs before the page is drawn, so that it never flashes in the wrong theme or language.
// The choices are kept in the browser; without one, the system's theme and language apply.
(function () {
  var root = document.documentElement;
  var stored = function (key) { try { return localStorage.getItem(key); } catch (e) { return null; } };
  var theme = stored('lw.theme');
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  root.dataset.theme = theme;
  var language = stored('lw.language') || (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (['en', 'fr', 'zh'].indexOf(language) < 0) language = 'en';
  root.dataset.language = language;
  root.lang = language === 'zh' ? 'zh-Hans' : language;
})();
