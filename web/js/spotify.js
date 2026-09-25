/* ==========================================================================
   vortex — Spotify Web API client (Authorization Code + PKCE)
   Tokens live in this browser's localStorage and are cleared on sign-out.
   ========================================================================== */

/* Activity and Music need the last three; accounts connected before they were
   added are asked to reconnect (see spotify.auth.missingScopes). */
const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-read-recently-played',
  'user-top-read',
  'playlist-read-private'
].join(' ');
/* Requested on every new connection but never required: only "Save as
   playlist" needs it, so older connections aren't forced to reconnect. */
const SPOTIFY_OPTIONAL_SCOPES = 'playlist-modify-private';
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API = 'https://api.spotify.com/v1';

function spotifyRedirectUri() {
  return location.origin + '/callback';
}

const spotifyStore = {
  get: function (k) {
    try { return localStorage.getItem('vortex.spotify.' + k); } catch (e) { return null; }
  },
  set: function (k, v) {
    try {
      if (v == null) localStorage.removeItem('vortex.spotify.' + k);
      else localStorage.setItem('vortex.spotify.' + k, v);
    } catch (e) { /* private mode */ }
  }
};

function base64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytes) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

async function sha256Base64Url(text) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

class SpotifyError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function spotifyTokenRequest(params) {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    const err = new SpotifyError(data.error_description || data.error || 'Spotify sign-in failed', res.status);
    err.code = data.error;
    throw err;
  }
  return data;
}

let spotifyRefreshing = null;
let spotifyUserId = null;

