const { supabase, supabaseAdmin } = require('../config/supabase.config');

const organizationService = {
  /**
   * Generate subdomain from company name (fallback if DB function doesn't exist)
   */
  generateSubdomainFromName(companyName) {
    return companyName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')          // Replace spaces with hyphens
      .replace(/-+/g, '-')           // Replace multiple hyphens with single
      .replace(/^-|-$/g, '')         // Remove leading/trailing hyphens
      .substring(0, 63);             // Max 63 chars
  },

  /**
   * Create a new organization
   */
  async createOrganization({ name, subdomain, description, industry, company_size, website, ownerId }) {
    try {
      // 1. Generate subdomain if not provided
      let finalSubdomain = subdomain;
      if (!finalSubdomain) {
        try {
          // Try database function first
          const { data: generatedSubdomain, error: subdomainError } = await supabase
            .rpc('generate_subdomain', { company_name: name });
          
          if (subdomainError) {
            console.warn('⚠️ Database generate_subdomain function not found, using fallback');
            finalSubdomain = this.generateSubdomainFromName(name);
          } else {
            finalSubdomain = generatedSubdomain;
          }
        } catch (err) {
          // Fallback to local generation
          console.warn('⚠️ Error calling generate_subdomain, using fallback:', err.message);
          finalSubdomain = this.generateSubdomainFromName(name);
        }
      }

      // 2. Validate subdomain format
      const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
      if (!subdomainRegex.test(finalSubdomain)) {
        throw new Error('Invalid subdomain format. Use lowercase letters, numbers, and hyphens only.');
      }

      if (finalSubdomain.length < 3 || finalSubdomain.length > 63) {
        throw new Error('Subdomain must be between 3 and 63 characters.');
      }

      // 3. Check if subdomain is available
      const { data: existing } = await supabase
        .from('organizations')
        .select('id')
        .eq('subdomain', finalSubdomain)
        .single();

      if (existing) {
        throw new Error(`Subdomain '${finalSubdomain}' is already taken.`);
      }

      // 4. Create organization (using admin client to bypass RLS)
      const { data: organization, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({
          name,
          subdomain: finalSubdomain,
          slug: finalSubdomain,
          description,
          industry,
          company_size,
          website,
          plan: 'free',
          max_users: 10,
          max_boards: 5,
        })
        .select()
        .single();

      if (orgError) throw orgError;

      // 5. Add owner to organization_members table
      if (ownerId) {
        const { error: memberError } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: ownerId,
            organization_id: organization.id,
            role: 'owner',
            joined_at: new Date().toISOString(),
          });

        if (memberError) {
          console.error('❌ Failed to add owner to organization_members:', memberError);
          // Rollback organization creation
          await supabaseAdmin.from('organizations').delete().eq('id', organization.id);
          throw memberError;
        }

        // 6. Update user's current_organization_id
        const { error: userError } = await supabaseAdmin
          .from('users')
          .update({
            organization_id: organization.id,
            current_organization_id: organization.id,
            organization_role: 'owner',
          })
          .eq('id', ownerId);

        if (userError) {
          console.error('❌ Failed to update user:', userError);
          // Don't rollback - user is already in organization_members
        }
        
        console.log(`✅ Added user ${ownerId} as owner to organization ${organization.id}`);
      }

      return organization;
    } catch (error) {
      console.error('❌ Create organization error:', error);
      throw error;
    }
  },

  /**
   * Get organization by subdomain
   */
  async getOrganizationBySubdomain(subdomain) {
    try {
      // Use supabaseAdmin to bypass RLS for public subdomain lookup
      const { data, error } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('subdomain', subdomain)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
      return data;
    } catch (error) {
      console.error('❌ Get organization by subdomain error:', error);
      throw error;
    }
  },

  /**
   * Get organization by ID
   */
  async getOrganizationById(organizationId) {
    try {
      // Use supabaseAdmin to bypass RLS
      const { data, error } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('id', organizationId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ Get organization by ID error:', error);
      throw error;
    }
  },

  /**
   * Get user's organization (primary organization)
   */
  async getUserOrganization(userId) {
    try {
      // Get user's current organization or first organization
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('current_organization_id')
        .eq('id', userId)
        .single();

      let organizationId = user?.current_organization_id;

      // If no current org set, get their first organization
      if (!organizationId) {
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('organization_id, role')
          .eq('user_id', userId)
          .order('joined_at', { ascending: true })
          .limit(1)
          .single();

        if (!membership) {
          return null; // User not in any organization
        }

        organizationId = membership.organization_id;
        
        // Auto-set this as the current organization for the user
        await supabaseAdmin
          .from('users')
          .update({ current_organization_id: organizationId })
          .eq('id', userId);
        
        console.log(`✅ Auto-set current_organization_id to ${organizationId} for user ${userId}`);
      }

      // Get organization details with user's role
      const { data: membership } = await supabaseAdmin
        .from('organization_members')
        .select(`
          role,
          organizations (*)
        `)
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .single();

      if (!membership) {
        return null;
      }

      return {
        organization_id: organizationId,
        organization_role: membership.role,
        organizations: membership.organizations
      };
    } catch (error) {
      console.error('❌ Get user organization error:', error);
      throw error;
    }
  },

  /**
   * Get all organizations user belongs to
   */
  async getUserOrganizations(userId) {
    try {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('current_organization_id')
        .eq('id', userId)
        .single();

      const currentOrgId = user?.current_organization_id;

      // Get all organizations user is a member of
      const { data: memberships, error } = await supabaseAdmin
        .from('organization_members')
        .select(`
          role,
          joined_at,
          organizations (
            id,
            name,
            subdomain,
            logo_url,
            plan,
            created_at
          )
        `)
        .eq('user_id', userId)
        .order('joined_at', { ascending: true });

      if (error) throw error;

      // Transform and mark current organization
      const organizations = memberships.map(m => ({
        ...m.organizations,
        role: m.role,
        joined_at: m.joined_at,
        is_current: m.organizations.id === currentOrgId
      }));

      return organizations;
    } catch (error) {
      console.error('❌ Get user organizations error:', error);
      throw error;
    }
  },

  /**
   * Create organization for an existing user
   */
  async createOrganizationForUser(userId, orgData) {
    try {
      const { name, subdomain, description, industry, company_size, website } = orgData;

      // 1. Generate subdomain if not provided
      let finalSubdomain = subdomain;
      if (!finalSubdomain) {
        try {
          const { data: generatedSubdomain, error: subdomainError } = await supabase
            .rpc('generate_subdomain', { company_name: name });
          
          if (subdomainError) {
            console.warn('⚠️ Database generate_subdomain function not found, using fallback');
            finalSubdomain = this.generateSubdomainFromName(name);
          } else {
            finalSubdomain = generatedSubdomain;
          }
        } catch (err) {
          console.warn('⚠️ Error calling generate_subdomain, using fallback:', err.message);
          finalSubdomain = this.generateSubdomainFromName(name);
        }
      }

      // 2. Validate subdomain format
      const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
      if (!subdomainRegex.test(finalSubdomain)) {
        throw new Error('Invalid subdomain format. Use lowercase letters, numbers, and hyphens only.');
      }

      if (finalSubdomain.length < 3 || finalSubdomain.length > 63) {
        throw new Error('Subdomain must be between 3 and 63 characters.');
      }

      // 3. Check if subdomain is available
      const { data: existing } = await supabase
        .from('organizations')
        .select('id')
        .eq('subdomain', finalSubdomain)
        .single();

      if (existing) {
        throw new Error(`Subdomain '${finalSubdomain}' is already taken.`);
      }

      // 4. Create organization
      const { data: organization, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({
          name,
          subdomain: finalSubdomain,
          slug: finalSubdomain,
          description,
          industry,
          company_size,
          website,
          plan: 'free',
          max_users: 10,
          max_boards: 5,
        })
        .select()
        .single();

      if (orgError) throw orgError;

      // 5. Add user as owner in organization_members
      const { error: memberError } = await supabaseAdmin
        .from('organization_members')
        .insert({
          user_id: userId,
          organization_id: organization.id,
          role: 'owner',
          joined_at: new Date().toISOString()
        });

      if (memberError) {
        // Rollback organization creation
        await supabaseAdmin.from('organizations').delete().eq('id', organization.id);
        throw memberError;
      }

      // 6. Set as current organization
      const { error: userError } = await supabaseAdmin
        .from('users')
        .update({ current_organization_id: organization.id })
        .eq('id', userId);

      if (userError) {
        console.error('⚠️ Failed to set current organization:', userError);
      }

      console.log('✅ Organization created successfully:', {
        organizationId: organization.id,
        name: organization.name,
        subdomain: organization.subdomain,
        ownerId: userId
      });

      return organization;
    } catch (error) {
      console.error('❌ Create organization for user error:', error);
      throw error;
    }
  },

  /**
   * Update organization
   */
  async updateOrganization(organizationId, updates, userId) {
    try {
      // Verify user is owner
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('organization_role')
        .eq('id', userId)
        .eq('organization_id', organizationId)
        .single();

      if (userError || !user) {
        throw new Error('Unauthorized: User not in organization');
      }

      if (user.organization_role !== 'owner') {
        throw new Error('Unauthorized: Only organization owner can update settings');
      }

      // Don't allow subdomain update if there's more than 1 user
      if (updates.subdomain) {
        const { count } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId);

        if (count > 1) {
          throw new Error('Cannot change subdomain when organization has multiple users');
        }
      }

      const { data, error } = await supabaseAdmin
        .from('organizations')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organizationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ Update organization error:', error);
      throw error;
    }
  },

  /**
   * Get organization members
   */
  async getOrganizationMembers(organizationId, userId) {
    try {
      // Verify user is in organization using organization_members table
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .single();

      if (memberError || !membership) {
        throw new Error('Unauthorized: User not in organization');
      }

      // Fetch all members from organization_members table
      const { data, error } = await supabaseAdmin
        .from('organization_members')
        .select(`
          role,
          joined_at,
          users!organization_members_user_id_fkey (
            id,
            name,
            email,
            avatar_url,
            role,
            created_at
          )
        `)
        .eq('organization_id', organizationId)
        .order('joined_at', { ascending: true });

      if (error) throw error;

      // Transform data to match expected format
      const members = data.map(item => ({
        id: item.users.id,
        name: item.users.name,
        email: item.users.email,
        avatar_url: item.users.avatar_url,
        organization_role: item.role,
        user_role: item.users.role, // Their job role (designer, PM, etc.)
        created_at: item.users.created_at,
        joined_at: item.joined_at
      }));

      return members;
    } catch (error) {
      console.error('❌ Get organization members error:', error);
      throw error;
    }
  },

  /**
   * Invite user to organization
   */
  async inviteUser(organizationId, email, role, invitedBy) {
    try {
      // Verify inviter is admin or owner
      const { data: inviter, error: inviterError } = await supabase
        .from('users')
        .select('organization_role')
        .eq('id', invitedBy)
        .eq('organization_id', organizationId)
        .single();

      if (inviterError || !inviter) {
        throw new Error('Unauthorized: User not in organization');
      }

      if (!['owner', 'admin'].includes(inviter.organization_role)) {
        throw new Error('Unauthorized: Only owners and admins can invite users');
      }

      // Check organization user limit
      const { data: org } = await supabase
        .from('organizations')
        .select('max_users')
        .eq('id', organizationId)
        .single();

      const { count } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId);

      if (count >= org.max_users) {
        throw new Error('Organization user limit reached. Please upgrade your plan.');
      }

      // TODO: Send email invitation
      // For now, just return success
      console.log(`📧 Invitation sent to ${email} for organization ${organizationId}`);
      
      return {
        success: true,
        message: 'Invitation sent successfully',
        email,
        role,
      };
    } catch (error) {
      console.error('❌ Invite user error:', error);
      throw error;
    }
  },

  /**
   * Update user role in organization
   */
  async updateUserRole(organizationId, targetUserId, newRole, updatedBy) {
    try {
      console.log('🔍 updateUserRole called:', {
        organizationId,
        targetUserId,
        newRole,
        updatedBy
      });

      // Verify updater is owner using organization_members table
      const { data: updater, error: updaterError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', updatedBy)
        .eq('organization_id', organizationId)
        .single();

      console.log('🔍 Updater query result:', {
        found: !!updater,
        role: updater?.role,
        error: updaterError?.message
      });

      if (updaterError || !updater) {
        console.log('❌ Updater not found in organization_members');
        throw new Error('Unauthorized: User not in organization');
      }

      if (updater.role !== 'owner') {
        console.log('❌ Updater is not owner, role:', updater.role);
        throw new Error('Unauthorized: Only organization owner can change roles');
      }

      console.log('✅ Updater is owner, proceeding...');

      // Get target user's current role
      const { data: targetMember } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', targetUserId)
        .eq('organization_id', organizationId)
        .single();

      if (!targetMember) {
        throw new Error('User not found in organization');
      }

      // Don't allow removing the only owner
      if (targetMember.role === 'owner' && newRole !== 'owner') {
        const { count } = await supabaseAdmin
          .from('organization_members')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('role', 'owner');

        if (count <= 1) {
          throw new Error('Cannot remove the only owner. Assign another owner first.');
        }
      }

      // Update role in organization_members table
      const { data, error } = await supabaseAdmin
        .from('organization_members')
        .update({ role: newRole })
        .eq('user_id', targetUserId)
        .eq('organization_id', organizationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ Update user role error:', error);
      throw error;
    }
  },

  /**
   * Remove user from organization
   */
  async removeUser(organizationId, targetUserId, removedBy) {
    try {
      // Verify remover is admin or owner using organization_members table
      const { data: remover, error: removerError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', removedBy)
        .eq('organization_id', organizationId)
        .single();

      if (removerError || !remover) {
        throw new Error('Unauthorized: User not in organization');
      }

      if (!['owner', 'admin'].includes(remover.role)) {
        throw new Error('Unauthorized: Only owners and admins can remove users');
      }

      // Get target user's role
      const { data: targetMember } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', targetUserId)
        .eq('organization_id', organizationId)
        .single();

      if (!targetMember) {
        throw new Error('User not found in organization');
      }

      // Don't allow removing the only owner
      if (targetMember.role === 'owner') {
        const { count } = await supabaseAdmin
          .from('organization_members')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('role', 'owner');

        if (count <= 1) {
          throw new Error('Cannot remove the only owner.');
        }
      }

      // Remove from organization_members table
      const { error } = await supabaseAdmin
        .from('organization_members')
        .delete()
        .eq('user_id', targetUserId)
        .eq('organization_id', organizationId);

      if (error) throw error;

      // If this was their current organization, clear it
      await supabaseAdmin
        .from('users')
        .update({ current_organization_id: null })
        .eq('id', targetUserId)
        .eq('current_organization_id', organizationId);

      return { success: true };
    } catch (error) {
      console.error('❌ Remove user error:', error);
      throw error;
    }
  },

  /**
   * Check subdomain availability
   */
  async checkSubdomainAvailability(subdomain) {
    try {
      // Use supabaseAdmin to bypass RLS for public availability check
      const { data, error } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('subdomain', subdomain)
        .single();

      if (error && error.code === 'PGRST116') {
        // Not found = available
        return { available: true };
      }

      return { available: false };
    } catch (error) {
      console.error('❌ Check subdomain availability error:', error);
      throw error;
    }
  },
};

module.exports = organizationService;
