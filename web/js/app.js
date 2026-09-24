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
const PUBLIC_VIEWS = ['login', 'signup'];

const STORE = {
  get: function (k, fallback) {
    try { const v = localStorage.getItem('vortex.' + k); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  },
  set: function (k, v) { try { localStorage.setItem('vortex.' + k, v); } catch (e) { /* private mode */ } }
};

const app = {
  view: 'home',
  session: null
};

/* ---- auth ----------------------------------------------------------------- */
function initialsFrom(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase();
}

function formatTimeAgo(isoDate) {
  const now = new Date();
  const posted = new Date(isoDate);
  const diffMs = now - posted;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return diffMins + 'm';
  if (diffHours < 24) return diffHours + 'h';
  if (diffDays < 7) return diffDays + 'd';

  const posted_short = posted.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return posted_short;
}

function transformComment(c, currentUserId) {
  const name = c.author ? c.author.name : 'Unknown';
  return {
    id: c.id,
    user: name,
    initials: initialsFrom(name),
    text: c.content,
    time: formatTimeAgo(c.created_at),
    createdAt: c.created_at,
    mine: c.user_id === currentUserId
  };
}

function transformPostData(post, currentUserId) {
  const reactions = post.reactions || [];
  function count(type) { return reactions.filter(function (r) { return r.type === type; }).length; }
  function mineOf(type) { return reactions.some(function (r) { return r.type === type && r.user_id === currentUserId; }); }
  const comments = (post.comments || [])
    .slice()
    .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
    .map(function (c) { return transformComment(c, currentUserId); });

  return {
    id: post.id,
    mine: post.user_id === currentUserId,
    user: post.author.name,
    initials: initialsFrom(post.author.name),
    time: formatTimeAgo(post.created_at),
    platform: 'spotify',
    track: post.track_title,
    artist: post.artist,
    album: post.album,
    art: post.art_seed || 1,
    image: post.album_image_url,
    trackId: post.spotify_track_id,
    note: post.note,
    reactions: { flame: count('flame'), heart: count('heart') },
    reacted: { flame: mineOf('flame'), heart: mineOf('heart') },
    comments: comments
  };
}

async function loadCurrentUser() {
  if (!app.session) return;
  try {
    const profile = await db.profiles.get(app.session.user.id);
    await loadFriends();

    DATA.me.name = profile.name;
    DATA.me.email = app.session.user.email;
    DATA.me.username = '@' + profile.username;
    DATA.me.initials = initialsFrom(profile.name);
    DATA.me.bio = profile.bio || 'No bio yet.';

    const joinedDate = new Date(profile.created_at);
    const month = joinedDate.toLocaleString('en-US', { month: 'long' });
    const year = joinedDate.getFullYear();
    DATA.me.joined = month + ' ' + year;

    document.getElementById('sidebar').innerHTML = renderSidebar();

    await loadFeed();
  } catch (e) { console.error('Error loading user:', e); }
}

function toPerson(profile, friendshipId) {
  return {
    friendshipId: friendshipId,
    id: profile.id,
    name: profile.name,
    username: profile.username,
    initials: initialsFrom(profile.name)
  };
}

async function loadFriends() {
  if (!app.session) return;
  const me = app.session.user.id;
  const rows = await db.friends.all(me);
  const friends = [], incoming = [], outgoing = [];
  rows.forEach(function (r) {
    const other = r.requester_id === me ? r.addressee : r.requester;
    if (!other) return;
    const person = toPerson(other, r.id);
    if (r.status === 'accepted') friends.push(person);
    else if (r.addressee_id === me) incoming.push(person);
    else outgoing.push(person);
  });
  friends.sort(function (a, b) { return a.name.localeCompare(b.name); });
  DATA.friends = friends;
  DATA.incoming = incoming;
  DATA.outgoing = outgoing;
  DATA.me.friends = friends.length;
  updateFriendsBadge();
}

function updateFriendsBadge() {
  const link = document.querySelector('#sidebar [data-view-link="friends"]');
  if (!link) return;
  let dot = link.querySelector('.nav__dot');
  if (DATA.incoming.length && !dot) {
    dot = document.createElement('span');
    dot.className = 'nav__dot';
    link.appendChild(dot);
  } else if (!DATA.incoming.length && dot) {
    dot.remove();
  }
  if (dot) dot.setAttribute('aria-label', countLabel(DATA.incoming.length, 'friend request'));
}

async function loadFeed() {
  if (!app.session) return;
  try {
    const me = app.session.user.id;
    const authors = UI.feedScope === 'Friends' ? [me].concat(DATA.friends.map(function (f) { return f.id; })) : null;
    const posts = await db.posts.list(30, authors);
    DATA.feed = posts.map(function (post) {
      return transformPostData(post, me);
    });
    backfillCovers();
  } catch (e) { console.error('Error loading feed:', e); }
}

function feedSignature() {
  return DATA.feed.map(function (p) {
    return [p.id, p.reactions.flame, p.reactions.heart, p.comments.length, p.image || ''].join(':');
  }).join('|');
}

/* Posts saved before covers existed get one looked up on Spotify, if this
   viewer has Spotify connected. Only in memory — posts have no update policy. */
let coverBackfillRun = 0;
async function backfillCovers() {
  if (!spotify.auth.isConnected()) return;
  const run = ++coverBackfillRun;
  const missing = DATA.feed.filter(function (p) { return !p.image; });
  for (let i = 0; i < missing.length; i++) {
    if (run !== coverBackfillRun) return;
    const p = missing[i];
    try {
      const hit = await spotify.findCover(p.track, p.artist);
      if (hit && run === coverBackfillRun) {
        p.image = hit.image;
        if (!p.trackId) p.trackId = hit.id;
        rerenderPost(p.id);
      }
    } catch (err) {
      console.warn('Cover lookup failed:', err);
      return;
    }
  }
}

function showAuthMessage(msg, isError) {
  const box = document.getElementById('authError');
  const text = document.getElementById('authErrorText');
  if (!box || !text) return;
  box.classList.toggle('auth__note--error', isError !== false);
  text.textContent = msg;
  box.hidden = false;
}

/* Client-side throttle: slows down guessing from the UI. The real server-side
   protection is Supabase Auth's per-IP rate limit (and optional CAPTCHA). */
const LOGIN_GUARD = { maxFails: 5, baseLockMs: 30000, maxLockMs: 15 * 60000, forgetAfterMs: 60 * 60000 };
let loginLockTimer = null;

function readLoginGuard() {
  try { return JSON.parse(STORE.get('loginGuard', '{}')) || {}; }
  catch (e) { return {}; }
}
function writeLoginGuard(g) { STORE.set('loginGuard', JSON.stringify(g)); }

function loginLockRemaining() {
  return Math.max(0, (readLoginGuard().lockedUntil || 0) - Date.now());
}

function recordLoginFailure() {
  let g = readLoginGuard();
  if (g.lastFail && Date.now() - g.lastFail > LOGIN_GUARD.forgetAfterMs) g = {};
  g.lastFail = Date.now();
  g.fails = (g.fails || 0) + 1;
  if (g.fails >= LOGIN_GUARD.maxFails) {
    g.lockouts = (g.lockouts || 0) + 1;
    g.lockedUntil = Date.now() + Math.min(LOGIN_GUARD.baseLockMs * Math.pow(2, g.lockouts - 1), LOGIN_GUARD.maxLockMs);
    g.fails = 0;
  }
  writeLoginGuard(g);
  return g;
}

function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return s + 's';
  const r = s % 60;
  return Math.floor(s / 60) + 'm ' + (r < 10 ? '0' : '') + r + 's';
}

