/* ==========================================================================
   vortex — song clips: the 15 or 30 seconds of a song a post plays.
   They play through Spotify's Web Playback SDK, so they need Spotify Premium.
   vortex never handles the audio: the SDK streams it from Spotify into this
   tab, and a post only stores where its clip starts and how long it runs.
   ========================================================================== */

const CLIP_LENGTHS = [15, 30];
const CLIP_SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const CLIP_VOLUME = .8;
const CLIP_FADE_MS = 900;
const CLIP_TIMEOUT_MS = 12000;
const CLIP_TRACK = /^[A-Za-z0-9]{22}$/;

const clips = {
  player: null,
  ready: null,      // Promise of the in-browser device id, once loading starts
  premium: null,    // false once Spotify says this account can't stream
  now: null,        // { key, trackId, startMs, lengthMs, state, askedAt, startedAt, fading, resume }
  ending: null,     // the clip that just stopped, while it fades out and hands playback back
  quietUntil: 0     // now-playing polls wait until then, so a clip never shows as what you're playing
};

/* While a clip plays, and a little after, what Spotify reports as playing is the clip. */
function clipBusy() { return !!clips.now || Date.now() < clips.quietUntil; }

function clipScopesMissing() {
  return SPOTIFY_CLIP_SCOPES.some(function (s) { return !spotify.auth.hasScope(s); });
}

function clipError(code) { const e = new Error('Clip player: ' + code); e.clipCode = code; return e; }

function clipTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* ---- the player ------------------------------------------------------------ */
function loadClipPlayer() {
  if (clips.ready) return clips.ready;
  let settled = false, timer = null;
  const ready = new Promise(function (resolve, reject) {
    function ok(id) {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(id);
    }
    // Also runs on errors after it's ready (an expired login, say): the next play starts over.
    function fail(err) {
      if (clips.ready === ready) clips.ready = null;
      if (clips.player) { clips.player.disconnect(); clips.player = null; }
      if (clips.now && settled) { dropClip(); paintClips(); }
      if (settled) return;
      settled = true; clearTimeout(timer); reject(err);
    }
    timer = setTimeout(function () { fail(clipError('timeout')); }, CLIP_TIMEOUT_MS);
    const start = function () { createClipPlayer(ok, fail); };
    if (window.Spotify && window.Spotify.Player) { start(); return; }
    window.onSpotifyWebPlaybackSDKReady = start;
    const s = document.createElement('script');
    s.src = CLIP_SDK_URL;
    s.onerror = function () { s.remove(); fail(clipError('load')); };
    document.head.appendChild(s);
  });
  clips.ready = ready;
  return ready;
}

function createClipPlayer(ok, fail) {
  const player = new Spotify.Player({
    name: SPOTIFY_CLIP_PLAYER,
    volume: 0,   // every clip fades in from silence
    getOAuthToken: function (cb) { spotify.auth.getValidToken().then(cb, function () { cb(''); }); }
  });
  player.addListener('ready', function (e) { ok(e.device_id); });
  player.addListener('not_ready', function () { fail(clipError('offline')); });
  player.addListener('account_error', function () { clips.premium = false; fail(clipError('premium')); });
  player.addListener('authentication_error', function () { fail(clipError('auth')); });
  player.addListener('initialization_error', function () { fail(clipError('init')); });
  player.addListener('playback_error', function () { if (clips.now) { endClip(false); toast('clipFailed'); } });
  player.addListener('autoplay_failed', function () { if (clips.now) { endClip(false); toast('clipTapAgain'); } });
  player.addListener('player_state_changed', syncClipState);
  clips.player = player;
  player.connect();
}

/* The moment Spotify says the clip is really playing, the clock starts and it fades in. */
function syncClipState(state) {
  const c = clips.now;
  if (!c || !state || !state.track_window) return;
  const cur = state.track_window.current_track;
  if (!cur || (cur.id !== c.trackId && !(cur.linked_from && cur.linked_from.id === c.trackId))) return;
  if (state.paused) {
    // Paused from outside (media keys, another Spotify app): treat it as stopping the clip.
    if (c.state === 'playing' && !c.fading) endClip(true);
    return;
  }
  if (c.state !== 'playing') { c.state = 'playing'; fadeClip(CLIP_VOLUME, 500); }
  c.startedAt = performance.now() - Math.max(0, state.position - c.startMs);
}

