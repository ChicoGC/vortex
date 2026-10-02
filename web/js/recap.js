/* ==========================================================================
   vortex — recap: your last 4 weeks as a story-sized card (1080×1920)
   Spotify's shortest top-list range is ~4 weeks, so that's the period. The
   HTML poster and the exported PNG share one layout, in 1080-wide units.
   ========================================================================== */

UI.recapStats = null;   // { status: 'loading'|'ok'|'error', data: { posts, reactions, comments } }

const RECAP_DAYS = 28;

function recapSince() { return new Date(Date.now() - RECAP_DAYS * 864e5); }

function recapRange() {
  const f = function (d) { return d.toLocaleDateString(loc('en-GB'), { day: 'numeric', month: 'short' }); };
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
    artists: artists.slice(0, 3),
    tracks: tracks.slice(0, 4),
    genres: genreShares(artists).list.slice(0, 5),
    fresh: year ? artists.filter(function (a) { return !year[a.id]; }) : null,
    best: best,
    stats: UI.recapStats && UI.recapStats.status === 'ok' ? UI.recapStats.data : null
  };
}

/* Three numbers for the card; each falls back to another real one. */
function recapStats(d) {
  const out = [];
  out.push(d.fresh ? { n: d.fresh.length, label: d.fresh.length === 1 ? t('new artist') : t('new artists') } : { n: null, label: t('new artists') });
  out.push(d.stats ? { n: d.stats.posts, label: d.stats.posts === 1 ? t('track shared') : t('tracks shared') } : { n: null, label: t('tracks shared') });
  if (d.best) out.push({ n: d.best.score, label: t('match with {name}', { name: d.best.friend.name.split(/\s+/)[0] }) });
  else out.push(d.stats ? { n: d.stats.reactions, label: d.stats.reactions === 1 ? t('reaction') : t('reactions') } : { n: null, label: t('reactions') });
  return out;
}

function recapPoster(d) {
  const first = (DATA.me.name || '').split(/\s+/)[0];
  const song = d.tracks[0];
  const more = d.tracks.slice(1);
  return '<article class="poster" aria-label="' + t('Recap card, {range}', { range: esc(recapRange()) }) + '">' +
    '<div class="poster__top">' +
      '<span class="poster__brand"><img src="assets/logo-64.png" alt="">Vortex</span>' +
      '<span class="poster__range">' + esc(recapRange()) + '</span>' +
    '</div>' +
    '<p class="poster__who">' + (first ? t('{name}’s last 4 weeks', { name: esc(first) }) : t('Your’s last 4 weeks')) + '</p>' +
    '<p class="poster__kicker poster__kicker--song">' + t('Most played song') + '</p>' +
    '<div class="poster__song">' +
      '<span class="poster__cover" style="' + artImageStyle(song.image || song.thumb) + '"></span>' +
      '<span class="poster__songmeta"><b>' + esc(song.title) + '</b><span>' + esc(song.artist) + '</span>' +
        (song.album ? '<em>' + esc(song.album) + '</em>' : '') + '</span>' +
    '</div>' +
    '<p class="poster__kicker poster__kicker--artists">' + t('Top artists') + '</p>' +
    '<ol class="poster__artists">' + d.artists.map(function (a, i) {
      return '<li><span class="poster__face" style="' + artImageStyle(a.image) + '">' +
        (a.image ? '' : '<span>' + esc(initialsFrom(a.name)) + '</span>') + '<i>' + (i + 1) + '</i></span>' +
        '<b>' + esc(a.name) + '</b></li>';
    }).join('') + '</ol>' +
    (more.length ? '<p class="poster__kicker poster__kicker--more">' + t('Also on repeat') + '</p>' +
      '<ol class="poster__more">' + more.map(function (t) {
        return '<li><span class="poster__mini" style="' + artImageStyle(t.thumb) + '"></span>' +
          '<span class="poster__moremeta"><b>' + esc(t.title) + '</b><em>' + esc(t.artist) + '</em></span></li>';
      }).join('') + '</ol>' : '') +
    '<div class="poster__stats">' + recapStats(d).map(function (s) {
      return '<div><b>' + (s.n === null ? '–' : esc(String(s.n))) + '</b><span>' + esc(s.label) + '</span></div>';
    }).join('') + '</div>' +
    '<p class="poster__foot"><span>' + esc(DATA.me.name) + '</span><span>' + esc(DATA.me.username) + '</span></p>' +
  '</article>';
}

