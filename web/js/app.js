/* ==========================================================================
   vortex — application shell
   ========================================================================== */

const NAV = [
  { group: 'Listening' },
  { id: 'home',         label: t('Home'),         icon: 'home' },
  { id: 'feed',         label: t('Feed'),         icon: 'broadcast' },
  { id: 'friends',      label: t('Friends'),      icon: 'users' },
  { id: 'notifications', label: t('Notifications'), icon: 'bell' },
  { id: 'activity',     label: t('Activity'),     icon: 'activity' },
  { id: 'music',        label: t('Music'),        icon: 'disc' },
  { group: 'You' },
  { id: 'profile',      label: t('Profile'),      icon: 'user' },
  { id: 'recap',        label: t('Recap'),        icon: 'sparkle' },
  { id: 'customization', label: t('Customization'), icon: 'droplet' },
  { id: 'experimental', label: t('Experimental'), icon: 'flask', dot: true },
  { id: 'settings',     label: t('Settings'),     icon: 'sliders' }
];

const MOBILE_NAV = ['home', 'feed', 'friends', 'music', 'profile'];
const PUBLIC_VIEWS = ['login', 'signup', 'forgot'];
/* Shown without the sidebar and tab bar: the public views, plus choosing a new password
   and 'welcome' (choosing a username after a first Google sign-in, accepting the privacy policy). */
const BARE_VIEWS = PUBLIC_VIEWS.concat('reset', 'welcome');
/* The effective date printed in web/privacy.html. Bump both together when the policy
   changes materially: everyone who accepted an older one is asked again on their next visit. */
const PRIVACY_VERSION = '2026-10-02';
const PRIVACY_URL = LANG === 'pt' ? '/privacidade' : '/privacy';

const STORE = {
  get: function (k, fallback) {
    try { const v = localStorage.getItem('vortex.' + k); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  },
  set: function (k, v) { try { localStorage.setItem('vortex.' + k, v); } catch (e) { /* private mode */ } }
};

const app = {
  view: 'home',
  session: null,
  /* Every route shows 'welcome' while either is true: the username was generated rather than
     chosen, or the profile hasn't accepted the current privacy policy. */
  needsUsername: false,
  needsConsent: false
};

function onboardingPending() { return app.needsUsername || app.needsConsent; }

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

  if (diffMins < 1) return t('now');
  if (diffMins < 60) return t('{n}m', { n: diffMins });
  if (diffHours < 24) return t('{n}h', { n: diffHours });
  if (diffDays < 7) return t('{n}d', { n: diffDays });

  const posted_short = posted.toLocaleDateString(loc('en-US'), { month: 'short', day: 'numeric' });
  return posted_short;
}

function transformComment(c, currentUserId) {
  const name = c.author ? c.author.name : t('Unknown');
  return {
    id: c.id,
    parentId: c.parent_id || null,
    username: c.author ? c.author.username : '',
    user: name,
    initials: initialsFrom(name),
    avatarUrl: c.author ? c.author.avatar_url : null,
    text: c.content,
    time: formatTimeAgo(c.created_at),
    createdAt: c.created_at,
    mine: c.user_id === currentUserId
  };
}

function isBlocked(userId) {
  return DATA.blocked.some(function (b) { return b.id === userId; });
}

function transformPostData(post, currentUserId) {
  const reactions = post.reactions || [];
  function count(type) { return reactions.filter(function (r) { return r.type === type; }).length; }
  function mineOf(type) { return reactions.some(function (r) { return r.type === type && r.user_id === currentUserId; }); }
  const comments = (post.comments || [])
    .filter(function (c) { return !isBlocked(c.user_id); })
    .slice()
    .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
    .map(function (c) { return transformComment(c, currentUserId); });

  return {
    id: post.id,
    mine: post.user_id === currentUserId,
    userId: post.user_id,
    username: post.author.username,
    user: post.author.name,
    initials: initialsFrom(post.author.name),
    avatarUrl: post.author.avatar_url,
    time: formatTimeAgo(post.created_at),
    createdAt: post.created_at,
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
    app.needsUsername = profile.username_confirmed === false;
    // Before supabase/schema.sql adds the column there's nothing to save an answer to, so don't ask.
    app.needsConsent = 'privacy_version' in profile && profile.privacy_version !== PRIVACY_VERSION;
    await Promise.all([loadFriends(), loadMyActivity(), loadBlocks()]);

    DATA.me.name = profile.name;
    DATA.me.email = app.session.user.email;
    DATA.me.username = '@' + profile.username;
    DATA.me.initials = initialsFrom(profile.name);
    DATA.me.avatarUrl = profile.avatar_url || null;
    DATA.me.pin = pinFromRow(profile);
    DATA.me.bio = profile.bio || '';
    DATA.me.shareListening = profile.share_listening !== false;
    DATA.me.shareTaste = profile.share_taste !== false;

    const joinedDate = new Date(profile.created_at);
    const month = joinedDate.toLocaleString(loc('en-US'), { month: 'long' });
    const year = joinedDate.getFullYear();
    DATA.me.joined = t('{month} {year}', { month: month, year: year });

    repaintSidebar();

    await loadFeed();
  } catch (e) { console.error('Error loading user:', e); }
}

/* Your totals and latest shares, for Home and Profile. Failures leave the
   previous values (or the "—" placeholders) rather than breaking the page. */
async function loadMyActivity() {
  if (!app.session) return;
  const me = app.session.user.id;
  try {
    const results = await Promise.all([db.stats.forUser(me), db.posts.list(5, [me])]);
    DATA.me.stats = results[0];
    DATA.me.recentPosts = results[1].map(function (p) { return transformPostData(p, me); });
  } catch (e) {
    console.error('Error loading your activity:', e);
  }
}

