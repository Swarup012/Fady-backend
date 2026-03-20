
// src/services/roadmap.service.js
const cache = require("./redis.service");

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
   * GET: All roadmap items across ALL boards (Admin view)
   * =============================== */
  getAllRoadmapItems: async (organizationId, filters = {}) => {
    try {
      console.log('Service: Fetching ALL roadmap items for organization:', organizationId);
      console.log('Service: Filters:', filters);

      // 🔴 Build cache key based on filters
      const statusKey = filters.status?.length > 0 ? filters.status.join(',') : 'all';
      const categoryKey = filters.category || 'all';
      const publicKey = filters.isPublic !== undefined ? filters.isPublic : 'all';
      const boardKey = filters.boardSlug || 'all';
      const postKey = filters.postId || 'all';
      const cacheKey = `roadmap:org:${organizationId}:status:${statusKey}:cat:${categoryKey}:public:${publicKey}:board:${boardKey}:post:${postKey}`;

      // 🔴 Check cache first (skip cache if filtering by postId for real-time data)
      if (!filters.postId) {
        const cachedData = await cache.get(cacheKey);
        if (cachedData) {
          console.log(`🔴 Roadmap cache HIT for org: ${organizationId} (${cachedData.items.length} items)`);
          return cachedData;
        }
      }

      console.log(`❌ Roadmap cache MISS for org: ${organizationId}`);

      // Build query for all roadmap items in the organization
      let query = supabase
        .from('roadmap_items')
        .select(`
          *,
          created_by:users!roadmap_items_created_by_fkey(id, name, email, avatar_url),
          board:boards!roadmap_items_board_id_fkey(id, name, slug, icon),
          votes:roadmap_votes(count),
          comments:roadmap_comments(count),
          linked_feedback:roadmap_feedback_links(
            feedback:posts(id, title, status, upvotes)
          )
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      // Apply filters
      if (filters.status?.length > 0) query = query.in('status', filters.status);
      if (filters.category) query = query.eq('category', filters.category);
      if (filters.isPublic !== undefined) query = query.eq('is_public', filters.isPublic);
      if (filters.postId) query = query.eq('linked_post_id', filters.postId);
      if (filters.boardSlug) {
        // If filtering by specific board, join with boards table
        const { data: board } = await supabaseAdmin
          .from('boards')
          .select('id')
          .eq('slug', filters.boardSlug)
          .single();
        if (board) {
          query = query.eq('board_id', board.id);
        }
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      // Transform data
      const items = (data || []).map((item) => ({
        ...item,
        vote_count: item.votes?.[0]?.count || 0,
        comment_count: item.comments?.[0]?.count || 0,
        linked_feedback: item.linked_feedback?.map((link) => link.feedback) || [],
      }));

      const result = { items, count: items.length };

      // 🔴 Cache the result (10 minutes TTL)
      await cache.set(cacheKey, result, 600);

      return result;
    } catch (error) {
      console.error('Error in getAllRoadmapItems:', error);
      throw error;
    }
  },

  /** ===============================
   * GET: All roadmap items (with filters)
   * =============================== */
  getRoadmapItems: async (boardSlug, filters = {}) => {
    try {
      console.log('Service: Fetching roadmap items for board:', boardSlug);

      // 🔴 Build cache key based on filters
      const statusKey = filters.status?.length > 0 ? filters.status.join(',') : 'all';
      const categoryKey = filters.category || 'all';
      const publicKey = filters.isPublic !== undefined ? filters.isPublic : 'all';
      const cacheKey = `roadmap:board:${boardSlug}:status:${statusKey}:cat:${categoryKey}:public:${publicKey}`;

      // 🔴 Check cache first
      const cachedData = await cache.get(cacheKey);
      if (cachedData) {
        console.log(`🔴 Roadmap cache HIT for board: ${boardSlug} (${cachedData.items.length} items)`);
        return cachedData;
      }

      console.log(`❌ Roadmap cache MISS for board: ${boardSlug}`);

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

      const result = { items, count: items.length };

      // 🔴 Cache the result (10 minutes TTL)
      await cache.set(cacheKey, result, 600);

      return result;
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
      // 🔴 Check cache first
      const cacheKey = `roadmap:item:${itemId}`;
      const cachedItem = await cache.get(cacheKey);
      if (cachedItem) {
        console.log(`🔴 Roadmap item cache HIT: ${itemId}`);
        return cachedItem;
      }

      console.log(`❌ Roadmap item cache MISS: ${itemId}`);

      const { data, error } = await supabase
        .from('roadmap_items')
        .select(`
          *,
          created_by:users!roadmap_items_created_by_fkey(id, name, email, avatar_url),
          votes:roadmap_votes(count),
          comments:roadmap_comments(
            *,
            author:users(id, name, email, avatar_url)
          ),
          updates:roadmap_updates(
            *,
            author:users(id, name, email, avatar_url)
          ),
          linked_feedback:roadmap_feedback_links(
            feedback:posts(id, title, status, upvotes)
          ),
          board:boards(id, name, slug, icon)
        `)
        .eq('id', itemId)
        .single();

      if (error) throw new Error(error.message);

      const result = {
        ...data,
        vote_count: data.votes?.[0]?.count || 0,
        comment_count: data.comments?.length || 0,
        linked_feedback: data.linked_feedback?.map((link) => link.feedback) || [],
      };

      // 🔴 Cache the result (15 minutes TTL - longer since less frequently updated)
      await cache.set(cacheKey, result, 900);

      return result;
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
        .select('id, organization_id')
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
          board:boards(id, name, slug, icon)
        `)
        .single();

      if (error) throw new Error(error.message);

      // 🔴 Invalidate roadmap caches for this board and organization
      await cache.deletePattern(`roadmap:board:${boardSlug}:*`);
      await cache.deletePattern(`roadmap:org:${board.organization_id}:*`);
      console.log(`🗑️  Roadmap caches invalidated for board: ${boardSlug}`);

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
      // Get current item to find board info for cache invalidation
      const { data: currentItem } = await supabaseAdmin
        .from('roadmap_items')
        .select('board:boards(slug, organization_id)')
        .eq('id', itemId)
        .single();

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

      // 🔴 Invalidate caches: specific item + board lists + org lists
      await cache.delete(`roadmap:item:${itemId}`);
      if (currentItem?.board) {
        await cache.deletePattern(`roadmap:board:${currentItem.board.slug}:*`);
        await cache.deletePattern(`roadmap:org:${currentItem.board.organization_id}:*`);
      }
      console.log(`🗑️  Roadmap caches invalidated for item: ${itemId}`);

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
      // Get item to find board info for cache invalidation
      const { data: item } = await supabaseAdmin
        .from('roadmap_items')
        .select('board:boards(slug, organization_id)')
        .eq('id', itemId)
        .single();

      const { error } = await supabaseAdmin.from('roadmap_items').delete().eq('id', itemId);
      if (error) throw new Error(error.message);

      // 🔴 Invalidate caches: specific item + board lists + org lists
      await cache.delete(`roadmap:item:${itemId}`);
      if (item?.board) {
        await cache.deletePattern(`roadmap:board:${item.board.slug}:*`);
        await cache.deletePattern(`roadmap:org:${item.board.organization_id}:*`);
      }
      console.log(`🗑️  Roadmap caches invalidated for deleted item: ${itemId}`);

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
        
        // 🔴 Invalidate item cache (vote count changed)
        await cache.delete(`roadmap:item:${itemId}`);
        
        return { voted: false };
      } else {
        await supabaseAdmin
          .from('roadmap_votes')
          .insert([{ roadmap_item_id: itemId, user_id: userId }]);
        
        // 🔴 Invalidate item cache (vote count changed)
        await cache.delete(`roadmap:item:${itemId}`);
        
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
          author:users(id, name, email, avatar_url),
          replies:roadmap_comments!parent_id(
            *,
            author:users(id, name, email, avatar_url)
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
          author:users(id, name, email, avatar_url)
        `)
        .single();

      if (error) throw new Error(error.message);

      // 🔴 Invalidate item cache (comment count changed)
      await cache.delete(`roadmap:item:${itemId}`);

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
      // Get comment to find roadmap item for cache invalidation
      const { data: comment } = await supabaseAdmin
        .from('roadmap_comments')
        .select('roadmap_item_id')
        .eq('id', commentId)
        .single();

      const { error } = await supabaseAdmin.from('roadmap_comments').delete().eq('id', commentId);
      if (error) throw new Error(error.message);

      // 🔴 Invalidate item cache (comment count changed)
      if (comment?.roadmap_item_id) {
        await cache.delete(`roadmap:item:${comment.roadmap_item_id}`);
      }

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

      // 🔴 Invalidate item cache (new update added)
      await cache.delete(`roadmap:item:${itemId}`);

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

      // 🔴 Invalidate item cache (linked feedback changed)
      await cache.delete(`roadmap:item:${itemId}`);

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

      // 🔴 Invalidate item cache (linked feedback changed)
      await cache.delete(`roadmap:item:${itemId}`);

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
      // Get board info from first item for cache invalidation
      if (itemIds.length > 0) {
        const { data: item } = await supabaseAdmin
          .from('roadmap_items')
          .select('board:boards(slug, organization_id)')
          .eq('id', itemIds[0])
          .single();
        
        const updates = itemIds.map((id, index) => ({ id, order_index: index }));
        const { error } = await supabaseAdmin.from('roadmap_items').upsert(updates);
        if (error) throw new Error(error.message);

        // 🔴 Invalidate board and org caches (order changed)
        if (item?.board) {
          await cache.deletePattern(`roadmap:board:${item.board.slug}:*`);
          await cache.deletePattern(`roadmap:org:${item.board.organization_id}:*`);
          console.log(`🗑️  Roadmap caches invalidated after reorder`);
        }
      }
      
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

  /** ===============================
   * MULTI-ROADMAP MANAGEMENT METHODS
   * =============================== */

  /**
   * Get all roadmaps for an organization
   */
  getRoadmaps: async (organizationId) => {
    try {
      console.log('Service: Fetching roadmaps for organization:', organizationId);

      // Cache key
      const cacheKey = `roadmaps:org:${organizationId}`;
      
      // Check cache
      const cachedData = await cache.get(cacheKey);
      if (cachedData) {
        console.log(`🔴 Roadmaps cache HIT for org: ${organizationId}`);
        return cachedData;
      }

      // Use the helper function created in migration
      const { data, error } = await supabaseAdmin
        .rpc('get_roadmaps_with_counts', { org_id: organizationId });

      if (error) {
        console.error('Error fetching roadmaps:', error);
        throw new Error('Failed to fetch roadmaps');
      }

      // Cache for 5 minutes
      await cache.set(cacheKey, data, 300);
      
      return data;
    } catch (error) {
      console.error('Error in getRoadmaps:', error);
      throw error;
    }
  },

  /**
   * Create a new roadmap
   */
  createRoadmap: async ({ organizationId, userId, name, description }) => {
    try {
      console.log('Service: Creating roadmap:', name, 'for org:', organizationId);

      // Verify user is admin/owner
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .single();

      if (memberError || !membership) {
        throw new Error('Not a member of this organization');
      }

      if (!['admin', 'owner'].includes(membership.role)) {
        throw new Error('Only admins and owners can create roadmaps');
      }

      // Check if this is the first roadmap
      const { count: existingCount } = await supabaseAdmin
        .from('roadmaps')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('is_archived', false);

      const isFirstRoadmap = existingCount === 0;

      // Create slug from name
      const slug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        + '-' + Math.random().toString(36).substring(2, 8);

      // Insert roadmap
      const { data: roadmap, error } = await supabaseAdmin
        .from('roadmaps')
        .insert({
          organization_id: organizationId,
          name,
          slug,
          description,
          is_default: isFirstRoadmap,
          is_archived: false
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating roadmap:', error);
        throw new Error('Failed to create roadmap');
      }

      // Invalidate cache
      await cache.delete(`roadmaps:org:${organizationId}`);

      return roadmap;
    } catch (error) {
      console.error('Error in createRoadmap:', error);
      throw error;
    }
  },

  /**
   * Update a roadmap
   */
  updateRoadmap: async ({ roadmapId, organizationId, userId, name, description, is_default }) => {
    try {
      console.log('Service: Updating roadmap:', roadmapId);

      // Get roadmap to verify organization
      const { data: roadmap, error: fetchError } = await supabaseAdmin
        .from('roadmaps')
        .select('organization_id')
        .eq('id', roadmapId)
        .single();

      if (fetchError || !roadmap) {
        throw new Error('Roadmap not found');
      }

      // Verify user is admin/owner
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', roadmap.organization_id)
        .eq('user_id', userId)
        .single();

      if (memberError || !membership) {
        throw new Error('Not a member of this organization');
      }

      if (!['admin', 'owner'].includes(membership.role)) {
        throw new Error('Only admins and owners can update roadmaps');
      }

      // Build update object
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      
      // Handle is_default toggle
      if (is_default === true) {
        // Unset current default
        await supabaseAdmin
          .from('roadmaps')
          .update({ is_default: false })
          .eq('organization_id', roadmap.organization_id);
        
        updates.is_default = true;
      }

      // Update roadmap
      const { data: updated, error } = await supabaseAdmin
        .from('roadmaps')
        .update(updates)
        .eq('id', roadmapId)
        .select()
        .single();

      if (error) {
        console.error('Error updating roadmap:', error);
        throw new Error('Failed to update roadmap');
      }

      // Invalidate cache
      await cache.delete(`roadmaps:org:${roadmap.organization_id}`);

      return updated;
    } catch (error) {
      console.error('Error in updateRoadmap:', error);
      throw error;
    }
  },

  /**
   * Delete (archive) a roadmap
   */
  deleteRoadmap: async ({ roadmapId, organizationId, userId }) => {
    try {
      console.log('Service: Deleting roadmap:', roadmapId);

      // Get roadmap to verify organization
      const { data: roadmap, error: fetchError } = await supabaseAdmin
        .from('roadmaps')
        .select('organization_id, is_default')
        .eq('id', roadmapId)
        .single();

      if (fetchError || !roadmap) {
        throw new Error('Roadmap not found');
      }

      // Verify user is admin/owner
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', roadmap.organization_id)
        .eq('user_id', userId)
        .single();

      if (memberError || !membership) {
        throw new Error('Not a member of this organization');
      }

      if (!['admin', 'owner'].includes(membership.role)) {
        throw new Error('Only admins and owners can delete roadmaps');
      }

      // Archive instead of delete (soft delete)
      const { error } = await supabaseAdmin
        .from('roadmaps')
        .update({ is_archived: true })
        .eq('id', roadmapId);

      if (error) {
        console.error('Error deleting roadmap:', error);
        throw new Error('Failed to delete roadmap');
      }

      // If this was the default roadmap, make another one default
      if (roadmap.is_default) {
        const { data: firstActive } = await supabaseAdmin
          .from('roadmaps')
          .select('id')
          .eq('organization_id', roadmap.organization_id)
          .eq('is_archived', false)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        if (firstActive) {
          await supabaseAdmin
            .from('roadmaps')
            .update({ is_default: true })
            .eq('id', firstActive.id);
        }
      }

      // Invalidate cache
      await cache.delete(`roadmaps:org:${roadmap.organization_id}`);

      return true;
    } catch (error) {
      console.error('Error in deleteRoadmap:', error);
      throw error;
    }
  },

  /**
   * Add a post to a roadmap
   */
  addPostToRoadmap: async ({ postId, roadmapId, organizationId, userId, eta, notes }) => {
    try {
      console.log('Service: Adding post', postId, 'to roadmap', roadmapId);
      console.log('Service: userId:', userId, 'organizationId:', organizationId);

      // Get post details
      const { data: post, error: postError } = await supabaseAdmin
        .from('posts')
        .select('title, description, status, board_id, boards(organization_id)')
        .eq('id', postId)
        .single();

      if (postError || !post) {
        console.error('Post not found:', postError);
        throw new Error('Post not found');
      }

      const postOrgId = post.boards.organization_id;
      console.log('Service: Post organization:', postOrgId);

      // Verify user is member of the post's organization
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', postOrgId)
        .eq('user_id', userId)
        .maybeSingle(); // Use maybeSingle() to avoid error when no row found

      console.log('Service: Membership check:', { membership, memberError, userId, postOrgId });

      if (memberError) {
        console.error('Database error checking membership:', memberError);
        throw new Error('Failed to verify organization membership');
      }

      if (!membership) {
        console.error('User not a member:', { userId, postOrgId });
        throw new Error('Not a member of this organization');
      }

      // Verify roadmap belongs to same organization
      const { data: roadmap, error: roadmapError } = await supabaseAdmin
        .from('roadmaps')
        .select('organization_id')
        .eq('id', roadmapId)
        .single();

      if (roadmapError || !roadmap || roadmap.organization_id !== postOrgId) {
        throw new Error('Roadmap not found or not in same organization');
      }

      // Check if already added to this roadmap
      const { data: existing } = await supabaseAdmin
        .from('roadmap_items')
        .select('id')
        .eq('roadmap_id', roadmapId)
        .eq('linked_post_id', postId)
        .single();

      if (existing) {
        throw new Error('Post already added to this roadmap');
      }

      // Map post status to roadmap status
      // Post statuses: open, under-review, planned, in-progress, completed, closed
      // Roadmap statuses: planned, in_progress, in_review, completed, cancelled
      const statusMap = {
        'open': 'planned',
        'under-review': 'in_review',
        'planned': 'planned',
        'in-progress': 'in_progress',
        'completed': 'completed',
        'closed': 'cancelled'
      };
      const roadmapStatus = statusMap[post.status] || 'planned';

      // Create roadmap item
      const { data: item, error } = await supabaseAdmin
        .from('roadmap_items')
        .insert({
          organization_id: postOrgId,
          board_id: post.board_id,
          roadmap_id: roadmapId,
          linked_post_id: postId,
          title: post.title,
          description: notes || post.description || 'Linked from feedback post',
          status: roadmapStatus,
          target_date: eta || null,
          created_by: userId
        })
        .select()
        .single();

      if (error) {
        console.error('Error adding post to roadmap:', error);
        throw new Error('Failed to add post to roadmap');
      }

      // Invalidate caches
      await cache.delete(`roadmaps:org:${postOrgId}`);
      await cache.deletePattern(`roadmap:org:${postOrgId}:*`);

      return item;
    } catch (error) {
      console.error('Error in addPostToRoadmap:', error);
      throw error;
    }
  },

  /**
   * Remove a post from a roadmap
   */
  removePostFromRoadmap: async ({ postId, roadmapId, organizationId, userId }) => {
    try {
      console.log('Service: Removing post', postId, 'from roadmap', roadmapId);

      // Get the roadmap item
      const { data: item, error: fetchError } = await supabaseAdmin
        .from('roadmap_items')
        .select('id, organization_id')
        .eq('roadmap_id', roadmapId)
        .eq('linked_post_id', postId)
        .single();

      if (fetchError || !item) {
        throw new Error('Post not found in this roadmap');
      }

      // Verify user is member
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', item.organization_id)
        .eq('user_id', userId)
        .single();

      if (memberError || !membership) {
        throw new Error('Not authorized');
      }

      // Delete the roadmap item
      const { error } = await supabaseAdmin
        .from('roadmap_items')
        .delete()
        .eq('id', item.id);

      if (error) {
        console.error('Error removing post from roadmap:', error);
        throw new Error('Failed to remove post from roadmap');
      }

      // Invalidate caches
      await cache.delete(`roadmaps:org:${item.organization_id}`);
      await cache.deletePattern(`roadmap:org:${item.organization_id}:*`);

      return true;
    } catch (error) {
      console.error('Error in removePostFromRoadmap:', error);
      throw error;
    }
  }
};

module.exports = roadmapService;
