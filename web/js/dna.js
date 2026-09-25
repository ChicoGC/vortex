/* ==========================================================================
   vortex — music DNA
   Badges, taste evolution, compatibility and playlist stats, computed from
   Spotify data already loaded (UI.spotifyLib) and friends' snapshots
   (DATA.tastes). Nothing is estimated: every number traces back to a Spotify
   response. Spotify no longer gives new apps audio features (mood, energy),
   popularity or recommendations, so none of those appear here.
   ========================================================================== */

const DNA_COVER = /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/;
const DNA_ID = /^[A-Za-z0-9]{22}$/;

function dnaCover(url) { return typeof url === 'string' && DNA_COVER.test(url) ? url : null; }
function libData(key, range) {
  const e = range ? UI.spotifyLib[key][range] : UI.spotifyLib[key];
  return e && e.data ? e.data : null;
}
function libFailed(key, range) {
  const e = range ? UI.spotifyLib[key][range] : UI.spotifyLib[key];
  return !!(e && e.status === 'error' && !e.data);
}
function pct(x) { return Math.round(x * 100); }
function roman(n) { return ['', 'I', 'II', 'III'][n] || ''; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* ---- snapshots ------------------------------------------------------------ */
/* What gets published for friends: ~6-month top 50 artists and tracks. */
function buildSnapshot(artists, tracks) {
  return {
    artists: artists.slice(0, 50).filter(function (a) { return DNA_ID.test(a.id || ''); }).map(function (a) {
      return {
        id: a.id,
        name: String(a.name || '').slice(0, 200),
        image: dnaCover(a.image),
        genres: (a.genres || []).slice(0, 4).map(function (g) { return String(g).slice(0, 60); })
      };
    }),
    tracks: tracks.slice(0, 50).filter(function (t) { return DNA_ID.test(t.id || ''); }).map(function (t) {
      return {
        id: t.id,
        title: String(t.title || '').slice(0, 200),
        artist: String(t.artist || '').slice(0, 200),
        image: dnaCover(t.thumb),
        artistIds: (t.artistIds || []).filter(function (id) { return DNA_ID.test(id); }).slice(0, 4)
      };
    })
  };
}

/* Friends' rows are written by other people's browsers: re-validate every
   field before it reaches the page. */
function sanitizeSnapshot(row) {
  const str = function (v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; };
  const arr = function (v) { return Array.isArray(v) ? v : []; };
  return {
    userId: row.user_id,
    updatedAt: row.updated_at,
    artists: arr(row.artists).filter(function (a) { return a && DNA_ID.test(a.id || ''); }).slice(0, 50).map(function (a) {
      return {
        id: a.id, name: str(a.name, 200), image: dnaCover(a.image),
        genres: arr(a.genres).filter(function (g) { return typeof g === 'string'; }).slice(0, 4).map(function (g) { return g.slice(0, 60); })
      };
    }),
    tracks: arr(row.tracks).filter(function (t) { return t && DNA_ID.test(t.id || ''); }).slice(0, 50).map(function (t) {
      return {
        id: t.id, title: str(t.title, 200), artist: str(t.artist, 200), image: dnaCover(t.image),
        artistIds: arr(t.artistIds).filter(function (id) { return DNA_ID.test(id || ''); }).slice(0, 4)
      };
    })
  };
}

function mySnapshot() {
  const artists = libData('topArtists', 'medium_term');
  const tracks = libData('topTracks', 'medium_term');
  return artists && tracks ? buildSnapshot(artists, tracks) : null;
}

/* ---- genres --------------------------------------------------------------- */
/* Share of artists (that have any genre on Spotify) tagged with each genre.
   An artist can carry several genres, so shares add up past 100%. */
function genreShares(artists) {
  const counts = {};
  let tagged = 0;
  artists.forEach(function (a) {
    if (!a.genres || !a.genres.length) return;
    tagged++;
    a.genres.forEach(function (g) { counts[g] = (counts[g] || 0) + 1; });
  });
  const list = Object.keys(counts).map(function (g) { return { name: g, n: counts[g], share: counts[g] / tagged }; })
    .sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  return { tagged: tagged, total: artists.length, list: list };
}

/* ---- badges --------------------------------------------------------------- */
function countIn(list, pred) { return list.reduce(function (n, x) { return n + (pred(x) ? 1 : 0); }, 0); }
function idSet(list, n) {
  const s = {};
  list.slice(0, n || list.length).forEach(function (x) { s[x.id] = true; });
  return s;
}

/* compute() returns undefined while its data is loading, null when Spotify
   failed, or { value, detail }. Thresholds are the tiers I / II / III. */
const BADGES = [
  {
    id: 'genre-hopper', name: 'Genre Hopper', icon: 'shuffle', tiers: [8, 16, 28],
    tagline: 'No single scene holds you for long.',
    unit: function (v) { return plural(v, 'genre'); },
    compute: function () {
      const a = libData('topArtists', 'medium_term');
      if (!a) return libFailed('topArtists', 'medium_term') ? null : undefined;
      const n = genreShares(a).list.length;
      return { value: n, detail: plural(n, 'genre') + ' across your top ' + a.length + ' artists (6 months)' };
    }
  },
  {
    id: 'loyalist', name: 'Loyalist', icon: 'heart', tiers: [25, 45, 65],
    tagline: 'Your favourites from a year ago are still in your top artists this month.',
    unit: function (v) { return v + '%'; },
    compute: function () {
      const long = libData('topArtists', 'long_term'), short = libData('topArtists', 'short_term');
      if (!long || !short) return libFailed('topArtists', 'long_term') || libFailed('topArtists', 'short_term') ? null : undefined;
      const base = long.slice(0, 20);
      if (!base.length) return { value: 0, detail: 'Not enough listening yet' };
      const now = idSet(short);
      const kept = countIn(base, function (a) { return now[a.id]; });
      const v = pct(kept / base.length);
      return { value: v, detail: kept + ' of your ~1-year top ' + base.length + ' artists are still in your last 4 weeks' };
    }
  },
  {
    id: 'explorer', name: 'Explorer', icon: 'compass', tiers: [5, 12, 20],
    tagline: 'Your last month is full of artists that weren\'t in your year\'s top 50.',
    unit: function (v) { return plural(v, 'new artist'); },
    compute: function () {
      const long = libData('topArtists', 'long_term'), short = libData('topArtists', 'short_term');
      if (!long || !short) return libFailed('topArtists', 'long_term') || libFailed('topArtists', 'short_term') ? null : undefined;
      const year = idSet(long);
      const n = countIn(short, function (a) { return !year[a.id]; });
      return { value: n, detail: n + ' artists in your 4-week top ' + short.length + ' aren\'t in your ~1-year top ' + long.length };
    }
  },
  {
    id: 'on-repeat', name: 'On Repeat', icon: 'repeat', tiers: [3, 5, 8],
    tagline: 'When a song hits, you play it until it doesn\'t.',
    unit: function (v) { return plural(v, 'play'); },
    compute: function () {
      const r = libData('recent');
      if (!r) return libFailed('recent') ? null : undefined;
      const counts = {};
      let best = null;
      r.forEach(function (t) {
        counts[t.id] = (counts[t.id] || 0) + 1;
        if (!best || counts[t.id] > counts[best.id]) best = t;
      });
      const n = best ? counts[best.id] : 0;
      return { value: n, detail: best ? '“' + best.title + '” played ' + plural(n, 'time') + ' in your last ' + r.length + ' plays' : 'No recent plays' };
    }
  },
  {
    id: 'night-owl', name: 'Night Owl', icon: 'moon', tiers: [5, 15, 30],
    tagline: 'A big share of your listening happens after midnight.',
    unit: function (v) { return plural(v, 'late play'); },
    compute: function () {
      const r = libData('recent');
      if (!r) return libFailed('recent') ? null : undefined;
      const n = countIn(r, function (t) { return new Date(t.playedAt).getHours() < 5; });
      return { value: n, detail: n + ' of your last ' + r.length + ' plays were between midnight and 5 am' };
    }
  },
  {
    id: 'early-bird', name: 'Early Bird', icon: 'sun', tiers: [5, 15, 30],
    tagline: 'You start the day with music.',
    unit: function (v) { return plural(v, 'morning play'); },
    compute: function () {
      const r = libData('recent');
      if (!r) return libFailed('recent') ? null : undefined;
      const n = countIn(r, function (t) { const h = new Date(t.playedAt).getHours(); return h >= 5 && h < 9; });
      return { value: n, detail: n + ' of your last ' + r.length + ' plays were between 5 and 9 am' };
    }
  },
  {
    id: 'album-purist', name: 'Album Purist', icon: 'layers', tiers: [4, 7, 10],
    tagline: 'You play records front to back, not just the singles.',
    unit: function (v) { return plural(v, 'track') + ' in a row'; },
    compute: function () {
      const r = libData('recent');
      if (!r) return libFailed('recent') ? null : undefined;
      let best = 0, run = 0, album = null, bestAlbum = '';
      r.slice().reverse().forEach(function (t) {
        const key = (t.album || '') + '|' + (t.artist || '').split(', ')[0];
        run = t.album && key === album ? run + 1 : 1;
        album = key;
        if (run > best) { best = run; bestAlbum = t.album; }
      });
      return { value: best, detail: best > 1 ? best + ' tracks in a row from “' + bestAlbum + '”' : 'No album runs in your last plays' };
    }
  },
  {
    id: 'superfan', name: 'Superfan', icon: 'crown', tiers: [10, 20, 35],
    tagline: 'One artist takes up a big slice of your top tracks.',
    unit: function (v) { return v + '%'; },
    compute: function () {
      const a = libData('topArtists', 'medium_term'), t = libData('topTracks', 'medium_term');
      if (!a || !t) return libFailed('topArtists', 'medium_term') || libFailed('topTracks', 'medium_term') ? null : undefined;
      if (!a.length || !t.length) return { value: 0, detail: 'Not enough listening yet' };
      const top = a[0];
      const n = countIn(t, function (x) { return (x.artistIds || []).indexOf(top.id) > -1; });
      const v = pct(n / t.length);
      return { value: v, detail: top.name + ' is on ' + n + ' of your top ' + t.length + ' tracks (6 months)' };
    }
  },
  {
    id: 'curator', name: 'Curator', icon: 'disc', tiers: [3, 10, 25],
    tagline: 'You build playlists, not just play them.',
    unit: function (v) { return plural(v, 'playlist'); },
    compute: function () {
      const p = libData('playlists');
      if (!p) return libFailed('playlists') ? null : undefined;
      const n = countIn(p, function (x) { return x.owned; });
      return { value: n, detail: 'You own ' + plural(n, 'playlist') + (p.length >= 50 ? ' (first 50 checked)' : '') };
    }
  },
  {
    id: 'tastemaker', name: 'Tastemaker', icon: 'broadcast', tiers: [1, 10, 30], social: true,
    tagline: 'You put tracks in front of your friends.',
    unit: function (v) { return plural(v, 'share'); },
    compute: function () {
      const s = DATA.me.stats;
      if (!s) return undefined;
      return { value: s.posts, detail: plural(s.posts, 'track') + ' shared on vortex' };
    }
  },
  {
    id: 'connector', name: 'Connector', icon: 'users', tiers: [1, 5, 15], social: true,
    tagline: 'Your circle keeps growing.',
    unit: function (v) { return plural(v, 'friend'); },
    compute: function () {
      return { value: DATA.friends.length, detail: plural(DATA.friends.length, 'friend') + ' on vortex' };
    }
  }
];

function evaluateBadge(b) {
  const r = b.compute();
  if (r === undefined) return { badge: b, state: 'loading', tier: 0 };
  if (r === null) return { badge: b, state: 'error', tier: 0 };
  const tier = countIn(b.tiers, function (t) { return r.value >= t; });
  const next = b.tiers[tier];
  const prev = tier ? b.tiers[tier - 1] : 0;
  return {
    badge: b, state: 'ok', value: r.value, detail: r.detail, tier: tier,
    next: next === undefined ? null : next,
    progress: next === undefined ? 1 : Math.max(0, Math.min(1, (r.value - prev) / (next - prev)))
  };
}

function dnaBadges() { return BADGES.map(evaluateBadge); }

/* Headline archetype: the listening badge you've pushed furthest. */
function dnaArchetype(results) {
  const ranked = results.filter(function (r) { return r.state === 'ok' && !r.badge.social && r.tier > 0; })
    .sort(function (a, b) { return (b.tier + b.progress) - (a.tier + a.progress); });
  return ranked[0] || null;
}

/* The unlock you're closest to. */
function dnaNextQuest(results) {
  return results.filter(function (r) { return r.state === 'ok' && r.next !== null; })
    .sort(function (a, b) { return b.progress - a.progress; })[0] || null;
}

/* ---- evolution ------------------------------------------------------------ */
function rankMap(list) {
  const m = {};
  list.forEach(function (a, i) { m[a.id] = i + 1; });
  return m;
}

function dnaEvolution() {
  const s = libData('topArtists', 'short_term'), m = libData('topArtists', 'medium_term'), l = libData('topArtists', 'long_term');
  if (!s || !m || !l) return null;
  const rs = rankMap(s), rm = rankMap(m), rl = rankMap(l);
  const byId = {};
  [l, m, s].forEach(function (list) { list.forEach(function (a) { byId[a.id] = a; }); });
  const rising = s.filter(function (a) { return !rl[a.id]; }).slice(0, 6);
  const faded = l.slice(0, 20).filter(function (a) { return !rs[a.id]; }).slice(0, 6);
  const constants = s.filter(function (a) { return rm[a.id] && rl[a.id]; })
    .sort(function (a, b) { return (rs[a.id] + rm[a.id] + rl[a.id]) - (rs[b.id] + rm[b.id] + rl[b.id]); }).slice(0, 6);
  const pick = s.slice(0, 6).map(function (a) { return a.id; });
  l.slice(0, 6).forEach(function (a) { if (pick.indexOf(a.id) === -1) pick.push(a.id); });
  const lines = pick.map(function (id) {
    return { artist: byId[id], ranks: [rl[id] || null, rm[id] || null, rs[id] || null], rightLabel: rs[id] <= 6, leftLabel: !(rs[id] <= 6) };
  });
  return { rising: rising, faded: faded, constants: constants, lines: lines, empty: !s.length && !l.length };
}

/* ---- compatibility -------------------------------------------------------- */
function overlapCoefficient(a, b) {
  if (!a.length || !b.length) return { n: 0, ratio: 0 };
  const set = idSet(a);
  const n = countIn(b, function (x) { return set[x.id]; });
  return { n: n, ratio: n / Math.min(a.length, b.length) };
}

function genreVector(artists) {
  const v = {};
  artists.forEach(function (a) { (a.genres || []).forEach(function (g) { v[g] = (v[g] || 0) + 1; }); });
  return v;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  Object.keys(a).forEach(function (k) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; });
  Object.keys(b).forEach(function (k) { nb += b[k] * b[k]; });
  return na && nb ? dot / Math.sqrt(na * nb) : null;
}

