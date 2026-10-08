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
   initials always sit underneath: if the photo 404s, app.js removes the
   broken <img> (no inline onerror, which the CSP forbids) and the initials show through. */
const AVATAR_URL = /^https:\/\/hpblrmnturpihyrhwzih\.supabase\.co\/storage\/v1\/object\/public\/avatars\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/;
function avatarEl(initials, size, status, image) {
  const cls = cx('avatar', size ? 'avatar--' + size : null);
  const photo = typeof image === 'string' && AVATAR_URL.test(image)
    ? '<img src="' + esc(image) + '" alt="" loading="lazy">' : '';
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
  return '<div class="tabs" role="tablist" data-tabs="' + name + '">' + items.map(function (item) {
    return '<button class="tab" role="tab" data-tab="' + esc(item) + '" aria-selected="' + (item === active) + '">' + esc(t(item)) + '</button>';
  }).join('') + '</div>';
}
function iconBtn(name, tip, cls, size) {
  return '<button class="' + cx('iconbtn', cls) + '" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' +
    icon(name, size || 17) + '</button>';
}

/* ---- shared pieces ------------------------------------------------------ */
/* A shared post as a compact row; showUser adds who shared it. */
function postRow(p, showUser) {
  return '<a class="row" href="#/p/' + encodeURIComponent(p.id) + '">' +
    art(p.art, null, p.image) +
    '<span class="row__meta">' +
      '<span class="t-body-m-med truncate">' + esc(p.track) + '</span>' +
      '<span class="t-body-s c-tertiary truncate">' + esc(p.artist) +
        (showUser ? ' · ' + (p.mine ? t('shared by you') : t('shared by {name}', { name: esc(p.user) })) : '') + '</span>' +
    '</span>' +
    '<span class="t-meta c-tertiary">' + esc(p.time) + '</span>' +
  '</a>';
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
    ? '<span class="friend__sub listening-live"><span class="eq eq--sm" aria-label="' + t('Listening now') + '"><i></i><i></i><i></i></span>' +
        '<span class="t-body-s c-secondary truncate">' + track + '</span></span>'
    : '<span class="t-body-s c-tertiary truncate">' + t('Played {track} · {ago}', { track: track, ago: esc(l.ago) }) + '</span>';
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
  feedScope: 'Friends',  // 'For you' | 'Friends'
  feedStatus: 'idle',  // 'loading' | 'ok' | 'error'
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
      '<button type="button" class="comment__reply" data-reply-to="' + esc(c.id) + '">' + t('Reply') + '</button>' +
    '</div>' +
  '</div>';
}

function replyForm(postId, threadId) {
  const r = UI.replyTo[postId];
  return '<form class="reply-node reply-form" data-comment-form="' + esc(postId) + '" data-parent-id="' + esc(threadId) + '" novalidate>' +
    avatarEl(DATA.me.initials, '24', null, DATA.me.avatarUrl) +
    '<span class="field field--sm">' +
      '<input type="text" name="content" placeholder="' + t('Reply to {name}…', { name: esc(r.name) }) + '" maxlength="500" autocomplete="off" ' +
        'aria-label="' + t('Reply to {name}', { name: esc(r.name) }) + '" value="' + esc(r.prefix) + '">' +
    '</span>' +
    '<button type="button" class="btn btn--ghost btn--sm" data-cancel-reply>' + t('Cancel') + '</button>' +
    '<button type="submit" class="btn btn--primary btn--sm">' + t('Reply') + '</button>' +
  '</form>';
}

