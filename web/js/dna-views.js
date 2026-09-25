/* ==========================================================================
   vortex — music DNA views (Profile) and playlist insights (Music)
   ========================================================================== */

UI.dnaRange = 'medium_term';
UI.compatOpen = null;
UI.playlistOpen = null;
UI.playlistItems = {};
UI.savedPlaylist = {};   // range -> { status: 'saving' | 'ok' | 'error', url }

function dnaLoading(text) {
  return '<p class="t-body-s c-tertiary friends__hint">' + esc(text || 'Loading from Spotify…') + '</p>';
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function artistLink(a, inner) {
  return DNA_ID.test(a.id || '')
    ? '<a href="https://open.spotify.com/artist/' + a.id + '" target="_blank" rel="noopener">' + inner + '</a>'
    : inner;
}

function dnaMeter(ratio, cls) {
  return '<div class="' + cx('dna-meter', cls) + '"><i style="width:' + Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%"></i></div>';
}

function ringEl(score, small) {
  const s = small ? 44 : 72, r = small ? 18 : 31, sw = small ? 4 : 5;
  const c = 2 * Math.PI * r;
  return '<div class="' + cx('ring', small && 'ring--sm') + '" role="img" aria-label="' + score + ' out of 100">' +
    '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" aria-hidden="true">' +
      '<circle class="ring__track" cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" fill="none" stroke-width="' + sw + '"/>' +
      '<circle class="ring__fill" cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" fill="none" stroke-width="' + sw + '" ' +
        'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + (c * (1 - score / 100)).toFixed(2) + '"/>' +
    '</svg><span class="ring__label">' + score + '</span></div>';
}

/* ---- charts ----------------------------------------------------------------- */
/* Radar of genre shares. Radius is relative to the largest share on screen;
   the true percentage sits in every label and in the list under the chart. */
function radarSvg(axes, series) {
  const W = 440, H = 290, cxp = 220, cyp = 146, R = 92, n = axes.length;
  let max = 0.01;
  series.forEach(function (s) { axes.forEach(function (a) { max = Math.max(max, s.values[a] || 0); }); });
  function pt(i, r) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cxp + r * Math.cos(ang), cyp + r * Math.sin(ang)];
  }
  function poly(r) {
    return axes.map(function (_, i) { return pt(i, r).map(function (v) { return v.toFixed(1); }).join(','); }).join(' ');
  }
  let out = '<svg class="radar" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Genre fingerprint">';
  [0.25, 0.5, 0.75, 1].forEach(function (k) { out += '<polygon class="radar__ring" points="' + poly(R * k) + '"/>'; });
  axes.forEach(function (_, i) {
    const p = pt(i, R);
    out += '<line class="radar__spoke" x1="' + cxp + '" y1="' + cyp + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>';
  });
  series.forEach(function (s) {
    const pts = axes.map(function (a, i) { return pt(i, R * (s.values[a] || 0) / max); });
    out += '<polygon class="radar__shape" style="--c:' + s.color + '" points="' +
      pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
    pts.forEach(function (p, i) {
      out += '<circle class="radar__dot" style="--c:' + s.color + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4">' +
        '<title>' + esc(s.name + ' · ' + axes[i] + ': ' + pct(s.values[axes[i]] || 0) + '% of top artists') + '</title></circle>';
    });
  });
  axes.forEach(function (a, i) {
    const p = pt(i, R + 14);
    const anchor = p[0] < cxp - 6 ? 'end' : p[0] > cxp + 6 ? 'start' : 'middle';
    const dy = p[1] < cyp - R ? -2 : p[1] > cyp + R ? 10 : 4;
    out += '<text class="radar__label" x="' + p[0].toFixed(1) + '" y="' + (p[1] + dy).toFixed(1) + '" text-anchor="' + anchor + '">' +
      esc(trunc(a, 18)) + '<tspan class="radar__pct"> ' + pct(series[0].values[a] || 0) + '%</tspan><title>' + esc(a) + '</title></text>';
  });
  return out + '</svg>';
}

