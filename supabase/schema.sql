-- vortex — initial schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: uses "if not exists" / "or replace" everywhere.

-- ==========================================================================
-- profiles
-- One row per user, keyed to auth.users. Created automatically on signup.
-- ==========================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text not null,
  bio text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- The "profiles are publicly readable" select policy is defined further down,
-- after username_confirmed exists, since it hides accounts still being set up.

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ==========================================================================
-- username rules
-- Usernames are what #/u/<username> resolves, so the format and uniqueness
-- rules live in the database: signUp can be called directly, bypassing the
-- signup form's pattern. Allowed: 3-20 of A-Z a-z 0-9 _, unique ignoring
-- case (so "PietroG" can't sit next to "pietrog").
--
-- Both statements below fail if existing rows break the rules. Run these
-- first and fix (rename) anything they return:
--
--   select id, username from public.profiles
--   where username !~ '^[A-Za-z0-9_]{3,20}$';
--
--   select lower(username) as handle, array_agg(username) as clashes
--   from public.profiles
--   group by lower(username)
--   having count(*) > 1;
-- ==========================================================================
alter table public.profiles drop constraint if exists profiles_username_format_check;
alter table public.profiles add constraint profiles_username_format_check
  check (username ~ '^[A-Za-z0-9_]{3,20}$');

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- Length caps for what Edit profile writes (the form enforces 50 and 160).
-- The name cap is NOT VALID so an older, longer name can't block the upgrade.
alter table public.profiles drop constraint if exists profiles_bio_length_check;
alter table public.profiles add constraint profiles_bio_length_check
  check (bio is null or char_length(bio) <= 160);
alter table public.profiles drop constraint if exists profiles_name_length_check;
alter table public.profiles add constraint profiles_name_length_check
  check (char_length(name) <= 80) not valid;

-- username_confirmed: false while the handle was generated rather than picked
-- (a first Google sign-in). The app holds those accounts on a "choose your
-- @username" screen until it flips to true. Existing rows default to true.
alter table public.profiles
  add column if not exists username_confirmed boolean not null default true;

-- An account still on that screen hasn't accepted the privacy policy yet
-- either (both are confirmed together), so nobody else can see or find it.
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  using (username_confirmed or auth.uid() = id);

-- ==========================================================================
-- privacy policy consent
-- privacy_version is the effective date of the policy the person accepted
-- (web/privacy.html); the app asks again whenever it's older than the
-- current one (PRIVACY_VERSION in web/js/app.js). The server stamps
-- privacy_accepted_at, so the time can't be backdated from the client.
-- ==========================================================================
alter table public.profiles add column if not exists privacy_version text;
alter table public.profiles add column if not exists privacy_accepted_at timestamptz;

alter table public.profiles drop constraint if exists profiles_privacy_version_check;
alter table public.profiles add constraint profiles_privacy_version_check
  check (privacy_version is null or privacy_version ~ '^\d{4}-\d{2}-\d{2}$');

create or replace function public.stamp_privacy_acceptance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.privacy_version := coalesce(new.privacy_version, old.privacy_version);
  if new.privacy_version is distinct from old.privacy_version then
    new.privacy_accepted_at := now();
  else
    new.privacy_accepted_at := old.privacy_accepted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_privacy_stamp on public.profiles;
create trigger profiles_privacy_stamp
  before update on public.profiles
  for each row execute function public.stamp_privacy_acceptance();

-- Auto-create a profile row whenever a new auth user signs up.
-- A valid username from the signup metadata is used as-is; if it's taken the
-- unique index rejects the signup, rather than silently handing out a
-- different handle than the one the person picked. A missing or invalid one
-- falls back to the email's local part with disallowed characters stripped,
-- cut to 20 and padded to 3, plus a short random suffix on collision, and the
-- profile is marked username_confirmed = false.
--
-- Email signups must carry the accepted privacy_version in their metadata or
-- the signup is rejected. That includes users added from the Supabase
-- dashboard: create those through the app instead. Google sign-ins can't
-- carry metadata, so they accept on the choose-your-username screen.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requested text := new.raw_user_meta_data->>'username';
  display_name text := left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), nullif(split_part(new.email, '@', 1), '')), 50);
  consent text := new.raw_user_meta_data->>'privacy_version';
  base text;
  candidate text;
  attempts int := 0;
