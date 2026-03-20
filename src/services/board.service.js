const { supabaseAdmin } = require("../config/supabase.config");
const cache = require("./redis.service");
const { emitBoardCreatedWebhook } = require("./webhook-events");

class BoardService {
  /**
   * Get all boards - ORGANIZATION-SCOPED VERSION with ROLE FILTERING
   * - Admins/Owners: See ALL boards in organization
   * - Members: See only boards matching their job_role
   * 🔴 CACHED: TTL 1 hour
   */
  async getAllBoards(userId, jobRole, organizationRole) {
    try {
      console.log('🔍 Board Service - getAllBoards:');
      console.log('   User ID:', userId);
      console.log('   Job Role:', jobRole);
      console.log('   Organization Role:', organizationRole);
      
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

      // 🔴 CACHE KEY: boards:org:{orgId}:role:{role}:jobrole:{jobRole}
      const cacheKey = `boards:org:${organizationId}:role:${organizationRole}:jobrole:${jobRole || 'none'}`;
      
      // Try to get from cache first
      const cachedBoards = await cache.get(cacheKey);
      if (cachedBoards) {
        console.log(`🔴 Returning ${cachedBoards.length} boards from cache`);
        return cachedBoards;
      }

      let query = supabaseAdmin
        .from("boards")
        .select("*")
        .eq('organization_id', organizationId)
        .order("created_at", { ascending: false });

      console.log(`✅ Filtering boards by organization: ${organizationId}`);

      const { data, error } = await query;

      if (error) throw error;

      // ✅ ROLE-BASED FILTERING LOGIC
      // Admins and Owners see ALL boards (no filtering)
      // Members see only boards matching their job_role
      let filteredBoards = data || [];
      
      if (organizationRole === 'owner' || organizationRole === 'admin') {
        // Admins/Owners see everything
        console.log(`✅ Admin/Owner access: Showing all ${filteredBoards.length} boards (no filtering)`);
      } else if (organizationRole === 'member' && jobRole && filteredBoards.length > 0) {
        // Members: Apply job_role filtering
        const originalCount = filteredBoards.length;
        filteredBoards = data.filter(board => {
          // If board has no visibility restrictions, show it
          if (!board.visible_to_roles || board.visible_to_roles.length === 0) {
            return true;
          }
          // Check if user's job_role is in the allowed roles
          return board.visible_to_roles.includes(jobRole);
        });
        console.log(`✅ Member access: Filtered ${filteredBoards.length}/${originalCount} boards by job_role: ${jobRole}`);
      }

      console.log(`✅ Retrieved ${filteredBoards.length} boards for user ${userId}`);
      
      // 🔴 Cache the result for 1 hour (3600 seconds)
      await cache.set(cacheKey, filteredBoards, 3600);
      
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
  async getBoardBySlug(slug, userId, userRole, organizationId = null) {
    try {
      // Get user's current organization (no role column in users table)
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('current_organization_id')
        .eq('id', userId)
        .single();

      // Use provided organizationId, fallback to user's current org
      const effectiveOrgId = organizationId || user?.current_organization_id;

      let query = supabaseAdmin
        .from("boards")
        .select("*")
        .eq("slug", slug);

      // Filter by organization if we have one
      if (effectiveOrgId) {
        query = query.eq("organization_id", effectiveOrgId);
      }

      const { data, error } = await query.single();

      if (error) {
        if (error.code === "PGRST116") {
          console.error(`❌ Board not found - slug: ${slug}, organization_id: ${effectiveOrgId}`);
          throw new Error("Board not found");
        }
        throw error;
      }

      // Check access (multiple conditions):
      // 1. If board is public, anyone can view
      if (!data.is_private) {
        // ✅ Owners and Admins bypass role visibility checks
        const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin';
        
        // Still check role visibility for public boards (but not for owners/admins)
        if (!isOwnerOrAdmin && data.visible_to_roles && data.visible_to_roles.length > 0 && userRole) {
          console.log(`🔍 Role visibility check - Board: ${data.name}, visible_to_roles: ${JSON.stringify(data.visible_to_roles)}, user role: ${userRole}`);
          if (!data.visible_to_roles.includes(userRole)) {
            console.error(`❌ Role mismatch - Board requires one of: ${data.visible_to_roles.join(', ')}, but user has: ${userRole}`);
            throw new Error("This board is not visible to your role");
          }
        }
        console.log(`✅ Retrieved public board: ${data.name}${isOwnerOrAdmin ? ' (owner/admin access)' : ''}`);
        return data;
      }

      // 2. If user is in same organization as board
      if (user && user.current_organization_id && data.organization_id === user.current_organization_id) {
        // ✅ Owners and Admins bypass role visibility checks
        const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin';
        
        // Check role visibility (but not for owners/admins)
        if (!isOwnerOrAdmin && data.visible_to_roles && data.visible_to_roles.length > 0 && userRole) {
          console.log(`🔍 Role visibility check - Board: ${data.name}, visible_to_roles: ${JSON.stringify(data.visible_to_roles)}, user role: ${userRole}`);
          if (!data.visible_to_roles.includes(userRole)) {
            console.error(`❌ Role mismatch - Board requires one of: ${data.visible_to_roles.join(', ')}, but user has: ${userRole}`);
            throw new Error("This board is not visible to your role");
          }
        }
        console.log(`✅ Retrieved organization board: ${data.name}${isOwnerOrAdmin ? ' (owner/admin access)' : ''}`);
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
   async createBoard({ name, description, is_private, icon, category, owner_id, organization_id, visible_to_roles }) {
     try {
       const baseSlug = name
         .toLowerCase()
         .replace(/[^a-z0-9\s-]/g, '')
         .replace(/\s+/g, '-')
         .substring(0, 50);

       let slug = baseSlug;
       let counter = 1;
       let slugExists = true;

       // Check slug uniqueness within the organization (not globally)
       while (slugExists) {
         let query = supabaseAdmin
           .from('boards')
           .select('id')
           .eq('slug', slug);

         // Scope to organization if provided
         if (organization_id) {
           query = query.eq('organization_id', organization_id);
         }

         const { data: existing } = await query.maybeSingle();

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
         icon: icon || '💡',
         owner_id,
         post_count: 0
       };

       // Add organization_id if provided
       if (organization_id) {
         boardData.organization_id = organization_id;
       }

       // ✅ Add visible_to_roles if provided (role targeting)
       if (visible_to_roles && Array.isArray(visible_to_roles)) {
         boardData.visible_to_roles = visible_to_roles;
       }

       const { data, error } = await supabaseAdmin
         .from('boards')
         .insert([boardData])
         .select()
         .single();

       if (error) throw error;

       const roleInfo = data.visible_to_roles && data.visible_to_roles.length > 0 
         ? ` - Visible to: ${data.visible_to_roles.join(', ')}` 
         : ' - Visible to all';
       console.log(`✅ Board created: ${data.name} (${data.slug}) - Category: ${data.category}${roleInfo}`);
       
       // 🔴 Invalidate board list cache for this organization
       if (organization_id) {
         await cache.deletePattern(`boards:org:${organization_id}:*`);
       }

       // 🔗 Fire webhook: board.created
       emitBoardCreatedWebhook(organization_id, data);

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

        // Check slug uniqueness within the organization (not globally)
        while (slugExists) {
          let query = supabaseAdmin
            .from("boards")
            .select("id, organization_id")
            .eq("slug", slug)
            .neq("id", boardId);

          // Scope to the same organization as the board being updated
          if (board.organization_id) {
            query = query.eq("organization_id", board.organization_id);
          }

          const { data: existing } = await query.maybeSingle();

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
      
      // 🔴 Invalidate board list cache for this organization
      if (data.organization_id) {
        await cache.deletePattern(`boards:org:${data.organization_id}:*`);
      }
      // Also invalidate this specific board's cache
      await cache.delete(`board:${boardId}`, `board:slug:${data.slug}`);
      
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

      // Get board details before deletion for cache invalidation
      const { data: fullBoard } = await supabaseAdmin
        .from("boards")
        .select("organization_id, slug")
        .eq("id", boardId)
        .single();

      const { error } = await supabaseAdmin
        .from("boards")
        .delete()
        .eq("id", boardId);

      if (error) throw error;

      console.log(`✅ Board deleted: ${board.name}`);
      
      // 🔴 Invalidate board list cache for this organization
      if (fullBoard?.organization_id) {
        await cache.deletePattern(`boards:org:${fullBoard.organization_id}:*`);
      }
      // Also invalidate this specific board's cache
      await cache.delete(`board:${boardId}`);
      if (fullBoard?.slug) {
        await cache.delete(`board:slug:${fullBoard.slug}`);
      }
      
      return true;
    } catch (error) {
      console.error("❌ Delete board error:", error);
      throw error;
    }
  }

  /**
   * Check if board slug is available within an organization
   * @param {string} slug - The slug to check
   * @param {string} organizationId - The organization ID to scope the check to
   */
  async checkSlugAvailability(slug, organizationId = null) {
    try {
      let query = supabaseAdmin
        .from("boards")
        .select("id")
        .eq("slug", slug);

      // If organizationId is provided, check only within that organization
      if (organizationId) {
        query = query.eq("organization_id", organizationId);
        console.log(`🔍 Checking slug "${slug}" availability in organization: ${organizationId}`);
      } else {
        console.log(`🔍 Checking slug "${slug}" availability globally (no org scope)`);
      }

      const { data, error } = await query.maybeSingle();

      if (error) throw error;

      const available = !data;
      console.log(`   Slug "${slug}" is ${available ? '✅ available' : '❌ taken'}`);

      return available;
    } catch (error) {
      console.error("❌ Check slug error:", error);
      throw error;
    }
  }
}

module.exports = new BoardService();
