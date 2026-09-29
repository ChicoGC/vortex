/* ==========================================================================
   vortex — Customization: accent, glass, blur, density, motion, sidebar
   Every choice is stored per device and applied to <html> right away, so
   the whole app is the preview.
   ========================================================================== */

const ACCENTS = [
  { id: 'ember',   name: 'Ember',   dark: '#FF5C35', light: '#E8431D' },
  { id: 'magenta', name: 'Magenta', dark: '#EE55AE', light: '#C22A82' },
  { id: 'violet',  name: 'Violet',  dark: '#9077FF', light: '#6548E8' },
  { id: 'azure',   name: 'Azure',   dark: '#4192FF', light: '#1C6BDD' },
  { id: 'mono',    name: 'Mono',    dark: '#F2F1EE', light: '#15151A' }
];
const DENSITIES = [
  { id: 'comfortable', name: 'Comfortable', hint: 'Room to breathe' },
  { id: 'compact',     name: 'Compact',     hint: 'More on screen' },
  { id: 'condensed',   name: 'Condensed',   hint: 'As much as fits' }
];
const MOTIONS = [
  { id: 'system',  name: 'Device' },
  { id: 'full',    name: 'Full' },
  { id: 'reduced', name: 'Reduced' },
  { id: 'off',     name: 'Off' }
];
const LOOK_DEFAULTS = { accent: 'ember', glass: 50, blur: 28, density: 'comfortable', motion: 'system' };
const NAV_LOCKED = ['customization', 'settings'];
const MAX_NAV_PINS = 5;

function lookPref(key) {
  const d = LOOK_DEFAULTS[key];
  const raw = STORE.get('look.' + key, null);
  if (typeof d === 'number') {
    const n = parseInt(raw, 10);
    const max = key === 'blur' ? 40 : 100;
    return isFinite(n) ? Math.max(0, Math.min(max, n)) : d;
  }
  const allowed = { accent: ACCENTS, density: DENSITIES, motion: MOTIONS }[key].map(function (x) { return x.id; });
  return allowed.indexOf(raw) > -1 ? raw : d;
}

function applyLook() {
  const root = document.documentElement;
  const accent = lookPref('accent');
  if (accent === 'ember') delete root.dataset.accent; else root.dataset.accent = accent;
  root.dataset.density = lookPref('density');
  root.dataset.motion = lookPref('motion');
  root.style.setProperty('--glass-k', (lookPref('glass') / 50).toFixed(2));
  const blur = lookPref('blur');
  root.style.setProperty('--blur-default', blur + 'px');
  root.style.setProperty('--blur-strong', Math.round(blur * 1.7) + 'px');
  root.style.setProperty('--blur-subtle', Math.round(blur * 0.57) + 'px');
  if (blur === 0) root.dataset.blur = 'off'; else delete root.dataset.blur;
}

function setLook(key, value) {
  STORE.set('look.' + key, String(value));
  applyLook();
  syncCustomization();
}

function resetLook() {
  Object.keys(LOOK_DEFAULTS).forEach(function (k) { STORE.set('look.' + k, String(LOOK_DEFAULTS[k])); });
  STORE.set('navLayout', '{}');
  applyLook();
  repaintSidebar();
  if (app.view === 'customization') setView('customization');
}

/* Responses to your own clicks (the list reordering) still animate under
   "reduced"; only "off", or the device asking for less, turns them off. */