const COMPAT_TIERS = [[75, 'Musical twins'], [50, 'Strong overlap'], [25, 'Common ground'], [0, 'Different worlds']];

/* Score out of 100 from each person's ~6-month top 50: 45% genre similarity,
   40% shared artists, 15% shared tracks. Shared counts go through a square
   root so a handful of matches already registers. Without genres on either
   side, artists and tracks carry the whole score. */
function compatibility(mine, theirs) {
  if (!mine || !theirs || mine.artists.length < 5 || theirs.artists.length < 5) return null;
  const artists = overlapCoefficient(mine.artists, theirs.artists);
  const tracks = overlapCoefficient(mine.tracks, theirs.tracks);
  const genre = cosine(genreVector(mine.artists), genreVector(theirs.artists));
  const w = genre === null ? { g: 0, a: 0.4 / 0.55, t: 0.15 / 0.55 } : { g: 0.45, a: 0.4, t: 0.15 };
  const score = Math.round(100 * (w.g * (genre || 0) + w.a * Math.sqrt(artists.ratio) + w.t * Math.sqrt(tracks.ratio)));
  const label = COMPAT_TIERS.filter(function (t) { return score >= t[0]; })[0][1];

  const theirRank = rankMap(theirs.artists), myRank = rankMap(mine.artists);
  const sharedArtists = mine.artists.filter(function (a) { return theirRank[a.id]; })
    .sort(function (a, b) { return (myRank[a.id] + theirRank[a.id]) - (myRank[b.id] + theirRank[b.id]); });
  const theirTracks = idSet(theirs.tracks);
  const sharedTracks = mine.tracks.filter(function (t) { return theirTracks[t.id]; });

  const ga = genreShares(mine.artists), gb = genreShares(theirs.artists);
  const gbMap = {};
  gb.list.forEach(function (g) { gbMap[g.name] = g.share; });
  const sharedGenres = ga.list.filter(function (g) { return gbMap[g.name]; })
    .map(function (g) { return { name: g.name, score: Math.min(g.share, gbMap[g.name]) }; })
    .sort(function (a, b) { return b.score - a.score; }).slice(0, 6);

  const known = myArtistUniverse();
  const newToYou = theirs.artists.filter(function (a) { return !known[a.id]; }).slice(0, 5);

  return {
    score: score, label: label,
    genre: genre, artists: artists, tracks: tracks,
    sharedArtists: sharedArtists, sharedTracks: sharedTracks, sharedGenres: sharedGenres,
    newToYou: newToYou, mine: ga, theirs: gb
  };
}

