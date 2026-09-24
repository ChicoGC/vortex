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

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
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

alter table public.posts enable row level security;

drop policy if exists "posts are publicly readable" on public.posts;
create policy "posts are publicly readable"
  on public.posts for select
  using (true);

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

drop policy if exists "reactions are publicly readable" on public.reactions;
create policy "reactions are publicly readable"
  on public.reactions for select
  using (true);

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

drop policy if exists "comments are publicly readable" on public.comments;
create policy "comments are publicly readable"
  on public.comments for select
  using (true);

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
