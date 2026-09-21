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

drop policy if exists "users can send friend requests" on public.friendships;
create policy "users can send friend requests"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

drop policy if exists "users can respond to their requests" on public.friendships;
create policy "users can respond to their requests"
  on public.friendships for update
  using (auth.uid() = addressee_id or auth.uid() = requester_id);

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

alter table public.posts enable row level security;

drop policy if exists "posts are publicly readable" on public.posts;
create policy "posts are publicly readable"
  on public.posts for select
  using (true);

drop policy if exists "users can create own posts" on public.posts;
create policy "users can create own posts"
  on public.posts for insert
  with check (auth.uid() = user_id);

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