/* Every artist in any of your loaded top lists, so "new to you" really is. */
function myArtistUniverse() {
  const known = {};
  ['short_term', 'medium_term', 'long_term'].forEach(function (r) {
    (libData('topArtists', r) || []).forEach(function (a) { known[a.id] = true; });
  });
  return known;
}

/* Artists in friends' top 50s that aren't in any of yours, most shared first. */
function circleRecommendations() {
  const known = myArtistUniverse();
  const pool = {};
  DATA.friends.forEach(function (f) {
    const t = DATA.tastes[f.id];
    if (!t) return;
    t.artists.forEach(function (a, i) {
      if (known[a.id]) return;
      const p = pool[a.id] || (pool[a.id] = { artist: a, friends: [], score: 0 });
      p.friends.push(f);
      p.score += (51 - (i + 1)) / 50;
    });
  });
  return Object.keys(pool).map(function (k) { return pool[k]; })
    .sort(function (a, b) { return b.friends.length - a.friends.length || b.score - a.score; }).slice(0, 8);
}

/* ---- playlists ------------------------------------------------------------ */
function playlistStats(result) {
  const tracks = result.tracks;
  const artistCount = {}, names = {};
  let duration = 0, first = null, last = null;
  tracks.forEach(function (t) {
    duration += t.durationMs || 0;
    (t.artistIds || []).forEach(function (id, i) {
      artistCount[id] = (artistCount[id] || 0) + 1;
      names[id] = (t.artistNames || [])[i] || names[id] || '';
    });
    if (t.addedAt) {
      if (!first || t.addedAt < first) first = t.addedAt;
      if (!last || t.addedAt > last) last = t.addedAt;
    }
  });
  const ids = Object.keys(artistCount);
  const topArtists = ids.map(function (id) { return { id: id, name: names[id], n: artistCount[id] }; })
    .sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); }).slice(0, 5);

  const mine = libData('topArtists', 'medium_term');
  const mineSet = mine ? idSet(mine) : null;
  const match = mineSet && tracks.length
    ? countIn(tracks, function (t) { return (t.artistIds || []).some(function (id) { return mineSet[id]; }); }) / tracks.length
    : null;

  const friends = DATA.friends.map(function (f) {
    const t = DATA.tastes[f.id];
    if (!t) return null;
    const theirs = idSet(t.artists);
    return { friend: f, n: countIn(ids, function (id) { return theirs[id]; }) };
  }).filter(function (x) { return x && x.n > 0; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 3);

  return {
    analyzed: tracks.length, total: result.total, duration: duration,
    artists: ids.length, topArtists: topArtists, match: match,
    first: first, last: last, friends: friends
  };
}