begin
  if consent !~ '^\d{4}-\d{2}-\d{2}$' then
    consent := null;
  end if;
  if consent is null and new.raw_app_meta_data->>'provider' = 'email' then
    raise exception 'Accept the privacy policy to create an account.' using errcode = 'P0001', hint = 'privacy_not_accepted';
  end if;

  if requested ~ '^[A-Za-z0-9_]{3,20}$' then
    insert into public.profiles (id, username, name, privacy_version, privacy_accepted_at)
    values (new.id, requested, coalesce(display_name, requested), consent, case when consent is not null then now() end);
    return new;
  end if;

  base := left(regexp_replace(coalesce(split_part(new.email, '@', 1), ''), '[^A-Za-z0-9_]', '', 'g'), 20);
  if char_length(base) < 3 then
    base := 'user' || base;
  end if;
  candidate := base;

  loop
    begin
      insert into public.profiles (id, username, name, username_confirmed, privacy_version, privacy_accepted_at)
      values (new.id, candidate, coalesce(display_name, candidate), false, consent, case when consent is not null then now() end);
      return new;
    exception when unique_violation then
      -- Retrying on the violation itself (not a prior "exists" check) also
      -- covers two signups racing for the same fallback handle.
      attempts := attempts + 1;
      if attempts >= 5 then
        raise;
      end if;
      candidate := left(base, 15) || '_' || substr(md5(random()::text), 1, 4);
    end;
  end loop;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==========================================================================
-- friendships
-- One row per relationship. status: pending | accepted
-- requester_id sent the request; addressee_id receives it.
-- ==========================================================================
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

alter table public.friendships enable row level security;

drop policy if exists "users see their own friendships" on public.friendships;
create policy "users see their own friendships"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- New requests must start as pending, or a requester could skip consent.
drop policy if exists "users can send friend requests" on public.friendships;
create policy "users can send friend requests"
  on public.friendships for insert
  with check (auth.uid() = requester_id and status = 'pending');

-- Only the person who received the request can accept it, and only the
-- status column is writable (see the column grant below).
drop policy if exists "users can respond to their requests" on public.friendships;
create policy "users can respond to their requests"
  on public.friendships for update
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

revoke update on public.friendships from anon, authenticated;
grant update (status) on public.friendships to authenticated;

-- One relationship per pair, whichever direction it was requested in.
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

drop policy if exists "users can remove their friendships" on public.friendships;
create policy "users can remove their friendships"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ==========================================================================
-- posts
-- A user sharing a track (manual entry for now — no Spotify yet).
-- ==========================================================================
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  track_title text not null,
  artist text not null,
  album text,
  art_seed int not null default 1,
  note text,
  created_at timestamptz not null default now()
);

-- Cover art and track id come from the Spotify search. Restricted to Spotify's
-- image CDN so a post can't embed an arbitrary (e.g. tracking) image URL.
alter table public.posts add column if not exists album_image_url text;
alter table public.posts add column if not exists spotify_track_id text;

alter table public.posts drop constraint if exists posts_album_image_url_check;
alter table public.posts add constraint posts_album_image_url_check
  check (album_image_url is null or album_image_url ~ '^https://i\.scdn\.co/image/[A-Za-z0-9]+$');

alter table public.posts drop constraint if exists posts_spotify_track_id_check;
alter table public.posts add constraint posts_spotify_track_id_check
  check (spotify_track_id is null or spotify_track_id ~ '^[A-Za-z0-9]{22}$');

-- Who can see a post: 'public' (anyone) or 'friends' (the author and their
-- accepted friends). Older posts stay public.
alter table public.posts add column if not exists visibility text not null default 'public';

alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check
  check (visibility in ('public', 'friends'));

create index if not exists posts_public_created_idx
  on public.posts (created_at desc) where visibility = 'public';

alter table public.posts enable row level security;

-- Whether the caller and `other` are accepted friends. Takes only one id, so
-- nobody can ask about friendships between two other people.
create or replace function public.is_friend(other uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = auth.uid() and f.addressee_id = other)
        or (f.addressee_id = auth.uid() and f.requester_id = other))
  );
$$;

drop policy if exists "posts are publicly readable" on public.posts;
drop policy if exists "posts visible to their audience" on public.posts;
create policy "posts visible to their audience"
  on public.posts for select
  using (visibility = 'public' or auth.uid() = user_id or public.is_friend(user_id));

drop policy if exists "users can create own posts" on public.posts;
create policy "users can create own posts"
  on public.posts for insert
  with check (auth.uid() = user_id);