function repliesToggle(threadId, count, open, inside) {
  return '<button type="button" class="' + cx('comment__toggle', inside && 'reply-node', open && 'comment__toggle--open') + '" ' +
    'data-toggle-replies="' + esc(threadId) + '" aria-expanded="' + open + '">' +
    icon('chevronDown', 14) + (open ? t('Hide replies') : tn(count, '{n} reply', '{n} replies')) +
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
    : '<p class="t-body-s c-tertiary">' + t('No comments yet. Say something.') + '</p>';
  return '<div class="post__comments">' +
    '<div class="post__comment-list">' + list + '</div>' +
    '<form class="post__comment-form" data-comment-form="' + esc(p.id) + '" novalidate>' +
      '<span class="field field--sm">' +
        '<input type="text" name="content" placeholder="' + t('Write a comment…') + '" maxlength="500" autocomplete="off" aria-label="' + t('Write a comment') + '">' +
      '</span>' +
      '<button type="submit" class="btn btn--primary btn--sm">' + t('Send') + '</button>' +
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
      (p.visibility === 'friends'
        ? '<span class="post__audience t-meta" data-tip="' + (p.mine ? t('Only you and your friends can see this') : t('Only {name}’s friends can see this', { name: esc(p.user) })) + '">' + icon('lock', 12) + t('Friends') + '</span>'
        : '') +
    '</span>';
  return '<article class="panel post" data-post="' + esc(p.id) + '">' +
    '<div class="post__head">' +
      (!p.mine && p.username
        ? '<a class="post__author" href="#/u/' + esc(p.username) + '">' + who + '</a>'
        : '<div class="post__author">' + who + '</div>') +
      '<span class="spacer"></span>' +
      '<span class="iconbtn" data-tip="' + esc(PLATFORM_LABEL[p.platform]) + '">' + icon(p.platform, 16) + '</span>' +
      shareLinkButton('#/p/' + p.id, t('Copy link to post')) +
      (p.mine
        ? '<button class="iconbtn" data-delete-post="' + esc(p.id) + '" data-tip="' + t('Delete post') + '" aria-label="' + t('Delete post') + '">' + icon('trash', 16) + '</button>'
        : p.username ? safetyTrigger({ id: p.userId, name: p.user, username: p.username }, p.id, t('More options for this post')) : '') +
    '</div>' +
    (p.note ? '<p class="post__note t-body-s c-secondary">' + esc(p.note) + '</p>' : '') +
    '<div class="post__track">' +
      art(p.art, 'art--lg', p.image) +
      '<span class="post__meta">' +
        '<span class="t-title-s truncate">' + esc(p.track) + '</span>' +
        '<span class="t-body-s c-secondary truncate">' + esc(p.artist) + (p.album ? ' · ' + esc(p.album) : '') + '</span>' +
        (p.clipStart != null && p.clipLen
          ? '<span class="t-meta c-tertiary post__clip">' + t('Clip {from}–{to}', { from: clipTime(p.clipStart), to: clipTime(p.clipStart + p.clipLen * 1000) }) + '</span>'
          : '') +
      '</span>' +
      (p.trackId && /^[A-Za-z0-9]{22}$/.test(p.trackId)
        ? '<span class="post__listen">' +
            '<a class="iconbtn" href="https://open.spotify.com/track/' + p.trackId + '" target="_blank" rel="noopener" ' +
              'data-tip="' + t('Open on Spotify') + '" aria-label="' + t('Open {track} on Spotify', { track: esc(p.track) }) + '">' + icon('spotify', 16) + '</a>' +
            clipButton(p) +
          '</span>'
        : '') +
    '</div>' +
    '<hr class="hr">' +
    '<div class="post__foot">' +
      '<button class="pill" data-react="flame" aria-label="' + t('Flame') + '" aria-pressed="' + p.reacted.flame + '">' +
        icon('flame', 14) + '<b>' + p.reactions.flame + '</b></button>' +
      '<button class="pill" data-react="heart" aria-label="' + t('Heart') + '" aria-pressed="' + p.reacted.heart + '">' +
        icon('heart', 14) + '<b>' + p.reactions.heart + '</b></button>' +
      '<button class="pill" data-comment aria-label="' + t('Comments') + '" aria-expanded="' + open + '">' +
        icon('comment', 14) + '<b>' + p.comments.length + '</b></button>' +
      '<span class="spacer"></span>' +
      '<span class="t-meta c-tertiary">' + tn(total, '{n} reaction', '{n} reactions') + '</span>' +
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
  return tn(n, '{n} ' + noun, '{n} ' + noun + 's');
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
    '<p class="t-body-m c-secondary">' + (hint ? esc(hint) : t('It\'s still a little quiet in here.. maybe you could check later?')) + '</p>' +
    (action ? '<div class="ghost-empty__actions">' + action + '</div>' : '') +
  '</div>';
}

/* Placeholder rows shaped like the list that's coming. */
const SKEL_WIDTHS = [[62, 38], [48, 30], [70, 44], [55, 34]];
function skeletonRows(n, label) {
  let rows = '';
  for (let i = 0; i < n; i++) {
    const w = SKEL_WIDTHS[i % SKEL_WIDTHS.length];
    rows += '<div class="skel-row"><span class="skel skel--art"></span><span class="skel-row__lines">' +
      '<span class="skel skel--line" style="width:' + w[0] + '%"></span>' +
      '<span class="skel skel--line skel--sub" style="width:' + w[1] + '%"></span></span></div>';
  }
  return '<div class="skel-list" role="status"><span class="sr-only">' + esc(label || t('Loading…')) + '</span>' +
    '<div aria-hidden="true">' + rows + '</div></div>';
}

function skeletonPosts(n) {
  let cards = '';
  for (let i = 0; i < n; i++) {
    cards += '<div class="panel post skel-post">' +
      '<div class="skel-row"><span class="skel skel--avatar"></span><span class="skel-row__lines">' +
        '<span class="skel skel--line" style="width:' + (30 + i * 9) + '%"></span>' +
        '<span class="skel skel--line skel--sub" style="width:14%"></span></span></div>' +
      '<div class="skel-row"><span class="skel skel--art-lg"></span><span class="skel-row__lines">' +
        '<span class="skel skel--line" style="width:' + (58 - i * 8) + '%"></span>' +
        '<span class="skel skel--line skel--sub" style="width:' + (36 + i * 5) + '%"></span></span></div>' +
    '</div>';
  }
  return '<div class="stack" role="status"><span class="sr-only">' + t('Loading posts…') + '</span><div class="stack" aria-hidden="true">' + cards + '</div></div>';
}

/* Something failed to load: say what, and offer the retry. */
function retryPanel(text, action) {
  return '<section class="panel section"><div class="empty">' +
    '<span class="empty__well">' + icon('repeat', 20) + '</span>' +
    '<p class="t-body-m c-secondary">' + esc(text) + '</p>' +
    '<button class="btn btn--secondary btn--sm" data-action="' + esc(action) + '">' + t('Try again') + '</button>' +
  '</div></section>';
}

function shareLinkButton(hash, label) {
  return '<button class="iconbtn" data-share-link="' + esc(hash) + '" data-tip="' + esc(label) + '" aria-label="' + esc(label) + '">' + icon('link', 16) + '</button>';
}

function ghostPanel(title, action, hint) {
  return '<section class="panel section">' + (title ? sectionHead(title) : '') + ghostEmpty(action, hint) + '</section>';
}

function sharePostButton(primary) {
  return '<button class="btn ' + (primary ? 'btn--primary' : 'btn--secondary') + ' btn--sm" data-action="new-post">' + icon('plus', 15) + t('Share a track') + '</button>';
}

