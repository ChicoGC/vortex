/* ==========================================================================
   vortex — Supabase data layer
   Wraps auth + queries behind a small `db` object so views.js/app.js never
   talk to the Supabase client directly.
   ========================================================================== */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PERSON_FIELDS = 'id, username, name, avatar_url, pin_track_id, pin_title, pin_artist, pin_image, pin_note, pinned_at';
const POST_SELECT = '*, author:user_id(id, username, name, avatar_url), reactions(*), comments(*, author:user_id(id, username, name, avatar_url))';

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
    },

    async getByUsername(username) {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('username', username)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    /* pin: { trackId, title, artist, image, note } or null to clear. */
    async setPin(userId, pin) {
      const fields = pin
        ? { pin_track_id: pin.trackId || null, pin_title: pin.title, pin_artist: pin.artist,
            pin_image: pin.image || null, pin_note: pin.note || null, pinned_at: new Date().toISOString() }
        : { pin_track_id: null, pin_title: null, pin_artist: null, pin_image: null, pin_note: null, pinned_at: null };
      return db.profiles.update(userId, fields);
    }
  },

  notifications: {
    async list(limit) {
      const { data, error } = await supabaseClient
        .from('notifications')
        .select('*, actor:actor_id(id, username, name, avatar_url), post:post_id(id, track_title, artist, album_image_url, art_seed), comment:comment_id(id, content, parent_id)')
        .order('created_at', { ascending: false })
        .limit(limit || 40);
      if (error) throw error;
      return data;
    },

    async unreadCount() {
      const { count, error } = await supabaseClient
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (error) throw error;
      return count || 0;
    },

    async markAllRead() {
      const { error } = await supabaseClient
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null);
      if (error) throw error;
    },

    /* Calls onInsert() whenever a new notification for this user lands. */
    subscribe(userId, onInsert) {
      const channel = supabaseClient
        .channel('notifications-' + userId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'recipient_id=eq.' + userId },
          function () { onInsert(); })
        .subscribe();
      return function () { supabaseClient.removeChannel(channel); };
    }
  },

  storage: {
    async uploadAvatar(userId, file, ext) {
      const path = userId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const { error } = await supabaseClient.storage.from('avatars')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);
      return { path: path, url: data.publicUrl };
    },

    // Best-effort: removes older avatar files for this user so storage doesn't grow forever.
    async pruneAvatars(userId, keepPath) {
      const { data, error } = await supabaseClient.storage.from('avatars').list(userId);
      if (error || !data) return;
      const stale = data.map(function (f) { return userId + '/' + f.name; }).filter(function (p) { return p !== keepPath; });
      if (stale.length) await supabaseClient.storage.from('avatars').remove(stale);
    }
  },

  friends: {
    /* Every relationship the user is part of, pending or accepted, in either direction. */
    async all(userId) {
      const { data, error } = await supabaseClient
        .from('friendships')
        .select('*, requester:requester_id(' + PERSON_FIELDS + '), addressee:addressee_id(' + PERSON_FIELDS + ')')
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
        .select(POST_SELECT)
        .order('created_at', { ascending: false })
        .limit(limit || 30);
      if (userIds) req = req.in('user_id', userIds);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },

    async get(postId) {
      const { data, error } = await supabaseClient.from('posts').select(POST_SELECT).eq('id', postId).maybeSingle();
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
       from other people on those posts. Counted server-side (head requests).
       since (ISO date) limits every count to rows created after it. */
    async forUser(userId, since) {
      async function count(query) {
        if (since) query = query.gte('created_at', since);
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