-- Authors may fill in the cover of their own older posts, and nothing else.
drop policy if exists "users can update own post covers" on public.posts;
create policy "users can update own post covers"
  on public.posts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke update on public.posts from anon, authenticated;
grant update (album_image_url, spotify_track_id) on public.posts to authenticated;

drop policy if exists "users can delete own posts" on public.posts;
create policy "users can delete own posts"
  on public.posts for delete
  using (auth.uid() = user_id);

-- ==========================================================================
-- reactions
-- One row per (post, user, type). type: flame | heart
-- ==========================================================================
create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('flame', 'heart')),
  created_at timestamptz not null default now(),
  unique (post_id, user_id, type)
);

alter table public.reactions enable row level security;

-- Readable by whoever can see the post (the posts policy applies inside).
drop policy if exists "reactions are publicly readable" on public.reactions;
drop policy if exists "reactions visible with their post" on public.reactions;
create policy "reactions visible with their post"
  on public.reactions for select
  using (exists (select 1 from public.posts p where p.id = post_id));

drop policy if exists "users can react as themselves" on public.reactions;
create policy "users can react as themselves"
  on public.reactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can remove own reactions" on public.reactions;
create policy "users can remove own reactions"
  on public.reactions for delete
  using (auth.uid() = user_id);

-- ==========================================================================
-- comments
-- ==========================================================================
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

-- Readable by whoever can see the post (the posts policy applies inside).
drop policy if exists "comments are publicly readable" on public.comments;
drop policy if exists "comments visible with their post" on public.comments;
create policy "comments visible with their post"
  on public.comments for select
  using (exists (select 1 from public.posts p where p.id = post_id));

drop policy if exists "users can comment as themselves" on public.comments;
create policy "users can comment as themselves"
  on public.comments for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own comments" on public.comments;
create policy "users can delete own comments"
  on public.comments for delete
  using (auth.uid() = user_id);

-- ==========================================================================
-- comment rate limit
-- At most 3 comments per user on the same post in any 60-second window.
-- Lives in the database so it holds even when the API is called directly.
-- ==========================================================================
create index if not exists comments_post_user_created_idx
  on public.comments (post_id, user_id, created_at desc);

create or replace function public.enforce_comment_rate_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  recent int;
begin
  -- Clients could otherwise backdate created_at to slip under the window.
  new.created_at := now();

  -- Serialize concurrent inserts from the same user on the same post,
  -- so a burst of parallel requests can't all pass the count check.
  perform pg_advisory_xact_lock(hashtext(new.user_id::text || ':' || new.post_id::text));

  select count(*) into recent
  from public.comments
  where post_id = new.post_id
    and user_id = new.user_id
    and created_at > now() - interval '60 seconds';

  if recent >= 3 then
    raise exception 'You are commenting too fast on this post. Wait a minute and try again.'
      using errcode = 'P0001', hint = 'rate_limited';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_rate_limit on public.comments;
create trigger comments_rate_limit
  before insert on public.comments
  for each row execute function public.enforce_comment_rate_limit();

-- ==========================================================================
-- comment replies
-- One level deep, like YouTube: a reply points at a top-level comment on the
-- same post. Replying to a reply attaches to that reply's parent instead.
-- ==========================================================================
alter table public.comments add column if not exists parent_id uuid references public.comments(id) on delete cascade;
create index if not exists comments_parent_idx on public.comments (parent_id);

create or replace function public.enforce_comment_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select post_id, parent_id into parent from public.comments where id = new.parent_id;
  if not found or parent.post_id <> new.post_id or parent.parent_id is not null then
    raise exception 'A reply must point to a top-level comment on the same post.'
      using errcode = 'P0001', hint = 'invalid_parent';
  end if;
  return new;
end;
$$;

drop trigger if exists comments_parent_check on public.comments;
create trigger comments_parent_check
  before insert on public.comments
  for each row execute function public.enforce_comment_parent();

-- ==========================================================================
-- listening now
-- Each user's current Spotify track, published by their own browser while
-- vortex is open. Visible only to the user and their accepted friends, and
-- only while the owner has share_listening on.
-- ==========================================================================
alter table public.profiles add column if not exists share_listening boolean not null default true;