function slopeSvg(lines) {
  const W = 560, top = 38, rowH = 20, maxRank = 12;
  const lane = top + maxRank * rowH + 8, H = lane + 18;
  const xs = [190, 280, 370];
  const y = function (r) { return r && r <= maxRank ? top + (r - 1) * rowH : lane; };
  let out = '<svg class="slope" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="How your top artists moved">';
  ['~1 year', '6 months', '4 weeks'].forEach(function (h, i) {
    out += '<text class="slope__head" x="' + xs[i] + '" y="16" text-anchor="middle">' + h + '</text>' +
      '<line class="slope__guide" x1="' + xs[i] + '" y1="' + (top - 10) + '" x2="' + xs[i] + '" y2="' + (lane + 6) + '"/>';
  });
  out += '<text class="slope__lane" x="' + (xs[0] - 12) + '" y="' + (lane + 4) + '" text-anchor="end">not in top ' + maxRank + '</text>';
  lines.forEach(function (l) {
    const r = l.ranks;
    const d = (r[0] || 99) - (r[2] || 99);
    const trend = d >= 2 ? 'up' : d <= -2 ? 'down' : 'flat';
    const fmt = function (v) { return v ? '#' + v : 'not in top 50'; };
    out += '<g class="slope__line" data-trend="' + trend + '"><title>' +
      esc(l.artist.name + ': ' + fmt(r[0]) + ' (~1 year) → ' + fmt(r[1]) + ' (6 months) → ' + fmt(r[2]) + ' (4 weeks)') + '</title>' +
      '<polyline points="' + xs.map(function (x, i) { return x + ',' + y(r[i]); }).join(' ') + '"/>' +
      xs.map(function (x, i) { return '<circle cx="' + x + '" cy="' + y(r[i]) + '" r="4"/>'; }).join('');
    if (l.rightLabel) out += '<text x="' + (xs[2] + 12) + '" y="' + (y(r[2]) + 4) + '">#' + r[2] + ' ' + esc(trunc(l.artist.name, 22)) + '</text>';
    if (l.leftLabel && r[0]) out += '<text x="' + (xs[0] - 12) + '" y="' + (y(r[0]) + 4) + '" text-anchor="end">' + esc(trunc(l.artist.name, 22)) + ' #' + r[0] + '</text>';
    out += '</g>';
  });
  return out + '</svg>';
}

/* ---- badge emblem ------------------------------------------------------------ */
function emblem(result) {
  const tier = result.state === 'ok' ? result.tier : 0;
  return '<div class="emblem" data-tier="' + tier + '" aria-hidden="true">' +
    '<svg viewBox="0 0 48 52" width="48" height="52"><path class="emblem__hex" d="M24 2.5 44.5 14.2v23.6L24 49.5 3.5 37.8V14.2z"/>' +
    '<path class="emblem__inner" d="M24 8.2 39.6 17.1v17.8L24 43.8 8.4 34.9V17.1z"/></svg>' +
    '<span class="emblem__icon">' + icon(result.badge.icon, 18) + '</span>' +
    '<span class="emblem__pips">' + [1, 2, 3].map(function (i) { return '<i' + (i <= tier ? ' class="on"' : '') + '></i>'; }).join('') + '</span>' +
  '</div>';
}

function badgeTile(r) {
  const b = r.badge;
  let foot;
  if (r.state === 'loading') foot = '<span class="t-caption c-tertiary">Loading…</span>';
  else if (r.state === 'error') foot = '<span class="t-caption c-tertiary">Spotify didn\'t answer</span>';
  else {
    foot = dnaMeter(r.progress, r.tier === 3 && 'dna-meter--max') +
      '<span class="t-meta c-tertiary">' + (r.next === null ? 'Maxed out' : 'Tier ' + roman(r.tier + 1) + ' at ' + esc(b.unit(r.next))) + '</span>';
  }
  return '<div class="bdg" data-tier="' + (r.tier || 0) + '" data-state="' + r.state + '">' +
    emblem(r) +
    '<div class="bdg__meta">' +
      '<span class="bdg__name">' + esc(b.name) + (r.tier ? ' <em>' + roman(r.tier) + '</em>' : '') + '</span>' +
      '<span class="t-caption c-secondary bdg__detail">' + esc(r.state === 'ok' ? r.detail : b.tagline) + '</span>' +
      '<div class="bdg__foot">' + foot + '</div>' +
    '</div>' +
  '</div>';
}

function starsOf(results) {
  return results.reduce(function (s, r) { return s + (r.tier || 0); }, 0);
}

