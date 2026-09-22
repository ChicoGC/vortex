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
  session: null,
  player: {
    elapsed: DATA.nowPlaying.elapsed,
    duration: DATA.nowPlaying.duration,
    playing: true
  }
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
    const friendships = await db.friends.list(app.session.user.id);

    DATA.me.name = profile.name;
    DATA.me.username = '@' + profile.username;
    DATA.me.initials = initialsFrom(profile.name);
    DATA.me.bio = profile.bio || 'No bio yet.';
    DATA.me.friends = friendships.length;

    const joinedDate = new Date(profile.created_at);
    const month = joinedDate.toLocaleString('en-US', { month: 'long' });
    const year = joinedDate.getFullYear();
    DATA.me.joined = month + ' ' + year;

    document.getElementById('sidebar').innerHTML = renderSidebar();

    await loadFeed();
  } catch (e) { console.error('Error loading user:', e); }
}

async function loadFeed() {
  if (!app.session) return;
  try {
    const posts = await db.posts.list(30);
    DATA.feed = posts.map(function (post) {
      return transformPostData(post, app.session.user.id);
    });
  } catch (e) { console.error('Error loading feed:', e); }
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
function renderSidebar() {
  const np = DATA.nowPlaying;
  const nav = NAV.map(function (n) {
    if (n.group) return '<p class="nav-group t-overline">' + n.group + '</p>';
    return '<a class="nav" href="#/' + n.id + '" data-view-link="' + n.id + '">' +
      icon(n.icon, 19) +
      '<span>' + n.label + '</span>' +
      (n.dot ? '<span class="nav__dot" aria-label="In development"></span>' : '') +
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
    '<div class="np">' +
      '<div class="np__top">' +
        '<div class="art" data-art="' + np.art + '" style="width:38px;height:38px"></div>' +
        '<div class="np__meta">' +
          '<span class="t-label-m truncate">' + esc(np.title) + '</span>' +
          '<span class="t-caption c-tertiary truncate">' + esc(np.artist) + '</span>' +
        '</div>' +
        '<button class="iconbtn" data-player-toggle aria-label="Pause">' + icon('pause', 17) + '</button>' +
      '</div>' +
      '<div class="track track--thin"><i data-np-bar style="width:0%"></i></div>' +
      '<div class="np__times">' +
        '<span class="t-meta c-tertiary" data-np-elapsed>0:00</span>' +
        '<span class="t-meta c-tertiary">' + mmss(np.duration) + '</span>' +
      '</div>' +
    '</div>' +
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

/* ---- player -------------------------------------------------------------- */
function updatePlayerUI() {
  const p = app.player;
  const pct = (p.elapsed / p.duration) * 100;
  const bar = document.querySelector('[data-np-bar]');
  if (bar) bar.style.width = pct + '%';
  const el = document.querySelector('[data-np-elapsed]');
  if (el) el.textContent = mmss(p.elapsed);

  const heroBar = document.querySelector('.hero__progress .track i');
  if (heroBar) heroBar.style.width = pct + '%';
  const heroKnob = document.querySelector('.hero__progress .slider__knob');
  if (heroKnob) heroKnob.style.left = pct + '%';
  const heroTime = document.querySelector('.hero__progress .t-meta');
  if (heroTime) heroTime.textContent = mmss(p.elapsed);

  const glyph = p.playing ? 'pause' : 'play';
  const heroBtn = document.getElementById('heroPlay');
  if (heroBtn) { heroBtn.innerHTML = icon(glyph, 18); heroBtn.setAttribute('aria-label', p.playing ? 'Pause' : 'Play'); }
  const miniBtn = document.querySelector('[data-player-toggle]');
  if (miniBtn) { miniBtn.innerHTML = icon(glyph, 17); miniBtn.setAttribute('aria-label', p.playing ? 'Pause' : 'Play'); }
}

function togglePlayer() {
  app.player.playing = !app.player.playing;
  updatePlayerUI();
}

setInterval(function () {
  if (!app.player.playing) return;
  app.player.elapsed = (app.player.elapsed + 1) % app.player.duration;
  updatePlayerUI();
}, 1000);

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

function openPostForm() {
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
  document.getElementById('postTitle').focus();
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

  const btn = document.getElementById('postSubmit');
  btn.disabled = true; btn.textContent = 'Sharing…';
  try {
    await db.posts.create(app.session.user.id, {
      trackTitle: trackTitle,
      artist: artist,
      album: album || null,
      note: note || null,
      artSeed: 1 + Math.floor(Math.random() * 6)
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
  { label: 'Toggle compact sidebar', hint: 'Navigation', run: function () { setRail(document.getElementById('app').dataset.rail !== 'compact'); }, icon: 'bars' },
  { label: app.player.playing ? 'Pause playback' : 'Resume playback', hint: 'Player', run: togglePlayer, icon: 'pause' }
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
    else toast('request');
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

  const deleteBtn = t.closest('[data-delete-post]');
  if (deleteBtn) { openDeletePost(deleteBtn.dataset.deletePost); return; }

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

  const playerBtn = t.closest('[data-player-toggle], #heroPlay');
  if (playerBtn) { togglePlayer(); return; }

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
    app.player.playing = true;
    app.player.elapsed = 0;
    updatePlayerUI();
    return;
  }

  const tab = t.closest('[data-tab]');
  if (tab) {
    tab.parentElement.querySelectorAll('[data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b === tab));
    });
    return;
  }
});

document.addEventListener('submit', function (e) {
  if (e.target.id === 'protoLogin') { e.preventDefault(); toast('login'); }
  if (e.target.id === 'authLoginForm') { e.preventDefault(); handleLogin(e.target); }
  if (e.target.id === 'authSignupForm') { e.preventDefault(); handleSignup(e.target); }
  if (e.target.id === 'postForm') { e.preventDefault(); handlePostSubmit(e.target); }
  if (e.target.dataset.commentForm) { e.preventDefault(); handleCommentSubmit(e.target); }
});

document.addEventListener('keydown', function (e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); return; }
  if (e.key === 'Escape' && !document.getElementById('overlay').hidden) { closeOverlay(); return; }
  if (e.key === '/' && document.activeElement === document.body) { e.preventDefault(); openCmdk(); }
});

window.addEventListener('hashchange', function () { setView(currentRoute()); });

/* ---- boot ---------------------------------------------------------------- */
(async function boot() {
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
    if (event === 'SIGNED_OUT') { location.hash = '#/login'; setView(currentRoute()); }
    if (event === 'SIGNED_IN') { loadCurrentUser().then(function () { location.hash = '#/home'; setView(currentRoute()); }); }
  });

  if (!location.hash) location.hash = app.session ? '#/home' : '#/login';
  setView(currentRoute());
})();
