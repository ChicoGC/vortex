/* ==========================================================================
   vortex — Supabase data layer
   Wraps auth + queries behind a small `db` object so views.js/app.js never
   talk to the Supabase client directly.
   ========================================================================== */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const db = {
  auth: {
    async signUp(email, password, { username, name }) {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { username, name } }
      });
      if (error) throw error;
      return data;
    },

    async signIn(email, password) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },

    async signOut() {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
    },

    async getSession() {
      const { data } = await supabaseClient.auth.getSession();
      return data.session;
    },

    onChange(callback) {
      supabaseClient.auth.onAuthStateChange((event, session) => callback(event, session));
    }
  },

  profiles: {
    async get(userId) {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return data;
    },

    /* Characters outside this set are stripped: , . : ( ) are reserved in the
       PostgREST or() filter, and % is an ilike wildcard. _ stays because it's
       common in usernames and, as a single-char wildcard, still matches itself. */
    async search(query, excludeId) {
      const q = String(query || '').replace(/[^\p{L}\p{N}\s_\-]/gu, '').trim().slice(0, 40);
      if (q.length < 2) return [];
      let req = supabaseClient
        .from('profiles')
        .select('id, username, name, avatar_url')
        .or('username.ilike.%' + q + '%,name.ilike.%' + q + '%')
        .order('username')
        .limit(10);
      if (excludeId) req = req.neq('id', excludeId);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },

    async update(userId, fields) {
      const { data, error } = await supabaseClient
        .from('profiles')
        .update(fields)
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },

  friends: {
    /* Every relationship the user is part of, pending or accepted, in either direction. */
    async all(userId) {
      const { data, error } = await supabaseClient
        .from('friendships')
        .select('*, requester:requester_id(id, username, name, avatar_url), addressee:addressee_id(id, username, name, avatar_url)')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    async list(userId) {
      const { data, error } = await supabaseClient
        .from('friendships')
        .select('*, requester:requester_id(id, username, name, avatar_url), addressee:addressee_id(id, username, name, avatar_url)')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .eq('status', 'accepted');
      if (error) throw error;
      return data;
    },

    async requests(userId) {
      const { data, error } = await supabaseClient
        .from('friendships')
        .select('*, requester:requester_id(id, username, name, avatar_url)')
        .eq('addressee_id', userId)
        .eq('status', 'pending');
      if (error) throw error;
      return data;
    },

    async send(fromId, toId) {
      const { error } = await supabaseClient
        .from('friendships')
        .insert({ requester_id: fromId, addressee_id: toId });
      if (error) throw error;
    },

    // RLS turns unauthorized writes into silent no-ops, so check a row changed.
    async accept(friendshipId) {
      const { data, error } = await supabaseClient
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendshipId)
        .select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Request not found, or it was not sent to you.');
    },

    async remove(friendshipId) {
      const { data, error } = await supabaseClient
        .from('friendships')
        .delete()
        .eq('id', friendshipId)
        .select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Friendship not found.');
    }
  },

  posts: {
    /* userIds limits the feed to those authors (e.g. you + friends); omit for everyone. */
    async list(limit, userIds) {
      let req = supabaseClient
        .from('posts')
        .select('*, author:user_id(id, username, name, avatar_url), reactions(*), comments(*, author:user_id(id, username, name))')
        .order('created_at', { ascending: false })
        .limit(limit || 30);
      if (userIds) req = req.in('user_id', userIds);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },

    async create(userId, { trackTitle, artist, album, artSeed, note, albumImageUrl, spotifyTrackId }) {
      const { data, error } = await supabaseClient
        .from('posts')
        .insert({
          user_id: userId, track_title: trackTitle, artist, album, art_seed: artSeed || 1, note,
          album_image_url: albumImageUrl || null, spotify_track_id: spotifyTrackId || null
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async setCover(postId, albumImageUrl, spotifyTrackId) {
      const { data, error } = await supabaseClient
        .from('posts')
        .update({ album_image_url: albumImageUrl, spotify_track_id: spotifyTrackId })
        .eq('id', postId)
        .select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Post not found, or it is not yours.');
    },

    async remove(postId) {
      const { data, error } = await supabaseClient.from('posts').delete().eq('id', postId).select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Post not found, or you are not allowed to delete it.');
    }
  },

  listening: {
    /* RLS returns only your row and your friends' (when they share). */
    async list() {
      const { data, error } = await supabaseClient.from('listening_now').select('*');
      if (error) throw error;
      return data;
    },

    async publish(userId, t) {
      const { error } = await supabaseClient.from('listening_now').upsert({
        user_id: userId,
        track_id: t.trackId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        image_url: t.imageUrl,
        is_playing: t.playing,
        progress_ms: t.progressMs,
        duration_ms: t.durationMs
      }, { onConflict: 'user_id' });
      if (error) throw error;
    },

    // Keeps the last track visible to friends as "last played".
    async pause(userId) {
      const { error } = await supabaseClient.from('listening_now').update({ is_playing: false }).eq('user_id', userId);
      if (error) throw error;
    },

    async clear(userId) {
      const { error } = await supabaseClient.from('listening_now').delete().eq('user_id', userId);
      if (error) throw error;
    },

    /* Calls onChange(eventType, newRow, oldRow) for rows this user may see.
       Returns an unsubscribe function. */
    subscribe(onChange) {
      const channel = supabaseClient
        .channel('listening-now')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'listening_now' }, function (payload) {
          onChange(payload.eventType, payload.new, payload.old);
        })
        .subscribe();
      return function () { supabaseClient.removeChannel(channel); };
    }
  },

  taste: {
    /* Your snapshot plus friends who share theirs (RLS decides). */
    async list() {
      const { data, error } = await supabaseClient.from('taste_profiles').select('*');
      if (error) throw error;
      return data;
    },

    async publish(userId, snapshot) {
      const { error } = await supabaseClient.from('taste_profiles').upsert({
        user_id: userId, artists: snapshot.artists, tracks: snapshot.tracks
      }, { onConflict: 'user_id' });
      if (error) throw error;
    },

    async clear(userId) {
      const { error } = await supabaseClient.from('taste_profiles').delete().eq('user_id', userId);
      if (error) throw error;
    }
  },

  stats: {
    /* Totals for the profile: posts shared, and reactions / comments received
       from other people on those posts. Counted server-side (head requests). */
    async forUser(userId) {
      async function count(query) {
        const { count, error } = await query;
        if (error) throw error;
        return count || 0;
      }
      const opts = { count: 'exact', head: true };
      const [posts, reactions, comments] = await Promise.all([
        count(supabaseClient.from('posts').select('id', opts).eq('user_id', userId)),
        count(supabaseClient.from('reactions').select('id, posts!inner(user_id)', opts)
          .eq('posts.user_id', userId).neq('user_id', userId)),
        count(supabaseClient.from('comments').select('id, posts!inner(user_id)', opts)
          .eq('posts.user_id', userId).neq('user_id', userId))
      ]);
      return { posts: posts, reactions: reactions, comments: comments };
    }
  },

  reactions: {
    async toggle(postId, userId, type) {
      const { data: existing } = await supabaseClient
        .from('reactions')
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', userId)
        .eq('type', type)
        .maybeSingle();

      if (existing) {
        const { error } = await supabaseClient.from('reactions').delete().eq('id', existing.id);
        if (error) throw error;
        return false;
      }
      const { error } = await supabaseClient.from('reactions').insert({ post_id: postId, user_id: userId, type });
      if (error) throw error;
      return true;
    }
  },

  comments: {
    async add(postId, userId, content, parentId) {
      const { data, error } = await supabaseClient
        .from('comments')
        .insert({ post_id: postId, user_id: userId, content, parent_id: parentId || null })
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }
};
