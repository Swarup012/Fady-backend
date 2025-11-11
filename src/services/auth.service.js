const { supabase, supabaseAdmin } = require('../config/supabase.config');
const config = require('../config/env.config');

class AuthService {
  /**
   * Signup or Join Organization - Handles both new and existing users
   * Similar to how Canny, Slack, etc. work
   */
  async signupOrJoin({ email, password, name, organizationId = null, role = null }) {
    try {
      // Check if user already exists
      const { data: existingUser, error: checkError } = await supabaseAdmin
        .from('users')
        .select('id, auth_id, email, name')
        .eq('email', email)
        .maybeSingle();

      if (existingUser) {
        console.log('👤 Existing user detected:', email);
        
        // User exists - verify password and add to organization
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (authError) {
          throw new Error('Invalid password. If you already have an account, please use your existing password or reset it.');
        }

        if (organizationId) {
          // Check if already a member
          const { data: existingMembership } = await supabaseAdmin
            .from('organization_members')
            .select('id')
            .eq('user_id', existingUser.id)
            .eq('organization_id', organizationId)
            .single();

          if (existingMembership) {
            throw new Error('You are already a member of this organization. Please login instead.');
          }

          // Add to organization as member
          await supabaseAdmin
            .from('organization_members')
            .insert({
              user_id: existingUser.id,
              organization_id: organizationId,
              role: 'member'
            });

          // Update current organization if not set
          await supabaseAdmin
            .from('users')
            .update({ current_organization_id: organizationId })
            .eq('id', existingUser.id)
            .is('current_organization_id', null);

          console.log('✅ Existing user joined organization');
        }

        return {
          action: 'joined_existing',
          user: existingUser,
          session: authData.session
        };
      }

      // User doesn't exist - create new account
      return await this.signup({ email, password, name, organizationId, role });

    } catch (error) {
      console.error('❌ Signup or join error:', error);
      throw error;
    }
  }

