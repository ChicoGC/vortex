/* ==========================================================================
   vortex — Supabase project config
   The anon/publishable key is safe to ship in the browser as long as RLS
   policies are enabled on every table (see supabase/schema.sql).
   ========================================================================== */

const SUPABASE_URL = 'https://hpblrmnturpihyrhwzih.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Pf26lgiBMA7y4YzyHuBoQQ_Smxkb47M';

/* Spotify uses Authorization Code + PKCE, so only the public client ID ships
   here — the client secret must never appear in this repo. Every origin the
   app runs on needs "<origin>/callback" registered as a Redirect URI in the
   Spotify dashboard. */
const SPOTIFY_CLIENT_ID = '85c8305ebd9b438d9aba250101f314ba';