let clipFade = null;
/* Ramps the volume; a newer fade cancels the older one. */
function fadeClip(to, ms) {
  if (clipFade) { clearInterval(clipFade.timer); clipFade.resolve(); clipFade = null; }
  const p = clips.player;
  if (!p) return Promise.resolve();
  return p.getVolume().then(function (from) {
    return new Promise(function (resolve) {
      const t0 = performance.now();
      const fade = { resolve: resolve, timer: 0 };
      fade.timer = setInterval(function () {
        const k = Math.min(1, (performance.now() - t0) / ms);
        p.setVolume(from + (to - from) * k).catch(function () {});
        if (k >= 1) { clearInterval(fade.timer); if (clipFade === fade) clipFade = null; resolve(); }
      }, 40);
      clipFade = fade;
    });
  }).catch(function () {});
}

/* What was playing elsewhere, so it can pick up again where it was once the clip ends. */
async function rememberPlayback(device) {
  try {
    const p = await spotify.request('/me/player');
    if (!p || !p.is_playing || !p.item || !p.device || !p.device.id || p.device.id === device) return null;
    return { deviceId: p.device.id, contextUri: p.context ? p.context.uri : null, itemUri: p.item.uri, positionMs: p.progress_ms || 0 };
  } catch (e) { return null; }
}

async function restorePlayback(r) {
  const path = '/me/player/play?device_id=' + encodeURIComponent(r.deviceId);
  if (r.contextUri) {
    try {
      await spotify.request(path, { context_uri: r.contextUri, offset: { uri: r.itemUri }, position_ms: r.positionMs }, 'PUT');
      return;
    } catch (e) { /* artist pages and some collections refuse an offset: fall back to the song alone */ }
  }
  await spotify.request(path, { uris: [r.itemUri], position_ms: r.positionMs }, 'PUT');
}

async function requestClip(device, c) {
  const path = '/me/player/play?device_id=' + encodeURIComponent(device);
  const body = { uris: ['spotify:track:' + c.trackId], position_ms: c.startMs };
  try {
    await spotify.request(path, body, 'PUT');
  } catch (err) {
    // A brand-new player can take a moment to register with Spotify.
    if (err.status !== 404) throw err;
    await new Promise(function (r) { setTimeout(r, 900); });
    await spotify.request(path, body, 'PUT');
  }
}

/* o: { key, trackId, startMs, lengthS, restart }. Call it straight from the click:
   browsers only let sound start inside a tap. Tapping the clip that's playing stops it. */
async function playClip(o) {
  if (clips.now && clips.now.key === o.key && !o.restart) { endClip(true); return; }
  if (clipScopesMissing()) { clipReconnectToast(); return; }
  if (clips.player) clips.player.activateElement();
  // A clip that's still winding down must not pause this one or bring the old song back.
  const prev = clips.now || clips.ending;
  const carry = prev ? prev.resume : undefined;
  if (clips.ending) { clips.ending.superseded = true; clips.ending = null; }
  if (clips.now) dropClip();
  const c = {
    key: o.key, trackId: o.trackId,
    startMs: Math.max(0, Math.round(o.startMs) || 0), lengthMs: (CLIP_LENGTHS.indexOf(o.lengthS) > -1 ? o.lengthS : 30) * 1000,
    state: 'loading', askedAt: performance.now(), startedAt: 0, fading: false, resume: carry
  };
  clips.now = c;
  runClipClock();
  try {
    const device = await loadClipPlayer();
    if (clips.now !== c) return;
    if (c.resume === undefined) c.resume = await rememberPlayback(device);
    if (clips.now !== c) return;
    await requestClip(device, c);
  } catch (err) {
    if (clips.now !== c) return;
    dropClip();
    paintClips();
    if (err.clipCode === 'premium' || err.reason === 'PREMIUM_REQUIRED') { clips.premium = false; toast('clipPremium'); }
    else if (err.clipCode === 'init') toast('clipUnsupported');
    else { console.warn('Could not play the clip:', err); toast('clipFailed'); }
  }
}