/* ---- Profile panels -------------------------------------------------------- */
function dnaCardPanel() {
  const results = dnaBadges();
  const arche = dnaArchetype(results);
  const stars = starsOf(results), max = BADGES.length * 3;
  const artists = libData('topArtists', 'medium_term');
  const genres = artists ? genreShares(artists).list.slice(0, 5) : [];
  const covers = (artists || []).slice(0, 3);
  const loading = !artists && !libFailed('topArtists', 'medium_term');

  return '<section class="panel dna-card" id="dnaCard">' +
    '<div class="dna-card__body">' +
      '<span class="t-overline c-accent">Music DNA · last 6 months</span>' +
      '<h2 class="dna-card__title">' + (loading ? 'Reading your taste…' : arche ? 'The ' + esc(arche.badge.name) : 'Still warming up') + '</h2>' +
      '<p class="t-body-l c-secondary dna-card__tag">' + (loading ? 'Pulling your top artists and recent plays from Spotify.' :
        arche ? esc(arche.badge.tagline) : 'Listen a little more and your badges will decide what you are.') + '</p>' +
      (genres.length ? '<div class="dna-chips">' + genres.map(function (g, i) {
        return '<span class="dna-chip' + (i === 0 ? ' dna-chip--lead' : '') + '">' + esc(g.name) + '</span>';
      }).join('') + '</div>' : '') +
      '<div class="dna-level">' +
        '<div class="dna-level__num"><span class="t-overline c-tertiary">Level</span><b>' + stars + '</b></div>' +
        '<div class="dna-level__bar">' + dnaMeter(stars / max) +
          '<span class="t-caption c-tertiary">' + stars + ' of ' + max + ' badge stars · every tier you unlock is one star</span></div>' +
      '</div>' +
      '<div class="dna-card__actions">' +
        '<button class="btn btn--secondary btn--sm" data-action="save-dna-image"' + (artists ? '' : ' disabled') + '>' + icon('download', 15) + 'Save as image</button>' +
      '</div>' +
    '</div>' +
    '<div class="dna-card__art" aria-hidden="true">' + covers.map(function (a, i) {
      return '<div class="dna-cover dna-cover--' + (i + 1) + '">' + art(artSeedFor(a.id), 'art--tile', a.image) + '</div>';
    }).join('') +
      (covers.length ? '<span class="dna-card__caption t-caption c-tertiary">' + covers.map(function (a) { return esc(a.name); }).join(' · ') + '</span>' : '') +
    '</div>' +
  '</section>';
}

function dnaBadgesPanel() {
  const results = dnaBadges();
  const stars = starsOf(results), max = BADGES.length * 3;
  const quest = dnaNextQuest(results);
  return '<section class="panel section" id="dnaBadges">' +
    sectionHead('Badges', stars + ' / ' + max + ' stars') +
    '<div class="section__body section__body--pad stack">' +
      (quest ? '<div class="quest">' +
        '<span class="quest__icon">' + icon('star', 16) + '</span>' +
        '<span class="t-body-s c-secondary quest__text">Closest unlock: <b class="c-primary">' + esc(quest.badge.name) + ' ' + roman(quest.tier + 1) + '</b> at ' +
          esc(quest.badge.unit(quest.next)) + '. You\'re at ' + esc(quest.badge.unit(quest.value)) + '.</span>' +
        dnaMeter(quest.progress, 'quest__meter') +
      '</div>' : '') +
      '<div class="bdg-grid">' + results.map(badgeTile).join('') + '</div>' +
      '<p class="t-caption c-tertiary">Badges read your Spotify top lists and your last 50 plays, so they move as you listen. Spotify\'s longest range covers about a year, not all time.</p>' +
    '</div>' +
  '</section>';
}

function dnaGenresPanel() {
  const range = UI.dnaRange;
  const artists = libData('topArtists', range);
  let body;
  if (!artists) body = libFailed('topArtists', range) ? ghostEmpty(null, 'Could not reach Spotify. Try again in a moment.') : dnaLoading();
  else {
    const g = genreShares(artists);
    if (g.list.length < 3) {
      body = ghostEmpty(null, g.tagged
        ? 'Spotify lists fewer than 3 genres for your top artists, not enough for a fingerprint.'
        : 'Spotify doesn\'t list genres for your top artists in this range.');
    } else {
      const axes = g.list.slice(0, 6).map(function (x) { return x.name; });
      const values = {};
      g.list.forEach(function (x) { values[x.name] = x.share; });
      body = '<div class="section__body--pad stack stack--sm">' +
        radarSvg(axes, [{ name: 'You', color: 'var(--accent-base)', values: values }]) +
        '<div class="genre-list">' + g.list.slice(0, 6).map(function (x, i) {
          return '<div class="genre-list__row"><span class="t-body-s' + (i === 0 ? ' c-primary' : ' c-secondary') + ' truncate">' + esc(x.name) + '</span>' +
            dnaMeter(x.share, i === 0 ? null : 'dna-meter--muted') + '<span class="t-num c-tertiary">' + pct(x.share) + '%</span></div>';
        }).join('') + '</div>' +
        '<p class="t-caption c-tertiary">Share of your top ' + g.tagged + ' artists tagged with each genre on Spotify. Artists can have several genres, so it adds up past 100%.' +
          (g.tagged < g.total ? ' ' + (g.total - g.tagged) + ' artists have no genre listed.' : '') + '</p>' +
      '</div>';
    }
  }
  return '<section class="panel section" id="dnaGenres">' +
    sectionHead('Genre fingerprint', null, tabsEl('dna-range', ['4 weeks', '6 months', '1 year'], RANGE_LABEL[range])) +
    '<div class="section__body">' + body + '</div></section>';
}

