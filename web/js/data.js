/* ==========================================================================
   vortex — client-side state
   Starts empty and is filled from Supabase and Spotify at runtime.
   ========================================================================== */

const DATA = {
  /* Filled from Supabase once signed in. */
  me: {
    name: '',
    username: '',
    email: '',
    initials: '',
    avatarUrl: null,
    bio: '',
    joined: '',
    friends: 0,
    shareListening: true,
    shareTaste: true,
    stats: null,        // { posts, reactions, comments }
    recentPosts: []     // latest posts by this user, for the profile
  },

  /* status: 'disconnected' | 'idle' (connected, nothing playing) | 'track' */
  nowPlaying: {
    status: 'disconnected',
    id: null,
    title: '',
    artist: '',
    album: '',
    art: 1,
    image: null,
    url: null,
    elapsed: 0,
    duration: 0,
    playing: false,
    platform: 'spotify'
  },

  /* Filled from Supabase: { friendshipId, id, name, username, initials } */
  friends: [],
  incoming: [],
  outgoing: [],

  /* Friends' current tracks by user id, as rows of public.listening_now. */
  listening: {},

  /* Friends' music DNA snapshots by user id (sanitized public.taste_profiles). */
  tastes: {},

  feed: []
};

const PLATFORM_LABEL = { spotify: 'Spotify', apple: 'Apple Music' };
