
// src/services/roadmap.service.js
let supabase, supabaseAdmin;
try {
  const supabaseConfig = require('../config/supabase.config.js');
  supabase = supabaseConfig.supabase;
  supabaseAdmin = supabaseConfig.supabaseAdmin;
} catch (error) {
  console.error('Warning: Supabase config not loaded:', error.message);
}

const roadmapService = {
  /** ===============================
   * GET: All roadmap items (with filters)
   * =============================== */
  getRoadmapItems: async (boardSlug, filters = {}) => {
    try {
      console.log('Service: Fetching roadmap items for board:', boardSlug);

      // 1️⃣ Get board ID from slug
      const { data: board, error: boardError } = await supabaseAdmin
        .from('boards')
        .select('id')
        .eq('slug', boardSlug)
        .single();

      if (boardError || !board) {
        throw new Error(`Board with slug '${boardSlug}' not found`);
      }

      // 2️⃣ Build query
      let query = supabase
        .from('roadmap_items')
        .select(`
          *,
          created_by:users!roadmap_items_created_by_fkey(id, name, email, avatar_url),
          votes:roadmap_votes(count),
          comments:roadmap_comments(count),
          linked_feedback:roadmap_feedback_links(
            feedback:posts(id, title, status, upvotes)
          )
        `)
        .eq('board_id', board.id)
        .order('order_index', { ascending: true });

      // 3️⃣ Apply filters
      if (filters.status?.length > 0) query = query.in('status', filters.status);
      if (filters.category) query = query.eq('category', filters.category);
      if (filters.isPublic !== undefined) query = query.eq('is_public', filters.isPublic);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      // 4️⃣ Transform data
      const items = (data || []).map((item) => ({
        ...item,
        vote_count: item.votes?.[0]?.count || 0,
        comment_count: item.comments?.[0]?.count || 0,
        linked_feedback: item.linked_feedback?.map((link) => link.feedback) || [],
      }));

      return { items, count: items.length };
    } catch (error) {
      console.error('Error in getRoadmapItems:', error);
      throw error;
    }
  },

  /** ===============================
   * GET: Single roadmap item by ID
   * =============================== */
  getRoadmapItemById: async (itemId) => {
    try {
      const { data, error } = await supabase
        .from('roadmap_items')
        .select(`
          *,
          created_by:users!roadmap_items_created_by_fkey(id, name, email, avatar_url),
          votes:roadmap_votes(count),
          comments:roadmap_comments(
            *,
            author:users(id, name, email, avatar_url, role)
          ),
          updates:roadmap_updates(
            *,
            author:users(id, name, email, avatar_url)
          ),
          linked_feedback:roadmap_feedback_links(
            feedback:posts(id, title, status, upvotes)
          ),
          board:boards(id, name, slug, color, icon)
        `)
        .eq('id', itemId)
        .single();

      if (error) throw new Error(error.message);

      return {
        ...data,
        vote_count: data.votes?.[0]?.count || 0,
        comment_count: data.comments?.length || 0,
        linked_feedback: data.linked_feedback?.map((link) => link.feedback) || [],
      };
    } catch (error) {
      console.error('Error in getRoadmapItemById:', error);
      throw error;
    }
  },

  /** ===============================
   * POST: Create roadmap item
   * =============================== */
  createRoadmapItem: async (boardSlug, itemData, userId) => {
    try {
      const { data: board, error: boardError } = await supabaseAdmin
        .from('boards')
        .select('id')
        .eq('slug', boardSlug)
        .single();

      if (boardError || !board) throw new Error(`Board '${boardSlug}' not found`);

      // Clean up empty strings to null for optional fields
      const cleanedData = {
        ...itemData,
        target_quarter: itemData.target_quarter || null,
        target_date: itemData.target_date || null,
        category: itemData.category || null,
        board_id: board.id,
        created_by: userId,
      };

      const { data, error } = await supabaseAdmin
        .from('roadmap_items')
        .insert(cleanedData)
        .select(`
          *,
          created_by:users!roadmap_items_created_by_fkey(id, name, email, avatar_url),
          board:boards(id, name, slug, color, icon)
        `)
        .single();

      if (error) throw new Error(error.message);
      return data;
    } catch (error) {
      console.error('Error in createRoadmapItem:', error);
      throw error;
    }
  },

  /** ===============================
   * PUT: Update roadmap item
   * =============================== */
  updateRoadmapItem: async (itemId, updates) => {
    try {
      // Clean up empty strings to null for optional fields
      const cleanedUpdates = { ...updates };
      if (cleanedUpdates.target_quarter === '') cleanedUpdates.target_quarter = null;
      if (cleanedUpdates.target_date === '') cleanedUpdates.target_date = null;
      if (cleanedUpdates.category === '') cleanedUpdates.category = null;

      const { data, error } = await supabaseAdmin
        .from('roadmap_items')
        .update(cleanedUpdates)
        .eq('id', itemId)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    } catch (error) {
      console.error('Error in updateRoadmapItem:', error);
      throw error;
    }
  },

  /** ===============================
   * DELETE: Roadmap item
   * =============================== */
  deleteRoadmapItem: async (itemId) => {
    try {
      const { error } = await supabaseAdmin.from('roadmap_items').delete().eq('id', itemId);
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error) {
      console.error('Error in deleteRoadmapItem:', error);
      throw error;
    }
  },

  /** ===============================
   * POST: Toggle Vote
   * =============================== */
  voteRoadmapItem: async (itemId, userId) => {
    try {
      const { data: existingVote, error: checkError } = await supabase
        .from('roadmap_votes')
        .select('id')
        .eq('roadmap_item_id', itemId)
        .eq('user_id', userId)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') throw new Error(checkError.message);

      if (existingVote) {
        await supabaseAdmin
          .from('roadmap_votes')
          .delete()
          .eq('roadmap_item_id', itemId)
          .eq('user_id', userId);
        return { voted: false };
      } else {
        await supabaseAdmin
          .from('roadmap_votes')
          .insert([{ roadmap_item_id: itemId, user_id: userId }]);
        return { voted: true };
      }
    } catch (error) {
      console.error('Error in voteRoadmapItem:', error);
      throw error;
    }
  },

  /** ===============================
   * GET: Check user vote
   * =============================== */
  hasUserVoted: async (itemId, userId) => {
    try {
      const { data, error } = await supabase
        .from('roadmap_votes')
        .select('id')
        .eq('roadmap_item_id', itemId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return { hasVoted: !!data };
    } catch (error) {
      console.error('Error in hasUserVoted:', error);
      throw error;
    }
  },

  /** ===============================
   * COMMENTS
   * =============================== */
  getComments: async (itemId) => {
    try {
      const { data, error } = await supabase
        .from('roadmap_comments')
        .select(`
          *,
          author:users(id, name, email, avatar_url, role),
          replies:roadmap_comments!parent_id(
            *,
            author:users(id, name, email, avatar_url, role)
          )
        `)
        .eq('roadmap_item_id', itemId)
        .is('parent_id', null)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return { comments: data || [], count: data?.length || 0 };
    } catch (error) {
      console.error('Error in getComments:', error);
      throw error;
    }
  },

  addComment: async (itemId, content, userId, parentId = null) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('roadmap_comments')
        .insert([{ roadmap_item_id: itemId, content, author_id: userId, parent_id: parentId }])
        .select(`
          *,
          author:users(id, name, email, avatar_url, role)
        `)
        .single();

      if (error) throw new Error(error.message);
      return data;
    } catch (error) {
      console.error('Error in addComment:', error);
      throw error;
    }
  },

  updateComment: async (commentId, content) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('roadmap_comments')
        .update({ content })
        .eq('id', commentId)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    } catch (error) {
      console.error('Error in updateComment:', error);
      throw error;
    }
  },

  deleteComment: async (commentId) => {
    try {
      const { error } = await supabaseAdmin.from('roadmap_comments').delete().eq('id', commentId);
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error) {
      console.error('Error in deleteComment:', error);
      throw error;
    }
  },

  /** ===============================
   * ROADMAP UPDATES
   * =============================== */
  addUpdate: async (itemId, updateData, userId) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('roadmap_updates')
        .insert([
          {
            roadmap_item_id: itemId,
            title: updateData.title,
            content: updateData.content,
            type: updateData.type || 'progress',
            author_id: userId,
          },
        ])
        .select(`
          *,
          author:users(id, name, email, avatar_url)
        `)
        .single();

      if (error) throw new Error(error.message);
      return data;
    } catch (error) {
      console.error('Error in addUpdate:', error);
      throw error;
    }
  },

  /** ===============================
   * FEEDBACK LINKS
   * =============================== */
  linkFeedback: async (itemId, feedbackId) => {
    try {
      const { data: existing, error: checkError } = await supabase
        .from('roadmap_feedback_links')
        .select('id')
        .eq('roadmap_item_id', itemId)
        .eq('feedback_id', feedbackId)
        .maybeSingle();

      if (checkError) throw new Error(checkError.message);
      if (existing) throw new Error('Feedback already linked');

      const { error } = await supabaseAdmin
        .from('roadmap_feedback_links')
        .insert([{ roadmap_item_id: itemId, feedback_id: feedbackId }]);

      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error) {
      console.error('Error in linkFeedback:', error);
      throw error;
    }
  },

  unlinkFeedback: async (itemId, feedbackId) => {
    try {
      const { error } = await supabaseAdmin
        .from('roadmap_feedback_links')
        .delete()
        .eq('roadmap_item_id', itemId)
        .eq('feedback_id', feedbackId);

      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error) {
      console.error('Error in unlinkFeedback:', error);
      throw error;
    }
  },

  /** ===============================
   * REORDER + STATS
   * =============================== */
  reorderItems: async (itemIds) => {
    try {
      const updates = itemIds.map((id, index) => ({ id, order_index: index }));
      const { error } = await supabaseAdmin.from('roadmap_items').upsert(updates);
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error) {
      console.error('Error in reorderItems:', error);
      throw error;
    }
  },

  getRoadmapStats: async (boardSlug) => {
    try {
      const { data: board, error: boardError } = await supabase
        .from('boards')
        .select('id')
        .eq('slug', boardSlug)
        .single();

      if (boardError || !board) throw new Error(`Board '${boardSlug}' not found`);

      const { data, error } = await supabase
        .from('roadmap_items')
        .select('status')
        .eq('board_id', board.id);

      if (error) throw new Error(error.message);

      const stats = {
        total: data.length,
        planned: data.filter((i) => i.status === 'planned').length,
        in_progress: data.filter((i) => i.status === 'in_progress').length,
        in_review: data.filter((i) => i.status === 'in_review').length,
        completed: data.filter((i) => i.status === 'completed').length,
        cancelled: data.filter((i) => i.status === 'cancelled').length,
      };

      return stats;
    } catch (error) {
      console.error('Error in getRoadmapStats:', error);
      throw error;
    }
  },
};

module.exports = roadmapService;
