const postService = require("../services/post.service");
const notificationService = require("../services/notification.service");
const { validationResult } = require("express-validator");
const ResponseUtil = require("../utils/response.util");

class PostController {
  /**
   * Get all posts (for admin dashboard)
   * GET /api/posts
   */
  async getAllPosts(req, res, next) {
    try {
      const userId = req.user.id;
      const organizationId = req.user.organization_id;

      console.log('📋 getAllPosts - User context:', {
        userId,
        organizationId,
        current_organization_id: req.user.current_organization_id,
        organization_role: req.user.organization_role
      });

      if (!organizationId) {
        console.error('❌ getAllPosts - No organization_id found for user:', userId);
        return ResponseUtil.error(res, "User not associated with an organization. Please complete onboarding or join an organization.", 400);
      }

      const posts = await postService.getAllPosts(userId, organizationId);

      return ResponseUtil.success(res, "Posts retrieved successfully", {
        posts,
        count: posts.length,
      });
    } catch (error) {
      console.error("Get all posts controller error:", error);
      next(error);
    }
  }

  /**
   * Get posts by board
   * GET /api/boards/:slug/posts
   */
  async getPostsByBoard(req, res, next) {
    try {
      const { slug } = req.params;
      const filters = {
        status: req.query.status,
        search: req.query.search,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        sortBy: req.query.sortBy,
        sortOrder: req.query.sortOrder,
      };

      // Get organization ID from req.organization (set by injectOrganization middleware)
      const organizationId = req.organization?.id || req.user?.current_organization_id;

      console.log(`🔍 Fetching posts for board: ${slug}, organization: ${organizationId}`);

      const posts = await postService.getPostsByBoard(slug, filters, organizationId);

      return ResponseUtil.success(res, "Posts retrieved successfully", {
        posts,
        count: posts.length,
      });
    } catch (error) {
      if (error.message === "Board not found") {
        return ResponseUtil.error(res, "Board not found", 404);
      }
      console.error("Get posts controller error:", error);
      next(error);
    }
  }

  /**
   * Get single post
   * GET /api/posts/:id
   */
  async getPost(req, res, next) {
    try {
      const { id } = req.params;
      const post = await postService.getPostById(id);

      return ResponseUtil.success(res, "Post retrieved successfully", { post });
    } catch (error) {
      if (error.message === "Post not found") {
        return ResponseUtil.error(res, "Post not found", 404);
      }
      console.error("Get post controller error:", error);
      next(error);
    }
  }