function artistChip(a, sub) {
  return artistLink(a, '<span class="achip">' + art(artSeedFor(a.id), 'art--sm art--round', a.image) +
    '<span class="achip__meta"><span class="t-label-s truncate">' + esc(a.name) + '</span>' +
    (sub ? '<span class="t-caption c-tertiary">' + esc(sub) + '</span>' : '') + '</span></span>');
}

function dnaEvolutionPanel() {
  const ev = dnaEvolution();
  const failed = libFailed('topArtists', 'short_term') || libFailed('topArtists', 'medium_term') || libFailed('topArtists', 'long_term');
  let body;
  if (!ev) body = failed ? ghostEmpty(null, 'Could not reach Spotify. Try again in a moment.') : dnaLoading();
  else if (ev.empty) body = ghostEmpty();
  else {
    const col = function (title, hint, list, cls, sub) {
      return '<div class="evo-col ' + cls + '"><span class="t-overline">' + title + '</span>' +
        '<span class="t-caption c-tertiary">' + hint + '</span>' +
        (list.length ? '<div class="evo-col__list">' + list.map(function (a) { return artistChip(a, sub(a)); }).join('') + '</div>'
          : '<span class="t-body-s c-tertiary">Nobody yet</span>') + '</div>';
    };
    const rs = rankMap(libData('topArtists', 'short_term')), rl = rankMap(libData('topArtists', 'long_term'));
    body = '<div class="section__body--pad stack">' +
      '<div class="slope-wrap">' + slopeSvg(ev.lines) + '</div>' +
      '<div class="legend slope-legend">' +
        '<div><em class="lg-up"></em><span class="t-body-s c-secondary">Climbing</span></div>' +
        '<div><em class="lg-flat"></em><span class="t-body-s c-secondary">Holding</span></div>' +
        '<div><em class="lg-down"></em><span class="t-body-s c-secondary">Cooling off</span></div>' +
      '</div>' +
      '<div class="evo-cols">' +
        col('New arrivals', 'In your 4-week top, not in your ~1-year top 50', ev.rising, 'evo-col--up', function (a) { return '#' + rs[a.id] + ' now'; }) +
        col('Constants', 'In your top 50 across all three ranges', ev.constants, 'evo-col--flat', function (a) { return '#' + rs[a.id] + ' now · #' + rl[a.id] + ' over a year'; }) +
        col('Cooling off', 'In your ~1-year top 20, gone from the last 4 weeks', ev.faded, 'evo-col--down', function (a) { return 'was #' + rl[a.id]; }) +
      '</div>' +
    '</div>';
  }
  return '<section class="panel section" id="dnaEvolution">' + sectionHead('How your taste moved', '~1 year → 4 weeks') +
    '<div class="section__body">' + body + '</div></section>';
}