  /**
   * Register a new user - With organization role support
   */
  async signup({ email, password, name, organizationId = null, role = null }) {
    let authUserId = null;
    
    try {
      // Step 1: Check if user already exists
      const { data: existingUser, error: existingError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (existingUser) {
        console.log('⚠️ User already exists:', email);
        throw new Error('Email already registered');
      }

      // Step 2: Create user in Supabase Auth
      console.log('📝 Creating auth user for:', email);
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name // This metadata is stored
          },
          emailRedirectTo: `${config.frontendUrl}/auth/callback`
        }
      });

      if (authError) {
        console.error('❌ Auth signup error:', authError);
        throw new Error(`Auth creation failed: ${authError.message}`);
      }

      if (!authData.user) {
        throw new Error('User creation failed - no user returned');
      }

      authUserId = authData.user.id;
      console.log('✅ Auth user created:', authUserId);
      console.log('📧 User email:', authData.user.email);
      console.log('📧 Email confirmed:', authData.user.email_confirmed_at ? 'Yes' : 'No (confirmation required)');

      // Step 3: Determine organization role for organization_members table
      let organizationRole = 'member'; // Default to member
      
      if (organizationId) {
        // When organizationId is provided via signup URL (subdomain signup),
        // the user is JOINING an existing organization, so they should be a member.
        // 
        // Only exception: If organization exists but has NO members at all,
        // AND the organization was just created (within last 5 seconds),
        // then this might be the org creator coming from onboarding.
        
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('created_at')
          .eq('id', organizationId)
          .single();
        
        const { count } = await supabaseAdmin
          .from('organization_members')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId);
        
        const orgAge = org ? Date.now() - new Date(org.created_at).getTime() : Infinity;
        const isNewOrg = orgAge < 5000; // Organization created within last 5 seconds
        
        // First user of a NEWLY created org becomes owner
        // Everyone else joining existing org becomes member
        if (count === 0 && isNewOrg) {
          organizationRole = 'owner';
          console.log(`📊 Organization role: owner (first user of newly created org)`);
        } else {
          organizationRole = 'member';
          console.log(`📊 Organization role: member (joining existing org with ${count} members)`);
        }
      }

      // Step 4: CREATE PROFILE (no organization_id in users table - using organization_members instead)
      console.log('📊 Creating user profile...');
      
      const profileData = {
        id: authUserId,
        email: email,
        name: name,
        role: role || 'user', // User's job role (product_manager/founder/designer/etc)
        current_organization_id: organizationId, // Current org they're viewing
        avatar_url: null,
        created_at: new Date().toISOString()
      };
      
      console.log('🔍 Attempting insert with data:', { 
        id: authUserId, 
        email, 
        name, 
        role: role || 'user',
        current_organization_id: organizationId
      });
      
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('users')
        .insert([profileData])
        .select('id, email, name, role, created_at')
        .single();

      if (profileError) {
        console.error('❌ Profile creation error:', {
          code: profileError.code,
          message: profileError.message,
          details: profileError.details
        });

        // If profile creation fails, try to delete the auth user to keep things clean
        try {
          console.log('🧹 Cleaning up auth user...');
          await supabaseAdmin.auth.admin.deleteUser(authUserId);
          console.log('🧹 Auth user deleted');
        } catch (deleteError) {
          console.error('⚠️ Could not cleanup auth user:', deleteError.message);
        }

        throw new Error(`Profile creation failed: ${profileError.message}`);
      }

      console.log('✅ User profile created:', profile.id);

      // Step 5: Add user to organization_members if organizationId provided
      if (organizationId) {
        console.log(`📋 Adding user to organization_members as ${organizationRole}...`);
        
        const { error: memberError } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: profile.id,
            organization_id: organizationId,
            role: organizationRole
          });

        if (memberError) {
          console.error('❌ Failed to add user to organization:', memberError);
          // Don't throw - user is created, they just aren't in the org
          console.warn('⚠️ User created but not added to organization');
        } else {
          console.log('✅ User added to organization');
        }
      }

      // Step 6: Add organization_role to user object before returning
      const userWithOrgRole = {
        ...profile,
        organization_role: organizationRole || null,
        organization_id: organizationId || null
      };
      
      console.log(`✅ Signup complete - organization_role: ${organizationRole}`);

      // Return response
      return {
        action: 'created_new',
        user: userWithOrgRole,
        session: authData.session, // Will be null if email confirmation is required
        emailConfirmationRequired: !authData.session
      };

    } catch (error) {
      console.error('❌ Signup failed:', error.message);
      throw error;
    }
  }

  /**
   * Login user - with optional organization joining
   */
  async login({ email, password, organizationId = null, userRole = null }) {
    try {
      console.log('🔑 Attempting login for:', email);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.error('❌ Login error:', error.message);
        throw new Error(error.message || 'Invalid email or password');
      }

      if (!data.session) {
        console.log('⚠️ No session - email confirmation required');
        throw new Error('Email not confirmed. Please check your email and verify your account.');
      }

      // Get user profile
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('users')
        .select('id, email, name, role, current_organization_id, avatar_url, created_at')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error('❌ Profile fetch error:', profileError);
        throw new Error('User profile not found');
      }

      console.log('✅ Login successful:', profile.email);
      console.log('🔍 User current_organization_id:', profile.current_organization_id);

      // If userRole provided and user doesn't have a role yet, update it
      if (userRole && !profile.role) {
        await supabaseAdmin
          .from('users')
          .update({ role: userRole })
          .eq('id', profile.id);
        
        profile.role = userRole;
        console.log(`✅ User role set to: ${userRole}`);
      }

      // If organizationId provided, add user to that organization
      let joinedOrganization = false;
      if (organizationId) {
        console.log(`🏢 Attempting to join organization: ${organizationId}`);
        
        // Check if already a member
        const { data: existingMembership } = await supabaseAdmin
          .from('organization_members')
          .select('id')
          .eq('user_id', profile.id)
          .eq('organization_id', organizationId)
          .single();

        if (existingMembership) {
          console.log('ℹ️ User already a member of this organization');
          // Update current organization
          await supabaseAdmin
            .from('users')
            .update({ current_organization_id: organizationId })
            .eq('id', profile.id);
          
          // Update profile object with new current_organization_id
          profile.current_organization_id = organizationId;
        } else {
          // Add to organization as member
          const { error: memberError } = await supabaseAdmin
            .from('organization_members')
            .insert({
              user_id: profile.id,
              organization_id: organizationId,
              role: 'member'
            });

          if (memberError) {
            console.error('❌ Failed to add user to organization:', memberError);
          } else {
            console.log('✅ User added to organization');
            joinedOrganization = true;
            
            // Set as current organization
            await supabaseAdmin
              .from('users')
              .update({ current_organization_id: organizationId })
              .eq('id', profile.id);
            
            // Update profile object with new current_organization_id
            profile.current_organization_id = organizationId;
          }
        }
      }

      // Get user's organization role from organization_members
      let organizationRole = null;
      let organizationIdForUser = profile.current_organization_id || organizationId;
      
      console.log('🔍 Looking up organization role:', {
        userId: profile.id,
        organizationIdForUser,
        fromProfile: profile.current_organization_id,
        fromParam: organizationId
      });
      
      if (organizationIdForUser) {
        const { data: membership, error: membershipError } = await supabaseAdmin
          .from('organization_members')
          .select('role, organization_id')
          .eq('user_id', profile.id)
          .eq('organization_id', organizationIdForUser)
          .single();
        
        console.log('🔍 Membership query result:', {
          found: !!membership,
          role: membership?.role,
          error: membershipError?.message
        });
        
        if (membership) {
          organizationRole = membership.role;
          console.log(`✅ User organization role: ${organizationRole}`);
        } else {
          console.log('❌ No membership found in organization_members table');
        }
      } else {
        console.log('⚠️ No organizationIdForUser - user not in any organization');
      }

      // Add organization_role to profile
      const userWithOrgRole = {
        ...profile,
        organization_role: organizationRole,
        organization_id: organizationIdForUser
      };

      console.log('📤 Returning user object:', {
        id: userWithOrgRole.id,
        email: userWithOrgRole.email,
        role: userWithOrgRole.role,
        organization_role: userWithOrgRole.organization_role,
        organization_id: userWithOrgRole.organization_id,
        current_organization_id: userWithOrgRole.current_organization_id
      });

      return {
        user: userWithOrgRole,
        session: data.session,
        joinedOrganization
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(token) {
    try {
      console.log('🚪 Logging out user');
      const { error } = await supabase.auth.admin.signOut(token);
      if (error) {
        console.error('⚠️ Logout error:', error);
        // Don't throw - logout should always succeed on client side
      }
      console.log('✅ Logout successful');
      return true;
    } catch (error) {
      console.error('⚠️ Logout error:', error);
      return true; // Still return success
    }
  }

  /**
   * Get current user with organization role
   */
  async getCurrentUser(userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id, email, name, role, organization_role, organization_id, avatar_url, created_at')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ Get user error:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(userId, updates) {
    try {
      // Remove fields that shouldn't be updated
      const { id, email, created_at, ...allowedUpdates } = updates;

      const { data, error } = await supabaseAdmin
        .from('users')
        .update(allowedUpdates)
        .eq('id', userId)
        .select('id, email, name, role, organization_role, organization_id, avatar_url, updated_at')
        .single();

      if (error) throw error;
      console.log('✅ Profile updated:', userId);
      return data;
    } catch (error) {
      console.error('❌ Update profile error:', error);
      throw error;
    }
  }

  /**
   * Request password reset
   */
  async forgotPassword(email) {
    try {
      console.log('📧 Sending password reset email to:', email);
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${config.frontendUrl}/reset-password`
      });

      if (error) throw error;
      console.log('✅ Password reset email sent');
      return true;
    } catch (error) {
      console.error('❌ Forgot password error:', error);
      throw error;
    }
  }

  /**
   * Reset password
   */
  async resetPassword(token, newPassword) {
    try {
      console.log('🔄 Resetting password');
      
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;
      console.log('✅ Password reset successful');
      return true;
    } catch (error) {
      console.error('❌ Reset password error:', error);
      throw error;
    }
  }

  /**
   * Refresh session
   */
  async refreshSession(refreshToken) {
    try {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (error) throw error;
      console.log('✅ Session refreshed');
      return data.session;
    } catch (error) {
      console.error('❌ Refresh session error:', error);
      throw error;
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email) {
    try {
      console.log('📧 Resending verification email to:', email);
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          emailRedirectTo: `${config.frontendUrl}/auth/callback`
        }
      });

      if (error) throw error;
      console.log('✅ Verification email resent');
      return true;
    } catch (error) {
      console.error('❌ Resend verification error:', error);
      throw error;
    }
  }

  /**
   * Delete user account
   */
  async deleteAccount(userId) {
    try {
      console.log('🗑️ Deleting account:', userId);
      
      // Delete from users table first
      const { error: dbError } = await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', userId);

      if (dbError) throw dbError;

      // Delete from auth
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (authError) throw authError;

      console.log('✅ Account deleted');
      return true;
    } catch (error) {
      console.error('❌ Delete account error:', error);
      throw error;
    }
  }
}

module.exports = new AuthService();
