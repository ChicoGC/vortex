/* ==========================================================================
   vortex — Spotify Web API client (Authorization Code + PKCE)
   Tokens live in this browser's localStorage and are cleared on sign-out.
   ========================================================================== */

const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state';
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
      ['access_token', 'refresh_token', 'expires_at'].forEach(function (k) { spotifyStore.set(k, null); });
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

  /* null when nothing (or a podcast/ad) is playing. */
  async nowPlaying() {
    const data = await spotify.request('/me/player/currently-playing');
    if (!data || !data.item || data.item.type !== 'track') return null;
    const images = data.item.album.images || [];
    return {
      id: data.item.id,
      title: data.item.name,
      artist: data.item.artists.map(function (a) { return a.name; }).join(', '),
      album: data.item.album.name,
      image: images.length ? images[0].url : null,
      durationMs: data.item.duration_ms,
      progressMs: data.progress_ms || 0,
      playing: !!data.is_playing,
      url: data.item.external_urls ? data.item.external_urls.spotify : null
    };
  }
};