/* Forgets the current clip without touching the player: the next clip replaces it. */
function dropClip() {
  if (!clips.now) return;
  clips.now = null;
  clips.quietUntil = Date.now() + 20000;
  if (clips.player) clips.player.setVolume(0).catch(function () {});
}

/* Stops the clip, and with resume, goes back to what was playing before it. */
function endClip(resume) {
  const c = clips.now;
  if (!c) return;
  clips.now = null;
  clips.ending = c;
  clips.quietUntil = Date.now() + 20000;
  paintClips();
  const player = clips.player;
  (c.state === 'playing' && !c.fading ? fadeClip(0, 250) : Promise.resolve())
    .then(function () { if (!c.superseded && player) return player.pause(); })
    .catch(function () {})
    .then(function () { if (resume && c.resume && !c.superseded) return restorePlayback(c.resume); })
    .catch(function (err) { console.warn('Could not go back to what was playing:', err); })
    .then(function () { if (clips.ending === c) clips.ending = null; });
}

/* Signing out or disconnecting Spotify takes the player down with it. */
function shutdownClips() {
  endClip(false);
  if (clips.player) clips.player.disconnect();
  clips.player = null;
  clips.ready = null;
  clips.premium = null;
}

/* ---- the clock: ends the clip on time and paints its progress -------------- */
let clipClock = null;
function runClipClock() {
  if (clipClock) return;
  // An interval, not animation frames, so a clip still ends on time in a background tab.
  clipClock = setInterval(function () {
    const c = clips.now;
    if (c && c.state === 'loading' && performance.now() - c.askedAt > CLIP_TIMEOUT_MS) {
      endClip(false);
      toast('clipFailed');
    } else if (c && c.state === 'playing') {
      const elapsed = performance.now() - c.startedAt;
      if (elapsed >= c.lengthMs) endClip(true);
      else if (elapsed >= c.lengthMs - CLIP_FADE_MS && !c.fading) { c.fading = true; fadeClip(0, CLIP_FADE_MS); }
    }
    paintClips();
    if (!clips.now) { clearInterval(clipClock); clipClock = null; }
  }, 50);
}

/* Every play button and progress bar reads the clip from here, so a re-rendered
   post card picks its state straight back up. */
function paintClips() {
  const c = clips.now;
  const p = c && c.state === 'playing' ? Math.min(1, Math.max(0, (performance.now() - c.startedAt) / c.lengthMs)) : 0;
  document.querySelectorAll('[data-clip]').forEach(function (el) {
    const on = !!c && el.dataset.clip === c.key;
    const state = on ? c.state : 'idle';
    if (el.dataset.clipState !== state) {
      el.dataset.clipState = state;
      el.setAttribute('aria-pressed', String(on));
    }
    el.style.setProperty('--clip-p', on ? p.toFixed(4) : '0');
  });
  document.querySelectorAll('[data-clip-progress]').forEach(function (el) {
    const on = !!c && el.dataset.clipProgress === c.key;
    el.classList.toggle('is-playing', on && c.state === 'playing');
    el.style.setProperty('--clip-p', on ? p.toFixed(4) : '0');
  });
}

function clipReconnectToast() {
  showToast(
    '<span class="toast__well toast__well--info">' + icon('spotify', 15) + '</span>' +
    '<span class="toast__body">' +
      '<span class="t-label-m">' + esc(t('Reconnect Spotify to play clips')) + '</span>' +
      '<span class="t-caption c-tertiary">' + esc(t('Clips need a permission your connection doesn’t have yet')) + '</span>' +
    '</span>' +
    '<button class="btn btn--secondary btn--sm" data-action="spotify-connect">' + t('Reconnect') + '</button>');
}

/* A post card's play button. Without Spotify, or without Premium, it opens the song on Spotify instead. */
function onClipButton(b) {
  if (b.dataset.clip === 'composer') {
    if (composerClip) playClip({ key: 'composer', trackId: composerClip.trackId, startMs: composerClip.startMs, lengthS: composerClip.lengthS });
    return;
  }
  const trackId = b.dataset.clipTrack;
  if (!CLIP_TRACK.test(trackId || '')) return;
  if (!spotify.auth.isConnected() || clips.premium === false) {
    window.open('https://open.spotify.com/track/' + trackId, '_blank', 'noopener');
    return;
  }
  playClip({ key: b.dataset.clip, trackId: trackId, startMs: +b.dataset.clipStart || 0, lengthS: +b.dataset.clipLen || 30 });
}

