const { supabaseAdmin } = require("../config/supabase.config");
const cache = require("./redis.service");
const dashboardService = require("./dashboard.service");
const { emitPostUpvoted, emitPostCreated, emitPostUpdated, emitPostDeleted, emitPostCommentCount } = require("../socket/handlers/post.handler");
const { emitCommentNew, emitCommentUpdated, emitCommentDeleted, emitCommentLiked } = require("../socket/handlers/comment.handler");
const {
  emitPostCreatedWebhook,
  emitPostUpdatedWebhook,
  emitPostStatusChangedWebhook,
  emitPostDeletedWebhook,
  emitCommentCreatedWebhook,
  emitVoteCreatedWebhook,
} = require("./webhook-events");

class PostService {
  /**
   * Get all posts (for admin dashboard)
   * 🔴 CACHED: TTL 5 minutes (300 seconds)
   */
  async getAllPosts(userId, organizationId) {
    try {
      // 🔴 CACHE KEY: posts:org:{orgId}:all
      const cacheKey = `posts:org:${organizationId}:all`;
      
      // Try to get from cache first
      const cachedPosts = await cache.get(cacheKey);
      if (cachedPosts) {
        console.log(`🔴 Posts cache HIT for org: ${organizationId} (${cachedPosts.length} posts)`);
        return cachedPosts;
      }

      console.log(`❌ Posts cache MISS for org: ${organizationId} - fetching from database`);

      let query = supabaseAdmin
        .from("posts")
        .select(
          `
          *,
          author:users!author_id(id, name, email),
          board:boards!board_id(id, name, slug, icon)
        `,
        )
        .eq("is_archived", false)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} posts for organization`);
      
      // 🔴 Cache the result for 5 minutes (300 seconds)
      await cache.set(cacheKey, data, 300);
      console.log(`🔴 Posts cached for org: ${organizationId}`);
      
      return data;
    } catch (error) {
      console.error("❌ Get all posts error:", error);
      throw error;
    }
  }

  /**
   * Get all posts for a board
   * 🔴 CACHED: TTL 5 minutes
   */
  async getPostsByBoard(boardSlug, filters = {}, organizationId = null) {
    try {
      // 🔴 CACHE KEY: posts:board:{slug}:{sortBy}:{status}:{search}:{organizationId}
      const sortBy = filters.sortBy || "created_at";
      const status = filters.status || "all";
      const search = filters.search || "none";
      const sortOrder = filters.sortOrder || "desc";
      const orgKey = organizationId || "none";
      
      const cacheKey = `posts:board:${boardSlug}:${sortBy}:${sortOrder}:${status}:${search}:${orgKey}`;
      
      // Try to get from cache first
      const cachedPosts = await cache.get(cacheKey);
      if (cachedPosts) {
        console.log(`🔴 Post list cache HIT for board: ${boardSlug} (${cachedPosts.length} posts)`);
        return cachedPosts;
      }

      console.log(`❌ Post list cache MISS for board: ${boardSlug}`);

      // Get board first - filter by organization if provided
      let boardQuery = supabaseAdmin
        .from("boards")
        .select("id")
        .eq("slug", boardSlug);

      if (organizationId) {
        boardQuery = boardQuery.eq("organization_id", organizationId);
      }

      const { data: board, error: boardError } = await boardQuery.single();

      if (boardError || !board) {
        console.error(`❌ Board not found - slug: ${boardSlug}, organization_id: ${organizationId}`, boardError);
        throw new Error("Board not found");
      }

      let query = supabaseAdmin
        .from("posts")
        .select(
          `
          *,
          author:users!author_id(id, name, email),
          board:boards!board_id(id, name, slug, icon)
        `,
        )
        .eq("board_id", board.id)
        .eq("is_archived", false);

      // Apply filters
      if (filters.status) {
        query = query.eq("status", filters.status);
      }

      if (filters.search) {
        query = query.or(
          `title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`,
        );
      }

      if (filters.startDate) {
        query = query.gte("created_at", filters.startDate);
      }

      if (filters.endDate) {
        query = query.lte("created_at", filters.endDate);
      }

      // Sorting
      if (sortBy === "upvotes") {
        query = query.order("upvotes", { ascending: sortOrder === "asc" });
      } else if (sortBy === "comments") {
        query = query.order("comment_count", {
          ascending: sortOrder === "asc",
        });
      } else {
        query = query.order("created_at", { ascending: sortOrder === "asc" });
      }

      const { data, error } = await query;

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} posts for board: ${boardSlug}`);
      
