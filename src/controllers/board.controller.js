const boardService = require("../services/board.service");
const { validationResult } = require("express-validator");
const ResponseUtil = require("../utils/response.util");
const { supabaseAdmin } = require("../config/supabase.config");
const { EXTERNAL_AUTHOR_SELECT } = require("../services/post.service");

class BoardController {
  async getAllBoards(req, res, next) {
    try {
      const userId = req.user.id;
      const userOrgRole = req.user.organization_role; // owner/admin/member
      const jobRole = req.user.job_role; // founder/designer/developer/etc

      console.log('🎯 getAllBoards controller:');
      console.log('   User ID:', userId);
      console.log('   Organization Role:', userOrgRole);
      console.log('   Job Role:', jobRole);
      console.log('   Current Org ID:', req.user.current_organization_id);

      // ✅ Pass organization_role to determine if filtering should apply
      const boards = await boardService.getAllBoards(userId, jobRole, userOrgRole);

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
      
      // Use organization_role from middleware (owner/admin/member), not job_role (founder/manager/etc)
      // visible_to_roles on boards expects organization roles
      const orgRole = req.organizationRole || req.user?.organization_role || 'member';
      
      // Get organization ID from req.organization (set by injectOrganization middleware)
      const organizationId = req.organization?.id || req.user?.current_organization_id;

      console.log(`🔍 Fetching board: ${slug}, organization: ${organizationId}, org_role: ${orgRole}`);

      const board = await boardService.getBoardBySlug(slug, userId, orgRole, organizationId);

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
      if (error.message === "This board is not visible to your role") {
        return ResponseUtil.error(res, "Access denied: This board is not visible to your role", 403);
      }
      console.error("Get board controller error:", error);
      next(error);
    }
  }

