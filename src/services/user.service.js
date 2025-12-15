const { supabase, supabaseAdmin } = require('../config/supabase.config');
const organizationService = require('./organization.service');
const cache = require('./redis.service');

const userService = {
  /**
   * Get user by ID
   */
  async getUserById(userId) {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error(`Failed to get user: ${error.message}`);
    }

    // Remove sensitive fields
    delete user.encrypted_password;
    return user;
  },

  /**
   * Switch user's current organization
   */
  async switchOrganization(userId, organizationId) {
    try {
      // Verify user is a member of this organization
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .single();

      if (memberError || !membership) {
        throw new Error('You are not a member of this organization');
      }

      // Update current organization
      const { data: user, error: updateError } = await supabaseAdmin
        .from('users')
        .update({
          current_organization_id: organizationId,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select('id, current_organization_id')
        .single();

      if (updateError) {
        throw new Error(`Failed to switch organization: ${updateError.message}`);
      }

      // Get organization details
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('id, name, subdomain, logo_url')
        .eq('id', organizationId)
        .single();

      // 🔴 Invalidate all session caches for this user
      // User switched org, so cached sessions are now stale
      await cache.deletePattern(`user:session:*`);
      console.log('🗑️  User session caches invalidated after organization switch');

      return {
        user,
        organization: org,
        role: membership.role
      };
    } catch (error) {
      console.error('❌ Switch organization error:', error);
      throw error;
    }
  },

  /**
   * Save onboarding progress
   */
  async saveOnboardingProgress(userId, step, data) {
    const { data: user, error } = await supabase
      .from('users')
      .update({
        onboarding_step: step,
        onboarding_data: data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save onboarding progress: ${error.message}`);
    }

    return user;
  },

  /**
   * Complete onboarding and create organization + first board
   */
  async completeOnboarding(userId, onboardingData) {
    // Start a transaction-like operation
    try {
      // 1. Create organization from company info (or default if skipped)
      let organization = null;
      
      // If no company name provided, get user's email for default org name
      let companyName = onboardingData.companyName;
      if (!companyName) {
        const { data: user } = await supabase
          .from('users')
          .select('email, name')
          .eq('id', userId)
          .single();
        
        // Create default organization name from user's name or email
        companyName = user?.name ? `${user.name}'s Workspace` : `My Workspace`;
        console.log(`⚠️ No company name provided, using default: ${companyName}`);
      }
      
      try {
        console.log('🏢 Creating organization with data:', {
          name: companyName,
          subdomain: onboardingData.subdomain,
          industry: onboardingData.industry,
          company_size: onboardingData.companySize,
          website: onboardingData.companyWebsite,
          ownerId: userId
        });

        organization = await organizationService.createOrganization({
          name: companyName,
          subdomain: onboardingData.subdomain, // Optional: user can customize
          description: onboardingData.description,
          industry: onboardingData.industry,
          company_size: onboardingData.companySize,
          website: onboardingData.companyWebsite,
          ownerId: userId,
        });
        
        console.log(`✅ Organization created successfully:`, {
          id: organization.id,
          name: organization.name,
          subdomain: organization.subdomain
        });
      } catch (orgError) {
        console.error('❌ CRITICAL: Failed to create organization:', {
          error: orgError.message,
          code: orgError.code,
          details: orgError.details,
          hint: orgError.hint,
          stack: orgError.stack,
          companyName: companyName,
          ownerId: userId
        });
        // If organization creation fails, this is critical - throw error
        throw new Error(`Failed to create organization: ${orgError.message}`);
      }

      // 2. Update user with onboarding data
      // Note: role, company fields removed - they're in organization_members and organizations tables now
      const updateData = {
        onboarding_completed: true,
        onboarding_step: 6, // Updated from 8 to 6 (removed role step)
        current_process: onboardingData.currentProcess,
        goals: onboardingData.goals,
        onboarding_data: onboardingData,
        updated_at: new Date().toISOString(),
      };

      // Set current_organization_id if organization was created
      if (organization) {
        updateData.current_organization_id = organization.id;
      }

      const { data: user, error: userError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (userError) {
        throw new Error(`Failed to update user: ${userError.message}`);
      }

            // 3. Create first board if provided
      let board = null;
      if (onboardingData.firstBoard && onboardingData.firstBoard.name) {
        const slug = onboardingData.firstBoard.name
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '');

        const boardData = {
          name: onboardingData.firstBoard.name,
          slug: slug,
          description: onboardingData.firstBoard.description || null,
          is_private: onboardingData.firstBoard.visibility === 'private',
          created_by: userId,
        };

        // Add organization_id if organization exists
        if (organization) {
          boardData.organization_id = organization.id;
        }

        const { data: newBoard, error: boardError } = await supabase
          .from('boards')
          .insert(boardData)
          .select()
          .single();

        if (boardError) {
          console.error('Failed to create board:', boardError);
          // Don't throw - board creation is optional
        } else {
          board = newBoard;
        }
      }

      // 4. Send team invites (if any)
      if (onboardingData.teamInvites && onboardingData.teamInvites.length > 0) {
        // TODO: Implement email invitation logic
        // For now, just log the invites
        console.log('Team invites to send:', onboardingData.teamInvites);
      }

      // 5. Fetch organization_role and job_role from organization_members table
      let organizationRole = null;
      let jobRole = null;
      if (organization) {
        const { data: membership } = await supabase
          .from('organization_members')
          .select('role, job_role')
          .eq('user_id', userId)
          .eq('organization_id', organization.id)
          .single();
        
        if (membership) {
          organizationRole = membership.role;
          jobRole = membership.job_role;
          console.log(`✅ User role in org: ${organizationRole}, job_role: ${jobRole}`);
        }
      }

      // 6. Return user with organization roles
      const userWithRoles = {
        ...user,
        organization_role: organizationRole,
        job_role: jobRole,
        organization_id: organization?.id || null
      };

      return {
        user: userWithRoles,
        organization,
        board,
        invitesSent: onboardingData.teamInvites?.length || 0,
      };
    } catch (error) {
      throw new Error(`Failed to complete onboarding: ${error.message}`);
    }
  },
};

module.exports = userService;
