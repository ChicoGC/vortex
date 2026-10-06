/* The privacy pages (privacy.html, privacidade.html). An external file so the
   Content-Security-Policy can forbid inline scripts. */
/* Contents start folded on phones, where they'd push the policy below the fold.
   Then mark the section being read. Switching language here switches the app's too. */
(function () {
  document.querySelectorAll('[data-lang-switch]').forEach(function (a) {
    a.addEventListener('click', function () { try { localStorage.setItem('vortex.lang', a.dataset.langSwitch); } catch (e) {} });
  });

  var box = document.querySelector('.toc__box');
  var narrow = window.matchMedia('(max-width: 900px)');
  if (narrow.matches) box.open = false;
  box.addEventListener('toggle', function () { if (!narrow.matches) box.open = true; });
  box.addEventListener('click', function (e) { if (narrow.matches && e.target.closest('.toc__list a')) box.open = false; });

  var links = {};
  document.querySelectorAll('.toc__list a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      Object.keys(links).forEach(function (id) { links[id].removeAttribute('aria-current'); });
      if (links[e.target.id]) links[e.target.id].setAttribute('aria-current', 'location');
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('.prose section[id]').forEach(function (s) { io.observe(s); });
})();