  async getPublicBoards(req, res, next) {
    try {
      // Get organization from subdomain
      const subdomain = req.headers['x-subdomain'];
      
      let query = supabaseAdmin
        .from("boards")
        .select("*")
        .eq("is_private", false);

      // Filter by organization if subdomain is provided
      if (subdomain) {
        // First, get the organization ID from the subdomain
        const { data: orgData, error: orgError } = await supabaseAdmin
          .from("organizations")
          .select("id")
          .eq("subdomain", subdomain)
          .single();

        if (orgError || !orgData) {
          console.log(`⚠️ No organization found for subdomain: ${subdomain}`);
          return ResponseUtil.success(res, "No public boards found", {
            boards: [],
            count: 0,
          });
        }

        query = query.eq("organization_id", orgData.id);
        console.log(`🔍 Filtering boards for organization: ${subdomain} (${orgData.id})`);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} public boards${subdomain ? ` for ${subdomain}` : ''}`);

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
   * Get single PUBLIC board by slug (optional authentication)
   * GET /api/public/boards/:slug
   * - Public users: can only see public boards
   * - Authenticated users (owner/admin): can see private boards from their org
   */
  async getPublicBoardBySlug(req, res, next) {
    try {
      const { slug } = req.params;
      const user = req.user; // May be null if not authenticated

      // First, try to get the board (public or private)
      const { data: board, error } = await supabaseAdmin
        .from("boards")
        .select("*")
        .eq("slug", slug)
        .single();

      if (error || !board) {
        return ResponseUtil.error(res, "Board not found", 404);
      }

      // If board is public, return it to everyone
      if (!board.is_private) {
        console.log(`✅ Retrieved public board: ${slug}`);
        return ResponseUtil.success(res, "Board retrieved successfully", {
          board,
        });
      }

      // If board is private, check if user is authenticated and has access
      if (!user) {
        return ResponseUtil.error(res, "Board not found or is private", 404);
      }

      // Check if user is a member of the board's organization
      if (user.current_organization_id !== board.organization_id) {
        return ResponseUtil.error(res, "Board not found or is private", 404);
      }

      // User is in the same organization - allow access to private board
      console.log(`✅ Retrieved private board for ${user.organization_role}: ${slug}`);
      return ResponseUtil.success(res, "Board retrieved successfully", {
        board,
      });

    } catch (error) {
      console.error("Get public board by slug error:", error);
      next(error);
    }
  }

  /**
   * Get posts from a PUBLIC board (optional authentication)
   * GET /api/public/boards/:slug/posts
   * - Public users: can only see posts from public boards
   * - Authenticated users (owner/admin): can see posts from private boards in their org
   */
  async getPublicBoardPosts(req, res, next) {
    try {
      const { slug } = req.params;
      const user = req.user; // May be null if not authenticated

      // Get board (public or private)
      const { data: board, error: boardError } = await supabaseAdmin
        .from("boards")
        .select("*")
        .eq("slug", slug)
        .single();

      if (boardError || !board) {
        return ResponseUtil.error(res, "Board not found", 404);
      }

      // If board is public, return posts to everyone
      if (!board.is_private) {
        // Get posts from this board
        const { data: posts, error: postsError } = await supabaseAdmin
          .from("posts")
          .select(
            `
             *,
             author:users!author_id(id, name, email),
             ${EXTERNAL_AUTHOR_SELECT},
             board:boards!board_id(id, name, slug, icon)
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
      }

      // Board is private - check if user is authenticated and has access
      if (!user) {
        return ResponseUtil.error(res, "Board not found or is private", 404);
      }

      // Check if user is a member of the board's organization
      if (user.current_organization_id !== board.organization_id) {
        return ResponseUtil.error(res, "Board not found or is private", 404);
      }

      // User is in the same organization - allow access to private board posts
      const { data: posts, error: postsError } = await supabaseAdmin
        .from("posts")
        .select(
          `
           *,
           author:users!author_id(id, name, email),
           ${EXTERNAL_AUTHOR_SELECT},
           board:boards!board_id(id, name, slug, icon)
         `,
        )
        .eq("board_id", board.id)
        .eq("is_archived", false)
        .order("created_at", { ascending: false });

      if (postsError) throw postsError;

      console.log(
        `✅ Retrieved ${posts.length} posts from private board for ${user.organization_role}: ${slug}`,
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
   * Get single post from PUBLIC board (optional authentication)
   * GET /api/public/posts/:id
   * - Public users: can only see posts in public boards
   * - Authenticated users (owner/admin): can see posts in private boards from their org
   */
  async getPublicPost(req, res, next) {
    try {
      const { id } = req.params;
      const user = req.user; // May be null if not authenticated

      const { data: post, error } = await supabaseAdmin
        .from("posts")
        .select(
          `
           *,
           author:users!author_id(id, name, email, avatar_url),
           ${EXTERNAL_AUTHOR_SELECT},
           board:boards!board_id(id, name, slug, icon, is_private, organization_id)
         `,
        )
        .eq("id", id)
        .single();

      if (error || !post) {
        return ResponseUtil.error(res, "Post not found", 404);
      }

      // If board is public, return post to everyone
      if (!post.board?.is_private) {
        return ResponseUtil.success(res, "Post retrieved", { post });
      }

      // Board is private - check if user is authenticated and has access
      if (!user) {
        return ResponseUtil.error(res, "This post is in a private board", 403);
      }

      // Check if user is a member of the board's organization
      if (user.current_organization_id !== post.board.organization_id) {
        return ResponseUtil.error(res, "This post is in a private board", 403);
      }

      // User is in the same organization - allow access to private board post
      console.log(`✅ Retrieved private board post for ${user.organization_role}`);
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
        },
        {
          id: "2",
          name: "Bug Reports",
          slug: "bug-reports",
          icon: "🐛",
        },
        {
          id: "3",
          name: "General Feedback",
          slug: "general-feedback",
          icon: "💬",
        },
        {
          id: "4",
          name: "Questions",
          slug: "questions",
          icon: "❓",
        },
        {
          id: "5",
          name: "Announcements",
          slug: "announcements",
          icon: "📢",
        },
        { id: "6", name: "Ideas", slug: "ideas", icon: "💭" },
        {
          id: "7",
          name: "Support",
          slug: "support",
          icon: "🆘",
        },
        {
          id: "8",
          name: "Documentation",
          slug: "documentation",
          icon: "📚",
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

      const { name, description, is_private, icon, visible_to_roles } = req.body;
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
        icon,
        owner_id,
        organization_id,
        visible_to_roles, // ✅ Pass the role targeting array
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
      // ✅ ADMIN/OWNER ONLY CHECK - Check organization_role instead of global role
      const orgRole = req.user.organization_role;
      if (orgRole !== "owner" && orgRole !== "admin") {
        return ResponseUtil.error(res, "Only organization owners and admins can update boards", 403);
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const updates = req.body;
      const userId = req.user.id;
      const jobRole = req.user.job_role;

      const board = await boardService.updateBoard(
        id,
        updates,
        userId,
        jobRole,
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
      // ✅ ADMIN/OWNER ONLY CHECK - Check organization_role instead of global role
      const orgRole = req.user.organization_role;
      if (orgRole !== "owner" && orgRole !== "admin") {
        return ResponseUtil.error(res, "Only organization owners and admins can delete boards", 403);
      }

      const { id } = req.params;
      const userId = req.user.id;
      const jobRole = req.user.job_role;

      await boardService.deleteBoard(id, userId, jobRole);

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
      const organizationId = req.user?.organization_id || req.user?.current_organization_id;

      console.log('🔍 checkSlug controller:', { slug, organizationId, userId: req.user?.id });

      // Check slug availability within the user's organization
      const available = await boardService.checkSlugAvailability(slug, organizationId);

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
