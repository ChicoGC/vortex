/* ==========================================================================
   vortex — notifications, single post, song of the moment, taste compare
   ========================================================================== */

UI.postView = null;        // { id, status: 'loading'|'ok'|'notfound'|'error', post }
UI.notifFresh = {};        // ids that were unread when the list was opened

/* ---- song of the moment ----------------------------------------------------- */
/* Profiles are written by their owners' browsers: re-check every field. */
function pinFromRow(p) {
  if (!p || typeof p.pin_title !== 'string' || typeof p.pin_artist !== 'string' || !p.pin_title || !p.pin_artist) return null;
  return {
    trackId: DNA_ID.test(p.pin_track_id || '') ? p.pin_track_id : null,
    title: p.pin_title.slice(0, 200),
    artist: p.pin_artist.slice(0, 200),
    image: dnaCover(p.pin_image),
    note: typeof p.pin_note === 'string' ? p.pin_note.slice(0, 140) : '',
    at: p.pinned_at || null
  };
}

function pinSleeve(pin, cls) {
  return '<span class="' + cx('pin__sleeve', cls) + '" aria-hidden="true"><span class="pin__disc"></span>' +
    art(artSeedFor(pin.trackId || pin.title), 'pin__cover', pin.image) + '</span>';
}

function pinCard(pin, own) {
  const href = spotifyTrackUrl(pin.trackId);
  return '<div class="pin">' +
    pinSleeve(pin) +
    '<div class="pin__meta">' +
      '<span class="pin__kicker t-label-s">' + icon('pin', 13) + 'Song of the moment' +
        (pin.at ? '<span class="c-tertiary">' + esc(formatTimeAgo(pin.at)) + '</span>' : '') + '</span>' +
      '<span class="t-title-s truncate">' + esc(pin.title) + '</span>' +
      '<span class="t-body-s c-secondary truncate">' + esc(pin.artist) + '</span>' +
      (pin.note ? '<p class="t-body-s c-secondary pin__note">' + esc(pin.note) + '</p>' : '') +
    '</div>' +
    '<div class="pin__actions">' +
      (href ? '<a class="post__play" href="' + href + '" target="_blank" rel="noopener" data-tip="Play on Spotify" aria-label="Play ' + esc(pin.title) + ' on Spotify">' + icon('play', 15) + '</a>' : '') +
      (own
        ? '<button class="btn btn--secondary btn--sm" data-action="pin-edit">Change</button>' +
          '<button class="iconbtn" data-action="pin-clear" data-tip="Unpin" aria-label="Unpin this song">' + icon('close', 16) + '</button>'
        : '') +
    '</div>' +
  '</div>';
}

function pinInvite() {
  return '<button class="pin pin--empty" data-action="pin-edit">' +
    '<span class="pin__sleeve pin__sleeve--empty" aria-hidden="true">' + icon('disc', 22) + '</span>' +
    '<span class="pin__meta">' +
      '<span class="t-body-m-med">Pin your song of the moment</span>' +
      '<span class="t-body-s c-tertiary">It sits at the top of your profile, so friends see what you\'re into right now.</span>' +
    '</span>' +
    '<span class="btn btn--primary btn--sm">' + icon('pin', 15) + 'Pin a song</span>' +
  '</button>';
}

/* Feed side rail: friends' pinned songs, newest first. */
function friendsPinsPanel() {
  const pinned = DATA.friends.filter(function (f) { return f.pin; })
    .sort(function (a, b) { return Date.parse(b.pin.at || 0) - Date.parse(a.pin.at || 0); }).slice(0, 6);
  if (!pinned.length) return '';
  return '<section class="panel section">' + sectionHead('Songs of the moment', 'pinned by friends') +
    '<div class="section__body">' + pinned.map(function (f) {
      const href = spotifyTrackUrl(f.pin.trackId);
      return '<div class="row pinrow">' +
        '<a class="pinrow__who" href="#/u/' + esc(f.username) + '" data-tip="' + esc(f.name) + '">' + avatarEl(f.initials, '24', null, f.avatarUrl) + '</a>' +
        art(artSeedFor(f.pin.trackId || f.pin.title), null, f.pin.image) +
        '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(f.pin.title) + '</span>' +
          '<span class="t-body-s c-tertiary truncate">' + esc(f.pin.artist) + ' · ' + esc(f.name.split(/\s+/)[0]) + '</span></span>' +
        (href ? '<a class="iconbtn" href="' + href + '" target="_blank" rel="noopener" data-tip="Play on Spotify" aria-label="Play ' + esc(f.pin.title) + ' on Spotify">' + icon('play', 14) + '</a>' : '') +
      '</div>';
    }).join('') + '</div>' +
  '</section>';
}

