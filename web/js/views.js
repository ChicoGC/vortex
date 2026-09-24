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

function personRow(p, controls) {
  return '<div class="friend" style="cursor:default">' +
    avatarEl(p.initials, '32') +
    '<span class="friend__meta">' +
      '<span class="t-body-m-med truncate">' + esc(p.name) + '</span>' +
      '<span class="t-body-s c-tertiary truncate">@' + esc(p.username) + '</span>' +
    '</span>' + (controls || '') +
  '</div>';
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
  friendSearch: { q: '', results: null, loading: false, error: false }
};

function commentText(text) {
  // A leading @mention (added when replying to a reply) is highlighted.
  return esc(text).replace(/^@[\w.-]+/, function (m) { return '<span class="c-accent">' + m + '</span>'; });
}

/* hasLine: this top-level comment has replies or a reply box shown under it,
   so its avatar grows a connector line down into them. */
function commentEl(c, hasLine, extraClass) {
  return '<div class="' + cx('comment', extraClass) + '">' +
    '<div class="comment__rail">' + avatarEl(c.initials, '24') + (hasLine ? '<span class="comment__line"></span>' : '') + '</div>' +
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
    avatarEl(DATA.me.initials, '24') +
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
  return '<article class="panel post" data-post="' + esc(p.id) + '">' +
    '<div class="post__head">' +
      avatarEl(p.initials, '32') +
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

VIEWS.home = function () {
  const latest = DATA.feed.length
    ? '<section class="panel section">' +
        sectionHead('Latest from your circle', null, '<button class="btn btn--ghost btn--sm" data-nav="feed">Open feed</button>') +
        '<div class="section__body">' + DATA.feed.slice(0, 6).map(function (p) { return postRow(p, true); }).join('') + '</div>' +
      '</section>'
    : ghostPanel('Latest from your circle', sharePostButton(true) + findFriendsButton(false));

  const friendsPanel = DATA.friends.length
    ? '<section class="panel section">' +
        sectionHead('Friends', countLabel(DATA.friends.length, 'friend'),
          '<button class="btn btn--ghost btn--sm" data-nav="friends">See all</button>') +
        '<div class="section__body">' + DATA.friends.slice(0, 5).map(function (f) { return personRow(f); }).join('') + '</div>' +
      '</section>'
    : ghostPanel('Friends', findFriendsButton(false));

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
    const u = byUser[p.user] || (byUser[p.user] = { name: p.user, initials: p.initials, mine: p.mine, n: 0 });
    u.n++;
  });
  const sharers = Object.keys(byUser).map(function (k) { return byUser[k]; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
  if (sharers.length >= 2) {
    panels.push('<section class="panel section">' +
      sectionHead('Top sharers', 'last 7 days') +
      '<div class="section__body">' + sharers.map(function (u, i) {
        return '<div class="row" style="cursor:default">' +
          '<span class="row__index">' + (i + 1) + '</span>' +
          avatarEl(u.initials, '32') +
          '<span class="row__meta"><span class="' + (u.mine ? 't-body-m-med c-accent' : 't-body-m-med') + ' truncate">' +
            esc(u.name) + (u.mine ? ' (you)' : '') + '</span></span>' +
          '<span class="t-num c-secondary">' + u.n + '</span>' +
        '</div>';
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

function friendsListPanel() {
  return '<section class="panel section" id="friendsListPanel">' +
    sectionHead('Your friends', countLabel(DATA.friends.length, 'friend')) +
    '<div class="section__body">' + (DATA.friends.length
      ? DATA.friends.map(function (f) {
          return personRow(f, '<button class="iconbtn" data-friend-remove="' + esc(f.friendshipId) + '" data-tip="Remove friend" aria-label="Remove ' + esc(f.name) + '">' + icon('close', 16) + '</button>');
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
      '<div class="stack">' + searchPanel + friendsListPanel() + '</div>' +
      '<div class="stack">' + friendRequestsPanel() + friendSentPanel() + '</div>' +
    '</div>'
  );
};

VIEWS.activity = function () {
  return wrap(pageHead('How you listened', 'Activity'), ghostPanel());
};

VIEWS.music = function () {
  return wrap(pageHead('Your library', 'Music'), ghostPanel());
};

VIEWS.profile = function () {
  const me = DATA.me;
  const s = me.stats;
  const header =
    '<section class="panel section__body--pad" style="padding:22px">' +
      '<div class="rowflex" style="gap:18px;align-items:flex-start">' +
        avatarEl(me.initials, '72') +
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

  return wrap(pageHead('Your profile', 'Profile'), header + shares);
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

  const session =
    '<section class="panel section">' + sectionHead('Session') +
      '<div class="section__body section__body--flush">' +
        row('logout', 'Log out', 'Sign out on this device only.', '<button class="btn btn--secondary btn--sm" data-action="logout">Log out</button>') +
      '</div>' +
    '</section>';

  return wrap(
    pageHead('Preferences', 'Settings'),
    '<div class="cols cols--half">' +
      '<div class="stack">' + account + '</div>' +
      '<div class="stack">' + services + session + '</div>' +
    '</div>'
  );
};
