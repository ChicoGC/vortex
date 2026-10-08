/* ==========================================================================
   vortex — Mural: the banner and the widgets on your profile
   Stored as one jsonb value on your profile row (profiles.mural), so it's
   public like your bio. Every field is re-checked on read: the row is written
   by its owner's browser, and anyone can call the API directly.
   ========================================================================== */

const MURAL_MAX = 8;
const MURAL_SIZES = ['s', 'm', 'l'];
const MURAL_SIZE_NAME = { s: t('Small'), m: t('Medium'), l: t('Wide') };

/* Scene banners share their look with the themes of the same name (scenes.css). */
const MURAL_BANNERS = [
  { id: 'glow',   name: t('Equalizer'), hint: t('Your accent colour, in motion') },
  { id: 'covers', name: t('Covers'), hint: t('Made from your mural') },
  { id: 'galaxy', name: t('Galaxy') },
  { id: 'aurora', name: t('Aurora') },
  { id: 'ocean',  name: t('Ocean') },
  { id: 'sunset', name: t('Sunset') },
  { id: 'sakura', name: t('Sakura') },
  { id: 'sky',    name: t('Sky') },
  { id: 'none',   name: t('No banner') }
];

/* size: where a new widget starts. max: how many items it holds. */
const MURAL_TYPES = {
  tracks:  { icon: 'disc',     name: t('Favourite songs'),   hint: t('Up to 5, each with a clip'),       size: 'm', max: 5 },
  artists: { icon: 'users',    name: t('Favourite artists'), hint: t('Up to 6 faces'),                   size: 'm', max: 6 },
  album:   { icon: 'layers',   name: t('Album'),             hint: t('The one you never skip'),          size: 's', max: 1 },
  note:    { icon: 'comment',  name: tx('mural', 'Note'),              hint: t('A few words, up to 160 characters'), size: 's' },
  tags:    { icon: 'sparkle',  name: t('Genres and moods'),  hint: t('Up to 8 tags, in your words'),     size: 's', max: 8 },
  shows:   { icon: 'calendar', name: t('Shows'),             hint: t('Concerts you’ve been to'),         size: 'm', max: 6 }
};
const MURAL_TYPE_ORDER = ['tracks', 'artists', 'album', 'note', 'tags', 'shows'];
const MURAL_SEARCHED = { tracks: true, artists: true, album: true };

/* ---- reading and checking --------------------------------------------------- */
function muralStr(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function muralArr(v, max) { return Array.isArray(v) ? v.slice(0, max * 2) : []; }

function muralYear(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return n >= 1950 && n <= new Date().getFullYear() + 1 ? n : null;
}

/* null when the widget is broken or has nothing in it, so it isn't shown. */
function muralCleanWidget(w) {
  if (!w || typeof w !== 'object' || !MURAL_TYPES.hasOwnProperty(w.type)) return null;
  const type = MURAL_TYPES[w.type];
  const out = {
    type: w.type,
    size: MURAL_SIZES.indexOf(w.size) > -1 ? w.size : type.size,
    title: muralStr(w.title, 40)
  };
  const seen = {};
  const once = function (key) { key = String(key).toLowerCase(); if (seen[key]) return false; seen[key] = true; return true; };
  if (w.type === 'note') {
    out.text = typeof w.text === 'string' ? w.text.trim().slice(0, 160) : '';
    return out.text ? out : null;
  }
  if (w.type === 'tracks') {
    out.items = muralArr(w.items, type.max).filter(function (x) {
      return x && DNA_ID.test(x.id || '') && muralStr(x.title, 200) && muralStr(x.artist, 200) && once(x.id);
    }).slice(0, type.max).map(function (x) {
      return { id: x.id, title: muralStr(x.title, 200), artist: muralStr(x.artist, 200), image: dnaCover(x.image) };
    });
  } else if (w.type === 'artists') {
    out.items = muralArr(w.items, type.max).filter(function (x) {
      return x && DNA_ID.test(x.id || '') && muralStr(x.name, 200) && once(x.id);
    }).slice(0, type.max).map(function (x) {
      return { id: x.id, name: muralStr(x.name, 200), image: dnaCover(x.image) };
    });
  } else if (w.type === 'album') {
    out.items = muralArr(w.items, 1).filter(function (x) {
      return x && DNA_ID.test(x.id || '') && muralStr(x.title, 200) && muralStr(x.artist, 200);
    }).slice(0, 1).map(function (x) {
      return { id: x.id, title: muralStr(x.title, 200), artist: muralStr(x.artist, 200), image: dnaCover(x.image), year: muralYear(x.year) };
    });
  } else if (w.type === 'tags') {
    out.items = muralArr(w.items, type.max).map(function (x) { return muralStr(x, 24); })
      .filter(function (x) { return x && once(x); }).slice(0, type.max);
  } else if (w.type === 'shows') {
    out.items = muralArr(w.items, type.max).filter(function (x) { return x && muralStr(x.artist, 80); })
      .slice(0, type.max).map(function (x) {
        return { artist: muralStr(x.artist, 80), place: muralStr(x.place, 80), year: muralYear(x.year) };
      });
  }
  return out.items.length ? out : null;
}

function muralFromRow(raw) {
  const m = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    banner: MURAL_BANNERS.some(function (b) { return b.id === m.banner; }) ? m.banner : 'glow',
    widgets: muralArr(m.widgets, MURAL_MAX).map(muralCleanWidget).filter(Boolean).slice(0, MURAL_MAX)
  };
}