function motionAllowed() {
  const m = document.documentElement.dataset.motion;
  if (m === 'off') return false;
  if (m === 'full' || m === 'reduced') return true;
  return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function glassWord(v) {
  return v <= 15 ? 'Clear' : v <= 40 ? 'Light' : v <= 60 ? 'Balanced' : v <= 85 ? 'Dense' : 'Frosted';
}

function blurWord(v) { return v === 0 ? 'Off' : v + ' px'; }

function motionHint(id) {
  if (id === 'system') {
    const less = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return 'Follows your device, which currently asks for ' + (less ? 'less motion.' : 'full motion.');
  }
  return {
    full: 'Every animation plays, even if your device asks for less.',
    reduced: 'Looping decoration stops: drifting lights, spinning records, equalisers. Things still move when you click them.',
    off: 'No animations or transitions anywhere.'
  }[id];
}

/* ---- sidebar layout ------------------------------------------------------- */
function navLayout() {
  let saved = {};
  try { saved = JSON.parse(STORE.get('navLayout', '{}')) || {}; } catch (e) { saved = {}; }
  const groups = [];
  let cur = null;
  NAV.forEach(function (n) {
    if (n.group) { cur = { name: n.group, ids: [] }; groups.push(cur); } else cur.ids.push(n.id);
  });
  const order = saved.order && typeof saved.order === 'object' ? saved.order : {};
  groups.forEach(function (g) {
    const want = Array.isArray(order[g.name]) ? order[g.name].filter(function (id, i, a) { return g.ids.indexOf(id) > -1 && a.indexOf(id) === i; }) : [];
    g.ids.forEach(function (id) { if (want.indexOf(id) < 0) want.push(id); });
    g.ids = want;
  });
  const hidden = {};
  (Array.isArray(saved.hidden) ? saved.hidden : []).forEach(function (id) {
    if (typeof id === 'string' && NAV_LOCKED.indexOf(id) < 0) hidden[id] = true;
  });
  const pins = (Array.isArray(saved.pins) ? saved.pins : [])
    .filter(function (u, i, a) { return typeof u === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(u) && a.indexOf(u) === i; })
    .slice(0, MAX_NAV_PINS);
  return { groups: groups, hidden: hidden, pins: pins };
}

function saveNavLayout(l) {
  const order = {};
  l.groups.forEach(function (g) { order[g.name] = g.ids; });
  STORE.set('navLayout', JSON.stringify({ order: order, hidden: Object.keys(l.hidden), pins: l.pins }));
  repaintSidebar();
}

function navListFor(l, group) {
  if (group === 'pins') return l.pins;
  const g = l.groups.filter(function (x) { return x.name === group; })[0];
  return g ? g.ids : null;
}

function moveNavItem(group, key, target, after) {
  const l = navLayout();
  const list = navListFor(l, group);
  if (!list) return;
  const from = list.indexOf(key);
  if (from < 0) return;
  list.splice(from, 1);
  let to;
  if (target === 'up') to = Math.max(0, from - 1);
  else if (target === 'down') to = Math.min(list.length, from + 1);
  else {
    to = list.indexOf(target);
    if (to < 0) { list.splice(from, 0, key); return; }
    if (after) to++;
  }
  list.splice(to, 0, key);
  saveNavLayout(l);
  repaintNavEditor();
}

function toggleNavHidden(id) {
  if (NAV_LOCKED.indexOf(id) > -1) return;
  const l = navLayout();
  if (l.hidden[id]) delete l.hidden[id]; else l.hidden[id] = true;
  saveNavLayout(l);
  repaintNavEditor();
}

function toggleNavPin(username) {
  const l = navLayout();
  const i = l.pins.indexOf(username);
  if (i > -1) l.pins.splice(i, 1);
  else if (l.pins.length < MAX_NAV_PINS) l.pins.push(username);
  else return;
  saveNavLayout(l);
  repaintNavEditor();
}

/* Re-renders the editor and slides each row from where it was, so a move
   reads as a move instead of a flash. Keyboard focus stays on the same control. */
function repaintNavEditor() {
  const box = document.getElementById('navEditor');
  if (!box) return;
  const before = {};
  box.querySelectorAll('[data-flip]').forEach(function (el) { before[el.dataset.flip] = el.getBoundingClientRect().top; });
  const a = document.activeElement;
  const focusSel = a && box.contains(a)
    ? ['data-nav-move', 'data-nav-hide', 'data-navpin'].map(function (k) {
        return a.hasAttribute(k) ? '[' + k + '="' + CSS.escape(a.getAttribute(k)) + '"]' + (a.dataset.key ? '[data-key="' + CSS.escape(a.dataset.key) + '"]' : '') : null;
      }).filter(Boolean)[0]
    : null;
  box.outerHTML = navEditor();
  const next = document.getElementById('navEditor');
  if (focusSel) { const f = next.querySelector(focusSel); if (f && !f.disabled) f.focus(); }
  if (!motionAllowed()) return;
  next.querySelectorAll('[data-flip]').forEach(function (el) {
    const was = before[el.dataset.flip];
    if (was === undefined) return;
    const dy = was - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2, .8, .3, 1)' });
  });
}

