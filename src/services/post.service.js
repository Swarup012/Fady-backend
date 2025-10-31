const { supabaseAdmin } = require("../config/supabase.config");

class PostService {
  /**
   * Get all posts for a board
   */
  async getPostsByBoard(boardSlug, filters = {}) {
    try {
      // Get board first
      const { data: board, error: boardError } = await supabaseAdmin
        .from("boards")
        .select("id")
        .eq("slug", boardSlug)
        .single();

      if (boardError || !board) {
        throw new Error("Board not found");
      }

      let query = supabaseAdmin
        .from("posts")
        .select(
          `
          *,
          author:users!author_id(id, name, email),
          board:boards!board_id(id, name, slug, color, icon)
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
      const sortBy = filters.sortBy || "created_at";
      const sortOrder = filters.sortOrder || "desc";

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
      return data;
    } catch (error) {
      console.error("❌ Get posts error:", error);
      throw error;
    }
  }

  /**
   * Get single post by ID
   */
  async getPostById(postId) {
    try {
      const { data, error } = await supabaseAdmin
        .from("posts")
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url),
          board:boards!board_id(id, name, slug, color, icon, is_private)
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
      return data;
    } catch (error) {
      console.error("❌ Get post error:", error);
      throw error;
    }
  }

  /**
   * Create new post
   */
  async createPost({ board_id, title, description, author_id }) {
    try {
      const { data, error } = await supabaseAdmin
        .from("posts")
        .insert([
          {
            board_id,
            title,
            description: description || null,
            author_id,
            status: "open",
            upvotes: 0,
            comment_count: 0,
            is_pinned: false,
            is_archived: false,
          },
        ])
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
      return data;
    } catch (error) {
      console.error("❌ Create post error:", error);
      throw error;
    }
  }

  /**
   * Update post
   */
  async updatePost(postId, updates, userId, userRole) {
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

      // Only author or admin can update
      if (userRole !== "admin" && post.author_id !== userId) {
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
      return data;
    } catch (error) {
      console.error("❌ Update post error:", error);
      throw error;
    }
  }

  /**
   * Update post status (admin only)
   */
  async updatePostStatus(postId, newStatus, userId, note = null) {
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
      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("author_id, title")
        .eq("id", postId)
        .single();

      if (!post) {
        throw new Error("Post not found");
      }

      if (userRole !== "admin" && post.author_id !== userId) {
        throw new Error("Access denied");
      }

      const { error } = await supabaseAdmin
        .from("posts")
        .delete()
        .eq("id", postId);

      if (error) throw error;

      console.log(`✅ Post deleted: ${post.title}`);
      return true;
    } catch (error) {
      console.error("❌ Delete post error:", error);
      throw error;
    }
  }

  /**
   * Toggle upvote
   */
  async toggleUpvote(postId, userId) {
    try {
      // Check if already upvoted
      const { data: existing } = await supabaseAdmin
        .from("upvotes")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        // Remove upvote
        await supabaseAdmin.from("upvotes").delete().eq("id", existing.id);

        console.log("✅ Upvote removed");
        return { upvoted: false };
      } else {
        // Add upvote
        await supabaseAdmin
          .from("upvotes")
          .insert([{ post_id: postId, user_id: userId }]);

        console.log("✅ Upvote added");
        return { upvoted: true };
      }
    } catch (error) {
      console.error("❌ Toggle upvote error:", error);
      throw error;
    }
  }

  /**
   * Get comments for a post
   */
  async getComments(postId) {
    try {
      const { data, error } = await supabaseAdmin
        .from("comments")
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url, role)
        `,
        )
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} comments`);
      return data;
    } catch (error) {
      console.error("❌ Get comments error:", error);
      throw error;
    }
  }

  /**
   * Add comment
   */
  async addComment(postId, content, userId, isAdmin = false) {
    try {
      const { data, error } = await supabaseAdmin
        .from("comments")
        .insert([
          {
            post_id: postId,
            author_id: userId,
            content,
            is_admin: isAdmin,
          },
        ])
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url, role)
        `,
        )
        .single();

      if (error) throw error;

      console.log("✅ Comment added");
      return data;
    } catch (error) {
      console.error("❌ Add comment error:", error);
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
        .select("author_id")
        .eq("id", commentId)
        .single();

      if (!comment) {
        throw new Error("Comment not found");
      }

      if (userRole !== "admin" && comment.author_id !== userId) {
        throw new Error("Access denied");
      }

      const { error } = await supabaseAdmin
        .from("comments")
        .delete()
        .eq("id", commentId);

      if (error) throw error;

      console.log("✅ Comment deleted");
      return true;
    } catch (error) {
      console.error("❌ Delete comment error:", error);
      throw error;
    }
  }
}

module.exports = new PostService();