function paintLoginLock() {
  clearInterval(loginLockTimer);
  const btn = document.getElementById('authLoginSubmit');
  if (!btn) return;
  function tick() {
    const left = loginLockRemaining();
    if (!btn.isConnected || left <= 0) {
      clearInterval(loginLockTimer);
      if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Log in'; }
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Try again in ' + formatWait(left);
  }
  tick();
  if (loginLockRemaining() > 0) loginLockTimer = setInterval(tick, 1000);
}

function isBadCredentials(err) {
  return err && (err.code === 'invalid_credentials' || /invalid login credentials/i.test(err.message || ''));
}

async function handleLogin(form) {
  if (loginLockRemaining() > 0) { paintLoginLock(); return; }
  const email = form.querySelector('#authEmail').value.trim();
  const pass = form.querySelector('#authPass').value;
  const btn = document.getElementById('authLoginSubmit');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    await db.auth.signIn(email, pass);
    writeLoginGuard({});
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Log in';
    if (err && err.status === 429) {
      showAuthMessage('Too many sign-in attempts from this network. Wait a few minutes and try again.', true);
      return;
    }
    if (isBadCredentials(err)) {
      const g = recordLoginFailure();
      if (loginLockRemaining() > 0) {
        showAuthMessage('Too many failed attempts. Sign-in is paused for ' + formatWait(loginLockRemaining()) + '.', true);
        paintLoginLock();
        return;
      }
      const left = LOGIN_GUARD.maxFails - g.fails;
      showAuthMessage('Wrong email or password.' +
        (left <= 2 ? ' ' + left + (left === 1 ? ' attempt' : ' attempts') + ' left before sign-in is paused.' : ''), true);
      return;
    }
    showAuthMessage(err.message || 'Could not sign in', true);
  }
}

async function handleSignup(form) {
  const name = form.querySelector('#authName').value.trim();
  const username = form.querySelector('#authUsername').value.trim();
  const email = form.querySelector('#authEmail').value.trim();
  const pass = form.querySelector('#authPass').value;
  const btn = document.getElementById('authSignupSubmit');
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const data = await db.auth.signUp(email, pass, { username, name });
    if (!data.session) {
      showAuthMessage('Check your email to confirm your account, then log in.', false);
      btn.disabled = false; btn.textContent = 'Create account';
    }
  } catch (err) {
    showAuthMessage(err.message || 'Could not create account', true);
    btn.disabled = false; btn.textContent = 'Create account';
  }
}