function compatDetail(f, c) {
  const axes = [];
  c.mine.list.slice(0, 4).concat(c.theirs.list.slice(0, 4)).forEach(function (g) {
    if (axes.length < 6 && axes.indexOf(g.name) === -1) axes.push(g.name);
  });
  const vals = function (g) { const v = {}; g.list.forEach(function (x) { v[x.name] = x.share; }); return v; };
  const first = esc(f.name.split(/\s+/)[0]);
  const rows = [
    ['Genre similarity', c.genre === null ? null : c.genre, c.genre === null ? 'no genre data' : pct(c.genre) + '%'],
    ['Shared artists', c.artists.ratio, String(c.artists.n)],
    ['Shared tracks', c.tracks.ratio, String(c.tracks.n)]
  ];
  return '<div class="compat-detail">' +
    '<div class="compat-detail__bars">' + rows.map(function (r) {
      return '<div class="compat-bar"><span class="t-body-s c-secondary">' + r[0] + '</span>' +
        (r[1] === null ? '<span></span>' : dnaMeter(r[1])) + '<span class="t-num c-tertiary">' + esc(r[2]) + '</span></div>';
    }).join('') + '</div>' +
    (axes.length >= 3 ? '<div class="compat-detail__radar">' +
      radarSvg(axes, [
        { name: 'You', color: 'var(--accent-base)', values: vals(c.mine) },
        { name: f.name, color: 'var(--data-2)', values: vals(c.theirs) }
      ]) +
      '<div class="legend"><div><em style="background:var(--accent-base)"></em><span class="t-body-s c-secondary">You</span></div>' +
      '<div><em style="background:var(--data-2)"></em><span class="t-body-s c-secondary">' + esc(f.name) + '</span></div></div>' +
    '</div>' : '') +
    (c.sharedArtists.length ? '<div class="stack stack--sm"><span class="t-overline c-tertiary">You both love</span>' +
      '<div class="achips">' + c.sharedArtists.slice(0, 8).map(function (a) { return artistChip(a); }).join('') + '</div></div>' : '') +
    (c.sharedTracks.length ? '<div class="stack stack--sm"><span class="t-overline c-tertiary">Same songs on repeat</span>' +
      '<div class="achips">' + c.sharedTracks.slice(0, 4).map(function (t) {
        const href = spotifyTrackUrl(t.id);
        const inner = '<span class="achip">' + art(artSeedFor(t.id), 'art--sm', t.image) + '<span class="achip__meta"><span class="t-label-s truncate">' + esc(t.title) + '</span><span class="t-caption c-tertiary truncate">' + esc(t.artist) + '</span></span></span>';
        return href ? '<a href="' + href + '" target="_blank" rel="noopener">' + inner + '</a>' : inner;
      }).join('') + '</div></div>' : '') +
    (c.newToYou.length ? '<div class="stack stack--sm"><span class="t-overline c-tertiary">From ' + first + '\'s top 50, new to you</span>' +
      '<div class="achips">' + c.newToYou.map(function (a) { return artistChip(a, a.genres[0] || null); }).join('') + '</div></div>' : '') +
    '<p class="t-caption c-tertiary">How it\'s scored: 45% genre similarity, 40% shared artists, 15% shared tracks, from each person\'s top 50 over ~6 months. Shared counts rise on a curve, so a few matches already register.</p>' +
  '</div>';
}

function dnaCompatPanel() {
  let body;
  const mine = mySnapshot();
  if (!DATA.friends.length) body = ghostEmpty(findFriendsButton(false), 'Add friends to see how your tastes line up.');
  else if (!mine) body = dnaLoading();
  else {
    const rows = DATA.friends.map(function (f) {
      const t = DATA.tastes[f.id];
      return { f: f, c: t ? compatibility(mine, t) : null, has: !!t };
    }).sort(function (a, b) { return (b.c ? b.c.score : -1) - (a.c ? a.c.score : -1); });
    body = rows.map(function (r) {
      const open = UI.compatOpen === r.f.id && r.c;
      const sub = r.c ? r.c.label + ' · ' + plural(r.c.artists.n, 'shared artist')
        : r.has ? 'Not enough listening data yet' : 'No DNA yet. It appears once they open vortex with Spotify connected';
      return '<div class="compat-item' + (open ? ' compat-item--open' : '') + '">' +
        '<button class="compat-row" ' + (r.c ? 'data-compat-open="' + esc(r.f.id) + '" aria-expanded="' + !!open + '"' : 'disabled') + '>' +
          avatarEl(r.f.initials, '32') +
          '<span class="friend__meta"><span class="t-body-m-med truncate">' + esc(r.f.name) + '</span>' +
          '<span class="t-body-s c-tertiary truncate">' + esc(sub) + '</span></span>' +
          (r.c ? ringEl(r.c.score, true) + '<span class="compat-row__chev">' + icon('chevronDown', 16) + '</span>' : '') +
        '</button>' +
        (open ? compatDetail(r.f, r.c) : '') +
      '</div>';
    }).join('');
  }
  return '<section class="panel section" id="dnaCompat">' + sectionHead('Compatibility', DATA.friends.length ? 'with your friends' : null) +
    '<div class="section__body">' + body + '</div></section>';
}