function findFriendsButton(primary) {
  return '<button class="btn ' + (primary ? 'btn--primary' : 'btn--secondary') + ' btn--sm" data-nav="friends">' + icon('plus', 15) + t('Find friends') + '</button>';
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
        '<span class="t-overline c-tertiary">' + t('Now playing') + '</span>' +
        '<h2 class="t-display-m hero__title truncate">' + (connected ? t('Nothing playing') : t('Spotify not connected')) + '</h2>' +
        '<p class="t-body-l c-secondary">' + (connected
          ? t('Play something on Spotify and it shows up here.')
          : t('Connect your Spotify account to show what you are listening to.')) + '</p>' +
        '<div class="hero__controls">' + (connected
          ? '<span class="badge badge--positive"><span>' + icon('check', 13) + '</span>' + t('Spotify connected') + '</span>'
          : '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + icon('spotify', 15) + t('Connect Spotify') + '</button>') +
        '</div>' +
      '</div>' +
    '</section>';
  }

  const pct = np.duration ? Math.round((np.elapsed / np.duration) * 100) : 0;
  return '<section class="panel hero">' +
    art(np.art, 'art--xl', np.image) +
    '<div class="hero__body">' +
      '<span class="t-overline c-accent">' + (np.playing ? t('Now playing') : t('Paused')) + '</span>' +
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
        '<button class="btn btn--secondary btn--sm" data-action="share-now-playing">' + icon('broadcast', 15) + t('Share this track') + '</button>' +
        (np.url && /^https:\/\//.test(np.url) ? '<a class="btn btn--ghost btn--sm" href="' + esc(np.url) + '" target="_blank" rel="noopener">' + icon('arrowUpRight', 15) + t('Open in Spotify') + '</a>' : '') +
        '<span class="spacer"></span>' +
        '<span class="badge"><span>' + icon('headphones', 13) + '</span>' + esc(PLATFORM_LABEL[np.platform]) + '</span>' +
      '</div>' +
    '</div>' +
  '</section>';
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? t('Good night') : h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening');
  const first = (DATA.me.name || '').trim().split(/\s+/)[0];
  return first ? t('{greeting}, {name}', { greeting: part, name: esc(first) }) : part;
}

function statsRows() {
  const s = DATA.me.stats;
  const rows = [
    [t('Tracks shared'), s ? s.posts : null],
    [t('Friends'), DATA.friends.length],
    [t('Reactions received'), s ? s.reactions : null],
    [t('Comments received'), s ? s.comments : null]
  ];
  return rows.map(function (r) {
    return '<div class="rowflex">' +
      '<span class="t-body-s c-secondary">' + r[0] + '</span><span class="spacer"></span>' +
      '<span class="t-num">' + (r[1] == null ? '—' : r[1].toLocaleString(loc('en-US'))) + '</span>' +
    '</div>';
  }).join('');
}

function homeFriendsPanel() {
  if (!DATA.friends.length) {
    return '<div id="homeFriendsPanel">' + ghostPanel(t('Friends'), findFriendsButton(false)) + '</div>';
  }
  const live = DATA.friends.filter(function (f) { const l = listeningFor(f.id); return l && l.live; }).length;
  return '<section class="panel section" id="homeFriendsPanel">' +
    sectionHead(t('Friends'), live ? t('{n} listening now', { n: live }) : tn(DATA.friends.length, '{n} friend', '{n} friends'),
      '<button class="btn btn--ghost btn--sm" data-nav="friends">' + t('See all') + '</button>') +
    '<div class="section__body">' + friendsByListening().slice(0, 5).map(function (f) {
      const l = listeningFor(f.id);
      return personRow(f, null, listeningSub(l), l && l.live ? 'listening' : null);
    }).join('') + '</div>' +
  '</section>';
}

VIEWS.home = function () {
  const latest = DATA.feed.length
    ? '<section class="panel section">' +
        sectionHead(t('Latest from your circle'), null, '<button class="btn btn--ghost btn--sm" data-nav="feed">' + t('Open feed') + '</button>') +
        '<div class="section__body">' + DATA.feed.slice(0, 6).map(function (p) { return postRow(p, true); }).join('') + '</div>' +
      '</section>'
    : UI.feedStatus === 'loading'
      ? '<section class="panel section">' + sectionHead(t('Latest from your circle')) + '<div class="section__body">' + skeletonRows(4, t('Loading posts…')) + '</div></section>'
      : UI.feedStatus === 'error'
        ? retryPanel(t('Could not load the latest posts. Check your connection.'), 'feed-retry')
        : ghostPanel(t('Latest from your circle'), sharePostButton(true) + findFriendsButton(false));

  const friendsPanel = homeFriendsPanel();

  const statsPanel =
    '<section class="panel section">' +
      sectionHead(t('Your vortex')) +
      '<div class="section__body section__body--pad stack stack--sm">' + statsRows() + '</div>' +
    '</section>';

  return wrap(
    pageHead(new Date().toLocaleDateString(loc('en-GB'), { weekday: 'long', day: 'numeric', month: 'long' }), greeting(),
      sharePostButton(true)),
    heroPanel() + homeRecapPanel() +
    '<div class="cols cols--main-rail">' +
      '<div class="stack">' + latest + '</div>' +
      '<div class="stack">' + friendsPanel + statsPanel + '</div>' +
    '</div>'
  );
};

function feedEmpty() {
  if (UI.feedStatus === 'loading') return skeletonPosts(3);
  if (UI.feedStatus === 'error') return retryPanel(t('Could not load the feed. Check your connection.'), 'feed-retry');
  if (UI.feedScope === 'Friends' && !DATA.friends.length) {
    return ghostPanel(null, findFriendsButton(true) + sharePostButton(false),
      t('Friends shows posts from you and your friends. Add friends, or switch to For you.'));
  }
  if (UI.feedScope === 'For you') {
    return ghostPanel(null, sharePostButton(false), t('No public posts yet. Share a track and make it public to start For you.'));
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
      sectionHead(t('Most shared artists'), UI.feedScope === 'Friends' ? t('you & friends') : t('public posts')) +
      '<div class="section__body">' + artists.map(function (a, i) {
        return '<div class="row" style="cursor:default">' +
          '<span class="row__index">' + (i + 1) + '</span>' +
          art(a.art, 'art--round', a.image) +
          '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(a.name) + '</span>' +
          '<span class="t-body-s c-tertiary">' + tn(a.n, '{n} share', '{n} shares') + '</span></span>' +
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
      sectionHead(t('Top sharers'), t('last 7 days')) +
      '<div class="section__body">' + sharers.map(function (u, i) {
        const row = '<span class="row__index">' + (i + 1) + '</span>' +
          avatarEl(u.initials, '32', null, u.avatarUrl) +
          '<span class="row__meta"><span class="' + (u.mine ? 't-body-m-med c-accent' : 't-body-m-med') + ' truncate">' +
            (u.mine ? t('{name} (you)', { name: esc(u.name) }) : esc(u.name)) + '</span></span>' +
          '<span class="t-num c-secondary">' + u.n + '</span>';
        return !u.mine && u.username
          ? '<a class="row" href="#/u/' + esc(u.username) + '">' + row + '</a>'
          : '<div class="row" style="cursor:default">' + row + '</div>';
      }).join('') + '</div>' +
    '</section>');
  }

  return panels.length ? panels.join('') : ghostPanel(t('Insights'));
}

VIEWS.feed = function () {
  return wrap(
    pageHead(t('Live from your circle'), t('Feed'),
      tabsEl('feed', ['For you', 'Friends'], UI.feedScope) + sharePostButton(true)),
    '<div class="cols cols--feed">' +
      '<div class="stack">' + (DATA.feed.length ? DATA.feed.map(postCard).join('') : feedEmpty()) + '</div>' +
      '<div class="stack">' + friendsPinsPanel() + feedInsights() + '</div>' +
    '</div>'
  );
};

/* The friends screen is split into independently re-renderable blocks so an
   action (accept, add…) can refresh the lists without wiping the search box. */
function friendSearchControls(p) {
  const rel = relationshipWith(p.id);
  const fid = esc(rel.friendshipId || '');
  if (rel.state === 'friends') return '<span class="badge badge--positive"><span>' + icon('check', 13) + '</span>' + t('Friends') + '</span>';
  if (rel.state === 'incoming') return '<button class="btn btn--primary btn--sm" data-friend-accept="' + fid + '">' + t('Accept') + '</button>';
  if (rel.state === 'outgoing') return '<button class="btn btn--secondary btn--sm" data-friend-cancel="' + fid + '" data-tip="' + t('Cancel request') + '">' + t('Requested') + '</button>';
  return '<button class="btn btn--primary btn--sm" data-friend-add="' + esc(p.id) + '">' + icon('plus', 14) + t('Add') + '</button>';
}

function friendSearchResults() {
  const s = UI.friendSearch;
  if (s.q.replace(/^@/, '').trim().length < 2) return '<p class="t-body-s c-tertiary friends__hint">' + t('Type at least 2 letters of a name or @username.') + '</p>';
  if (s.loading && !s.results) return '<p class="t-body-s c-tertiary friends__hint">' + t('Searching…') + '</p>';
  if (s.error) return '<p class="t-body-s c-tertiary friends__hint">' + t('Search failed. Check your connection and try again.') + '</p>';
  if (!s.results || !s.results.length) return '<p class="t-body-s c-tertiary friends__hint">' + t('Nobody found for “{query}”.', { query: esc(s.q.trim()) }) + '</p>';
  return s.results.map(function (p) { return personRow(p, friendSearchControls(p)); }).join('');
}

function friendsListeningPanel() {
  if (!DATA.friends.length) return '<div id="friendsListeningPanel" hidden></div>';
  const live = friendsByListening().filter(function (f) { const l = listeningFor(f.id); return l && l.live; });
  return '<section class="panel section" id="friendsListeningPanel">' +
    sectionHead(t('Listening now'), live.length ? tn(live.length, '{n} friend', '{n} friends') : t('live')) +
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
            (href ? '<a href="' + href + '" target="_blank" rel="noopener" data-tip="' + t('Open in Spotify') + '" aria-label="' + t('Open {title} in Spotify', { title: esc(r.title) }) + '">' + cover + '</a>' : cover) +
          '</div>';
        }).join('')
      : '<p class="t-body-s c-tertiary friends__hint">' + t('None of your friends are playing anything right now. It updates live.') + '</p>') +
    '</div>' +
  '</section>';
}