create table if not exists public.listening_now (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  track_id text check (track_id is null or track_id ~ '^[A-Za-z0-9]{22}$'),
  title text not null check (char_length(title) <= 300),
  artist text not null check (char_length(artist) <= 300),
  album text check (album is null or char_length(album) <= 300),
  image_url text check (image_url is null or image_url ~ '^https://i\.scdn\.co/image/[A-Za-z0-9]+$'),
  is_playing boolean not null default false,
  progress_ms int not null default 0 check (progress_ms >= 0),
  duration_ms int not null default 0 check (duration_ms >= 0),
  updated_at timestamptz not null default now()
);

alter table public.listening_now enable row level security;

drop policy if exists "listening visible to self and friends" on public.listening_now;
create policy "listening visible to self and friends"
  on public.listening_now for select
  using (
    auth.uid() = user_id
    or (
      exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = auth.uid() and f.addressee_id = listening_now.user_id)
            or (f.addressee_id = auth.uid() and f.requester_id = listening_now.user_id))
      )
      and exists (
        select 1 from public.profiles p
        where p.id = listening_now.user_id and p.share_listening
      )
    )
  );

drop policy if exists "users publish their own listening" on public.listening_now;
create policy "users publish their own listening"
  on public.listening_now for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update their own listening" on public.listening_now;
create policy "users update their own listening"
  on public.listening_now for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users clear their own listening" on public.listening_now;
create policy "users clear their own listening"
  on public.listening_now for delete
  using (auth.uid() = user_id);

-- The server stamps updated_at, so a client can't fake being "live".
create or replace function public.touch_listening_now()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists listening_now_touch on public.listening_now;
create trigger listening_now_touch
  before insert or update on public.listening_now
  for each row execute function public.touch_listening_now();

-- ==========================================================================
-- taste profiles ("music DNA")
-- A snapshot of each user's Spotify top artists and tracks (~6 months),
-- published by their own browser. Spotify only hands a user's data to that
-- user's token, so friends compare tastes through this table. Visible to the
-- owner and accepted friends, only while the owner has share_taste on.
-- ==========================================================================
alter table public.profiles add column if not exists share_taste boolean not null default true;

create table if not exists public.taste_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  artists jsonb not null default '[]'::jsonb
    check (jsonb_typeof(artists) = 'array' and jsonb_array_length(artists) <= 50),
  tracks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tracks) = 'array' and jsonb_array_length(tracks) <= 50),
  updated_at timestamptz not null default now(),
  check (pg_column_size(artists) + pg_column_size(tracks) < 60000)
);

alter table public.taste_profiles enable row level security;

drop policy if exists "taste visible to self and friends" on public.taste_profiles;
create policy "taste visible to self and friends"
  on public.taste_profiles for select
  using (
    auth.uid() = user_id
    or (
      exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = auth.uid() and f.addressee_id = taste_profiles.user_id)
            or (f.addressee_id = auth.uid() and f.requester_id = taste_profiles.user_id))
      )
      and exists (
        select 1 from public.profiles p
        where p.id = taste_profiles.user_id and p.share_taste
      )
    )
  );

drop policy if exists "users publish their own taste" on public.taste_profiles;
create policy "users publish their own taste"
  on public.taste_profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update their own taste" on public.taste_profiles;
create policy "users update their own taste"
  on public.taste_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users clear their own taste" on public.taste_profiles;
create policy "users clear their own taste"
  on public.taste_profiles for delete
  using (auth.uid() = user_id);

drop trigger if exists taste_profiles_touch on public.taste_profiles;
create trigger taste_profiles_touch
  before insert or update on public.taste_profiles
  for each row execute function public.touch_listening_now();

-- Push changes to friends over Supabase Realtime (RLS still applies).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listening_now'
  ) then
    alter publication supabase_realtime add table public.listening_now;
  end if;
end;
$$;

-- ==========================================================================
-- avatars (Storage)
-- Profile photos, one folder per user (<user id>/<file>). The bucket is
-- public — a profile photo is meant to be visible to anyone with the link,
-- same as a username — but only the owner can write inside their own folder.
-- ==========================================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar images are publicly readable" on storage.objects;
create policy "avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can replace their own avatar" on storage.objects;
create policy "users can replace their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete their own avatar" on storage.objects;
create policy "users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Only a photo in the person's own folder of the avatars bucket, as the app
-- uploads it (<user id>/<name>.<png|jpg|webp|gif>), so a direct API call can't
-- point avatar_url at an arbitrary (e.g. tracking) image, at someone else's
-- folder, or out of the bucket with "..". NOT VALID so older rows can't block
-- this; to also check those, run:
--   alter table public.profiles validate constraint profiles_avatar_url_check;
alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles add constraint profiles_avatar_url_check
  check (avatar_url is null or avatar_url ~ ('^https://hpblrmnturpihyrhwzih\.supabase\.co/storage/v1/object/public/avatars/'
    || id::text || '/[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$')) not valid;