/* ---- sidebar ------------------------------------------------------------ */
function renderNowPlayingMini() {
  const np = DATA.nowPlaying;
  if (np.status !== 'track') {
    const connected = np.status === 'idle';
    return '<div class="np">' +
      '<div class="np__top">' +
        '<div class="art np__placeholder" style="width:38px;height:38px" aria-hidden="true">' + icon('spotify', 18) + '</div>' +
        '<div class="np__meta">' +
          '<span class="t-label-m truncate">' + (connected ? 'Nothing playing' : 'Spotify not connected') + '</span>' +
          '<span class="t-caption c-tertiary truncate">' + (connected ? 'Play something on Spotify' : 'Connect to show your music') + '</span>' +
        '</div>' +
        (connected ? '' : '<button class="iconbtn" data-action="spotify-connect" data-tip="Connect Spotify" aria-label="Connect Spotify">' + icon('plus', 17) + '</button>') +
      '</div>' +
    '</div>';
  }
  return '<div class="np">' +
    '<div class="np__top">' +
      art(np.art, 'np__art', np.thumb || np.image) +
      '<div class="np__meta">' +
        '<span class="t-label-m truncate">' + esc(np.title) + '</span>' +
        '<span class="t-caption c-tertiary truncate">' + esc(np.artist) + '</span>' +
      '</div>' +
      (np.playing
        ? '<span class="eq" aria-label="Playing"><i></i><i></i><i></i></span>'
        : '<span class="t-meta c-tertiary">Paused</span>') +
    '</div>' +
    '<div class="track track--thin"><i data-np-bar style="width:0%"></i></div>' +
    '<div class="np__times">' +
      '<span class="t-meta c-tertiary" data-np-elapsed>' + mmss(np.elapsed) + '</span>' +
      '<span class="t-meta c-tertiary">' + mmss(np.duration) + '</span>' +
    '</div>' +
  '</div>';
}

function renderSidebar() {
  const nav = NAV.map(function (n) {
    if (n.group) return '<p class="nav-group t-overline">' + n.group + '</p>';
    return '<a class="nav" href="#/' + n.id + '" data-view-link="' + n.id + '">' +
      icon(n.icon, 19) +
      '<span>' + n.label + '</span>' +
      (n.dot ? '<span class="nav__dot" aria-label="In development"></span>' : '') +
      (n.id === 'friends' && DATA.incoming.length
        ? '<span class="nav__dot" aria-label="' + countLabel(DATA.incoming.length, 'friend request') + '"></span>' : '') +
    '</a>';
  }).join('');

  return '' +
  '<div class="sidebar__brand">' +
    '<a class="brand" href="#/home"><img class="brand__mark" src="assets/logo-64.png" width="22" height="22" alt="vortex"><b>vortex</b></a>' +
    '<button class="iconbtn" id="railToggle" data-tip="Collapse sidebar" aria-label="Collapse sidebar">' +
      icon('chevronLeft', 17) + '</button>' +
  '</div>' +
  '<button class="field field--sm sidebar__search" id="openCmdk">' +
    icon('search', 15) + '<span class="c-tertiary">Search</span>' +
    '<span class="field__kbd">⌘K</span>' +
  '</button>' +
  '<nav class="sidebar__nav scroll">' + nav + '</nav>' +
  '<div class="sidebar__foot">' +
    renderNowPlayingMini() +
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
  return '<a class="brand" href="#/home"><img class="brand__mark" src="assets/logo-64.png" width="20" height="20" alt="vortex"><b style="font-size:17px">vortex</b></a>' +
    '<span class="spacer"></span>' +
    '<button class="iconbtn iconbtn--lg" id="openCmdkMobile" aria-label="Search">' + icon('search', 18) + '</button>' +
    '<button class="iconbtn iconbtn--lg" data-nav="settings" aria-label="Settings">' + icon('sliders', 18) + '</button>';
}

/* ---- routing ------------------------------------------------------------ */
function currentRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '').trim();
  const target = VIEWS[raw] ? raw : 'home';
  const isPublic = PUBLIC_VIEWS.indexOf(target) > -1;
  if (!app.session && !isPublic) return 'login';
  if (app.session && isPublic) return 'home';
  return target;
}

