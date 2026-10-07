/* Runs in <head> before the first paint, on the app and the privacy pages: the saved theme and
   accent, so nothing flashes a different look. An external file, not an inline <script>, so the
   Content-Security-Policy in vercel.json can forbid inline scripts. */
(function () {
  var root = document.documentElement;
  function get(k) { try { return localStorage.getItem('vortex.' + k); } catch (e) { return null; } }
  var light = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches;
  // Scenes and the mode each rides on; a copy of THEMES in custom-views.js.
  var SCENES = { galaxy: 'dark', aurora: 'dark', ocean: 'dark', sunset: 'dark', sakura: 'light', sky: 'light' };
  var theme = get('theme');
  if (SCENES[theme]) { root.dataset.theme = SCENES[theme]; root.dataset.scene = theme; }
  else root.dataset.theme = theme === 'light' || theme === 'dark' ? theme : (light ? 'light' : 'dark');
  var accent = get('look.accent');
  if (accent && accent !== 'ember') root.dataset.accent = accent;

  // Fonts load as media="print" so they never hold up the first paint; switch them on once in.
  var fonts = document.querySelector('link[data-async-css]');
  if (fonts) {
    if (fonts.sheet) fonts.media = 'all';
    else fonts.addEventListener('load', function () { fonts.media = 'all'; });
  }
})();
