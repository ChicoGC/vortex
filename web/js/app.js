/* ==========================================================================
   vortex — application shell
   ========================================================================== */

const NAV = [
  { group: 'Listening' },
  { id: 'home',         label: 'Home',         icon: 'home' },
  { id: 'feed',         label: 'Feed',         icon: 'broadcast' },
  { id: 'friends',      label: 'Friends',      icon: 'users' },
  { id: 'activity',     label: 'Activity',     icon: 'activity' },
  { id: 'music',        label: 'Music',        icon: 'disc' },
  { group: 'You' },
  { id: 'profile',      label: 'Profile',      icon: 'user' },
  { id: 'appearance',   label: 'Appearance',   icon: 'droplet' },
  { id: 'experimental', label: 'Experimental', icon: 'flask', dot: true },
  { id: 'settings',     label: 'Settings',     icon: 'sliders' }
];

const MOBILE_NAV = ['home', 'feed', 'friends', 'music', 'profile'];

const STORE = {
  get: function (k, fallback) {
    try { const v = localStorage.getItem('vortex.' + k); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  },
  set: function (k, v) { try { localStorage.setItem('vortex.' + k, v); } catch (e) { /* private mode */ } }
};

const app = {
  view: 'home',
  player: {
    elapsed: DATA.nowPlaying.elapsed,
    duration: DATA.nowPlaying.duration,
    playing: true
  }
};

/* ---- sidebar ------------------------------------------------------------ */
function renderSidebar() {
  const np = DATA.nowPlaying;
  const nav = NAV.map(function (n) {
    if (n.group) return '<p class="nav-group t-overline">' + n.group + '</p>';
    return '<a class="nav" href="#/' + n.id + '" data-view-link="' + n.id + '">' +
      icon(n.icon, 19) +
      '<span>' + n.label + '</span>' +
      (n.dot ? '<span class="nav__dot" aria-label="In development"></span>' : '') +
    '</a>';
  }).join('');

  return '' +
  '<div class="sidebar__brand">' +
    '<a class="brand" href="#/home">' + icon('vortex', 22) + '<b>vortex</b></a>' +
    '<button class="iconbtn" id="railToggle" data-tip="Collapse sidebar" aria-label="Collapse sidebar">' +
      icon('chevronLeft', 17) + '</button>' +
  '</div>' +
  '<button class="field field--sm sidebar__search" id="openCmdk">' +
    icon('search', 15) + '<span class="c-tertiary">Search</span>' +
    '<span class="field__kbd">⌘K</span>' +
  '</button>' +
  '<nav class="sidebar__nav scroll">' + nav + '</nav>' +
  '<div class="sidebar__foot">' +
    '<div class="np">' +
      '<div class="np__top">' +
        '<div class="art" data-art="' + np.art + '" style="width:38px;height:38px"></div>' +
        '<div class="np__meta">' +
          '<span class="t-label-m truncate">' + esc(np.title) + '</span>' +
          '<span class="t-caption c-tertiary truncate">' + esc(np.artist) + '</span>' +
        '</div>' +
        '<button class="iconbtn" data-player-toggle aria-label="Pause">' + icon('pause', 17) + '</button>' +
      '</div>' +
      '<div class="track track--thin"><i data-np-bar style="width:0%"></i></div>' +
      '<div class="np__times">' +
        '<span class="t-meta c-tertiary" data-np-elapsed>0:00</span>' +
        '<span class="t-meta c-tertiary">' + mmss(np.duration) + '</span>' +
      '</div>' +
    '</div>' +
    '<button class="userchip" data-nav="profile">' +
      avatarEl(DATA.me.initials, '32', 'online') +
      '<span class="userchip__meta">' +
        '<span class="t-label-m truncate">' + esc(DATA.me.name) + '</span>' +
        '<span class="t-caption c-tertiary">' + DATA.me.streak + '-day streak</span>' +
      '</span>' +
      icon('chevronDown', 15) +
    '</button>' +
  '</div>';
}

function renderBottomNav() {
  return '<nav>' + MOBILE_NAV.map(function (id) {
    const n = NAV.filter(function (x) { return x.id === id; })[0];
    return '<a href="#/' + n.id + '" data-view-link="' + n.id + '">' + icon(n.icon, 20) + n.label + '</a>';
  }).join('') + '</nav>';
}

function renderMobileBar() {
  return '<a class="brand" href="#/home">' + icon('vortex', 20) + '<b style="font-size:17px">vortex</b></a>' +
    '<span class="spacer"></span>' +
    '<button class="iconbtn iconbtn--lg" id="openCmdkMobile" aria-label="Search">' + icon('search', 18) + '</button>' +
    '<button class="iconbtn iconbtn--lg" data-nav="settings" aria-label="Settings">' + icon('sliders', 18) + '</button>';
}

/* ---- routing ------------------------------------------------------------ */
function currentRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '').trim();
  return VIEWS[raw] ? raw : 'home';
}