function friendsListPanel() {
  return '<section class="panel section" id="friendsListPanel">' +
    sectionHead(t('Your friends'), tn(DATA.friends.length, '{n} friend', '{n} friends')) +
    '<div class="section__body">' + (DATA.friends.length
      ? friendsByListening().map(function (f) {
          const l = listeningFor(f.id);
          return personRow(f,
            '<a class="iconbtn" href="#/compare/' + esc(f.username) + '" data-tip="' + t('Compare tastes') + '" aria-label="' + t('Compare tastes with {name}', { name: esc(f.name) }) + '">' + icon('compare', 16) + '</a>' +
            '<button class="iconbtn" data-friend-remove="' + esc(f.friendshipId) + '" data-tip="' + t('Remove friend') + '" aria-label="' + t('Remove {name}', { name: esc(f.name) }) + '">' + icon('close', 16) + '</button>',
            listeningSub(l), l && l.live ? 'listening' : null);
        }).join('')
      : ghostEmpty(null, t('Search above to add someone. Once they accept, their posts show up in your feed.'))) +
    '</div>' +
  '</section>';
}

function friendRequestsPanel() {
  return '<section class="panel section" id="friendRequestsPanel">' +
    sectionHead(t('Requests'), String(DATA.incoming.length)) +
    '<div class="section__body">' + (DATA.incoming.length
      ? DATA.incoming.map(function (r) {
          return personRow(r,
            '<button class="iconbtn" data-friend-accept="' + esc(r.friendshipId) + '" data-tip="' + t('Accept') + '" aria-label="' + t('Accept {name}', { name: esc(r.name) }) + '">' + icon('check', 16) + '</button>' +
            '<button class="iconbtn" data-friend-decline="' + esc(r.friendshipId) + '" data-tip="' + t('Decline') + '" aria-label="' + t('Decline {name}', { name: esc(r.name) }) + '">' + icon('close', 16) + '</button>');
        }).join('')
      : '<p class="t-body-s c-tertiary friends__hint">' + t('No pending requests.') + '</p>') +
    '</div>' +
  '</section>';
}

