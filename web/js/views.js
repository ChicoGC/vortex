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
  return '<div class="' + cx('art', cls, style && 'art--cover') + '" data-art="' + n + '"' + (style ? ' style="' + style + '"' : '') + ' aria-hidden="true"></div>';
}
/* Only vortex's own Supabase storage bucket is trusted for a profile photo,
   so a crafted value can't point at an arbitrary (e.g. tracking) image. The
   initials always sit underneath: if the photo 404s, onerror removes the
   broken <img> and the initials show through instead of a blank circle. */
const AVATAR_URL = /^https:\/\/hpblrmnturpihyrhwzih\.supabase\.co\/storage\/v1\/object\/public\/avatars\/[A-Za-z0-9/_.-]+$/;
function avatarEl(initials, size, status, image) {
  const cls = cx('avatar', size ? 'avatar--' + size : null);
  const photo = typeof image === 'string' && AVATAR_URL.test(image)
    ? '<img src="' + esc(image) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
  return '<div class="' + cls + '"' + (status ? ' data-status="' + status + '"' : '') + '>' + esc(initials) + photo + '</div>';
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
/* A shared post as a compact row; showUser adds who shared it. */
function postRow(p, showUser) {
  return '<button class="row" data-nav="feed">' +
    art(p.art, null, p.image) +
    '<span class="row__meta">' +
      '<span class="t-body-m-med truncate">' + esc(p.track) + '</span>' +
      '<span class="t-body-s c-tertiary truncate">' + esc(p.artist) +
        (showUser ? ' · shared by ' + esc(p.mine ? 'you' : p.user) : '') + '</span>' +
    '</span>' +
    '<span class="t-meta c-tertiary">' + esc(p.time) + '</span>' +
  '</button>';
}

/* sub replaces the @username line (e.g. with what they're listening to). */
function personRow(p, controls, sub, status) {
  const inner = avatarEl(p.initials, '32', status, p.avatarUrl) +
    '<span class="friend__meta">' +
      '<span class="t-body-m-med truncate">' + esc(p.name) + '</span>' +
      (sub || '<span class="t-body-s c-tertiary truncate">@' + esc(p.username) + '</span>') +
    '</span>';
  const head = p.username
    ? '<a class="friend__link" href="#/u/' + esc(p.username) + '">' + inner + '</a>'
    : '<div class="friend__link">' + inner + '</div>';
  return '<div class="friend">' + head + (controls || '') + '</div>';
}

/* A friend's listening_now row, or null. "Live" means playing with a fresh
   heartbeat; a closed tab stops heartbeats, so it ages out to "last played". */
const LIVE_WINDOW_MS = 150000;
function listeningFor(userId) {
  const r = DATA.listening[userId];
  if (!r) return null;
  const age = Date.now() - Date.parse(r.updated_at);
  return { row: r, live: r.is_playing && age < LIVE_WINDOW_MS, ago: formatTimeAgo(r.updated_at) };
}

function listeningSub(l) {
  if (!l) return null;
  const track = esc(l.row.title) + ' · ' + esc(l.row.artist);
  return l.live
    ? '<span class="friend__sub listening-live"><span class="eq eq--sm" aria-label="Listening now"><i></i><i></i><i></i></span>' +
        '<span class="t-body-s c-secondary truncate">' + track + '</span></span>'
    : '<span class="t-body-s c-tertiary truncate">Played ' + track + ' · ' + esc(l.ago) + '</span>';
}

/* Friends ordered live first, then most recently heard, then everyone else. */
function friendsByListening() {
  return DATA.friends.slice().sort(function (a, b) {
    const la = listeningFor(a.id), lb = listeningFor(b.id);
    const score = function (l) { return l ? (l.live ? 2e13 : 0) + Date.parse(l.row.updated_at) : 0; };
    return score(lb) - score(la);
  });
}

function spotifyTrackUrl(id) {
  return /^[A-Za-z0-9]{22}$/.test(id || '') ? 'https://open.spotify.com/track/' + id : null;
}

/* { state: 'friends' | 'incoming' | 'outgoing' | null, friendshipId } */
function relationshipWith(profileId) {
  const lists = [['friends', DATA.friends], ['incoming', DATA.incoming], ['outgoing', DATA.outgoing]];
  for (let i = 0; i < lists.length; i++) {
    const hit = lists[i][1].filter(function (f) { return f.id === profileId; })[0];
    if (hit) return { state: lists[i][0], friendshipId: hit.friendshipId };
  }
  return { state: null, friendshipId: null };
}

const UI = {
  openComments: {},
  openReplies: {},  // top-level comment id -> replies expanded
  replyTo: {},      // post id -> { threadId, name, prefix } while a reply box is open
  feedScope: 'Friends',
  friendSearch: { q: '', results: null, loading: false, error: false },
  // Spotify data for Activity / Music: { status: 'loading'|'ok'|'error', data, at, error }
  spotifyLib: { recent: null, playlists: null, topArtists: {}, topTracks: {} },
  activityRange: 'short_term',
  musicRange: 'short_term',
  // { username, status: 'loading'|'ok'|'notfound'|'error', profile, stats, posts, at }
  friendProfile: null
};

/* Spotify's long_term covers ~1 year of data, not all time. */
const RANGE_LABEL = { short_term: '4 weeks', medium_term: '6 months', long_term: '1 year' };
const RANGE_BY_LABEL = { '4 weeks': 'short_term', '6 months': 'medium_term', '1 year': 'long_term' };

function commentText(text) {
  // A leading @mention (added when replying to a reply) is highlighted.
  return esc(text).replace(/^@[\w.-]+/, function (m) { return '<span class="c-accent">' + m + '</span>'; });
}

/* hasLine: this top-level comment has replies or a reply box shown under it,
   so its avatar grows a connector line down into them. */
function commentEl(c, hasLine, extraClass) {
  return '<div class="' + cx('comment', extraClass) + '">' +
    '<div class="comment__rail">' + avatarEl(c.initials, '24', null, c.avatarUrl) + (hasLine ? '<span class="comment__line"></span>' : '') + '</div>' +
    '<div class="comment__body">' +
      '<span class="comment__who"><span class="t-label-m truncate">' + esc(c.user) + '</span>' +
      '<span class="t-meta c-tertiary">' + esc(c.time) + '</span></span>' +
      '<p class="t-body-s c-secondary">' + commentText(c.text) + '</p>' +
      '<button type="button" class="comment__reply" data-reply-to="' + esc(c.id) + '">Reply</button>' +
    '</div>' +
  '</div>';
}

function replyForm(postId, threadId) {
  const r = UI.replyTo[postId];
  return '<form class="reply-node reply-form" data-comment-form="' + esc(postId) + '" data-parent-id="' + esc(threadId) + '" novalidate>' +
    avatarEl(DATA.me.initials, '24', null, DATA.me.avatarUrl) +
    '<span class="field field--sm">' +
      '<input type="text" name="content" placeholder="Reply to ' + esc(r.name) + '…" maxlength="500" autocomplete="off" ' +
        'aria-label="Reply to ' + esc(r.name) + '" value="' + esc(r.prefix) + '">' +
    '</span>' +
    '<button type="button" class="btn btn--ghost btn--sm" data-cancel-reply>Cancel</button>' +
    '<button type="submit" class="btn btn--primary btn--sm">Reply</button>' +
  '</form>';
}

function repliesToggle(threadId, count, open, inside) {
  return '<button type="button" class="' + cx('comment__toggle', inside && 'reply-node', open && 'comment__toggle--open') + '" ' +
    'data-toggle-replies="' + esc(threadId) + '" aria-expanded="' + open + '">' +
    icon('chevronDown', 14) + (open ? 'Hide replies' : (count === 1 ? '1 reply' : count + ' replies')) +
  '</button>';
}

function commentThread(p, c, replies) {
  const replying = !!(UI.replyTo[p.id] && UI.replyTo[p.id].threadId === c.id);
  const open = replying || !!UI.openReplies[c.id];
  const below = replying || (open && replies.length > 0);
  let html = '<div class="comment-thread">' + commentEl(c, below);
  if (below) {
    html += '<div class="comment-replies">' +
      replies.map(function (r) { return commentEl(r, false, 'reply-node'); }).join('') +
      (replying ? replyForm(p.id, c.id) : '') +
      (replies.length ? repliesToggle(c.id, replies.length, true, true) : '') +
    '</div>';
  } else if (replies.length) {
    html += repliesToggle(c.id, replies.length, false, false);
  }
  return html + '</div>';
}

function commentsBlock(p) {
  const top = p.comments.filter(function (c) { return !c.parentId; });
  const list = top.length
    ? top.map(function (c) {
        return commentThread(p, c, p.comments.filter(function (r) { return r.parentId === c.id; }));
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
  const who = avatarEl(p.initials, '32', null, p.avatarUrl) +
    '<span class="post__who">' +
      '<span class="t-body-m-med truncate">' + esc(p.user) + '</span>' +
      '<span class="t-meta c-tertiary">' + esc(p.time) + '</span>' +
    '</span>';
  return '<article class="panel post" data-post="' + esc(p.id) + '">' +
    '<div class="post__head">' +
      (!p.mine && p.username
        ? '<a class="post__author" href="#/u/' + esc(p.username) + '">' + who + '</a>'
        : '<div class="post__author">' + who + '</div>') +
      '<span class="spacer"></span>' +
      '<span class="iconbtn" data-tip="' + esc(PLATFORM_LABEL[p.platform]) + '">' + icon(p.platform, 16) + '</span>' +
      (p.mine
        ? '<button class="iconbtn" data-delete-post="' + esc(p.id) + '" data-tip="Delete post" aria-label="Delete post">' + icon('trash', 16) + '</button>'
        : '<button class="iconbtn" data-menu="post" aria-label="More">' + icon('dots', 16) + '</button>') +
    '</div>' +
    (p.note ? '<p class="post__note t-body-s c-secondary">' + esc(p.note) + '</p>' : '') +
    '<div class="post__track">' +
      art(p.art, 'art--lg', p.image) +
      '<span class="post__meta">' +
        '<span class="t-title-s truncate">' + esc(p.track) + '</span>' +
        '<span class="t-body-s c-secondary truncate">' + esc(p.artist) + (p.album ? ' · ' + esc(p.album) : '') + '</span>' +
      '</span>' +
      (p.trackId && /^[A-Za-z0-9]{22}$/.test(p.trackId)
        ? '<a class="post__play" href="https://open.spotify.com/track/' + p.trackId + '" target="_blank" rel="noopener" ' +
            'data-tip="Play on Spotify" aria-label="Play ' + esc(p.track) + ' on Spotify">' + icon('play', 15) + '</a>'
        : '') +
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
    '</div>' +
    (open ? commentsBlock(p) : '') +
  '</article>';
}

function statTile(label, value) {
  return '<div class="stat">' +
    '<span class="t-overline c-tertiary">' + esc(label) + '</span>' +
    '<span class="t-stat-m">' + esc(value) + '</span>' +
  '</div>';
}

function countLabel(n, noun) {
  return n + ' ' + noun + (n === 1 ? '' : 's');
}

/* Dome, wavy hem, and two oval eyes cut out (evenodd) so the panel shows through. */
const GHOST_PATH =
  'M10 48C10 23 28 6 50 6C72 6 90 23 90 48L90 97C90 101.5 86.5 103.5 82.5 102C76 99.5 70 99.5 63.5 101.5' +
  'C57 103.5 50 103.5 43.5 101.5C37 99.5 30 99.5 23.5 101.5C19 103 14 103 11.5 100.5C10.5 99.5 10 98 10 96Z' +
  'M25.5 50A10 14.5 0 1 0 45.5 50A10 14.5 0 1 0 25.5 50Z' +
  'M54.5 50A10 14.5 0 1 0 74.5 50A10 14.5 0 1 0 54.5 50Z';

/* Shown wherever there isn't enough real data yet. */
function ghostEmpty(action, hint) {
  return '<div class="ghost-empty">' +
    '<div class="ghost" aria-hidden="true">' +
      '<svg viewBox="0 0 100 110" width="60" height="66"><path fill-rule="evenodd" d="' + GHOST_PATH + '"/></svg>' +
      '<span class="ghost__shadow"></span>' +
    '</div>' +
    '<p class="t-body-m c-secondary">It\'s still a little quiet in here.. maybe you could check later?</p>' +
    (hint ? '<p class="t-body-s c-tertiary">' + esc(hint) + '</p>' : '') +
    (action ? '<div class="ghost-empty__actions">' + action + '</div>' : '') +
  '</div>';
}

function ghostPanel(title, action, hint) {
  return '<section class="panel section">' + (title ? sectionHead(title) : '') + ghostEmpty(action, hint) + '</section>';
}

function sharePostButton(primary) {
  return '<button class="btn ' + (primary ? 'btn--primary' : 'btn--secondary') + ' btn--sm" data-action="new-post">' + icon('plus', 15) + 'Share a track</button>';
}

function findFriendsButton(primary) {
  return '<button class="btn ' + (primary ? 'btn--primary' : 'btn--secondary') + ' btn--sm" data-nav="friends">' + icon('plus', 15) + 'Find friends</button>';
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

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = (DATA.me.name || '').trim().split(/\s+/)[0];
  return first ? part + ', ' + esc(first) : part;
}

function statsRows() {
  const s = DATA.me.stats;
  const rows = [
    ['Tracks shared', s ? s.posts : null],
    ['Friends', DATA.friends.length],
    ['Reactions received', s ? s.reactions : null],
    ['Comments received', s ? s.comments : null]
  ];
  return rows.map(function (r) {
    return '<div class="rowflex">' +
      '<span class="t-body-s c-secondary">' + r[0] + '</span><span class="spacer"></span>' +
      '<span class="t-num">' + (r[1] == null ? '—' : r[1].toLocaleString('en-US')) + '</span>' +
    '</div>';
  }).join('');
}

function homeFriendsPanel() {
  if (!DATA.friends.length) {
    return '<div id="homeFriendsPanel">' + ghostPanel('Friends', findFriendsButton(false)) + '</div>';
  }
  const live = DATA.friends.filter(function (f) { const l = listeningFor(f.id); return l && l.live; }).length;
  return '<section class="panel section" id="homeFriendsPanel">' +
    sectionHead('Friends', live ? live + ' listening now' : countLabel(DATA.friends.length, 'friend'),
      '<button class="btn btn--ghost btn--sm" data-nav="friends">See all</button>') +
    '<div class="section__body">' + friendsByListening().slice(0, 5).map(function (f) {
      const l = listeningFor(f.id);
      return personRow(f, null, listeningSub(l), l && l.live ? 'listening' : null);
    }).join('') + '</div>' +
  '</section>';
}

VIEWS.home = function () {
  const latest = DATA.feed.length
    ? '<section class="panel section">' +
        sectionHead('Latest from your circle', null, '<button class="btn btn--ghost btn--sm" data-nav="feed">Open feed</button>') +
        '<div class="section__body">' + DATA.feed.slice(0, 6).map(function (p) { return postRow(p, true); }).join('') + '</div>' +
      '</section>'
    : ghostPanel('Latest from your circle', sharePostButton(true) + findFriendsButton(false));

  const friendsPanel = homeFriendsPanel();

  const statsPanel =
    '<section class="panel section">' +
      sectionHead('Your vortex') +
      '<div class="section__body section__body--pad stack stack--sm">' + statsRows() + '</div>' +
    '</section>';

  return wrap(
    pageHead(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), greeting(),
      sharePostButton(true)),
    heroPanel() +
    '<div class="cols cols--main-rail">' +
      '<div class="stack">' + latest + '</div>' +
      '<div class="stack">' + friendsPanel + statsPanel + '</div>' +
    '</div>'
  );
};

function feedEmpty() {
  if (UI.feedScope === 'Friends' && !DATA.friends.length) {
    return ghostPanel(null, findFriendsButton(true) + sharePostButton(false),
      'Your feed shows you and your friends. Add friends, or switch to Everyone.');
  }
  return ghostPanel(null, sharePostButton(false));
}

/* Side-column insights computed from the posts currently in the feed.
   Each block only appears once there's enough data to mean something. */
function feedInsights() {
  const panels = [];

  if (DATA.feed.length >= 3) {
    const byArtist = {};
    DATA.feed.forEach(function (p) {
      const a = byArtist[p.artist] || (byArtist[p.artist] = { name: p.artist, n: 0, art: p.art, image: null });
      a.n++;
      if (!a.image && p.image) a.image = p.image;
    });
    const artists = Object.keys(byArtist).map(function (k) { return byArtist[k]; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    panels.push('<section class="panel section">' +
      sectionHead('Most shared artists', UI.feedScope === 'Friends' ? 'you & friends' : 'everyone') +
      '<div class="section__body">' + artists.map(function (a, i) {
        return '<div class="row" style="cursor:default">' +
          '<span class="row__index">' + (i + 1) + '</span>' +
          art(a.art, 'art--round', a.image) +
          '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(a.name) + '</span>' +
          '<span class="t-body-s c-tertiary">' + countLabel(a.n, 'share') + '</span></span>' +
        '</div>';
      }).join('') + '</div>' +
    '</section>');
  }

  const weekAgo = Date.now() - 7 * 864e5;
  const byUser = {};
  DATA.feed.forEach(function (p) {
    if (new Date(p.createdAt).getTime() < weekAgo) return;
    const u = byUser[p.user] || (byUser[p.user] = { name: p.user, initials: p.initials, avatarUrl: p.avatarUrl, username: p.username, mine: p.mine, n: 0 });
    u.n++;
  });
  const sharers = Object.keys(byUser).map(function (k) { return byUser[k]; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
  if (sharers.length >= 2) {
    panels.push('<section class="panel section">' +
      sectionHead('Top sharers', 'last 7 days') +
      '<div class="section__body">' + sharers.map(function (u, i) {
        const row = '<span class="row__index">' + (i + 1) + '</span>' +
          avatarEl(u.initials, '32', null, u.avatarUrl) +
          '<span class="row__meta"><span class="' + (u.mine ? 't-body-m-med c-accent' : 't-body-m-med') + ' truncate">' +
            esc(u.name) + (u.mine ? ' (you)' : '') + '</span></span>' +
          '<span class="t-num c-secondary">' + u.n + '</span>';
        return !u.mine && u.username
          ? '<a class="row" href="#/u/' + esc(u.username) + '">' + row + '</a>'
          : '<div class="row" style="cursor:default">' + row + '</div>';
      }).join('') + '</div>' +
    '</section>');
  }

  return panels.length ? panels.join('') : ghostPanel('Insights');
}

VIEWS.feed = function () {
  return wrap(
    pageHead('Live from your circle', 'Feed',
      tabsEl('feed', ['Friends', 'Everyone'], UI.feedScope) + sharePostButton(true)),
    '<div class="cols cols--feed">' +
      '<div class="stack">' + (DATA.feed.length ? DATA.feed.map(postCard).join('') : feedEmpty()) + '</div>' +
      '<div class="stack">' + feedInsights() + '</div>' +
    '</div>'
  );
};

/* The friends screen is split into independently re-renderable blocks so an
   action (accept, add…) can refresh the lists without wiping the search box. */
function friendSearchControls(p) {
  const rel = relationshipWith(p.id);
  const fid = esc(rel.friendshipId || '');
  if (rel.state === 'friends') return '<span class="badge badge--positive"><span>' + icon('check', 13) + '</span>Friends</span>';
  if (rel.state === 'incoming') return '<button class="btn btn--primary btn--sm" data-friend-accept="' + fid + '">Accept</button>';
  if (rel.state === 'outgoing') return '<button class="btn btn--secondary btn--sm" data-friend-cancel="' + fid + '" data-tip="Cancel request">Requested</button>';
  return '<button class="btn btn--primary btn--sm" data-friend-add="' + esc(p.id) + '">' + icon('plus', 14) + 'Add</button>';
}

function friendSearchResults() {
  const s = UI.friendSearch;
  if (s.q.replace(/^@/, '').trim().length < 2) return '<p class="t-body-s c-tertiary friends__hint">Type at least 2 letters of a name or @username.</p>';
  if (s.loading && !s.results) return '<p class="t-body-s c-tertiary friends__hint">Searching…</p>';
  if (s.error) return '<p class="t-body-s c-tertiary friends__hint">Search failed. Check your connection and try again.</p>';
  if (!s.results || !s.results.length) return '<p class="t-body-s c-tertiary friends__hint">Nobody found for “' + esc(s.q.trim()) + '”.</p>';
  return s.results.map(function (p) { return personRow(p, friendSearchControls(p)); }).join('');
}

function friendsListeningPanel() {
  if (!DATA.friends.length) return '<div id="friendsListeningPanel" hidden></div>';
  const live = friendsByListening().filter(function (f) { const l = listeningFor(f.id); return l && l.live; });
  return '<section class="panel section" id="friendsListeningPanel">' +
    sectionHead('Listening now', live.length ? countLabel(live.length, 'friend') : 'live') +
    '<div class="section__body">' + (live.length
      ? live.map(function (f) {
          const r = listeningFor(f.id).row;
          const href = spotifyTrackUrl(r.track_id);
          const cover = art(artSeedFor(r.track_id || r.title), 'art--lg', r.image_url);
          return '<div class="friend listening-row" style="cursor:default">' +
            avatarEl(f.initials, '32', 'listening', f.avatarUrl) +
            '<span class="friend__meta">' +
              '<span class="t-body-m-med truncate">' + esc(f.name) + '</span>' +
              listeningSub(listeningFor(f.id)) +
              (r.album ? '<span class="t-caption c-tertiary truncate">' + esc(r.album) + '</span>' : '') +
            '</span>' +
            (href ? '<a href="' + href + '" target="_blank" rel="noopener" data-tip="Open in Spotify" aria-label="Open ' + esc(r.title) + ' in Spotify">' + cover + '</a>' : cover) +
          '</div>';
        }).join('')
      : '<p class="t-body-s c-tertiary friends__hint">None of your friends are playing anything right now. It updates live.</p>') +
    '</div>' +
  '</section>';
}

function friendsListPanel() {
  return '<section class="panel section" id="friendsListPanel">' +
    sectionHead('Your friends', countLabel(DATA.friends.length, 'friend')) +
    '<div class="section__body">' + (DATA.friends.length
      ? friendsByListening().map(function (f) {
          const l = listeningFor(f.id);
          return personRow(f,
            '<button class="iconbtn" data-friend-remove="' + esc(f.friendshipId) + '" data-tip="Remove friend" aria-label="Remove ' + esc(f.name) + '">' + icon('close', 16) + '</button>',
            listeningSub(l), l && l.live ? 'listening' : null);
        }).join('')
      : ghostEmpty(null, 'Search above to add someone. Once they accept, their posts show up in your feed.')) +
    '</div>' +
  '</section>';
}

function friendRequestsPanel() {
  return '<section class="panel section" id="friendRequestsPanel">' +
    sectionHead('Requests', String(DATA.incoming.length)) +
    '<div class="section__body">' + (DATA.incoming.length
      ? DATA.incoming.map(function (r) {
          return personRow(r,
            '<button class="iconbtn" data-friend-accept="' + esc(r.friendshipId) + '" data-tip="Accept" aria-label="Accept ' + esc(r.name) + '">' + icon('check', 16) + '</button>' +
            '<button class="iconbtn" data-friend-decline="' + esc(r.friendshipId) + '" data-tip="Decline" aria-label="Decline ' + esc(r.name) + '">' + icon('close', 16) + '</button>');
        }).join('')
      : '<p class="t-body-s c-tertiary friends__hint">No pending requests.</p>') +
    '</div>' +
  '</section>';
}

function friendSentPanel() {
  return '<section class="panel section" id="friendSentPanel">' +
    sectionHead('Sent', String(DATA.outgoing.length)) +
    '<div class="section__body">' + (DATA.outgoing.length
      ? DATA.outgoing.map(function (r) {
          return personRow(r, '<button class="btn btn--ghost btn--sm" data-friend-cancel="' + esc(r.friendshipId) + '">Cancel</button>');
        }).join('')
      : '<p class="t-body-s c-tertiary friends__hint">Requests you send wait here until accepted.</p>') +
    '</div>' +
  '</section>';
}

VIEWS.friends = function () {
  const searchPanel =
    '<section class="panel section">' +
      sectionHead('Add friends') +
      '<div class="section__body section__body--pad stack stack--sm">' +
        '<label class="field">' + icon('search', 16) +
          '<input type="search" id="friendSearch" placeholder="Search by name or @username" aria-label="Search people" autocomplete="off" maxlength="40" value="' + esc(UI.friendSearch.q) + '">' +
        '</label>' +
        '<div id="friendResults">' + friendSearchResults() + '</div>' +
      '</div>' +
    '</section>';

  return wrap(
    pageHead('Your circle', 'Friends'),
    '<div class="cols cols--feed">' +
      '<div class="stack">' + friendsListeningPanel() + searchPanel + friendsListPanel() + '</div>' +
      '<div class="stack">' + friendRequestsPanel() + friendSentPanel() + '</div>' +
    '</div>'
  );
};

/* ---- Spotify-backed pages (Activity, Music) ------------------------------ */
function spotifyGate() {
  if (!spotify.auth.isConnected()) {
    return ghostPanel(null,
      '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + icon('spotify', 15) + 'Connect Spotify</button>',
      'Connect Spotify to see your listening here.');
  }
  if (spotify.auth.missingScopes().length) {
    return ghostPanel(null,
      '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + icon('spotify', 15) + 'Reconnect Spotify</button>',
      'This page needs a few more Spotify permissions (recent plays, top artists and playlists). Reconnect once to allow them.');
  }
  return null;
}

/* Loading / error / empty handling shared by every Spotify panel. */
function libraryBody(entry, render) {
  if (!entry || (entry.status === 'loading' && !entry.data)) {
    return '<p class="t-body-s c-tertiary friends__hint">Loading from Spotify…</p>';
  }
  if (entry.status === 'error' && !entry.data) {
    return ghostEmpty(null, entry.error === 403
      ? 'Spotify refused this request. While the app is in development, only accounts on its tester list can use it.'
      : 'Could not reach Spotify. Try again in a moment.');
  }
  if (!entry.data.length) return ghostEmpty();
  return render(entry.data);
}

function libraryPanel(id, title, meta, tools, entry, render) {
  return '<section class="panel section" id="' + id + '">' + sectionHead(title, meta, tools) +
    '<div class="section__body">' + libraryBody(entry, render) + '</div></section>';
}

function trackRow(t, lead, trailing) {
  const href = spotifyTrackUrl(t.id);
  const inner = (lead || '') + art(artSeedFor(t.id), null, t.thumb) +
    '<span class="row__meta">' +
      '<span class="t-body-m-med truncate">' + esc(t.title) + '</span>' +
      '<span class="t-body-s c-tertiary truncate">' + esc(t.artist) + (t.album ? ' · ' + esc(t.album) : '') + '</span>' +
    '</span>' + (trailing || '');
  return href
    ? '<a class="row" href="' + href + '" target="_blank" rel="noopener">' + inner + '</a>'
    : '<div class="row" style="cursor:default">' + inner + '</div>';
}

function rankIndex(i) {
  return '<span class="row__index">' + (i + 1) + '</span>';
}

function rangeTabs(group, range) {
  return tabsEl(group, ['4 weeks', '6 months', '1 year'], RANGE_LABEL[range]);
}

function activitySummaryPanel() {
  return libraryPanel('actSummary', 'Your last plays', null, null, UI.spotifyLib.recent, function (plays) {
    const minutes = Math.round(plays.reduce(function (s, t) { return s + (t.durationMs || 0); }, 0) / 60000);
    const counts = {};
    plays.forEach(function (t) { counts[t.artist] = (counts[t.artist] || 0) + 1; });
    const artists = Object.keys(counts);
    const top = artists.sort(function (a, b) { return counts[b] - counts[a]; })[0];
    const since = new Date(plays[plays.length - 1].playedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return '<div class="section__body--pad stack stack--sm">' +
      '<div class="cols cols--thirds">' +
        statTile('Minutes', minutes.toLocaleString('en-US')) +
        statTile('Artists', String(artists.length)) +
        statTile('Most played', top) +
      '</div>' +
      '<p class="t-caption c-tertiary">From your last ' + plays.length + ' plays on Spotify, since ' + esc(since) + '.</p>' +
    '</div>';
  });
}

function activityArtistsPanel() {
  const range = UI.activityRange;
  return libraryPanel('actArtists', 'Top artists', null, rangeTabs('activity-range', range), UI.spotifyLib.topArtists[range], function (artists) {
    return artists.slice(0, 10).map(function (a, i) {
      const inner = rankIndex(i) + art(artSeedFor(a.id), 'art--round', a.image) +
        '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(a.name) + '</span>' +
        (a.genres.length ? '<span class="t-body-s c-tertiary truncate">' + esc(a.genres.slice(0, 2).join(', ')) + '</span>' : '') +
        '</span>';
      return a.url && /^https:\/\/open\.spotify\.com\//.test(a.url)
        ? '<a class="row" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + inner + '</a>'
        : '<div class="row" style="cursor:default">' + inner + '</div>';
    }).join('');
  });
}

/* Genre share across your top artists. Hidden entirely when Spotify returns
   no genres, rather than showing an empty chart. */
function activityGenresPanel() {
  const entry = UI.spotifyLib.topArtists[UI.activityRange];
  const artists = entry && entry.data;
  const counts = {};
  let total = 0;
  (artists || []).forEach(function (a) {
    a.genres.forEach(function (g) { counts[g] = (counts[g] || 0) + 1; total++; });
  });
  if (!total) return '<div id="actGenres" hidden></div>';
  const colors = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)'];
  const sorted = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  const top = sorted.slice(0, 4).map(function (g, i) { return { name: g, n: counts[g], color: colors[i] }; });
  const rest = total - top.reduce(function (s, g) { return s + g.n; }, 0);
  if (rest > 0) top.push({ name: 'Other', n: rest, color: 'var(--text-tertiary)' });
  top.forEach(function (g) { g.pct = Math.round((g.n / total) * 100); });
  return '<section class="panel section" id="actGenres">' +
    sectionHead('Genre mix', 'top artists · ' + RANGE_LABEL[UI.activityRange].toLowerCase()) +
    '<div class="section__body section__body--pad stack">' +
      '<div class="distro">' + top.map(function (g) {
        return '<i style="width:' + g.pct + '%;background:' + g.color + '" data-tip="' + esc(g.name) + ' ' + g.pct + '%"></i>';
      }).join('') + '</div>' +
      '<div class="legend">' + top.map(function (g) {
        return '<div><em style="background:' + g.color + '"></em>' +
          '<span class="t-body-s c-secondary">' + esc(g.name) + '</span>' +
          '<span class="t-num c-tertiary">' + g.pct + '%</span></div>';
      }).join('') + '</div>' +
    '</div>' +
  '</section>';
}

function dayLabel(date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

function activityHistoryPanel() {
  return libraryPanel('actHistory', 'History', 'last 50 plays', null, UI.spotifyLib.recent, function (plays) {
    const days = [];
    plays.forEach(function (t) {
      const label = dayLabel(t.playedAt);
      let day = days[days.length - 1];
      if (!day || day.label !== label) { day = { label: label, items: [] }; days.push(day); }
      day.items.push(t);
    });
    return '<div class="section__body--pad"><div class="timeline">' + days.map(function (d, i) {
      return '<div class="timeline__day" data-today="' + (i === 0 && d.label === 'Today') + '">' +
        '<div class="timeline__label t-overline c-tertiary">' + esc(d.label) + '</div>' +
        d.items.map(function (t) {
          const time = new Date(t.playedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          return trackRow(t, '<span class="t-meta c-tertiary" style="width:38px;flex:none">' + time + '</span>');
        }).join('') +
      '</div>';
    }).join('') + '</div></div>';
  });
}

function musicRecentPanel() {
  return libraryPanel('musRecent', 'Recently played', null, null, UI.spotifyLib.recent, function (plays) {
    return plays.slice(0, 20).map(function (t) {
      return trackRow(t, null, '<span class="t-meta c-tertiary">' + esc(formatTimeAgo(t.playedAt)) + '</span>');
    }).join('');
  });
}

function musicTopPanel() {
  const range = UI.musicRange;
  return libraryPanel('musTop', 'Your top tracks', null, rangeTabs('music-range', range), UI.spotifyLib.topTracks[range], function (tracks) {
    return tracks.slice(0, 20).map(function (t, i) { return trackRow(t, rankIndex(i)); }).join('') +
      topTracksSaveBar(range, tracks);
  });
}

/* Your own and collaborative playlists open an in-app breakdown; followed
   ones link out, because Spotify won't hand their tracks to apps. */
function musicPlaylistsPanel() {
  const entry = UI.spotifyLib.playlists;
  const list = entry && entry.status === 'ok' ? entry.data : null;
  const open = list && list.filter(function (p) { return p.id === UI.playlistOpen; })[0];
  const own = list ? list.filter(function (p) { return p.readable; }).length : 0;
  return '<section class="panel section" id="musPlaylists">' +
    sectionHead('Playlists', list ? list.length + (own ? ' · ' + own + ' yours to explore' : '') : null) +
    (list && list.length
      ? '<div class="section__body section__body--pad stack">' + (open ? playlistDetail(open) : '') +
        '<div class="tilegrid">' + list.map(function (p) {
          const inner =
            '<div class="tile__art">' + art(artSeedFor(p.id), 'art--tile', p.image) + playlistTag(p) + '</div>' +
            '<div class="tile__meta">' +
              '<span class="t-body-m-med truncate">' + esc(p.name) + '</span>' +
              '<span class="t-body-s c-tertiary truncate">' + countLabel(p.count, 'track') + (p.owned ? '' : p.owner ? ' · ' + esc(p.owner) : '') + '</span>' +
            '</div>';
          if (p.readable) {
            return '<button class="panel tile" data-playlist-open="' + esc(p.id) + '" aria-pressed="' + (p.id === UI.playlistOpen) + '">' + inner + '</button>';
          }
          return p.url && /^https:\/\/open\.spotify\.com\//.test(p.url)
            ? '<a class="panel tile" href="' + esc(p.url) + '" target="_blank" rel="noopener" data-tip="Opens in Spotify">' + inner + '</a>'
            : '<article class="panel tile">' + inner + '</article>';
        }).join('') + '</div></div>'
      : '<div class="section__body">' + libraryBody(entry, function () { return ''; }) + '</div>') +
  '</section>';
}

/* [element id, renderer] pairs that paintLibraryPanels() swaps in place. */
const LIBRARY_PANELS = [
  ['actSummary', activitySummaryPanel],
  ['actArtists', activityArtistsPanel],
  ['actGenres', activityGenresPanel],
  ['actHistory', activityHistoryPanel],
  ['musRecent', musicRecentPanel],
  ['musTop', musicTopPanel],
  ['musPlaylists', musicPlaylistsPanel]
];

VIEWS.activity = function () {
  const gate = spotifyGate();
  return wrap(pageHead('How you listened', 'Activity'), gate ||
    activitySummaryPanel() +
    '<div class="cols cols--half">' +
      activityArtistsPanel() +
      '<div class="stack">' + activityGenresPanel() + activityHistoryPanel() + '</div>' +
    '</div>');
};

VIEWS.music = function () {
  const gate = spotifyGate();
  return wrap(pageHead('Your library', 'Music'), gate ||
    '<div class="cols cols--half">' + musicRecentPanel() + musicTopPanel() + '</div>' +
    musicPlaylistsPanel());
};

VIEWS.profile = function () {
  const me = DATA.me;
  const s = me.stats;
  const header =
    '<section class="panel section__body--pad" style="padding:22px">' +
      '<div class="rowflex" style="gap:18px;align-items:flex-start">' +
        '<div class="avatar-edit">' +
          avatarEl(me.initials, '72', null, me.avatarUrl) +
          '<label class="avatar-edit__btn" data-tip="Change photo" aria-label="Change profile photo">' +
            icon('camera', 14) +
            '<input type="file" id="avatarFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' +
          '</label>' +
        '</div>' +
        '<div class="stack stack--sm" style="flex:1;min-width:0;gap:6px">' +
          '<h2 class="t-title-l">' + esc(me.name) + '</h2>' +
          '<span class="t-meta c-tertiary">' + esc(me.username) + (me.joined ? ' · joined ' + esc(me.joined) : '') + '</span>' +
          (me.bio ? '<p class="t-body-m c-secondary" style="max-width:52ch;margin-top:4px">' + esc(me.bio) + '</p>' : '') +
        '</div>' +
      '</div>' +
      '<hr class="hr" style="margin:18px 0 16px">' +
      '<div class="cols cols--thirds">' +
        statTile('Tracks shared', s ? String(s.posts) : '—') +
        statTile('Friends', String(DATA.friends.length)) +
        statTile('Reactions received', s ? String(s.reactions) : '—') +
      '</div>' +
    '</section>';

  const shares = me.recentPosts.length
    ? '<section class="panel section">' + sectionHead('Your recent shares') +
        '<div class="section__body">' + me.recentPosts.map(function (p) { return postRow(p, false); }).join('') + '</div>' +
      '</section>'
    : ghostPanel('Your recent shares', sharePostButton(false));

  return wrap(pageHead('Your profile', 'Profile'), header + dnaSection() + shares);
};

function friendProfileLoading() {
  return '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading('Loading profile…') + '</div></section>';
}

function friendProfileHeader(profile, stats, relation) {
  const controls = relation.state === 'friends'
    ? '<span class="badge badge--positive">' + icon('check', 13) + 'Friends</span>' +
      '<button class="iconbtn" data-friend-remove="' + esc(relation.friendshipId) + '" data-tip="Remove friend" aria-label="Remove friend">' + icon('close', 16) + '</button>'
    : relation.state === 'incoming'
      ? '<button class="btn btn--primary btn--sm" data-friend-accept="' + esc(relation.friendshipId) + '">Accept</button>' +
        '<button class="btn btn--ghost btn--sm" data-friend-decline="' + esc(relation.friendshipId) + '">Decline</button>'
      : relation.state === 'outgoing'
        ? '<button class="btn btn--secondary btn--sm" data-friend-cancel="' + esc(relation.friendshipId) + '">Requested</button>'
        : '<button class="btn btn--primary btn--sm" data-friend-add="' + esc(profile.id) + '">' + icon('plus', 14) + 'Add friend</button>';

  const joinedDate = new Date(profile.created_at);
  const joined = joinedDate.toLocaleString('en-US', { month: 'long' }) + ' ' + joinedDate.getFullYear();

  return '<section class="panel section__body--pad" style="padding:22px">' +
    '<div class="rowflex" style="gap:18px;align-items:flex-start;flex-wrap:wrap">' +
      avatarEl(initialsFrom(profile.name), '72', null, profile.avatar_url) +
      '<div class="stack stack--sm" style="flex:1;min-width:180px;gap:6px">' +
        '<h2 class="t-title-l">' + esc(profile.name) + '</h2>' +
        '<span class="t-meta c-tertiary">@' + esc(profile.username) + ' · joined ' + esc(joined) + '</span>' +
        (profile.bio ? '<p class="t-body-m c-secondary" style="max-width:52ch;margin-top:4px">' + esc(profile.bio) + '</p>' : '') +
      '</div>' +
      '<div class="rowflex" style="gap:8px;flex:none">' + controls + '</div>' +
    '</div>' +
    '<hr class="hr" style="margin:18px 0 16px">' +
    '<div class="cols cols--thirds">' +
      statTile('Tracks shared', stats ? String(stats.posts) : '—') +
      statTile('Reactions received', stats ? String(stats.reactions) : '—') +
      statTile('Comments received', stats ? String(stats.comments) : '—') +
    '</div>' +
  '</section>';
}

VIEWS.friendProfile = function () {
  const username = friendProfileUsername();
  const state = UI.friendProfile;
  if (!state || state.username !== username || state.status === 'loading') {
    return wrap(pageHead('Profile', 'Loading…'), friendProfileLoading());
  }
  if (state.status === 'notfound') {
    return wrap(pageHead('Profile', 'Not found'), ghostPanel(null, findFriendsButton(true), 'No vortex profile found for “' + esc(username) + '”.'));
  }
  if (state.status === 'error') {
    return wrap(pageHead('Profile', 'Profile'), ghostPanel(null, null, 'Could not load this profile. Try again in a moment.'));
  }

  const profile = state.profile;
  const relation = relationshipWith(profile.id);
  const first = profile.name.split(/\s+/)[0];
  const shares = state.posts.length
    ? '<section class="panel section">' + sectionHead(first + '’s recent shares') +
        '<div class="section__body">' + state.posts.map(function (p) { return postRow(p, false); }).join('') + '</div>' +
      '</section>'
    : ghostPanel(first + '’s recent shares', null, 'Nothing shared yet.');

  return wrap(pageHead('Profile', esc(profile.name)),
    friendProfileHeader(profile, state.stats, relation) + friendDnaSectionAuto() + shares);
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
  return wrap(
    pageHead('Work in progress', 'Experimental <span class="badge badge--beta" style="vertical-align:5px;margin-left:8px">Beta</span>'),
    ghostPanel()
  );
};

VIEWS.settings = function () {
  function row(iconName, title, desc, control) {
    return '<div class="setting">' +
      '<span class="c-tertiary">' + icon(iconName, 18) + '</span>' +
      '<div class="setting__meta">' +
        '<span class="t-body-m-med">' + esc(title) + '</span>' +
        '<span class="t-body-s c-tertiary">' + esc(desc) + '</span>' +
      '</div>' + (control || '') +
    '</div>';
  }

  const account =
    '<section class="panel section">' + sectionHead('Account') +
      '<div class="section__body section__body--flush">' +
        row('user', 'Display name', DATA.me.name) +
        row('globe', 'Username', DATA.me.username) +
        row('mail', 'Email', DATA.me.email || '') +
      '</div>' +
    '</section>';

  const services =
    '<section class="panel section">' + sectionHead('Connected services') +
      '<div class="section__body section__body--flush">' +
        (spotify.auth.isConnected()
          ? row('spotify', 'Spotify', 'Connected · shows what you are playing', '<button class="btn btn--secondary btn--sm" data-action="spotify-disconnect">Disconnect</button>')
          : row('spotify', 'Spotify', 'Not connected', '<button class="btn btn--primary btn--sm" data-action="spotify-connect">Connect</button>')) +
      '</div>' +
    '</section>';

  const privacy =
    '<section class="panel section">' + sectionHead('Privacy') +
      '<div class="section__body section__body--flush">' +
        row('broadcast', 'Share what I\'m listening to',
          'Friends see your current Spotify track live while vortex is open. Spotify private sessions are never shared.',
          '<button class="toggle" data-toggle="share-listening" role="switch" aria-checked="' + !!DATA.me.shareListening + '" aria-label="Share what I am listening to"></button>') +
        row('sparkle', 'Share my music DNA',
          'Friends can compare tastes with you: your top 50 artists and tracks from the last ~6 months. Turning it off deletes the copy vortex keeps.',
          '<button class="toggle" data-toggle="share-taste" role="switch" aria-checked="' + !!DATA.me.shareTaste + '" aria-label="Share my music DNA"></button>') +
      '</div>' +
    '</section>';

  const session =
    '<section class="panel section">' + sectionHead('Session') +
      '<div class="section__body section__body--flush">' +
        row('logout', 'Log out', 'Sign out on this device only.', '<button class="btn btn--secondary btn--sm" data-action="logout">Log out</button>') +
      '</div>' +
    '</section>';

  return wrap(
    pageHead('Preferences', 'Settings'),
    '<div class="cols cols--half">' +
      '<div class="stack">' + account + privacy + '</div>' +
      '<div class="stack">' + services + session + '</div>' +
    '</div>'
  );
};
