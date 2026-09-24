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
        scope: SPOTIFY_SCOPES
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
      const granted = (spotifyStore.get('scope') || 'user-read-currently-playing user-read-playback-state').split(/\s+/);
      return SPOTIFY_SCOPES.split(' ').filter(function (s) { return granted.indexOf(s) === -1; });
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
    }
  },

  async request(path) {
    let res = await fetch(SPOTIFY_API + path, {
      headers: { Authorization: 'Bearer ' + await spotify.auth.getValidToken() }
    });
    if (res.status === 401) {
      spotifyStore.set('expires_at', '0');
      res = await fetch(SPOTIFY_API + path, {
        headers: { Authorization: 'Bearer ' + await spotify.auth.getValidToken() }
      });
    }
    if (res.status === 204) return null;
    if (!res.ok) throw new SpotifyError('Spotify request failed (' + res.status + ')', res.status);
    return res.json();
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

  /* range: short_term (~4 weeks) | medium_term (~6 months) | long_term (all time) */
  async topArtists(range) {
    const data = await spotify.request('/me/top/artists?limit=20&time_range=' + encodeURIComponent(range));
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
    const data = await spotify.request('/me/top/tracks?limit=20&time_range=' + encodeURIComponent(range));
    return ((data && data.items) || []).filter(Boolean).map(spotifyTrack);
  },

  async playlists() {
    const data = await spotify.request('/me/playlists?limit=24');
    return ((data && data.items) || []).filter(Boolean).map(function (p) {
      const images = p.images || [];
      const count = (p.tracks && p.tracks.total) || (p.items && p.items.total) || 0;
      return {
        id: p.id,
        name: p.name,
        count: count,
        image: images.length ? images[0].url : null,
        owner: p.owner ? p.owner.display_name : '',
        url: p.external_urls ? p.external_urls.spotify : null
      };
    });
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