  /**
   * Create post
   * POST /api/boards/:slug/posts
   */
  async createPost(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { slug } = req.params;
      const { title, description, images, category } = req.body;

      // Validate images if provided
      if (images) {
        if (!Array.isArray(images)) {
          return ResponseUtil.error(res, "Images must be an array", 400);
        }
        if (images.length > 5) {
          return ResponseUtil.error(res, "Maximum 5 images allowed per post", 400);
        }
      }

      // Get board ID from slug
      const { data: board } = await require("../config/supabase.config")
        .supabaseAdmin.from("boards")
        .select("id")
        .eq("slug", slug)
        .single();

      if (!board) {
        return ResponseUtil.error(res, "Board not found", 404);
      }

      // Capture frontend origin for webhook URL generation
      const frontendOrigin = req.headers['origin'] || req.headers['referer']?.replace(/\/$/, '') || null;

      const post = await postService.createPost({
        board_id: board.id,
        title,
        description,
        author_id: req.user.id,
        images: images || [], // ✅ Pass images array
        category: category || null, // ✅ Pass category
        frontendOrigin,
      });

      return ResponseUtil.success(
        res,
        "Post created successfully",
        { post },
        201,
      );
    } catch (error) {
      console.error("Create post controller error:", error);
      next(error);
    }
  }

  /**
   * Update post
   * PUT /api/posts/:id
   */
  async updatePost(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const updates = req.body;

      // Get old post for status comparison
      const oldPost = await postService.getPostById(id);
      const oldStatus = oldPost?.status;

      const frontendOrigin = req.headers['origin'] || req.headers['referer']?.replace(/\/$/, '') || null;

      const post = await postService.updatePost(
        id,
        updates,
        req.user.id,
        req.user.organization_role,
        frontendOrigin,
      );

      // 🔄 SYNC STATUS TO ROADMAP ITEMS (if status changed)
      if (updates.status && updates.status !== oldStatus) {
        console.log(`🔄 Post ${id} status changed: ${oldStatus} → ${updates.status}`);
        postService.syncPostStatusToRoadmaps(id, updates.status)
          .then(() => console.log('✅ Roadmap items synced'))
          .catch(err => console.error('❌ Failed to sync roadmap items:', err));
      }

      // Check if status changed to 'completed' and queue notification
      if (updates.status && oldStatus !== 'completed' && updates.status === 'completed') {
        console.log(`🔔 Post ${id} marked as completed, queuing notification...`);
        notificationService.queueNotification(id, oldStatus, 'completed')
          .then(() => console.log('✅ Notification queued successfully'))
          .catch(err => console.error('❌ Failed to queue notification:', err));
      }

      return ResponseUtil.success(res, "Post updated successfully", { post });
    } catch (error) {
      if (error.message === "Post not found") {
        return ResponseUtil.error(res, "Post not found", 404);
      }
      if (error.message === "Access denied") {
        return ResponseUtil.error(res, "Access denied", 403);
      }
      console.error("Update post controller error:", error);
      next(error);
    }
  }

  /**
   * Update post status (admin only)
   * PATCH /api/posts/:id/status
   */
  async updatePostStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status, note } = req.body;

      if (!status) {
        return ResponseUtil.error(res, "Status is required", 400);
      }

      // Get old post for status comparison
      const oldPost = await postService.getPostById(id);
      const oldStatus = oldPost?.status;

      const frontendOrigin = req.headers['origin'] || req.headers['referer']?.replace(/\/$/, '') || null;

      const post = await postService.updatePostStatus(
        id,
        status,
        req.user.id,
        note,
        frontendOrigin,
      );

      // 🔄 SYNC STATUS TO ROADMAP ITEMS
      if (status !== oldStatus) {
        console.log(`🔄 Post ${id} status changed: ${oldStatus} → ${status}`);
        postService.syncPostStatusToRoadmaps(id, status)
          .then(() => console.log('✅ Roadmap items synced'))
          .catch(err => console.error('❌ Failed to sync roadmap items:', err));
      }

      // Check if status changed to 'completed' and queue notification
      if (oldStatus !== 'completed' && status === 'completed') {
        console.log(`🔔 Post ${id} status changed to completed, queuing notification...`);
        notificationService.queueNotification(id, oldStatus, 'completed')
          .then(() => console.log('✅ Notification queued successfully'))
          .catch(err => console.error('❌ Failed to queue notification:', err));
      }

      return ResponseUtil.success(res, "Status updated successfully", { post });
    } catch (error) {
      if (error.message === "Post not found") {
        return ResponseUtil.error(res, "Post not found", 404);
      }
      console.error("Update status controller error:", error);
      next(error);
    }
  }

  /**
   * Delete post
   * DELETE /api/posts/:id
   */
  async deletePost(req, res, next) {
    try {
      const { id } = req.params;

      await postService.deletePost(id, req.user.id, req.user.organization_role);

      return ResponseUtil.success(res, "Post deleted successfully");
    } catch (error) {
      if (error.message === "Post not found") {
        return ResponseUtil.error(res, "Post not found", 404);
      }
      if (error.message === "Access denied") {
        return ResponseUtil.error(res, "Access denied", 403);
      }
      console.error("Delete post controller error:", error);
      next(error);
    }
  }

  /**
   * Toggle upvote
   * POST /api/posts/:id/upvote
   * Supports both logged-in users (user_id) and external tracked users (tracking_code)
   */
  async toggleUpvote(req, res, next) {
    try {
      console.log('🎯 toggleUpvote controller called for user:', req.user?.email);
      const { id } = req.params;
      
      // Get tracking_code from request body (for external tracked users)
      const trackingCode = req.body?.tracking_code || null;
      
      const result = await postService.toggleUpvote(id, req.user?.id, trackingCode);

      return ResponseUtil.success(res, "Upvote toggled", result);
    } catch (error) {
      console.error("Toggle upvote controller error:", error);
      next(error);
    }
  }

  /**
   * Get comments (with user's like status)
   * GET /api/posts/:id/comments
   */
  async getComments(req, res, next) {
    try {
      const { id } = req.params;
      // Support both authenticated users and guests (req.user may be undefined for public access)
      const userId = req.user ? req.user.id : null;
      const comments = await postService.getComments(id, userId);

      return ResponseUtil.success(res, "Comments retrieved successfully", {
        comments,
        count: comments.length,
      });
    } catch (error) {
      console.error("Get comments controller error:", error);
      next(error);
    }
  }

  /**
   * Add comment (supports replies via parent_id)
   * POST /api/posts/:id/comments
   * Supports both logged-in users (user_id) and external tracked users (tracking_code)
   */
  async addComment(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { content, parent_id, tracking_code } = req.body;
      const isAdmin = req.user?.organization_role === "admin" || req.user?.organization_role === "owner";

      const comment = await postService.addComment(
        id,
        content,
        req.user?.id,
        isAdmin,
        parent_id || null,
        tracking_code || null,
      );

      return ResponseUtil.success(
        res,
        "Comment added successfully",
        { comment },
        201,
      );
    } catch (error) {
      console.error("Add comment controller error:", error);
      next(error);
    }
  }

  /**
   * Toggle like on a comment
   * POST /api/posts/:postId/comments/:commentId/like
   */
  async toggleCommentLike(req, res, next) {
    try {
      const { commentId } = req.params;
      const result = await postService.toggleCommentLike(commentId, req.user.id);

      return ResponseUtil.success(
        res,
        result.liked ? "Comment liked successfully" : "Comment unliked successfully",
        result,
      );
    } catch (error) {
      console.error("Toggle comment like controller error:", error);
      next(error);
    }
  }

  /**
   * Delete comment
   * DELETE /api/posts/:postId/comments/:commentId
   */
  async deleteComment(req, res, next) {
    try {
      const { commentId } = req.params;

      await postService.deleteComment(commentId, req.user.id, req.user.organization_role);

      return ResponseUtil.success(res, "Comment deleted successfully");
    } catch (error) {
      if (error.message === "Comment not found") {
        return ResponseUtil.error(res, "Comment not found", 404);
      }
      if (error.message === "Access denied") {
        return ResponseUtil.error(res, "Access denied", 403);
      }
      console.error("Delete comment controller error:", error);
      next(error);
    }
  }

  /**
   * Get public roadmap posts (posts with roadmap statuses from public boards)
   * GET /api/public/roadmap
   */
  async getPublicRoadmapPosts(req, res, next) {
    try {
      // Get subdomain from request (multiple sources)
      const subdomain = req.headers['x-subdomain'] || 
                        req.headers['x-organization-subdomain'] || 
                        req.subdomain ||
                        req.organization?.subdomain;
      
      if (!subdomain) {
        console.error('❌ No subdomain found in request:', {
          headers: req.headers,
          subdomain: req.subdomain,
          organization: req.organization
        });
        return ResponseUtil.error(res, "Organization subdomain not found", 400);
      }

      console.log('📍 Getting public roadmap posts for subdomain:', subdomain);

      const filters = {
        status: req.query.status, // Can filter by specific statuses
        category: req.query.category,
      };

      const posts = await postService.getPublicRoadmapPosts(subdomain, filters);

      return ResponseUtil.success(res, "Public roadmap posts retrieved successfully", {
        posts,
        count: posts.length,
      });
    } catch (error) {
      console.error("Get public roadmap posts controller error:", error);
      next(error);
    }
  }
}

module.exports = new PostController();