function setView(name) {
  app.view = name;
  document.getElementById('viewRoot').innerHTML = VIEWS[name]();
  document.querySelectorAll('[data-view-link]').forEach(function (a) {
    if (a.dataset.viewLink === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const authed = PUBLIC_VIEWS.indexOf(name) === -1;
  document.getElementById('app').dataset.authed = String(authed);
  document.getElementById('sidebar').hidden = !authed;
  document.getElementById('bottomnav').hidden = !authed;
  document.getElementById('mobilebar').hidden = !authed;
  const label = (NAV.filter(function (n) { return n.id === name; })[0] || {}).label || 'vortex';
  document.title = label + ' · vortex';
  syncAppearanceControls();
  updatePlayerUI();
  if (name === 'login') paintLoginLock();
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

/* ---- now playing (Spotify) ---------------------------------------------- */
function updatePlayerUI() {
  const np = DATA.nowPlaying;
  const pct = np.duration ? (np.elapsed / np.duration) * 100 : 0;
  const bar = document.querySelector('[data-np-bar]');
  if (bar) bar.style.width = pct + '%';
  const el = document.querySelector('[data-np-elapsed]');
  if (el) el.textContent = mmss(np.elapsed);

  const heroBar = document.querySelector('.hero__progress .track i');
  if (heroBar) heroBar.style.width = pct + '%';
  const heroKnob = document.querySelector('.hero__progress .slider__knob');
  if (heroKnob) heroKnob.style.left = pct + '%';
  const heroTime = document.querySelector('.hero__progress .t-meta');
  if (heroTime) heroTime.textContent = mmss(np.elapsed);
}

function artSeedFor(id) {
  let h = 0;
  for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 1 + (h % 6);
}

function paintNowPlaying() {
  const mini = document.querySelector('#sidebar .np');
  if (mini) mini.outerHTML = renderNowPlayingMini();
  const hero = document.querySelector('.hero');
  if (hero) hero.outerHTML = heroPanel();
  updatePlayerUI();
}

function setNowPlaying(track, status) {
  const np = DATA.nowPlaying;
  const before = [np.status, np.id, np.playing].join('|');
  np.status = status;
  if (track) {
    np.id = track.id;
    np.title = track.title;
    np.artist = track.artist;
    np.album = track.album;
    np.image = track.image;
    np.thumb = track.thumb;
    np.url = track.url;
    np.art = artSeedFor(track.id);
    np.duration = Math.round(track.durationMs / 1000);
    np.elapsed = Math.min(Math.floor(track.progressMs / 1000), np.duration);
    np.playing = track.playing;
  } else {
    np.id = null; np.image = null; np.thumb = null; np.url = null;
    np.elapsed = 0; np.duration = 0; np.playing = false;
  }
  // Only rebuild markup when something visible changed; progress ticks are cheap updates.
  if (before !== [np.status, np.id, np.playing].join('|')) paintNowPlaying();
  else updatePlayerUI();
}

let spotifyPollTimer = null;
let spotifyForbiddenWarned = false;

async function pollSpotify() {
  if (!app.session || !spotify.auth.isConnected()) { stopSpotifyPolling(); return; }
  if (document.hidden) return;
  try {
    const track = await spotify.nowPlaying();
    setNowPlaying(track, track ? 'track' : 'idle');
  } catch (err) {
    console.error('Spotify now playing failed:', err);
    if (!spotify.auth.isConnected()) {
      stopSpotifyPolling();
      refreshSettingsView();
      toast('spotifyExpired');
    } else if (err.status === 403 && !spotifyForbiddenWarned) {
      spotifyForbiddenWarned = true;
      toast('spotifyForbidden');
    }
  }
}

function startSpotifyPolling() {
  clearInterval(spotifyPollTimer);
  spotifyPollTimer = null;
  if (!app.session || !spotify.auth.isConnected()) return;
  if (DATA.nowPlaying.status === 'disconnected') setNowPlaying(null, 'idle');
  pollSpotify();
  spotifyPollTimer = setInterval(pollSpotify, 15000);
}

function stopSpotifyPolling() {
  clearInterval(spotifyPollTimer);
  spotifyPollTimer = null;
  setNowPlaying(null, 'disconnected');
}

function refreshSettingsView() {
  if (app.view === 'settings') setView('settings');
}

document.addEventListener('visibilitychange', function () {
  if (!document.hidden && spotifyPollTimer) pollSpotify();
});

// Advance the progress bar locally between polls; re-poll right as a track ends.
setInterval(function () {
  const np = DATA.nowPlaying;
  if (np.status !== 'track' || !np.playing || np.elapsed >= np.duration) return;
  np.elapsed += 1;
  updatePlayerUI();
  if (np.elapsed === np.duration) setTimeout(pollSpotify, 1500);
}, 1000);

function fillPostFromNowPlaying() {
  const np = DATA.nowPlaying;
  if (np.status !== 'track') return;
  document.getElementById('postTitle').value = np.title;
  document.getElementById('postArtist').value = np.artist;
  document.getElementById('postAlbum').value = np.album || '';
  setPostTrack({ id: np.id, image: np.thumb || np.image, title: np.title, artist: np.artist });
  document.getElementById('postNote').focus();
}

async function connectSpotify() {
  try {
    await spotify.auth.connect(location.hash);
  } catch (err) {
    console.error('Could not start Spotify sign-in:', err);
    toast('spotifyFailed');
  }
}

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
  postDeleted: ['success', 'Post deleted', 'It no longer shows up in anyone\'s feed'],
  reactionFailed: ['error', 'Reaction not saved', 'Check your connection and try again'],
  commentFailed: ['error', 'Comment not sent', 'Your text is still in the box, try again'],
  commentRateLimited: ['error', 'Slow down', 'Max 3 comments per post per minute. Your text is still in the box'],
  friendRequested: ['success', 'Request sent', 'They show up in your friends once they accept'],
  friendAccepted: ['success', 'You are now friends', 'Their posts now show in your feed'],
  friendDeclined: ['info', 'Request declined', 'They will not be notified'],
  friendCancelled: ['info', 'Request cancelled', 'You can send it again any time'],
  friendRemoved: ['success', 'Friend removed', 'Their posts no longer show in your Friends feed'],
  friendFailed: ['error', 'Something went wrong', 'The list was refreshed. Try again'],
  spotifyConnected: ['success', 'Spotify connected', 'What you play now shows up in vortex'],
  spotifyCancelled: ['info', 'Spotify not connected', 'You cancelled on the Spotify screen'],
  spotifyFailed: ['error', 'Could not connect Spotify', 'Try again in a moment'],
  spotifyDisconnected: ['success', 'Spotify disconnected', 'Remove full access at spotify.com/account/apps'],
  spotifyExpired: ['error', 'Spotify session ended', 'Connect again in Settings'],
  spotifyForbidden: ['error', 'Spotify blocked this account', 'While in development, only accounts on the tester list can connect'],
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

/* The Spotify track picked for the post being written: { id, image, title, artist } */
let postTrack = null;
let postSearchResults = [];
let postSearchTimer = null;
let postSearchSeq = 0;

function setPostTrack(track) {
  postTrack = track;
  const el = document.getElementById('postPicked');
  if (!el) return;
  el.innerHTML = track
    ? '<div class="post-picked">' +
        art(artSeedFor(track.id), null, track.image) +
        '<span class="t-body-s c-secondary truncate">Cover from Spotify · ' + esc(track.title) + '</span>' +
        '<button type="button" class="iconbtn" data-action="post-clear-track" data-tip="Remove cover" aria-label="Remove cover">' + icon('close', 15) + '</button>' +
      '</div>'
    : '';
}

function pickPostTrack(index) {
  const t = postSearchResults[index];
  if (!t) return;
  document.getElementById('postTitle').value = t.title;
  document.getElementById('postArtist').value = t.artist;
  document.getElementById('postAlbum').value = t.album || '';
  setPostTrack({ id: t.id, image: t.thumb, title: t.title, artist: t.artist });
  document.getElementById('postSpotifySearch').value = '';
  document.getElementById('postSpotifyResults').innerHTML = '';
  postSearchResults = [];
  document.getElementById('postNote').focus();
}

async function runPostSearch(query) {
  const box = document.getElementById('postSpotifyResults');
  const seq = ++postSearchSeq;
  if (!box) return;
  if (query.trim().length < 2) { box.innerHTML = ''; postSearchResults = []; return; }
  try {
    const results = await spotify.searchTracks(query, 5);
    if (seq !== postSearchSeq || !document.getElementById('postSpotifyResults')) return;
    postSearchResults = results;
    box.innerHTML = results.length
      ? results.map(function (t, i) {
          return '<button type="button" class="row post-search__row" data-pick-track="' + i + '">' +
            art(artSeedFor(t.id), null, t.thumb) +
            '<span class="row__meta">' +
              '<span class="t-body-m-med truncate">' + esc(t.title) + '</span>' +
              '<span class="t-body-s c-tertiary truncate">' + esc(t.artist) + (t.album ? ' · ' + esc(t.album) : '') + '</span>' +
            '</span>' +
          '</button>';
        }).join('')
      : '<p class="t-body-s c-tertiary">No songs found.</p>';
  } catch (err) {
    if (seq !== postSearchSeq) return;
    console.error('Spotify search failed:', err);
    box.innerHTML = '<p class="t-body-s c-tertiary">Spotify search failed. You can still type the song below.</p>';
  }
}

function openPostForm() {
  postTrack = null;
  postSearchResults = [];
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML =
    '<div class="scrim" data-scrim>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="postFormTitle">' +
        '<div class="modal__head">' +
          '<span class="toast__well toast__well--info">' + icon('broadcast', 15) + '</span>' +
          '<h2 class="t-title-s" id="postFormTitle">Share a track</h2>' +
        '</div>' +
        '<form id="postForm" class="modal__body" novalidate>' +
          '<div class="auth__note auth__note--error" id="postError" hidden>' + icon('close', 16) +
            '<p class="t-body-s c-secondary" id="postErrorText"></p>' +
          '</div>' +
          (DATA.nowPlaying.status === 'track'
            ? '<button type="button" class="btn btn--secondary btn--sm" data-action="post-use-np" style="justify-content:flex-start;min-width:0">' +
                icon('spotify', 15) + '<span class="truncate">Use what\'s playing: ' + esc(DATA.nowPlaying.title) + ' · ' + esc(DATA.nowPlaying.artist) + '</span></button>'
            : '') +
          (spotify.auth.isConnected()
            ? '<div class="auth__field">' +
                '<label class="t-label-m c-secondary" for="postSpotifySearch">Find on Spotify</label>' +
                '<span class="field">' + icon('search', 17) +
                  '<input id="postSpotifySearch" type="search" placeholder="Search a song to add its cover" autocomplete="off" maxlength="100"></span>' +
                '<div class="post-search" id="postSpotifyResults"></div>' +
              '</div>'
            : '<p class="t-body-s c-tertiary">Tip: <button type="button" class="btn btn--ghost btn--sm" data-action="spotify-connect" style="display:inline-flex;padding:0 4px">connect Spotify</button> to search songs and add their cover.</p>') +
          '<div id="postPicked"></div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="postTitle">Track title</label>' +
            '<span class="field">' + icon('disc', 17) +
              '<input id="postTitle" type="text" placeholder="Song name" maxlength="200" required></span>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="postArtist">Artist</label>' +
            '<span class="field">' + icon('user', 17) +
              '<input id="postArtist" type="text" placeholder="Artist name" maxlength="200" required></span>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="postAlbum">Album</label>' +
            '<span class="field">' + icon('disc', 17) +
              '<input id="postAlbum" type="text" placeholder="Optional" maxlength="200"></span>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="postNote">Note</label>' +
            '<span class="field field--area">' + icon('comment', 17) +
              '<textarea id="postNote" placeholder="What do you think? (optional)" maxlength="500" rows="3"></textarea></span>' +
          '</div>' +
        '</form>' +
        '<div class="modal__foot">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-close>Cancel</button>' +
          '<button type="submit" class="btn btn--primary btn--sm" form="postForm" id="postSubmit">Share</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.getElementById(spotify.auth.isConnected() ? 'postSpotifySearch' : 'postTitle').focus();
}

/* ---- reactions & comments ------------------------------------------------ */
function findPost(postId) {
  return DATA.feed.filter(function (p) { return p.id === postId; })[0];
}

function rerenderPost(postId) {
  const el = document.querySelector('[data-post="' + CSS.escape(postId) + '"]');
  const post = findPost(postId);
  if (!el || !post) return;
  const oldInput = el.querySelector('[data-comment-form] input');
  const draft = oldInput ? oldInput.value : '';
  const hadFocus = oldInput && document.activeElement === oldInput;
  el.outerHTML = postCard(post);
  const newInput = document.querySelector('[data-post="' + CSS.escape(postId) + '"] [data-comment-form] input');
  if (newInput) {
    newInput.value = draft;
    if (hadFocus) newInput.focus();
  }
}

const pendingReactions = {};

async function toggleReaction(postId, type) {
  const key = postId + ':' + type;
  const post = findPost(postId);
  if (!post || pendingReactions[key]) return;
  pendingReactions[key] = true;

  const was = post.reacted[type];
  const base = post.reactions[type];
  post.reacted[type] = !was;
  post.reactions[type] = base + (was ? -1 : 1);
  rerenderPost(postId);

  try {
    const on = await db.reactions.toggle(postId, app.session.user.id, type);
    post.reacted[type] = on;
    post.reactions[type] = base + (on ? 1 : 0) - (was ? 1 : 0);
  } catch (err) {
    console.error('Error toggling reaction:', err);
    post.reacted[type] = was;
    post.reactions[type] = base;
    toast('reactionFailed');
  }
  delete pendingReactions[key];
  rerenderPost(postId);
}

function toggleComments(postId) {
  UI.openComments[postId] = !UI.openComments[postId];
  rerenderPost(postId);
  if (UI.openComments[postId]) {
    const input = document.querySelector('[data-post="' + CSS.escape(postId) + '"] [data-comment-form] input');
    if (input) input.focus();
  }
}

async function handleCommentSubmit(form) {
  const postId = form.dataset.commentForm;
  const post = findPost(postId);
  const input = form.querySelector('input');
  const btn = form.querySelector('button');
  const content = input.value.trim();
  if (!post || !content) { input.focus(); return; }

  input.disabled = true; btn.disabled = true;
  try {
    const row = await db.comments.add(postId, app.session.user.id, content);
    row.author = { name: DATA.me.name };
    post.comments.push(transformComment(row, app.session.user.id));
    input.value = '';
    rerenderPost(postId);
    const next = document.querySelector('[data-post="' + CSS.escape(postId) + '"] [data-comment-form] input');
    if (next) next.focus();
  } catch (err) {
    console.error('Error adding comment:', err);
    input.disabled = false; btn.disabled = false;
    input.focus();
    toast(err && err.hint === 'rate_limited' ? 'commentRateLimited' : 'commentFailed');
  }
}

/* ---- friends ------------------------------------------------------------- */
function refreshFriendsUI() {
  [['friendsListPanel', friendsListPanel], ['friendRequestsPanel', friendRequestsPanel], ['friendSentPanel', friendSentPanel]]
    .forEach(function (pair) {
      const el = document.getElementById(pair[0]);
      if (el) el.outerHTML = pair[1]();
    });
  paintFriendResults();
  updateFriendsBadge();
}

function paintFriendResults() {
  const el = document.getElementById('friendResults');
  if (el) el.innerHTML = friendSearchResults();
}

let friendSearchTimer = null;
let friendSearchSeq = 0;

async function runFriendSearch() {
  const s = UI.friendSearch;
  const q = s.q.replace(/^@/, '').trim();
  const seq = ++friendSearchSeq;
  if (q.length < 2) { s.results = null; s.error = false; s.loading = false; paintFriendResults(); return; }
  s.loading = true; s.error = false;
  paintFriendResults();
  try {
    const rows = await db.profiles.search(q, app.session.user.id);
    if (seq !== friendSearchSeq) return;
    s.results = rows.map(function (r) { return toPerson(r, null); });
  } catch (err) {
    if (seq !== friendSearchSeq) return;
    console.error('Friend search failed:', err);
    s.error = true;
  }
  s.loading = false;
  paintFriendResults();
}

async function friendAction(btn, run, okToast, reloadFeed) {
  btn.disabled = true;
  try {
    await run();
    await loadFriends();
    refreshFriendsUI();
    if (okToast) toast(okToast);
    if (reloadFeed) loadFeed();
  } catch (err) {
    console.error('Friend action failed:', err);
    btn.disabled = false;
    // Their request may have crossed ours; resync so the buttons show the real state.
    loadFriends().then(refreshFriendsUI).catch(function () {});
    toast('friendFailed');
  }
}

function openRemoveFriend(friendshipId) {
  const friend = DATA.friends.filter(function (f) { return f.friendshipId === friendshipId; })[0];
  if (!friend) return;
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML =
    '<div class="scrim" data-scrim>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="removeFriendTitle">' +
        '<div class="modal__head">' +
          '<span class="toast__well toast__well--error">' + icon('users', 15) + '</span>' +
          '<h2 class="t-title-s" id="removeFriendTitle">Remove ' + esc(friend.name) + '?</h2>' +
        '</div>' +
        '<div class="modal__body">' +
          '<p class="t-body-m c-secondary">Their posts stop showing in your Friends feed, and yours in theirs. ' +
            'You can add each other again later.</p>' +
        '</div>' +
        '<div class="modal__foot">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-close>Cancel</button>' +
          '<button type="button" class="btn btn--primary btn--sm" id="removeFriendConfirm">Remove friend</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const confirm = document.getElementById('removeFriendConfirm');
  confirm.addEventListener('click', function () {
    friendAction(confirm, function () { return db.friends.remove(friendshipId); }, 'friendRemoved', true)
      .then(closeOverlay);
  });
  confirm.focus();
}

function openDeletePost(postId) {
  const post = DATA.feed.filter(function (p) { return p.id === postId; })[0];
  if (!post) return;
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML =
    '<div class="scrim" data-scrim>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="deletePostTitle">' +
        '<div class="modal__head">' +
          '<span class="toast__well toast__well--error">' + icon('trash', 15) + '</span>' +
          '<h2 class="t-title-s" id="deletePostTitle">Delete this post?</h2>' +
        '</div>' +
        '<div class="modal__body">' +
          '<p class="t-body-m c-secondary">Your post of <span class="c-primary">' + esc(post.track) + '</span> by ' +
            esc(post.artist) + ' will be removed, along with its reactions and comments. This cannot be undone.</p>' +
          '<div class="auth__note auth__note--error" id="deletePostError" hidden>' + icon('close', 16) +
            '<p class="t-body-s c-secondary" id="deletePostErrorText"></p>' +
          '</div>' +
        '</div>' +
        '<div class="modal__foot">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-close>Cancel</button>' +
          '<button type="button" class="btn btn--primary btn--sm" id="deletePostConfirm">Delete post</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const confirm = document.getElementById('deletePostConfirm');
  confirm.addEventListener('click', function () { handleDeletePost(postId, confirm); });
  confirm.focus();
}

async function handleDeletePost(postId, btn) {
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    await db.posts.remove(postId);
    closeOverlay();
    DATA.feed = DATA.feed.filter(function (p) { return p.id !== postId; });
    if (app.view === 'feed') setView('feed');
    toast('postDeleted');
  } catch (err) {
    document.getElementById('deletePostErrorText').textContent = err.message || 'Could not delete this post.';
    document.getElementById('deletePostError').hidden = false;
    btn.disabled = false; btn.textContent = 'Delete post';
  }
}

async function handlePostSubmit(form) {
  const trackTitle = form.querySelector('#postTitle').value.trim();
  const artist = form.querySelector('#postArtist').value.trim();
  const album = form.querySelector('#postAlbum').value.trim();
  const note = form.querySelector('#postNote').value.trim();
  const errBox = document.getElementById('postError');
  const errText = document.getElementById('postErrorText');

  if (!trackTitle || !artist) {
    errText.textContent = 'Track title and artist are required.';
    errBox.hidden = false;
    return;
  }

  // Same shapes the database constraints accept; anything else is dropped, not rejected.
  const image = postTrack && /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/.test(postTrack.image || '') ? postTrack.image : null;
  const trackId = postTrack && /^[A-Za-z0-9]{22}$/.test(postTrack.id || '') ? postTrack.id : null;

  const btn = document.getElementById('postSubmit');
  btn.disabled = true; btn.textContent = 'Sharing…';
  try {
    await db.posts.create(app.session.user.id, {
      trackTitle: trackTitle,
      artist: artist,
      album: album || null,
      note: note || null,
      artSeed: trackId ? artSeedFor(trackId) : 1 + Math.floor(Math.random() * 6),
      albumImageUrl: image,
      spotifyTrackId: trackId
    });
    closeOverlay();
    await loadFeed();
    if (app.view === 'feed') setView('feed');
    else location.hash = '#/feed';
  } catch (err) {
    errText.textContent = err.message || 'Could not share this track.';
    errBox.hidden = false;
    btn.disabled = false; btn.textContent = 'Share';
  }
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
  { label: 'Toggle compact sidebar', hint: 'Navigation', run: function () { setRail(document.getElementById('app').dataset.rail !== 'compact'); }, icon: 'bars' }
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
    else location.hash = '#/friends';
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

  const logoutBtn = t.closest('[data-action="logout"]');
  if (logoutBtn) { db.auth.signOut(); return; }

  if (t.closest('[data-action="new-post"]')) { openPostForm(); return; }
  if (t.closest('[data-action="share-now-playing"]')) { openPostForm(); fillPostFromNowPlaying(); return; }
  if (t.closest('[data-action="post-use-np"]')) { fillPostFromNowPlaying(); return; }

  if (t.closest('[data-action="spotify-connect"]')) { connectSpotify(); return; }
  if (t.closest('[data-action="spotify-disconnect"]')) {
    spotify.auth.disconnect();
    stopSpotifyPolling();
    refreshSettingsView();
    toast('spotifyDisconnected');
    return;
  }

  const deleteBtn = t.closest('[data-delete-post]');
  if (deleteBtn) { openDeletePost(deleteBtn.dataset.deletePost); return; }

  const addFriend = t.closest('[data-friend-add]');
  if (addFriend) {
    friendAction(addFriend, function () { return db.friends.send(app.session.user.id, addFriend.dataset.friendAdd); }, 'friendRequested');
    return;
  }
  const acceptFriend = t.closest('[data-friend-accept]');
  if (acceptFriend) {
    friendAction(acceptFriend, function () { return db.friends.accept(acceptFriend.dataset.friendAccept); }, 'friendAccepted', true);
    return;
  }
  const declineFriend = t.closest('[data-friend-decline]');
  if (declineFriend) {
    friendAction(declineFriend, function () { return db.friends.remove(declineFriend.dataset.friendDecline); }, 'friendDeclined');
    return;
  }
  const cancelFriend = t.closest('[data-friend-cancel]');
  if (cancelFriend) {
    friendAction(cancelFriend, function () { return db.friends.remove(cancelFriend.dataset.friendCancel); }, 'friendCancelled');
    return;
  }
  const removeFriend = t.closest('[data-friend-remove]');
  if (removeFriend) { openRemoveFriend(removeFriend.dataset.friendRemove); return; }

  const pickTrack = t.closest('[data-pick-track]');
  if (pickTrack) { pickPostTrack(+pickTrack.dataset.pickTrack); return; }
  if (t.closest('[data-action="post-clear-track"]')) { setPostTrack(null); return; }

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
    const card = react.closest('[data-post]');
    if (card) toggleReaction(card.dataset.post, react.dataset.react);
    return;
  }

  const commentBtn = t.closest('[data-comment]');
  if (commentBtn) {
    const card = commentBtn.closest('[data-post]');
    if (card) toggleComments(card.dataset.post);
    return;
  }

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
    return;
  }

  const tab = t.closest('[data-tab]');
  if (tab) {
    tab.parentElement.querySelectorAll('[data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b === tab));
    });
    if (tab.parentElement.dataset.tabs === 'feed' && UI.feedScope !== tab.dataset.tab) {
      UI.feedScope = tab.dataset.tab;
      loadFeed().then(function () { if (app.view === 'feed') setView('feed'); });
    }
    return;
  }
});

