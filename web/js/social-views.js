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
      '<span class="pin__kicker t-label-s">' + icon('pin', 13) + t('Song of the moment') +
        (pin.at ? '<span class="c-tertiary">' + esc(formatTimeAgo(pin.at)) + '</span>' : '') + '</span>' +
      '<span class="t-title-s truncate">' + esc(pin.title) + '</span>' +
      '<span class="t-body-s c-secondary truncate">' + esc(pin.artist) + '</span>' +
      (pin.note ? '<p class="t-body-s c-secondary pin__note">' + esc(pin.note) + '</p>' : '') +
    '</div>' +
    '<div class="pin__actions">' +
      (href ? '<a class="post__play" href="' + href + '" target="_blank" rel="noopener" data-tip="' + t('Play on Spotify') + '" aria-label="' + t('Play {title} on Spotify', { title: esc(pin.title) }) + '">' + icon('play', 15) + '</a>' : '') +
      (own
        ? '<button class="btn btn--secondary btn--sm" data-action="pin-edit">' + t('Change') + '</button>' +
          '<button class="iconbtn" data-action="pin-clear" data-tip="' + t('Unpin') + '" aria-label="' + t('Unpin this song') + '">' + icon('close', 16) + '</button>'
        : '') +
    '</div>' +
  '</div>';
}

function pinInvite() {
  return '<button class="pin pin--empty" data-action="pin-edit">' +
    '<span class="pin__sleeve pin__sleeve--empty" aria-hidden="true">' + icon('disc', 22) + '</span>' +
    '<span class="pin__meta">' +
      '<span class="t-body-m-med">' + t('Pin your song of the moment') + '</span>' +
      '<span class="t-body-s c-tertiary">' + t('It sits at the top of your profile, so friends see what you\'re into right now.') + '</span>' +
    '</span>' +
    '<span class="btn btn--primary btn--sm">' + icon('pin', 15) + t('Pin a song') + '</span>' +
  '</button>';
}