function setView(name) {
  app.view = name;
  document.getElementById('viewRoot').innerHTML = VIEWS[name]();
  document.querySelectorAll('[data-view-link]').forEach(function (a) {
    if (a.dataset.viewLink === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const label = (NAV.filter(function (n) { return n.id === name; })[0] || {}).label || 'vortex';
  document.title = label + ' · vortex';
  syncAppearanceControls();
  updatePlayerUI();
  const scroller = document.querySelector('.view-scroll');
  if (scroller) scroller.scrollTop = 0;
}

/* ---- theme & preferences ------------------------------------------------ */
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  STORE.set('theme', theme);
  syncAppearanceControls();
}

function setRail(compact) {
  document.getElementById('app').dataset.rail = compact ? 'compact' : 'full';
  STORE.set('rail', compact ? 'compact' : 'full');
  const btn = document.getElementById('railToggle');
  if (btn) {
    btn.style.transform = compact ? 'rotate(180deg)' : '';
    btn.dataset.tip = compact ? 'Expand sidebar' : 'Collapse sidebar';
  }
  syncAppearanceControls();
}

function setAmbient(on) {
  document.getElementById('ambient').style.display = on ? '' : 'none';
  STORE.set('ambient', on ? '1' : '0');
}

function syncAppearanceControls() {
  const theme = document.documentElement.dataset.theme;
  document.querySelectorAll('[data-theme-pick]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.themePick === theme));
  });
  const railOn = document.getElementById('app').dataset.rail === 'compact';
  const railToggle = document.querySelector('[data-toggle="rail"]');
  if (railToggle) railToggle.setAttribute('aria-checked', String(railOn));
  const ambOn = STORE.get('ambient', '1') === '1';
  const ambToggle = document.querySelector('[data-toggle="ambient"]');
  if (ambToggle) ambToggle.setAttribute('aria-checked', String(ambOn));
}

/* ---- player -------------------------------------------------------------- */
function updatePlayerUI() {
  const p = app.player;
  const pct = (p.elapsed / p.duration) * 100;
  const bar = document.querySelector('[data-np-bar]');
  if (bar) bar.style.width = pct + '%';
  const el = document.querySelector('[data-np-elapsed]');
  if (el) el.textContent = mmss(p.elapsed);

  const heroBar = document.querySelector('.hero__progress .track i');
  if (heroBar) heroBar.style.width = pct + '%';
  const heroKnob = document.querySelector('.hero__progress .slider__knob');
  if (heroKnob) heroKnob.style.left = pct + '%';
  const heroTime = document.querySelector('.hero__progress .t-meta');
  if (heroTime) heroTime.textContent = mmss(p.elapsed);

  const glyph = p.playing ? 'pause' : 'play';
  const heroBtn = document.getElementById('heroPlay');
  if (heroBtn) { heroBtn.innerHTML = icon(glyph, 18); heroBtn.setAttribute('aria-label', p.playing ? 'Pause' : 'Play'); }
  const miniBtn = document.querySelector('[data-player-toggle]');
  if (miniBtn) { miniBtn.innerHTML = icon(glyph, 17); miniBtn.setAttribute('aria-label', p.playing ? 'Pause' : 'Play'); }
}

function togglePlayer() {
  app.player.playing = !app.player.playing;
  updatePlayerUI();
}

setInterval(function () {
  if (!app.player.playing) return;
  app.player.elapsed = (app.player.elapsed + 1) % app.player.duration;
  updatePlayerUI();
}, 1000);

/* ---- toasts -------------------------------------------------------------- */
const TOASTS = {
  recap: ['success', 'Recap link copied', 'Anyone with the link can see your week'],
  accept: ['success', 'Friend request accepted', 'You can now see each other activity'],
  request: ['info', 'Request sent', 'We will let you know when they accept'],
  invite: ['info', 'Invite link copied', 'Share it anywhere — it expires in 7 days'],
  export: ['success', 'Export queued', 'Your listening history will arrive by email'],
  connect: ['error', 'Not wired up yet', 'Service connections land with the API work'],
  provider: ['error', 'Prototype only', 'OAuth is not connected in this build'],
  forgot: ['info', 'Nothing to recover', 'This login screen has no backend yet'],
  signup: ['info', 'Sign-up is not live', 'Accounts arrive with the Supabase integration'],
  flags: ['info', 'No flags yet', 'Feature flags land alongside the backend'],
  login: ['error', 'Prototype login', 'The form validates, but nothing is submitted']
};

function toast(kind) {
  const spec = TOASTS[kind];
  if (!spec) return;
  const glyph = { success: 'check', info: 'broadcast', error: 'close' }[spec[0]];
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML =
    '<span class="toast__well toast__well--' + spec[0] + '">' + icon(glyph, 15) + '</span>' +
    '<span class="toast__body">' +
      '<span class="t-label-m">' + esc(spec[1]) + '</span>' +
      '<span class="t-caption c-tertiary">' + esc(spec[2]) + '</span>' +
    '</span>' +
    '<button class="iconbtn" aria-label="Dismiss">' + icon('close', 15) + '</button>';
  const stack = document.getElementById('toasts');
  stack.appendChild(el);
  const kill = function () {
    el.classList.add('toast--out');
    setTimeout(function () { el.remove(); }, 200);
  };
  el.querySelector('button').addEventListener('click', kill);
  setTimeout(kill, 5000);
}

/* ---- overlays ------------------------------------------------------------ */
function closeOverlay() {
  const o = document.getElementById('overlay');
  o.innerHTML = '';
  o.hidden = true;
}

function openModal(kind) {
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML =
    '<div class="scrim" data-scrim>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
        '<div class="modal__head">' +
          '<span class="toast__well toast__well--error">' + icon('close', 15) + '</span>' +
          '<h2 class="t-title-s" id="modalTitle">Delete your account?</h2>' +
        '</div>' +
        '<div class="modal__body">' +
          '<p class="t-body-m c-secondary">This removes your profile, listening history, friends and reactions. ' +
          'Your streak of ' + DATA.me.streak + ' days goes with it. This cannot be undone.</p>' +
          '<span class="field"><input type="text" placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm"></span>' +
        '</div>' +
        '<div class="modal__foot">' +
          '<button class="btn btn--ghost btn--sm" data-close>Cancel</button>' +
          '<button class="btn btn--primary btn--sm" disabled>Delete account</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const input = o.querySelector('input');
  const confirm = o.querySelector('.modal__foot .btn--primary');
  input.addEventListener('input', function () { confirm.disabled = input.value.trim() !== 'DELETE'; });
  input.focus();
}

const CMD_ACTIONS = [
  { label: 'Toggle theme', hint: 'Appearance', run: function () { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }, icon: 'droplet' },
  { label: 'Toggle compact sidebar', hint: 'Navigation', run: function () { setRail(document.getElementById('app').dataset.rail !== 'compact'); }, icon: 'bars' },
  { label: app.player.playing ? 'Pause playback' : 'Resume playback', hint: 'Player', run: togglePlayer, icon: 'pause' }
];

function openCmdk() {
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML =
    '<div class="scrim" data-scrim>' +
      '<div class="modal cmdk" role="dialog" aria-modal="true" aria-label="Command palette">' +
        '<div class="cmdk__input">' + icon('search', 19) +
          '<input id="cmdkInput" type="text" placeholder="Search destinations, friends, actions…" autocomplete="off">' +
          '<span class="field__kbd">ESC</span>' +
        '</div>' +
        '<div class="cmdk__list" id="cmdkList"></div>' +
      '</div>' +
    '</div>';

  const input = document.getElementById('cmdkInput');
  const list = document.getElementById('cmdkList');

  function results(q) {
    q = q.trim().toLowerCase();
    const dest = NAV.filter(function (n) { return n.id && (!q || n.label.toLowerCase().indexOf(q) > -1); })
      .map(function (n) { return { kind: 'nav', label: n.label, hint: 'Go to', icon: n.icon, id: n.id }; });
    const people = DATA.friends.filter(function (f) { return q && f.name.toLowerCase().indexOf(q) > -1; })
      .slice(0, 4).map(function (f) { return { kind: 'friend', label: f.name, hint: 'Friend', icon: 'user' }; });
    const acts = CMD_ACTIONS.filter(function (a) { return !q || a.label.toLowerCase().indexOf(q) > -1; })
      .map(function (a) { return { kind: 'action', label: a.label, hint: a.hint, icon: a.icon, run: a.run }; });
    return dest.concat(people, acts);
  }

  function paint(q) {
    const rows = results(q);
    if (!rows.length) {
      list.innerHTML = '<div class="empty"><span class="empty__well">' + icon('search', 20) + '</span>' +
        '<span class="t-body-m-med">No matches</span>' +
        '<p class="t-body-s c-tertiary">Try a destination, a friend name, or an action.</p></div>';
      return;
    }
    list.innerHTML = rows.map(function (r, i) {
      return '<button class="menu__item" data-cmd="' + i + '">' + icon(r.icon, 16) +
        '<span>' + esc(r.label) + '</span><kbd>' + esc(r.hint) + '</kbd></button>';
    }).join('');
    list.querySelectorAll('[data-cmd]').forEach(function (b) {
      b.addEventListener('click', function () { pick(rows[+b.dataset.cmd]); });
    });
  }

  function pick(r) {
    closeOverlay();
    if (r.kind === 'nav') location.hash = '#/' + r.id;
    else if (r.kind === 'action') r.run();
    else toast('request');
  }

  input.addEventListener('input', function () { paint(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      const rows = results(input.value);
      if (rows.length) { e.preventDefault(); pick(rows[0]); }
    }
  });
  paint('');
  input.focus();
}

/* ---- event delegation ---------------------------------------------------- */
document.addEventListener('click', function (e) {
  const t = e.target;

  const closeBtn = t.closest('[data-close]');
  const scrim = t.closest('[data-scrim]');
  if (closeBtn || (scrim && t === scrim)) { closeOverlay(); return; }

  const navBtn = t.closest('[data-nav]');
  if (navBtn) { location.hash = '#/' + navBtn.dataset.nav; return; }

  if (t.closest('#openCmdk') || t.closest('#openCmdkMobile')) { openCmdk(); return; }
  if (t.closest('#railToggle')) { setRail(document.getElementById('app').dataset.rail !== 'compact'); return; }

  const modalBtn = t.closest('[data-modal]');
  if (modalBtn) { openModal(modalBtn.dataset.modal); return; }

  const toastBtn = t.closest('[data-toast]');
  if (toastBtn) { toast(toastBtn.dataset.toast); return; }

  const themeBtn = t.closest('[data-theme-pick]');
  if (themeBtn) { setTheme(themeBtn.dataset.themePick); return; }

  const toggle = t.closest('[data-toggle]');
  if (toggle && toggle.getAttribute('aria-disabled') !== 'true') {
    const on = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(on));
    if (toggle.dataset.toggle === 'rail') setRail(on);
    if (toggle.dataset.toggle === 'ambient') setAmbient(on);
    return;
  }

  const passBtn = t.closest('[data-pass-toggle]');
  if (passBtn) {
    const input = document.getElementById('authPass');
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    passBtn.innerHTML = icon(shown ? 'eye' : 'eyeOff', 17);
    passBtn.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
    return;
  }

  const react = t.closest('[data-react]');
  if (react) {
    const on = react.getAttribute('aria-pressed') !== 'true';
    const count = react.querySelector('b');
    count.textContent = String(Math.max(0, +count.textContent + (on ? 1 : -1)));
    react.setAttribute('aria-pressed', String(on));
    const sibling = react.parentElement.querySelector('[data-react][aria-pressed="true"]');
    if (on && sibling && sibling !== react) {
      const sc = sibling.querySelector('b');
      sc.textContent = String(Math.max(0, +sc.textContent - 1));
      sibling.setAttribute('aria-pressed', 'false');
    }
    return;
  }

  const playerBtn = t.closest('[data-player-toggle], #heroPlay');
  if (playerBtn) { togglePlayer(); return; }

  const playBtn = t.closest('[data-play-track]');
  if (playBtn) {
    document.querySelectorAll('[data-playing="true"]').forEach(function (r) {
      r.dataset.playing = 'false';
      const eq = r.querySelector('.eq');
      if (eq) eq.outerHTML = '<span class="row__index">--</span>';
    });
    if (playBtn.classList.contains('row')) {
      playBtn.dataset.playing = 'true';
      const idx = playBtn.querySelector('.row__index');
      if (idx) idx.outerHTML = '<span class="eq"><i></i><i></i><i></i></span>';
    }
    app.player.playing = true;
    app.player.elapsed = 0;
    updatePlayerUI();
    return;
  }

  const tab = t.closest('[data-tab]');
  if (tab) {
    tab.parentElement.querySelectorAll('[data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b === tab));
    });
    return;
  }
});

document.addEventListener('submit', function (e) {
  if (e.target.id === 'protoLogin') { e.preventDefault(); toast('login'); }
});

document.addEventListener('keydown', function (e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); return; }
  if (e.key === 'Escape' && !document.getElementById('overlay').hidden) { closeOverlay(); return; }
  if (e.key === '/' && document.activeElement === document.body) { e.preventDefault(); openCmdk(); }
});

window.addEventListener('hashchange', function () { setView(currentRoute()); });

/* ---- boot ---------------------------------------------------------------- */
(function boot() {
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(STORE.get('theme', prefersLight ? 'light' : 'dark'));
  document.getElementById('sidebar').innerHTML = renderSidebar();
  document.getElementById('bottomnav').innerHTML = renderBottomNav();
  document.getElementById('mobilebar').innerHTML = renderMobileBar();
  setRail(STORE.get('rail', 'full') === 'compact');
  setAmbient(STORE.get('ambient', '1') === '1');
  if (!location.hash) location.hash = '#/home';
  setView(currentRoute());
})();
