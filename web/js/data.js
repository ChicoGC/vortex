/* ==========================================================================
   vortex — mock data
   Everything here is placeholder content shaped like the real API responses
   we will eventually get from Spotify + Supabase.
   ========================================================================== */

const DATA = {
  me: {
    name: 'Pietro G.',
    username: '@pietrog',
    initials: 'PG',
    bio: 'Chasing the 3am synth loop. Mostly indie, occasionally aggressive house.',
    joined: 'March 2026',
    streak: 12,
    friends: 48,
    minutes: 1284,
    topGenre: 'Indie rock'
  },

  nowPlaying: {
    title: 'Lisztomania',
    artist: 'Phoenix',
    album: 'Wolfgang Amadeus Phoenix',
    art: 1,
    elapsed: 144,
    duration: 247,
    platform: 'spotify',
    alsoPlayed: [
      { initials: 'MR', name: 'Mariana' },
      { initials: 'RM', name: 'Rafa' },
      { initials: 'LC', name: 'Lu' }
    ]
  },

  friends: [
    { id: 'f1', name: 'Mariana Reis',  initials: 'MR', status: 'listening', track: 'Everything In Its Right Place', artist: 'Radiohead', art: 2, platform: 'spotify', time: 'now' },
    { id: 'f2', name: 'Rafa Mendes',   initials: 'RM', status: 'listening', track: 'Kids',                          artist: 'MGMT',      art: 5, platform: 'spotify', time: 'now' },
    { id: 'f3', name: 'Lu Carvalho',   initials: 'LC', status: 'listening', track: 'Dreams',                        artist: 'Fleetwood Mac', art: 4, platform: 'apple', time: 'now' },
    { id: 'f4', name: 'Theo Antunes',  initials: 'TA', status: 'online',    track: 'Weird Fishes',                   artist: 'Radiohead', art: 3, platform: 'spotify', time: '8m' },
    { id: 'f5', name: 'Bia Nogueira', initials: 'BN', status: 'online',    track: 'Midnight City',                  artist: 'M83',       art: 6, platform: 'spotify', time: '22m' },
    { id: 'f6', name: 'Caio Duarte',   initials: 'CD', status: 'offline',   track: 'Motion Sickness',                artist: 'Phoebe Bridgers', art: 1, platform: 'apple', time: '3h' },
    { id: 'f7', name: 'Nina Prado',    initials: 'NP', status: 'offline',   track: 'Alright',                        artist: 'Kendrick Lamar',  art: 4, platform: 'spotify', time: '5h' },
    { id: 'f8', name: 'Vitor Salles',  initials: 'VS', status: 'offline',   track: 'Teardrop',                       artist: 'Massive Attack',  art: 3, platform: 'spotify', time: 'yesterday' }
  ],

  requests: [
    { id: 'r1', name: 'Helena Braga', initials: 'HB', mutual: 6 },
    { id: 'r2', name: 'Gui Ferraz',   initials: 'GF', mutual: 2 }
  ],

  suggestions: [
    { id: 's1', name: 'Dani Rocha',   initials: 'DR', reason: '9 artists in common', compat: 82 },
    { id: 's2', name: 'Pedro Lima',   initials: 'PL', reason: 'Follows 4 of your friends', compat: 71 },
    { id: 's3', name: 'Alice Moura',  initials: 'AM', reason: 'Both deep in shoegaze', compat: 64 }
  ],

  feed: [],

  recent: [
    { title: 'Lisztomania',        artist: 'Phoenix',          album: 'Wolfgang Amadeus Phoenix', art: 1, len: '4:07', playing: true },
    { title: 'Weird Fishes / Arpeggi', artist: 'Radiohead',    album: 'In Rainbows',              art: 3, len: '5:18' },
    { title: 'Midnight City',      artist: 'M83',              album: 'Hurry Up, We Are Dreaming', art: 6, len: '4:03' },
    { title: 'Dreams',             artist: 'Fleetwood Mac',    album: 'Rumours',                  art: 4, len: '4:14' },
    { title: 'Kids',               artist: 'MGMT',             album: 'Oracular Spectacular',     art: 5, len: '5:02' },
    { title: 'Teardrop',           artist: 'Massive Attack',   album: 'Mezzanine',                art: 3, len: '5:29' },
    { title: 'Motion Sickness',    artist: 'Phoebe Bridgers',  album: 'Stranger in the Alps',     art: 1, len: '3:56' },
    { title: 'Alright',            artist: 'Kendrick Lamar',   album: 'To Pimp a Butterfly',      art: 4, len: '3:39' }
  ],

  favourites: [
    { title: 'Nude',            artist: 'Radiohead',       album: 'In Rainbows',    art: 3, len: '4:15' },
    { title: 'Genesis',         artist: 'Grimes',          album: 'Visions',        art: 6, len: '4:15' },
    { title: 'Pyramid Song',    artist: 'Radiohead',       album: 'Amnesiac',       art: 2, len: '4:49' },
    { title: 'Sunset',          artist: 'Caribou',         album: 'Swim',           art: 5, len: '4:06' },
    { title: 'An Eagle in Your Mind', artist: 'Boards of Canada', album: 'Music Has the Right', art: 4, len: '6:21' }
  ],

  artists: [
    { name: 'Radiohead',        plays: 184, art: 3, delta: 12 },
    { name: 'Phoenix',          plays: 142, art: 1, delta: 31 },
    { name: 'M83',              plays: 96,  art: 6, delta: -4 },
    { name: 'Fleetwood Mac',    plays: 81,  art: 4, delta: 8 },
    { name: 'Caribou',          plays: 74,  art: 5, delta: 19 },
    { name: 'Massive Attack',   plays: 62,  art: 2, delta: -9 }
  ],

  albums: [
    { name: 'In Rainbows',        artist: 'Radiohead',      art: 3, year: 2007 },
    { name: 'Rumours',            artist: 'Fleetwood Mac',  art: 4, year: 1977 },
    { name: 'Wolfgang Amadeus',   artist: 'Phoenix',        art: 1, year: 2009 },
    { name: 'Hurry Up, We Are Dreaming', artist: 'M83',     art: 6, year: 2011 },
    { name: 'Swim',               artist: 'Caribou',        art: 5, year: 2010 },
    { name: 'Mezzanine',          artist: 'Massive Attack', art: 2, year: 1998 }
  ],

  playlists: [
    { name: 'Late shift',      count: 62, art: 3 },
    { name: 'Sunday slow',     count: 41, art: 4 },
    { name: 'Deploy day',      count: 88, art: 1 },
    { name: 'Rediscovered',    count: 24, art: 5 }
  ],

  genres: [
    { name: 'Indie rock',   pct: 34, color: 'var(--data-1)' },
    { name: 'Electronic',   pct: 26, color: 'var(--data-2)' },
    { name: 'Alternative',  pct: 18, color: 'var(--data-3)' },
    { name: 'Hip hop',      pct: 13, color: 'var(--data-4)' },
    { name: 'Other',        pct: 9,  color: 'var(--text-tertiary)' }
  ],

  week: [
    { day: 'M', min: 124 }, { day: 'T', min: 186 }, { day: 'W', min: 92 },
    { day: 'T', min: 210 }, { day: 'F', min: 268 }, { day: 'S', min: 178 },
    { day: 'S', min: 226 }
  ],

  timeline: [
    {
      day: 'Today', today: true, items: [
        { time: '21:14', title: 'Lisztomania',            artist: 'Phoenix',        art: 1 },
        { time: '20:58', title: 'Weird Fishes / Arpeggi', artist: 'Radiohead',      art: 3 },
        { time: '20:41', title: 'Midnight City',          artist: 'M83',            art: 6 }
      ]
    },
    {
      day: 'Yesterday', items: [
        { time: '23:02', title: 'Dreams',          artist: 'Fleetwood Mac', art: 4 },
        { time: '22:35', title: 'Teardrop',        artist: 'Massive Attack', art: 3 },
        { time: '19:12', title: 'Kids',            artist: 'MGMT',          art: 5 }
      ]
    },
    {
      day: 'Friday, 18 Sep', items: [
        { time: '18:20', title: 'Motion Sickness', artist: 'Phoebe Bridgers', art: 1 },
        { time: '17:44', title: 'Sunset',          artist: 'Caribou',         art: 5 }
      ]
    }
  ],

  leaderboard: [
    { name: 'Mariana Reis', initials: 'MR', minutes: 1542, you: false },
    { name: 'Pietro G.',    initials: 'PG', minutes: 1284, you: true },
    { name: 'Theo Antunes', initials: 'TA', minutes: 1190, you: false },
    { name: 'Rafa Mendes',  initials: 'RM', minutes: 964,  you: false },
    { name: 'Bia Nogueira', initials: 'BN', minutes: 720,  you: false }
  ],

  compatibility: [
    { name: 'Mariana Reis', initials: 'MR', pct: 87, shared: 'Radiohead, Caribou, M83' },
    { name: 'Theo Antunes', initials: 'TA', pct: 74, shared: 'Radiohead, Grimes' },
    { name: 'Rafa Mendes',  initials: 'RM', pct: 58, shared: 'MGMT, Phoenix' }
  ],

  discoveries: [
    { title: 'Sunset',        artist: 'Caribou',  via: 'Mariana', art: 5 },
    { title: 'Genesis',       artist: 'Grimes',   via: 'Theo',    art: 6 },
    { title: 'An Eagle in Your Mind', artist: 'Boards of Canada', via: 'Lu', art: 4 }
  ]
};

const PLATFORM_LABEL = { spotify: 'Spotify', apple: 'Apple Music' };