/* The play button a post card shows. Posts from before clips play their first 30 seconds. */
function clipButton(p) {
  const start = p.clipStart != null ? p.clipStart : 0;
  const len = p.clipLen || 30;
  return '<button type="button" class="post__play" data-clip="post:' + esc(p.id) + '" data-clip-track="' + p.trackId + '" ' +
      'data-clip-start="' + start + '" data-clip-len="' + len + '" aria-pressed="false" ' +
      'data-tip="' + t('Play clip') + '" aria-label="' + t('Play a clip of {track}', { track: esc(p.track) }) + '">' +
    '<span class="clipicon clipicon--play">' + icon('play', 15) + '</span>' +
    '<span class="clipicon clipicon--pause">' + icon('pause', 15) + '</span>' +
  '</button>';
}

/* ---- choosing the clip while writing a post --------------------------------- */
let composerClip = null;   // { trackId, durationMs, startMs, lengthS }
const CLIP_BARS = 56;

/* A made-up waveform, the same every time for a song: Spotify no longer shares the real one. */
function clipBarHeights(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rnd = function () { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return ((h >>> 0) % 1000) / 1000; };
  let prev = .5;
  const out = [];
  for (let i = 0; i < CLIP_BARS; i++) {
    const x = i / (CLIP_BARS - 1);
    const shape = Math.min(1, x * 6) * Math.min(1, (1 - x) * 5);   // quiet intro and outro
    prev = prev * .45 + rnd() * .55;
    out.push(Math.max(.12, Math.min(1, (.25 + .75 * prev) * (.35 + .65 * shape))));
  }
  return out;
}

/* Default start: where you are in it when sharing what's playing, otherwise a third in. */
function clipPicker(track, startMs) {
  if (!track || !CLIP_TRACK.test(track.id || '') || !(track.durationMs >= 15000)) { composerClip = null; return ''; }
  const lengthS = track.durationMs >= 30000 ? (composerClip && composerClip.trackId === track.id ? composerClip.lengthS : 15) : 15;
  composerClip = { trackId: track.id, durationMs: track.durationMs, lengthS: lengthS, startMs: 0 };
  composerClip.startMs = clampClipStart(startMs != null ? startMs - 2000 : track.durationMs * .3);
  return '<div class="clip" id="clipPicker">' +
    '<div class="clip__head">' +
      '<span class="t-label-m c-secondary">' + t('Clip') + '</span>' +
      '<div class="tabs clip__lens" role="radiogroup" aria-label="' + t('Clip length') + '">' + CLIP_LENGTHS.map(function (s) {
        const fits = s * 1000 <= track.durationMs;
        return '<button type="button" class="tab" role="radio" data-clip-len-pick="' + s + '" aria-checked="' + (s === lengthS) + '"' + (fits ? '' : ' disabled') + '>' + s + ' s</button>';
      }).join('') + '</div>' +
    '</div>' +
    '<div class="clip__track" id="clipTrack">' +
      '<div class="clip__wave" aria-hidden="true">' + clipBarHeights(track.id).map(function (v) {
        return '<i style="--h:' + v.toFixed(2) + '"></i>';
      }).join('') + '</div>' +
      '<div class="clip__window" id="clipWindow" data-clip-progress="composer" role="slider" tabindex="0" aria-label="' + t('Clip start') + '" aria-valuemin="0"></div>' +
    '</div>' +
    '<div class="clip__foot">' +
      '<button type="button" class="btn btn--secondary btn--sm clip__play" data-clip="composer" aria-pressed="false">' +
        '<span class="clipicon clipicon--play">' + icon('play', 14) + '</span>' +
        '<span class="clipicon clipicon--pause">' + icon('pause', 14) + '</span>' +
        '<span class="clip__say clip__say--play">' + t('Play clip') + '</span>' +
        '<span class="clip__say clip__say--stop">' + t('Stop') + '</span>' +
      '</button>' +
      '<span class="t-num c-secondary" id="clipTimes"></span>' +
    '</div>' +
    '<p class="t-caption c-tertiary">' + t('Drag the highlight to the part you want to share.') + '</p>' +
  '</div>';
}