      // 🔴 Cache the result for 5 minutes (300 seconds)
      await cache.set(cacheKey, data, 300);
      
      return data;
    } catch (error) {
      console.error("❌ Get posts error:", error);
      throw error;
    }
  }

  /**
   * Get single post by ID
   * 🔴 CACHED: TTL 10 minutes
   */
  async getPostById(postId) {
    try {
      // 🔴 CACHE KEY: post:{id}
      const cacheKey = `post:${postId}`;
      
      // Try to get from cache first
      const cachedPost = await cache.get(cacheKey);
      if (cachedPost) {
        console.log(`🔴 Post cache HIT for: ${cachedPost.title}`);
        return cachedPost;
      }

      console.log(`❌ Post cache MISS for ID: ${postId}`);

      const { data, error } = await supabaseAdmin
        .from("posts")
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url),
          board:boards!board_id(id, name, slug, icon, is_private)
        `,
        )
        .eq("id", postId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          throw new Error("Post not found");
        }
        throw error;
      }

      console.log(`✅ Retrieved post: ${data.title}`);
      
      // 🔴 Cache the result for 10 minutes (600 seconds)
      await cache.set(cacheKey, data, 600);
      
      return data;
    } catch (error) {
      console.error("❌ Get post error:", error);
      throw error;
    }
  }

  /**
   * Create new post
   */
  async createPost({ board_id, title, description, author_id, images, frontendOrigin = null }) {
    try {
      // Validate images array
      if (images) {
        if (!Array.isArray(images)) {
          throw new Error('Images must be an array');
        }
        if (images.length > 5) {
          throw new Error('Maximum 5 images allowed per post');
        }
        // Validate each image URL
        for (const url of images) {
          if (typeof url !== 'string' || !url.startsWith('http')) {
            throw new Error('Invalid image URL format');
          }
        }
      }

      // Get board to find its organization
      const { data: board, error: boardError } = await supabaseAdmin
        .from('boards')
        .select('organization_id')
        .eq('id', board_id)
        .single();

      if (boardError) {
        console.warn('⚠️ Could not find board organization:', boardError);
      }

      const postData = {
        board_id,
        title,
        description: description || null,
        author_id,
        status: "open",
        upvotes: 0,
        comment_count: 0,
        is_pinned: false,
        is_archived: false,
        images: images || [], // ✅ Add images array
      };

      // Add organization_id if board has one
      if (board && board.organization_id) {
        postData.organization_id = board.organization_id;
        console.log(`✅ Adding organization_id to post: ${board.organization_id}`);
      }

      const { data, error } = await supabaseAdmin
        .from("posts")
        .insert([postData])
        .select(
          `
          *,
          author:users!author_id(id, name, email),
          board:boards!board_id(id, name, slug)
        `,
        )
        .single();

      if (error) throw error;

      console.log(`✅ Post created: ${data.title}`);
      
      // 🔴 Invalidate post list cache for this board
      if (data.board && data.board.slug) {
        await cache.deletePattern(`posts:board:${data.board.slug}:*`);
        console.log(`🗑️  Post list cache invalidated for board: ${data.board.slug}`);
      }
      
      // � Invalidate organization posts cache (for admin dashboard)
      if (data.organization_id) {
        await cache.delete(`posts:org:${data.organization_id}:all`);
        await dashboardService.invalidateCache(data.organization_id);
        console.log(`🗑️  Organization posts cache invalidated: ${data.organization_id}`);
      }
      
      // 📡 Emit real-time event to board viewers
      if (data.board && data.board.slug) {
        emitPostCreated(data.board.slug, data);
        console.log(`📡 Emitted post:created event for board: ${data.board.slug}`);
      }

      // 🔗 Fire webhook: post.created
      emitPostCreatedWebhook(data.organization_id, data, frontendOrigin);

      return data;
    } catch (error) {
      console.error("❌ Create post error:", error);
      throw error;
    }
  }

  /**
   * Update post
   */
  async updatePost(postId, updates, userId, userRole, frontendOrigin = null) {
    try {
      // Check permissions
      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("author_id")
        .eq("id", postId)
        .single();

      if (!post) {
        throw new Error("Post not found");
      }

      // Only author, admin, or owner can update
      if (userRole !== "admin" && userRole !== "owner" && post.author_id !== userId) {
        throw new Error("Access denied");
      }

      const { data, error } = await supabaseAdmin
        .from("posts")
        .update(updates)
        .eq("id", postId)
        .select(
          `
          *,
          author:users!author_id(id, name, email),
          board:boards!board_id(id, name, slug)
        `,
        )
        .single();

      if (error) throw error;

      console.log(`✅ Post updated: ${data.title}`);
      
      // 🔴 Invalidate caches
      // 1. Invalidate this specific post's cache
      await cache.delete(`post:${postId}`);
      // 2. Invalidate post list cache for this board
      if (data.board && data.board.slug) {
        await cache.deletePattern(`posts:board:${data.board.slug}:*`);
        console.log(`🗑️  Post caches invalidated for: ${data.board.slug}`);
      }
      // 3. Invalidate organization posts cache (for admin dashboard)
      if (data.organization_id) {
        await cache.delete(`posts:org:${data.organization_id}:all`);
        await dashboardService.invalidateCache(data.organization_id);
        console.log(`🗑️  Organization posts cache invalidated: ${data.organization_id}`);
      }

      // 🔗 Fire webhook: post.updated
      emitPostUpdatedWebhook(data.organization_id, data, updates, frontendOrigin);

      return data;
    } catch (error) {
      console.error("❌ Update post error:", error);
      throw error;
    }
  }

  /**
   * Update post status (admin only)
   */
  async updatePostStatus(postId, newStatus, userId, note = null, frontendOrigin = null) {
    try {
      // Get current status
      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("status")
        .eq("id", postId)
        .single();

      if (!post) {
        throw new Error("Post not found");
      }

      const oldStatus = post.status;

      // Update post status
      const { data, error } = await supabaseAdmin
        .from("posts")
        .update({ status: newStatus })
        .eq("id", postId)
        .select()
        .single();

      if (error) throw error;

      // Record status change
      await supabaseAdmin.from("status_history").insert([
        {
          post_id: postId,
          old_status: oldStatus,
          new_status: newStatus,
          changed_by: userId,
          note,
        },
      ]);

      console.log(`✅ Post status updated: ${oldStatus} → ${newStatus}`);
      
      // 🗑️ Invalidate organization posts cache (for admin dashboard)
      if (data.organization_id) {
        await cache.delete(`posts:org:${data.organization_id}:all`);
        await dashboardService.invalidateCache(data.organization_id);
        console.log(`🗑️  Organization posts cache invalidated: ${data.organization_id}`);
      }
      
      // 📡 Emit real-time event to board viewers
      // Get board slug for the post
      const { data: postWithBoard } = await supabaseAdmin
        .from("posts")
        .select("board:boards!board_id(slug)")
        .eq("id", postId)
        .single();
      
      if (postWithBoard && postWithBoard.board && postWithBoard.board.slug) {
        emitPostUpdated(postId, postWithBoard.board.slug, { status: newStatus });
        console.log(`📡 Emitted post:status_changed event for board: ${postWithBoard.board.slug}`);
      }

      // 🔗 Fire webhook: post.status_changed
      const postForWebhook = {
        id: postId,
        title: data.title,
        board: postWithBoard?.board || null,
      };
      emitPostStatusChangedWebhook(data.organization_id, postForWebhook, oldStatus, newStatus, frontendOrigin);

      return data;
    } catch (error) {
      console.error("❌ Update status error:", error);
      throw error;
    }
  }

  /**
   * Delete post
   */
  async deletePost(postId, userId, userRole) {
    try {
      // Get post details including board info before deletion
      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("author_id, title, board_id, board:boards!board_id(slug)")
        .eq("id", postId)
        .single();

      if (!post) {
        throw new Error("Post not found");
      }

      if (userRole !== "admin" && userRole !== "owner" && post.author_id !== userId) {
        throw new Error("Access denied");
      }

      const { error } = await supabaseAdmin
        .from("posts")
        .delete()
        .eq("id", postId);

      if (error) throw error;

      console.log(`✅ Post deleted: ${post.title}`);
      
      // 🔴 Invalidate caches
      // 1. Invalidate this specific post's cache
      await cache.delete(`post:${postId}`);
      // 2. Invalidate post list cache for this board
      if (post.board && post.board.slug) {
        await cache.deletePattern(`posts:board:${post.board.slug}:*`);
        console.log(`🗑️  Post caches invalidated for board: ${post.board.slug}`);
      }
      // 3. Invalidate organization posts cache (for admin dashboard)
      if (post.organization_id) {
        await cache.delete(`posts:org:${post.organization_id}:all`);
        await dashboardService.invalidateCache(post.organization_id);
        console.log(`🗑️  Organization posts cache invalidated: ${post.organization_id}`);
      }
      
      // 📡 Emit real-time event to board viewers
      if (post.board && post.board.slug) {
        emitPostDeleted(postId, post.board.slug);
        console.log(`📡 Emitted post:deleted event for board: ${post.board.slug}`);
      }

      // 🔗 Fire webhook: post.deleted
      emitPostDeletedWebhook(post.organization_id, postId, post.title, post.board?.slug);

      return true;
    } catch (error) {
      console.error("❌ Delete post error:", error);
      throw error;
    }
  }

  /**
   * Toggle upvote
   * @param {string} postId - Post ID
   * @param {string} userId - User ID (for logged-in users)
   * @param {string} trackingCode - Tracking code (for external tracked users)
   */
  async toggleUpvote(postId, userId, trackingCode = null) {
    try {
      // Build query to check if already upvoted
      let existingQuery = supabaseAdmin
        .from("upvotes")
        .select("id")
        .eq("post_id", postId);
      
      // Check by user_id OR tracking_code
      if (userId) {
        existingQuery = existingQuery.eq("user_id", userId);
      } else if (trackingCode) {
        existingQuery = existingQuery.eq("tracking_code", trackingCode);
      } else {
        throw new Error("Either userId or trackingCode is required");
      }
      
      const { data: existing } = await existingQuery.maybeSingle();

      if (existing) {
        // Remove upvote
        await supabaseAdmin.from("upvotes").delete().eq("id", existing.id);

        // Get updated upvote count
        const { count } = await supabaseAdmin
          .from("upvotes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", postId);

        console.log("✅ Upvote removed");
        
        // 🔴 Invalidate post cache (upvote count changed)
        await cache.delete(`post:${postId}`);
        
        // Get board slug and organization_id for cache invalidation
        const { data: postWithBoard } = await supabaseAdmin
          .from("posts")
          .select("board:boards!board_id(slug), organization_id")
          .eq("id", postId)
          .single();
        
        // 🔴 Invalidate organization posts cache (upvote count changed)
        if (postWithBoard?.organization_id) {
          await cache.delete(`posts:org:${postWithBoard.organization_id}:all`);
          await dashboardService.invalidateCache(postWithBoard.organization_id);
        }
        
        const boardSlug = postWithBoard?.board?.slug;
        
        // 📡 Emit Socket.io event
        emitPostUpvoted(postId, false, count || 0, boardSlug);
        
        return { upvoted: false };
      } else {
        // Add upvote
        const upvoteData = { post_id: postId };
        if (userId) upvoteData.user_id = userId;
        if (trackingCode) upvoteData.tracking_code = trackingCode;
        
        await supabaseAdmin
          .from("upvotes")
          .insert([upvoteData]);

        // Get updated upvote count
        const { count } = await supabaseAdmin
          .from("upvotes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", postId);

        console.log("✅ Upvote added");
        
        // 🔴 Invalidate post cache (upvote count changed)
        await cache.delete(`post:${postId}`);
        
        // Get board slug and organization_id for cache invalidation
        const { data: postWithBoard } = await supabaseAdmin
          .from("posts")
          .select("board:boards!board_id(slug), organization_id")
          .eq("id", postId)
          .single();
        
        // 🔴 Invalidate organization posts cache (upvote count changed)
        if (postWithBoard?.organization_id) {
          await cache.delete(`posts:org:${postWithBoard.organization_id}:all`);
          await dashboardService.invalidateCache(postWithBoard.organization_id);
        }
        
        const boardSlug = postWithBoard?.board?.slug;
        
        // 📡 Emit Socket.io event
        emitPostUpvoted(postId, true, count || 0, boardSlug);

        // 🔗 Fire webhook: vote.created (only when upvote is added, not removed)
        emitVoteCreatedWebhook(
          postWithBoard?.organization_id,
          postId,
          null, // post title not fetched here — kept lightweight
          userId,
          trackingCode
        );

        return { upvoted: true };
      }
    } catch (error) {
      console.error("❌ Toggle upvote error:", error);
      throw error;
    }
  }

  /**
   * Get comments for a post (with likes and user's like status)
   * 🔴 CACHED: TTL 5 minutes (user-specific)
   */
  async getComments(postId, userId = null) {
    try {
      // 🔴 CACHE KEY: comments:post:{postId}:user:{userId}
      // Include userId because like status is user-specific
      const userIdKey = userId || 'anonymous';
      const cacheKey = `comments:post:${postId}:user:${userIdKey}`;
      
      // Try to get from cache first
      const cachedComments = await cache.get(cacheKey);
      if (cachedComments) {
        console.log(`🔴 Comments cache HIT for post: ${postId} (${cachedComments.length} comments)`);
        return cachedComments;
      }

      console.log(`❌ Comments cache MISS for post: ${postId}`);

      const { data, error } = await supabaseAdmin
        .from("comments")
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url)
        `,
        )
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // If userId is provided, get user's likes for these comments
      if (userId && data.length > 0) {
        const commentIds = data.map(c => c.id);
        const { data: likes } = await supabaseAdmin
          .from("comment_likes")
          .select("comment_id")
          .eq("user_id", userId)
          .in("comment_id", commentIds);

        const likedCommentIds = new Set(likes?.map(l => l.comment_id) || []);
        
        // Add user_has_liked field to each comment
        data.forEach(comment => {
          comment.user_has_liked = likedCommentIds.has(comment.id);
        });
      }

      console.log(`✅ Retrieved ${data.length} comments`);
      
      // 🔴 Cache the result for 5 minutes (300 seconds)
      await cache.set(cacheKey, data, 300);
      
      return data;
    } catch (error) {
      console.error("❌ Get comments error:", error);
      throw error;
    }
  }

  /**
   * Add comment (supports replies via parent_id)
   * @param {string} postId - Post ID
   * @param {string} content - Comment content
   * @param {string} userId - User ID (for logged-in users)
   * @param {boolean} isAdmin - Is admin comment
   * @param {string} parentId - Parent comment ID (for replies)
   * @param {string} trackingCode - Tracking code (for external tracked users)
   */
  async addComment(postId, content, userId, isAdmin = false, parentId = null, trackingCode = null) {
    try {
      const commentData = {
        post_id: postId,
        content,
        is_admin: isAdmin,
        parent_id: parentId,
      };
      
      // Add user_id or tracking_code
      if (userId) commentData.author_id = userId;
      if (trackingCode) commentData.tracking_code = trackingCode;
      
      const { data, error } = await supabaseAdmin
        .from("comments")
        .insert([commentData])
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url)
        `,
        )
        .single();

      if (error) throw error;

      console.log("✅ Comment added");
      
      // 🔴 Invalidate caches
      // 1. Invalidate post cache (comment count changed)
      await cache.delete(`post:${postId}`);
      // 2. Invalidate ALL comment caches for this post (all users)
      await cache.deletePattern(`comments:post:${postId}:*`);
      console.log(`🗑️  Comment caches invalidated for post: ${postId}`);
      
      // 📡 Emit Socket.io event
      emitCommentNew(postId, data);

      // 🔗 Fire webhook: comment.created
      // Fetch post info for the webhook payload
      const { data: postForComment } = await supabaseAdmin
        .from("posts")
        .select("id, title, organization_id")
        .eq("id", postId)
        .single();
      if (postForComment) {
        emitCommentCreatedWebhook(postForComment.organization_id, data, postForComment);
      }

      // Also update comment count for the post
      const { count } = await supabaseAdmin
        .from("comments")
        .select("*", { count: "exact", head: true })
        .eq("post_id", postId);
      
      // Get board slug for emitting to board room
      const { data: postWithBoard } = await supabaseAdmin
        .from("posts")
        .select("board:boards!board_id(slug)")
        .eq("id", postId)
        .single();
      
      const boardSlug = postWithBoard?.board?.slug;
      emitPostCommentCount(postId, count || 0, boardSlug);
      
      return data;
    } catch (error) {
      console.error("❌ Add comment error:", error);
      throw error;
    }
  }

  /**
   * Toggle like on a comment
   */
  async toggleCommentLike(commentId, userId) {
    try {
      // Get comment's post_id for cache invalidation
      const { data: comment } = await supabaseAdmin
        .from("comments")
        .select("post_id")
        .eq("id", commentId)
        .single();

      // Check if user already liked the comment
      const { data: existingLike } = await supabaseAdmin
        .from("comment_likes")
        .select("id")
        .eq("comment_id", commentId)
        .eq("user_id", userId)
        .single();

      if (existingLike) {
        // Unlike - remove the like
        const { error } = await supabaseAdmin
          .from("comment_likes")
          .delete()
          .eq("comment_id", commentId)
          .eq("user_id", userId);

        if (error) throw error;

        console.log("✅ Comment unliked");
        
        // Get updated like count
        const { count: unlikeCount } = await supabaseAdmin
          .from("comment_likes")
          .select("*", { count: "exact", head: true })
          .eq("comment_id", commentId);
        
        // 🔴 Invalidate comment caches for all users (like count changed)
        if (comment?.post_id) {
          await cache.deletePattern(`comments:post:${comment.post_id}:*`);
          
          // 📡 Emit Socket.io event
          emitCommentLiked(comment.post_id, commentId, false, unlikeCount || 0);
        }
        
        return { liked: false };
      } else {
        // Like - add the like
        const { error } = await supabaseAdmin
          .from("comment_likes")
          .insert([
            {
              comment_id: commentId,
              user_id: userId,
            },
          ]);

        if (error) throw error;

        console.log("✅ Comment liked");
        
        // Get updated like count
        const { count: likeCount } = await supabaseAdmin
          .from("comment_likes")
          .select("*", { count: "exact", head: true })
          .eq("comment_id", commentId);
        
        // 🔴 Invalidate comment caches for all users (like count changed)
        if (comment?.post_id) {
          await cache.deletePattern(`comments:post:${comment.post_id}:*`);
          
          // 📡 Emit Socket.io event
          emitCommentLiked(comment.post_id, commentId, true, likeCount || 0);
        }
        
        return { liked: true };
      }
    } catch (error) {
      console.error("❌ Toggle comment like error:", error);
      throw error;
    }
  }

  /**
   * Delete comment
   */
  async deleteComment(commentId, userId, userRole) {
    try {
      const { data: comment } = await supabaseAdmin
        .from("comments")
        .select("author_id, post_id")
        .eq("id", commentId)
        .single();

      if (!comment) {
        throw new Error("Comment not found");
      }

      if (userRole !== "admin" && userRole !== "owner" && comment.author_id !== userId) {
        throw new Error("Access denied");
      }

      const { error } = await supabaseAdmin
        .from("comments")
        .delete()
        .eq("id", commentId);

      if (error) throw error;

      console.log("✅ Comment deleted");
      
      // 🔴 Invalidate caches
      if (comment.post_id) {
        // 1. Invalidate post cache (comment count changed)
        await cache.delete(`post:${comment.post_id}`);
        // 2. Invalidate ALL comment caches for this post (all users)
        await cache.deletePattern(`comments:post:${comment.post_id}:*`);
        console.log(`🗑️  Comment caches invalidated for post: ${comment.post_id}`);
        
        // 📡 Emit Socket.io event
        emitCommentDeleted(comment.post_id, commentId);
        
        // Also update comment count for the post
        const { count } = await supabaseAdmin
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("post_id", comment.post_id);
        
        // Get board slug for emitting to board room
        const { data: postWithBoard } = await supabaseAdmin
          .from("posts")
          .select("board:boards!board_id(slug)")
          .eq("id", comment.post_id)
          .single();
        
        const boardSlug = postWithBoard?.board?.slug;
        emitPostCommentCount(comment.post_id, count || 0, boardSlug);
      }
      
      return true;
    } catch (error) {
      console.error("❌ Delete comment error:", error);
      throw error;
    }
  }

  /**
   * Sync post status to all linked roadmap items
   * When a post status changes, update all roadmap_items that link to it
   */
  async syncPostStatusToRoadmaps(postId, newStatus) {
    try {
      console.log(`🔄 Syncing post ${postId} status (${newStatus}) to roadmap items...`);

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
      const roadmapStatus = statusMap[newStatus] || 'planned';

      // Find all roadmap items linked to this post
      const { data: items, error: fetchError } = await supabaseAdmin
        .from('roadmap_items')
        .select('id, roadmap_id, organization_id')
        .eq('linked_post_id', postId);

      if (fetchError) {
        console.error('Error fetching linked roadmap items:', fetchError);
        throw fetchError;
      }

      if (!items || items.length === 0) {
        console.log(`ℹ️ No roadmap items linked to post ${postId}`);
        return;
      }

      console.log(`📝 Found ${items.length} roadmap item(s) to update to status: ${roadmapStatus}`);

      // Update all linked roadmap items with the new status
      const { error: updateError } = await supabaseAdmin
        .from('roadmap_items')
        .update({ status: roadmapStatus })
        .eq('linked_post_id', postId);

      if (updateError) {
        console.error('Error updating roadmap items:', updateError);
        throw updateError;
      }

      // Invalidate roadmap caches for affected organizations
      const cache = require('./redis.service');
      const orgIds = [...new Set(items.map(item => item.organization_id))];
      for (const orgId of orgIds) {
        await cache.delete(`roadmaps:org:${orgId}`);
        await cache.deletePattern(`roadmap:org:${orgId}:*`);
      }

      console.log(`✅ Successfully synced status to ${items.length} roadmap item(s)`);
      return items.length;
    } catch (error) {
      console.error('❌ syncPostStatusToRoadmaps error:', error);
      throw error;
    }
  }

  /**
   * Get public roadmap posts (posts with roadmap statuses from public boards)
   * Returns posts with statuses: planned, in-progress, under-review, completed
   */
  async getPublicRoadmapPosts(subdomain, filters = {}) {
    try {
      console.log('📍 Getting public roadmap posts for subdomain:', subdomain);

      // Get organization by subdomain
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('id, name')
        .eq('subdomain', subdomain)
        .single();

      if (orgError || !org) {
        throw new Error('Organization not found');
      }

      // Build query for posts with roadmap statuses from public boards
      let query = supabaseAdmin
        .from('posts')
        .select(`
          *,
          author:users!author_id(id, name, email, avatar_url),
          board:boards!board_id(id, name, slug, icon, is_private)
        `)
        .eq('organization_id', org.id)
        .eq('is_archived', false)
        .in('status', ['planned', 'in-progress', 'under-review', 'completed']);

      // Apply filters
      if (filters.status) {
        const statuses = filters.status.split(',');
        query = query.in('status', statuses);
      }
      if (filters.category) {
        query = query.eq('category', filters.category);
      }

      // Order by status priority and then by votes
      query = query.order('created_at', { ascending: false });

      const { data: posts, error } = await query;

      if (error) throw error;

      // Filter out posts from private boards
      const publicPosts = posts.filter(post => !post.board?.is_private);

      console.log(`✅ Retrieved ${publicPosts.length} public roadmap posts (filtered from ${posts.length} total)`);

      return publicPosts;
    } catch (error) {
      console.error('❌ Get public roadmap posts error:', error);
      throw error;
    }
  }
}

module.exports = new PostService();