function toPerson(profile, friendshipId) {
  return {
    friendshipId: friendshipId,
    id: profile.id,
    name: profile.name,
    username: profile.username,
    initials: initialsFrom(profile.name),
    avatarUrl: profile.avatar_url || null,
    pin: pinFromRow(profile)
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

/* Missing table (schema not run yet) or a network blip just means nobody is hidden. */
async function loadBlocks() {
  if (!app.session) return;
  try {
    const rows = await db.blocks.list(app.session.user.id);
    DATA.blocked = rows.filter(function (r) { return r.blocked; }).map(function (r) { return toPerson(r.blocked, null); });
  } catch (err) {
    console.warn('Could not load blocked accounts:', err);
  }
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
  if (dot) dot.setAttribute('aria-label', tn(DATA.incoming.length, '{n} friend request', '{n} friend requests'));
}

let feedLoadSeq = 0;

async function loadFeed() {
  if (!app.session) return;
  const seq = ++feedLoadSeq;
  const scope = UI.feedScope;
  if (!DATA.feed.length) UI.feedStatus = 'loading';
  try {
    const me = app.session.user.id;
    const authors = scope === 'Friends' ? [me].concat(DATA.friends.map(function (f) { return f.id; })) : null;
    const posts = await db.posts.list(30, authors);
    if (seq !== feedLoadSeq) return;  // a newer load (e.g. the other tab) owns the feed now
    DATA.feed = posts.filter(function (post) { return !isBlocked(post.user_id); }).map(function (post) {
      return transformPostData(post, me);
    });
    UI.feedStatus = 'ok';
    backfillCovers();
  } catch (e) {
    if (seq !== feedLoadSeq) return;
    console.error('Error loading feed:', e);
    UI.feedStatus = 'error';
  }
}

async function retryFeed() {
  UI.feedStatus = 'loading';
  if (app.view === 'feed' || app.view === 'home') setView(app.view);
  await loadFeed();
  if (app.view === 'feed' || app.view === 'home') setView(app.view);
}

function feedSignature() {
  return UI.feedStatus + '|' + DATA.feed.map(function (p) {
    return [p.id, p.reactions.flame, p.reactions.heart, p.comments.length, p.image || ''].join(':');
  }).join('|');
}

/* Posts saved before covers existed get one looked up on Spotify, if this
   viewer has Spotify connected. When the viewer is the author, the cover is
   saved to the post so everyone else sees it too; otherwise it's only shown
   in this browser. */
const COVER_URL = /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/;
const TRACK_ID = /^[A-Za-z0-9]{22}$/;
let coverBackfillRun = 0;
const coversSaved = new Set();  // back-to-back feed loads shouldn't write the same cover twice

async function backfillCovers() {
  if (!spotify.auth.isConnected()) return;
  const run = ++coverBackfillRun;
  const copies = {};  // the same post can sit in both the feed and your recent shares
  DATA.feed.concat(DATA.me.recentPosts).forEach(function (p) {
    if (!p.image) (copies[p.id] = copies[p.id] || []).push(p);
  });
  const ids = Object.keys(copies);
  for (let i = 0; i < ids.length; i++) {
    if (run !== coverBackfillRun) return;
    const list = copies[ids[i]];
    const p = list[0];
    let hit;
    try {
      hit = await spotify.findCover(p.track, p.artist);
    } catch (err) {
      console.warn('Cover lookup failed:', err);
      return;
    }
    if (!hit || run !== coverBackfillRun) continue;
    list.forEach(function (copy) {
      copy.image = hit.image;
      if (!copy.trackId) copy.trackId = hit.id;
    });
    rerenderPost(p.id);
    if (p.mine && !coversSaved.has(p.id) && COVER_URL.test(hit.image || '') && TRACK_ID.test(hit.id || '')) {
      coversSaved.add(p.id);
      db.posts.setCover(p.id, hit.image, hit.id).catch(function (err) {
        coversSaved.delete(p.id);
        console.warn('Could not save cover to post:', err);
      });
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
  if (s < 60) return t('{n}s', { n: s });
  const r = s % 60;
  return t('{m}m {s}s', { m: Math.floor(s / 60), s: (r < 10 ? '0' : '') + r });
}

function paintLoginLock() {
  clearInterval(loginLockTimer);
  const btn = document.getElementById('authLoginSubmit');
  if (!btn) return;
  function tick() {
    const left = loginLockRemaining();
    if (!btn.isConnected || left <= 0) {
      clearInterval(loginLockTimer);
      if (btn.isConnected) { btn.disabled = false; btn.textContent = t('Log in'); }
      return;
    }
    btn.disabled = true;
    btn.textContent = t('Try again in {time}', { time: formatWait(left) });
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
  btn.disabled = true; btn.textContent = t('Signing in…');
  try {
    await db.auth.signIn(email, pass);
    writeLoginGuard({});
  } catch (err) {
    btn.disabled = false; btn.textContent = t('Log in');
    if (err && err.status === 429) {
      showAuthMessage(t('Too many sign-in attempts from this network. Wait a few minutes and try again.'), true);
      return;
    }
    if (isBadCredentials(err)) {
      const g = recordLoginFailure();
      if (loginLockRemaining() > 0) {
        showAuthMessage(t('Too many failed attempts. Sign-in is paused for {time}.', { time: formatWait(loginLockRemaining()) }), true);
        paintLoginLock();
        return;
      }
      const left = LOGIN_GUARD.maxFails - g.fails;
      showAuthMessage(left <= 2
        ? tn(left, 'Wrong email or password. {n} attempt left before sign-in is paused.', 'Wrong email or password. {n} attempts left before sign-in is paused.')
        : t('Wrong email or password.'), true);
      return;
    }
    showAuthMessage(err.message || t('Could not sign in'), true);
  }
}

async function handleSignup(form) {
  const name = form.querySelector('#authName').value.trim();
  const username = form.querySelector('#authUsername').value.trim();
  const email = form.querySelector('#authEmail').value.trim();
  const pass = form.querySelector('#authPass').value;
  const consent = form.querySelector('#authConsent');
  if (!consent.checked) { consentMissing(consent, t('Accept the privacy policy to create an account.')); return; }
  const btn = document.getElementById('authSignupSubmit');
  btn.disabled = true; btn.textContent = t('Creating account…');
  try {
    const data = await db.auth.signUp(email, pass, { username, name, privacyVersion: PRIVACY_VERSION });
    if (!data.session) {
      showAuthMessage(t('Check your email to confirm your account, then log in.'), false);
      btn.disabled = false; btn.textContent = t('Create account');
    }
  } catch (err) {
    showAuthMessage(err.message || t('Could not create account'), true);
    btn.disabled = false; btn.textContent = t('Create account');
  }
}

/* ---- password reset --------------------------------------------------------- */
/* Supabase rate-limits reset emails per address; the 60s wait mirrors its default. */
const RESET_COOLDOWN_MS = 60000;
const forgotState = { draft: '', sentTo: null, cooldownUntil: 0 };
/* Where "Cancel" and a saved password lead: back to Settings when that's where you came from. */
let resetReturn = '#/home';
let forgotTimer = null;

async function sendResetLink(email) {
  await db.auth.sendPasswordReset(email);
  forgotState.sentTo = email;
  forgotState.cooldownUntil = Date.now() + RESET_COOLDOWN_MS;
}

function resetErrorText(err) {
  if (err && err.status === 429) return t('Too many reset emails were sent. Wait a few minutes and try again.');
  return (err && err.message) || t('Could not send the email. Try again in a moment.');
}

async function handleForgot(form) {
  const email = form.querySelector('#authEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthMessage(t('Enter the email address you signed up with.'), true); return; }
  const btn = document.getElementById('authForgotSubmit');
  btn.disabled = true; btn.textContent = t('Sending…');
  try {
    await sendResetLink(email);
    setView('forgot');
  } catch (err) {
    console.error('Password reset email failed:', err);
    btn.disabled = false; btn.textContent = t('Send reset link');
    showAuthMessage(resetErrorText(err), true);
  }
}

async function resendResetLink() {
  if (!forgotState.sentTo || Date.now() < forgotState.cooldownUntil) return;
  const btn = document.getElementById('forgotResend');
  if (btn) { btn.disabled = true; btn.textContent = t('Sending…'); }
  try {
    await sendResetLink(forgotState.sentTo);
    showToast('<span class="toast__well toast__well--success">' + icon('check', 15) + '</span>' +
      '<span class="toast__body"><span class="t-label-m">' + t('Sent again') + '</span><span class="t-caption c-tertiary">' + t('Use the newest email; older links stop working') + '</span></span>');
  } catch (err) {
    console.error('Password reset email failed:', err);
    toast('resetFailed');
  }
  paintForgotCooldown();
}

function paintForgotCooldown() {
  clearInterval(forgotTimer);
  function tick() {
    const btn = document.getElementById('forgotResend');
    const left = forgotState.cooldownUntil - Date.now();
    if (!btn) { clearInterval(forgotTimer); return; }
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? t('Send it again in {n}s', { n: Math.ceil(left / 1000) }) : t('Send it again');
    if (left <= 0) clearInterval(forgotTimer);
  }
  tick();
  forgotTimer = setInterval(tick, 1000);
}

async function handleReset(form) {
  const pass = form.querySelector('#authNewPass').value;
  const again = form.querySelector('#authNewPass2').value;
  if (pass.length < 6) { showAuthMessage(t('Use at least 6 characters.'), true); return; }
  if (pass !== again) { showAuthMessage(t('The two passwords don’t match.'), true); return; }
  const btn = document.getElementById('authResetSubmit');
  btn.disabled = true; btn.textContent = t('Saving…');
  try {
    await db.auth.setPassword(pass);
    location.hash = resetReturn;
    toast('passwordUpdated');
  } catch (err) {
    console.error('Password update failed:', err);
    btn.disabled = false; btn.textContent = t('Save new password');
    showAuthMessage(err && err.code === 'same_password'
      ? t('That’s your current password. Pick a different one.')
      : (err && err.message) || t('Could not save the password. Try again.'), true);
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
          '<span class="t-label-m truncate">' + (connected ? t('Nothing playing') : t('Spotify not connected')) + '</span>' +
          '<span class="t-caption c-tertiary truncate">' + (connected ? t('Play something on Spotify') : t('Connect to show your music')) + '</span>' +
        '</div>' +
        (connected ? '' : '<button class="iconbtn" data-action="spotify-connect" data-tip="' + t('Connect Spotify') + '" aria-label="' + t('Connect Spotify') + '">' + icon('plus', 17) + '</button>') +
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
        ? '<span class="eq" aria-label="' + t('Playing') + '"><i></i><i></i><i></i></span>'
        : '<span class="t-meta c-tertiary">' + t('Paused') + '</span>') +
    '</div>' +
    '<div class="track track--thin"><i data-np-bar style="width:0%"></i></div>' +
    '<div class="np__times">' +
      '<span class="t-meta c-tertiary" data-np-elapsed>' + mmss(np.elapsed) + '</span>' +
      '<span class="t-meta c-tertiary">' + mmss(np.duration) + '</span>' +
    '</div>' +
  '</div>';
}

function renderSidebar() {
  const layout = navLayout();
  const byId = {};
  NAV.forEach(function (n) { if (n.id) byId[n.id] = n; });
  function link(n) {
    return '<a class="nav" href="#/' + n.id + '" data-view-link="' + n.id + '">' +
      icon(n.icon, 19) +
      '<span>' + n.label + '</span>' +
      (n.dot ? '<span class="nav__dot" aria-label="' + t('In development') + '"></span>' : '') +
      (n.id === 'friends' && DATA.incoming.length
        ? '<span class="nav__dot" aria-label="' + tn(DATA.incoming.length, '{n} friend request', '{n} friend requests') + '"></span>' : '') +
      (n.id === 'notifications' ? notifCountEl() : '') +
    '</a>';
  }
  let nav = layout.groups.map(function (g) {
    const items = g.ids.filter(function (id) { return !layout.hidden[id]; }).map(function (id) { return link(byId[id]); });
    return items.length ? '<p class="nav-group t-overline">' + t(g.name) + '</p>' + items.join('') : '';
  }).join('');
  const pinned = layout.pins.map(function (u) { return DATA.friends.filter(function (f) { return f.username === u; })[0]; }).filter(Boolean);
  if (pinned.length) {
    nav += '<p class="nav-group t-overline">' + t('Pinned') + '</p>' + pinned.map(function (f) {
      return '<a class="nav nav--person" href="#/u/' + esc(f.username) + '" data-profile-link="' + esc(f.username) + '">' +
        avatarEl(f.initials, '24', null, f.avatarUrl) + '<span>' + esc(f.name) + '</span></a>';
    }).join('');
  }

  return '' +
  '<div class="sidebar__brand">' +
    '<a class="brand" href="#/home"><img class="brand__mark" src="assets/logo-64.png" width="22" height="22" alt="vortex"><b>vortex</b></a>' +
    '<button class="iconbtn" id="railToggle" data-tip="' + t('Collapse sidebar') + '" aria-label="' + t('Collapse sidebar') + '">' +
      icon('chevronLeft', 17) + '</button>' +
  '</div>' +
  '<button class="field field--sm sidebar__search" id="openCmdk">' +
    icon('search', 15) + '<span class="c-tertiary">' + t('Search') + '</span>' +
    '<span class="field__kbd">⌘K</span>' +
  '</button>' +
  '<nav class="sidebar__nav scroll">' + nav + '</nav>' +
  '<div class="sidebar__foot">' +
    renderNowPlayingMini() +
    '<button class="userchip" data-nav="profile">' +
      avatarEl(DATA.me.initials, '32', 'online', DATA.me.avatarUrl) +
      '<span class="userchip__meta">' +
        '<span class="t-label-m truncate">' + esc(DATA.me.name) + '</span>' +
        '<span class="t-caption c-tertiary truncate">' + esc(DATA.me.username) + '</span>' +
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
    '<a class="iconbtn iconbtn--lg mbell" href="#/notifications" data-view-link="notifications" aria-label="' + t('Notifications') + '">' + icon('bell', 18) +
      (DATA.notifications.unread ? '<b class="mbell__dot"></b>' : '') + '</a>' +
    '<button class="iconbtn iconbtn--lg" id="openCmdkMobile" aria-label="' + t('Search') + '">' + icon('search', 18) + '</button>' +
    '<button class="iconbtn iconbtn--lg" data-nav="settings" aria-label="' + t('Settings') + '">' + icon('sliders', 18) + '</button>';
}

function notifCountEl() {
  const n = DATA.notifications.unread;
  return n ? '<b class="nav__count" aria-label="' + tn(n, '{n} unread notification', '{n} unread notifications') + '">' + (n > 9 ? '9+' : n) + '</b>' : '';
}

function updateNotifBadge() {
  const link = document.querySelector('#sidebar [data-view-link="notifications"]');
  if (link) {
    const old = link.querySelector('.nav__count');
    if (old) old.remove();
    link.insertAdjacentHTML('beforeend', notifCountEl());
  }
  const bell = document.querySelector('#mobilebar .mbell');
  if (bell) {
    const dot = bell.querySelector('.mbell__dot');
    if (DATA.notifications.unread && !dot) bell.insertAdjacentHTML('beforeend', '<b class="mbell__dot"></b>');
    if (!DATA.notifications.unread && dot) dot.remove();
  }
}

/* ---- routing ------------------------------------------------------------ */
/* Dynamic routes: #/u/<username> (profile), #/compare/<username>, #/p/<post id>. */
const DYNAMIC_ROUTES = { u: 'friendProfile', compare: 'compare', p: 'post' };

function routeParts() {
  const raw = (location.hash || '').replace(/^#\/?/, '').trim();
  const i = raw.indexOf('/');
  if (i < 0) return { head: raw, param: '' };
  let param = raw.slice(i + 1);
  try { param = decodeURIComponent(param); } catch (e) { param = ''; }
  return { head: raw.slice(0, i), param: param.trim() };
}

function friendProfileUsername() {
  const r = routeParts();
  return r.head === 'u' || r.head === 'compare' ? r.param : '';
}

/* A shared link opened while logged out: remembered so logging in lands on it. */
let pendingDeepLink = null;

function currentRoute() {
  const r = routeParts();
  // A password-reset link still opens its own screen; onboarding resumes after it.
  if (app.session && onboardingPending() && r.head !== 'reset') return 'welcome';
  if (DYNAMIC_ROUTES[r.head] && r.param) {
    if (app.session) return DYNAMIC_ROUTES[r.head];
    pendingDeepLink = '#/' + r.head + '/' + encodeURIComponent(r.param);
    return 'login';
  }
  const raw = r.head === 'appearance' ? 'customization' : r.head;  // old links
  const dynamicView = Object.keys(DYNAMIC_ROUTES).some(function (k) { return DYNAMIC_ROUTES[k] === raw; });
  const target = VIEWS[raw] && !dynamicView ? raw : 'home';
  const isPublic = PUBLIC_VIEWS.indexOf(target) > -1;
  if (!app.session && !isPublic) return 'login';
  if (app.session && (isPublic || target === 'welcome')) return 'home';
  return target;
}

function setView(name) {
  app.view = name;
  document.getElementById('viewRoot').innerHTML = VIEWS[name]();
  markCurrentNav();
  const authed = BARE_VIEWS.indexOf(name) === -1;
  document.getElementById('app').dataset.authed = String(authed);
  document.getElementById('sidebar').hidden = !authed;
  document.getElementById('bottomnav').hidden = !authed;
  document.getElementById('mobilebar').hidden = !authed;
  const fp = UI.friendProfile && UI.friendProfile.status === 'ok' && UI.friendProfile.username === friendProfileUsername() ? UI.friendProfile.profile : null;
  const label = name === 'friendProfile' ? (fp ? fp.name : t('Profile'))
    : name === 'compare' ? (fp ? t('You and {name}', { name: fp.name.split(/\s+/)[0] }) : t('Compare'))
    : name === 'post' ? t('Post')
    : (NAV.filter(function (n) { return n.id === name; })[0] || {}).label || 'vortex';
  document.title = label + ' · vortex';
  syncAppearanceControls();
  updatePlayerUI();
  if (name === 'login') paintLoginLock();
  if (name === 'forgot') paintForgotCooldown();
  ensureSpotifyLibrary(name);
  const scroller = document.querySelector('.view-scroll');
  if (scroller) scroller.scrollTop = 0;
}

function markCurrentNav() {
  const name = app.view;
  document.querySelectorAll('[data-view-link]').forEach(function (a) {
    if (a.dataset.viewLink === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const user = name === 'friendProfile' ? friendProfileUsername().toLowerCase() : '';
  document.querySelectorAll('[data-profile-link]').forEach(function (a) {
    if (user && a.dataset.profileLink.toLowerCase() === user) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function repaintSidebar() {
  document.getElementById('sidebar').innerHTML = renderSidebar();
  markCurrentNav();
  applyRail();
}

/* ---- theme & preferences ------------------------------------------------ */
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  STORE.set('theme', theme);
  syncAppearanceControls();
}

/* Below 1100px the grid only has room for the rail, so it's compact whatever the saved preference says. */
const RAIL_NARROW = window.matchMedia('(max-width: 1100px)');

function railPref() { return STORE.get('rail', 'full') === 'compact'; }

function setRail(compact) {
  STORE.set('rail', compact ? 'compact' : 'full');
  applyRail();
}

function applyRail() {
  const compact = railPref() || RAIL_NARROW.matches;
  document.getElementById('app').dataset.rail = compact ? 'compact' : 'full';
  const btn = document.getElementById('railToggle');
  if (btn) {
    btn.style.transform = compact ? 'rotate(180deg)' : '';
    btn.dataset.tip = compact ? t('Expand sidebar') : t('Collapse sidebar');
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
  const railOn = railPref();
  const railToggle = document.querySelector('[data-toggle="rail"]');
  if (railToggle) railToggle.setAttribute('aria-checked', String(railOn));
  const ambOn = STORE.get('ambient', '1') === '1';
  const ambToggle = document.querySelector('[data-toggle="ambient"]');
  if (ambToggle) ambToggle.setAttribute('aria-checked', String(ambOn));
  syncCustomization();
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

let lastSpotifyPoll = 0;

async function pollSpotify() {
  if (!app.session || !spotify.auth.isConnected()) { stopSpotifyPolling(); return; }
  // In a background tab keep a slow heartbeat, so friends still see you as live.
  if (document.hidden && Date.now() - lastSpotifyPoll < 55000) return;
  lastSpotifyPoll = Date.now();
  try {
    const track = await spotify.nowPlaying();
    setNowPlaying(track, track ? 'track' : 'idle');
    publishListening(track);
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

/* ---- sharing what you listen to with friends ----------------------------- */
const LISTENING_HEARTBEAT_MS = 60000;
let lastPublished = { key: null, at: 0 };

/* Writes only when the track or play state changes, plus a once-a-minute
   heartbeat while playing so friends can tell the row is still live.
   Private-session plays are never written. */
async function publishListening(track) {
  if (!app.session || !DATA.me.shareListening) return;
  const me = app.session.user.id;
  const sharable = track && !track.private;
  const key = sharable ? track.id + '|' + track.playing : 'stopped';
  const now = Date.now();
  const heartbeatDue = sharable && track.playing && now - lastPublished.at >= LISTENING_HEARTBEAT_MS;
  if (key === lastPublished.key && !heartbeatDue) return;
  lastPublished = { key: key, at: now };
  try {
    if (!sharable) {
      await db.listening.pause(me);
      return;
    }
    await db.listening.publish(me, {
      trackId: TRACK_ID.test(track.id || '') ? track.id : null,
      title: String(track.title || '').slice(0, 300),
      artist: String(track.artist || '').slice(0, 300),
      album: track.album ? String(track.album).slice(0, 300) : null,
      imageUrl: COVER_URL.test(track.thumb || '') ? track.thumb : null,
      playing: track.playing,
      progressMs: Math.max(0, Math.round(track.progressMs || 0)),
      durationMs: Math.max(0, Math.round(track.durationMs || 0))
    });
  } catch (err) {
    lastPublished.key = null;  // retry on the next poll
    console.warn('Could not share what you are listening to:', err);
  }
}

async function clearMyListening() {
  lastPublished = { key: null, at: 0 };
  if (!app.session) return;
  try { await db.listening.clear(app.session.user.id); }
  catch (err) { console.warn('Could not clear listening status:', err); }
}

let unsubscribeListening = null;

async function reloadListening() {
  if (!app.session) return;
  const me = app.session.user.id;
  try {
    const rows = await db.listening.list();
    DATA.listening = {};
    rows.forEach(function (r) { if (r.user_id !== me) DATA.listening[r.user_id] = r; });
    refreshListeningUI();
  } catch (err) {
    console.warn('Could not load what friends are listening to:', err);
  }
}

async function startListeningFeed() {
  stopListeningFeed();
  if (!app.session) return;
  const me = app.session.user.id;
  await reloadListening();
  unsubscribeListening = db.listening.subscribe(function (type, row, old) {
    if (type === 'DELETE') {
      if (old && old.user_id) delete DATA.listening[old.user_id];
    } else if (row && row.user_id && row.user_id !== me) {
      DATA.listening[row.user_id] = row;
    }
    refreshListeningUI();
  });
}

function stopListeningFeed() {
  if (unsubscribeListening) unsubscribeListening();
  unsubscribeListening = null;
  DATA.listening = {};
}

function refreshListeningUI() {
  [['friendsListeningPanel', friendsListeningPanel], ['friendsListPanel', friendsListPanel], ['homeFriendsPanel', homeFriendsPanel]]
    .forEach(function (pair) {
      const el = document.getElementById(pair[0]);
      if (el) el.outerHTML = pair[1]();
    });
}

// "Live" ages out after a couple of minutes without a heartbeat; re-evaluate.
setInterval(function () {
  if (Object.keys(DATA.listening).length) refreshListeningUI();
}, 30000);

async function setShareListening(on) {
  if (!app.session) return;
  const me = app.session.user.id;
  DATA.me.shareListening = on;
  try {
    await db.profiles.update(me, { share_listening: on });
    if (on) { lastPublished = { key: null, at: 0 }; lastSpotifyPoll = 0; pollSpotify(); }
    else await clearMyListening();
    toast(on ? 'shareOn' : 'shareOff');
  } catch (err) {
    console.error('Could not change sharing:', err);
    DATA.me.shareListening = !on;
    refreshSettingsView();
    toast('settingFailed');
  }
}

/* ---- Spotify library (Activity, Music, Profile) -------------------------- */
// Top lists move slowly; recent plays change with every song.
const LIBRARY_TTL_MS = { recent: 60000, playlists: 300000, topArtists: 600000, topTracks: 600000 };
const LIBRARY_FETCH = {
  recent: function () { return spotify.recentlyPlayed(); },
  playlists: function () { return spotify.playlists(); },
  topArtists: function (range) { return spotify.topArtists(range); },
  topTracks: function (range) { return spotify.topTracks(range); }
};

function resetSpotifyLibrary() {
  UI.spotifyLib = { recent: null, playlists: null, topArtists: {}, topTracks: {} };
  UI.playlistItems = {};
  UI.playlistOpen = null;
  UI.savedPlaylist = {};
  UI.compatOpen = null;
}

function libraryEntry(key, range) {
  return range ? UI.spotifyLib[key][range] : UI.spotifyLib[key];
}

function setLibraryEntry(key, range, entry) {
  if (range) UI.spotifyLib[key][range] = entry;
  else UI.spotifyLib[key] = entry;
}

async function loadLibrary(key, range) {
  const cur = libraryEntry(key, range);
  if (cur && (cur.status === 'loading' || (cur.status === 'ok' && Date.now() - cur.at < LIBRARY_TTL_MS[key]))) return;
  setLibraryEntry(key, range, { status: 'loading', data: cur ? cur.data : null, at: 0 });
  let entry;
  try {
    entry = { status: 'ok', data: await LIBRARY_FETCH[key](range), at: Date.now() };
  } catch (err) {
    console.error('Spotify ' + key + ' failed:', err);
    entry = { status: 'error', error: err.status || 0, data: cur ? cur.data : null, at: 0 };
  }
  setLibraryEntry(key, range, entry);
  paintLibraryPanels();
  if (entry.status === 'ok' && range === 'medium_term') maybePublishTaste();
}

function ensureSpotifyLibrary(view) {
  if (!app.session) return;
  // A friend's profile needs their snapshot (and yours, for compatibility) but
  // not your Spotify connection, so it loads even before you connect one.
  if (view === 'friendProfile' || view === 'compare') { loadFriendProfile(friendProfileUsername()); loadTastes(); }
  if (view === 'notifications') loadNotifications();
  if (view === 'post') loadPostView(routeParts().param);
  if (view === 'recap') { loadRecapStats(); loadTastes(); }
  if (!spotify.auth.isConnected() || spotify.auth.missingScopes().length) return;
  // The ~6-month lists feed your DNA snapshot, so any Spotify page keeps it fresh.
  if (['activity', 'music', 'profile', 'friendProfile', 'compare', 'recap'].indexOf(view) > -1) {
    loadLibrary('topArtists', 'medium_term');
    loadLibrary('topTracks', 'medium_term');
  }
  if (view === 'home') loadLibrary('topArtists', 'short_term');
  if (view === 'recap') {
    loadLibrary('topArtists', 'short_term');
    loadLibrary('topTracks', 'short_term');
    loadLibrary('topArtists', 'long_term');
  }
  if (view === 'activity') { loadLibrary('recent'); loadLibrary('topArtists', UI.activityRange); }
  if (view === 'music') { loadLibrary('recent'); loadLibrary('topTracks', UI.musicRange); loadLibrary('playlists'); loadTastes(); }
  if (view === 'profile') {
    loadLibrary('recent');
    loadLibrary('playlists');
    ['short_term', 'long_term'].forEach(function (r) { loadLibrary('topArtists', r); });
    if (UI.dnaRange !== 'medium_term') loadLibrary('topArtists', UI.dnaRange);
    loadTastes();
  }
}

const FRIEND_PROFILE_TTL_MS = 60000;

/* Loads a profile by username for the #/u/<username> route: the profile row,
   sharing totals, and a few recent shares. Their music DNA comes separately
   from DATA.tastes (loadTastes), same source the compatibility panel uses. */
async function loadFriendProfile(username) {
  if (!username || !app.session) return;
  const cur = UI.friendProfile;
  if (cur && cur.username === username && (cur.status === 'loading' ||
    (cur.status !== 'error' && Date.now() - (cur.at || 0) < FRIEND_PROFILE_TTL_MS))) return;
  UI.friendProfile = { username: username, status: 'loading' };
  try {
    const profile = await db.profiles.getByUsername(username);
    if (!profile) {
      UI.friendProfile = { username: username, status: 'notfound', at: Date.now() };
    } else if (profile.id === app.session.user.id) {
      // Viewing your own username through this route: send them to the real thing.
      location.hash = '#/profile';
      return;
    } else {
      const results = await Promise.all([db.stats.forUser(profile.id), db.posts.list(6, [profile.id])]);
      UI.friendProfile = {
        username: username, status: 'ok', at: Date.now(), profile: profile,
        stats: results[0],
        posts: results[1].map(function (p) { return transformPostData(p, app.session.user.id); })
      };
    }
  } catch (err) {
    console.error('Could not load profile:', err);
    UI.friendProfile = { username: username, status: 'error', at: Date.now() };
  }
  if ((app.view === 'friendProfile' || app.view === 'compare') && friendProfileUsername() === username) setView(app.view);
}

/* ---- notifications -------------------------------------------------------- */
const NOTIF_TTL_MS = 15000;
let notifLoadedAt = 0;
let unsubscribeNotifications = null;

function toNotification(n) {
  const actor = n.actor ? toPerson(n.actor, null) : null;
  if (!actor) return null;
  return {
    id: n.id, type: n.type, reaction: n.reaction, at: n.created_at, time: formatTimeAgo(n.created_at),
    read: !!n.read_at, actor: actor, friendshipId: n.friendship_id,
    post: n.post ? { id: n.post.id, track: n.post.track_title, artist: n.post.artist, image: n.post.album_image_url, art: n.post.art_seed || 1 } : null,
    comment: n.comment ? String(n.comment.content || '').slice(0, 280) : null,
    threadId: n.comment && n.type === 'reply' ? n.comment.parent_id || null : null
  };
}

async function refreshNotifCount() {
  if (!app.session) return;
  try {
    DATA.notifications.unread = await db.notifications.unreadCount();
    updateNotifBadge();
  } catch (err) { console.warn('Could not count notifications:', err); }
}

/* Opening the list marks everything read on the server, but rows that were
   unread keep their "new" look for as long as you stay on the page. */
async function loadNotifications(force) {
  const st = DATA.notifications;
  if (!app.session || st.status === 'loading' || (!force && st.status === 'ok' && Date.now() - notifLoadedAt < NOTIF_TTL_MS)) return;
  st.status = 'loading';
  try {
    const rows = await db.notifications.list(40);
    st.items = rows.map(toNotification).filter(Boolean);
    st.status = 'ok';
    notifLoadedAt = Date.now();
    UI.notifFresh = {};
    st.items.forEach(function (n) { if (!n.read) UI.notifFresh[n.id] = true; });
    if (st.items.some(function (n) { return !n.read; }) || st.unread) {
      st.unread = 0;
      updateNotifBadge();
      db.notifications.markAllRead().catch(function (err) { console.warn('Could not mark notifications read:', err); });
    }
  } catch (err) {
    console.error('Could not load notifications:', err);
    st.status = 'error';
  }
  if (app.view === 'notifications') setView('notifications');
}

function startNotifications() {
  stopNotifications();
  if (!app.session) return;
  refreshNotifCount();
  unsubscribeNotifications = db.notifications.subscribe(app.session.user.id, function () {
    sounds.notify();
    if (app.view === 'notifications') { loadNotifications(true); return; }
    DATA.notifications.unread++;
    DATA.notifications.status = 'idle';
    updateNotifBadge();
    db.notifications.list(1).then(function (rows) {
      const n = rows[0] && toNotification(rows[0]);
      if (n && !n.read && app.view !== 'notifications') notifToast(n);
    }).catch(function () {});
    // Someone may have just sent a request or accepted yours.
    loadFriends().then(refreshFriendsUI).catch(function () {});
  });
}

function stopNotifications() {
  if (unsubscribeNotifications) unsubscribeNotifications();
  unsubscribeNotifications = null;
}

/* ---- single post (#/p/<id>) ------------------------------------------------ */
async function loadPostView(id) {
  if (!id || !app.session) return;
  const cur = UI.postView;
  if (cur && cur.id === id && (cur.status === 'loading' || cur.status === 'ok')) return;
  UI.postView = { id: id, status: 'loading' };
  try {
    const row = await db.posts.get(id);
    UI.postView = row
      ? { id: id, status: 'ok', post: transformPostData(row, app.session.user.id) }
      : { id: id, status: 'notfound' };
    if (row) UI.openComments[id] = true;
  } catch (err) {
    console.error('Could not load post:', err);
    UI.postView = { id: id, status: /uuid/i.test(err && err.message || '') ? 'notfound' : 'error' };
  }
  if (app.view === 'post' && routeParts().param === id) setView('post');
}

/* ---- recap ------------------------------------------------------------------ */
async function loadRecapStats() {
  if (!app.session) return;
  const cur = UI.recapStats;
  if (cur && (cur.status === 'loading' || (cur.status === 'ok' && Date.now() - cur.at < 300000))) return;
  UI.recapStats = { status: 'loading' };
  try {
    UI.recapStats = { status: 'ok', at: Date.now(), data: await db.stats.forUser(app.session.user.id, recapSince().toISOString()) };
  } catch (err) {
    console.warn('Could not load recap stats:', err);
    UI.recapStats = { status: 'error' };
  }
  paintLibraryPanels();
}

async function recapImage(btn, share) {
  btn.disabled = true;
  try {
    const blob = await renderRecapImage();
    if (!blob) throw new Error('Canvas export failed');
    const file = new File([blob], 'vortex-recap.png', { type: 'image/png' });
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: t('My last 4 weeks on vortex') });
      } catch (err) {
        if (err && err.name !== 'AbortError') throw err;
      }
    } else {
      if (share) toast('recapNoShare');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'vortex-recap.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }
  } catch (err) {
    console.error('Could not create the recap image:', err);
    toast('imageFailed');
  }
  btn.disabled = false;
}

/* ---- song of the moment ---------------------------------------------------- */
let pinPick = null;           // { trackId, title, artist, image }
let pinResults = [];
let pinSearchTimer = null;
let pinSearchSeq = 0;

function setPinPick(t) {
  pinPick = t;
  const el = document.getElementById('pinPicked');
  if (el) el.innerHTML = t ? pinPickedMarkup(t) : '';
  const search = document.getElementById('pinSearch');
  if (search && t) { search.value = ''; document.getElementById('pinResults').innerHTML = ''; pinResults = []; }
}

function openPinForm() {
  pinPick = null;
  pinResults = [];
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML = pinFormMarkup();
  const first = document.getElementById('pinSearch') || document.getElementById('pinTitle');
  if (first) first.focus();
}

async function runPinSearch(query) {
  const box = document.getElementById('pinResults');
  const seq = ++pinSearchSeq;
  if (!box) return;
  if (query.trim().length < 2) { box.innerHTML = ''; pinResults = []; return; }
  try {
    const results = await spotify.searchTracks(query, 5);
    if (seq !== pinSearchSeq || !document.getElementById('pinResults')) return;
    pinResults = results;
    box.innerHTML = results.length
      ? results.map(function (t, i) {
          return '<button type="button" class="row post-search__row" data-pin-pick="' + i + '">' +
            art(artSeedFor(t.id), null, t.thumb) +
            '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(t.title) + '</span>' +
            '<span class="t-body-s c-tertiary truncate">' + esc(t.artist) + '</span></span></button>';
        }).join('')
      : '<p class="t-body-s c-tertiary">' + t('No songs found.') + '</p>';
  } catch (err) {
    if (seq !== pinSearchSeq) return;
    console.error('Spotify search failed:', err);
    box.innerHTML = '<p class="t-body-s c-tertiary">' + t('Spotify search failed. Try again in a moment.') + '</p>';
  }
}

async function handlePinSubmit(form) {
  const note = form.querySelector('#pinNote').value.trim();
  const errBox = document.getElementById('pinError');
  const errText = document.getElementById('pinErrorText');
  let pick = pinPick;
  if (!pick && form.querySelector('#pinTitle')) {
    const title = form.querySelector('#pinTitle').value.trim();
    const artist = form.querySelector('#pinArtist').value.trim();
    if (title && artist) pick = { trackId: null, title: title, artist: artist, image: null };
  }
  if (!pick) {
    errText.textContent = form.querySelector('#pinSearch') ? t('Search for a song and pick one from the list.') : t('Type the song and the artist.');
    errBox.hidden = false;
    return;
  }
  const btn = document.getElementById('pinSubmit');
  btn.disabled = true;
  try {
    const row = await db.profiles.setPin(app.session.user.id, {
      trackId: TRACK_ID.test(pick.trackId || '') ? pick.trackId : null,
      title: pick.title.slice(0, 200), artist: pick.artist.slice(0, 200),
      image: COVER_URL.test(pick.image || '') ? pick.image : null,
      note: note.slice(0, 140) || null
    });
    DATA.me.pin = pinFromRow(row);
    closeOverlay();
    if (app.view === 'profile') setView('profile');
    toast('pinSaved');
  } catch (err) {
    console.error('Could not pin song:', err);
    errText.textContent = t('Could not save it. Check your connection and try again.');
    errBox.hidden = false;
    btn.disabled = false;
  }
}

async function clearPin(btn) {
  btn.disabled = true;
  try {
    await db.profiles.setPin(app.session.user.id, null);
    DATA.me.pin = null;
    if (app.view === 'profile') setView('profile');
    toast('pinCleared');
  } catch (err) {
    console.error('Could not unpin song:', err);
    btn.disabled = false;
    toast('settingFailed');
  }
}

/* ---- music DNA ------------------------------------------------------------ */
const TASTE_REPUBLISH_MS = 12 * 3600 * 1000;

/* Publishes your snapshot when it changed, or at most every 12 hours. */
async function maybePublishTaste() {
  if (!app.session || !DATA.me.shareTaste) return;
  const snap = mySnapshot();
  if (!snap || !snap.artists.length) return;
  const me = app.session.user.id;
  const sig = JSON.stringify(snap);
  let last = {};
  try { last = JSON.parse(STORE.get('taste.' + me, '{}')) || {}; } catch (e) { /* corrupt entry */ }
  if (last.sig === sig && Date.now() - (last.at || 0) < TASTE_REPUBLISH_MS) return;
  try {
    await db.taste.publish(me, snap);
    STORE.set('taste.' + me, JSON.stringify({ sig: sig, at: Date.now() }));
  } catch (err) {
    console.warn('Could not share your music DNA:', err);
  }
}

let tastesLoadedAt = 0;   // throttle: when the last request started
let tastesStatus = 'idle'; // 'idle' until the first answer, then 'ok' or 'error'
async function loadTastes(force) {
  if (!app.session || (!force && Date.now() - tastesLoadedAt < 120000)) return;
  tastesLoadedAt = Date.now();
  const me = app.session.user.id;
  try {
    const rows = await db.taste.list();
    DATA.tastes = {};
    rows.forEach(function (r) { if (r.user_id !== me) DATA.tastes[r.user_id] = sanitizeSnapshot(r); });
    tastesStatus = 'ok';
  } catch (err) {
    tastesLoadedAt = 0;
    if (tastesStatus !== 'ok') tastesStatus = 'error';
    console.warn('Could not load friends\' music DNA:', err);
  }
  paintLibraryPanels();
}

async function setShareTaste(on) {
  if (!app.session) return;
  const me = app.session.user.id;
  DATA.me.shareTaste = on;
  try {
    await db.profiles.update(me, { share_taste: on });
    STORE.set('taste.' + me, '{}');
    if (on) maybePublishTaste(); else await db.taste.clear(me);
    toast(on ? 'tasteOn' : 'tasteOff');
  } catch (err) {
    console.error('Could not change DNA sharing:', err);
    DATA.me.shareTaste = !on;
    refreshSettingsView();
    toast('settingFailed');
  }
}

async function openPlaylist(id) {
  UI.playlistOpen = UI.playlistOpen === id ? null : id;
  paintLibraryPanels();
  if (!UI.playlistOpen) return;
  const cur = UI.playlistItems[id];
  if (cur && (cur.status === 'loading' || cur.status === 'ok')) return;
  UI.playlistItems[id] = { status: 'loading' };
  try {
    UI.playlistItems[id] = { status: 'ok', data: await spotify.playlistItems(id, 200) };
  } catch (err) {
    console.error('Spotify playlist items failed:', err);
    UI.playlistItems[id] = { status: 'error', error: err.status || 0 };
  }
  paintLibraryPanels();
  const detail = document.getElementById('musPlaylistDetail');
  if (detail && UI.playlistOpen === id) detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function saveTopTracksPlaylist() {
  const range = UI.musicRange;
  const tracks = libData('topTracks', range);
  if (!tracks || !tracks.length) return;
  UI.savedPlaylist[range] = { status: 'saving' };
  paintLibraryPanels();
  const month = new Date().toLocaleDateString(loc('en-GB'), { month: 'short', year: 'numeric' });
  try {
    const res = await spotify.createPlaylist(
      t('vortex · top tracks · {range} ({month})', { range: t(RANGE_LABEL[range]).toLowerCase(), month: month }),
      t('Your {n} top tracks on Spotify over the last {range}, saved from vortex.', { n: tracks.length, range: t(RANGE_LABEL[range]).toLowerCase() }),
      tracks.map(function (t) { return t.id; })
    );
    UI.savedPlaylist[range] = { status: 'ok', url: res.url };
    UI.spotifyLib.playlists = null;
    toast('playlistSaved');
  } catch (err) {
    console.error('Could not save playlist:', err);
    UI.savedPlaylist[range] = null;
    toast('playlistFailed');
  }
  paintLibraryPanels();
  if (app.view === 'music') loadLibrary('playlists');
}

async function saveBlend(profileId) {
  const fp = UI.friendProfile;
  const theirs = DATA.tastes[profileId];
  const mine = mySnapshot();
  if (!fp || fp.status !== 'ok' || fp.profile.id !== profileId || !theirs || !mine) return;
  const b = blendTracks(mine, theirs);
  const me = (DATA.me.name || t('You')).split(/\s+/)[0];
  const them = fp.profile.name.split(/\s+/)[0];
  UI.blend[profileId] = { status: 'saving' };
  paintLibraryPanels();
  try {
    const res = await spotify.createPlaylist(
      'vortex · ' + me + ' + ' + them,
      t('What {me} and {them} both love, then each one\'s favorites, taking turns. Made on vortex.', { me: me, them: them }),
      b.tracks.map(function (t) { return t.id; })
    );
    UI.blend[profileId] = { status: 'ok', url: res.url };
    UI.spotifyLib.playlists = null;
    toast('playlistSaved');
  } catch (err) {
    console.error('Could not create blend playlist:', err);
    UI.blend[profileId] = null;
    toast('playlistFailed');
  }
  paintLibraryPanels();
}

const AVATAR_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

async function handleAvatarFile(file) {
  if (!app.session) return;
  const ext = AVATAR_TYPES[file.type];
  if (!ext) { toast('avatarInvalid'); return; }
  if (file.size > AVATAR_MAX_BYTES) { toast('avatarTooBig'); return; }
  const me = app.session.user.id;
  const wrap = document.querySelector('.avatar-edit');
  if (wrap) wrap.classList.add('avatar-edit--busy');
  try {
    const up = await db.storage.uploadAvatar(me, file, ext);
    await db.profiles.update(me, { avatar_url: up.url });
    DATA.me.avatarUrl = up.url;
    db.storage.pruneAvatars(me, up.path).catch(function () {});
    repaintSidebar();
    if (app.view === 'profile') setView('profile');
    toast('avatarUpdated');
  } catch (err) {
    console.error('Could not update avatar:', err);
    if (wrap) wrap.classList.remove('avatar-edit--busy');
    toast('avatarFailed');
  }
}

async function saveDnaImage(btn) {
  btn.disabled = true;
  try {
    const blob = await renderDnaImage();
    if (!blob) throw new Error('Canvas export failed');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vortex-music-dna.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  } catch (err) {
    console.error('Could not create the DNA image:', err);
    toast('imageFailed');
  }
  btn.disabled = false;
}

/* Swap just the panels whose data arrived, so the page doesn't flash. */
function paintLibraryPanels() {
  LIBRARY_PANELS.forEach(function (pair) {
    const el = document.getElementById(pair[0]);
    if (el) el.outerHTML = pair[1]();
  });
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
  postDeleted: ['success', t('Post deleted'), t('It no longer shows up in anyone\'s feed')],
  postLinkCopied: ['success', t('Link copied'), t('Anyone on vortex with the link can open this post')],
  profileLinkCopied: ['success', t('Link copied'), t('It opens the profile, with an Add friend button')],
  linkFailed: ['error', t('Could not copy the link'), t('Your browser blocked the clipboard')],
  profileSaved: ['success', t('Profile saved'), t('Everyone sees the new version now')],
  passwordUpdated: ['success', t('Password changed'), t('Use the new one next time you log in')],
  userBlocked: ['success', t('Blocked'), t('Unblock any time in Settings')],
  userUnblocked: ['info', t('Unblocked'), t('They can find and add you again')],
  blockFailed: ['error', t('Something went wrong'), t('Check your connection and try again')],
  resetFailed: ['error', t('Email not sent'), t('Wait a few minutes and try again')],
  reactionFailed: ['error', t('Reaction not saved'), t('Check your connection and try again')],
  commentFailed: ['error', t('Comment not sent'), t('Your text is still in the box, try again')],
  commentRateLimited: ['error', t('Slow down'), t('Max 3 comments per post per minute. Your text is still in the box')],
  friendRequested: ['success', t('Request sent'), t('They show up in your friends once they accept')],
  friendAccepted: ['success', t('You are now friends'), t('Their posts now show in your feed')],
  friendDeclined: ['info', t('Request declined'), t('They will not be notified')],
  friendCancelled: ['info', t('Request cancelled'), t('You can send it again any time')],
  friendRemoved: ['success', t('Friend removed'), t('Their posts no longer show in your Friends feed')],
  friendFailed: ['error', t('Something went wrong'), t('The list was refreshed. Try again')],
  shareOn: ['success', t('Sharing is on'), t('Friends can see what you are listening to')],
  shareOff: ['info', t('Sharing is off'), t('Friends no longer see what you are listening to')],
  settingFailed: ['error', t('Setting not saved'), t('Check your connection and try again')],
  tasteOn: ['success', t('Music DNA shared'), t('Friends can now compare tastes with you')],
  tasteOff: ['info', t('Music DNA private'), t('Your snapshot was deleted from vortex')],
  playlistSaved: ['success', t('Playlist saved'), t('It\'s private, in your Spotify library')],
  playlistFailed: ['error', t('Playlist not saved'), t('Spotify refused it. Try again in a moment')],
  imageFailed: ['error', t('Image not created'), t('Your browser blocked the export. Try again')],
  avatarUpdated: ['success', t('Photo updated'), t('Your new photo is now visible to everyone')],
  avatarFailed: ['error', t('Photo not saved'), t('Check your connection and try again')],
  avatarInvalid: ['error', t('Unsupported file'), t('Use a PNG, JPEG, WebP or GIF image')],
  avatarTooBig: ['error', t('Image too large'), t('Photos must be 5MB or smaller')],
  lookReset: ['info', t('Back to defaults'), t('Accent, glass, density, animations, sound and sidebar were reset')],
  pinSaved: ['success', t('Song pinned'), t('It\'s the first thing people see on your profile')],
  pinCleared: ['info', t('Song unpinned'), t('Pin another one any time from your profile')],
  recapNoShare: ['info', t('Saved instead'), t('This browser can\'t share images, so the recap was downloaded')],
  spotifyConnected: ['success', t('Spotify connected'), t('What you play now shows up in vortex')],
  spotifyCancelled: ['info', t('Spotify not connected'), t('You cancelled on the Spotify screen')],
  spotifyFailed: ['error', t('Could not connect Spotify'), t('Try again in a moment')],
  spotifyDisconnected: ['success', t('Spotify disconnected'), t('Remove full access at spotify.com/account/apps')],
  spotifyExpired: ['error', t('Spotify session ended'), t('Connect again in Settings')],
  spotifyForbidden: ['error', t('Spotify blocked this account'), t('While in development, only accounts on the tester list can connect')]
};

function toast(kind) {
  const spec = TOASTS[kind];
  if (!spec) return;
  if (spec[0] === 'error') sounds.error(); else sounds.success();
  const glyph = { success: 'check', info: 'broadcast', error: 'close' }[spec[0]];
  showToast(
    '<span class="toast__well toast__well--' + spec[0] + '">' + icon(glyph, 15) + '</span>' +
    '<span class="toast__body">' +
      '<span class="t-label-m">' + esc(spec[1]) + '</span>' +
      '<span class="t-caption c-tertiary">' + esc(spec[2]) + '</span>' +
    '</span>');
}

/* A live notification while you're elsewhere in the app; the body opens it. */
function notifToast(n) {
  showToast(
    '<a class="toast__link" href="' + notifHref(n) + '"' + (n.threadId ? ' data-open-thread="' + esc(n.threadId) + '"' : '') + '>' +
      avatarEl(n.actor.initials, '32', null, n.actor.avatarUrl) +
      '<span class="toast__body">' +
        '<span class="t-body-s notif__text clamp-2">' + notifText(n) + '</span>' +
        (n.comment ? '<span class="t-caption c-tertiary truncate">“' + esc(n.comment) + '”</span>' : '') +
      '</span>' +
    '</a>');
}

function showToast(inner) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = inner + '<button class="iconbtn" aria-label="' + t('Dismiss') + '">' + icon('close', 15) + '</button>';
  const link = el.querySelector('.toast__link');
  if (link) link.addEventListener('click', function () { el.remove(); });
  const stack = document.getElementById('toasts');
  stack.appendChild(el);
  const kill = function () {
    el.classList.add('toast--out');
    setTimeout(function () { el.remove(); }, 200);
  };
  el.querySelector('button').addEventListener('click', kill);
  setTimeout(kill, 5000);
}

/* ---- edit profile ------------------------------------------------------------ */
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const NAME_MAX = 50;
const BIO_MAX = 160;
let usernameCheckTimer = null;
let usernameCheckSeq = 0;

function myHandle() { return DATA.me.username.replace(/^@/, ''); }

function openEditProfile(focusId) {
  const me = DATA.me;
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML =
    '<div class="scrim" data-scrim>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="profileFormTitle">' +
        '<div class="modal__head">' +
          '<span class="toast__well toast__well--info">' + icon('user', 15) + '</span>' +
          '<h2 class="t-title-s" id="profileFormTitle">' + t('Edit profile') + '</h2>' +
        '</div>' +
        '<form id="profileForm" class="modal__body" novalidate>' +
          '<div class="auth__note auth__note--error" id="profileError" hidden>' + icon('close', 16) +
            '<p class="t-body-s c-secondary" id="profileErrorText"></p>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="editName">' + t('Display name') + '</label>' +
            '<span class="field">' + icon('user', 17) +
              '<input id="editName" type="text" maxlength="' + NAME_MAX + '" autocomplete="name" required value="' + esc(me.name) + '"></span>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="editUsername">' + t('Username') + '</label>' +
            '<span class="field"><span class="field__at" aria-hidden="true">@</span>' +
              '<input id="editUsername" type="text" maxlength="20" autocomplete="username" spellcheck="false" required value="' + esc(myHandle()) + '" aria-describedby="editUsernameHint"></span>' +
            '<p class="t-caption field-hint" id="editUsernameHint">' + t('Your profile link is {link}', { link: esc(location.host) + '/#/u/' + esc(myHandle()) }) + '</p>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary field-label-row" for="editBio">' + t('Bio') + '<span class="t-caption c-tertiary" id="editBioCount">' + (me.bio || '').length + ' / ' + BIO_MAX + '</span></label>' +
            '<span class="field field--area">' + icon('comment', 17) +
              '<textarea id="editBio" maxlength="' + BIO_MAX + '" rows="3" placeholder="' + t('A line about you and what you listen to') + '">' + esc(me.bio || '') + '</textarea></span>' +
          '</div>' +
        '</form>' +
        '<div class="modal__foot">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-close>' + t('Cancel') + '</button>' +
          '<button type="submit" class="btn btn--primary btn--sm" form="profileForm" id="profileSubmit">' + t('Save') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const first = document.getElementById(focusId || 'editName');
  first.focus();
  first.setSelectionRange(first.value.length, first.value.length);
}

function setUsernameHint(text, state, hintId) {
  const hint = document.getElementById(hintId || 'editUsernameHint');
  if (!hint) return;
  hint.textContent = text;
  hint.dataset.state = state || '';
}

/* Live feedback while typing; the save re-checks, since this can go stale.
   `first` is the choose-your-username screen, where nothing links to the old handle yet. */
function checkUsernameInput(value, first) {
  clearTimeout(usernameCheckTimer);
  const seq = ++usernameCheckSeq;
  const hintId = first ? 'welcomeUsernameHint' : 'editUsernameHint';
  const u = value.trim();
  if (u.toLowerCase() === myHandle().toLowerCase()) {
    setUsernameHint(t('Your profile link is {link}', { link: location.host + '/#/u/' + (u || myHandle()) }), '', hintId);
    return;
  }
  if (!USERNAME_RE.test(u)) { setUsernameHint(t('Use 3 to 20 letters, numbers or _'), 'bad', hintId); return; }
  setUsernameHint(t('Checking @{username}…', { username: u }), '', hintId);
  usernameCheckTimer = setTimeout(async function () {
    try {
      const taken = await db.profiles.usernameTaken(u, app.session.user.id);
      if (seq !== usernameCheckSeq) return;
      setUsernameHint(taken ? t('@{username} is taken', { username: u })
        : first ? t('@{username} is free.', { username: u }) : t('@{username} is free. Links to your old username will stop working.', { username: u }), taken ? 'bad' : 'good', hintId);
    } catch (err) {
      if (seq === usernameCheckSeq) setUsernameHint(t('Could not check this username right now'), '', hintId);
    }
  }, 350);
}

/* Nothing is sent until the box is ticked; the label turns red so the reason is next to the box. */
function consentMissing(input, msg) {
  showAuthMessage(msg, true);
  input.closest('.consent').dataset.invalid = 'true';
  input.focus();
}

/* Holds the session until the generated handle is confirmed (first Google sign-in) and the
   current privacy policy is accepted. The form only shows the parts still missing. */
async function handleWelcome(form) {
  const nameInput = form.querySelector('#welcomeName');
  const consent = form.querySelector('#welcomeConsent');
  const fields = {};
  let username = '';
  if (nameInput) {
    const name = nameInput.value.replace(/\s+/g, ' ').trim();
    username = form.querySelector('#welcomeUsername').value.trim();
    if (!name) { showAuthMessage(t('Add a display name.'), true); return; }
    if (!USERNAME_RE.test(username)) { showAuthMessage(t('Usernames use 3 to 20 letters, numbers or _.'), true); return; }
    fields.name = name.slice(0, NAME_MAX);
    fields.username = username;
    fields.username_confirmed = true;
  }
  if (consent) {
    if (!consent.checked) { consentMissing(consent, t('Accept the privacy policy to continue.')); return; }
    fields.privacy_version = PRIVACY_VERSION;
  }
  const btn = document.getElementById('authWelcomeSubmit');
  btn.disabled = true; btn.textContent = t('Saving…');
  const me = app.session.user.id;
  try {
    if (nameInput && username.toLowerCase() !== myHandle().toLowerCase() && await db.profiles.usernameTaken(username, me)) {
      btn.disabled = false; btn.textContent = t('Continue');
      showAuthMessage(t('@{username} is taken. Try another.', { username: username }), true);
      return;
    }
    await db.profiles.update(me, fields);
    app.needsUsername = false;
    app.needsConsent = false;
    await loadCurrentUser();
    location.hash = pendingDeepLink || '#/home';
    pendingDeepLink = null;
    setView(currentRoute());
  } catch (err) {
    console.error('Could not save username:', err);
    btn.disabled = false; btn.textContent = t('Continue');
    showAuthMessage(err && err.code === '23505' ? t('@{username} is taken. Try another.', { username: username }) : t('Could not save. Check your connection and try again.'), true);
  }
}

async function handleGoogle(btn) {
  // On the signup page the policy box covers Google too. From log in, a new account accepts on the welcome screen.
  const consent = document.getElementById('authConsent');
  if (consent && !consent.checked) { consentMissing(consent, t('Accept the privacy policy to create an account.')); return; }
  const label = btn.querySelector('span');
  btn.disabled = true; label.textContent = t('Opening Google…');
  // The page is about to leave, so the shared link a logged-out visitor opened, and the box ticked
  // on the signup page, ride along in sessionStorage.
  try {
    sessionStorage.setItem('vortex.oauth', JSON.stringify({ back: pendingDeepLink, privacy: consent ? PRIVACY_VERSION : null }));
  } catch (e) { /* private mode */ }
  try {
    await db.auth.signInWithGoogle();
  } catch (err) {
    console.error('Google sign-in failed:', err);
    btn.disabled = false; label.textContent = t('Continue with Google');
    showAuthMessage((err && err.message) || t('Could not start Google sign-in. Try again.'), true);
  }
}

async function handleProfileSubmit(form) {
  const name = form.querySelector('#editName').value.replace(/\s+/g, ' ').trim();
  const username = form.querySelector('#editUsername').value.trim();
  const bio = form.querySelector('#editBio').value.replace(/\s+/g, ' ').trim();
  const errBox = document.getElementById('profileError');
  const errText = document.getElementById('profileErrorText');
  function fail(msg, focusId) {
    errText.textContent = msg;
    errBox.hidden = false;
    if (focusId) form.querySelector('#' + focusId).focus();
  }
  if (!name) return fail(t('Add a display name.'), 'editName');
  if (!USERNAME_RE.test(username)) return fail(t('Usernames use 3 to 20 letters, numbers or _.'), 'editUsername');

  const me = app.session.user.id;
  const btn = document.getElementById('profileSubmit');
  btn.disabled = true; btn.textContent = t('Saving…');
  try {
    if (username.toLowerCase() !== myHandle().toLowerCase() && await db.profiles.usernameTaken(username, me)) {
      btn.disabled = false; btn.textContent = t('Save');
      return fail(t('@{username} is taken. Try another.', { username: username }), 'editUsername');
    }
    const row = await db.profiles.update(me, { name: name.slice(0, NAME_MAX), username: username, bio: bio.slice(0, BIO_MAX) || null });
    DATA.me.name = row.name;
    DATA.me.username = '@' + row.username;
    DATA.me.initials = initialsFrom(row.name);
    DATA.me.bio = row.bio || '';
    closeOverlay();
    repaintSidebar();
    setView(app.view);
    toast('profileSaved');
  } catch (err) {
    console.error('Could not save profile:', err);
    btn.disabled = false; btn.textContent = t('Save');
    fail(err && err.code === '23505' ? t('@{username} is taken. Try another.', { username: username }) : t('Could not save. Check your connection and try again.'));
  }
}

/* ---- share links ------------------------------------------------------------ */
/* Phones get the system share sheet; desktops copy, since their share dialogs
   are slower than a paste. */
async function shareLink(hash) {
  const url = location.origin + '/' + hash;
  const kind = hash.indexOf('#/p/') === 0 ? 'postLinkCopied' : 'profileLinkCopied';
  if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ url: url }); return; }
    catch (err) { if (err && err.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(kind);
  } catch (err) {
    const box = document.createElement('textarea');
    box.value = url;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    toast(ok ? kind : 'linkFailed');
  }
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
        '<span class="t-body-s c-secondary truncate">' + t('Cover from Spotify · {track}', { track: esc(track.title) }) + '</span>' +
        '<button type="button" class="iconbtn" data-action="post-clear-track" data-tip="' + t('Remove cover') + '" aria-label="' + t('Remove cover') + '">' + icon('close', 15) + '</button>' +
      '</div>'
    : '';
}

function fillPostTrack(t) {
  document.getElementById('postTitle').value = t.title;
  document.getElementById('postArtist').value = t.artist;
  document.getElementById('postAlbum').value = t.album || '';
  setPostTrack({ id: t.id, image: t.thumb, title: t.title, artist: t.artist });
  document.getElementById('postNote').focus();
}

function pickPostTrack(index) {
  const t = postSearchResults[index];
  if (!t) return;
  document.getElementById('postSpotifySearch').value = '';
  document.getElementById('postSpotifyResults').innerHTML = '';
  postSearchResults = [];
  fillPostTrack(t);
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
      : '<p class="t-body-s c-tertiary">' + t('No songs found.') + '</p>';
  } catch (err) {
    if (seq !== postSearchSeq) return;
    console.error('Spotify search failed:', err);
    box.innerHTML = '<p class="t-body-s c-tertiary">' + t('Spotify search failed. You can still type the song below.') + '</p>';
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
          '<h2 class="t-title-s" id="postFormTitle">' + t('Share a track') + '</h2>' +
        '</div>' +
        '<form id="postForm" class="modal__body" novalidate>' +
          '<div class="auth__note auth__note--error" id="postError" hidden>' + icon('close', 16) +
            '<p class="t-body-s c-secondary" id="postErrorText"></p>' +
          '</div>' +
          (DATA.nowPlaying.status === 'track'
            ? '<button type="button" class="btn btn--secondary btn--sm" data-action="post-use-np" style="justify-content:flex-start;min-width:0">' +
                icon('spotify', 15) + '<span class="truncate">' + t('Use what\'s playing: {track}', { track: esc(DATA.nowPlaying.title) + ' · ' + esc(DATA.nowPlaying.artist) }) + '</span></button>'
            : '') +
          (spotify.auth.isConnected()
            ? '<div class="auth__field">' +
                '<label class="t-label-m c-secondary" for="postSpotifySearch">' + t('Find on Spotify') + '</label>' +
                '<span class="field">' + icon('search', 17) +
                  '<input id="postSpotifySearch" type="search" placeholder="' + t('Search a song to add its cover') + '" autocomplete="off" maxlength="100"></span>' +
                '<div class="post-search" id="postSpotifyResults"></div>' +
              '</div>'
            : '<p class="t-body-s c-tertiary">' + t('Tip: {button} to search songs and add their cover.', { button: '<button type="button" class="btn btn--ghost btn--sm" data-action="spotify-connect" style="display:inline-flex;padding:0 4px">' + t('connect Spotify') + '</button>' }) + '</p>') +
          '<div id="postPicked"></div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="postTitle">' + t('Track title') + '</label>' +
            '<span class="field">' + icon('disc', 17) +
              '<input id="postTitle" type="text" placeholder="' + t('Song name') + '" maxlength="200" required></span>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="postArtist">' + t('Artist') + '</label>' +
            '<span class="field">' + icon('user', 17) +
              '<input id="postArtist" type="text" placeholder="' + t('Artist name') + '" maxlength="200" required></span>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="postAlbum">' + t('Album') + '</label>' +
            '<span class="field">' + icon('disc', 17) +
              '<input id="postAlbum" type="text" placeholder="' + t('Optional') + '" maxlength="200"></span>' +
          '</div>' +
          '<div class="auth__field">' +
            '<label class="t-label-m c-secondary" for="postNote">' + t('Note') + '</label>' +
            '<span class="field field--area">' + icon('comment', 17) +
              '<textarea id="postNote" placeholder="' + t('What do you think? (optional)') + '" maxlength="500" rows="3"></textarea></span>' +
          '</div>' +
        '</form>' +
        '<div class="modal__foot">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-close>' + t('Cancel') + '</button>' +
          '<button type="submit" class="btn btn--primary btn--sm" form="postForm" id="postSubmit">' + t('Share') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.getElementById(spotify.auth.isConnected() ? 'postSpotifySearch' : 'postTitle').focus();
}

/* ---- reactions & comments ------------------------------------------------ */
/* The single-post page holds its own copy, which may not be in the feed. */
function findPost(postId) {
  const pv = UI.postView;
  if (app.view === 'post' && pv && pv.post && pv.post.id === postId) return pv.post;
  return DATA.feed.filter(function (p) { return p.id === postId; })[0] || (pv && pv.post && pv.post.id === postId ? pv.post : undefined);
}

function postEl(postId) {
  return document.querySelector('[data-post="' + CSS.escape(postId) + '"]');
}

/* Re-renders one card, carrying over what was typed in its comment and reply
   boxes (keyed by parent id, 'main' for the top-level box) and the focus. */
function rerenderPost(postId) {
  const el = postEl(postId);
  const post = findPost(postId);
  if (!el || !post) return;
  const drafts = {};
  let focused = null;
  el.querySelectorAll('[data-comment-form]').forEach(function (f) {
    const input = f.querySelector('input');
    const key = f.dataset.parentId || 'main';
    drafts[key] = input.value;
    if (document.activeElement === input) focused = key;
  });
  el.outerHTML = postCard(post);
  postEl(postId).querySelectorAll('[data-comment-form]').forEach(function (f) {
    const input = f.querySelector('input');
    const key = f.dataset.parentId || 'main';
    if (key in drafts) input.value = drafts[key];
    if (key === focused) input.focus();
  });
}

function focusReplyInput(postId) {
  const input = postEl(postId) && postEl(postId).querySelector('[data-parent-id] input');
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function openReply(postId, commentId) {
  const post = findPost(postId);
  const c = post && post.comments.filter(function (x) { return x.id === commentId; })[0];
  if (!c) return;
  const threadId = c.parentId || c.id;
  UI.replyTo[postId] = {
    threadId: threadId,
    name: c.user,
    // Replies stay one level deep, so answering a reply names who it's for.
    prefix: c.parentId && c.username ? '@' + c.username + ' ' : ''
  };
  UI.openReplies[threadId] = true;
  rerenderPost(postId);
  focusReplyInput(postId);
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
  if (was) sounds.tap(); else sounds.pop();
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
    const input = postEl(postId).querySelector('[data-comment-form]:not([data-parent-id]) input');
    if (input) input.focus();
  }
}

async function handleCommentSubmit(form) {
  const postId = form.dataset.commentForm;
  const parentId = form.dataset.parentId || null;
  const post = findPost(postId);
  const input = form.querySelector('input');
  const buttons = form.querySelectorAll('button');
  const content = input.value.trim();
  const prefix = parentId && UI.replyTo[postId] ? UI.replyTo[postId].prefix.trim() : '';
  if (!post || !content || content === prefix) { input.focus(); return; }

  input.disabled = true;
  buttons.forEach(function (b) { b.disabled = true; });
  try {
    const row = await db.comments.add(postId, app.session.user.id, content, parentId);
    row.author = { name: DATA.me.name, username: DATA.me.username.replace(/^@/, '') };
    post.comments.push(transformComment(row, app.session.user.id));
    input.value = '';
    if (parentId) {
      UI.replyTo[postId] = null;
      UI.openReplies[parentId] = true;
    }
    rerenderPost(postId);
    if (!parentId) {
      const next = postEl(postId).querySelector('[data-comment-form]:not([data-parent-id]) input');
      if (next) next.focus();
    }
  } catch (err) {
    console.error('Error adding comment:', err);
    input.disabled = false;
    buttons.forEach(function (b) { b.disabled = false; });
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
  if (navLayout().pins.length) repaintSidebar();
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
    s.results = rows.filter(function (r) { return !isBlocked(r.id); }).map(function (r) { return toPerson(r, null); });
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
    reloadListening();
    if (['friendProfile', 'compare', 'notifications'].indexOf(app.view) > -1) setView(app.view);
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
          '<h2 class="t-title-s" id="removeFriendTitle">' + t('Remove {name}?', { name: esc(friend.name) }) + '</h2>' +
        '</div>' +
        '<div class="modal__body">' +
          '<p class="t-body-m c-secondary">' + t('Their posts stop showing in your Friends feed, and yours in theirs. You can add each other again later.') + '</p>' +
        '</div>' +
        '<div class="modal__foot">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-close>' + t('Cancel') + '</button>' +
          '<button type="button" class="btn btn--primary btn--sm" id="removeFriendConfirm">' + t('Remove friend') + '</button>' +
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

/* ---- block & report --------------------------------------------------------------- */
const REPORT_REASONS = [
  ['spam', t('Spam'), t('Ads, scams or the same thing over and over')],
  ['harassment', t('Harassment or bullying'), t('Picking on you or someone else')],
  ['hate', t('Hate speech'), t('Attacking someone for who they are')],
  ['sexual_violent', t('Sexual or violent content'), t('In a post, comment, photo or bio')],
  ['impersonation', t('Pretending to be someone else'), t('Using another person’s name or photo')],
  ['other', t('Something else'), t('Say what happened below')]
];

let safety = null;   // { person: { id, name, username }, postId, step: 'menu'|'report'|'reported'|'block' }

function safetyTrigger(person, postId, label) {
  return '<button class="iconbtn" data-safety="' + esc(person.id) + '" data-safety-name="' + esc(person.name) + '" ' +
    'data-safety-handle="' + esc(person.username) + '"' + (postId ? ' data-safety-post="' + esc(postId) + '"' : '') +
    ' data-tip="' + t('More') + '" aria-label="' + esc(label) + '">' + icon('dots', 16) + '</button>';
}

function openSafety(person, postId) {
  safety = { person: person, postId: postId || null, step: 'menu' };
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML = '<div class="scrim" data-scrim><div class="modal modal--tall" role="dialog" aria-modal="true" aria-labelledby="safetyTitle"></div></div>';
  paintSafety();
}

function choiceRow(attrs, glyph, title, sub, danger) {
  return '<button type="button" class="' + cx('sheet-option', danger && 'sheet-option--danger') + '" ' + attrs + '>' + icon(glyph, 18) +
    '<span class="sheet-option__meta"><span class="t-body-m-med">' + esc(title) + '</span><span class="t-body-s c-tertiary">' + esc(sub) + '</span></span>' +
    icon('chevronRight', 16) + '</button>';
}

function paintSafety() {
  const modal = document.querySelector('#overlay .modal');
  if (!modal || !safety) return;
  const p = safety.person, handle = '@' + p.username, first = p.name.split(/\s+/)[0];
  const blocked = isBlocked(p.id);
  const head = function (well, glyph, title) {
    return '<div class="modal__head"><span class="toast__well toast__well--' + well + '">' + icon(glyph, 15) + '</span>' +
      '<h2 class="t-title-s truncate" id="safetyTitle">' + esc(title) + '</h2></div>';
  };
  const blockRow = blocked
    ? choiceRow('data-safety-unblock="' + esc(p.id) + '"', 'ban', t('Unblock {name}', { name: handle }), t('They’ll be able to find and add you again.'))
    : choiceRow('data-safety-step="block"', 'ban', t('Block {name}', { name: handle }), t('They can’t add you, react to or comment on your posts.'), true);
  let html;
  if (safety.step === 'menu') {
    html = head('info', 'user', p.name) +
      '<div class="modal__body sheet-options">' +
        choiceRow('data-safety-step="report"', 'flag', safety.postId ? t('Report this post') : t('Report {name}', { name: handle }), t('{name} won’t know who reported them.', { name: first })) +
        blockRow +
      '</div>' +
      '<div class="modal__foot"><button type="button" class="btn btn--ghost btn--sm" data-close>' + t('Cancel') + '</button></div>';
  } else if (safety.step === 'report') {
    html = head('error', 'flag', safety.postId ? t('Report this post') : t('Report {name}', { name: handle })) +
      '<form class="modal__body" id="reportForm" novalidate>' +
        '<div class="auth__note auth__note--error" id="reportError" hidden>' + icon('close', 16) + '<p class="t-body-s c-secondary" id="reportErrorText"></p></div>' +
        '<fieldset class="reasons"><legend class="t-label-m c-secondary">' + t('What’s wrong?') + '</legend>' +
          REPORT_REASONS.map(function (r) {
            return '<label class="reason"><input type="radio" name="reason" value="' + r[0] + '">' +
              '<span class="reason__meta"><span class="t-body-m-med">' + esc(r[1]) + '</span><span class="t-body-s c-tertiary">' + esc(r[2]) + '</span></span></label>';
          }).join('') +
        '</fieldset>' +
        '<div class="auth__field">' +
          '<label class="t-label-m c-secondary" for="reportDetails">' + t('Anything we should know?') + '</label>' +
          '<span class="field field--area"><textarea id="reportDetails" placeholder="' + t('Optional, up to 500 characters') + '" maxlength="500" rows="2"></textarea></span>' +
        '</div>' +
      '</form>' +
      '<div class="modal__foot">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-safety-step="menu">' + t('Back') + '</button>' +
        '<button type="submit" class="btn btn--primary btn--sm" form="reportForm" id="reportSubmit">' + t('Send report') + '</button>' +
      '</div>';
  } else if (safety.step === 'reported') {
    html = head('success', 'check', t('Report sent')) +
      '<div class="modal__body sheet-options">' +
        '<p class="t-body-m c-secondary">' + t('Thanks for telling us. {name} isn’t told who sent it.', { name: esc(first) }) + '</p>' +
        (blocked ? '' : blockRow) +
      '</div>' +
      '<div class="modal__foot"><button type="button" class="btn btn--primary btn--sm" data-close>' + t('Done') + '</button></div>';
  } else {
    html = head('error', 'ban', t('Block {name}?', { name: handle })) +
      '<div class="modal__body">' +
        '<ul class="consequences t-body-s c-secondary">' +
          '<li>' + t('You stop being friends, and stop seeing each other’s listening and music DNA.') + '</li>' +
          '<li>' + t('{name} can’t send you friend requests, or react to and comment on your posts.', { name: esc(first) }) + '</li>' +
          '<li>' + t('Their posts and comments are hidden from you.') + '</li>' +
          '<li>' + t('They aren’t told. You can unblock them in Settings.') + '</li>' +
        '</ul>' +
      '</div>' +
      '<div class="modal__foot">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-safety-step="menu">' + t('Back') + '</button>' +
        '<button type="button" class="btn btn--primary btn--sm" data-safety-block id="blockConfirm">' + t('Block {name}', { name: esc(first) }) + '</button>' +
      '</div>';
  }
  modal.innerHTML = html;
  const focus = modal.querySelector('.sheet-option, input[name="reason"], #blockConfirm, .modal__foot .btn--primary');
  if (focus) focus.focus();
}

async function handleReportSubmit(form) {
  const picked = form.querySelector('input[name="reason"]:checked');
  const err = document.getElementById('reportError');
  const say = function (msg) { document.getElementById('reportErrorText').textContent = msg; err.hidden = false; };
  if (!picked) { say(t('Pick the reason that fits best.')); return; }
  const details = form.querySelector('#reportDetails').value.trim().slice(0, 500);
  if (picked.value === 'other' && !details) { say(t('Say a few words about what happened.')); return; }
  const btn = document.getElementById('reportSubmit');
  btn.disabled = true; btn.textContent = t('Sending…');
  try {
    await db.reports.create(app.session.user.id, { reportedId: safety.person.id, postId: safety.postId, reason: picked.value, details: details });
    safety.step = 'reported';
    paintSafety();
  } catch (e) {
    console.error('Report failed:', e);
    btn.disabled = false; btn.textContent = t('Send report');
    say(t('Could not send the report. Check your connection and try again.'));
  }
}

/* After a block changes, everything that mixes in other people's content is reloaded. */
async function afterBlockChange() {
  try { await loadFriends(); } catch (e) { console.warn('Could not reload friends:', e); }
  refreshFriendsUI();
  reloadListening();
  setView(app.view);
  await loadFeed();
  if (['feed', 'home', 'post', 'friendProfile', 'compare'].indexOf(app.view) > -1) setView(app.view);
}

async function blockPerson(btn) {
  const p = safety.person;
  btn.disabled = true; btn.textContent = t('Blocking…');
  try {
    await db.blocks.add(app.session.user.id, p.id);
    DATA.blocked = [{ id: p.id, name: p.name, username: p.username, initials: initialsFrom(p.name), avatarUrl: null }]
      .concat(DATA.blocked.filter(function (b) { return b.id !== p.id; }));
    delete DATA.tastes[p.id];
    closeOverlay();
    toast('userBlocked');
    await afterBlockChange();
    loadBlocks();
  } catch (e) {
    console.error('Block failed:', e);
    btn.disabled = false; btn.textContent = t('Block {name}', { name: p.name.split(/\s+/)[0] });
    toast('blockFailed');
  }
}

async function unblockPerson(btn, id) {
  btn.disabled = true;
  try {
    await db.blocks.remove(app.session.user.id, id);
    DATA.blocked = DATA.blocked.filter(function (b) { return b.id !== id; });
    closeOverlay();
    toast('userUnblocked');
    await afterBlockChange();
  } catch (e) {
    console.error('Unblock failed:', e);
    btn.disabled = false;
    toast('blockFailed');
  }
}

function openDeletePost(postId) {
  const post = findPost(postId);
  if (!post) return;
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML =
    '<div class="scrim" data-scrim>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="deletePostTitle">' +
        '<div class="modal__head">' +
          '<span class="toast__well toast__well--error">' + icon('trash', 15) + '</span>' +
          '<h2 class="t-title-s" id="deletePostTitle">' + t('Delete this post?') + '</h2>' +
        '</div>' +
        '<div class="modal__body">' +
          '<p class="t-body-m c-secondary">' + t('Your post of {track} by {artist} will be removed, along with its reactions and comments. This cannot be undone.', { track: '<span class="c-primary">' + esc(post.track) + '</span>', artist: esc(post.artist) }) + '</p>' +
          '<div class="auth__note auth__note--error" id="deletePostError" hidden>' + icon('close', 16) +
            '<p class="t-body-s c-secondary" id="deletePostErrorText"></p>' +
          '</div>' +
        '</div>' +
        '<div class="modal__foot">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-close>' + t('Cancel') + '</button>' +
          '<button type="button" class="btn btn--primary btn--sm" id="deletePostConfirm">' + t('Delete post') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const confirm = document.getElementById('deletePostConfirm');
  confirm.addEventListener('click', function () { handleDeletePost(postId, confirm); });
  confirm.focus();
}

async function handleDeletePost(postId, btn) {
  btn.disabled = true; btn.textContent = t('Deleting…');
  try {
    await db.posts.remove(postId);
    closeOverlay();
    DATA.feed = DATA.feed.filter(function (p) { return p.id !== postId; });
    if (UI.postView && UI.postView.id === postId) UI.postView = { id: postId, status: 'notfound' };
    if (app.view === 'feed' || app.view === 'post') setView(app.view);
    toast('postDeleted');
    loadMyActivity();
  } catch (err) {
    document.getElementById('deletePostErrorText').textContent = err.message || t('Could not delete this post.');
    document.getElementById('deletePostError').hidden = false;
    btn.disabled = false; btn.textContent = t('Delete post');
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
    errText.textContent = t('Track title and artist are required.');
    errBox.hidden = false;
    return;
  }

  // Same shapes the database constraints accept; anything else is dropped, not rejected.
  const image = postTrack && COVER_URL.test(postTrack.image || '') ? postTrack.image : null;
  const trackId = postTrack && TRACK_ID.test(postTrack.id || '') ? postTrack.id : null;

  const btn = document.getElementById('postSubmit');
  btn.disabled = true; btn.textContent = t('Sharing…');
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
    await Promise.all([loadFeed(), loadMyActivity()]);
    if (app.view === 'feed') setView('feed');
    else location.hash = '#/feed';
  } catch (err) {
    errText.textContent = err.message || t('Could not share this track.');
    errBox.hidden = false;
    btn.disabled = false; btn.textContent = t('Share');
  }
}

const CMD_ACTIONS = [
  { label: t('Toggle theme'), hint: t('Customization'), run: function () { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }, icon: 'droplet' },
  { label: t('Toggle compact sidebar'), hint: t('Navigation'), run: function () { setRail(!railPref()); }, icon: 'bars' }
];

const RELATION_HINT = { friends: 'Friend', incoming: 'Wants to be friends', outgoing: 'Requested' };

function cmdkPerson(p) {
  const hint = RELATION_HINT[relationshipWith(p.id).state];
  return {
    group: hint === 'Friend' ? t('Friends') : t('People'),
    label: p.name, sub: '@' + p.username,
    lead: avatarEl(p.initials, '24', null, p.avatarUrl),
    hint: t(hint || 'Profile'),
    run: function () { location.hash = '#/u/' + encodeURIComponent(p.username); }
  };
}

function cmdkSong(song) {
  return {
    group: t('Songs on Spotify'), label: song.title, sub: song.artist,
    lead: art(artSeedFor(song.id), 'art--sm', song.thumb),
    hint: t('Share'),
    run: function () { openPostForm(); fillPostTrack(song); }
  };
}

function openCmdk() {
  if (!app.session) return;
  const o = document.getElementById('overlay');
  o.hidden = false;
  o.innerHTML =
    '<div class="scrim" data-scrim>' +
      '<div class="modal cmdk" role="dialog" aria-modal="true" aria-label="' + t('Search') + '">' +
        '<div class="cmdk__input">' + icon('search', 19) +
          '<input id="cmdkInput" type="text" placeholder="' + t('Search people, songs and pages…') + '" autocomplete="off" spellcheck="false" ' +
            'role="combobox" aria-expanded="true" aria-controls="cmdkList" aria-autocomplete="list">' +
          '<span class="field__kbd">ESC</span>' +
        '</div>' +
        '<div class="cmdk__list" id="cmdkList" role="listbox" aria-label="' + t('Results') + '"></div>' +
      '</div>' +
    '</div>';

  const input = document.getElementById('cmdkInput');
  const list = document.getElementById('cmdkList');
  const me = app.session.user.id;
  const remote = { people: [], songs: [], loading: false };
  let rows = [];
  let active = 0;
  let timer = null;
  let seq = 0;

  function query() { return input.value.trim(); }

  function collect() {
    const q = query().toLowerCase();
    const handle = q.replace(/^@/, '');
    const pages = NAV.filter(function (n) { return n.id && (!q || n.label.toLowerCase().indexOf(q) > -1); })
      .map(function (n) {
        return { group: t('Pages'), label: n.label, lead: icon(n.icon, 16), hint: t('Go to'), run: function () { location.hash = '#/' + n.id; } };
      });
    const acts = CMD_ACTIONS.filter(function (a) { return !q || a.label.toLowerCase().indexOf(q) > -1; })
      .map(function (a) { return { group: t('Actions'), label: a.label, lead: icon(a.icon, 16), hint: a.hint, run: a.run }; });
    if (!q) return pages.concat(acts);

    const friends = DATA.friends.filter(function (f) {
      return f.name.toLowerCase().indexOf(q) > -1 || f.username.toLowerCase().indexOf(handle) > -1;
    }).slice(0, 5);
    const friendIds = DATA.friends.map(function (f) { return f.id; });
    // Results for the previous keystroke stay up until the new ones land, so the list doesn't jump.
    const people = remote.people.filter(function (p) { return friendIds.indexOf(p.id) < 0 && p.id !== me; });
    const songs = remote.songs;
    return pages.slice(0, 3).concat(friends.map(cmdkPerson), people.map(cmdkPerson), songs.map(cmdkSong), acts);
  }

  function paint() {
    rows = collect();
    active = Math.min(active, Math.max(rows.length - 1, 0));
    const searching = remote.loading && query().length >= 2;
    if (!rows.length) {
      list.innerHTML = searching
        ? '<p class="cmdk__status t-body-s c-tertiary">' + t('Searching people and songs…') + '</p>'
        : '<div class="empty"><span class="empty__well">' + icon('search', 20) + '</span>' +
            '<span class="t-body-m-med">' + t('Nothing for “{query}”', { query: esc(query()) }) + '</span>' +
            '<p class="t-body-s c-tertiary">' + t('Try a name, an @username, a song or a page.') + '</p></div>';
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let group = null;
    list.innerHTML = rows.map(function (r, i) {
      const head = r.group !== group ? '<p class="cmdk__group t-overline c-tertiary" role="presentation">' + esc(r.group) + '</p>' : '';
      group = r.group;
      return head + '<button type="button" class="' + cx('menu__item cmdk__item', r.sub && 'cmdk__item--tall') + '" id="cmdk-opt-' + i + '" ' +
        'role="option" aria-selected="' + (i === active) + '" data-cmd="' + i + '">' + r.lead +
        '<span class="cmdk__text"><span class="truncate">' + esc(r.label) + '</span>' +
          (r.sub ? '<span class="t-caption c-tertiary truncate">' + esc(r.sub) + '</span>' : '') + '</span>' +
        '<kbd>' + esc(r.hint) + '</kbd></button>';
    }).join('') + (searching ? '<p class="cmdk__status t-caption c-tertiary">' + t('Searching people and songs…') + '</p>' : '');
    input.setAttribute('aria-activedescendant', 'cmdk-opt-' + active);
  }

  function setActive(i) {
    if (!rows.length) return;
    active = (i + rows.length) % rows.length;
    list.querySelectorAll('[data-cmd]').forEach(function (b) { b.setAttribute('aria-selected', String(+b.dataset.cmd === active)); });
    input.setAttribute('aria-activedescendant', 'cmdk-opt-' + active);
    const el = document.getElementById('cmdk-opt-' + active);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function pick(r) {
    if (!r) return;
    closeOverlay();
    r.run();
  }

  function searchRemote() {
    const q = query();
    const mySeq = ++seq;
    clearTimeout(timer);
    remote.loading = q.replace(/^@/, '').length >= 2;
    if (!remote.loading) { remote.people = []; remote.songs = []; }
    paint();
    if (!remote.loading) return;
    timer = setTimeout(function () {
      const canSongs = spotify.auth.isConnected() && q.indexOf('@') !== 0;
      Promise.all([
        db.profiles.search(q.replace(/^@/, ''), me).then(function (r) {
          return r.filter(function (p) { return !isBlocked(p.id); }).map(function (p) { return toPerson(p, null); });
        }).catch(function () { return []; }),
        canSongs ? spotify.searchTracks(q, 4).catch(function () { return []; }) : Promise.resolve([])
      ]).then(function (res) {
        if (mySeq !== seq || !list.isConnected) return;
        remote.people = res[0]; remote.songs = res[1]; remote.loading = false;
        paint();
      });
    }, 220);
  }

  list.addEventListener('click', function (e) {
    const b = e.target.closest('[data-cmd]');
    if (b) pick(rows[+b.dataset.cmd]);
  });
  list.addEventListener('mousemove', function (e) {
    const b = e.target.closest('[data-cmd]');
    if (b && +b.dataset.cmd !== active) setActive(+b.dataset.cmd);
  });
  input.addEventListener('input', function () { active = 0; searchRemote(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(rows[active]); }
  });
  paint();
  input.focus();
}

/* ---- event delegation ---------------------------------------------------- */
document.addEventListener('click', function (e) {
  const t = e.target;

  // Switches and the sound picker play their own sounds; in-app links play one on navigation.
  const tappable = t.closest('button, a, [role="radio"], .tab, .chip');
  if (tappable && !tappable.closest('[data-toggle], [data-sound-pick], [data-sound-test], [role="switch"]') &&
      !(tappable.tagName === 'A' && (tappable.getAttribute('href') || '').indexOf('#/') === 0)) sounds.tap();

  const closeBtn = t.closest('[data-close]');
  const scrim = t.closest('[data-scrim]');
  if (closeBtn || (scrim && t === scrim)) { closeOverlay(); return; }

  const navBtn = t.closest('[data-nav]');
  if (navBtn) { location.hash = '#/' + navBtn.dataset.nav; return; }

  const logoutBtn = t.closest('[data-action="logout"]');
  if (logoutBtn) {
    // Clear the status while still signed in; afterwards RLS would refuse it.
    clearMyListening().finally(function () { db.auth.signOut(); });
    return;
  }

  if (t.closest('[data-action="pin-edit"]')) { openPinForm(); return; }
  const pinClear = t.closest('[data-action="pin-clear"]');
  if (pinClear) { clearPin(pinClear); return; }
  if (t.closest('[data-action="pin-use-np"]')) {
    const np = DATA.nowPlaying;
    if (np.status === 'track') setPinPick({ trackId: np.id, title: np.title, artist: np.artist, image: np.thumb || np.image });
    return;
  }
  const pinPickBtn = t.closest('[data-pin-pick]');
  if (pinPickBtn) {
    const r = pinResults[+pinPickBtn.dataset.pinPick];
    if (r) setPinPick({ trackId: r.id, title: r.title, artist: r.artist, image: r.thumb });
    return;
  }
  if (t.closest('[data-action="pin-unpick"]')) {
    setPinPick(null);
    const s = document.getElementById('pinSearch');
    if (s) s.focus();
    return;
  }
  const recapBtn = t.closest('[data-action="recap-share"], [data-action="recap-save"]');
  if (recapBtn) { recapImage(recapBtn, recapBtn.dataset.action === 'recap-share'); return; }
  // Arriving from a reply notification: show that thread already open.
  const threadLink = t.closest('[data-open-thread]');
  if (threadLink) UI.openReplies[threadLink.dataset.openThread] = true;

  const shareBtn = t.closest('[data-share-link]');
  if (shareBtn) { shareLink(shareBtn.dataset.shareLink); return; }
  const editProfile = t.closest('[data-action="profile-edit"]');
  if (editProfile) { openEditProfile(editProfile.dataset.focus); return; }
  if (t.closest('[data-action="feed-retry"]')) { retryFeed(); return; }
  if (t.closest('[data-forgot-link]')) {
    const email = document.getElementById('authEmail');
    forgotState.draft = email ? email.value.trim() : '';
    forgotState.sentTo = null;
    return;
  }
  const googleBtn = t.closest('[data-action="google-signin"]');
  if (googleBtn) { handleGoogle(googleBtn); return; }
  if (t.closest('[data-action="forgot-resend"]')) { resendResetLink(); return; }
  if (t.closest('[data-action="reset-skip"]')) { location.hash = resetReturn; return; }
  if (t.closest('[data-action="notif-retry"]')) {
    DATA.notifications.status = 'idle';
    setView('notifications');
    return;
  }

  if (t.closest('[data-action="new-post"]')) { openPostForm(); return; }
  if (t.closest('[data-action="share-now-playing"]')) { openPostForm(); fillPostFromNowPlaying(); return; }
  if (t.closest('[data-action="post-use-np"]')) { fillPostFromNowPlaying(); return; }

  if (t.closest('[data-action="spotify-connect"]')) { connectSpotify(); return; }
  if (t.closest('[data-action="spotify-disconnect"]')) {
    spotify.auth.disconnect();
    stopSpotifyPolling();
    clearMyListening();
    resetSpotifyLibrary();
    refreshSettingsView();
    toast('spotifyDisconnected');
    return;
  }

  const deleteBtn = t.closest('[data-delete-post]');
  if (deleteBtn) { openDeletePost(deleteBtn.dataset.deletePost); return; }

  const safetyBtn = t.closest('[data-safety]');
  if (safetyBtn) {
    openSafety({ id: safetyBtn.dataset.safety, name: safetyBtn.dataset.safetyName, username: safetyBtn.dataset.safetyHandle }, safetyBtn.dataset.safetyPost);
    return;
  }
  const safetyStep = t.closest('[data-safety-step]');
  if (safetyStep && safety) { safety.step = safetyStep.dataset.safetyStep; paintSafety(); return; }
  const blockBtn = t.closest('[data-safety-block]');
  if (blockBtn && safety) { blockPerson(blockBtn); return; }
  const unblockBtn = t.closest('[data-safety-unblock]');
  if (unblockBtn) { unblockPerson(unblockBtn, unblockBtn.dataset.safetyUnblock); return; }

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
  if (t.closest('#railToggle')) { setRail(!railPref()); return; }

  const themeBtn = t.closest('[data-theme-pick]');
  if (themeBtn) { setTheme(themeBtn.dataset.themePick); return; }
  const langBtn = t.closest('[data-lang-pick]');
  if (langBtn) { setLang(langBtn.dataset.langPick); return; }

  const accentBtn = t.closest('[data-accent-pick]');
  if (accentBtn) { setLook('accent', accentBtn.dataset.accentPick); return; }
  const densityBtn = t.closest('[data-density-pick]');
  if (densityBtn) { setLook('density', densityBtn.dataset.densityPick); return; }
  const motionBtn = t.closest('[data-motion-pick]');
  if (motionBtn) { setLook('motion', motionBtn.dataset.motionPick); return; }
  const soundTest = t.closest('[data-sound-test]');
  if (soundTest) { sounds.preview(soundTest.dataset.soundTest); return; }
  const soundPick = t.closest('[data-sound-pick]');
  if (soundPick) { setSoundPref('variant', soundPick.dataset.soundPick); sounds.preview(soundPick.dataset.soundPick); return; }
  if (t.closest('[data-action="look-reset"]')) { resetLook(); toast('lookReset'); return; }
  const navMove = t.closest('[data-nav-move]');
  if (navMove) {
    const row = navMove.closest('[data-dnd-group]');
    if (row) moveNavItem(row.dataset.dndGroup, navMove.dataset.key, navMove.dataset.navMove);
    return;
  }
  const navHide = t.closest('[data-nav-hide]');
  if (navHide) { toggleNavHidden(navHide.dataset.navHide); return; }
  const navPin = t.closest('[data-navpin]');
  if (navPin) { toggleNavPin(navPin.dataset.navpin); return; }

  const toggle = t.closest('[data-toggle]');
  if (toggle && toggle.getAttribute('aria-disabled') !== 'true') {
    const on = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(on));
    if (toggle.dataset.toggle === 'rail') setRail(on);
    if (toggle.dataset.toggle === 'ambient') setAmbient(on);
    if (toggle.dataset.toggle === 'share-listening') setShareListening(on);
    if (toggle.dataset.toggle === 'share-taste') setShareTaste(on);
    if (toggle.dataset.toggle === 'sounds') {
      if (!on) sounds.off();
      setSoundPref('sounds', on ? 'on' : 'off');
      if (on) sounds.on();
    } else {
      (on ? sounds.on : sounds.off)();
    }
    return;
  }

  const compatBtn = t.closest('[data-compat-open]');
  if (compatBtn) {
    UI.compatOpen = UI.compatOpen === compatBtn.dataset.compatOpen ? null : compatBtn.dataset.compatOpen;
    paintLibraryPanels();
    return;
  }
  const playlistBtn = t.closest('[data-playlist-open]');
  if (playlistBtn) { openPlaylist(playlistBtn.dataset.playlistOpen); return; }
  if (t.closest('[data-playlist-close]')) { UI.playlistOpen = null; paintLibraryPanels(); return; }
  if (t.closest('[data-action="save-top-playlist"]')) { saveTopTracksPlaylist(); return; }
  const blendBtn = t.closest('[data-action="blend-save"]');
  if (blendBtn) { saveBlend(blendBtn.dataset.user); return; }
  const imageBtn = t.closest('[data-action="save-dna-image"]');
  if (imageBtn) { saveDnaImage(imageBtn); return; }

  const passBtn = t.closest('[data-pass-toggle]');
  if (passBtn) {
    const input = passBtn.parentElement.querySelector('input');
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    passBtn.innerHTML = icon(shown ? 'eye' : 'eyeOff', 17);
    passBtn.setAttribute('aria-label', shown ? window.t('Show password') : window.t('Hide password'));
    return;
  }

  const react = t.closest('[data-react]');
  if (react) {
    const card = react.closest('[data-post]');
    if (card) toggleReaction(card.dataset.post, react.dataset.react);
    return;
  }

  const replyBtn = t.closest('[data-reply-to]');
  if (replyBtn) {
    const card = replyBtn.closest('[data-post]');
    if (card) openReply(card.dataset.post, replyBtn.dataset.replyTo);
    return;
  }

  const cancelReply = t.closest('[data-cancel-reply]');
  if (cancelReply) {
    const card = cancelReply.closest('[data-post]');
    if (card) { UI.replyTo[card.dataset.post] = null; rerenderPost(card.dataset.post); }
    return;
  }

  const repliesBtn = t.closest('[data-toggle-replies]');
  if (repliesBtn) {
    const card = repliesBtn.closest('[data-post]');
    const threadId = repliesBtn.dataset.toggleReplies;
    const opening = !UI.openReplies[threadId];
    UI.openReplies[threadId] = opening;
    // Hiding a thread also closes a reply box that was open inside it.
    if (!opening && card && UI.replyTo[card.dataset.post] && UI.replyTo[card.dataset.post].threadId === threadId) {
      UI.replyTo[card.dataset.post] = null;
    }
    if (card) rerenderPost(card.dataset.post);
    return;
  }

  const commentBtn = t.closest('[data-comment]');
  if (commentBtn) {
    const card = commentBtn.closest('[data-post]');
    if (card) toggleComments(card.dataset.post);
    return;
  }

  const tab = t.closest('[data-tab]');
  if (tab) {
    tab.parentElement.querySelectorAll('[data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b === tab));
    });
    const group = tab.parentElement.dataset.tabs;
    if (group === 'feed' && UI.feedScope !== tab.dataset.tab) {
      UI.feedScope = tab.dataset.tab;
      DATA.feed = [];
      UI.feedStatus = 'loading';
      setView('feed');
      loadFeed().then(function () { if (app.view === 'feed') setView('feed'); });
    }
    if (group === 'activity-range' || group === 'music-range' || group === 'dna-range') {
      const range = RANGE_BY_LABEL[tab.dataset.tab];
      if (group === 'activity-range') UI.activityRange = range;
      else if (group === 'music-range') UI.musicRange = range;
      else UI.dnaRange = range;
      paintLibraryPanels();
      ensureSpotifyLibrary(app.view);
    }
    return;
  }
});

/* Sidebar editor: drag rows within their own list. */
let navDrag = null;   // { key, group }

function clearDropMarks() {
  document.querySelectorAll('.navedit__item.drop-before, .navedit__item.drop-after, .navedit__item.is-dragging')
    .forEach(function (el) { el.classList.remove('drop-before', 'drop-after', 'is-dragging'); });
}

document.addEventListener('dragstart', function (e) {
  const item = e.target.closest && e.target.closest('[data-dnd-key]');
  if (!item) return;
  navDrag = { key: item.dataset.dndKey, group: item.dataset.dndGroup };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', navDrag.key);
  requestAnimationFrame(function () { item.classList.add('is-dragging'); });
});

document.addEventListener('dragover', function (e) {
  const item = navDrag && e.target.closest && e.target.closest('[data-dnd-key]');
  if (!item || item.dataset.dndGroup !== navDrag.group) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const r = item.getBoundingClientRect();
  const after = e.clientY > r.top + r.height / 2;
  document.querySelectorAll('.navedit__item.drop-before, .navedit__item.drop-after').forEach(function (el) {
    if (el !== item) el.classList.remove('drop-before', 'drop-after');
  });
  if (item.dataset.dndKey === navDrag.key) return;
  item.classList.toggle('drop-after', after);
  item.classList.toggle('drop-before', !after);
});

document.addEventListener('drop', function (e) {
  const item = navDrag && e.target.closest && e.target.closest('[data-dnd-key]');
  if (!item || item.dataset.dndGroup !== navDrag.group) return;
  e.preventDefault();
  const after = item.classList.contains('drop-after');
  const drag = navDrag;
  navDrag = null;
  clearDropMarks();
  if (item.dataset.dndKey !== drag.key) moveNavItem(drag.group, drag.key, item.dataset.dndKey, after);
});

document.addEventListener('dragend', function () { navDrag = null; clearDropMarks(); });

document.addEventListener('input', function (e) {
  if (e.target.dataset && e.target.dataset.lookRange) {
    setLook(e.target.dataset.lookRange, parseInt(e.target.value, 10));
    return;
  }
  if (e.target.id === 'friendSearch') {
    UI.friendSearch.q = e.target.value;
    clearTimeout(friendSearchTimer);
    friendSearchTimer = setTimeout(runFriendSearch, 250);
  }
  if (e.target.id === 'postSpotifySearch') {
    clearTimeout(postSearchTimer);
    postSearchTimer = setTimeout(function () { runPostSearch(e.target.value); }, 300);
  }
  if (e.target.id === 'pinSearch') {
    clearTimeout(pinSearchTimer);
    pinSearchTimer = setTimeout(function () { runPinSearch(e.target.value); }, 300);
  }
  if (e.target.id === 'editUsername') checkUsernameInput(e.target.value);
  if (e.target.id === 'welcomeUsername') checkUsernameInput(e.target.value, true);
  if (e.target.id === 'editBio') document.getElementById('editBioCount').textContent = e.target.value.length + ' / ' + BIO_MAX;
  // Hand-editing the song means the picked Spotify cover may no longer match.
  if ((e.target.id === 'postTitle' || e.target.id === 'postArtist') && postTrack) setPostTrack(null);
});

document.addEventListener('change', function (e) {
  if (e.target.name === 'reason' && e.target.closest('#reportForm')) document.getElementById('reportError').hidden = true;
  if (e.target.id === 'authConsent' || e.target.id === 'welcomeConsent') {
    delete e.target.closest('.consent').dataset.invalid;
    const text = document.getElementById('authErrorText');
    if (e.target.checked && (text.textContent === t('Accept the privacy policy to create an account.') || text.textContent === t('Accept the privacy policy to continue.'))) document.getElementById('authError').hidden = true;
  }
  if (e.target.id === 'avatarFile') {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleAvatarFile(file);
  }
});

/* Re-fetch when entering these views so new requests / posts appear without a
   reload; only re-render when something actually changed. */
function refreshOnEnter(name) {
  if (!app.session) return;
  if (name === 'friends') {
    loadFriends().then(function () { if (app.view === 'friends') refreshFriendsUI(); })
      .catch(function (e) { console.error('Error loading friends:', e); });
  }
  if (name === 'friends' || name === 'home') reloadListening();
  if (name === 'feed') {
    const before = feedSignature();
    loadFriends().then(loadFeed).then(function () {
      if (app.view === 'feed' && feedSignature() !== before) setView('feed');
    }).catch(function (e) { console.error('Error refreshing feed:', e); });
  }
  if (name === 'home' || name === 'profile') {
    const before = homeSignature();
    Promise.all([loadMyActivity(), loadFriends().then(loadFeed)]).then(function () {
      if (app.view === name && homeSignature() !== before) setView(name);
    }).catch(function (e) { console.error('Error refreshing ' + name + ':', e); });
  }
}

function homeSignature() {
  return JSON.stringify([DATA.me.stats, DATA.friends.length,
    DATA.me.recentPosts.map(function (p) { return p.id + (p.image || ''); })]) + feedSignature();
}

document.addEventListener('submit', function (e) {
  if (e.target.id === 'authLoginForm') { e.preventDefault(); handleLogin(e.target); }
  if (e.target.id === 'authSignupForm') { e.preventDefault(); handleSignup(e.target); }
  if (e.target.id === 'authForgotForm') { e.preventDefault(); handleForgot(e.target); }
  if (e.target.id === 'authResetForm') { e.preventDefault(); handleReset(e.target); }
  if (e.target.id === 'authWelcomeForm') { e.preventDefault(); handleWelcome(e.target); }
  if (e.target.id === 'postForm') { e.preventDefault(); handlePostSubmit(e.target); }
  if (e.target.id === 'pinForm') { e.preventDefault(); handlePinSubmit(e.target); }
  if (e.target.id === 'profileForm') { e.preventDefault(); handleProfileSubmit(e.target); }
  if (e.target.id === 'reportForm') { e.preventDefault(); handleReportSubmit(e.target); }
  if (e.target.dataset.commentForm) { e.preventDefault(); handleCommentSubmit(e.target); }
});

document.addEventListener('keydown', function (e) {
  // Enter in the Spotify search picks the top result instead of submitting the post.
  if (e.key === 'Enter' && e.target.id === 'postSpotifySearch') {
    e.preventDefault();
    if (postSearchResults.length) pickPostTrack(0);
    return;
  }
  if (e.key === 'Enter' && e.target.id === 'pinSearch') {
    e.preventDefault();
    const r = pinResults[0];
    if (r) setPinPick({ trackId: r.id, title: r.title, artist: r.artist, image: r.thumb });
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); return; }
  if (e.key === 'Escape' && !document.getElementById('overlay').hidden) { closeOverlay(); return; }
  if (e.key === 'Escape' && e.target.closest && e.target.closest('[data-parent-id]')) {
    const card = e.target.closest('[data-post]');
    if (card) { UI.replyTo[card.dataset.post] = null; rerenderPost(card.dataset.post); }
    return;
  }
  if (e.key === '/' && document.activeElement === document.body) { e.preventDefault(); openCmdk(); }
});

// Back from Google's page restores this document with the button still disabled.
window.addEventListener('pageshow', function (e) {
  if (e.persisted && PUBLIC_VIEWS.indexOf(app.view) > -1) setView(app.view);
});

window.addEventListener('hashchange', function () {
  const name = currentRoute();
  if (name === 'reset' && app.view !== 'reset') resetReturn = app.view === 'settings' ? '#/settings' : '#/home';
  if (name !== app.view) sounds.navigate();
  setView(name);
  refreshOnEnter(name);
});

/* ---- boot ---------------------------------------------------------------- */
(async function boot() {
  let spotifyResult = null;
  if (location.pathname === '/callback') {
    spotifyResult = await spotify.auth.handleCallback();
    const back = /^#\/[\w-]*(\/[\w.-]+)?$/.test(spotifyResult.returnHash) ? spotifyResult.returnHash : '#/settings';
    history.replaceState(null, '', '/' + back);
  }

  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(STORE.get('theme', prefersLight ? 'light' : 'dark'));
  applyLook();
  document.getElementById('sidebar').innerHTML = renderSidebar();
  document.getElementById('bottomnav').innerHTML = renderBottomNav();
  document.getElementById('mobilebar').innerHTML = renderMobileBar();
  applyRail();
  RAIL_NARROW.addEventListener('change', applyRail);
  setAmbient(STORE.get('ambient', '1') === '1');

  // Set by handleGoogle just before leaving the page; read once so a later reload isn't mistaken for a return.
  let oauthReturn = null;
  try {
    oauthReturn = JSON.parse(sessionStorage.getItem('vortex.oauth') || 'null');
    sessionStorage.removeItem('vortex.oauth');
  } catch (e) { /* private mode */ }

  app.session = await db.auth.getSession();
  if (app.session) await loadCurrentUser();
  // The policy box was ticked on the signup page before leaving for Google.
  if (app.session && app.needsConsent && oauthReturn && oauthReturn.privacy === PRIVACY_VERSION) {
    try {
      await db.profiles.update(app.session.user.id, { privacy_version: PRIVACY_VERSION });
      app.needsConsent = false;
    } catch (err) { console.error('Could not record privacy consent:', err); }
  }

  db.auth.onChange(function (event, session) {
    app.session = session;
    if (event === 'SIGNED_OUT') {
      app.needsUsername = false;
      app.needsConsent = false;
      // Spotify tokens are per-browser, so the next vortex account must not inherit them.
      spotify.auth.disconnect();
      stopSpotifyPolling();
      stopListeningFeed();
      stopNotifications();
      DATA.friends = []; DATA.incoming = []; DATA.outgoing = []; DATA.feed = []; DATA.blocked = [];
      DATA.me.stats = null; DATA.me.recentPosts = []; DATA.me.pin = null;
      DATA.notifications = { status: 'idle', items: [], unread: 0 };
      UI.notifFresh = {}; UI.postView = null; UI.recapStats = null;
      UI.friendSearch = { q: '', results: null, loading: false, error: false };
      resetSpotifyLibrary();
      DATA.tastes = {};
      tastesLoadedAt = 0;
      tastesStatus = 'idle';
      UI.friendProfile = null;
      location.hash = '#/login';
      setView(currentRoute());
    }
    if (event === 'PASSWORD_RECOVERY') { location.hash = '#/reset'; return; }
    // Supabase also re-announces SIGNED_IN for an existing session (e.g. another tab); only a fresh log-in navigates.
    if (event === 'SIGNED_IN' && PUBLIC_VIEWS.indexOf(app.view) === -1) return;
    if (event === 'SIGNED_IN') {
      loadCurrentUser().then(function () {
        // A pending shared link waits for the welcome screen, then opens.
        location.hash = onboardingPending() ? '#/welcome' : pendingDeepLink || '#/home';
        if (!onboardingPending()) pendingDeepLink = null;
        setView(currentRoute());
        startSpotifyPolling();
        startListeningFeed();
        startNotifications();
      });
    }
  });

  // Swap the token fragment from an email link or Google sign-in for a real route, so it never lingers in the address bar.
  if (AUTH_LINK) {
    if (app.session && AUTH_LINK.type !== 'recovery' && oauthReturn && /^#\/(u|compare|p)\/[^/]+$/.test(oauthReturn.back || '')) {
      pendingDeepLink = oauthReturn.back;
    }
    const dest = !app.session ? '#/login'
      : AUTH_LINK.type === 'recovery' ? '#/reset'
      : onboardingPending() ? '#/welcome'
      : pendingDeepLink || '#/home';
    if (dest === pendingDeepLink) pendingDeepLink = null;
    history.replaceState(null, '', location.pathname + location.search + dest);
  }
  if (!location.hash) location.hash = app.session ? '#/home' : '#/login';
  setView(currentRoute());
  if (AUTH_LINK && AUTH_LINK.error && app.view === 'login') {
    showAuthMessage(oauthReturn
      ? t('Google sign-in didn’t finish. Try again, or use your email.')
      : t('That email link has expired or was already used. To reset your password, use “Forgot password?” to get a new one.'), true);
  }
  startSpotifyPolling();
  startListeningFeed();
  startNotifications();

  if (spotifyResult) {
    if (spotifyResult.ok) toast('spotifyConnected');
    else toast(spotifyResult.error === 'access_denied' ? 'spotifyCancelled' : 'spotifyFailed');
  }
})();
