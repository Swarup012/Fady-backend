const { supabase, supabaseAdmin } = require('../config/supabase.config');
const config = require('../config/env.config');
const cache = require('./redis.service');
const emailService = require('./email.service');
const crypto = require('crypto');

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
        .select('id, auth_id, email, name, current_organization_id, avatar_url, created_at')
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

          // Reflect the newly joined org in the user object
          if (!existingUser.current_organization_id) {
            existingUser.current_organization_id = organizationId;
          }

          console.log('✅ Existing user joined organization');
        }

        // Fetch organization_role and job_role so the frontend can route correctly
        // (mirrors what login() does — AuthContext uses organization_role for routing)
        let organizationRole = null;
        let jobRole = null;
        const orgIdForUser = existingUser.current_organization_id;

        if (orgIdForUser) {
          const { data: membership } = await supabaseAdmin
            .from('organization_members')
            .select('role, job_role')
            .eq('user_id', existingUser.id)
            .eq('organization_id', orgIdForUser)
            .single();

          if (membership) {
            organizationRole = membership.role;
            jobRole = membership.job_role;
            console.log(`✅ Existing user org role: ${organizationRole}, job_role: ${jobRole}`);
          }
        }

        const userWithOrgRole = {
          ...existingUser,
          organization_role: organizationRole,
          organization_id: orgIdForUser,
          job_role: jobRole,
        };

        return {
          action: 'joined_existing',
          user: userWithOrgRole,
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

      // Step 4: CREATE PROFILE (no role/organization_id/organization_role in users table)
      console.log('📊 Creating user profile...');
      
      const profileData = {
        id: authUserId,
        email: email,
        name: name,
        current_organization_id: organizationId, // Current org they're viewing
        avatar_url: null,
        created_at: new Date().toISOString()
      };
      
      console.log('🔍 Attempting insert with data:', { 
        id: authUserId, 
        email, 
        name,
        current_organization_id: organizationId
      });
      
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('users')
        .insert([profileData])
        .select('id, email, name, current_organization_id, created_at')
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
      let jobRole = null;
      if (organizationId) {
        console.log(`📋 Adding user to organization_members as ${organizationRole}...`);
        
        const { error: memberError } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: profile.id,
            organization_id: organizationId,
            role: organizationRole, // Permission role: owner/admin/member
            job_role: role || null  // Job role: founder/designer/developer/etc
          });

        if (memberError) {
          console.error('❌ Failed to add user to organization:', memberError);
          // Don't throw - user is created, they just aren't in the org
          console.warn('⚠️ User created but not added to organization');
        } else {
          console.log('✅ User added to organization with job_role:', role);
          jobRole = role;
        }
      }

      // Step 6: Add organization_role and job_role to user object before returning
      const userWithOrgRole = {
        ...profile,
        organization_role: organizationRole || null,
        organization_id: organizationId || null,
        job_role: jobRole
      };
      
      console.log(`✅ Signup complete - organization_role: ${organizationRole}, job_role: ${jobRole}`);

      const orgEndUserService = require('./org-end-user.service');
      orgEndUserService
        .linkOrgEndUsersToAuthUser(profile.email, profile.id)
        .then(({ count }) => {
          if (count > 0) {
            console.log(`🔗 Linked ${count} org_end_user record(s) on signup`);
          }
        })
        .catch((err) =>
          console.warn('⚠️ org_end_users link on signup failed (non-fatal):', err.message),
        );

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

      // Get user profile (no role field anymore - it's in organization_members)
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('users')
        .select('id, email, name, current_organization_id, avatar_url, created_at')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error('❌ Profile fetch error:', profileError);
        throw new Error('User profile not found');
      }

      console.log('✅ Login successful:', profile.email);
      console.log('🔍 User current_organization_id:', profile.current_organization_id);

      // Link widget org_end_users with same email to this auth user (all orgs)
      const orgEndUserService = require('./org-end-user.service');
      orgEndUserService
        .linkOrgEndUsersToAuthUser(profile.email, profile.id)
        .then(({ count }) => {
          if (count > 0) {
            console.log(`🔗 Linked ${count} org_end_user record(s) to auth user`);
          }
        })
        .catch((err) =>
          console.warn('⚠️ org_end_users link on login failed (non-fatal):', err.message),
        );

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
          const { error: updateError } = await supabaseAdmin
            .from('users')
            .update({ current_organization_id: organizationId })
            .eq('id', profile.id);
          
          if (updateError) {
            console.error('❌ Failed to update current_organization_id:', updateError);
          } else {
            console.log('✅ Updated current_organization_id to:', organizationId);
          }
          
          // Update profile object with new current_organization_id
          profile.current_organization_id = organizationId;
        } else {
          // Add to organization as member
          // Default job_role to 'other' if not provided (to satisfy NOT NULL constraint)
          const defaultJobRole = userRole || 'other';
          
          const { error: memberError } = await supabaseAdmin
            .from('organization_members')
            .insert({
              user_id: profile.id,
              organization_id: organizationId,
              role: 'member',
              job_role: defaultJobRole
            });

          if (memberError) {
            console.error('❌ Failed to add user to organization:', memberError);
          } else {
            console.log('✅ User added to organization with job_role:', userRole);
            joinedOrganization = true;
            
            // Set as current organization
            const { error: updateError } = await supabaseAdmin
              .from('users')
              .update({ current_organization_id: organizationId })
              .eq('id', profile.id);
            
            if (updateError) {
              console.error('❌ Failed to update current_organization_id:', updateError);
            } else {
              console.log('✅ Updated current_organization_id to:', organizationId);
            }
            
            // Update profile object with new current_organization_id
            profile.current_organization_id = organizationId;
          }
        }
      }

      // Get user's organization role from organization_members
      let organizationRole = null;
      let organizationIdForUser = profile.current_organization_id || organizationId;
      
      console.log('🔍 Looking up organization role AFTER updates:', {
        userId: profile.id,
        organizationIdForUser,
        'profile.current_organization_id': profile.current_organization_id,
        'passed organizationId': organizationId,
        joinedOrganization
      });
      
      let jobRole = null;
      if (organizationIdForUser) {
        const { data: membership, error: membershipError } = await supabaseAdmin
          .from('organization_members')
          .select('role, job_role, organization_id')
          .eq('user_id', profile.id)
          .eq('organization_id', organizationIdForUser)
          .single();
        
        console.log('🔍 Membership query result:', {
          found: !!membership,
          role: membership?.role,
          job_role: membership?.job_role,
          error: membershipError?.message
        });
        
        if (membership) {
          organizationRole = membership.role;
          jobRole = membership.job_role;
          console.log(`✅ User organization role: ${organizationRole}, job_role: ${jobRole}`);
        } else {
          console.log('❌ No membership found in organization_members table');
        }
      } else {
        console.log('⚠️ No organizationIdForUser - user not in any organization');
      }

      // Add organization_role and job_role to profile
      const userWithOrgRole = {
        ...profile,
        organization_role: organizationRole,
        organization_id: organizationIdForUser,
        job_role: jobRole
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
      
      // 🔴 Invalidate session cache for this token
      const crypto = require('crypto');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 32);
      const sessionCacheKey = `user:session:${tokenHash}`;
      await cache.delete(sessionCacheKey);
      console.log('🗑️  Session cache invalidated');
      
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
   * Get current user by ID
   */
  async getCurrentUser(userId) {
    try {
      // Fetch user from users table (only has basic fields now)
      const { data: profile, error } = await supabaseAdmin
        .from('users')
        .select('id, email, name, avatar_url, current_organization_id, created_at')
        .eq('id', userId)
        .single();

      if (error) throw error;

      // If user has current_organization_id, fetch organization_role and job_role
      if (profile.current_organization_id) {
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('role, job_role')
          .eq('user_id', userId)
          .eq('organization_id', profile.current_organization_id)
          .single();

        if (membership) {
          profile.organization_role = membership.role;
          profile.job_role = membership.job_role;
          profile.organization_id = profile.current_organization_id;
        }
      }

      return profile;
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
      // Remove fields that shouldn't be updated or don't exist in users table
      const { id, email, created_at, role, organization_role, organization_id, job_role, ...allowedUpdates } = updates;

      const { data: profile, error } = await supabaseAdmin
        .from('users')
        .update(allowedUpdates)
        .eq('id', userId)
        .select('id, email, name, avatar_url, current_organization_id, updated_at')
        .single();

      if (error) throw error;

      // Fetch organization context if available
      if (profile.current_organization_id) {
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('role, job_role')
          .eq('user_id', userId)
          .eq('organization_id', profile.current_organization_id)
          .single();

        if (membership) {
          profile.organization_role = membership.role;
          profile.job_role = membership.job_role;
          profile.organization_id = profile.current_organization_id;
        }
      }

      // 🔴 Invalidate only THIS user's session caches (not all users)
      await cache.invalidateUserSessions(userId);
      console.log('🗑️ User session caches invalidated after profile update');
      
      console.log('✅ Profile updated:', userId);
      return profile;
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
      console.log('📧 Processing password reset request for:', email);
      
      // Check if user exists
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email, name')
        .eq('email', email)
        .maybeSingle();

      if (userError) {
        console.error('❌ Database error checking user:', userError);
        // Don't reveal database errors to client
        return { success: true };
      }

      if (!user) {
        // Don't reveal if user exists or not (security best practice)
        console.log('⚠️ User not found, but not revealing this to client');
        return { success: true };
      }

      console.log('✅ User found:', user.email);

      // Generate secure random token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Store token in database
      const { error: tokenError } = await supabaseAdmin
        .from('password_reset_tokens')
        .insert({
          user_id: user.id,
          token: resetToken,
          expires_at: expiresAt.toISOString(),
          used: false
        });

      if (tokenError) {
        console.error('❌ Error storing reset token:', tokenError);
        throw new Error('Failed to generate reset token');
      }

      // Send password reset email using Resend
      await emailService.sendPasswordResetEmail(user.email, resetToken, user.name);

      console.log('✅ Password reset email sent successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ Forgot password error:', error);
      throw error;
    }
  }

  /**
   * Reset password with token validation
   */
  async resetPassword(token, newPassword) {
    try {
      console.log('🔄 Validating reset token and updating password');
      
      // Validate token exists and is not expired or used
      const { data: resetToken, error: tokenError } = await supabaseAdmin
        .from('password_reset_tokens')
        .select('id, user_id, expires_at, used')
        .eq('token', token)
        .maybeSingle();

      if (tokenError || !resetToken) {
        throw new Error('Invalid or expired reset token');
      }

      if (resetToken.used) {
        throw new Error('This reset token has already been used');
      }

      if (new Date(resetToken.expires_at) < new Date()) {
        throw new Error('Reset token has expired');
      }

      // Update user password using Supabase Admin API
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        resetToken.user_id,
        { password: newPassword }
      );

      if (updateError) {
        console.error('❌ Error updating password:', updateError);
        throw new Error('Failed to update password');
      }

      // Mark token as used
      await supabaseAdmin
        .from('password_reset_tokens')
        .update({ used: true })
        .eq('id', resetToken.id);

      console.log('✅ Password reset successful');
      return { success: true };
    } catch (error) {
      console.error('❌ Reset password error:', error);
      throw error;
    }
  }

  /**
   * Verify reset token validity
   */
  async verifyResetToken(token) {
    try {
      const { data: resetToken, error } = await supabaseAdmin
        .from('password_reset_tokens')
        .select('id, expires_at, used')
        .eq('token', token)
        .maybeSingle();

      if (error || !resetToken) {
        return { valid: false, message: 'Invalid token' };
      }

      if (resetToken.used) {
        return { valid: false, message: 'Token already used' };
      }

      if (new Date(resetToken.expires_at) < new Date()) {
        return { valid: false, message: 'Token expired' };
      }

      return { valid: true };
    } catch (error) {
      console.error('❌ Error verifying token:', error);
      return { valid: false, message: 'Validation error' };
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