function dnaCirclePanel() {
  let body;
  const haveTastes = DATA.friends.some(function (f) { return DATA.tastes[f.id]; });
  if (!DATA.friends.length || !haveTastes) {
    body = ghostEmpty(null, DATA.friends.length
      ? 'Once your friends open vortex with Spotify connected, artists from their top lists that you don\'t listen to show up here.'
      : 'Add friends and this fills with artists from their top lists that you don\'t listen to yet.');
  } else if (!libData('topArtists', 'medium_term')) {
    body = dnaLoading();
  } else {
    const recs = circleRecommendations();
    body = recs.length ? recs.map(function (r) {
      const names = r.friends.map(function (f) { return f.name.split(/\s+/)[0]; });
      const who = names.length === 1 ? names[0] + '\'s' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + '\'s';
      const inner = art(artSeedFor(r.artist.id), 'art--round', r.artist.image) +
        '<span class="row__meta"><span class="t-body-m-med truncate">' + esc(r.artist.name) + '</span>' +
        '<span class="t-body-s c-tertiary truncate">In ' + esc(who) + ' top 50' + (r.artist.genres[0] ? ' · ' + esc(r.artist.genres[0]) : '') + '</span></span>' +
        (r.friends.length > 1 ? '<span class="badge badge--accent">' + r.friends.length + ' friends</span>' : '');
      return DNA_ID.test(r.artist.id)
        ? '<a class="row" href="https://open.spotify.com/artist/' + r.artist.id + '" target="_blank" rel="noopener">' + inner + '</a>'
        : '<div class="row">' + inner + '</div>';
    }).join('') : ghostEmpty(null, 'You already listen to every artist in your friends\' top lists.');
  }
  return '<section class="panel section" id="dnaCircle">' + sectionHead('Heard in your circle', 'not in your top lists') +
    '<div class="section__body">' + body + '</div></section>';
}

function dnaSection() {
  const gate = spotifyGate();
  if (gate) return gate;
  return dnaCardPanel() + dnaBadgesPanel() +
    '<div class="cols cols--half">' + dnaGenresPanel() + dnaEvolutionPanel() + '</div>' +
    '<div class="cols cols--half">' + dnaCompatPanel() + dnaCirclePanel() + '</div>';
}

/* ---- Music: playlists and top tracks --------------------------------------- */
function playlistTag(p) {
  if (p.owned) return '<span class="pl-tag pl-tag--own">Yours</span>';
  if (p.collaborative) return '<span class="pl-tag">Collab</span>';
  return '<span class="pl-tag pl-tag--muted">Following</span>';
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
}