function navEditItem(n, group, i, count, hidden) {
  const locked = NAV_LOCKED.indexOf(n.id) > -1;
  return '<li class="navedit__item" draggable="true" data-dnd-key="' + n.id + '" data-dnd-group="' + esc(group) + '" data-flip="nav:' + n.id + '"' +
      (hidden ? ' data-hidden="true"' : '') + '>' +
    '<span class="navedit__grip" aria-hidden="true">' + icon('grip', 16) + '</span>' +
    '<span class="navedit__icon">' + icon(n.icon, 17) + '</span>' +
    '<span class="navedit__name t-body-m-med truncate">' + esc(n.label) + '</span>' +
    (hidden ? '<span class="badge">Hidden</span>' : '') +
    '<span class="navedit__tools">' +
      '<button class="iconbtn" data-nav-move="up" data-key="' + n.id + '" aria-label="Move ' + esc(n.label) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + icon('chevronUp', 15) + '</button>' +
      '<button class="iconbtn" data-nav-move="down" data-key="' + n.id + '" aria-label="Move ' + esc(n.label) + ' down"' + (i === count - 1 ? ' disabled' : '') + '>' + icon('chevronDown', 15) + '</button>' +
      (locked
        ? '<span class="iconbtn navedit__lock" data-tip="Always shown" aria-label="' + esc(n.label) + ' is always shown">' + icon('lock', 14) + '</span>'
        : '<button class="iconbtn" data-nav-hide="' + n.id + '" aria-pressed="' + !!hidden + '" data-tip="' + (hidden ? 'Show in sidebar' : 'Hide from sidebar') + '" aria-label="' +
            (hidden ? 'Show ' : 'Hide ') + esc(n.label) + '">' + icon(hidden ? 'eyeOff' : 'eye', 15) + '</button>') +
    '</span>' +
  '</li>';
}