function recapShareBlock() {
  const canShare = !!(navigator.share && navigator.canShare);
  return '<section class="panel section">' + sectionHead(t('Share it')) +
    '<div class="section__body section__body--pad stack stack--sm">' +
      '<p class="t-body-s c-secondary">' + t('Sized for stories (1080 × 1920). It only uses your Spotify top lists and your vortex activity.') + '</p>' +
      '<div class="rowflex" style="gap:8px;flex-wrap:wrap">' +
        (canShare ? '<button class="btn btn--primary btn--sm" data-action="recap-share">' + icon('arrowUpRight', 15) + t('Share') + '</button>' : '') +
        '<button class="btn ' + (canShare ? 'btn--secondary' : 'btn--primary') + ' btn--sm" data-action="recap-save">' + icon('download', 15) + t('Save image') + '</button>' +
      '</div>' +
    '</div>' +
  '</section>';
}

function recapBody() {
  const d = recapData();
  if (!d) {
    const failed = libFailed('topArtists', 'short_term') || libFailed('topTracks', 'short_term');
    return failed ? ghostPanel(null, null, t('Could not reach Spotify. Try again in a moment.'))
      : '<section class="panel section"><div class="section__body section__body--pad">' + dnaLoading(t('Putting your last 4 weeks together…')) + '</div></section>';
  }
  if (!d.top || !d.tracks.length) {
    return ghostPanel(null, null, t('Spotify doesn\'t have enough listening from the last 4 weeks yet. Play a few more songs and come back.'));
  }
  return '<div class="recap">' +
    '<div class="recap__poster">' + recapPoster(d) + '</div>' +
    '<div class="stack recap__side">' +
      recapShareBlock() +
      (d.genres.length ? '<section class="panel section">' + sectionHead(t('Top genres'), t('last 4 weeks')) +
        '<div class="section__body section__body--pad"><div class="dna-chips">' + d.genres.map(function (g, i) {
          return '<span class="dna-chip' + (i === 0 ? ' dna-chip--lead' : '') + '">' + esc(g.name) + '</span>';
        }).join('') + '</div></div></section>' : '') +
      (d.fresh && d.fresh.length ? '<section class="panel section">' + sectionHead(t('New arrivals'), t('not in your ~1-year top 50')) +
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
  return wrap(pageHead(t('Your last 4 weeks'), t('Recap')), spotifyGate() || recapBodyAuto());
};

/* Home: a link into the recap, with your current number one when it's loaded. */
function homeRecapPanel() {
  if (!spotify.auth.isConnected()) return '<div id="homeRecap" hidden></div>';
  const artists = libData('topArtists', 'short_term');
  const top = artists && artists[0];
  return '<a class="panel recap-teaser" href="#/recap" id="homeRecap">' +
    '<span class="recap-teaser__disc" aria-hidden="true"><span style="' + (top ? artImageStyle(top.image) : '') + '"></span></span>' +
    '<span class="recap-teaser__meta">' +
      '<span class="t-title-s">' + t('Your last 4 weeks, in one card') + '</span>' +
      '<span class="t-body-s c-secondary">' + (top ? t('{name} led the way.', { name: esc(top.name) }) + ' ' : '') + t('Save it or share it to your stories.') + '</span>' +
    '</span>' +
    '<span class="btn btn--secondary btn--sm">' + t('See your recap') + '</span>' +
  '</a>';
}

LIBRARY_PANELS.push(['recapBody', recapBodyAuto], ['homeRecap', homeRecapPanel]);

/* ---- PNG export ---------------------------------------------------------------- */
/* Block positions are fixed (in 1080-wide px) and mirrored by the .poster CSS
   (top ÷ 10.8 = cqw), so the preview and the PNG line up. */
function fitText(ctx, text, max) {
  let s = String(text);
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

/* Up to `max` wrapped lines; the last one is ellipsized if text remains. */
function clampLines(ctx, text, width, max) {
  const all = wrapText(ctx, text, width).map(function (l) { return fitText(ctx, l, width); });
  const lines = all.slice(0, max);
  if (all.length > max) lines[max - 1] = fitText(ctx, lines[max - 1] + '…', width);
  return lines;
}

function roundedPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Cover-fits an image into the current clip; a tinted fill stands in when it's missing. */
function drawFill(ctx, img, x, y, w, h, fallback) {
  ctx.fillStyle = fallback;
  ctx.fillRect(x, y, w, h);
  if (!img) return;
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
}

async function renderRecapImage() {
  const d = recapData();
  if (!d || !d.top || !d.tracks.length) return null;
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const song = d.tracks[0];
  const more = d.tracks.slice(1);
  const imgs = await Promise.all(
    [loadImage('assets/logo-256.png'), loadImage(song.image || song.thumb)]
      .concat(d.artists.map(function (a) { return loadImage(a.image); }), more.map(function (t) { return loadImage(t.thumb); })));
  const logo = imgs[0], cover = imgs[1], faces = imgs.slice(2, 2 + d.artists.length), minis = imgs.slice(2 + d.artists.length);

  const W = 1080, H = 1920, P = 88, inner = W - 2 * P;
  const INK = '#ECEAE4', INK2 = 'rgba(236,234,228,.68)', INK3 = 'rgba(236,234,228,.44)', LINE = 'rgba(236,234,228,.10)';
  const EMBER = signalColor(), TILE = hexAlpha(EMBER, .22);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#1A181D'); base.addColorStop(1, '#111013');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  [[960, 200, 720, hexAlpha(EMBER, .20)], [80, 1760, 760, 'rgba(63,191,168,.10)']].forEach(function (g) {
    const grad = ctx.createRadialGradient(g[0], g[1], 0, g[0], g[1], g[2]);
    grad.addColorStop(0, g[3]); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  });
  ctx.textBaseline = 'alphabetic';

  function kicker(text, y) {
    ctx.fillStyle = EMBER; ctx.font = '500 26px Geist, sans-serif';
    ctx.fillText(text, P, y);
  }

  // Header
  if (logo) ctx.drawImage(logo, P, 88, 50, 50);
  ctx.fillStyle = INK; ctx.font = '600 42px Geist, sans-serif';
  ctx.fillText('Vortex', P + (logo ? 66 : 0), 128);
  ctx.textAlign = 'right'; ctx.fillStyle = INK3; ctx.font = '400 26px "Geist Mono", monospace';
  ctx.fillText(recapRange(), W - P, 124);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK; ctx.font = '500 64px Geist, sans-serif';
  const firstName = (DATA.me.name || '').split(/\s+/)[0];
  ctx.fillText(fitText(ctx, firstName ? t('{name}’s last 4 weeks', { name: firstName }) : t('Your’s last 4 weeks'), inner), P, 262);

  // Most played song: the cover carries the card.
  kicker(t('Most played song'), 366);
  const cs = 360, cy = 398;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 48; ctx.shadowOffsetY = 18;
  roundedPath(ctx, P, cy, cs, cs, 28); ctx.fillStyle = TILE; ctx.fill();
  ctx.restore();
  ctx.save(); roundedPath(ctx, P, cy, cs, cs, 28); ctx.clip();
  drawFill(ctx, cover, P, cy, cs, cs, TILE);
  ctx.restore();
  const tx = P + cs + 44, tw = W - P - tx;
  let ty = cy + 54;
  ctx.fillStyle = INK; ctx.font = '600 52px Geist, sans-serif';
  clampLines(ctx, song.title, tw, 3).forEach(function (l) { ctx.fillText(l, tx, ty); ty += 62; });
  ty += 4;
  ctx.fillStyle = INK2; ctx.font = '400 32px Geist, sans-serif';
  clampLines(ctx, song.artist, tw, 2).forEach(function (l) { ctx.fillText(l, tx, ty); ty += 42; });
  if (song.album) {
    ctx.fillStyle = INK3; ctx.font = '400 26px Geist, sans-serif';
    ctx.fillText(fitText(ctx, song.album, tw), tx, ty + 6);
  }

  // Top artists: three portraits, ranked.
  kicker(t('Top artists'), 858);
  const colW = inner / 3, fr = 112, fy = 890 + fr;
  d.artists.forEach(function (a, i) {
    const cx = P + colW * i + colW / 2;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, fy, fr, 0, Math.PI * 2); ctx.clip();
    drawFill(ctx, faces[i], cx - fr, fy - fr, fr * 2, fr * 2, TILE);
    if (!faces[i]) {
      ctx.fillStyle = INK; ctx.font = '600 64px Geist, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(initialsFrom(a.name), cx, fy + 22); ctx.textAlign = 'left';
    }
    ctx.restore();
    const bx = cx - fr * 0.72, by = fy + fr * 0.72;
    ctx.beginPath(); ctx.arc(bx, by, 26, 0, Math.PI * 2); ctx.fillStyle = '#1A181D'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = i === 0 ? EMBER : LINE; ctx.stroke();
    ctx.fillStyle = INK; ctx.font = '500 26px "Geist Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), bx, by + 9);
    ctx.font = '600 30px Geist, sans-serif';
    clampLines(ctx, a.name, colW - 24, 2).forEach(function (l, li) { ctx.fillText(l, cx, fy + fr + 56 + li * 38); });
    ctx.textAlign = 'left';
  });

  // Also on repeat: the rest of the top four.
  if (more.length) {
    kicker(t('Also on repeat'), 1290);
    more.forEach(function (t, i) {
      const ry = 1318 + i * 100;
      ctx.save(); roundedPath(ctx, P, ry, 76, 76, 14); ctx.clip();
      drawFill(ctx, minis[i], P, ry, 76, 76, TILE);
      ctx.restore();
      ctx.fillStyle = INK; ctx.font = '600 32px Geist, sans-serif';
      ctx.fillText(fitText(ctx, t.title, inner - 100), P + 100, ry + 34);
      ctx.fillStyle = INK2; ctx.font = '400 26px Geist, sans-serif';
      ctx.fillText(fitText(ctx, t.artist, inner - 100), P + 100, ry + 70);
    });
  }

  // Stats and footer
  ctx.fillStyle = LINE; ctx.fillRect(P, 1644, inner, 2);
  recapStats(d).forEach(function (s, i) {
    const x = P + i * colW;
    ctx.fillStyle = INK; ctx.font = '500 60px "Geist Mono", monospace';
    ctx.fillText(s.n === null ? '–' : String(s.n), x, 1724);
    ctx.fillStyle = INK3; ctx.font = '400 24px Geist, sans-serif';
    ctx.fillText(fitText(ctx, s.label, colW - 20), x, 1764);
  });
  ctx.font = '500 26px Geist, sans-serif'; ctx.fillStyle = INK2;
  ctx.fillText(fitText(ctx, DATA.me.name, inner * 0.55), P, H - P);
  ctx.textAlign = 'right'; ctx.fillStyle = INK3;
  ctx.fillText(fitText(ctx, DATA.me.username, inner * 0.4), W - P, H - P);
  ctx.textAlign = 'left';

  return new Promise(function (resolve) { c.toBlob(resolve, 'image/png'); });
}