document.addEventListener('input', function (e) {
  if (e.target.id === 'friendSearch') {
    UI.friendSearch.q = e.target.value;
    clearTimeout(friendSearchTimer);
    friendSearchTimer = setTimeout(runFriendSearch, 250);
  }
  if (e.target.id === 'postSpotifySearch') {
    clearTimeout(postSearchTimer);
    postSearchTimer = setTimeout(function () { runPostSearch(e.target.value); }, 300);
  }
  // Hand-editing the song means the picked Spotify cover may no longer match.
  if ((e.target.id === 'postTitle' || e.target.id === 'postArtist') && postTrack) setPostTrack(null);
});

/* Re-fetch when entering these views so new requests / posts appear without a
   reload; only re-render when something actually changed. */
function refreshOnEnter(name) {
  if (!app.session) return;
  if (name === 'friends') {
    loadFriends().then(function () { if (app.view === 'friends') refreshFriendsUI(); })
      .catch(function (e) { console.error('Error loading friends:', e); });
  }
  if (name === 'feed') {
    const before = feedSignature();
    loadFriends().then(loadFeed).then(function () {
      if (app.view === 'feed' && feedSignature() !== before) setView('feed');
    }).catch(function (e) { console.error('Error refreshing feed:', e); });
  }
}

document.addEventListener('submit', function (e) {
  if (e.target.id === 'protoLogin') { e.preventDefault(); toast('login'); }
  if (e.target.id === 'authLoginForm') { e.preventDefault(); handleLogin(e.target); }
  if (e.target.id === 'authSignupForm') { e.preventDefault(); handleSignup(e.target); }
  if (e.target.id === 'postForm') { e.preventDefault(); handlePostSubmit(e.target); }
  if (e.target.dataset.commentForm) { e.preventDefault(); handleCommentSubmit(e.target); }
});