function myMural() {
  if (!DATA.me.mural) DATA.me.mural = muralFromRow(null);
  return DATA.me.mural;
}

/* ---- banner ----------------------------------------------------------------- */
/* Every cover on the mural, for the Covers banner. */
function muralCovers(m) {
  const out = [];
  m.widgets.forEach(function (w) {
    if (w.type === 'tracks' || w.type === 'album' || w.type === 'artists') {
      w.items.forEach(function (x) { if (x.image && out.indexOf(x.image) < 0) out.push(x.image); });
    }
  });
  return out;
}

/* Two rows of covers sliding past each other. Each row holds its set twice and
   moves by half its width, so the loop never jumps. */
function coverRows(covers) {
  const row = function (offset) {
    const set = [];
    for (let i = 0; i < 12; i++) set.push(covers[(i + offset) % covers.length]);
    const tiles = set.concat(set).map(function (src) {
      return '<i style="background-image:url(' + src + ')"></i>';
    }).join('');
    return '<span class="pbanner__row">' + tiles + '</span>';
  };
  return '<span class="pbanner__rows">' + row(0) + row(Math.ceil(covers.length / 2)) + '</span>';
}

/* The equalizer's skyline, drawn from the owner's id: the same on every visit, different for everyone. */
function eqBars(seed, count) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rnd = function () { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return ((h >>> 0) % 1000) / 1000; };
  let prev = .5;
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = i / (count - 1);
    prev = prev * .4 + rnd() * .6;
    const height = .14 + .86 * prev * (.45 + .55 * Math.sin(Math.PI * x));
    out += '<i style="--h:' + height.toFixed(3) + ';--t:' + (1.3 + rnd() * 1.4).toFixed(2) + 's;--d:-' + (rnd() * 3).toFixed(2) + 's"></i>';
  }
  return '<span class="pbanner__eq">' + out + '</span>';
}

/* The covers banner needs a few covers to look like anything; until then it's the equalizer. */
function muralBannerId(m) {
  return m.banner === 'covers' && muralCovers(m).length < 3 ? 'glow' : m.banner;
}

/* seed: the owner's profile id, for the equalizer. */
function muralBanner(m, seed) {
  const id = muralBannerId(m);
  if (id === 'none') return '';
  return '<div class="pbanner pbanner--' + id + '" aria-hidden="true">' +
    (id === 'covers' ? coverRows(muralCovers(m))
      : '<span></span><span></span>' + (id === 'glow' ? eqBars(seed || '', 64) : '<span></span>')) +
  '</div>';
}

/* ---- widgets ---------------------------------------------------------------- */
function muralSpotifyUrl(kind, id) {
  return DNA_ID.test(id || '') ? 'https://open.spotify.com/' + kind + '/' + id : null;
}

function muralClipButton(owner, track) {
  return '<button type="button" class="post__play mw-track__play" data-clip="mural:' + esc(owner) + ':' + track.id + '" data-clip-track="' + track.id + '" ' +
      'data-clip-start="0" data-clip-len="30" aria-pressed="false" ' +
      'data-tip="' + t('Play clip') + '" aria-label="' + t('Play a clip of {track}', { track: esc(track.title) }) + '">' +
    '<span class="clipicon clipicon--play">' + icon('play', 14) + '</span>' +
    '<span class="clipicon clipicon--pause">' + icon('pause', 14) + '</span>' +
  '</button>';
}