/* Feed side rail: friends' pinned songs, newest first. */
function friendsPinsPanel() {
  const pinned = DATA.friends.filter(function (f) { return f.pin; })
    .sort(function (a, b) { return Date.parse(b.pin.at || 0) - Date.parse(a.pin.at || 0); }).slice(0, 6);
  if (!pinned.length) return '';
  return '<section class="panel section">' + sectionHead(t('Songs of the moment'), t('pinned by friends')) +
    '<div class="section__body">' + pinned.map(function (f) {
      const href = spotifyTrackUrl(f.pin.trackId);
      return '<div class="row pinrow">' +
        '<a class="pinrow__who" href="#/u/' + esc(f.username) + '" data-tip="' + esc(f.name) + '">' + avatarEl(f.initials, '24', null, f.avatarUrl) + '</a>' +
        art(artSeedFor(f.pin.trackId || f.pin.title), null, f.pin.image) +
        '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(f.pin.title) + '</span>' +
          '<span class="t-body-s c-tertiary truncate">' + esc(f.pin.artist) + ' · ' + esc(f.name.split(/\s+/)[0]) + '</span></span>' +
        (href ? '<a class="iconbtn" href="' + href + '" target="_blank" rel="noopener" data-tip="' + t('Play on Spotify') + '" aria-label="' + t('Play {title} on Spotify', { title: esc(f.pin.title) }) + '">' + icon('play', 14) + '</a>' : '') +
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
        '<h2 class="t-title-s" id="pinFormTitle">' + t('Pin a song') + '</h2>' +
      '</div>' +
      '<form id="pinForm" class="modal__body" novalidate>' +
        '<div class="auth__note auth__note--error" id="pinError" hidden>' + icon('close', 16) +
          '<p class="t-body-s c-secondary" id="pinErrorText"></p></div>' +
        (np.status === 'track'
          ? '<button type="button" class="btn btn--secondary btn--sm" data-action="pin-use-np" style="justify-content:flex-start;min-width:0">' +
              icon('spotify', 15) + '<span class="truncate">' + t('Use what\'s playing: {title} · {artist}', { title: esc(np.title), artist: esc(np.artist) }) + '</span></button>'
          : '') +
        (connected
          ? '<div class="auth__field">' +
              '<label class="t-label-m c-secondary" for="pinSearch">' + t('Find the song') + '</label>' +
              '<span class="field">' + icon('search', 17) +
                '<input id="pinSearch" type="search" placeholder="' + t('Search Spotify') + '" autocomplete="off" maxlength="100"></span>' +
              '<div class="post-search" id="pinResults"></div>' +
            '</div>'
          : '<div class="auth__field">' +
              '<label class="t-label-m c-secondary" for="pinTitle">' + t('Song') + '</label>' +
              '<span class="field">' + icon('disc', 17) + '<input id="pinTitle" type="text" placeholder="' + t('Song name') + '" maxlength="200"></span>' +
            '</div>' +
            '<div class="auth__field">' +
              '<label class="t-label-m c-secondary" for="pinArtist">' + t('Artist') + '</label>' +
              '<span class="field">' + icon('user', 17) + '<input id="pinArtist" type="text" placeholder="' + t('Artist name') + '" maxlength="200"></span>' +
            '</div>' +
            '<p class="t-body-s c-tertiary">' + t('{connect} to search and show the cover.', { connect: '<button type="button" class="btn btn--ghost btn--sm" data-action="spotify-connect" style="display:inline-flex;padding:0 4px">' + t('Connect Spotify') + '</button>' }) + '</p>') +
        '<div id="pinPicked"></div>' +
        '<div class="auth__field">' +
          '<label class="t-label-m c-secondary" for="pinNote">' + t('Why this one?') + '</label>' +
          '<span class="field field--area">' + icon('comment', 17) +
            '<textarea id="pinNote" placeholder="' + t('Optional, up to 140 characters') + '" maxlength="140" rows="2"></textarea></span>' +
        '</div>' +
      '</form>' +
      '<div class="modal__foot">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-close>' + t('Cancel') + '</button>' +
        '<button type="submit" class="btn btn--primary btn--sm" form="pinForm" id="pinSubmit">' + icon('pin', 15) + t('Pin song') + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function pinPickedMarkup(track) {
  return '<div class="post-picked">' +
    art(artSeedFor(track.trackId || track.title), null, track.image) +
    '<span class="t-body-s c-secondary truncate"><span class="c-primary">' + esc(track.title) + '</span> · ' + esc(track.artist) + '</span>' +
    '<button type="button" class="iconbtn" data-action="pin-unpick" data-tip="' + t('Pick another') + '" aria-label="' + t('Pick another song') + '">' + icon('close', 15) + '</button>' +
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
  const track = n.post
    ? (n.post.artist ? t('{track} by {artist}', { track: '<b>' + esc(n.post.track) + '</b>', artist: esc(n.post.artist) }) : '<b>' + esc(n.post.track) + '</b>')
    : t('your post');
  const v = { who: who, track: track };
  switch (n.type) {
    case 'reaction': return n.reaction === 'heart' ? t('{who} loved {track}', v) : t('{who} gave a flame to {track}', v);
    case 'comment': return t('{who} commented on {track}', v);
    case 'reply': return n.post ? t('{who} replied to your comment on {track}', v) : t('{who} replied to your comment', v);
    case 'friend_request': return t('{who} wants to be friends', v);
    default: return t('{who} accepted your friend request', v);
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
        '<button class="btn btn--primary btn--sm" data-friend-accept="' + esc(rel.friendshipId) + '">' + t('Accept') + '</button>' +
        '<button class="btn btn--ghost btn--sm" data-friend-decline="' + esc(rel.friendshipId) + '">' + t('Decline') + '</button>' +
      '</div>';
    } else if (rel.state === 'friends') {
      side = '<div class="notif__side"><span class="badge badge--positive">' + icon('check', 13) + t('Friends') + '</span></div>';
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
    body = '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading(t('Loading notifications…')) + '</div></section>';
  } else if (st.status === 'error' && !st.items.length) {
    body = retryPanel(t('Could not load your notifications. Check your connection.'), 'notif-retry');
  } else if (!st.items.length) {
    body = ghostPanel(null, sharePostButton(false), t('Reactions, comments and friend requests show up here as soon as they happen.'));
  } else {
    const fresh = st.items.filter(function (n) { return UI.notifFresh[n.id]; });
    const earlier = st.items.filter(function (n) { return !UI.notifFresh[n.id]; });
    body = (fresh.length ? '<section class="panel section">' + sectionHead(t('New'), String(fresh.length)) +
        '<div class="section__body">' + fresh.map(notifRow).join('') + '</div></section>' : '') +
      (earlier.length ? '<section class="panel section">' + sectionHead(fresh.length ? t('Earlier') : t('All caught up')) +
        '<div class="section__body">' + earlier.map(notifRow).join('') + '</div></section>' : '');
  }
  return wrap(pageHead(t('On your posts and requests'), t('Notifications')), '<div class="notif-page">' + body + '</div>');
};

/* ---- single post ------------------------------------------------------------ */
VIEWS.post = function () {
  const pv = UI.postView;
  const head = pageHead(t('Shared track'), t('Post'), '<button class="btn btn--ghost btn--sm" data-nav="feed">' + t('Open feed') + '</button>');
  if (!pv || pv.status === 'loading') {
    return wrap(head, '<div class="post-page">' + skeletonPosts(1) + '</div>');
  }
  if (pv.status === 'notfound') return wrap(head, ghostPanel(null, null, t('This post was deleted.')));
  if (pv.status === 'error') return wrap(head, ghostPanel(null, null, t('Could not load this post. Try again in a moment.')));
  if (isBlocked(pv.post.userId)) {
    return wrap(head, blockedPanel({ id: pv.post.userId, name: pv.post.user, username: pv.post.username, avatarUrl: pv.post.avatarUrl }));
  }
  return wrap(head, '<div class="post-page">' + postCard(pv.post) + '</div>');
};

/* ---- taste compare ---------------------------------------------------------- */
function compareHero(profile, c) {
  const them = { initials: initialsFrom(profile.name), avatarUrl: profile.avatar_url };
  const first = profile.name.split(/\s+/)[0];
  const counts = { artists: tn(c.artists.n, '{n} artist', '{n} artists'), songs: tn(c.tracks.n, '{n} song', '{n} songs') };
  const facts = c.genre === null
    ? t('{artists} and {songs} in common', counts)
    : t('{artists} and {songs} in common, {pct}% genre overlap', Object.assign({ pct: pct(c.genre) }, counts));
  return '<section class="panel cmp-hero">' +
    '<div class="cmp-hero__side">' + avatarEl(DATA.me.initials, '72', null, DATA.me.avatarUrl) + '<span class="t-label-m">' + t('You') + '</span></div>' +
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
  return '<section class="panel section">' + sectionHead(t('Genres side by side'), t('share of top artists')) +
    '<div class="section__body section__body--pad">' +
      '<div class="mirror" role="table" aria-label="' + t('Genre shares, you and {name}', { name: esc(first) }) + '">' +
        '<div class="mirror__row mirror__row--head" role="row">' +
          '<span class="mirror__who mirror__who--me" role="columnheader"><em></em>' + t('You') + '</span>' +
          '<span role="columnheader" class="sr-only">' + t('Genre') + '</span>' +
          '<span class="mirror__who mirror__who--them" role="columnheader">' + esc(first) + '<em></em></span>' +
        '</div>' +
        names.map(function (n) {
          const a = mine[n] || 0, b = theirs[n] || 0;
          return '<div class="mirror__row" role="row" title="' + esc(t('{genre}: you {mine}%, {name} {theirs}%', { genre: n, mine: pct(a), name: first, theirs: pct(b) })) + '">' +
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
  return '<section class="panel section">' + sectionHead(t('Artists'), t('top 50 each, last 6 months')) +
    '<div class="section__body section__body--pad">' +
      '<div class="venn">' +
        artistColumn(t('Only you'), onlyMe, 'venn__col--me', t('Every artist you love, {name} loves too.', { name: first })) +
        artistColumn(t('Both of you'), c.sharedArtists, 'venn__col--both', t('No artists in common yet.')) +
        artistColumn(t('Only {name}', { name: first }), onlyThem, 'venn__col--them', t('Nothing new here.')) +
      '</div>' +
    '</div>' +
  '</section>';
}

function compareTracks(mine, theirs, c, first) {
  const mySet = idSet(mine.tracks);
  const tryThese = theirs.tracks.filter(function (t) { return !mySet[t.id]; }).slice(0, 6);
  if (!c.sharedTracks.length && !tryThese.length) return '';
  return '<div class="cols cols--half">' +
    '<section class="panel section">' + sectionHead(t('Songs you both play')) +
      '<div class="section__body section__body--pad">' + (c.sharedTracks.length
        ? '<div class="achips">' + c.sharedTracks.slice(0, 8).map(trackChip).join('') + '</div>'
        : '<p class="t-body-s c-tertiary">' + t('None of your top 50 songs overlap yet.') + '</p>') + '</div></section>' +
    '<section class="panel section">' + sectionHead(t('Try these from {name}', { name: first }), t('in their top songs, not yours')) +
      '<div class="section__body section__body--pad">' + (tryThese.length
        ? '<div class="achips">' + tryThese.map(trackChip).join('') + '</div>'
        : '<p class="t-body-s c-tertiary">' + t('You already play everything in their top songs.') + '</p>') + '</div></section>' +
  '</div>';
}

/* ---- blend playlist ------------------------------------------------------------ */
UI.blend = {};   // profile id -> { status: 'saving'|'ok', url }

const BLEND_MAX = 50;

function takeTurns(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

/* Common ground first: songs you both play, then songs by artists you share,
   then each side's top songs taking turns until the playlist is full. */
function blendTracks(mine, theirs) {
  const out = [], seen = {};
  const add = function (t) { if (!seen[t.id] && out.length < BLEND_MAX) { seen[t.id] = true; out.push(t); } };
  const theirSongs = idSet(theirs.tracks), theirArtists = idSet(theirs.artists);
  const shared = {};
  mine.artists.forEach(function (a) { if (theirArtists[a.id]) shared[a.id] = true; });
  const bySharedArtist = function (t) { return t.artistIds.some(function (id) { return shared[id]; }); };
  const both = mine.tracks.filter(function (t) { return theirSongs[t.id]; });
  both.forEach(add);
  takeTurns(mine.tracks.filter(bySharedArtist), theirs.tracks.filter(bySharedArtist)).forEach(add);
  const common = out.length;
  takeTurns(mine.tracks, theirs.tracks).forEach(add);
  return { tracks: out, both: both.length, common: common };
}

function blendPanel(profile, mine, theirs) {
  const first = profile.name.split(/\s+/)[0];
  const b = blendTracks(mine, theirs);
  if (b.tracks.length < 4) return '';
  const saved = UI.blend[profile.id];
  let control;
  if (saved && saved.status === 'ok') {
    control = saved.url && /^https:\/\/open\.spotify\.com\//.test(saved.url)
      ? '<a class="btn btn--primary btn--sm" href="' + esc(saved.url) + '" target="_blank" rel="noopener">' + icon('spotify', 15) + t('Open in Spotify') + '</a>'
      : '<span class="badge badge--positive"><span>' + icon('check', 13) + '</span>' + t('Saved to Spotify') + '</span>';
  } else if (saved && saved.status === 'saving') {
    control = '<button class="btn btn--primary btn--sm" disabled>' + t('Creating…') + '</button>';
  } else if (!spotify.auth.hasScope('playlist-modify-private')) {
    control = '<button class="btn btn--primary btn--sm" data-action="spotify-connect" data-tip="' + t('Spotify asks once for permission to create playlists') + '">' + icon('spotify', 15) + t('Allow creating playlists') + '</button>';
  } else {
    control = '<button class="btn btn--primary btn--sm" data-action="blend-save" data-user="' + esc(profile.id) + '">' + icon('plus', 15) + t('Create the playlist') + '</button>';
  }
  const hv = { songs: tn(b.both, '{n} song', '{n} songs'), name: first };
  const how = b.common
    ? (b.both
      ? (b.common > b.both
        ? t('{songs} you both play, then songs by the artists you share, then your favorites and {name}’s, taking turns.', hv)
        : t('{songs} you both play, then your favorites and {name}’s, taking turns.', hv))
      : t('songs by the artists you share, then your favorites and {name}’s, taking turns.', hv))
    : t('Your favorites and {name}’s, taking turns. You don’t share artists yet, so it’s a straight swap.', hv);
  return '<section class="panel blend">' +
    '<div class="blend__covers" aria-hidden="true">' + b.tracks.slice(0, 4).map(function (t) {
      return art(artSeedFor(t.id), null, t.image);
    }).join('') + '</div>' +
    '<div class="blend__meta">' +
      '<span class="t-title-s">' + t('A playlist for the two of you') + '</span>' +
      '<span class="t-body-s c-secondary">' + esc(tn(b.tracks.length, '{n} song', '{n} songs') + ': ' + how) + '</span>' +
      '<span class="t-caption c-tertiary">' + t('Private, in your Spotify library. {name} won’t see it unless you share it.', { name: esc(first) }) + '</span>' +
    '</div>' +
    '<div class="blend__action">' + control + '</div>' +
  '</section>';
}

function compareBody(profile, relation) {
  const first = profile.name.split(/\s+/)[0];
  if (isBlocked(profile.id)) return blockedPanel(profile);
  if (relation.state !== 'friends') {
    const action = relation.state === 'incoming'
      ? '<button class="btn btn--primary btn--sm" data-friend-accept="' + esc(relation.friendshipId) + '">' + t('Accept request') + '</button>'
      : relation.state === 'outgoing' ? null
      : '<button class="btn btn--primary btn--sm" data-friend-add="' + esc(profile.id) + '">' + icon('plus', 15) + t('Add friend') + '</button>';
    return ghostPanel(null, action, relation.state === 'outgoing'
      ? t('Once {name} accepts your request, you can compare tastes here.', { name: first })
      : t('You can compare tastes with friends. Add {name} first.', { name: first }));
  }
  if (!spotify.auth.isConnected()) {
    return ghostPanel(null, '<button class="btn btn--primary btn--sm" data-action="spotify-connect">' + icon('spotify', 15) + t('Connect Spotify') + '</button>',
      t('Connect Spotify so vortex can read your side of the comparison.'));
  }
  if (tastesStatus === 'idle') return '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading(t('Loading music DNA…')) + '</div></section>';
  if (tastesStatus === 'error') return ghostPanel(null, null, t('Could not load {name}\'s music DNA. Try again in a moment.', { name: first }));
  const theirs = DATA.tastes[profile.id];
  if (!theirs) return ghostPanel(null, null, t('{name} hasn\'t shared their music DNA yet. It appears once they open vortex with Spotify connected.', { name: first }));
  const mine = mySnapshot();
  if (!mine) {
    return libFailed('topArtists', 'medium_term') || libFailed('topTracks', 'medium_term')
      ? ghostPanel(null, null, t('Could not reach Spotify. Try again in a moment.'))
      : '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading() + '</div></section>';
  }
  const c = compatibility(mine, theirs);
  if (!c) return ghostPanel(null, null, t('Not enough listening data on one side yet to compare.'));
  return compareHero(profile, c) + blendPanel(profile, mine, theirs) + mirrorChart(c, first) + compareArtists(mine, theirs, c, first) + compareTracks(mine, theirs, c, first) +
    '<p class="t-caption c-tertiary cmp-foot">' + t('How the score works: 45% genre overlap, 40% shared artists, 15% shared songs, from each person\'s top 50 over the last ~6 months.') + '</p>';
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
    return wrap(pageHead(t('Taste match'), t('Loading…')), friendProfileLoading());
  }
  if (state.status === 'notfound') {
    return wrap(pageHead(t('Taste match'), t('Not found')), ghostPanel(null, findFriendsButton(true), t('No vortex profile found for “{username}”.', { username: username })));
  }
  if (state.status === 'error') {
    return wrap(pageHead(t('Taste match'), t('Compare')), ghostPanel(null, null, t('Could not load this profile. Try again in a moment.')));
  }
  const p = state.profile;
  return wrap(
    pageHead(t('Taste match'), t('You and {name}', { name: esc(p.name.split(/\s+/)[0]) }),
      '<a class="btn btn--ghost btn--sm" href="#/u/' + esc(p.username) + '">' + icon('user', 15) + t('View profile') + '</a>'),
    compareBodyAuto()
  );
};

function compareButton(username, primary) {
  return '<a class="btn ' + (primary ? 'btn--primary' : 'btn--secondary') + ' btn--sm" href="#/compare/' + esc(username) + '">' +
    icon('compare', 15) + t('Compare tastes') + '</a>';
}

LIBRARY_PANELS.push(['compareBody', compareBodyAuto]);