document.addEventListener('keydown', function (e) {
  // Enter in the Spotify search picks the top result instead of submitting the post.
  if (e.key === 'Enter' && e.target.id === 'postSpotifySearch') {
    e.preventDefault();
    if (postSearchResults.length) pickPostTrack(0);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); return; }
  if (e.key === 'Escape' && !document.getElementById('overlay').hidden) { closeOverlay(); return; }
  if (e.key === '/' && document.activeElement === document.body) { e.preventDefault(); openCmdk(); }
});

window.addEventListener('hashchange', function () {
  const name = currentRoute();
  setView(name);
  refreshOnEnter(name);
});

/* ---- boot ---------------------------------------------------------------- */
(async function boot() {
  let spotifyResult = null;
  if (location.pathname === '/callback') {
    spotifyResult = await spotify.auth.handleCallback();
    const back = /^#\/[\w-]*$/.test(spotifyResult.returnHash) ? spotifyResult.returnHash : '#/settings';
    history.replaceState(null, '', '/' + back);
  }

  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(STORE.get('theme', prefersLight ? 'light' : 'dark'));
  document.getElementById('sidebar').innerHTML = renderSidebar();
  document.getElementById('bottomnav').innerHTML = renderBottomNav();
  document.getElementById('mobilebar').innerHTML = renderMobileBar();
  setRail(STORE.get('rail', 'full') === 'compact');
  setAmbient(STORE.get('ambient', '1') === '1');

  app.session = await db.auth.getSession();
  if (app.session) await loadCurrentUser();

  db.auth.onChange(function (event, session) {
    app.session = session;
    if (event === 'SIGNED_OUT') {
      // Spotify tokens are per-browser, so the next vortex account must not inherit them.
      spotify.auth.disconnect();
      stopSpotifyPolling();
      DATA.friends = []; DATA.incoming = []; DATA.outgoing = []; DATA.feed = [];
      UI.friendSearch = { q: '', results: null, loading: false, error: false };
      location.hash = '#/login';
      setView(currentRoute());
    }
    if (event === 'SIGNED_IN') {
      loadCurrentUser().then(function () {
        location.hash = '#/home';
        setView(currentRoute());
        startSpotifyPolling();
      });
    }
  });

  if (!location.hash) location.hash = app.session ? '#/home' : '#/login';
  setView(currentRoute());
  startSpotifyPolling();

  if (spotifyResult) {
    if (spotifyResult.ok) toast('spotifyConnected');
    else toast(spotifyResult.error === 'access_denied' ? 'spotifyCancelled' : 'spotifyFailed');
  }
})();
