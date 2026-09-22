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

    async accept(friendshipId) {
      const { error } = await supabaseClient
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendshipId);
      if (error) throw error;
    },

    async remove(friendshipId) {
      const { error } = await supabaseClient
        .from('friendships')
        .delete()
        .eq('id', friendshipId);
      if (error) throw error;
    }
  },

  posts: {
    async list(limit) {
      const { data, error } = await supabaseClient
        .from('posts')
        .select('*, author:user_id(id, username, name, avatar_url), reactions(*), comments(*, author:user_id(id, username, name))')
        .order('created_at', { ascending: false })
        .limit(limit || 30);
      if (error) throw error;
      return data;
    },

    async create(userId, { trackTitle, artist, album, artSeed, note }) {
      const { data, error } = await supabaseClient
        .from('posts')
        .insert({ user_id: userId, track_title: trackTitle, artist, album, art_seed: artSeed || 1, note })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async remove(postId) {
      const { data, error } = await supabaseClient.from('posts').delete().eq('id', postId).select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Post not found, or you are not allowed to delete it.');
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
    async add(postId, userId, content) {
      const { data, error } = await supabaseClient
        .from('comments')
        .insert({ post_id: postId, user_id: userId, content })
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }
};