function friendSentPanel() {
  return '<section class="panel section" id="friendSentPanel">' +
    sectionHead(t('Sent'), String(DATA.outgoing.length)) +
    '<div class="section__body">' + (DATA.outgoing.length
      ? DATA.outgoing.map(function (r) {
          return personRow(r, '<button class="btn btn--ghost btn--sm" data-friend-cancel="' + esc(r.friendshipId) + '">' + t('Cancel') + '</button>');
        }).join('')
      : '<p class="t-body-s c-tertiary friends__hint">' + t('Requests you send wait here until accepted.') + '</p>') +
    '</div>' +
  '</section>';
}

function myProfileHash() {
  return '#/u/' + DATA.me.username.replace(/^@/, '');
}

/* For people who aren't on vortex yet, or whose username you don't know. */
function inviteRow() {
  return '<div class="invite">' +
    '<span class="invite__meta">' +
      '<span class="t-body-m-med">' + t('Invite with your link') + '</span>' +
      '<span class="t-body-s c-tertiary truncate">' + esc(location.host + '/' + myProfileHash()) + '</span>' +
    '</span>' +
    '<button class="btn btn--secondary btn--sm" data-share-link="' + esc(myProfileHash()) + '">' + icon('link', 15) + t('Copy link') + '</button>' +
  '</div>';
}

VIEWS.friends = function () {
  const searchPanel =
    '<section class="panel section">' +
      sectionHead(t('Add friends')) +
      '<div class="section__body section__body--pad stack stack--sm">' +
        '<label class="field">' + icon('search', 16) +
          '<input type="search" id="friendSearch" placeholder="' + t('Search by name or @username') + '" aria-label="' + t('Search people') + '" autocomplete="off" maxlength="40" value="' + esc(UI.friendSearch.q) + '">' +
        '</label>' +
        '<div id="friendResults">' + friendSearchResults() + '</div>' +
        inviteRow() +
      '</div>' +
    '</section>';

  return wrap(
    pageHead(t('Your circle'), t('Friends')),
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
      '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + icon('spotify', 15) + t('Connect Spotify') + '</button>',
      t('Connect Spotify to see your listening here.'));
  }
  if (spotify.auth.missingScopes().length) {
    return ghostPanel(null,
      '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + icon('spotify', 15) + t('Reconnect Spotify') + '</button>',
      t('This page needs a few more Spotify permissions (recent plays, top artists and playlists). Reconnect once to allow them.'));
  }
  return null;
}

