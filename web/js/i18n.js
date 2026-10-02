/* ==========================================================================
   vortex — interface language
   English text is the key: t('Log in') returns it as-is in English and looks
   it up in I18N.pt (js/i18n-pt.js) in Portuguese, so a missing entry falls
   back to English instead of breaking. Changing language reloads the page,
   which is why strings may be translated once, at load time.
   ========================================================================== */

const LANGS = { en: 'English', pt: 'Português' };

const LANG = (function () {
  let saved = null;
  try { saved = localStorage.getItem('vortex.lang'); } catch (e) { /* private mode */ }
  if (saved && LANGS[saved]) return saved;
  return /^pt\b/i.test(navigator.language || '') ? 'pt' : 'en';
})();

document.documentElement.lang = LANG === 'pt' ? 'pt-BR' : 'en';

const I18N = { pt: {} };

/* t('Hi {name}', { name: 'Ana' }). Values are inserted as given, so escape user text before passing it. */
function t(text, vars) {
  const out = (LANG !== 'en' && I18N[LANG][text]) || text;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; });
}

/* For an English word with two meanings: tx('glass', 'Light') looks up 'glass|Light' first. */
function tx(context, text, vars) {
  const own = LANG !== 'en' && I18N[LANG][context + '|' + text];
  return own ? t(own, vars) : t(text, vars);
}

/* tn(3, '{n} friend', '{n} friends'). Portuguese uses the singular for exactly 1 too. */
function tn(n, one, many, vars) {
  return t(n === 1 ? one : many, Object.assign({ n: n }, vars));
}

/* The date/number locale to use where the English build asked for `en`. */
function loc(en) { return LANG === 'pt' ? 'pt-BR' : en; }

function setLang(lang) {
  if (!LANGS[lang] || lang === LANG) return;
  try { localStorage.setItem('vortex.lang', lang); } catch (e) { /* private mode */ }
  location.reload();
}
