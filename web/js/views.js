/* ==========================================================================
   vortex — view rendering
   Every view returns an HTML string. Interactivity is wired by delegation
   in app.js, so views stay pure.
   ========================================================================== */

/* ---- helpers ------------------------------------------------------------ */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function cx() {
  return Array.prototype.filter.call(arguments, Boolean).join(' ');
}
/* Only plain https URLs reach the style attribute, so a crafted value can't
   break out of url(...). */
function artImageStyle(image) {
  if (typeof image !== 'string' || !/^https:\/\/[\w.-]+\/[\w\-./%]+$/.test(image)) return '';
  return 'background-image:url(' + image + ');background-size:cover;background-position:center;';
}
function art(n, cls, image) {
  const style = artImageStyle(image);
  return '<div class="' + cx('art', cls) + '" data-art="' + n + '"' + (style ? ' style="' + style + '"' : '') + ' aria-hidden="true"></div>';
}
function avatarEl(initials, size, status) {
  const cls = cx('avatar', size ? 'avatar--' + size : null);
  return '<div class="' + cls + '"' + (status ? ' data-status="' + status + '"' : '') + '>' + esc(initials) + '</div>';
}
function mmss(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function sectionHead(title, meta, tools) {
  return '<div class="section__head">' +
    '<h2 class="t-title-s">' + esc(title) +
    (meta ? '<span class="t-caption c-tertiary">' + esc(meta) + '</span>' : '') +
    '</h2>' +
    (tools ? '<div class="section__tools">' + tools + '</div>' : '') +
    '</div>';
}
function tabsEl(name, items, active) {
  return '<div class="tabs" role="tablist" data-tabs="' + name + '">' + items.map(function (t) {
    return '<button class="tab" role="tab" data-tab="' + esc(t) + '" aria-selected="' + (t === active) + '">' + esc(t) + '</button>';
  }).join('') + '</div>';
}
function iconBtn(name, tip, cls, size) {
  return '<button class="' + cx('iconbtn', cls) + '" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' +
    icon(name, size || 17) + '</button>';
}

/* ---- shared pieces ------------------------------------------------------ */
function musicRow(t, i, opts) {
  opts = opts || {};
  const playing = !!t.playing;
  const lead = playing
    ? '<span class="eq" aria-label="Playing"><i></i><i></i><i></i></span>'
    : '<span class="row__index">' + String(i + 1).padStart(2, '0') + '</span>';
  return '<button class="row" data-playing="' + playing + '" data-play-track="' + esc(t.title) + '">' +
    lead +
    art(t.art) +
    '<span class="row__meta">' +
      '<span class="row__title t-body-m-med truncate">' + esc(t.title) + '</span>' +
      '<span class="t-body-s c-tertiary truncate">' + esc(t.artist) + (opts.album !== false ? ' · ' + esc(t.album || '') : '') + '</span>' +
    '</span>' +
    '<span class="row__actions">' +
      '<span class="iconbtn" data-like>' + icon('heart', 17) + '</span>' +
      '<span class="iconbtn" data-menu="track">' + icon('dots', 17) + '</span>' +
    '</span>' +
    '<span class="row__time">' + esc(t.len) + '</span>' +
  '</button>';
}

function friendRow(f) {
  const sub = f.status === 'listening'
    ? '<span class="friend__sub">' + icon('broadcast', 12) +
      '<span class="t-body-s c-tertiary truncate">' + esc(f.track) + ' · ' + esc(f.artist) + '</span></span>'
    : '<span class="t-body-s c-tertiary truncate">' + (f.status === 'online' ? 'Online · ' : '') + 'Last played ' + esc(f.time) + '</span>';
  return '<button class="friend" data-friend="' + esc(f.id) + '">' +
    avatarEl(f.initials, '32', f.status === 'offline' ? null : f.status) +
    '<span class="friend__meta">' +
      '<span class="t-body-m-med truncate">' + esc(f.name) + '</span>' + sub +
    '</span>' +
    (f.status === 'listening' ? art(f.art, 'art--sm art--alt') : '<span class="t-meta c-tertiary">' + esc(f.time) + '</span>') +
  '</button>';
}

const UI = { openComments: {} };

function commentsBlock(p) {
  const list = p.comments.length
    ? p.comments.map(function (c) {
        return '<div class="comment">' +
          avatarEl(c.initials, '24') +
          '<div class="comment__body">' +
            '<span class="comment__who"><span class="t-label-m truncate">' + esc(c.user) + '</span>' +
            '<span class="t-meta c-tertiary">' + esc(c.time) + '</span></span>' +
            '<p class="t-body-s c-secondary">' + esc(c.text) + '</p>' +
          '</div>' +
        '</div>';
      }).join('')
    : '<p class="t-body-s c-tertiary">No comments yet. Say something.</p>';
  return '<div class="post__comments">' +
    '<div class="post__comment-list">' + list + '</div>' +
    '<form class="post__comment-form" data-comment-form="' + esc(p.id) + '" novalidate>' +
      '<span class="field field--sm">' +
        '<input type="text" name="content" placeholder="Write a comment…" maxlength="500" autocomplete="off" aria-label="Write a comment">' +
      '</span>' +
      '<button type="submit" class="btn btn--primary btn--sm">Send</button>' +
    '</form>' +
  '</div>';
}

function postCard(p) {
  const total = p.reactions.flame + p.reactions.heart;
  const open = !!UI.openComments[p.id];
  return '<article class="panel post" data-post="' + esc(p.id) + '">' +
    '<div class="post__head">' +
      avatarEl(p.initials, '32', 'listening') +
      '<span class="post__who">' +
        '<span class="t-body-m-med truncate">' + esc(p.user) + '</span>' +
        '<span class="t-meta c-tertiary">' + esc(p.time) + '</span>' +
      '</span>' +
      '<span class="spacer"></span>' +
      '<span class="iconbtn" data-tip="' + esc(PLATFORM_LABEL[p.platform]) + '">' + icon(p.platform, 16) + '</span>' +
      (p.mine
        ? '<button class="iconbtn" data-delete-post="' + esc(p.id) + '" data-tip="Delete post" aria-label="Delete post">' + icon('trash', 16) + '</button>'
        : '<button class="iconbtn" data-menu="post" aria-label="More">' + icon('dots', 16) + '</button>') +
    '</div>' +
    (p.note ? '<p class="post__note t-body-s c-secondary">' + esc(p.note) + '</p>' : '') +
    '<div class="post__track">' +
      art(p.art, 'art--lg') +
      '<span class="post__meta">' +
        '<span class="t-title-s truncate">' + esc(p.track) + '</span>' +
        '<span class="t-body-s c-secondary truncate">' + esc(p.artist) + (p.album ? ' · ' + esc(p.album) : '') + '</span>' +
      '</span>' +
      '<button class="post__play" aria-label="Play ' + esc(p.track) + '" data-play-track="' + esc(p.track) + '">' + icon('play', 15) + '</button>' +
    '</div>' +
    '<hr class="hr">' +
    '<div class="post__foot">' +
      '<button class="pill" data-react="flame" aria-label="Flame" aria-pressed="' + p.reacted.flame + '">' +
        icon('flame', 14) + '<b>' + p.reactions.flame + '</b></button>' +
      '<button class="pill" data-react="heart" aria-label="Heart" aria-pressed="' + p.reacted.heart + '">' +
        icon('heart', 14) + '<b>' + p.reactions.heart + '</b></button>' +
      '<button class="pill" data-comment aria-label="Comments" aria-expanded="' + open + '">' +
        icon('comment', 14) + '<b>' + p.comments.length + '</b></button>' +
      '<span class="spacer"></span>' +
      '<span class="t-meta c-tertiary">' + total + (total === 1 ? ' reaction' : ' reactions') + '</span>' +
      '<button class="iconbtn" data-tip="Open track" aria-label="Open track">' + icon('arrowUpRight', 16) + '</button>' +
    '</div>' +
    (open ? commentsBlock(p) : '') +
  '</article>';
}

function statBlock(label, value, delta, suffix) {
  const up = delta >= 0;
  return '<div class="stat">' +
    '<span class="t-overline c-tertiary">' + esc(label) + '</span>' +
    '<span class="t-stat-m">' + esc(value) + '</span>' +
    '<span class="stat__delta">' +
      '<span class="' + (up ? 'c-positive' : 'c-negative') + '">' + icon(up ? 'trendingUp' : 'trendingDown', 13) + '</span>' +
      '<span class="t-num ' + (up ? 'c-positive' : 'c-negative') + '">' + (up ? '+' : '−') + Math.abs(delta) + '%</span>' +
      '<span class="t-caption c-tertiary">' + esc(suffix || 'vs last week') + '</span>' +
    '</span>' +
  '</div>';
}

function ringEl(pct, small) {
  const r = small ? 18 : 30;
  const size = small ? 44 : 72;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return '<div class="' + cx('ring', small ? 'ring--sm' : null) + '">' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle class="ring__track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + (small ? 4 : 5) + '"/>' +
      '<circle class="ring__fill" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + (small ? 4 : 5) + '" ' +
        'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
    '</svg>' +
    '<span class="ring__label">' + pct + '</span>' +
  '</div>';
}

function weekBars() {
  const max = Math.max.apply(null, DATA.week.map(function (d) { return d.min; }));
  return '<div class="bars">' + DATA.week.map(function (d) {
    const h = Math.round((d.min / max) * 100);
    return '<div data-peak="' + (d.min === max) + '" data-tip="' + d.min + ' min">' +
      '<span class="bars__slot"><i style="height:' + h + '%"></i></span>' +
      '<span>' + d.day + '</span></div>';
  }).join('') + '</div>';
}

function pageHead(eyebrow, title, actions) {
  return '<header class="page-head">' +
    '<div class="page-head__titles">' +
      '<span class="t-overline page-head__eyebrow">' + esc(eyebrow) + '</span>' +
      '<h1 class="t-title-l">' + title + '</h1>' +
    '</div>' +
    (actions ? '<div class="page-head__actions">' + actions + '</div>' : '') +
  '</header>';
}

function wrap(head, body) {
  return '<div class="view">' + head +
    '<div class="view-scroll scroll"><div class="stack">' + body + '</div></div></div>';
}

/* ==========================================================================
   views
   ========================================================================== */
const VIEWS = {};

function heroPanel() {
  const np = DATA.nowPlaying;

  if (np.status !== 'track') {
    const connected = np.status === 'idle';
    return '<section class="panel hero">' +
      '<div class="art art--xl hero__placeholder" aria-hidden="true">' + icon('spotify', 40) + '</div>' +
      '<div class="hero__body">' +
        '<span class="t-overline c-tertiary">Now playing</span>' +
        '<h2 class="t-display-m hero__title truncate">' + (connected ? 'Nothing playing' : 'Spotify not connected') + '</h2>' +
        '<p class="t-body-l c-secondary">' + (connected
          ? 'Play something on Spotify and it shows up here.'
          : 'Connect your Spotify account to show what you are listening to.') + '</p>' +
        '<div class="hero__controls">' + (connected
          ? '<span class="badge badge--positive"><span>' + icon('check', 13) + '</span>Spotify connected</span>'
          : '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + icon('spotify', 15) + 'Connect Spotify</button>') +
        '</div>' +
      '</div>' +
    '</section>';
  }

  const pct = np.duration ? Math.round((np.elapsed / np.duration) * 100) : 0;
  return '<section class="panel hero">' +
    art(np.art, 'art--xl', np.image) +
    '<div class="hero__body">' +
      '<span class="t-overline c-accent">' + (np.playing ? 'Now playing' : 'Paused') + '</span>' +
      '<h2 class="t-display-m hero__title truncate">' + esc(np.title) + '</h2>' +
      '<p class="t-body-l c-secondary truncate">' + esc(np.artist) + (np.album ? ' · ' + esc(np.album) : '') + '</p>' +
      '<div class="hero__progress">' +
        '<span class="t-meta c-tertiary">' + mmss(np.elapsed) + '</span>' +
        '<div class="slider" style="flex:1">' +
          '<div class="track"><i style="width:' + pct + '%"></i></div>' +
          '<span class="slider__knob" style="left:' + pct + '%"></span>' +
        '</div>' +
        '<span class="t-meta c-tertiary">' + mmss(np.duration) + '</span>' +
      '</div>' +
      '<div class="hero__controls">' +
        '<button class="btn btn--secondary btn--sm" data-action="share-now-playing">' + icon('broadcast', 15) + 'Share this track</button>' +
        (np.url && /^https:\/\//.test(np.url) ? '<a class="btn btn--ghost btn--sm" href="' + esc(np.url) + '" target="_blank" rel="noopener">' + icon('arrowUpRight', 15) + 'Open in Spotify</a>' : '') +
        '<span class="spacer"></span>' +
        '<span class="badge"><span>' + icon('headphones', 13) + '</span>' + esc(PLATFORM_LABEL[np.platform]) + '</span>' +
      '</div>' +
    '</div>' +
  '</section>';
}

VIEWS.home = function () {
  const hero = heroPanel();

  const recently =
    '<section class="panel section">' +
      sectionHead('Recently played', null, tabsEl('recent', ['Today', 'This week', 'All'], 'Today')) +
      '<div class="section__body">' +
        DATA.recent.slice(0, 6).map(function (t, i) { return musicRow(t, i); }).join('') +
      '</div>' +
    '</section>';

  const listening = DATA.friends.filter(function (f) { return f.status === 'listening'; });
  const friendsPanel =
    '<section class="panel section">' +
      sectionHead('Friends', listening.length + ' listening now',
        '<button class="btn btn--ghost btn--sm" data-nav="friends">See all</button>') +
      '<div class="section__body">' +
        DATA.friends.slice(0, 5).map(friendRow).join('') +
      '</div>' +
    '</section>';

  const weekPanel =
    '<section class="panel section">' +
      sectionHead('Your week', null, '<span class="badge badge--positive"><span class="badge__num">+18%</span></span>') +
      '<div class="section__body section__body--pad stack stack--sm">' +
        weekBars() +
        '<hr class="hr">' +
        '<div class="rowflex">' +
          '<span class="t-body-s c-secondary">Minutes listened</span><span class="spacer"></span>' +
          '<span class="t-num">1,284</span>' +
        '</div>' +
        '<div class="rowflex">' +
          '<span class="t-body-s c-secondary">New artists</span><span class="spacer"></span>' +
          '<span class="t-num">23</span>' +
        '</div>' +
        '<div class="rowflex">' +
          '<span class="c-accent">' + icon('flame', 15) + '</span>' +
          '<span class="t-body-s c-secondary">Current streak</span><span class="spacer"></span>' +
          '<span class="t-num c-accent">12 days</span>' +
        '</div>' +
      '</div>' +
    '</section>';

  return wrap(
    pageHead('Monday, 21 September', 'Good evening, Pietro',
      iconBtn('bell', 'Notifications', 'iconbtn--lg') +
      '<button class="btn btn--secondary btn--sm" data-toast="recap">' + icon('sparkle', 15) + 'Share recap</button>' +
      '<button class="btn btn--primary btn--sm" data-nav="music">' + icon('play', 15) + 'Play all</button>'),
    hero +
    '<div class="cols cols--main-rail">' +
      '<div class="stack">' + recently + '</div>' +
      '<div class="stack">' + friendsPanel + weekPanel + '</div>' +
    '</div>'
  );
};

VIEWS.feed = function () {
  const trending =
    '<section class="panel section">' +
      sectionHead('Trending with friends') +
      '<div class="section__body">' +
        DATA.artists.slice(0, 4).map(function (a, i) {
          return '<button class="row">' +
            '<span class="row__index">' + (i + 1) + '</span>' +
            art(a.art, 'art--round') +
            '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(a.name) + '</span>' +
            '<span class="t-body-s c-tertiary">' + a.plays + ' plays this week</span></span>' +
            '<span class="' + (a.delta >= 0 ? 'c-positive' : 'c-negative') + '">' +
              icon(a.delta >= 0 ? 'trendingUp' : 'trendingDown', 15) + '</span>' +
          '</button>';
        }).join('') +
      '</div>' +
    '</section>';

  const leaders =
    '<section class="panel section">' +
      sectionHead('Weekly leaderboard', 'resets Sunday') +
      '<div class="section__body">' +
        DATA.leaderboard.map(function (l, i) {
          return '<div class="row" style="cursor:default">' +
            '<span class="row__index">' + (i + 1) + '</span>' +
            avatarEl(l.initials, '32', l.you ? 'online' : null) +
            '<span class="row__meta"><span class="' + (l.you ? 't-body-m-med c-accent' : 't-body-m-med') + ' truncate">' +
              esc(l.name) + (l.you ? ' (you)' : '') + '</span></span>' +
            '<span class="t-num c-secondary">' + l.minutes.toLocaleString('en-US') + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</section>';

  return wrap(
    pageHead('Live from your circle', 'Feed',
      tabsEl('feed', ['All', 'Friends', 'Groups'], 'All') +
      iconBtn('filter', 'Filter', 'iconbtn--lg') +
      '<button class="btn btn--primary btn--sm" data-action="new-post">' + icon('plus', 15) + 'Share a track</button>'),
    '<div class="cols cols--feed">' +
      '<div class="stack">' + (DATA.feed.length ? DATA.feed.map(postCard).join('') :
        '<section class="panel"><div class="empty"><span class="empty__well">' + icon('broadcast', 20) + '</span>' +
        '<span class="t-body-m-med">No posts yet</span>' +
        '<p class="t-body-s c-tertiary">When you or your friends share a track, it shows up here.</p>' +
        '<button class="btn btn--secondary btn--sm" data-action="new-post">' + icon('plus', 15) + 'Share your first track</button>' +
        '</div></section>') + '</div>' +
      '<div class="stack">' + trending + leaders + '</div>' +
    '</div>'
  );
};

VIEWS.friends = function () {
  const live = DATA.friends.filter(function (f) { return f.status === 'listening'; });
  const rest = DATA.friends.filter(function (f) { return f.status !== 'listening'; });

  const livePanel =
    '<section class="panel section">' +
      sectionHead('Listening now', live.length + ' friends') +
      '<div class="section__body">' + live.map(friendRow).join('') + '</div>' +
    '</section>';

  const allPanel =
    '<section class="panel section">' +
      sectionHead('All friends', DATA.friends.length + ' total',
        tabsEl('friends', ['Recent', 'A–Z'], 'Recent')) +
      '<div class="section__body">' + rest.map(friendRow).join('') + '</div>' +
    '</section>';

  const reqPanel =
    '<section class="panel section">' +
      sectionHead('Requests', String(DATA.requests.length)) +
      '<div class="section__body">' + DATA.requests.map(function (r) {
        return '<div class="friend" style="cursor:default">' +
          avatarEl(r.initials, '32') +
          '<span class="friend__meta">' +
            '<span class="t-body-m-med truncate">' + esc(r.name) + '</span>' +
            '<span class="t-body-s c-tertiary">' + r.mutual + ' mutual friends</span>' +
          '</span>' +
          '<button class="iconbtn" data-toast="accept" data-tip="Accept">' + icon('check', 16) + '</button>' +
          '<button class="iconbtn" data-tip="Decline">' + icon('close', 16) + '</button>' +
        '</div>';
      }).join('') + '</div>' +
    '</section>';

  const sugPanel =
    '<section class="panel section">' +
      sectionHead('People you may know') +
      '<div class="section__body">' + DATA.suggestions.map(function (s) {
        return '<div class="friend" style="cursor:default">' +
          avatarEl(s.initials, '32') +
          '<span class="friend__meta">' +
            '<span class="t-body-m-med truncate">' + esc(s.name) + '</span>' +
            '<span class="t-body-s c-tertiary truncate">' + esc(s.reason) + '</span>' +
          '</span>' +
          '<span class="badge badge--accent"><span class="badge__num">' + s.compat + '%</span></span>' +
          '<button class="iconbtn" data-toast="request" data-tip="Add friend">' + icon('plus', 16) + '</button>' +
        '</div>';
      }).join('') + '</div>' +
    '</section>';

  return wrap(
    pageHead('Your circle', 'Friends',
      '<label class="field field--sm" style="width:240px">' + icon('search', 16) +
        '<input type="search" placeholder="Search friends" aria-label="Search friends"></label>' +
      '<button class="btn btn--primary btn--sm" data-toast="invite">' + icon('plus', 15) + 'Invite</button>'),
    '<div class="cols cols--feed">' +
      '<div class="stack">' + livePanel + allPanel + '</div>' +
      '<div class="stack">' + reqPanel + sugPanel + '</div>' +
    '</div>'
  );
};

VIEWS.activity = function () {
  const minutesPanel =
    '<section class="panel section">' +
      sectionHead('Listening minutes', 'last 7 days',
        '<span class="badge badge--positive"><span class="badge__num">+18%</span></span>') +
      '<div class="section__body section__body--pad stack">' +
        weekBars() +
        '<hr class="hr">' +
        '<div class="cols cols--thirds">' +
          statBlock('Total', '1,284', 18) +
          statBlock('Daily average', '183', 6) +
          statBlock('Longest session', '2h 14m', -11) +
        '</div>' +
      '</div>' +
    '</section>';

  const genrePanel =
    '<section class="panel section">' +
      sectionHead('Genre mix', 'this week') +
      '<div class="section__body section__body--pad stack">' +
        '<div class="distro">' + DATA.genres.map(function (g) {
          return '<i style="width:' + g.pct + '%;background:' + g.color + '" data-tip="' + esc(g.name) + ' ' + g.pct + '%"></i>';
        }).join('') + '</div>' +
        '<div class="legend">' + DATA.genres.map(function (g) {
          return '<div><em style="background:' + g.color + '"></em>' +
            '<span class="t-body-s c-secondary">' + esc(g.name) + '</span>' +
            '<span class="t-num c-tertiary">' + g.pct + '%</span></div>';
        }).join('') + '</div>' +
        '<hr class="hr">' +
        '<p class="t-body-s c-secondary">Indie rock is up 6 points from last week, mostly driven by ' +
          '<span class="c-primary">Radiohead</span> and <span class="c-primary">Phoenix</span>.</p>' +
      '</div>' +
    '</section>';

  const maxPlays = DATA.artists[0].plays;
  const artistsPanel =
    '<section class="panel section">' +
      sectionHead('Top artists', null, tabsEl('artists', ['Week', 'Month', 'All time'], 'Week')) +
      '<div class="section__body">' + DATA.artists.map(function (a, i) {
        return '<div class="row" style="cursor:default">' +
          '<span class="row__index">' + (i + 1) + '</span>' +
          art(a.art, 'art--round') +
          '<span class="row__meta">' +
            '<span class="t-body-m-med truncate">' + esc(a.name) + '</span>' +
            '<span class="track track--thin rankbar' + (i === 0 ? ' rankbar--lead' : '') + '"><i style="width:' +
              Math.round((a.plays / maxPlays) * 100) + '%"></i></span>' +
          '</span>' +
          '<span class="t-num c-secondary">' + a.plays + '</span>' +
        '</div>';
      }).join('') + '</div>' +
    '</section>';

  const historyPanel =
    '<section class="panel section">' +
      sectionHead('History', null, iconBtn('calendar', 'Pick a date')) +
      '<div class="section__body section__body--pad">' +
        '<div class="timeline">' + DATA.timeline.map(function (d) {
          return '<div class="timeline__day" data-today="' + !!d.today + '">' +
            '<div class="timeline__label t-overline c-tertiary">' + esc(d.day) + '</div>' +
            d.items.map(function (it) {
              return '<div class="row" style="cursor:default">' +
                '<span class="t-meta c-tertiary" style="width:34px;flex:none">' + esc(it.time) + '</span>' +
                art(it.art) +
                '<span class="row__meta">' +
                  '<span class="t-body-m-med truncate">' + esc(it.title) + '</span>' +
                  '<span class="t-body-s c-tertiary truncate">' + esc(it.artist) + '</span>' +
                '</span>' +
              '</div>';
            }).join('') +
          '</div>';
        }).join('') + '</div>' +
      '</div>' +
    '</section>';

  return wrap(
    pageHead('How you listened', 'Activity',
      tabsEl('period', ['This week', 'This month', 'All time'], 'This week') +
      '<button class="btn btn--secondary btn--sm" data-toast="export">' + icon('arrowUpRight', 15) + 'Export</button>'),
    '<div class="cols cols--half">' + minutesPanel + genrePanel + '</div>' +
    '<div class="cols cols--half">' + artistsPanel + historyPanel + '</div>'
  );
};

VIEWS.music = function () {
  const recentPanel =
    '<section class="panel section">' +
      sectionHead('Recently played', null,
        '<button class="btn btn--ghost btn--sm">' + icon('shuffle', 15) + 'Shuffle</button>') +
      '<div class="section__body">' + DATA.recent.map(function (t, i) { return musicRow(t, i); }).join('') + '</div>' +
    '</section>';

  const favPanel =
    '<section class="panel section">' +
      sectionHead('Favourites', DATA.favourites.length + ' tracks') +
      '<div class="section__body">' + DATA.favourites.map(function (t, i) { return musicRow(t, i); }).join('') + '</div>' +
    '</section>';

  const albumsPanel =
    '<section class="panel section">' +
      sectionHead('Albums', null, '<button class="btn btn--ghost btn--sm">See all</button>') +
      '<div class="section__body section__body--pad">' +
        '<div class="tilegrid">' + DATA.albums.map(function (a) {
          return '<article class="panel tile">' +
            '<div class="tile__art">' + art(a.art, 'art--tile') +
              '<button class="tile__play" aria-label="Play ' + esc(a.name) + '">' + icon('play', 15) + '</button>' +
            '</div>' +
            '<div class="tile__meta">' +
              '<span class="t-body-m-med truncate">' + esc(a.name) + '</span>' +
              '<span class="t-body-s c-tertiary truncate">' + esc(a.artist) + ' · ' + a.year + '</span>' +
            '</div>' +
          '</article>';
        }).join('') + '</div>' +
      '</div>' +
    '</section>';

  const discoverPanel =
    '<section class="panel section">' +
      sectionHead('Discovered through friends') +
      '<div class="section__body">' + DATA.discoveries.map(function (d, i) {
        return '<button class="row">' +
          '<span class="row__index">' + (i + 1) + '</span>' +
          art(d.art) +
          '<span class="row__meta">' +
            '<span class="t-body-m-med truncate">' + esc(d.title) + '</span>' +
            '<span class="t-body-s c-tertiary truncate">' + esc(d.artist) + '</span>' +
          '</span>' +
          '<span class="badge"><span>via ' + esc(d.via) + '</span></span>' +
        '</button>';
      }).join('') + '</div>' +
    '</section>';

  const playlistPanel =
    '<section class="panel section">' +
      sectionHead('Playlists', null, iconBtn('plus', 'New playlist')) +
      '<div class="section__body">' + DATA.playlists.map(function (p) {
        return '<button class="row">' + art(p.art, 'art--lg') +
          '<span class="row__meta">' +
            '<span class="t-body-m-med truncate">' + esc(p.name) + '</span>' +
            '<span class="t-body-s c-tertiary">' + p.count + ' tracks</span>' +
          '</span>' +
          '<span class="iconbtn">' + icon('chevronRight', 16) + '</span>' +
        '</button>';
      }).join('') + '</div>' +
    '</section>';

  return wrap(
    pageHead('Your library', 'Music',
      tabsEl('library', ['Recent', 'Favourites', 'Albums', 'Playlists'], 'Recent') +
      '<button class="btn btn--primary btn--sm">' + icon('play', 15) + 'Play all</button>'),
    '<div class="cols cols--half">' + recentPanel + '<div class="stack">' + favPanel + discoverPanel + '</div>' + '</div>' +
    albumsPanel + playlistPanel
  );
};

VIEWS.profile = function () {
  const me = DATA.me;
  const header =
    '<section class="panel section__body--pad" style="padding:22px">' +
      '<div class="rowflex" style="gap:18px;align-items:flex-start">' +
        avatarEl(me.initials, '72', 'listening') +
        '<div class="stack stack--sm" style="flex:1;min-width:0;gap:6px">' +
          '<div class="rowflex" style="gap:9px">' +
            '<h2 class="t-title-l">' + esc(me.name) + '</h2>' +
            '<span class="badge badge--accent">' + icon('flame', 13) + me.streak + '-day streak</span>' +
          '</div>' +
          '<span class="t-meta c-tertiary">' + esc(me.username) + ' · joined ' + esc(me.joined) + '</span>' +
          '<p class="t-body-m c-secondary" style="max-width:52ch;margin-top:4px">' + esc(me.bio) + '</p>' +
        '</div>' +
        '<div class="rowflex" style="gap:8px">' +
          '<button class="btn btn--secondary btn--sm">' + icon('link', 15) + 'Share profile</button>' +
          '<button class="btn btn--secondary btn--sm btn--icon" data-nav="settings" data-tip="Edit profile" aria-label="Edit profile">' + icon('sliders', 16) + '</button>' +
        '</div>' +
      '</div>' +
      '<hr class="hr" style="margin:18px 0 16px">' +
      '<div class="cols cols--thirds">' +
        statBlock('Minutes this week', me.minutes.toLocaleString('en-US'), 18) +
        statBlock('Friends', String(me.friends), 4, 'this month') +
        statBlock('New artists', '23', 9) +
      '</div>' +
    '</section>';

  const compatPanel =
    '<section class="panel section">' +
      sectionHead('Music compatibility', 'top matches') +
      '<div class="section__body section__body--pad stack">' +
        DATA.compatibility.map(function (c, i) {
          return (i ? '<hr class="hr">' : '') +
            '<div class="compat">' + ringEl(c.pct) +
              '<div class="stack" style="gap:3px;min-width:0">' +
                '<span class="t-body-m-med">' + esc(c.name) + '</span>' +
                '<span class="t-body-s c-tertiary truncate">Shared: ' + esc(c.shared) + '</span>' +
                '<button class="btn btn--ghost btn--sm" style="align-self:flex-start;margin-top:4px;padding-left:0">' +
                  'Compare taste' + icon('chevronRight', 14) + '</button>' +
              '</div>' +
            '</div>';
        }).join('') +
      '</div>' +
    '</section>';

  const topPanel =
    '<section class="panel section">' +
      sectionHead('Top artists', 'all time') +
      '<div class="section__body">' + DATA.artists.slice(0, 5).map(function (a, i) {
        return '<div class="row" style="cursor:default">' +
          '<span class="row__index">' + (i + 1) + '</span>' + art(a.art, 'art--round') +
          '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(a.name) + '</span></span>' +
          '<span class="t-num c-secondary">' + a.plays + '</span>' +
        '</div>';
      }).join('') + '</div>' +
    '</section>';

  const favTrack =
    '<section class="panel section">' +
      sectionHead('On repeat') +
      '<div class="section__body">' + DATA.favourites.slice(0, 4).map(function (t, i) { return musicRow(t, i); }).join('') + '</div>' +
    '</section>';

  return wrap(
    pageHead('Public profile', 'Profile',
      '<button class="btn btn--secondary btn--sm" data-nav="appearance">' + icon('droplet', 15) + 'Appearance</button>'),
    header +
    '<div class="cols cols--half">' + compatPanel + '<div class="stack">' + topPanel + favTrack + '</div></div>'
  );
};

VIEWS.appearance = function () {
  function previewMarkup(kind) {
    return '<div class="preview preview--' + kind + '">' +
      '<div class="preview__rail"><i class="accent" style="width:60%"></i><i></i><i class="w70"></i><i class="w50"></i><i class="w70"></i></div>' +
      '<div class="preview__body"><i class="w50"></i><i class="accent"></i><i class="w85"></i><i class="w70"></i><i class="w85"></i><i class="w50"></i></div>' +
    '</div>';
  }
  const themePanel =
    '<section class="panel section">' +
      sectionHead('Theme', 'applies immediately') +
      '<div class="section__body section__body--pad">' +
        '<div class="themegrid">' +
          '<button class="themecard" data-theme-pick="dark">' + previewMarkup('dark') +
            '<div class="themecard__foot">' +
              '<div class="stack" style="gap:2px"><span class="t-body-m-med">Dark</span>' +
              '<span class="t-caption c-tertiary">Warm graphite, ember accent</span></div>' +
              '<span class="themecard__check">' + icon('check', 13) + '</span>' +
            '</div>' +
          '</button>' +
          '<button class="themecard" data-theme-pick="light">' + previewMarkup('light') +
            '<div class="themecard__foot">' +
              '<div class="stack" style="gap:2px"><span class="t-body-m-med">Light</span>' +
              '<span class="t-caption c-tertiary">Warm paper, deeper ember</span></div>' +
              '<span class="themecard__check">' + icon('check', 13) + '</span>' +
            '</div>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</section>';

  const soonRows = [
    ['Accent colour', 'Swap ember for another signal colour across the product.', 'droplet'],
    ['Glass intensity', 'How much the panels let the backdrop through.', 'sparkle'],
    ['Background blur', 'Trade blur radius for rendering performance.', 'droplet'],
    ['Interface density', 'Comfortable, compact or condensed row heights.', 'sliders'],
    ['Animations', 'Reduce or disable transitions independently of the OS setting.', 'activity'],
    ['Sidebar layout', 'Reorder destinations and pin your own shortcuts.', 'bars']
  ];
  const soonPanel =
    '<section class="panel section">' +
      sectionHead('Personalisation', null, '<span class="badge badge--beta">Coming soon</span>') +
      '<div class="section__body section__body--flush">' +
        soonRows.map(function (r) {
          return '<div class="setting setting--disabled">' +
            '<span class="c-tertiary">' + icon(r[2], 18) + '</span>' +
            '<div class="setting__meta">' +
              '<span class="t-body-m-med">' + esc(r[0]) + '</span>' +
              '<span class="t-body-s c-tertiary">' + esc(r[1]) + '</span>' +
            '</div>' +
            '<span class="toggle" aria-checked="false" aria-disabled="true"></span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</section>';

  const railPanel =
    '<section class="panel section">' +
      sectionHead('Navigation') +
      '<div class="section__body section__body--flush">' +
        '<div class="setting">' +
          '<span class="c-tertiary">' + icon('bars', 18) + '</span>' +
          '<div class="setting__meta">' +
            '<span class="t-body-m-med">Compact sidebar</span>' +
            '<span class="t-body-s c-tertiary">Collapse the rail to icons only. Also toggles with the chevron in the sidebar.</span>' +
          '</div>' +
          '<button class="toggle" data-toggle="rail" aria-checked="false" role="switch" aria-label="Compact sidebar"></button>' +
        '</div>' +
        '<div class="setting">' +
          '<span class="c-tertiary">' + icon('sparkle', 18) + '</span>' +
          '<div class="setting__meta">' +
            '<span class="t-body-m-med">Ambient backdrop</span>' +
            '<span class="t-body-s c-tertiary">The soft drifting lights behind the glass panels.</span>' +
          '</div>' +
          '<button class="toggle" data-toggle="ambient" aria-checked="true" role="switch" aria-label="Ambient backdrop"></button>' +
        '</div>' +
      '</div>' +
    '</section>';

  return wrap(
    pageHead('Make it yours', 'Appearance'),
    themePanel + '<div class="cols cols--half">' + railPanel + soonPanel + '</div>'
  );
};

VIEWS.experimental = function () {
  const auth =
    '<form class="panel panel--raised auth" id="protoLogin" novalidate>' +
      '<div class="auth__head">' +
        '<span class="auth__mark"><img src="assets/logo-64.png" width="30" height="30" alt=""></span>' +
        '<h2 class="t-title-m">Sign in to vortex</h2>' +
        '<p class="t-body-s c-tertiary">Visual prototype — nothing is sent anywhere.</p>' +
      '</div>' +
      '<div class="auth__note">' + icon('flask', 16) +
        '<p class="t-body-s c-secondary">This screen has no backend yet. Authentication will be wired to Supabase once the Spotify OAuth flow is in place.</p>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authEmail">Email or username</label>' +
        '<span class="field">' + icon('mail', 17) +
          '<input id="authEmail" type="text" placeholder="you@example.com" autocomplete="off"></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authPass">Password</label>' +
        '<span class="field">' + icon('lock', 17) +
          '<input id="authPass" type="password" placeholder="••••••••" autocomplete="off">' +
          '<button type="button" class="iconbtn" data-pass-toggle aria-label="Show password">' + icon('eye', 17) + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="auth__row">' +
        '<button type="button" class="check" data-toggle="remember" role="checkbox" aria-checked="true">' + icon('check', 12) + '</button>' +
        '<span class="t-body-s c-secondary">Remember me</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-toast="forgot">Forgot password?</button>' +
      '</div>' +
      '<button type="submit" class="btn btn--primary" style="width:100%;padding:0 16px">Log in</button>' +
      '<div class="auth__sep"><span class="t-caption">or continue with</span></div>' +
      '<div class="auth__providers">' +
        '<button type="button" class="btn btn--secondary btn--sm" data-toast="provider" style="justify-content:center;padding:0 10px">' + icon('spotify', 16) + 'Spotify</button>' +
        '<button type="button" class="btn btn--secondary btn--sm" data-toast="provider" style="justify-content:center;padding:0 10px">' + icon('apple', 16) + 'Apple</button>' +
        '<button type="button" class="btn btn--secondary btn--sm" data-toast="provider" style="justify-content:center;padding:0 10px">' + icon('google', 16) + 'Google</button>' +
      '</div>' +
      '<p class="t-body-s c-tertiary" style="text-align:center">No account yet? ' +
        '<button type="button" class="btn btn--ghost btn--sm" data-toast="signup" style="padding:0 4px">Create one</button></p>' +
    '</form>';

  return '<div class="view">' +
    pageHead('Work in progress', 'Experimental <span class="badge badge--beta" style="vertical-align:5px;margin-left:8px">Beta</span>',
      '<button class="btn btn--ghost btn--sm" data-toast="flags">' + icon('flask', 15) + 'Feature flags</button>') +
    '<div class="auth-wrap scroll">' + auth + '</div>' +
  '</div>';
};

VIEWS.settings = function () {
  function row(iconName, title, desc, control, disabled) {
    return '<div class="setting' + (disabled ? ' setting--disabled' : '') + '">' +
      '<span class="c-tertiary">' + icon(iconName, 18) + '</span>' +
      '<div class="setting__meta">' +
        '<span class="t-body-m-med">' + esc(title) + '</span>' +
        '<span class="t-body-s c-tertiary">' + esc(desc) + '</span>' +
      '</div>' + control +
    '</div>';
  }
  const sw = function (id, on) {
    return '<button class="toggle" data-toggle="' + id + '" role="switch" aria-checked="' + !!on + '" aria-label="' + id + '"></button>';
  };

  const account =
    '<section class="panel section">' + sectionHead('Account') +
      '<div class="section__body section__body--flush">' +
        row('user', 'Display name', DATA.me.name, '<button class="btn btn--secondary btn--sm">Edit</button>') +
        row('globe', 'Username', DATA.me.username, '<button class="btn btn--secondary btn--sm">Edit</button>') +
        row('mail', 'Email', DATA.me.email || '', '<button class="btn btn--secondary btn--sm">Change</button>') +
      '</div>' +
    '</section>';

  const services =
    '<section class="panel section">' + sectionHead('Connected services') +
      '<div class="section__body section__body--flush">' +
        (spotify.auth.isConnected()
          ? row('spotify', 'Spotify', 'Connected · shows what you are playing', '<button class="btn btn--secondary btn--sm" data-action="spotify-disconnect">Disconnect</button>')
          : row('spotify', 'Spotify', 'Not connected', '<button class="btn btn--primary btn--sm" data-action="spotify-connect">Connect</button>')) +
        row('apple', 'Apple Music', 'Not connected', '<button class="btn btn--secondary btn--sm" data-toast="connect">Connect</button>') +
        row('google', 'Google', 'Used for sign-in only', '<button class="btn btn--secondary btn--sm" data-toast="connect">Connect</button>') +
      '</div>' +
    '</section>';

  const privacy =
    '<section class="panel section">' + sectionHead('Privacy') +
      '<div class="section__body section__body--flush">' +
        row('broadcast', 'Share listening activity', 'Friends can see what you are playing in real time.', sw('share', true)) +
        row('users', 'Show in leaderboards', 'Appear in the weekly ranking among your friends.', sw('leader', true)) +
        row('eye', 'Public profile', 'Anyone with your link can see your profile.', sw('public', false)) +
        row('clock', 'Private session', 'Pause activity sharing until you turn it back on.', sw('private', false)) +
      '</div>' +
    '</section>';

  const notifications =
    '<section class="panel section">' + sectionHead('Notifications') +
      '<div class="section__body section__body--flush">' +
        row('bell', 'Friend activity', 'When someone you follow starts listening.', sw('n1', true)) +
        row('heart', 'Reactions', 'When a friend reacts to your track.', sw('n2', true)) +
        row('sparkle', 'Weekly recap', 'Your listening summary every Sunday night.', sw('n3', true)) +
        row('flame', 'Streak reminders', 'A nudge when your streak is about to break.', sw('n4', false)) +
      '</div>' +
    '</section>';

  const danger =
    '<section class="panel section">' + sectionHead('Danger zone') +
      '<div class="section__body section__body--flush">' +
        row('logout', 'Log out', 'Sign out on this device only.', '<button class="btn btn--secondary btn--sm" data-action="logout">Log out</button>') +
        '<div class="setting">' +
          '<span class="c-negative">' + icon('close', 18) + '</span>' +
          '<div class="setting__meta">' +
            '<span class="t-body-m-med c-negative">Delete account</span>' +
            '<span class="t-body-s c-tertiary">Removes your profile, history and connections. Cannot be undone.</span>' +
          '</div>' +
          '<button class="btn btn--secondary btn--sm" data-modal="delete">Delete</button>' +
        '</div>' +
      '</div>' +
    '</section>';

  return wrap(
    pageHead('Preferences', 'Settings'),
    '<div class="cols cols--half">' +
      '<div class="stack">' + account + privacy + '</div>' +
      '<div class="stack">' + services + notifications + danger + '</div>' +
    '</div>'
  );
};