/* ---- pin form --------------------------------------------------------------- */
function pinFormMarkup() {
  const np = DATA.nowPlaying;
  const connected = spotify.auth.isConnected();
  return '<div class="scrim" data-scrim>' +
    '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pinFormTitle">' +
      '<div class="modal__head">' +
        '<span class="toast__well toast__well--info">' + icon('pin', 15) + '</span>' +
        '<h2 class="t-title-s" id="pinFormTitle">Pin a song</h2>' +
      '</div>' +
      '<form id="pinForm" class="modal__body" novalidate>' +
        '<div class="auth__note auth__note--error" id="pinError" hidden>' + icon('close', 16) +
          '<p class="t-body-s c-secondary" id="pinErrorText"></p></div>' +
        (np.status === 'track'
          ? '<button type="button" class="btn btn--secondary btn--sm" data-action="pin-use-np" style="justify-content:flex-start;min-width:0">' +
              icon('spotify', 15) + '<span class="truncate">Use what\'s playing: ' + esc(np.title) + ' · ' + esc(np.artist) + '</span></button>'
          : '') +
        (connected
          ? '<div class="auth__field">' +
              '<label class="t-label-m c-secondary" for="pinSearch">Find the song</label>' +
              '<span class="field">' + icon('search', 17) +
                '<input id="pinSearch" type="search" placeholder="Search Spotify" autocomplete="off" maxlength="100"></span>' +
              '<div class="post-search" id="pinResults"></div>' +
            '</div>'
          : '<div class="auth__field">' +
              '<label class="t-label-m c-secondary" for="pinTitle">Song</label>' +
              '<span class="field">' + icon('disc', 17) + '<input id="pinTitle" type="text" placeholder="Song name" maxlength="200"></span>' +
            '</div>' +
            '<div class="auth__field">' +
              '<label class="t-label-m c-secondary" for="pinArtist">Artist</label>' +
              '<span class="field">' + icon('user', 17) + '<input id="pinArtist" type="text" placeholder="Artist name" maxlength="200"></span>' +
            '</div>' +
            '<p class="t-body-s c-tertiary"><button type="button" class="btn btn--ghost btn--sm" data-action="spotify-connect" style="display:inline-flex;padding:0 4px">Connect Spotify</button> to search and show the cover.</p>') +
        '<div id="pinPicked"></div>' +
        '<div class="auth__field">' +
          '<label class="t-label-m c-secondary" for="pinNote">Why this one?</label>' +
          '<span class="field field--area">' + icon('comment', 17) +
            '<textarea id="pinNote" placeholder="Optional, up to 140 characters" maxlength="140" rows="2"></textarea></span>' +
        '</div>' +
      '</form>' +
      '<div class="modal__foot">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-close>Cancel</button>' +
        '<button type="submit" class="btn btn--primary btn--sm" form="pinForm" id="pinSubmit">' + icon('pin', 15) + 'Pin song</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function pinPickedMarkup(t) {
  return '<div class="post-picked">' +
    art(artSeedFor(t.trackId || t.title), null, t.image) +
    '<span class="t-body-s c-secondary truncate"><span class="c-primary">' + esc(t.title) + '</span> · ' + esc(t.artist) + '</span>' +
    '<button type="button" class="iconbtn" data-action="pin-unpick" data-tip="Pick another" aria-label="Pick another song">' + icon('close', 15) + '</button>' +
  '</div>';
}

/* ---- notifications ---------------------------------------------------------- */
const NOTIF_GLYPH = {
  reaction: function (n) { return n.reaction === 'heart' ? 'heart' : 'flame'; },
  comment: function () { return 'comment'; },
  reply: function () { return 'reply'; },
  friend_request: function () { return 'userPlus'; },
  friend_accept: function () { return 'users'; }
};

function notifText(n) {
  const who = '<b>' + esc(n.actor.name) + '</b>';
  const track = n.post ? '<b>' + esc(n.post.track) + '</b>' : 'your post';
  switch (n.type) {
    case 'reaction': return who + (n.reaction === 'heart' ? ' loved ' : ' gave a flame to ') + track;
    case 'comment': return who + ' commented on ' + track;
    case 'reply': return who + ' replied to your comment';
    case 'friend_request': return who + ' wants to be friends';
    default: return who + ' accepted your friend request';
  }
}

function notifHref(n) {
  if (n.post) return '#/p/' + encodeURIComponent(n.post.id);
  return n.actor.username ? '#/u/' + encodeURIComponent(n.actor.username) : '#/friends';
}

