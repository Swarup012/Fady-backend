const boardService = require("../services/board.service");
const { validationResult } = require("express-validator");
const ResponseUtil = require("../utils/response.util");
const { supabaseAdmin } = require("../config/supabase.config");

class BoardController {
  async getAllBoards(req, res, next) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;

      console.log('🎯 getAllBoards controller:');
      console.log('   User ID:', userId);
      console.log('   User Role:', userRole);
      console.log('   User Org Role:', req.user.organization_role);
      console.log('   Current Org ID:', req.user.current_organization_id);

      const boards = await boardService.getAllBoards(userId, userRole);

      return ResponseUtil.success(res, "Boards retrieved successfully", {
        boards,
        count: boards.length,
        // Include organization info in response
        organization: req.organization ? {
          id: req.organization.id,
          name: req.organization.name,
          subdomain: req.organization.subdomain,
          plan: req.organization.plan
        } : null
      });
    } catch (error) {
      console.error("❌ Get all boards controller error:", error);
      console.error("   Error message:", error.message);
      console.error("   Error stack:", error.stack);
      next(error);
    }
  }

  async getBoardBySlug(req, res, next) {
    try {
      const { slug } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      const board = await boardService.getBoardBySlug(slug, userId, userRole);

      return ResponseUtil.success(res, "Board retrieved successfully", {
        board,
      });
    } catch (error) {
      if (error.message === "Board not found") {
        return ResponseUtil.error(res, "Board not found", 404);
      }
      if (error.message === "Access denied to this private board") {
        return ResponseUtil.error(res, "Access denied", 403);
      }
      console.error("Get board controller error:", error);
      next(error);
    }
  }

  async getPublicBoards(req, res, next) {
    try {
      const { data, error } = await supabaseAdmin
        .from("boards")
        .select("*")
        .eq("is_private", false)
        .order("created_at", { ascending: false });

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} public boards`);

      return ResponseUtil.success(res, "Public boards retrieved", {
        boards: data,
        count: data.length,
      });
    } catch (error) {
      console.error("Get public boards error:", error);
      next(error);
    }
  }

  /**
   * Get single PUBLIC board by slug (no authentication required)
   * GET /api/public/boards/:slug
   */
  async getPublicBoardBySlug(req, res, next) {
    try {
      const { slug } = req.params;

      const { data: board, error } = await supabaseAdmin
        .from("boards")
        .select("*")
        .eq("slug", slug)
        .eq("is_private", false)
        .single();

      if (error || !board) {
        return ResponseUtil.error(res, "Board not found or is private", 404);
      }

      console.log(`✅ Retrieved public board: ${slug}`);

      return ResponseUtil.success(res, "Board retrieved successfully", {
        board,
      });
    } catch (error) {
      console.error("Get public board by slug error:", error);
      next(error);
    }
  }

  /**
   * Get posts from a PUBLIC board (no authentication required)
   * GET /api/public/boards/:slug/posts
   */
  async getPublicBoardPosts(req, res, next) {
    try {
      const { slug } = req.params;

      // Get board and check if it's public
      const { data: board, error: boardError } = await supabaseAdmin
        .from("boards")
        .select("*")
        .eq("slug", slug)
        .eq("is_private", false)
        .single();

      if (boardError || !board) {
        return ResponseUtil.error(res, "Board not found or is private", 404);
      }

      // Get posts from this board
      const { data: posts, error: postsError } = await supabaseAdmin
        .from("posts")
        .select(
          `
           *,
           author:users!author_id(id, name, email),
           board:boards!board_id(id, name, slug, color, icon)
         `,
        )
        .eq("board_id", board.id)
        .eq("is_archived", false)
        .order("created_at", { ascending: false });

      if (postsError) throw postsError;

      console.log(
        `✅ Retrieved ${posts.length} posts from public board: ${slug}`,
      );

      return ResponseUtil.success(res, "Posts retrieved", {
        posts,
        count: posts.length,
      });
    } catch (error) {
      console.error("Get public board posts error:", error);
      next(error);
    }
  }

  /**
   * Get single post from PUBLIC board (no authentication required)
   * GET /api/public/posts/:id
   */
  async getPublicPost(req, res, next) {
    try {
      const { id } = req.params;

      const { data: post, error } = await supabaseAdmin
        .from("posts")
        .select(
          `
           *,
           author:users!author_id(id, name, email, avatar_url),
           board:boards!board_id(id, name, slug, color, icon, is_private)
         `,
        )
        .eq("id", id)
        .single();

      if (error || !post) {
        return ResponseUtil.error(res, "Post not found", 404);
      }

      // Check if board is public
      if (post.board?.is_private) {
        return ResponseUtil.error(res, "This post is in a private board", 403);
      }

      return ResponseUtil.success(res, "Post retrieved", { post });
    } catch (error) {
      console.error("Get public post error:", error);
      next(error);
    }
  }

  async getCategories(req, res, next) {
    try {
      const { data, error } = await supabaseAdmin
        .from("board_categories")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} categories`);

      return ResponseUtil.success(res, "Categories retrieved", {
        categories: data,
        count: data.length,
      });
    } catch (error) {
      console.error("Get categories error:", error);
      // If table doesn't exist, return default categories
      const defaultCategories = [
        {
          id: "1",
          name: "Feature Requests",
          slug: "feature-requests",
          icon: "💡",
          color: "#6366f1",
        },
        {
          id: "2",
          name: "Bug Reports",
          slug: "bug-reports",
          icon: "🐛",
          color: "#ef4444",
        },
        {
          id: "3",
          name: "General Feedback",
          slug: "general-feedback",
          icon: "💬",
          color: "#10b981",
        },
        {
          id: "4",
          name: "Questions",
          slug: "questions",
          icon: "❓",
          color: "#f59e0b",
        },
        {
          id: "5",
          name: "Announcements",
          slug: "announcements",
          icon: "📢",
          color: "#8b5cf6",
        },
        { id: "6", name: "Ideas", slug: "ideas", icon: "💭", color: "#ec4899" },
        {
          id: "7",
          name: "Support",
          slug: "support",
          icon: "🆘",
          color: "#14b8a6",
        },
        {
          id: "8",
          name: "Documentation",
          slug: "documentation",
          icon: "📚",
          color: "#06b6d4",
        },
      ];

      return ResponseUtil.success(res, "Default categories retrieved", {
        categories: defaultCategories,
        count: defaultCategories.length,
      });
    }
  }

  async createBoard(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, is_private, color, icon, category } = req.body;
      const owner_id = req.user.id;

      // Get user's organization_id (if they have one)
      let organization_id = null;
      if (req.user.organization_id) {
        organization_id = req.user.organization_id;
      }

      const board = await boardService.createBoard({
        name,
        description,
        is_private,
        color,
        icon,
        category,
        owner_id,
        organization_id,
      });

      return ResponseUtil.success(
        res,
        "Board created successfully",
        { board },
        201,
      );
    } catch (error) {
      console.error("Create board controller error:", error);
      next(error);
    }
  }

  async updateBoard(req, res, next) {
    try {
      // ✅ ADMIN ONLY CHECK
      if (req.user.role !== "admin") {
        return ResponseUtil.error(res, "Only admins can update boards", 403);
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const updates = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      const board = await boardService.updateBoard(
        id,
        updates,
        userId,
        userRole,
      );

      return ResponseUtil.success(res, "Board updated successfully", {
        board,
      });
    } catch (error) {
      if (error.message === "Board not found") {
        return ResponseUtil.error(res, "Board not found", 404);
      }
      if (error.message === "Access denied") {
        return ResponseUtil.error(res, "Access denied", 403);
      }
      console.error("Update board controller error:", error);
      next(error);
    }
  }

  async deleteBoard(req, res, next) {
    try {
      // ✅ ADMIN ONLY CHECK
      if (req.user.role !== "admin") {
        return ResponseUtil.error(res, "Only admins can delete boards", 403);
      }

      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      await boardService.deleteBoard(id, userId, userRole);

      return ResponseUtil.success(res, "Board deleted successfully");
    } catch (error) {
      if (error.message === "Board not found") {
        return ResponseUtil.error(res, "Board not found", 404);
      }
      if (error.message === "Access denied") {
        return ResponseUtil.error(res, "Access denied", 403);
      }
      console.error("Delete board controller error:", error);
      next(error);
    }
  }

  async checkSlug(req, res, next) {
    try {
      const { slug } = req.params;
      const available = await boardService.checkSlugAvailability(slug);

      return ResponseUtil.success(res, "Slug checked", {
        slug,
        available,
      });
    } catch (error) {
      console.error("Check slug controller error:", error);
      next(error);
    }
  }
}

module.exports = new BoardController();
