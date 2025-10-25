const { supabaseAdmin } = require("../config/supabase.config");

class BoardService {
  /**
   * Get all boards - MULTI-TENANT VERSION
   * Each user only sees boards they created
   */
  async getAllBoards(userId, userRole) {
    try {
      let query = supabaseAdmin
        .from("boards")
        .select("*")
        .order("created_at", { ascending: false });

      // ✅ KEY CHANGE: Even admins only see boards they own
      // Exception: Add a super_admin role later if needed
      query = query.eq("owner_id", userId);

      const { data, error } = await query;

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} boards for user ${userId}`);
      return data;
    } catch (error) {
      console.error("❌ Get boards error:", error);
      throw error;
    }
  }

  /**
   * Get single board by slug - with owner check
   */
  async getBoardBySlug(slug, userId, userRole) {
    try {
      const { data, error } = await supabaseAdmin
        .from("boards")
        .select("*")
        .eq("slug", slug)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          throw new Error("Board not found");
        }
        throw error;
      }

      // ✅ CHECK: User must be the owner to access
      // For public boards, you can relax this if you want public access
      if (data.owner_id !== userId) {
        // If board is public, you might want to allow view access
        // For now, only owner can access
        throw new Error("Access denied to this board");
      }

      console.log(`✅ Retrieved board: ${data.name}`);
      return data;
    } catch (error) {
      console.error("❌ Get board error:", error);
      throw error;
    }
  }

  /**
   * Create new board
   */
   async createBoard({ name, description, is_private, color, icon, category, owner_id }) {
     try {
       const baseSlug = name
         .toLowerCase()
         .replace(/[^a-z0-9\s-]/g, '')
         .replace(/\s+/g, '-')
         .substring(0, 50);

       let slug = baseSlug;
       let counter = 1;
       let slugExists = true;

       while (slugExists) {
         const { data: existing } = await supabaseAdmin
           .from('boards')
           .select('id')
           .eq('slug', slug)
           .maybeSingle();

         if (!existing) {
           slugExists = false;
         } else {
           slug = `${baseSlug}-${counter}`;
           counter++;
         }
       }

       const { data, error } = await supabaseAdmin
         .from('boards')
         .insert([
           {
             name,
             slug,
             description: description || null,
             is_private: is_private || false,
             category: category || 'General', // ✅ ADD CATEGORY
             color: color || '#6366f1',
             icon: icon || '💡',
             owner_id,
             post_count: 0
           }
         ])
         .select()
         .single();

       if (error) throw error;

       console.log(`✅ Board created: ${data.name} (${data.slug}) - Category: ${data.category}`);
       return data;
     } catch (error) {
       console.error('❌ Create board error:', error);
       throw error;
     }
   }

  /**
   * Update board - only owner can update
   */
  async updateBoard(boardId, updates, userId, userRole) {
    try {
      // Check if user is the owner
      const { data: board } = await supabaseAdmin
        .from("boards")
        .select("owner_id")
        .eq("id", boardId)
        .single();

      if (!board) {
        throw new Error("Board not found");
      }

      // ✅ ONLY OWNER can update (even if admin)
      if (board.owner_id !== userId) {
        throw new Error("Access denied - only board owner can update");
      }

      if (updates.name) {
        const baseSlug = updates.name
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .substring(0, 50);

        let slug = baseSlug;
        let counter = 1;
        let slugExists = true;

        while (slugExists) {
          const { data: existing } = await supabaseAdmin
            .from("boards")
            .select("id")
            .eq("slug", slug)
            .neq("id", boardId)
            .maybeSingle();

          if (!existing) {
            slugExists = false;
          } else {
            slug = `${baseSlug}-${counter}`;
            counter++;
          }
        }

        updates.slug = slug;
      }

      const { data, error } = await supabaseAdmin
        .from("boards")
        .update(updates)
        .eq("id", boardId)
        .select()
        .single();

      if (error) throw error;

      console.log(`✅ Board updated: ${data.name}`);
      return data;
    } catch (error) {
      console.error("❌ Update board error:", error);
      throw error;
    }
  }

  /**
   * Delete board - only owner can delete
   */
  async deleteBoard(boardId, userId, userRole) {
    try {
      const { data: board } = await supabaseAdmin
        .from("boards")
        .select("owner_id, name")
        .eq("id", boardId)
        .single();

      if (!board) {
        throw new Error("Board not found");
      }

      // ✅ ONLY OWNER can delete (even if admin)
      if (board.owner_id !== userId) {
        throw new Error("Access denied - only board owner can delete");
      }

      const { error } = await supabaseAdmin
        .from("boards")
        .delete()
        .eq("id", boardId);

      if (error) throw error;

      console.log(`✅ Board deleted: ${board.name}`);
      return true;
    } catch (error) {
      console.error("❌ Delete board error:", error);
      throw error;
    }
  }

  /**
   * Check if board slug is available
   */
  async checkSlugAvailability(slug) {
    try {
      const { data, error } = await supabaseAdmin
        .from("boards")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (error) throw error;

      return !data;
    } catch (error) {
      console.error("❌ Check slug error:", error);
      throw error;
    }
  }
}

module.exports = new BoardService();