function notifRow(n) {
  let side = '';
  if (n.type === 'friend_request') {
    const rel = relationshipWith(n.actor.id);
    if (rel.state === 'incoming') {
      side = '<div class="notif__side">' +
        '<button class="btn btn--primary btn--sm" data-friend-accept="' + esc(rel.friendshipId) + '">Accept</button>' +
        '<button class="btn btn--ghost btn--sm" data-friend-decline="' + esc(rel.friendshipId) + '">Decline</button>' +
      '</div>';
    } else if (rel.state === 'friends') {
      side = '<div class="notif__side"><span class="badge badge--positive">' + icon('check', 13) + 'Friends</span></div>';
    }
  } else if (n.post) {
    side = '<a class="notif__side" href="' + notifHref(n) + '" tabindex="-1" aria-hidden="true">' + art(n.post.art, null, n.post.image) + '</a>';
  }
  return '<div class="' + cx('notif', UI.notifFresh[n.id] && 'notif--new') + '">' +
    '<a class="notif__main" href="' + notifHref(n) + '"' + (n.threadId ? ' data-open-thread="' + esc(n.threadId) + '"' : '') + '>' +
      '<span class="notif__who">' + avatarEl(n.actor.initials, null, null, n.actor.avatarUrl) +
        '<span class="notif__glyph notif__glyph--' + n.type + '">' + icon(NOTIF_GLYPH[n.type](n), 11) + '</span></span>' +
      '<span class="notif__body">' +
        '<span class="t-body-m notif__text">' + notifText(n) + '</span>' +
        (n.comment ? '<span class="t-body-s c-secondary notif__quote clamp-2">' + esc(n.comment) + '</span>' : '') +
        '<span class="t-meta c-tertiary">' + esc(n.time) + '</span>' +
      '</span>' +
    '</a>' + side +
  '</div>';
}

VIEWS.notifications = function () {
  const st = DATA.notifications;
  let body;
  if ((st.status === 'idle' || st.status === 'loading') && !st.items.length) {
    body = '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading('Loading notifications…') + '</div></section>';
  } else if (st.status === 'error' && !st.items.length) {
    body = ghostPanel(null, null, 'Could not load your notifications. Check your connection and try again.');
  } else if (!st.items.length) {
    body = ghostPanel(null, sharePostButton(false), 'Reactions, comments and friend requests show up here as soon as they happen.');
  } else {
    const fresh = st.items.filter(function (n) { return UI.notifFresh[n.id]; });
    const earlier = st.items.filter(function (n) { return !UI.notifFresh[n.id]; });
    body = (fresh.length ? '<section class="panel section">' + sectionHead('New', String(fresh.length)) +
        '<div class="section__body">' + fresh.map(notifRow).join('') + '</div></section>' : '') +
      (earlier.length ? '<section class="panel section">' + sectionHead(fresh.length ? 'Earlier' : 'All caught up') +
        '<div class="section__body">' + earlier.map(notifRow).join('') + '</div></section>' : '');
  }
  return wrap(pageHead('On your posts and requests', 'Notifications'), '<div class="notif-page">' + body + '</div>');
};

