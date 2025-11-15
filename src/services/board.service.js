const { supabaseAdmin } = require("../config/supabase.config");

class BoardService {
  /**
   * Get all boards - ORGANIZATION-SCOPED VERSION with ROLE FILTERING
   * Users see boards in their organization that match their role
   */
  async getAllBoards(userId, jobRole) {
    try {
      console.log('🔍 Board Service - getAllBoards:');
      console.log('   User ID:', userId);
      console.log('   Job Role:', jobRole);
      
      // Get user's current organization from users table
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('current_organization_id')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        console.error('❌ User not found:', userError?.message);
        throw new Error('User not found');
      }

      console.log('   User current_organization_id:', user.current_organization_id);

      // Get organization ID from current_organization_id
      let organizationId = user.current_organization_id;
      
      // If no current org, return empty array instead of querying
      if (!organizationId) {
        console.log('   ⚠️ No current_organization_id, returning empty boards');
        return [];
      }

      let query = supabaseAdmin
        .from("boards")
        .select("*")
        .eq('organization_id', organizationId)
        .order("created_at", { ascending: false });

      console.log(`✅ Filtering boards by organization: ${organizationId}`);

      const { data, error } = await query;

      if (error) throw error;

      // Apply job role filtering client-side (RLS already handles most of this)
      // But we'll add extra check for visibility based on job_role
      let filteredBoards = data || [];
      if (jobRole && filteredBoards.length > 0) {
        filteredBoards = data.filter(board => {
          // If board has no visibility restrictions, show it
          if (!board.visible_to_roles || board.visible_to_roles.length === 0) {
            return true;
          }
          // Check if user's job_role is in the allowed roles
          return board.visible_to_roles.includes(jobRole);
        });
        console.log(`✅ Filtered ${filteredBoards.length}/${data.length} boards by job_role: ${jobRole}`);
      }

      console.log(`✅ Retrieved ${filteredBoards.length} boards for user ${userId}`);
      return filteredBoards;
    } catch (error) {
      console.error("❌ Get boards error:", error);
      throw error;
    }
  }

  /**
   * Get single board by slug - ORGANIZATION-SCOPED VERSION with ROLE CHECK
   * Users can access boards in their organization if their role matches
   */
  async getBoardBySlug(slug, userId, userRole) {
    try {
      // Get user's current organization and role
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('current_organization_id, role')
        .eq('id', userId)
        .single();

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

      // Check access (multiple conditions):
      // 1. If board is public, anyone can view
      if (!data.is_private) {
        // Still check role visibility for public boards
        if (data.visible_to_roles && data.visible_to_roles.length > 0 && user.role) {
          if (!data.visible_to_roles.includes(user.role)) {
            throw new Error("This board is not visible to your role");
          }
        }
        console.log(`✅ Retrieved public board: ${data.name}`);
        return data;
      }

      // 2. If user is in same organization as board
      if (user && user.current_organization_id && data.organization_id === user.current_organization_id) {
        // Check role visibility
        if (data.visible_to_roles && data.visible_to_roles.length > 0 && user.role) {
          if (!data.visible_to_roles.includes(user.role)) {
            throw new Error("This board is not visible to your role");
          }
        }
        console.log(`✅ Retrieved organization board: ${data.name}`);
        return data;
      }

      // 3. If user is the owner
      if (data.owner_id === userId) {
        console.log(`✅ Retrieved owned board: ${data.name}`);
        return data;
      }

      // 4. Otherwise, access denied
      throw new Error("Access denied to this private board");

    } catch (error) {
      console.error("❌ Get board error:", error);
      throw error;
    }
  }

  /**
   * Create new board
   */
   async createBoard({ name, description, is_private, color, icon, category, owner_id, organization_id }) {
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

       const boardData = {
         name,
         slug,
         description: description || null,
         is_private: is_private || false,
         category: category || 'General',
         color: color || '#6366f1',
         icon: icon || '💡',
         owner_id,
         post_count: 0
       };

       // Add organization_id if provided
       if (organization_id) {
         boardData.organization_id = organization_id;
       }

       const { data, error } = await supabaseAdmin
         .from('boards')
         .insert([boardData])
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