function navEditor() {
  const l = navLayout();
  const byId = {};
  NAV.forEach(function (n) { if (n.id) byId[n.id] = n; });
  const groups = l.groups.map(function (g) {
    return '<div class="navedit__group">' +
      '<span class="navedit__label t-label-s c-tertiary">' + esc(g.name) + '</span>' +
      '<ul class="navedit__list">' + g.ids.map(function (id, i) { return navEditItem(byId[id], g.name, i, g.ids.length, l.hidden[id]); }).join('') + '</ul>' +
    '</div>';
  }).join('');

  const friendsByName = {};
  DATA.friends.forEach(function (f) { friendsByName[f.username] = f; });
  const pinned = l.pins.map(function (u) { return friendsByName[u]; }).filter(Boolean);
  const free = DATA.friends.filter(function (f) { return l.pins.indexOf(f.username) < 0; });
  const full = l.pins.length >= MAX_NAV_PINS;
  const pins =
    '<div class="navedit__group">' +
      '<span class="navedit__label t-label-s c-tertiary">Pinned friends · ' + pinned.length + ' of ' + MAX_NAV_PINS + '</span>' +
      (pinned.length
        ? '<ul class="navedit__list">' + pinned.map(function (f, i) {
            return '<li class="navedit__item" draggable="true" data-dnd-key="' + esc(f.username) + '" data-dnd-group="pins" data-flip="pin:' + esc(f.username) + '">' +
              '<span class="navedit__grip" aria-hidden="true">' + icon('grip', 16) + '</span>' +
              avatarEl(f.initials, '24', null, f.avatarUrl) +
              '<span class="navedit__name t-body-m-med truncate">' + esc(f.name) + '</span>' +
              '<span class="navedit__tools">' +
                '<button class="iconbtn" data-nav-move="up" data-key="' + esc(f.username) + '" data-group="pins" aria-label="Move ' + esc(f.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + icon('chevronUp', 15) + '</button>' +
                '<button class="iconbtn" data-nav-move="down" data-key="' + esc(f.username) + '" data-group="pins" aria-label="Move ' + esc(f.name) + ' down"' + (i === pinned.length - 1 ? ' disabled' : '') + '>' + icon('chevronDown', 15) + '</button>' +
                '<button class="iconbtn" data-navpin="' + esc(f.username) + '" data-tip="Unpin" aria-label="Unpin ' + esc(f.name) + '">' + icon('close', 15) + '</button>' +
              '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : '<p class="t-body-s c-tertiary navedit__empty">' + (DATA.friends.length
            ? 'Pin the friends you check on most. They get their own spot in the sidebar.'
            : 'Once you have friends, you can pin them here for one-click access.') + '</p>') +
      (free.length
        ? '<div class="navedit__add">' + free.map(function (f) {
            return '<button class="navpick" data-navpin="' + esc(f.username) + '" data-flip="pin:' + esc(f.username) + '"' + (full ? ' disabled' : '') +
              ' aria-label="Pin ' + esc(f.name) + ' to the sidebar">' +
              avatarEl(f.initials, '24', null, f.avatarUrl) + '<span class="t-label-m truncate">' + esc(f.name.split(/\s+/)[0]) + '</span>' + icon('plus', 13) +
            '</button>';
          }).join('') + '</div>'
        : '') +
    '</div>';

  return '<div class="navedit" id="navEditor">' +
    '<div class="navedit__col">' + groups + '</div>' +
    '<div class="navedit__col">' + pins +
      '<p class="t-caption c-tertiary">Drag rows by the handle, or use the arrows. On phones the bottom bar stays as it is.</p>' +
    '</div>' +
  '</div>';
}

/* ---- view -------------------------------------------------------------------- */
function themePreview(kind) {
  return '<div class="preview preview--' + kind + '">' +
    '<div class="preview__rail"><i class="accent" style="width:60%"></i><i></i><i class="w70"></i><i class="w50"></i><i class="w70"></i></div>' +
    '<div class="preview__body"><i class="w50"></i><i class="accent"></i><i class="w85"></i><i class="w70"></i><i class="w85"></i><i class="w50"></i></div>' +
  '</div>';
}

function settingRow(iconName, title, desc, control) {
  return '<div class="setting">' +
    '<span class="c-tertiary">' + icon(iconName, 18) + '</span>' +
    '<div class="setting__meta"><span class="t-body-m-med">' + esc(title) + '</span>' +
    '<span class="t-body-s c-tertiary">' + esc(desc) + '</span></div>' + control +
  '</div>';
}

function rangeControl(key, label, min, max, value, word, ends) {
  return '<div class="slide">' +
    '<div class="slide__head"><label class="t-body-m-med" for="look-' + key + '">' + esc(label) + '</label>' +
      '<output class="t-num c-secondary" id="look-' + key + '-out" for="look-' + key + '">' + esc(word) + '</output></div>' +
    '<input class="range" type="range" id="look-' + key + '" data-look-range="' + key + '" min="' + min + '" max="' + max + '" step="1" value="' + value + '" ' +
      'style="--p:' + ((value - min) / (max - min) * 100).toFixed(1) + '%" aria-valuetext="' + esc(word) + '">' +
    '<div class="slide__ends t-caption c-tertiary"><span>' + esc(ends[0]) + '</span><span>' + esc(ends[1]) + '</span></div>' +
  '</div>';
}

VIEWS.customization = function () {
  const accent = lookPref('accent'), density = lookPref('density'), motion = lookPref('motion');
  const glass = lookPref('glass'), blur = lookPref('blur');

  const themePanel =
    '<section class="panel section">' + sectionHead('Theme') +
      '<div class="section__body section__body--pad"><div class="themegrid">' +
        ['dark', 'light'].map(function (k) {
          return '<button class="themecard" data-theme-pick="' + k + '">' + themePreview(k) +
            '<div class="themecard__foot"><div class="stack" style="gap:2px">' +
              '<span class="t-body-m-med">' + (k === 'dark' ? 'Dark' : 'Light') + '</span>' +
              '<span class="t-caption c-tertiary">' + (k === 'dark' ? 'Warm graphite' : 'Warm paper') + '</span></div>' +
              '<span class="themecard__check">' + icon('check', 13) + '</span>' +
            '</div></button>';
        }).join('') +
      '</div></div>' +
    '</section>';

  const accentPanel =
    '<section class="panel section">' + sectionHead('Accent colour') +
      '<div class="section__body section__body--pad stack stack--sm">' +
        '<div class="swatches" role="radiogroup" aria-label="Accent colour">' + ACCENTS.map(function (a) {
          return '<button class="swatch" role="radio" data-accent-pick="' + a.id + '" aria-checked="' + (a.id === accent) + '" style="--sw-d:' + a.dark + ';--sw-l:' + a.light + '">' +
            '<span class="swatch__disc" aria-hidden="true"></span><span class="t-label-m">' + a.name + '</span></button>';
        }).join('') + '</div>' +
        '<p class="t-body-s c-tertiary">Buttons, highlights, the backdrop glow, your recap card and saved images all follow it.</p>' +
      '</div>' +
    '</section>';

  const surfacePanel =
    '<section class="panel section">' + sectionHead('Glass and blur') +
      '<div class="section__body section__body--pad stack">' +
        '<div class="lens" aria-hidden="true"><i></i><i></i><i></i><div class="lens__glass"><span class="t-label-m">Glass</span></div></div>' +
        rangeControl('glass', 'Glass intensity', 0, 100, glass, glassWord(glass), ['See-through', 'Solid']) +
        rangeControl('blur', 'Background blur', 0, 40, blur, blurWord(blur), ['Off, fastest', 'Soft']) +
      '</div>' +
      '<div class="section__body section__body--flush">' +
        settingRow('sparkle', 'Ambient backdrop', 'The soft drifting lights behind the glass.',
          '<button class="toggle" data-toggle="ambient" aria-checked="true" role="switch" aria-label="Ambient backdrop"></button>') +
      '</div>' +
    '</section>';

  const densityPanel =
    '<section class="panel section">' + sectionHead('Interface density') +
      '<div class="section__body section__body--pad">' +
        '<div class="choices" role="radiogroup" aria-label="Interface density">' + DENSITIES.map(function (d) {
          return '<button class="choice" role="radio" data-density-pick="' + d.id + '" aria-checked="' + (d.id === density) + '">' +
            '<span class="choice__pv choice__pv--' + d.id + '" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' +
            '<span class="t-body-m-med">' + d.name + '</span><span class="t-caption c-tertiary">' + d.hint + '</span></button>';
        }).join('') + '</div>' +
      '</div>' +
    '</section>';

  const motionPanel =
    '<section class="panel section">' + sectionHead('Animations') +
      '<div class="section__body section__body--pad stack stack--sm">' +
        '<div class="motionrow">' +
          '<div class="tabs" role="radiogroup" aria-label="Animations">' + MOTIONS.map(function (m) {
            return '<button class="tab" role="radio" data-motion-pick="' + m.id + '" aria-checked="' + (m.id === motion) + '">' + m.name + '</button>';
          }).join('') + '</div>' +
          '<span class="motionrow__demo" aria-hidden="true"><span class="eq"><i></i><i></i><i></i></span>' +
            '<span class="motionrow__dot"></span></span>' +
        '</div>' +
        '<p class="t-body-s c-tertiary" id="motionHint">' + esc(motionHint(motion)) + '</p>' +
      '</div>' +
    '</section>';

  const sidebarPanel =
    '<section class="panel section">' + sectionHead('Sidebar') +
      '<div class="section__body section__body--flush">' +
        settingRow('bars', 'Compact sidebar', 'Icons only. The chevron at the top of the sidebar does the same.',
          '<button class="toggle" data-toggle="rail" aria-checked="false" role="switch" aria-label="Compact sidebar"></button>') +
      '</div>' +
      '<div class="section__body section__body--pad">' + navEditor() + '</div>' +
    '</section>';

  return wrap(
    pageHead('Make it yours', 'Customization',
      '<button class="btn btn--ghost btn--sm" data-action="look-reset">' + icon('repeat', 15) + 'Reset to defaults</button>'),
    themePanel +
    '<div class="cols cols--half">' +
      '<div class="stack">' + accentPanel + surfacePanel + '</div>' +
      '<div class="stack">' + densityPanel + motionPanel + '</div>' +
    '</div>' +
    sidebarPanel
  );
};

/* Keeps controls in step without re-rendering, so a slider you're dragging
   isn't replaced under your pointer. */
function syncCustomization() {
  const accent = lookPref('accent'), density = lookPref('density'), motion = lookPref('motion');
  document.querySelectorAll('[data-accent-pick]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.accentPick === accent)); });
  document.querySelectorAll('[data-density-pick]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.densityPick === density)); });
  document.querySelectorAll('[data-motion-pick]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.motionPick === motion)); });
  const hint = document.getElementById('motionHint');
  if (hint) hint.textContent = motionHint(motion);
  ['glass', 'blur'].forEach(function (k) {
    const input = document.getElementById('look-' + k);
    if (!input) return;
    const v = lookPref(k);
    if (+input.value !== v) input.value = v;
    input.style.setProperty('--p', ((v - input.min) / (input.max - input.min) * 100).toFixed(1) + '%');
    const word = k === 'glass' ? glassWord(v) : blurWord(v);
    input.setAttribute('aria-valuetext', word);
    document.getElementById('look-' + k + '-out').textContent = word;
  });
}

/* Accent as it reads on a dark surface, for canvas exports. */
function signalColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-signal').trim() || '#FF5C35';
}

function hexAlpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'rgba(255,92,53,' + a + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
