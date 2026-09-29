/* ==========================================================================
   vortex — recap: your last 4 weeks as a story-sized card (1080×1920)
   Spotify's shortest top-list range is ~4 weeks, so that's the period. The
   HTML poster and the exported PNG share one layout, in 1080-wide units.
   ========================================================================== */

UI.recapStats = null;   // { status: 'loading'|'ok'|'error', data: { posts, reactions, comments } }

const RECAP_DAYS = 28;

function recapSince() { return new Date(Date.now() - RECAP_DAYS * 864e5); }

function recapRange() {
  const f = function (d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  return f(recapSince()) + ' – ' + f(new Date());
}

function recapData() {
  const artists = libData('topArtists', 'short_term');
  const tracks = libData('topTracks', 'short_term');
  if (!artists || !tracks) return null;
  const long = libData('topArtists', 'long_term');
  const year = long ? idSet(long) : null;
  const mine = mySnapshot();
  let best = null;
  if (mine) {
    DATA.friends.forEach(function (f) {
      const t = DATA.tastes[f.id];
      const c = t && compatibility(mine, t);
      if (c && (!best || c.score > best.score)) best = { friend: f, score: c.score };
    });
  }
  return {
    top: artists[0] || null,
    tracks: tracks.slice(0, 5),
    genres: genreShares(artists).list.slice(0, 5),
    fresh: year ? artists.filter(function (a) { return !year[a.id]; }) : null,
    best: best,
    stats: UI.recapStats && UI.recapStats.status === 'ok' ? UI.recapStats.data : null
  };
}

/* Three numbers for the card; each falls back to another real one. */
function recapStats(d) {
  const out = [];
  out.push(d.fresh ? { n: d.fresh.length, label: d.fresh.length === 1 ? 'new artist' : 'new artists' } : { n: null, label: 'new artists' });
  out.push(d.stats ? { n: d.stats.posts, label: d.stats.posts === 1 ? 'track shared' : 'tracks shared' } : { n: null, label: 'tracks shared' });
  if (d.best) out.push({ n: d.best.score, label: 'match with ' + d.best.friend.name.split(/\s+/)[0] });
  else out.push(d.stats ? { n: d.stats.reactions, label: d.stats.reactions === 1 ? 'reaction' : 'reactions' } : { n: null, label: 'reactions' });
  return out;
}

function recapPoster(d) {
  const first = (DATA.me.name || '').split(/\s+/)[0] || 'Your';
  return '<article class="poster" aria-label="Recap card, ' + esc(recapRange()) + '">' +
    '<div class="poster__disc" aria-hidden="true"><span class="poster__label" style="' + artImageStyle(d.top.image) + '"></span></div>' +
    '<div class="poster__top"><span class="poster__brand">vortex</span><span class="poster__range">' + esc(recapRange()) + '</span></div>' +
    '<p class="poster__who">' + esc(first) + '’s last 4 weeks</p>' +
    '<div class="poster__bottom">' +
      '<p class="poster__kicker">Number one artist</p>' +
      '<h2 class="poster__artist">' + esc(d.top.name) + '</h2>' +
      '<ol class="poster__tracks">' + d.tracks.map(function (t, i) {
        return '<li><span class="poster__n">' + (i + 1) + '</span><b>' + esc(t.title) + '</b><em>' + esc(t.artist) + '</em></li>';
      }).join('') + '</ol>' +
      '<div class="poster__stats">' + recapStats(d).map(function (s) {
        return '<div><b>' + (s.n === null ? '–' : esc(String(s.n))) + '</b><span>' + esc(s.label) + '</span></div>';
      }).join('') + '</div>' +
      '<p class="poster__foot"><span>' + esc(DATA.me.name) + '</span><span>' + esc(DATA.me.username) + '</span></p>' +
    '</div>' +
  '</article>';
}

function recapShareBlock() {
  const canShare = !!(navigator.share && navigator.canShare);
  return '<section class="panel section">' + sectionHead('Share it') +
    '<div class="section__body section__body--pad stack stack--sm">' +
      '<p class="t-body-s c-secondary">Sized for stories (1080 × 1920). It only uses your Spotify top lists and your vortex activity.</p>' +
      '<div class="rowflex" style="gap:8px;flex-wrap:wrap">' +
        (canShare ? '<button class="btn btn--primary btn--sm" data-action="recap-share">' + icon('arrowUpRight', 15) + 'Share</button>' : '') +
        '<button class="btn ' + (canShare ? 'btn--secondary' : 'btn--primary') + ' btn--sm" data-action="recap-save">' + icon('download', 15) + 'Save image</button>' +
      '</div>' +
    '</div>' +
  '</section>';
}

function recapBody() {
  const d = recapData();
  if (!d) {
    const failed = libFailed('topArtists', 'short_term') || libFailed('topTracks', 'short_term');
    return failed ? ghostPanel(null, null, 'Could not reach Spotify. Try again in a moment.')
      : '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading('Putting your last 4 weeks together…') + '</div></section>';
  }
  if (!d.top || !d.tracks.length) {
    return ghostPanel(null, null, 'Spotify doesn\'t have enough listening from the last 4 weeks yet. Play a few more songs and come back.');
  }
  return '<div class="recap">' +
    '<div class="recap__poster">' + recapPoster(d) + '</div>' +
    '<div class="stack recap__side">' +
      recapShareBlock() +
      (d.genres.length ? '<section class="panel section">' + sectionHead('Top genres', 'last 4 weeks') +
        '<div class="section__body section__body--pad"><div class="dna-chips">' + d.genres.map(function (g, i) {
          return '<span class="dna-chip' + (i === 0 ? ' dna-chip--lead' : '') + '">' + esc(g.name) + '</span>';
        }).join('') + '</div></div></section>' : '') +
      (d.fresh && d.fresh.length ? '<section class="panel section">' + sectionHead('New arrivals', 'not in your ~1-year top 50') +
        '<div class="section__body section__body--pad"><div class="achips">' +
          d.fresh.slice(0, 10).map(function (a) { return artistChip(a, a.genres[0] || null); }).join('') +
        '</div></div></section>' : '') +
    '</div>' +
  '</div>';
}

function recapBodyAuto() {
  return '<div class="stack" id="recapBody">' + recapBody() + '</div>';
}

VIEWS.recap = function () {
  return wrap(pageHead('Your last 4 weeks', 'Recap'), spotifyGate() || recapBodyAuto());
};

/* Home: a link into the recap, with your current number one when it's loaded. */
function homeRecapPanel() {
  if (!spotify.auth.isConnected()) return '<div id="homeRecap" hidden></div>';
  const artists = libData('topArtists', 'short_term');
  const top = artists && artists[0];
  return '<a class="panel recap-teaser" href="#/recap" id="homeRecap">' +
    '<span class="recap-teaser__disc" aria-hidden="true"><span style="' + (top ? artImageStyle(top.image) : '') + '"></span></span>' +
    '<span class="recap-teaser__meta">' +
      '<span class="t-title-s">Your last 4 weeks, in one card</span>' +
      '<span class="t-body-s c-secondary">' + (top ? esc(top.name) + ' led the way. ' : '') + 'Save it or share it to your stories.</span>' +
    '</span>' +
    '<span class="btn btn--secondary btn--sm">See your recap</span>' +
  '</a>';
}

LIBRARY_PANELS.push(['recapBody', recapBodyAuto], ['homeRecap', homeRecapPanel]);

/* ---- PNG export ---------------------------------------------------------------- */
function fitText(ctx, text, max) {
  let s = String(text);
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

async function renderRecapImage() {
  const d = recapData();
  if (!d || !d.top) return null;
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const label = await loadImage(d.top.image);

  const W = 1080, H = 1920, P = 80;
  const INK = '#F2F1EE', INK2 = 'rgba(242,241,238,.64)', INK3 = 'rgba(242,241,238,.40)', EMBER = signalColor();
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0B0B0D';
  ctx.fillRect(0, 0, W, H);
  [[980, 260, 760, hexAlpha(EMBER, .34)], [60, 1700, 820, 'rgba(63,191,168,.18)']].forEach(function (g) {
    const grad = ctx.createRadialGradient(g[0], g[1], 0, g[0], g[1], g[2]);
    grad.addColorStop(0, g[3]); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  });

  // Record: grooves, a light sheen, the artist photo as the label.
  const dx = 842, dy = 616, dr = 432, lr = 156;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24;
  ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fillStyle = '#121214'; ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1.2;
  for (let r = lr + 14; r < dr - 6; r += 7) { ctx.beginPath(); ctx.arc(dx, dy, r, 0, Math.PI * 2); ctx.stroke(); }
  if (ctx.createConicGradient) {
    const sheen = ctx.createConicGradient(-0.6, dx, dy);
    sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.08, 'rgba(255,255,255,.10)');
    sheen.addColorStop(0.16, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.58, 'rgba(255,255,255,.07)'); sheen.addColorStop(0.66, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fillStyle = sheen; ctx.fill();
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(dx, dy, lr, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = EMBER; ctx.fillRect(dx - lr, dy - lr, lr * 2, lr * 2);
  if (label) {
    const s = Math.max(lr * 2 / label.width, lr * 2 / label.height);
    ctx.drawImage(label, dx - label.width * s / 2, dy - label.height * s / 2, label.width * s, label.height * s);
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(dx, dy, 12, 0, Math.PI * 2); ctx.fillStyle = '#0B0B0D'; ctx.fill();

  // Header
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK; ctx.font = '600 44px Geist, sans-serif';
  ctx.fillText('vortex', P, P + 36);
  ctx.textAlign = 'right'; ctx.fillStyle = INK3; ctx.font = '400 28px "Geist Mono", monospace';
  ctx.fillText(recapRange(), W - P, P + 34);
  ctx.textAlign = 'left'; ctx.fillStyle = INK2; ctx.font = '400 40px Geist, sans-serif';
  ctx.fillText(((DATA.me.name || '').split(/\s+/)[0] || 'Your') + '’s last 4 weeks', P, P + 118);

  // Bottom block, laid out upward from the footer so long names push up, not off.
  const inner = W - 2 * P;
  let y = H - P;
  ctx.font = '500 28px Geist, sans-serif'; ctx.fillStyle = INK2;
  ctx.fillText(fitText(ctx, DATA.me.name, inner * 0.6), P, y);
  ctx.textAlign = 'right'; ctx.fillStyle = INK3; ctx.fillText(DATA.me.username, W - P, y); ctx.textAlign = 'left';

  y -= 76;
  const stats = recapStats(d), colW = inner / 3;
  stats.forEach(function (s, i) {
    const x = P + i * colW;
    ctx.fillStyle = INK; ctx.font = '500 64px "Geist Mono", monospace';
    ctx.fillText(s.n === null ? '–' : String(s.n), x, y - 34);
    ctx.fillStyle = INK3; ctx.font = '400 24px Geist, sans-serif';
    ctx.fillText(fitText(ctx, s.label, colW - 20), x, y + 4);
  });
  y -= 120;
  ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(P, y, inner, 2);

  y -= 40;
  const rows = d.tracks.slice().reverse();
  rows.forEach(function (t, ri) {
    const i = d.tracks.length - 1 - ri;
    ctx.fillStyle = INK3; ctx.font = '500 28px "Geist Mono", monospace';
    ctx.fillText(String(i + 1), P, y);
    ctx.fillStyle = INK; ctx.font = '600 36px Geist, sans-serif';
    const title = fitText(ctx, t.title, inner - 64 - 200);
    ctx.fillText(title, P + 64, y);
    const used = ctx.measureText(title).width;
    ctx.fillStyle = INK2; ctx.font = '400 28px Geist, sans-serif';
    const room = inner - 64 - used - 24;
    if (room > 80) ctx.fillText(fitText(ctx, t.artist, room), P + 64 + used + 24, y);
    y -= 64;
  });

  y -= 36;
  ctx.fillStyle = INK; ctx.font = '600 128px Geist, sans-serif';
  const lines = wrapText(ctx, d.top.name, inner).slice(0, 2);
  if (wrapText(ctx, d.top.name, inner).length > 2) lines[1] = fitText(ctx, lines[1] + '…', inner);
  lines.reverse().forEach(function (l) { ctx.fillText(l, P - 4, y); y -= 122; });
  y += 122 - 128 - 26;
  ctx.fillStyle = EMBER; ctx.font = '500 30px Geist, sans-serif';
  ctx.fillText('Number one artist', P, y);

  return new Promise(function (resolve) { c.toBlob(resolve, 'image/png'); });
}