const MURAL_BODY = {
  tracks: function (w, ctx) {
    return '<ol class="mw-tracks">' + w.items.map(function (x) {
      return '<li class="mw-track">' +
        art(artSeedFor(x.id), 'mw-track__cover', x.image) +
        '<a class="mw-track__meta" href="' + muralSpotifyUrl('track', x.id) + '" target="_blank" rel="noopener" data-tip="' + t('Open on Spotify') + '">' +
          '<span class="t-body-m-med truncate">' + esc(x.title) + '</span>' +
          '<span class="t-body-s c-tertiary truncate">' + esc(x.artist) + '</span>' +
        '</a>' +
        muralClipButton(ctx.owner, x) +
      '</li>';
    }).join('') + '</ol>';
  },
  artists: function (w) {
    return '<ul class="mw-artists">' + w.items.map(function (x) {
      return '<li><a class="mw-artist" href="' + muralSpotifyUrl('artist', x.id) + '" target="_blank" rel="noopener">' +
        art(artSeedFor(x.id), 'mw-artist__face', x.image) +
        '<span class="t-label-m truncate">' + esc(x.name) + '</span>' +
      '</a></li>';
    }).join('') + '</ul>';
  },
  album: function (w) {
    const x = w.items[0];
    return '<a class="mw-album" href="' + muralSpotifyUrl('album', x.id) + '" target="_blank" rel="noopener" data-tip="' + t('Open on Spotify') + '">' +
      '<span class="mw-album__sleeve"><span class="mw-album__disc"></span>' + art(artSeedFor(x.id), 'mw-album__cover', x.image) + '</span>' +
      '<span class="mw-album__meta">' +
        '<span class="t-title-s clamp-2">' + esc(x.title) + '</span>' +
        '<span class="t-body-s c-secondary truncate">' + esc(x.artist) + '</span>' +
        (x.year ? '<span class="t-meta c-tertiary">' + x.year + '</span>' : '') +
      '</span>' +
    '</a>';
  },
  note: function (w) {
    return '<p class="mw-note">' + esc(w.text) + '</p>';
  },
  tags: function (w) {
    return '<ul class="mw-tags">' + w.items.map(function (x) { return '<li class="mw-tag">' + esc(x) + '</li>'; }).join('') + '</ul>';
  },
  shows: function (w) {
    return '<ul class="mw-tickets">' + w.items.map(function (x) {
      return '<li class="mw-ticket">' +
        '<span class="mw-ticket__main">' +
          '<span class="t-body-m-med truncate">' + esc(x.artist) + '</span>' +
          (x.place ? '<span class="t-body-s c-tertiary truncate">' + esc(x.place) + '</span>' : '') +
        '</span>' +
        '<span class="mw-ticket__stub t-num">' + (x.year || '—') + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }
};

function muralWidgetTitle(w) { return w.title || MURAL_TYPES[w.type].name; }

/* ctx: { owner: profile id, edit: true on the Mural page, count: widgets on the board } */
function muralWidget(w, i, ctx) {
  const tools = ctx.edit
    ? '<footer class="mw__tools">' +
        '<button class="iconbtn iconbtn--xs" data-mural-move="' + i + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') + ' data-tip="' + t('Move earlier') + '" aria-label="' + t('Move {name} earlier', { name: esc(muralWidgetTitle(w)) }) + '">' + icon('chevronLeft', 15) + '</button>' +
        '<button class="iconbtn iconbtn--xs" data-mural-move="' + i + '" data-dir="1"' + (i === ctx.count - 1 ? ' disabled' : '') + ' data-tip="' + t('Move later') + '" aria-label="' + t('Move {name} later', { name: esc(muralWidgetTitle(w)) }) + '">' + icon('chevronRight', 15) + '</button>' +
        '<button class="mw__size t-label-s" data-mural-size="' + i + '" data-tip="' + t('Size: {size}', { size: MURAL_SIZE_NAME[w.size] }) + '" aria-label="' + t('Change size, now {size}', { size: MURAL_SIZE_NAME[w.size] }) + '">' +
          MURAL_SIZES.map(function (s) { return '<i' + (s === w.size ? ' class="on"' : '') + '></i>'; }).join('') + '</button>' +
        '<span class="mw__spacer"></span>' +
        '<button class="iconbtn iconbtn--xs" data-mural-edit="' + i + '" data-tip="' + t('Edit') + '" aria-label="' + t('Edit {name}', { name: esc(muralWidgetTitle(w)) }) + '">' + icon('sliders', 15) + '</button>' +
        '<button class="iconbtn iconbtn--xs" data-mural-remove="' + i + '" data-tip="' + t('Remove') + '" aria-label="' + tx('mural', 'Remove {name}', { name: esc(muralWidgetTitle(w)) }) + '">' + icon('trash', 15) + '</button>' +
      '</footer>'
    : '';
  return '<article class="panel mw mw--' + w.type + ' mw--' + w.size + '" data-mw="' + i + '">' +
    '<header class="mw__head">' +
      '<span class="mw__icon">' + icon(MURAL_TYPES[w.type].icon, 14) + '</span>' +
      '<h3 class="t-label-m truncate">' + esc(muralWidgetTitle(w)) + '</h3>' +
    '</header>' +
    '<div class="mw__body">' + MURAL_BODY[w.type](w, ctx) + '</div>' + tools +
  '</article>';
}

function muralBoard(m, ctx) {
  ctx.count = m.widgets.length;
  return '<div class="mural' + (ctx.edit ? ' mural--edit' : '') + '" id="' + (ctx.edit ? 'muralBoard' : '') + '">' +
    m.widgets.map(function (w, i) { return muralWidget(w, i, ctx); }).join('') +
  '</div>';
}

/* On a profile: the board, or for your own empty one an invitation to start it. */
function muralProfileSection(m, ownerId, own) {
  if (!m.widgets.length) {
    return own
      ? '<a class="mural-invite" href="#/mural">' +
          '<span class="mural-invite__art" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
          '<span class="mural-invite__meta">' +
            '<span class="t-body-m-med">' + t('Build your mural') + '</span>' +
            '<span class="t-body-s c-tertiary">' + t('Favourite songs, artists, an album, the shows you’ve been to. It sits right here on your profile.') + '</span>' +
          '</span>' +
          '<span class="btn btn--primary btn--sm">' + icon('layers', 15) + t('Open Mural') + '</span>' +
        '</a>'
      : '';
  }
  return '<section class="mural-wrap">' +
    '<div class="mural-wrap__head"><h2 class="t-title-s">' + t('Mural') + '</h2>' +
      (own ? '<a class="btn btn--ghost btn--sm" href="#/mural">' + icon('sliders', 14) + t('Edit mural') + '</a>' : '') +
    '</div>' +
    muralBoard(m, { owner: ownerId, edit: false }) +
  '</section>';
}

/* ---- the Mural page ----------------------------------------------------------- */
const MURAL = {
  status: 'idle',      // idle | saving | saved | error
  timer: null,
  seq: 0,
  edit: null,          // { index (-1 for a new one), w, results, searchSeq }
  undo: null           // { w, index } for the last widget removed
};

function muralStatusMarkup() {
  const s = MURAL.status;
  if (s === 'saving') return '<span class="mural-status" data-state="saving">' + t('Saving…') + '</span>';
  if (s === 'saved') return '<span class="mural-status" data-state="saved">' + icon('check', 13) + t('Saved') + '</span>';
  if (s === 'error') return '<button class="mural-status" data-state="error" data-mural-retry>' + icon('repeat', 13) + t('Not saved. Retry') + '</button>';
  return '<span class="mural-status" data-state="idle">' + t('Changes save on their own') + '</span>';
}

function muralPreviewHead(m) {
  const me = DATA.me;
  return '<section class="panel phead' + (muralBannerId(m) === 'none' ? '' : ' phead--banner') + '" id="muralPreview">' +
    muralBanner(m, app.session.user.id) +
    '<div class="phead__row">' +
      avatarEl(me.initials, '72', null, me.avatarUrl) +
      '<div class="phead__who">' +
        '<span class="t-title-m truncate">' + esc(me.name) + '</span>' +
        '<span class="t-meta c-tertiary">' + esc(me.username) + '</span>' +
      '</div>' +
    '</div>' +
  '</section>';
}

function muralBoardOrEmpty(m) {
  if (m.widgets.length) return muralBoard(m, { owner: app.session.user.id, edit: true });
  return '<div class="mural-empty" id="muralBoard">' +
    '<span class="mural-empty__grid" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' +
    '<span class="t-body-m-med">' + t('Your mural is empty') + '</span>' +
    '<span class="t-body-s c-tertiary">' + t('Pick a widget to put the first thing on it. It shows on your profile for anyone who visits.') + '</span>' +
  '</div>';
}

function muralBannerPicker(m) {
  return '<section class="panel section">' + sectionHead(t('Banner')) +
    '<div class="section__body section__body--pad">' +
      '<div class="bannergrid" role="radiogroup" aria-label="' + t('Banner') + '">' + MURAL_BANNERS.map(function (b) {
        const covers = b.id === 'covers' ? muralCovers(m) : null;
        const preview = b.id === 'none' ? '<span class="bannerpick__none">' + icon('close', 16) + '</span>'
          : b.id === 'covers' && covers.length >= 3 ? '<span class="pbanner pbanner--covers">' + coverRows(covers) + '</span>'
          : b.id === 'glow' ? '<span class="pbanner pbanner--glow"><span></span><span></span>' + eqBars(app.session.user.id, 26) + '</span>'
          : '<span class="pbanner pbanner--' + (b.id === 'covers' ? 'covers-empty' : b.id) + '"><span></span><span></span><span></span></span>';
        return '<button class="bannerpick" role="radio" data-mural-banner="' + b.id + '" aria-checked="' + (b.id === m.banner) + '">' +
          '<span class="bannerpick__pv" aria-hidden="true">' + preview + '</span>' +
          '<span class="t-label-m">' + b.name + '</span>' +
          (b.hint ? '<span class="t-caption c-tertiary">' + b.hint + '</span>' : '') +
        '</button>';
      }).join('') + '</div>' +
      (m.banner === 'covers' && muralCovers(m).length < 3
        ? '<p class="t-body-s c-tertiary" style="margin-top:12px">' + t('Covers needs at least 3 covers on your mural. Until then it shows the equalizer.') + '</p>' : '') +
    '</div>' +
  '</section>';
}

function muralPalette(m) {
  const full = m.widgets.length >= MURAL_MAX;
  return '<section class="panel section">' + sectionHead(t('Add a widget'), t('{count} of {max}', { count: m.widgets.length, max: MURAL_MAX })) +
    '<div class="section__body section__body--pad">' +
      '<div class="widgetpick">' + MURAL_TYPE_ORDER.map(function (k) {
        const type = MURAL_TYPES[k];
        const needsSpotify = MURAL_SEARCHED[k] && !spotify.auth.isConnected();
        return '<button class="widgetpick__item" data-mural-add="' + k + '"' + (full ? ' disabled' : '') + '>' +
          '<span class="widgetpick__icon">' + icon(type.icon, 17) + '</span>' +
          '<span class="widgetpick__meta">' +
            '<span class="t-body-m-med">' + type.name + '</span>' +
            '<span class="t-caption c-tertiary">' + (needsSpotify ? t('Needs Spotify connected') : type.hint) + '</span>' +
          '</span>' +
          '<span class="widgetpick__plus">' + icon('plus', 15) + '</span>' +
        '</button>';
      }).join('') + '</div>' +
      (full ? '<p class="t-body-s c-tertiary" style="margin-top:12px">' + t('Your mural is full. Remove a widget to add another.') + '</p>' : '') +
    '</div>' +
  '</section>';
}

VIEWS.mural = function () {
  const m = myMural();
  const actions =
    '<span id="muralStatus">' + muralStatusMarkup() + '</span>' +
    '<a class="btn btn--secondary btn--sm" href="#/profile">' + icon('user', 15) + t('See on profile') + '</a>';
  return wrap(pageHead(t('Your profile, your way'), t('Mural'), actions),
    '<div class="mural-layout">' +
      '<div class="stack" id="muralMain">' + muralPreviewHead(m) + muralBoardOrEmpty(m) + '</div>' +
      '<aside class="stack mural-side" id="muralSide">' + muralBannerPicker(m) + muralPalette(m) + '</aside>' +
    '</div>');
};

/* Repaints the page in place, so the scroll position and the rest of the view stay put.
   focusSel: a control to put focus back on, since the old one was replaced. */
function paintMural(focusSel) {
  if (app.view !== 'mural') return;
  const m = myMural();
  const main = document.getElementById('muralMain');
  const side = document.getElementById('muralSide');
  if (main) main.innerHTML = muralPreviewHead(m) + muralBoardOrEmpty(m);
  if (side) side.innerHTML = muralBannerPicker(m) + muralPalette(m);
  if (focusSel) {
    const el = document.querySelector(focusSel);
    if (el && !el.disabled) el.focus();
  }
}

function paintMuralStatus() {
  const el = document.getElementById('muralStatus');
  if (el) el.innerHTML = muralStatusMarkup();
}

/* ---- saving --------------------------------------------------------------------- */
/* Changes batch up for a moment, then go out as one write. */
function muralChanged(focusSel) {
  paintMural(focusSel);
  clearTimeout(MURAL.timer);
  MURAL.status = 'saving';
  paintMuralStatus();
  MURAL.timer = setTimeout(saveMural, 700);
}

async function saveMural() {
  const seq = ++MURAL.seq;
  const value = JSON.parse(JSON.stringify(myMural()));
  try {
    const row = await db.profiles.update(app.session.user.id, { mural: value });
    if (seq !== MURAL.seq) return;
    rememberProfile(row);
    MURAL.status = 'saved';
  } catch (err) {
    if (seq !== MURAL.seq) return;
    console.error('Could not save the mural:', err);
    MURAL.status = 'error';
    toast('muralFailed');
  }
  paintMuralStatus();
}

/* ---- editing a widget ------------------------------------------------------------ */
function muralBlank(type) {
  const w = { type: type, size: MURAL_TYPES[type].size, title: '' };
  if (type === 'note') w.text = '';
  else w.items = type === 'shows' ? [{ artist: '', place: '', year: '' }] : [];
  return w;
}

function openMuralEditor(type, index) {
  const existing = index > -1 ? myMural().widgets[index] : null;
  if (!existing && myMural().widgets.length >= MURAL_MAX) return;
  const w = existing ? JSON.parse(JSON.stringify(existing)) : muralBlank(type);
  if (w.type === 'shows') w.items.forEach(function (x) { if (x.year == null) x.year = ''; });
  MURAL.edit = { index: index, w: w, results: [], searchSeq: 0, timer: null };
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML = muralEditorMarkup();
  const first = document.getElementById('muralSearch') || document.getElementById('muralText') ||
    document.getElementById('muralTag') || document.querySelector('[data-mural-show-field]') || document.getElementById('muralTitle');
  if (first) first.focus();
}

function muralField(id, label, control) {
  return '<div class="auth__field"><label class="t-label-m c-secondary" for="' + id + '">' + label + '</label>' + control + '</div>';
}

function muralEditorBody(w) {
  const type = MURAL_TYPES[w.type];
  if (MURAL_SEARCHED[w.type]) {
    const placeholder = { tracks: t('Search for a song'), artists: t('Search for an artist'), album: t('Search for an album') }[w.type];
    return (spotify.auth.isConnected()
      ? muralField('muralSearch', w.type === 'album' ? t('Find the album') : t('Add from Spotify'),
          '<span class="field">' + icon('search', 17) + '<input id="muralSearch" type="search" placeholder="' + placeholder + '" autocomplete="off" maxlength="100"></span>' +
          '<div class="post-search" id="muralResults"></div>')
      : '<div class="auth__note mural-connect">' + icon('spotify', 16) + '<p class="t-body-s c-secondary">' +
          t('Connect Spotify to search for songs, artists and albums.') + '</p>' +
          '<button type="button" class="btn btn--primary btn--sm" data-action="spotify-connect">' + t('Connect Spotify') + '</button></div>') +
      '<div class="stack stack--sm" id="muralPicked">' + muralPickedMarkup(w) + '</div>';
  }
  if (w.type === 'note') {
    return muralField('muralText', t('Your note'),
      '<span class="field field--area">' + icon('comment', 17) +
        '<textarea id="muralText" maxlength="160" rows="3" placeholder="' + t('What’s on repeat in your head?') + '">' + esc(w.text) + '</textarea></span>' +
      '<span class="t-caption c-tertiary mural-count" id="muralTextCount">' + w.text.length + '/160</span>');
  }
  if (w.type === 'tags') {
    return muralField('muralTag', t('Add a tag'),
      '<span class="field">' + icon('sparkle', 17) + '<input id="muralTag" type="text" placeholder="' + t('shoegaze, late-night drives…') + '" maxlength="24" autocomplete="off">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-mural-tag-add>' + t('Add') + '</button></span>') +
      '<div id="muralPicked">' + muralPickedMarkup(w) + '</div>';
  }
  // shows
  return '<div class="stack stack--sm" id="muralPicked">' + muralPickedMarkup(w) + '</div>';
}

function muralPickedMarkup(w) {
  const type = MURAL_TYPES[w.type];
  if (w.type === 'tags') {
    return w.items.length
      ? '<ul class="mw-tags mw-tags--edit">' + w.items.map(function (x, i) {
          return '<li class="mw-tag">' + esc(x) +
            '<button type="button" data-mural-item-remove="' + i + '" aria-label="' + tx('mural', 'Remove {name}', { name: esc(x) }) + '">' + icon('close', 12) + '</button></li>';
        }).join('') + '</ul>'
      : '<p class="t-body-s c-tertiary">' + t('Up to 8 tags. Press Enter after each one.') + '</p>';
  }
  if (w.type === 'shows') {
    return w.items.map(function (x, i) {
      return '<div class="showrow">' +
        '<span class="field">' + '<input data-mural-show-field="artist" data-i="' + i + '" type="text" maxlength="80" placeholder="' + t('Artist') + '" aria-label="' + t('Artist') + '" value="' + esc(x.artist) + '"></span>' +
        '<span class="field">' + '<input data-mural-show-field="place" data-i="' + i + '" type="text" maxlength="80" placeholder="' + t('City or venue') + '" aria-label="' + t('City or venue') + '" value="' + esc(x.place) + '"></span>' +
        '<span class="field showrow__year">' + '<input data-mural-show-field="year" data-i="' + i + '" type="text" inputmode="numeric" maxlength="4" placeholder="' + t('Year') + '" aria-label="' + t('Year') + '" value="' + esc(x.year) + '"></span>' +
        '<button type="button" class="iconbtn" data-mural-item-remove="' + i + '" data-tip="' + t('Remove') + '" aria-label="' + t('Remove this show') + '">' + icon('close', 15) + '</button>' +
      '</div>';
    }).join('') +
    (w.items.length < type.max
      ? '<button type="button" class="btn btn--ghost btn--sm showrow__add" data-mural-show-add>' + icon('plus', 14) + t('Add a show') + '</button>'
      : '');
  }
  if (!w.items.length) {
    return '<p class="t-body-s c-tertiary">' + (w.type === 'album' ? t('Pick one album from the search.') : t('Nothing picked yet. Up to {max}.', { max: type.max })) + '</p>';
  }
  return '<span class="t-label-s c-tertiary">' + (w.type === 'album' ? t('Picked') : t('{count} of {max}', { count: w.items.length, max: type.max })) + '</span>' +
    w.items.map(function (x, i) {
      const name = x.title || x.name;
      return '<div class="post-picked mural-picked">' +
        art(artSeedFor(x.id), w.type === 'artists' ? 'art--round' : null, x.image) +
        '<span class="t-body-s c-secondary truncate"><span class="c-primary">' + esc(name) + '</span>' + (x.artist ? ' · ' + esc(x.artist) : '') + '</span>' +
        (w.items.length > 1
          ? '<button type="button" class="iconbtn iconbtn--xs" data-mural-item-move="' + i + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="' + t('Move {name} up', { name: esc(name) }) + '">' + icon('chevronUp', 14) + '</button>' +
            '<button type="button" class="iconbtn iconbtn--xs" data-mural-item-move="' + i + '" data-dir="1"' + (i === w.items.length - 1 ? ' disabled' : '') + ' aria-label="' + t('Move {name} down', { name: esc(name) }) + '">' + icon('chevronDown', 14) + '</button>'
          : '') +
        '<button type="button" class="iconbtn iconbtn--xs" data-mural-item-remove="' + i + '" aria-label="' + tx('mural', 'Remove {name}', { name: esc(name) }) + '">' + icon('close', 14) + '</button>' +
      '</div>';
    }).join('');
}

function muralEditorMarkup() {
  const e = MURAL.edit;
  const w = e.w;
  const type = MURAL_TYPES[w.type];
  return '<div class="scrim" data-scrim>' +
    '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="muralFormTitle">' +
      '<div class="modal__head">' +
        '<span class="toast__well toast__well--info">' + icon(type.icon, 15) + '</span>' +
        '<h2 class="t-title-s" id="muralFormTitle">' + type.name + '</h2>' +
      '</div>' +
      '<form id="muralForm" class="modal__body" novalidate>' +
        '<div class="auth__note auth__note--error" id="muralError" hidden>' + icon('close', 16) +
          '<p class="t-body-s c-secondary" id="muralErrorText"></p></div>' +
        muralField('muralTitle', t('Title'),
          '<span class="field">' + icon('pin', 17) + '<input id="muralTitle" type="text" maxlength="40" autocomplete="off" placeholder="' + esc(type.name) + '" value="' + esc(w.title) + '"></span>') +
        muralEditorBody(w) +
      '</form>' +
      '<div class="modal__foot">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-close>' + t('Cancel') + '</button>' +
        '<button type="submit" class="btn btn--primary btn--sm" form="muralForm">' +
          (e.index > -1 ? icon('check', 15) + t('Save widget') : icon('plus', 15) + t('Add to mural')) + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function paintMuralPicked() {
  const el = document.getElementById('muralPicked');
  if (el && MURAL.edit) el.innerHTML = muralPickedMarkup(MURAL.edit.w);
  paintMuralResults();
}

function paintMuralResults() {
  const box = document.getElementById('muralResults');
  const e = MURAL.edit;
  if (!box || !e) return;
  if (e.results === null) { box.innerHTML = '<p class="t-body-s c-tertiary">' + t('Spotify search failed. Try again in a moment.') + '</p>'; return; }
  if (e.results === 'none') { box.innerHTML = '<p class="t-body-s c-tertiary">' + t('Nothing found on Spotify.') + '</p>'; return; }
  const picked = {};
  e.w.items.forEach(function (x) { picked[x.id] = true; });
  box.innerHTML = e.results.map(function (x, i) {
    const name = x.title || x.name;
    const sub = e.w.type === 'album' ? x.artist + (x.year ? ' · ' + x.year : '') : x.artist || '';
    return '<button type="button" class="row post-search__row" data-mural-pick="' + i + '" aria-pressed="' + !!picked[x.id] + '">' +
      art(artSeedFor(x.id), e.w.type === 'artists' ? 'art--round' : null, x.image) +
      '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(name) + '</span>' +
        (sub ? '<span class="t-body-s c-tertiary truncate">' + esc(sub) + '</span>' : '') + '</span>' +
      '<span class="mural-pickmark">' + icon(picked[x.id] ? 'check' : 'plus', 15) + '</span>' +
    '</button>';
  }).join('');
}

async function runMuralSearch(query) {
  const e = MURAL.edit;
  if (!e) return;
  const seq = ++e.searchSeq;
  const box = document.getElementById('muralResults');
  if (query.trim().length < 2) { e.results = []; if (box) box.innerHTML = ''; return; }
  const find = { tracks: spotify.searchTracks, artists: spotify.searchArtists, album: spotify.searchAlbums }[e.w.type];
  try {
    const found = await find.call(spotify, query, 6);
    if (MURAL.edit !== e || seq !== e.searchSeq) return;
    e.results = found.filter(function (x) { return DNA_ID.test(x.id || ''); }).map(function (x) {
      return e.w.type === 'tracks'
        ? { id: x.id, title: x.title, artist: x.artist, image: dnaCover(x.thumb) }
        : Object.assign({}, x, { image: dnaCover(x.image) });
    });
    if (!e.results.length) e.results = 'none';
  } catch (err) {
    if (MURAL.edit !== e || seq !== e.searchSeq) return;
    console.error('Spotify search failed:', err);
    e.results = null;
  }
  paintMuralResults();
}

function muralEditorError(text) {
  const box = document.getElementById('muralError');
  if (!box) return;
  document.getElementById('muralErrorText').textContent = text;
  box.hidden = !text;
}

function addMuralTag() {
  const input = document.getElementById('muralTag');
  const e = MURAL.edit;
  if (!input || !e) return;
  const tag = muralStr(input.value, 24);
  if (!tag) return;
  const dupe = e.w.items.some(function (x) { return x.toLowerCase() === tag.toLowerCase(); });
  if (!dupe && e.w.items.length >= MURAL_TYPES.tags.max) {
    muralEditorError(t('That’s the most this widget holds. Remove one to add another.'));
    return;
  }
  if (!dupe) e.w.items.push(tag);
  input.value = '';
  muralEditorError('');
  paintMuralPicked();
  input.focus();
}

function commitMuralEditor() {
  const e = MURAL.edit;
  if (!e) return;
  const title = document.getElementById('muralTitle');
  if (title) e.w.title = title.value;
  const tagInput = document.getElementById('muralTag');
  if (tagInput && tagInput.value.trim()) addMuralTag();
  const clean = muralCleanWidget(e.w);
  if (!clean) {
    muralEditorError({
      tracks: t('Pick at least one song.'), artists: t('Pick at least one artist.'), album: t('Pick an album.'),
      note: t('Write something first.'), tags: t('Add at least one tag.'), shows: t('Add at least one show with the artist’s name.')
    }[e.w.type]);
    return;
  }
  const m = myMural();
  let index = e.index;
  if (index > -1 && m.widgets[index]) m.widgets[index] = clean;
  else { m.widgets.push(clean); index = m.widgets.length - 1; }
  MURAL.edit = null;
  closeOverlay();
  muralChanged('[data-mural-edit="' + index + '"]');
  const added = document.querySelector('[data-mw="' + index + '"]');
  if (added) {
    added.classList.add('mw--fresh');
    added.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/* ---- board actions ------------------------------------------------------------------ */
function moveMuralWidget(i, dir) {
  const ws = myMural().widgets;
  const j = i + dir;
  if (j < 0 || j >= ws.length) return;
  const w = ws.splice(i, 1)[0];
  ws.splice(j, 0, w);
  muralChanged('[data-mural-move="' + j + '"][data-dir="' + dir + '"]');
}

function resizeMuralWidget(i) {
  const w = myMural().widgets[i];
  if (!w) return;
  w.size = MURAL_SIZES[(MURAL_SIZES.indexOf(w.size) + 1) % MURAL_SIZES.length];
  muralChanged('[data-mural-size="' + i + '"]');
}

function removeMuralWidget(i) {
  const ws = myMural().widgets;
  if (!ws[i]) return;
  MURAL.undo = { w: ws.splice(i, 1)[0], index: i };
  muralChanged(ws.length ? '[data-mural-edit="' + Math.min(i, ws.length - 1) + '"]' : '[data-mural-add="tracks"]');
  showToast(
    '<span class="toast__well toast__well--info">' + icon('trash', 15) + '</span>' +
    '<span class="toast__body">' +
      '<span class="t-label-m">' + esc(t('Widget removed')) + '</span>' +
      '<span class="t-caption c-tertiary">' + esc(muralWidgetTitle(MURAL.undo.w)) + '</span>' +
    '</span>' +
    '<button class="btn btn--secondary btn--sm" data-mural-undo>' + t('Undo') + '</button>');
}

function undoMuralRemove(btn) {
  const u = MURAL.undo;
  const ws = myMural().widgets;
  MURAL.undo = null;
  const toastEl = btn.closest('.toast');
  if (toastEl) toastEl.remove();
  if (!u || ws.length >= MURAL_MAX) return;
  ws.splice(Math.min(u.index, ws.length), 0, u.w);
  muralChanged('[data-mural-edit="' + Math.min(u.index, ws.length - 1) + '"]');
}

/* ---- events -------------------------------------------------------------------------- */
document.addEventListener('click', function (ev) {
  const el = ev.target.closest && ev.target.closest(
    '[data-mural-banner], [data-mural-add], [data-mural-move], [data-mural-size], [data-mural-edit], [data-mural-remove], ' +
    '[data-mural-undo], [data-mural-retry], [data-mural-pick], [data-mural-item-remove], [data-mural-item-move], ' +
    '[data-mural-tag-add], [data-mural-show-add]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  const e = MURAL.edit;

  if ('muralBanner' in d) {
    const m = myMural();
    if (m.banner === d.muralBanner) return;
    m.banner = d.muralBanner;
    muralChanged('[data-mural-banner="' + d.muralBanner + '"]');
    return;
  }
  if ('muralAdd' in d) { openMuralEditor(d.muralAdd, -1); return; }
  if ('muralMove' in d) { moveMuralWidget(+d.muralMove, +d.dir); return; }
  if ('muralSize' in d) { resizeMuralWidget(+d.muralSize); return; }
  if ('muralEdit' in d) { const w = myMural().widgets[+d.muralEdit]; if (w) openMuralEditor(w.type, +d.muralEdit); return; }
  if ('muralRemove' in d) { removeMuralWidget(+d.muralRemove); return; }
  if ('muralUndo' in d) { undoMuralRemove(el); return; }
  if ('muralRetry' in d) { MURAL.status = 'saving'; paintMuralStatus(); saveMural(); return; }
  if (!e) return;

  if ('muralPick' in d) {
    const x = Array.isArray(e.results) ? e.results[+d.muralPick] : null;
    if (!x) return;
    const at = e.w.items.findIndex(function (y) { return y.id === x.id; });
    if (at > -1) e.w.items.splice(at, 1);
    else if (e.w.type === 'album') e.w.items = [x];
    else if (e.w.items.length < MURAL_TYPES[e.w.type].max) e.w.items.push(x);
    else { muralEditorError(t('That’s the most this widget holds. Remove one to add another.')); return; }
    muralEditorError('');
    paintMuralPicked();
    const again = document.querySelector('[data-mural-pick="' + d.muralPick + '"]');
    if (again) again.focus();
    return;
  }
  if ('muralItemRemove' in d) {
    if (e.w.type === 'shows') readShowFields();
    e.w.items.splice(+d.muralItemRemove, 1);
    paintMuralPicked();
    return;
  }
  if ('muralItemMove' in d) {
    const i = +d.muralItemMove, j = i + (+d.dir);
    if (j < 0 || j >= e.w.items.length) return;
    e.w.items.splice(j, 0, e.w.items.splice(i, 1)[0]);
    paintMuralPicked();
    const moved = document.querySelector('[data-mural-item-move="' + j + '"][data-dir="' + d.dir + '"]');
    if (moved && !moved.disabled) moved.focus();
    return;
  }
  if ('muralTagAdd' in d) { addMuralTag(); return; }
  if ('muralShowAdd' in d) {
    readShowFields();
    if (e.w.items.length < MURAL_TYPES.shows.max) e.w.items.push({ artist: '', place: '', year: '' });
    paintMuralPicked();
    const fields = document.querySelectorAll('[data-mural-show-field="artist"]');
    if (fields.length) fields[fields.length - 1].focus();
  }
});

/* The show rows are re-drawn on add and remove, so what's typed is read back first. */
function readShowFields() {
  const e = MURAL.edit;
  if (!e) return;
  document.querySelectorAll('[data-mural-show-field]').forEach(function (input) {
    const x = e.w.items[+input.dataset.i];
    if (x) x[input.dataset.muralShowField] = input.value;
  });
}

document.addEventListener('input', function (ev) {
  const e = MURAL.edit;
  if (!e) return;
  const el = ev.target;
  if (el.id === 'muralSearch') {
    clearTimeout(e.timer);
    e.timer = setTimeout(function () { runMuralSearch(el.value); }, 300);
  } else if (el.id === 'muralText') {
    e.w.text = el.value;
    const count = document.getElementById('muralTextCount');
    if (count) count.textContent = el.value.length + '/160';
  } else if (el.dataset && el.dataset.muralShowField) {
    if (el.dataset.muralShowField === 'year') el.value = el.value.replace(/\D/g, '');
    const x = e.w.items[+el.dataset.i];
    if (x) x[el.dataset.muralShowField] = el.value;
  }
});

document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Enter' || !MURAL.edit) return;
  if (ev.target.id === 'muralTag') { ev.preventDefault(); addMuralTag(); }
  else if (ev.target.id === 'muralSearch') { ev.preventDefault(); clearTimeout(MURAL.edit.timer); runMuralSearch(ev.target.value); }
});

document.addEventListener('submit', function (ev) {
  if (ev.target.id !== 'muralForm') return;
  ev.preventDefault();
  commitMuralEditor();
});