/* ---- single post ------------------------------------------------------------ */
VIEWS.post = function () {
  const pv = UI.postView;
  const head = pageHead('Shared track', 'Post', '<button class="btn btn--ghost btn--sm" data-nav="feed">Open feed</button>');
  if (!pv || pv.status === 'loading') {
    return wrap(head, '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading('Loading post…') + '</div></section>');
  }
  if (pv.status === 'notfound') return wrap(head, ghostPanel(null, null, 'This post was deleted.'));
  if (pv.status === 'error') return wrap(head, ghostPanel(null, null, 'Could not load this post. Try again in a moment.'));
  return wrap(head, '<div class="post-page">' + postCard(pv.post) + '</div>');
};

/* ---- taste compare ---------------------------------------------------------- */
function compareHero(profile, c) {
  const them = { initials: initialsFrom(profile.name), avatarUrl: profile.avatar_url };
  const first = profile.name.split(/\s+/)[0];
  const facts = [plural(c.artists.n, 'artist'), plural(c.tracks.n, 'song')].join(' and ') + ' in common' +
    (c.genre === null ? '' : ', ' + pct(c.genre) + '% genre overlap');
  return '<section class="panel cmp-hero">' +
    '<div class="cmp-hero__side">' + avatarEl(DATA.me.initials, '72', null, DATA.me.avatarUrl) + '<span class="t-label-m">You</span></div>' +
    '<div class="cmp-hero__mid">' +
      ringEl(c.score) +
      '<span class="t-title-m">' + esc(c.label) + '</span>' +
      '<span class="t-body-s c-secondary">' + esc(facts) + '</span>' +
    '</div>' +
    '<div class="cmp-hero__side">' + avatarEl(them.initials, '72', null, them.avatarUrl) + '<span class="t-label-m truncate">' + esc(first) + '</span></div>' +
  '</section>';
}

/* Butterfly chart: your genre shares grow left, theirs grow right, on one
   scale so bar lengths compare across both sides. */
function mirrorChart(c, first) {
  const mine = {}, theirs = {};
  c.mine.list.forEach(function (g) { mine[g.name] = g.share; });
  c.theirs.list.forEach(function (g) { theirs[g.name] = g.share; });
  const names = Object.keys(Object.assign({}, mine, theirs))
    .sort(function (a, b) { return ((theirs[b] || 0) + (mine[b] || 0)) - ((theirs[a] || 0) + (mine[a] || 0)) || a.localeCompare(b); })
    .slice(0, 8);
  if (names.length < 3) return '';
  let max = 0.01;
  names.forEach(function (n) { max = Math.max(max, mine[n] || 0, theirs[n] || 0); });
  const bar = function (v, side) {
    return '<span class="mirror__bar mirror__bar--' + side + '"><i style="width:' + Math.round((v || 0) / max * 100) + '%"></i></span>';
  };
  return '<section class="panel section">' + sectionHead('Genres side by side', 'share of top artists') +
    '<div class="section__body section__body--pad">' +
      '<div class="mirror" role="table" aria-label="Genre shares, you and ' + esc(first) + '">' +
        '<div class="mirror__row mirror__row--head" role="row">' +
          '<span class="mirror__who mirror__who--me" role="columnheader"><em></em>You</span>' +
          '<span role="columnheader" class="sr-only">Genre</span>' +
          '<span class="mirror__who mirror__who--them" role="columnheader">' + esc(first) + '<em></em></span>' +
        '</div>' +
        names.map(function (n) {
          const a = mine[n] || 0, b = theirs[n] || 0;
          return '<div class="mirror__row" role="row" title="' + esc(n + ': you ' + pct(a) + '%, ' + first + ' ' + pct(b) + '%') + '">' +
            '<span class="t-num c-tertiary mirror__num" role="cell">' + (a ? pct(a) + '%' : '–') + '</span>' +
            bar(a, 'me') +
            '<span class="t-body-s mirror__label truncate" role="cell">' + esc(n) + '</span>' +
            bar(b, 'them') +
            '<span class="t-num c-tertiary mirror__num" role="cell">' + (b ? pct(b) + '%' : '–') + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>' +
  '</section>';
}

function artistColumn(title, list, cls, empty) {
  return '<div class="' + cx('venn__col', cls) + '">' +
    '<div class="venn__head"><span class="t-stat-m">' + list.length + '</span><span class="t-label-m c-secondary">' + esc(title) + '</span></div>' +
    (list.length
      ? '<div class="venn__list">' + list.slice(0, 10).map(function (a) { return artistChip(a, a.genres && a.genres[0] || null); }).join('') + '</div>'
      : '<p class="t-body-s c-tertiary">' + esc(empty) + '</p>') +
  '</div>';
}

function compareArtists(mine, theirs, c, first) {
  const theirSet = idSet(theirs.artists), mySet = idSet(mine.artists);
  const onlyMe = mine.artists.filter(function (a) { return !theirSet[a.id]; });
  const onlyThem = theirs.artists.filter(function (a) { return !mySet[a.id]; });
  return '<section class="panel section">' + sectionHead('Artists', 'top 50 each, last 6 months') +
    '<div class="section__body section__body--pad">' +
      '<div class="venn">' +
        artistColumn('Only you', onlyMe, 'venn__col--me', 'Every artist you love, ' + first + ' loves too.') +
        artistColumn('Both of you', c.sharedArtists, 'venn__col--both', 'No artists in common yet.') +
        artistColumn('Only ' + first, onlyThem, 'venn__col--them', 'Nothing new here.') +
      '</div>' +
    '</div>' +
  '</section>';
}

function compareTracks(mine, theirs, c, first) {
  const mySet = idSet(mine.tracks);
  const tryThese = theirs.tracks.filter(function (t) { return !mySet[t.id]; }).slice(0, 6);
  if (!c.sharedTracks.length && !tryThese.length) return '';
  return '<div class="cols cols--half">' +
    '<section class="panel section">' + sectionHead('Songs you both play') +
      '<div class="section__body section__body--pad">' + (c.sharedTracks.length
        ? '<div class="achips">' + c.sharedTracks.slice(0, 8).map(trackChip).join('') + '</div>'
        : '<p class="t-body-s c-tertiary">None of your top 50 songs overlap yet.</p>') + '</div></section>' +
    '<section class="panel section">' + sectionHead('Try these from ' + first, 'in their top songs, not yours') +
      '<div class="section__body section__body--pad">' + (tryThese.length
        ? '<div class="achips">' + tryThese.map(trackChip).join('') + '</div>'
        : '<p class="t-body-s c-tertiary">You already play everything in their top songs.</p>') + '</div></section>' +
  '</div>';
}

function compareBody(profile, relation) {
  const first = profile.name.split(/\s+/)[0];
  if (relation.state !== 'friends') {
    const action = relation.state === 'incoming'
      ? '<button class="btn btn--primary btn--sm" data-friend-accept="' + esc(relation.friendshipId) + '">Accept request</button>'
      : relation.state === 'outgoing' ? null
      : '<button class="btn btn--primary btn--sm" data-friend-add="' + esc(profile.id) + '">' + icon('plus', 15) + 'Add friend</button>';
    return ghostPanel(null, action, relation.state === 'outgoing'
      ? 'Once ' + first + ' accepts your request, you can compare tastes here.'
      : 'You can compare tastes with friends. Add ' + first + ' first.');
  }
  if (!spotify.auth.isConnected()) {
    return ghostPanel(null, '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + icon('spotify', 15) + 'Connect Spotify</button>',
      'Connect Spotify so vortex can read your side of the comparison.');
  }
  if (tastesStatus === 'idle') return '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading('Loading music DNA…') + '</div></section>';
  if (tastesStatus === 'error') return ghostPanel(null, null, 'Could not load ' + first + '\'s music DNA. Try again in a moment.');
  const theirs = DATA.tastes[profile.id];
  if (!theirs) return ghostPanel(null, null, first + ' hasn\'t shared their music DNA yet. It appears once they open vortex with Spotify connected.');
  const mine = mySnapshot();
  if (!mine) {
    return libFailed('topArtists', 'medium_term') || libFailed('topTracks', 'medium_term')
      ? ghostPanel(null, null, 'Could not reach Spotify. Try again in a moment.')
      : '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading() + '</div></section>';
  }
  const c = compatibility(mine, theirs);
  if (!c) return ghostPanel(null, null, 'Not enough listening data on one side yet to compare.');
  return compareHero(profile, c) + mirrorChart(c, first) + compareArtists(mine, theirs, c, first) + compareTracks(mine, theirs, c, first) +
    '<p class="t-caption c-tertiary cmp-foot">How the score works: 45% genre overlap, 40% shared artists, 15% shared songs, from each person\'s top 50 over the last ~6 months.</p>';
}

/* Registered in LIBRARY_PANELS so it repaints as Spotify data and snapshots arrive. */
function compareBodyAuto() {
  const fp = UI.friendProfile;
  if (!fp || fp.status !== 'ok') return '<div id="compareBody" hidden></div>';
  return '<div class="stack" id="compareBody">' + compareBody(fp.profile, relationshipWith(fp.profile.id)) + '</div>';
}

VIEWS.compare = function () {
  const username = friendProfileUsername();
  const state = UI.friendProfile;
  if (!state || state.username !== username || state.status === 'loading') {
    return wrap(pageHead('Taste match', 'Loading…'), friendProfileLoading());
  }
  if (state.status === 'notfound') {
    return wrap(pageHead('Taste match', 'Not found'), ghostPanel(null, findFriendsButton(true), 'No vortex profile found for “' + esc(username) + '”.'));
  }
  if (state.status === 'error') {
    return wrap(pageHead('Taste match', 'Compare'), ghostPanel(null, null, 'Could not load this profile. Try again in a moment.'));
  }
  const p = state.profile;
  return wrap(
    pageHead('Taste match', 'You and ' + esc(p.name.split(/\s+/)[0]),
      '<a class="btn btn--ghost btn--sm" href="#/u/' + esc(p.username) + '">' + icon('user', 15) + 'View profile</a>'),
    compareBodyAuto()
  );
};

function compareButton(username, primary) {
  return '<a class="btn ' + (primary ? 'btn--primary' : 'btn--secondary') + ' btn--sm" href="#/compare/' + esc(username) + '">' +
    icon('compare', 15) + 'Compare tastes</a>';
}

LIBRARY_PANELS.push(['compareBody', compareBodyAuto]);