function clampClipStart(ms) {
  const c = composerClip;
  // Whole seconds, so the times shown are the times played.
  const max = Math.max(0, Math.floor((c.durationMs - c.lengthS * 1000) / 1000) * 1000);
  return Math.max(0, Math.min(max, Math.round(ms / 1000) * 1000));
}

function paintClipPicker() {
  const c = composerClip;
  const box = document.getElementById('clipPicker');
  if (!c || !box) return;
  const endMs = c.startMs + c.lengthS * 1000;
  box.style.setProperty('--l', (c.startMs / c.durationMs * 100).toFixed(3) + '%');
  box.style.setProperty('--w', (c.lengthS * 1000 / c.durationMs * 100).toFixed(3) + '%');
  box.querySelectorAll('.clip__wave i').forEach(function (bar, i) {
    const at = (i + .5) / CLIP_BARS * c.durationMs;
    bar.classList.toggle('on', at >= c.startMs && at <= endMs);
  });
  const win = document.getElementById('clipWindow');
  const words = t('{from} to {to}', { from: clipTime(c.startMs), to: clipTime(endMs) });
  win.setAttribute('aria-valuemax', String(Math.round((c.durationMs - c.lengthS * 1000) / 1000)));
  win.setAttribute('aria-valuenow', String(c.startMs / 1000));
  win.setAttribute('aria-valuetext', words);
  document.getElementById('clipTimes').textContent = clipTime(c.startMs) + ' – ' + clipTime(endMs);
  box.querySelectorAll('[data-clip-len-pick]').forEach(function (b) { b.setAttribute('aria-checked', String(+b.dataset.clipLenPick === c.lengthS)); });
}

/* A new start or length restarts the preview if it's playing, so you hear the new part. */
function setComposerClip(startMs, lengthS) {
  const c = composerClip;
  if (!c) return;
  if (lengthS) c.lengthS = lengthS;
  c.startMs = clampClipStart(startMs);
  paintClipPicker();
}

function replayComposerClip() {
  const c = composerClip;
  if (c && clips.now && clips.now.key === 'composer') {
    playClip({ key: 'composer', trackId: c.trackId, startMs: c.startMs, lengthS: c.lengthS, restart: true });
  }
}

function stopComposerClip() {
  if (clips.now && clips.now.key === 'composer') endClip(true);
}

function bindClipPicker() {
  const track = document.getElementById('clipTrack');
  const win = document.getElementById('clipWindow');
  if (!track || !win || !composerClip) return;
  paintClipPicker();
  let grab = null;
  const ratioAt = function (e) {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  track.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    const c = composerClip;
    const ratio = ratioAt(e);
    const startRatio = c.startMs / c.durationMs, lenRatio = c.lengthS * 1000 / c.durationMs;
    // Grabbing the highlight keeps your hold on it; anywhere else centres it under your finger.
    grab = e.target === win ? ratio - startRatio : lenRatio / 2;
    track.setPointerCapture(e.pointerId);
    track.classList.add('is-dragging');
    setComposerClip((ratio - grab) * c.durationMs);
    e.preventDefault();
  });
  track.addEventListener('pointermove', function (e) {
    if (grab === null) return;
    setComposerClip((ratioAt(e) - grab) * composerClip.durationMs);
  });
  const release = function () {
    if (grab === null) return;
    grab = null;
    track.classList.remove('is-dragging');
    replayComposerClip();
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  win.addEventListener('keydown', function (e) {
    const c = composerClip;
    const step = { ArrowLeft: -1000, ArrowDown: -1000, ArrowRight: 1000, ArrowUp: 1000, PageDown: -10000, PageUp: 10000 }[e.key];
    if (step) setComposerClip(c.startMs + step * (e.shiftKey ? 5 : 1));
    else if (e.key === 'Home') setComposerClip(0);
    else if (e.key === 'End') setComposerClip(c.durationMs);
    else return;
    e.preventDefault();
  });
  win.addEventListener('keyup', function (e) { if (/^(Arrow|Page|Home|End)/.test(e.key)) replayComposerClip(); });
}