/* Loading / error / empty handling shared by every Spotify panel. */
function libraryBody(entry, render) {
  if (!entry || (entry.status === 'loading' && !entry.data)) return skeletonRows(5, t('Loading from Spotify…'));
  if (entry.status === 'error' && !entry.data) {
    return ghostEmpty(null, entry.error === 403
      ? t('Spotify refused this request. While the app is in development, only accounts on its tester list can use it.')
      : t('Could not reach Spotify. Try again in a moment.'));
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
  return libraryPanel('actSummary', t('Your last plays'), null, null, UI.spotifyLib.recent, function (plays) {
    const minutes = Math.round(plays.reduce(function (s, t) { return s + (t.durationMs || 0); }, 0) / 60000);
    const counts = {};
    plays.forEach(function (t) { counts[t.artist] = (counts[t.artist] || 0) + 1; });
    const artists = Object.keys(counts);
    const top = artists.sort(function (a, b) { return counts[b] - counts[a]; })[0];
    const since = new Date(plays[plays.length - 1].playedAt).toLocaleDateString(loc('en-GB'), { day: 'numeric', month: 'short' });
    return '<div class="section__body--pad stack stack--sm">' +
      '<div class="cols cols--thirds">' +
        statTile(t('Minutes'), minutes.toLocaleString(loc('en-US'))) +
        statTile(t('Artists'), String(artists.length)) +
        statTile(t('Most played'), top) +
      '</div>' +
      '<p class="t-caption c-tertiary">' + t('From your last {n} plays on Spotify, since {date}.', { n: plays.length, date: esc(since) }) + '</p>' +
    '</div>';
  });
}

function activityArtistsPanel() {
  const range = UI.activityRange;
  return libraryPanel('actArtists', t('Top artists'), null, rangeTabs('activity-range', range), UI.spotifyLib.topArtists[range], function (artists) {
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
  if (rest > 0) top.push({ name: t('Other'), n: rest, color: 'var(--text-tertiary)' });
  top.forEach(function (g) { g.pct = Math.round((g.n / total) * 100); });
  return '<section class="panel section" id="actGenres">' +
    sectionHead(t('Genre mix'), t('top artists · {range}', { range: t(RANGE_LABEL[UI.activityRange]).toLowerCase() })) +
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
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Yesterday');
  return new Date(date).toLocaleDateString(loc('en-GB'), { weekday: 'long', day: 'numeric', month: 'short' });
}

function activityHistoryPanel() {
  return libraryPanel('actHistory', t('History'), t('last 50 plays'), null, UI.spotifyLib.recent, function (plays) {
    const days = [];
    plays.forEach(function (t) {
      const label = dayLabel(t.playedAt);
      let day = days[days.length - 1];
      if (!day || day.label !== label) { day = { label: label, items: [] }; days.push(day); }
      day.items.push(t);
    });
    return '<div class="section__body--pad"><div class="timeline">' + days.map(function (d, i) {
      return '<div class="timeline__day" data-today="' + (i === 0 && d.label === t('Today')) + '">' +
        '<div class="timeline__label t-overline c-tertiary">' + esc(d.label) + '</div>' +
        d.items.map(function (t) {
          const time = new Date(t.playedAt).toLocaleTimeString(loc('en-GB'), { hour: '2-digit', minute: '2-digit' });
          return trackRow(t, '<span class="t-meta c-tertiary" style="width:38px;flex:none">' + time + '</span>');
        }).join('') +
      '</div>';
    }).join('') + '</div></div>';
  });
}

function musicRecentPanel() {
  return libraryPanel('musRecent', t('Recently played'), null, null, UI.spotifyLib.recent, function (plays) {
    return plays.slice(0, 20).map(function (t) {
      return trackRow(t, null, '<span class="t-meta c-tertiary">' + esc(formatTimeAgo(t.playedAt)) + '</span>');
    }).join('');
  });
}

function musicTopPanel() {
  const range = UI.musicRange;
  return libraryPanel('musTop', t('Your top tracks'), null, rangeTabs('music-range', range), UI.spotifyLib.topTracks[range], function (tracks) {
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
    sectionHead(t('Playlists'), list ? (own ? t('{count} · {own} yours to explore', { count: list.length, own: own }) : String(list.length)) : null) +
    (list && list.length
      ? '<div class="section__body section__body--pad stack">' + (open ? playlistDetail(open) : '') +
        '<div class="tilegrid">' + list.map(function (p) {
          const inner =
            '<div class="tile__art">' + art(artSeedFor(p.id), 'art--tile', p.image) + playlistTag(p) + '</div>' +
            '<div class="tile__meta">' +
              '<span class="t-body-m-med truncate">' + esc(p.name) + '</span>' +
              '<span class="t-body-s c-tertiary truncate">' + tn(p.count, '{n} track', '{n} tracks') + (p.owned ? '' : p.owner ? ' · ' + esc(p.owner) : '') + '</span>' +
            '</div>';
          if (p.readable) {
            return '<button class="panel tile" data-playlist-open="' + esc(p.id) + '" aria-pressed="' + (p.id === UI.playlistOpen) + '">' + inner + '</button>';
          }
          return p.url && /^https:\/\/open\.spotify\.com\//.test(p.url)
            ? '<a class="panel tile" href="' + esc(p.url) + '" target="_blank" rel="noopener" data-tip="' + t('Opens in Spotify') + '">' + inner + '</a>'
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
  return wrap(pageHead(t('How you listened'), t('Activity')), gate ||
    activitySummaryPanel() +
    '<div class="cols cols--half">' +
      activityArtistsPanel() +
      '<div class="stack">' + activityGenresPanel() + activityHistoryPanel() + '</div>' +
    '</div>');
};

VIEWS.music = function () {
  const gate = spotifyGate();
  return wrap(pageHead(t('Your library'), t('Music')), gate ||
    '<div class="cols cols--half">' + musicRecentPanel() + musicTopPanel() + '</div>' +
    musicPlaylistsPanel());
};

VIEWS.profile = function () {
  const me = DATA.me;
  const s = me.stats;
  const mural = myMural();
  const header =
    '<section class="' + cx('panel phead', muralBannerId(mural) !== 'none' && 'phead--banner') + '">' + muralBanner(mural, app.session.user.id) +
      '<div class="rowflex phead__top" style="gap:18px;align-items:flex-start;flex-wrap:wrap">' +
        '<div class="avatar-edit">' +
          avatarEl(me.initials, '72', null, me.avatarUrl) +
          '<label class="avatar-edit__btn" data-tip="' + t('Change photo') + '" aria-label="' + t('Change profile photo') + '">' +
            icon('camera', 14) +
            '<input type="file" id="avatarFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' +
          '</label>' +
        '</div>' +
        '<div class="stack stack--sm" style="flex:1;min-width:180px;gap:6px">' +
          '<h2 class="t-title-l">' + esc(me.name) + '</h2>' +
          '<span class="t-meta c-tertiary">' + esc(me.username) + (me.joined ? ' · ' + t('joined {date}', { date: esc(me.joined) }) : '') + '</span>' +
          (me.bio
            ? '<p class="t-body-m c-secondary" style="max-width:52ch;margin-top:4px">' + esc(me.bio) + '</p>'
            : '<button class="profile__addbio t-body-s" data-action="profile-edit" data-focus="editBio">' + icon('plus', 13) + t('Add a bio') + '</button>') +
        '</div>' +
        '<div class="rowflex" style="gap:8px;flex:none">' +
          shareLinkButton(myProfileHash(), t('Copy profile link')) +
          '<button class="btn btn--secondary btn--sm" data-action="profile-edit">' + t('Edit profile') + '</button>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:18px">' + (me.pin ? pinCard(me.pin, true) : pinInvite()) + '</div>' +
      '<hr class="hr" style="margin:18px 0 16px">' +
      '<div class="cols cols--thirds">' +
        statTile(t('Tracks shared'), s ? String(s.posts) : '—') +
        statTile(t('Friends'), String(DATA.friends.length)) +
        statTile(t('Reactions received'), s ? String(s.reactions) : '—') +
      '</div>' +
    '</section>';

  const shares = me.recentPosts.length
    ? '<section class="panel section">' + sectionHead(t('Your recent shares')) +
        '<div class="section__body">' + me.recentPosts.map(function (p) { return postRow(p, false); }).join('') + '</div>' +
      '</section>'
    : ghostPanel(t('Your recent shares'), sharePostButton(false));

  return wrap(pageHead(t('Your profile'), t('Profile')), header + muralProfileSection(mural, app.session.user.id, true) + dnaSection() + shares);
};

function friendProfileLoading() {
  return '<section class="panel section__body--pad" style="padding:22px" role="status"><span class="sr-only">' + t('Loading profile…') + '</span>' +
    '<div class="skel-row" aria-hidden="true"><span class="skel skel--avatar-xl"></span><span class="skel-row__lines">' +
      '<span class="skel skel--title" style="width:40%"></span><span class="skel skel--line skel--sub" style="width:26%"></span></span></div>' +
  '</section>';
}

function friendProfileHeader(profile, stats, relation) {
  const controls = relation.state === 'friends'
    ? compareButton(profile.username, true) +
      '<span class="badge badge--positive">' + icon('check', 13) + t('Friends') + '</span>' +
      '<button class="iconbtn" data-friend-remove="' + esc(relation.friendshipId) + '" data-tip="' + t('Remove friend') + '" aria-label="' + t('Remove friend') + '">' + icon('close', 16) + '</button>'
    : relation.state === 'incoming'
      ? '<button class="btn btn--primary btn--sm" data-friend-accept="' + esc(relation.friendshipId) + '">' + t('Accept') + '</button>' +
        '<button class="btn btn--ghost btn--sm" data-friend-decline="' + esc(relation.friendshipId) + '">' + t('Decline') + '</button>'
      : relation.state === 'outgoing'
        ? '<button class="btn btn--secondary btn--sm" data-friend-cancel="' + esc(relation.friendshipId) + '">' + t('Requested') + '</button>'
        : '<button class="btn btn--primary btn--sm" data-friend-add="' + esc(profile.id) + '">' + icon('plus', 14) + t('Add friend') + '</button>';

  const joinedDate = new Date(profile.created_at);
  const joined = t('{month} {year}', { month: joinedDate.toLocaleString(loc('en-US'), { month: 'long' }), year: joinedDate.getFullYear() });

  const mural = muralFromRow(profile.mural);
  return '<section class="' + cx('panel phead', muralBannerId(mural) !== 'none' && 'phead--banner') + '">' + muralBanner(mural, profile.id) +
    '<div class="rowflex phead__top" style="gap:18px;align-items:flex-start;flex-wrap:wrap">' +
      avatarEl(initialsFrom(profile.name), '72', null, profile.avatar_url) +
      '<div class="stack stack--sm" style="flex:1;min-width:180px;gap:6px">' +
        '<h2 class="t-title-l">' + esc(profile.name) + '</h2>' +
        '<span class="t-meta c-tertiary">@' + esc(profile.username) + ' · ' + t('joined {date}', { date: esc(joined) }) + '</span>' +
        (profile.bio ? '<p class="t-body-m c-secondary" style="max-width:52ch;margin-top:4px">' + esc(profile.bio) + '</p>' : '') +
      '</div>' +
      '<div class="rowflex" style="gap:8px;flex:none;flex-wrap:wrap">' + shareLinkButton('#/u/' + profile.username, t('Copy profile link')) + controls +
        safetyTrigger({ id: profile.id, name: profile.name, username: profile.username }, null, t('More options for {name}', { name: profile.name })) + '</div>' +
    '</div>' +
    (pinFromRow(profile) ? '<div style="margin-top:18px">' + pinCard(pinFromRow(profile), false) + '</div>' : '') +
    '<hr class="hr" style="margin:18px 0 16px">' +
    '<div class="cols cols--thirds">' +
      statTile(t('Tracks shared'), stats ? String(stats.posts) : '—') +
      statTile(t('Reactions received'), stats ? String(stats.reactions) : '—') +
      statTile(t('Comments received'), stats ? String(stats.comments) : '—') +
    '</div>' +
  '</section>';
}

/* person: anything with id, name, username, and avatar_url or avatarUrl. */
function blockedPanel(person) {
  const first = person.name.split(/\s+/)[0];
  return '<section class="panel blocked">' +
    avatarEl(initialsFrom(person.name), '56', null, person.avatar_url || person.avatarUrl) +
    '<div class="blocked__meta">' +
      '<span class="t-title-s">' + t('You blocked {name}', { name: esc(first) }) + '</span>' +
      '<span class="t-body-s c-secondary">' + t('Their posts and comments are hidden from you, and @{username} can’t add you or interact with your posts.', { username: esc(person.username) }) + '</span>' +
    '</div>' +
    '<button class="btn btn--secondary btn--sm" data-safety-unblock="' + esc(person.id) + '">' + t('Unblock') + '</button>' +
  '</section>';
}

VIEWS.friendProfile = function () {
  const username = friendProfileUsername();
  const state = UI.friendProfile;
  if (!state || state.username !== username || state.status === 'loading') {
    return wrap(pageHead(t('Profile'), t('Loading…')), friendProfileLoading());
  }
  if (state.status === 'notfound') {
    return wrap(pageHead(t('Profile'), t('Not found')), ghostPanel(null, findFriendsButton(true), t('No vortex profile found for “{username}”.', { username: username })));
  }
  if (state.status === 'error') {
    return wrap(pageHead(t('Profile'), t('Profile')), ghostPanel(null, null, t('Could not load this profile. Try again in a moment.')));
  }

  const profile = state.profile;
  if (isBlocked(profile.id)) return wrap(pageHead(t('Profile'), esc(profile.name)), blockedPanel(profile));
  const relation = relationshipWith(profile.id);
  const first = profile.name.split(/\s+/)[0];
  const shares = state.posts.length
    ? '<section class="panel section">' + sectionHead(t('{name}’s recent shares', { name: first })) +
        '<div class="section__body">' + state.posts.map(function (p) { return postRow(p, false); }).join('') + '</div>' +
      '</section>'
    : ghostPanel(t('{name}’s recent shares', { name: first }), null, t('Nothing shared yet.'));

  return wrap(pageHead(t('Profile'), esc(profile.name)),
    friendProfileHeader(profile, state.stats, relation) + muralProfileSection(muralFromRow(profile.mural), profile.id, false) + friendDnaSectionAuto() + shares);
};

VIEWS.experimental = function () {
  return wrap(
    pageHead(t('Work in progress'), t('Experimental') + ' <span class="badge badge--beta" style="vertical-align:5px;margin-left:8px">' + t('Beta') + '</span>'),
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
    '<section class="panel section">' + sectionHead(t('Account'), null, '<button class="btn btn--ghost btn--sm" data-action="profile-edit">' + t('Edit') + '</button>') +
      '<div class="section__body section__body--flush">' +
        row('user', t('Display name'), DATA.me.name) +
        row('globe', t('Username'), DATA.me.username) +
        row('mail', t('Email'), DATA.me.email || '') +
        row('lock', t('Password'), t('Pick a new one without logging out.'), '<a class="btn btn--secondary btn--sm" href="#/reset">' + t('Change') + '</a>') +
      '</div>' +
    '</section>';

  const blocked = DATA.blocked.length
    ? '<section class="panel section">' + sectionHead(t('Blocked accounts'), String(DATA.blocked.length)) +
        '<div class="section__body">' + DATA.blocked.map(function (b) {
          return personRow(b, '<button class="btn btn--secondary btn--sm" data-safety-unblock="' + esc(b.id) + '">' + t('Unblock') + '</button>');
        }).join('') + '</div>' +
      '</section>'
    : '';

  const services =
    '<section class="panel section">' + sectionHead(t('Connected services')) +
      '<div class="section__body section__body--flush">' +
        (spotify.auth.isConnected()
          ? row('spotify', 'Spotify', t('Connected · shows what you are playing'), '<button class="btn btn--secondary btn--sm" data-action="spotify-disconnect">' + t('Disconnect') + '</button>')
          : row('spotify', 'Spotify', t('Not connected'), '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + t('Connect') + '</button>')) +
      '</div>' +
    '</section>';

  const privacy =
    '<section class="panel section">' + sectionHead(t('Privacy')) +
      '<div class="section__body section__body--flush">' +
        row('broadcast', t('Share what I\'m listening to'),
          t('Friends see your current Spotify track live while vortex is open. Spotify private sessions are never shared.'),
          '<button class="toggle" data-toggle="share-listening" role="switch" aria-checked="' + !!DATA.me.shareListening + '" aria-label="' + t('Share what I am listening to') + '"></button>') +
        row('sparkle', t('Share my music DNA'),
          t('Friends can compare tastes with you: your top 50 artists and tracks from the last ~6 months. Turning it off deletes the copy vortex keeps.'),
          '<button class="toggle" data-toggle="share-taste" role="switch" aria-checked="' + !!DATA.me.shareTaste + '" aria-label="' + t('Share my music DNA') + '"></button>') +
        row('lock', t('Privacy policy'), t('What vortex keeps, who can see it, and how to delete your account.'),
          '<a class="btn btn--secondary btn--sm" href="' + PRIVACY_URL + '" target="_blank" rel="noopener">' + t('Read') + '</a>') +
      '</div>' +
    '</section>';

  // Each language is named in itself, so it's findable whichever one is showing.
  const language =
    '<section class="panel section">' + sectionHead(t('Language')) +
      '<div class="section__body section__body--flush">' +
        row('globe', t('App language'), t('Choose the language vortex uses on this device.'),
          '<div class="tabs" role="radiogroup" aria-label="' + esc(t('Language')) + '">' +
            Object.keys(LANGS).map(function (k) {
              return '<button class="tab" role="radio" lang="' + (k === 'pt' ? 'pt-BR' : 'en') + '" data-lang-pick="' + k + '" aria-checked="' + (k === LANG) + '">' + LANGS[k] + '</button>';
            }).join('') +
          '</div>') +
      '</div>' +
    '</section>';

  const session =
    '<section class="panel section">' + sectionHead(t('Session')) +
      '<div class="section__body section__body--flush">' +
        row('logout', t('Log out'), t('Sign out on this device only.'), '<button class="btn btn--secondary btn--sm" data-action="logout">' + t('Log out') + '</button>') +
      '</div>' +
    '</section>';

  return wrap(
    pageHead(t('Preferences'), t('Settings')),
    '<div class="cols cols--half">' +
      '<div class="stack">' + account + privacy + blocked + '</div>' +
      '<div class="stack">' + services + language + session + '</div>' +
    '</div>'
  );
};