-- ==========================================================================
-- notifications
-- Written only by the triggers below (no insert policy), read and marked
-- read by their recipient. Rows go away with whatever they point at: an
-- unreacted flame, a deleted comment or a cancelled request.
-- ==========================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('reaction', 'comment', 'reply', 'friend_request', 'friend_accept')),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  friendship_id uuid references public.friendships(id) on delete cascade,
  reaction text check (reaction is null or reaction in ('flame', 'heart')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "users read their own notifications" on public.notifications;
create policy "users read their own notifications"
  on public.notifications for select
  using (auth.uid() = recipient_id);

drop policy if exists "users mark their own notifications read" on public.notifications;
create policy "users mark their own notifications read"
  on public.notifications for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "users delete their own notifications" on public.notifications;
create policy "users delete their own notifications"
  on public.notifications for delete
  using (auth.uid() = recipient_id);

create or replace function public.notify_reaction()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  author uuid;
begin
  if tg_op = 'INSERT' then
    select user_id into author from public.posts where id = new.post_id;
    if author is not null and author <> new.user_id then
      insert into public.notifications (recipient_id, actor_id, type, post_id, reaction)
      values (author, new.user_id, 'reaction', new.post_id, new.type);
    end if;
    return new;
  end if;
  -- Taking a reaction back takes its notification with it, so toggling
  -- a flame on and off doesn't pile up.
  delete from public.notifications
  where type = 'reaction' and actor_id = old.user_id and post_id = old.post_id and reaction = old.type;
  return old;
end;
$$;

drop trigger if exists reactions_notify on public.reactions;
create trigger reactions_notify
  after insert or delete on public.reactions
  for each row execute function public.notify_reaction();

-- A reply notifies the comment's author; the post's author hears about
-- every comment unless they're the one being replied to (no double ping).
create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  post_author uuid;
  parent_author uuid;
begin
  select user_id into post_author from public.posts where id = new.post_id;
  if new.parent_id is not null then
    select user_id into parent_author from public.comments where id = new.parent_id;
    if parent_author is not null and parent_author <> new.user_id then
      insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
      values (parent_author, new.user_id, 'reply', new.post_id, new.id);
    end if;
  end if;
  if post_author is not null and post_author <> new.user_id and post_author is distinct from parent_author then
    insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
    values (post_author, new.user_id, 'comment', new.post_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_comment();

create or replace function public.notify_friendship()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notifications (recipient_id, actor_id, type, friendship_id)
    values (new.addressee_id, new.requester_id, 'friend_request', new.id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    insert into public.notifications (recipient_id, actor_id, type, friendship_id)
    values (new.requester_id, new.addressee_id, 'friend_accept', new.id);
    update public.notifications set read_at = coalesce(read_at, now())
    where friendship_id = new.id and type = 'friend_request';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify
  after insert or update on public.friendships
  for each row execute function public.notify_friendship();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- ==========================================================================
-- pinned song ("song of the moment")
-- One track on each profile, picked by its owner. Same URL/id rules as posts.
-- ==========================================================================
alter table public.profiles add column if not exists pin_track_id text;
alter table public.profiles add column if not exists pin_title text;
alter table public.profiles add column if not exists pin_artist text;
alter table public.profiles add column if not exists pin_image text;
alter table public.profiles add column if not exists pin_note text;
alter table public.profiles add column if not exists pinned_at timestamptz;

alter table public.profiles drop constraint if exists profiles_pin_check;
alter table public.profiles add constraint profiles_pin_check check (
  (pin_title is null) = (pin_artist is null)
  and (pin_title is null or char_length(pin_title) between 1 and 200)
  and (pin_artist is null or char_length(pin_artist) between 1 and 200)
  and (pin_note is null or char_length(pin_note) <= 140)
  and (pin_track_id is null or pin_track_id ~ '^[A-Za-z0-9]{22}$')
  and (pin_image is null or pin_image ~ '^https://i\.scdn\.co/image/[A-Za-z0-9]+$')
);

-- ==========================================================================
-- blocks
-- Only the blocker can see their own blocks. Blocking ends the friendship
-- and clears notifications between the two; after that the blocked person
-- can't send a friend request, react to or comment on the blocker's posts,
-- or reach them through a notification of any kind.
-- ==========================================================================
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

drop policy if exists "users see who they blocked" on public.blocks;
create policy "users see who they blocked"
  on public.blocks for select
  using (auth.uid() = blocker_id);

drop policy if exists "users block as themselves" on public.blocks;
create policy "users block as themselves"
  on public.blocks for insert
  with check (auth.uid() = blocker_id);

drop policy if exists "users unblock as themselves" on public.blocks;
create policy "users unblock as themselves"
  on public.blocks for delete
  using (auth.uid() = blocker_id);

-- Whether a block stands between the caller and `other`, in either direction.
-- Takes only one id, so nobody can ask about blocks between two other people.
create or replace function public.blocked_with(other uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = auth.uid() and blocked_id = other)
       or (blocker_id = other and blocked_id = auth.uid())
  );
$$;

create or replace function public.apply_block()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.friendships
  where (requester_id = new.blocker_id and addressee_id = new.blocked_id)
     or (requester_id = new.blocked_id and addressee_id = new.blocker_id);
  delete from public.notifications
  where (recipient_id = new.blocker_id and actor_id = new.blocked_id)
     or (recipient_id = new.blocked_id and actor_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists blocks_apply on public.blocks;
create trigger blocks_apply
  after insert on public.blocks
  for each row execute function public.apply_block();

drop policy if exists "users can send friend requests" on public.friendships;
create policy "users can send friend requests"
  on public.friendships for insert
  with check (auth.uid() = requester_id and status = 'pending' and not public.blocked_with(addressee_id));

drop policy if exists "users can react as themselves" on public.reactions;
create policy "users can react as themselves"
  on public.reactions for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.posts p where p.id = post_id)
    and not public.blocked_with((select p.user_id from public.posts p where p.id = post_id))
  );

drop policy if exists "users can comment as themselves" on public.comments;
create policy "users can comment as themselves"
  on public.comments for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.posts p where p.id = post_id)
    and not public.blocked_with((select p.user_id from public.posts p where p.id = post_id))
  );

