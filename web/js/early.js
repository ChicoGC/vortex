/* Runs in <head> before the first paint, on the app and the privacy pages: the saved theme and
   accent, so nothing flashes a different look. An external file, not an inline <script>, so the
   Content-Security-Policy in vercel.json can forbid inline scripts. */
(function () {
  var root = document.documentElement;
  function get(k) { try { return localStorage.getItem('vortex.' + k); } catch (e) { return null; } }
  var light = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches;
  root.dataset.theme = get('theme') || (light ? 'light' : 'dark');
  var accent = get('look.accent');
  if (accent && accent !== 'ember') root.dataset.accent = accent;

  // Fonts load as media="print" so they never hold up the first paint; switch them on once in.
  var fonts = document.querySelector('link[data-async-css]');
  if (fonts) {
    if (fonts.sheet) fonts.media = 'all';
    else fonts.addEventListener('load', function () { fonts.media = 'all'; });
  }
})();
