const postService = require("../services/post.service");
const { validationResult } = require("express-validator");
const ResponseUtil = require("../utils/response.util");

class PostController {
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

      const posts = await postService.getPostsByBoard(slug, filters);

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
      const { title, description } = req.body;

      // Get board ID from slug
      const { data: board } = await require("../config/supabase.config")
        .supabaseAdmin.from("boards")
        .select("id")
        .eq("slug", slug)
        .single();

      if (!board) {
        return ResponseUtil.error(res, "Board not found", 404);
      }

      const post = await postService.createPost({
        board_id: board.id,
        title,
        description,
        author_id: req.user.id,
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

      const post = await postService.updatePost(
        id,
        updates,
        req.user.id,
        req.user.role,
      );

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

      const post = await postService.updatePostStatus(
        id,
        status,
        req.user.id,
        note,
      );

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

      await postService.deletePost(id, req.user.id, req.user.role);

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
   */
  async toggleUpvote(req, res, next) {
    try {
      const { id } = req.params;
      const result = await postService.toggleUpvote(id, req.user.id);

      return ResponseUtil.success(res, "Upvote toggled", result);
    } catch (error) {
      console.error("Toggle upvote controller error:", error);
      next(error);
    }
  }

  /**
   * Get comments
   * GET /api/posts/:id/comments
   */
  async getComments(req, res, next) {
    try {
      const { id } = req.params;
      const comments = await postService.getComments(id);

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
   * Add comment
   * POST /api/posts/:id/comments
   */
  async addComment(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { content } = req.body;
      const isAdmin = req.user.role === "admin";

      const comment = await postService.addComment(
        id,
        content,
        req.user.id,
        isAdmin,
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
   * Delete comment
   * DELETE /api/posts/:postId/comments/:commentId
   */
  async deleteComment(req, res, next) {
    try {
      const { commentId } = req.params;

      await postService.deleteComment(commentId, req.user.id, req.user.role);

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
}

module.exports = new PostController();