-- Catches what the policies can't, like a reply to the blocker's comment on
-- someone else's post: the notification is simply dropped.
create or replace function public.skip_blocked_notification()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.blocks
    where (blocker_id = new.recipient_id and blocked_id = new.actor_id)
       or (blocker_id = new.actor_id and blocked_id = new.recipient_id)
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_skip_blocked on public.notifications;
create trigger notifications_skip_blocked
  before insert on public.notifications
  for each row execute function public.skip_blocked_notification();

-- ==========================================================================
-- reports
-- Write-only from the app (no select policy): review them in the Table
-- Editor. A post report keeps a copy of the post, so it survives deletion.
-- One report per person, per account or post.
-- ==========================================================================
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid,
  post_snapshot text,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual_violent', 'impersonation', 'other')),
  details text check (details is null or char_length(details) <= 500),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_id)
);

create unique index if not exists reports_once_idx
  on public.reports (reporter_id, reported_id, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.reports enable row level security;

drop policy if exists "users report as themselves" on public.reports;
create policy "users report as themselves"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

create or replace function public.snapshot_reported_post()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  p record;
begin
  new.created_at := now();
  new.post_snapshot := null;
  if new.post_id is not null then
    select track_title, artist, note into p from public.posts
    where id = new.post_id and user_id = new.reported_id;
    if not found then
      raise exception 'That post is not by the reported account.' using errcode = 'P0001', hint = 'invalid_post';
    end if;
    new.post_snapshot := p.track_title || ' — ' || p.artist || coalesce(E'\n' || p.note, '');
  end if;
  return new;
end;
$$;

drop trigger if exists reports_snapshot on public.reports;
create trigger reports_snapshot
  before insert on public.reports
  for each row execute function public.snapshot_reported_post();

-- ==========================================================================
-- hardening (2026-10-06)
-- Limits that only held in the app's forms, now held by the database too,
-- since anyone with the publishable key can call the API directly.
-- ==========================================================================

-- profiles: only the columns the app edits are writable. id, created_at and
-- privacy_accepted_at stay as the server set them (no backdating "joined").
revoke update on public.profiles from anon, authenticated;
grant update (username, name, bio, avatar_url, username_confirmed, privacy_version,
              share_listening, share_taste,
              pin_track_id, pin_title, pin_artist, pin_image, pin_note, pinned_at)
  on public.profiles to authenticated;

-- Text sizes match the share form and the comment box. NOT VALID: checked on
-- every new row, without failing on anything already stored.
alter table public.posts drop constraint if exists posts_text_length_check;
alter table public.posts add constraint posts_text_length_check check (
  char_length(track_title) between 1 and 300
  and char_length(artist) between 1 and 300
  and (album is null or char_length(album) <= 300)
  and (note is null or char_length(note) <= 500)
) not valid;

alter table public.comments drop constraint if exists comments_content_length_check;
alter table public.comments add constraint comments_content_length_check
  check (char_length(content) between 1 and 500) not valid;

-- The server stamps created_at. A post dated 2099 would otherwise sit at the
-- top of everyone's For you forever.
create or replace function public.stamp_created_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists reactions_stamp_created on public.reactions;
create trigger reactions_stamp_created
  before insert on public.reactions
  for each row execute function public.stamp_created_at();

drop trigger if exists blocks_stamp_created on public.blocks;
create trigger blocks_stamp_created
  before insert on public.blocks
  for each row execute function public.stamp_created_at();

-- Posts: stamped, and at most 10 per person in any 10 minutes, so nobody can
-- flood For you. Same shape as the comment rate limit above.
create index if not exists posts_user_created_idx
  on public.posts (user_id, created_at desc);

create or replace function public.enforce_post_rate_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  recent int;
begin
  new.created_at := now();
  perform pg_advisory_xact_lock(hashtext('post:' || new.user_id::text));
  select count(*) into recent
  from public.posts
  where user_id = new.user_id
    and created_at > now() - interval '10 minutes';
  if recent >= 10 then
    raise exception 'You are sharing too fast. Wait a few minutes and try again.'
      using errcode = 'P0001', hint = 'rate_limited';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit
  before insert on public.posts
  for each row execute function public.enforce_post_rate_limit();

-- Friend requests: stamped, and at most 30 sent per person in any hour, so
-- nobody can mass-request (and mass-notify) every account.
create index if not exists friendships_requester_created_idx
  on public.friendships (requester_id, created_at desc);

create or replace function public.enforce_friend_request_rate_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  recent int;
begin
  new.created_at := now();
  perform pg_advisory_xact_lock(hashtext('friend:' || new.requester_id::text));
  select count(*) into recent
  from public.friendships
  where requester_id = new.requester_id
    and created_at > now() - interval '1 hour';
  if recent >= 30 then
    raise exception 'You sent a lot of friend requests. Wait a while and try again.'
      using errcode = 'P0001', hint = 'rate_limited';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_rate_limit on public.friendships;
create trigger friendships_rate_limit
  before insert on public.friendships
  for each row execute function public.enforce_friend_request_rate_limit();

-- Avatars: only the image types and size the app accepts (5 MB), enforced by
-- Storage itself, so the bucket can't host other files.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'avatars';

-- ============================================================================
-- song clips (2026-10-07): the 15 or 30 seconds of the song a post plays.
-- Only where the clip starts and how long it is; the audio comes from Spotify.
-- Set when the post is created and never changed, so no update grant.
-- ============================================================================
alter table public.posts add column if not exists clip_start_ms integer;
alter table public.posts add column if not exists clip_length_s smallint;

alter table public.posts drop constraint if exists posts_clip_check;
alter table public.posts add constraint posts_clip_check check (
  (clip_start_ms is null and clip_length_s is null)
  or (
    spotify_track_id is not null
    and clip_start_ms between 0 and 7200000
    and clip_length_s in (15, 30)
  )
);

-- ============================================================================
-- mural (2026-10-08): the banner and widgets people put on their profile.
-- One jsonb value per profile, public like the bio. The app checks every field
-- when it reads it (web/js/mural.js), so here it only has to stay an object of
-- a sane size: 8 widgets at their fullest come to about 22 KB.
-- ============================================================================
alter table public.profiles add column if not exists mural jsonb;

alter table public.profiles drop constraint if exists profiles_mural_check;
alter table public.profiles add constraint profiles_mural_check check (
  mural is null
  or (jsonb_typeof(mural) = 'object' and octet_length(mural::text) <= 32768)
);

grant update (mural) on public.profiles to authenticated;