const spotify = {
  auth: {
    isConnected: function () {
      return !!spotifyStore.get('refresh_token');
    },

    async connect(returnHash) {
      const verifier = randomToken(64);
      const state = randomToken(16);
      spotifyStore.set('verifier', verifier);
      spotifyStore.set('state', state);
      spotifyStore.set('return_hash', returnHash || '#/settings');
      const params = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: 'code',
        redirect_uri: spotifyRedirectUri(),
        code_challenge_method: 'S256',
        code_challenge: await sha256Base64Url(verifier),
        state: state,
        scope: SPOTIFY_SCOPES + ' ' + SPOTIFY_OPTIONAL_SCOPES
      });
      location.assign(SPOTIFY_AUTH_URL + '?' + params.toString());
    },

    /* Returns { ok, error, returnHash }. Always consumes the one-time
       verifier/state so a replayed callback URL can't be reused. */
    async handleCallback() {
      const params = new URLSearchParams(location.search);
      const returnHash = spotifyStore.get('return_hash') || '#/settings';
      const expectedState = spotifyStore.get('state');
      const verifier = spotifyStore.get('verifier');
      spotifyStore.set('state', null);
      spotifyStore.set('verifier', null);
      spotifyStore.set('return_hash', null);

      if (params.get('error')) return { ok: false, error: params.get('error'), returnHash: returnHash };
      const code = params.get('code');
      if (!code || !verifier || !expectedState || params.get('state') !== expectedState) {
        return { ok: false, error: 'state_mismatch', returnHash: returnHash };
      }
      try {
        const data = await spotifyTokenRequest({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: spotifyRedirectUri(),
          client_id: SPOTIFY_CLIENT_ID,
          code_verifier: verifier
        });
        spotify.auth.saveToken(data);
        return { ok: true, returnHash: returnHash };
      } catch (err) {
        return { ok: false, error: err.message, returnHash: returnHash };
      }
    },

    saveToken: function (data) {
      spotifyStore.set('access_token', data.access_token);
      spotifyStore.set('expires_at', String(Date.now() + (data.expires_in - 60) * 1000));
      if (data.refresh_token) spotifyStore.set('refresh_token', data.refresh_token);
      if (data.scope) spotifyStore.set('scope', data.scope);
    },

    /* Scopes this connection lacks. Tokens saved before scopes were tracked
       count as having only the original two. */
    missingScopes: function () {
      return SPOTIFY_SCOPES.split(' ').filter(function (s) { return !spotify.auth.hasScope(s); });
    },

    hasScope: function (scope) {
      const granted = (spotifyStore.get('scope') || 'user-read-currently-playing user-read-playback-state').split(/\s+/);
      return granted.indexOf(scope) > -1;
    },

    async refresh() {
      const refreshToken = spotifyStore.get('refresh_token');
      if (!refreshToken) throw new SpotifyError('Not connected to Spotify', 401);
      try {
        const data = await spotifyTokenRequest({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: SPOTIFY_CLIENT_ID
        });
        spotify.auth.saveToken(data);
        return data.access_token;
      } catch (err) {
        if (err.code === 'invalid_grant') spotify.auth.disconnect();
        throw err;
      }
    },

    async getValidToken() {
      const token = spotifyStore.get('access_token');
      if (token && Date.now() < +(spotifyStore.get('expires_at') || 0)) return token;
      // Concurrent callers share one refresh; Spotify may rotate the refresh token.
      if (!spotifyRefreshing) {
        spotifyRefreshing = spotify.auth.refresh().finally(function () { spotifyRefreshing = null; });
      }
      return spotifyRefreshing;
    },

    disconnect: function () {
      ['access_token', 'refresh_token', 'expires_at', 'scope'].forEach(function (k) { spotifyStore.set(k, null); });
      spotifyUserId = null;
    }
  },

  /* body (optional) is sent as JSON, which makes it a POST. */
  async request(path, body) {
    async function send() {
      const opts = { headers: { Authorization: 'Bearer ' + await spotify.auth.getValidToken() } };
      if (body !== undefined) {
        opts.method = 'POST';
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      return fetch(SPOTIFY_API + path, opts);
    }
    let res = await send();
    if (res.status === 401) {
      spotifyStore.set('expires_at', '0');
      res = await send();
    }
    if (res.status === 204) return null;
    if (!res.ok) throw new SpotifyError('Spotify request failed (' + res.status + ')', res.status);
    return res.json();
  },

  /* The Spotify account id, used to tell playlists you own from ones you follow. */
  async userId() {
    if (!spotifyUserId) {
      const me = await spotify.request('/me');
      spotifyUserId = me && me.id;
    }
    return spotifyUserId;
  },

  /* null when nothing (or a podcast/ad) is playing. `private` is true during
     a Spotify private session, which vortex never shares with friends. */
  async nowPlaying() {
    const data = await spotify.request('/me/player?additional_types=track');
    if (!data || !data.item || data.item.type !== 'track') return null;
    const track = spotifyTrack(data.item);
    track.progressMs = data.progress_ms || 0;
    track.playing = !!data.is_playing;
    track.private = !!(data.device && data.device.is_private_session);
    return track;
  },

  /* Last 50 plays (Spotify's maximum), newest first. */
  async recentlyPlayed() {
    const data = await spotify.request('/me/player/recently-played?limit=50');
    return ((data && data.items) || []).filter(function (i) { return i && i.track; }).map(function (i) {
      const t = spotifyTrack(i.track);
      t.playedAt = i.played_at;
      return t;
    });
  },

  /* range: short_term (~4 weeks) | medium_term (~6 months) | long_term (~1 year,
     per Spotify's docs — not all-time). 50 is the API maximum. */
  async topArtists(range) {
    const data = await spotify.request('/me/top/artists?limit=50&time_range=' + encodeURIComponent(range));
    return ((data && data.items) || []).filter(Boolean).map(function (a) {
      const images = a.images || [];
      return {
        id: a.id,
        name: a.name,
        genres: a.genres || [],
        image: images.length ? (images[1] || images[0]).url : null,
        url: a.external_urls ? a.external_urls.spotify : null
      };
    });
  },

  async topTracks(range) {
    const data = await spotify.request('/me/top/tracks?limit=50&time_range=' + encodeURIComponent(range));
    return ((data && data.items) || []).filter(Boolean).map(spotifyTrack);
  },

  /* `readable`: Spotify only lets apps read the tracks of playlists you own
     or collaborate on; followed playlists come back as metadata only. */
  async playlists() {
    const results = await Promise.all([spotify.request('/me/playlists?limit=50'), spotify.userId()]);
    const data = results[0], myId = results[1];
    return ((data && data.items) || []).filter(Boolean).map(function (p) {
      const images = p.images || [];
      const count = (p.items && p.items.total) || (p.tracks && p.tracks.total) || 0;
      const owned = !!(p.owner && p.owner.id === myId);
      return {
        id: p.id,
        name: p.name,
        count: count,
        image: images.length ? images[0].url : null,
        owner: p.owner ? p.owner.display_name : '',
        owned: owned,
        collaborative: !!p.collaborative,
        readable: owned || !!p.collaborative,
        url: p.external_urls ? p.external_urls.spotify : null
      };
    });
  },

  /* Up to `max` tracks of a playlist you own or collaborate on, 50 per page. */
  async playlistItems(id, max) {
    const out = [];
    let total = 0;
    for (let offset = 0; offset < (max || 200); offset += 50) {
      const data = await spotify.request('/playlists/' + encodeURIComponent(id) + '/items?limit=50&offset=' + offset);
      const items = (data && data.items) || [];
      total = (data && data.total) || total;
      items.forEach(function (i) {
        const t = i && (i.item || i.track);
        if (!t || t.type !== 'track' || i.is_local) return;
        const track = spotifyTrack(t);
        track.artistNames = (t.artists || []).map(function (a) { return a.name; });
        track.addedAt = i.added_at || null;
        out.push(track);
      });
      if (!data || !data.next) break;
    }
    return { tracks: out, total: total };
  },

  /* Creates a private playlist in the user's account and fills it. */
  async createPlaylist(name, description, trackIds) {
    const playlist = await spotify.request('/me/playlists', { name: name, description: description, public: false });
    const uris = trackIds.filter(function (id) { return /^[A-Za-z0-9]{22}$/.test(id); })
      .map(function (id) { return 'spotify:track:' + id; });
    if (uris.length) await spotify.request('/playlists/' + encodeURIComponent(playlist.id) + '/items', { uris: uris.slice(0, 100) });
    return { id: playlist.id, url: playlist.external_urls ? playlist.external_urls.spotify : null };
  },

  async searchTracks(query, limit) {
    const q = String(query || '').trim().slice(0, 100);
    if (q.length < 2) return [];
    const data = await spotify.request('/search?type=track&limit=' + (limit || 6) + '&q=' + encodeURIComponent(q));
    return (data && data.tracks ? data.tracks.items : []).filter(Boolean).map(spotifyTrack);
  },

  /* Best-effort cover lookup for posts saved without one. Results (including
     misses) are cached per browser so each track is searched only once. */
  async findCover(title, artist) {
    const key = (title + '|' + artist).toLowerCase();
    const cache = readCoverCache();
    if (key in cache) return cache[key];
    const clean = function (s) { return String(s || '').replace(/["']/g, '').trim(); };
    const results = await spotify.searchTracks('track:' + clean(title) + ' artist:' + clean(artist), 1);
    const hit = results[0] ? { image: results[0].thumb, id: results[0].id } : null;
    writeCoverCache(key, hit);
    return hit;
  }
};

function spotifyTrack(item) {
  const images = (item.album && item.album.images) || [];
  return {
    id: item.id,
    title: item.name,
    artist: (item.artists || []).map(function (a) { return a.name; }).join(', '),
    artistIds: (item.artists || []).map(function (a) { return a.id; }).filter(Boolean),
    album: item.album ? item.album.name : '',
    image: images.length ? images[0].url : null,
    // ~300px variant: plenty for feed thumbnails at a fraction of the bytes.
    thumb: images.length ? (images[1] || images[0]).url : null,
    durationMs: item.duration_ms,
    url: item.external_urls ? item.external_urls.spotify : null
  };
}

function readCoverCache() {
  try { return JSON.parse(localStorage.getItem('vortex.spotify.covers') || '{}') || {}; }
  catch (e) { return {}; }
}

function writeCoverCache(key, value) {
  const cache = readCoverCache();
  cache[key] = value;
  const keys = Object.keys(cache);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(function (k) { delete cache[k]; });
  try { localStorage.setItem('vortex.spotify.covers', JSON.stringify(cache)); } catch (e) { /* quota / private mode */ }
}