function playlistDetail(p) {
  const entry = UI.playlistItems[p.id];
  const openLink = p.url && /^https:\/\/open\.spotify\.com\//.test(p.url)
    ? '<a class="btn btn--ghost btn--sm" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + icon('arrowUpRight', 15) + 'Open in Spotify</a>' : '';
  let body;
  if (!entry || entry.status === 'loading') body = dnaLoading('Reading tracks from Spotify…');
  else if (entry.status === 'error') {
    body = ghostEmpty(null, entry.error === 403
      ? 'Spotify didn\'t let vortex read this playlist\'s tracks. It still opens in Spotify.'
      : 'Could not reach Spotify. Try again in a moment.');
  } else if (!entry.data.tracks.length) body = ghostEmpty(null, 'No Spotify tracks in this playlist yet.');
  else {
    const s = playlistStats(entry.data);
    const fmtDate = function (d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
    const maxN = s.topArtists.length ? s.topArtists[0].n : 1;
    body = '<div class="pl-detail__grid">' +
      '<div class="stack">' +
        '<div class="cols cols--thirds pl-stats">' +
          statTile('Length', fmtDuration(s.duration)) +
          statTile('Artists', String(s.artists)) +
          statTile('Last added', fmtDate(s.last)) +
        '</div>' +
        '<div class="stack stack--sm"><span class="t-overline c-tertiary">Most featured</span>' +
          s.topArtists.map(function (a, i) {
            return '<div class="genre-list__row"><span class="t-body-s ' + (i === 0 ? 'c-primary' : 'c-secondary') + ' truncate">' + esc(a.name) + '</span>' +
              dnaMeter(a.n / maxN, i === 0 ? null : 'dna-meter--muted') + '<span class="t-num c-tertiary">' + a.n + '</span></div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="stack">' +
        (s.match !== null ? '<div class="compat">' + ringEl(pct(s.match)) +
          '<div class="stack stack--sm" style="gap:4px"><span class="t-body-m-med">Taste match</span>' +
          '<span class="t-body-s c-tertiary">' + pct(s.match) + '% of these tracks are by artists in your 6-month top 50.</span></div></div>' : '') +
        (s.friends.length ? '<div class="stack stack--sm"><span class="t-overline c-tertiary">Friends who\'d get it</span>' +
          s.friends.map(function (x) {
            return '<div class="rowflex">' + avatarEl(x.friend.initials, '24') +
              '<span class="t-body-s c-secondary">' + esc(x.friend.name) + ' has ' + plural(x.n, 'of these artists', 'of these artists') + ' in their top 50</span></div>';
          }).join('') + '</div>' : '') +
      '</div>' +
    '</div>' +
    '<p class="t-caption c-tertiary">' + (s.analyzed < s.total ? 'Based on the first ' + s.analyzed + ' of ' + s.total + ' tracks. ' : '') +
      'Spotify no longer shares mood or energy data with new apps, so this sticks to what the tracks actually are.</p>';
  }
  return '<div class="pl-detail" id="musPlaylistDetail">' +
    '<div class="pl-detail__head">' + art(artSeedFor(p.id), 'art--lg', p.image) +
      '<span class="post__meta"><span class="t-title-s truncate">' + esc(p.name) + '</span>' +
      '<span class="t-body-s c-tertiary">' + countLabel(p.count, 'track') + ' · ' + (p.owned ? 'your playlist' : 'collaborative') + '</span></span>' +
      openLink + '<button class="iconbtn" data-playlist-close aria-label="Close playlist details">' + icon('close', 16) + '</button>' +
    '</div>' + body +
  '</div>';
}

function topTracksSaveBar(range, tracks) {
  const saved = UI.savedPlaylist[range];
  const label = 'your top ' + tracks.length + ' tracks · ' + RANGE_LABEL[range].toLowerCase();
  let control;
  if (saved && saved.status === 'ok') {
    control = saved.url && /^https:\/\/open\.spotify\.com\//.test(saved.url)
      ? '<a class="btn btn--secondary btn--sm" href="' + esc(saved.url) + '" target="_blank" rel="noopener">' + icon('check', 15) + 'Saved · open it</a>'
      : '<span class="badge badge--positive"><span>' + icon('check', 13) + '</span>Saved to Spotify</span>';
  } else if (saved && saved.status === 'saving') {
    control = '<button class="btn btn--secondary btn--sm" disabled>Saving…</button>';
  } else if (!spotify.auth.hasScope('playlist-modify-private')) {
    control = '<button class="btn btn--secondary btn--sm" data-action="spotify-connect" data-tip="Spotify asks once for permission to create playlists">' + icon('spotify', 15) + 'Allow saving playlists</button>';
  } else {
    control = '<button class="btn btn--secondary btn--sm" data-action="save-top-playlist">' + icon('plus', 15) + 'Save as playlist</button>';
  }
  return '<div class="save-bar"><span class="t-body-s c-tertiary">Turn ' + esc(label) + ' into a private Spotify playlist.</span>' + control + '</div>';
}

LIBRARY_PANELS.push(
  ['dnaCard', dnaCardPanel],
  ['dnaBadges', dnaBadgesPanel],
  ['dnaGenres', dnaGenresPanel],
  ['dnaEvolution', dnaEvolutionPanel],
  ['dnaCompat', dnaCompatPanel],
  ['dnaCircle', dnaCirclePanel]
);

/* ---- shareable image --------------------------------------------------------- */
function loadImage(url) {
  return new Promise(function (resolve) {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () { resolve(img); };
    img.onerror = function () { resolve(null); };
    img.src = url;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  words.forEach(function (w) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

/* 1080×1350 portrait card, drawn directly on a canvas (no libraries). */
async function renderDnaImage() {
  const artists = libData('topArtists', 'medium_term') || [];
  const results = dnaBadges();
  const arche = dnaArchetype(results);
  const stars = starsOf(results), max = BADGES.length * 3;
  const genres = genreShares(artists).list.slice(0, 4);
  const top = artists.slice(0, 3);
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const imgs = await Promise.all(top.map(function (a) { return loadImage(a.image); }));

  const W = 1080, H = 1350, P = 84;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0B0B0D';
  ctx.fillRect(0, 0, W, H);
  [[900, 180, 520, 'rgba(255,92,53,.30)'], [120, 1180, 560, 'rgba(63,191,168,.18)']].forEach(function (g) {
    const grad = ctx.createRadialGradient(g[0], g[1], 0, g[0], g[1], g[2]);
    grad.addColorStop(0, g[3]); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  });

  ctx.fillStyle = '#F2F1EE';
  ctx.font = '600 44px Geist, sans-serif';
  ctx.fillText('vortex', P, P + 34);
  ctx.fillStyle = '#FF5C35';
  ctx.font = '500 26px "Geist Mono", monospace';
  ctx.fillText('MUSIC DNA · LAST 6 MONTHS', P, P + 92);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(242,241,238,.40)';
  ctx.font = '400 24px Geist, sans-serif';
  ctx.fillText('Data from Spotify', W - P, P + 30);
  ctx.textAlign = 'left';

  // Fanned covers
  const size = 330;
  const spots = [{ x: 610, y: 190, r: -0.07 }, { x: 700, y: 300, r: 0.08 }, { x: 560, y: 380, r: -0.02 }];
  imgs.slice().reverse().forEach(function (img, ri) {
    const i = imgs.length - 1 - ri;
    const s = spots[i];
    ctx.save();
    ctx.translate(s.x + size / 2, s.y + size / 2);
    ctx.rotate(s.r);
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    roundRect(ctx, -size / 2, -size / 2, size, size, 28);
    ctx.fillStyle = '#26262A'; ctx.fill();
    ctx.shadowColor = 'transparent';
    if (img) { ctx.clip(); ctx.drawImage(img, -size / 2, -size / 2, size, size); }
    ctx.restore();
  });

  // Archetype
  let y = 790;
  ctx.fillStyle = '#F2F1EE';
  ctx.font = '600 92px Geist, sans-serif';
  wrapText(ctx, arche ? 'The ' + arche.badge.name : 'Still warming up', W - 2 * P).forEach(function (l) { ctx.fillText(l, P, y); y += 100; });
  ctx.fillStyle = 'rgba(242,241,238,.64)';
  ctx.font = '400 36px Geist, sans-serif';
  wrapText(ctx, arche ? arche.badge.tagline : 'Listening data is still coming in.', W - 2 * P).slice(0, 2).forEach(function (l) { ctx.fillText(l, P, y); y += 48; });

  // Genre chips
  y += 30;
  let x = P;
  ctx.font = '500 28px Geist, sans-serif';
  genres.forEach(function (g, i) {
    const w = ctx.measureText(g.name).width + 44;
    if (x + w > W - P) return;
    roundRect(ctx, x, y, w, 56, 28);
    ctx.fillStyle = i === 0 ? 'rgba(255,92,53,.18)' : 'rgba(255,255,255,.07)';
    ctx.fill();
    ctx.fillStyle = i === 0 ? '#FF7A54' : 'rgba(242,241,238,.8)';
    ctx.fillText(g.name, x + 22, y + 38);
    x += w + 14;
  });

  // Level bar and footer
  const fy = H - P - 60;
  ctx.fillStyle = 'rgba(242,241,238,.40)';
  ctx.font = '500 24px "Geist Mono", monospace';
  ctx.fillText('LEVEL', P, fy - 70);
  ctx.fillStyle = '#F2F1EE';
  ctx.font = '600 64px "Geist Mono", monospace';
  ctx.fillText(String(stars), P, fy - 4);
  const bx = P + 150, bw = W - P - bx;
  roundRect(ctx, bx, fy - 34, bw, 14, 7); ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fill();
  roundRect(ctx, bx, fy - 34, Math.max(14, bw * stars / max), 14, 7); ctx.fillStyle = '#FF5C35'; ctx.fill();
  ctx.fillStyle = 'rgba(242,241,238,.40)';
  ctx.font = '400 24px Geist, sans-serif';
  ctx.fillText(stars + ' of ' + max + ' badge stars', bx, fy + 8);
  ctx.fillStyle = 'rgba(242,241,238,.64)';
  ctx.font = '500 28px Geist, sans-serif';
  const who = DATA.me.name + '  ' + DATA.me.username;
  ctx.fillText(who, P, H - P + 6);
  const room = W - 2 * P - ctx.measureText(who).width - 40;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(242,241,238,.40)';
  ctx.font = '400 24px Geist, sans-serif';
  let names = top.map(function (a) { return a.name; }).join(' · ');
  while (names.length > 4 && ctx.measureText(names).width > room) names = names.slice(0, -2).trimEnd() + '…';
  if (room > 60) ctx.fillText(names, W - P, H - P + 6);
  ctx.textAlign = 'left';

  return new Promise(function (resolve) { c.toBlob(resolve, 'image/png'); });
}
