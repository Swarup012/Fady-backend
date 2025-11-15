const authService = require('../services/auth.service');
const ResponseUtil = require('../utils/response.util');
const { supabaseAdmin } = require('../config/supabase.config');

class AuthController {
  /**
   * Register new user or join existing organization
   * POST /api/auth/signup
   */
  async signup(req, res, next) {
    try {
      const { email, password, name, role, organizationId } = req.body;

      console.log('📝 Signup request:', { email, name, role, organizationId });

      const result = await authService.signupOrJoin({ email, password, name, role, organizationId });

      // Check if this was an existing user joining
      if (result.action === 'joined_existing') {
        return ResponseUtil.success(
          res,
          'Successfully joined organization.',
          {
            user: result.user,
            access_token: result.session.access_token,
            refresh_token: result.session.refresh_token,
            action: 'joined_existing'
          },
          200
        );
      }

      // New user created
      // Handle case where email confirmation is required
      if (!result.session) {
        return ResponseUtil.success(
          res,
          'User registered successfully. Please check your email to verify your account before logging in.',
          {
            user: result.user,
            emailConfirmationRequired: true,
            action: 'created_new'
          },
          201
        );
      }

      // Email confirmation is disabled - return tokens
      return ResponseUtil.success(
        res,
        'User registered successfully.',
        {
          user: result.user,
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
          emailConfirmationRequired: false,
          action: 'created_new'
        },
        201
      );
    } catch (error) {
      console.error('Signup controller error:', error);
      
      if (error.message.includes('already a member')) {
        return ResponseUtil.error(res, 'You are already a member of this organization. Please login instead.', 409);
      }
      
      if (error.message.includes('Invalid password')) {
        return ResponseUtil.error(res, 'Invalid password. If you already have an account, please use your existing password or reset it.', 401);
      }
      
      if (error.message.includes('already registered') || error.message.includes('User already registered')) {
        return ResponseUtil.error(res, 'Email already registered', 409);
      }
      
      if (error.message.includes('Invalid email')) {
        return ResponseUtil.error(res, 'Please provide a valid email address', 400);
      }
      
      next(error);
    }
  }

  /**
   * Login user - with optional organization joining
   * POST /api/auth/login
   */
  async login(req, res, next) {
    try {
      const { email, password, organizationId, userRole } = req.body;

      const result = await authService.login({ email, password, organizationId, userRole });

      return ResponseUtil.success(res, 'Login successful', {
        user: result.user,
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
        joinedOrganization: result.joinedOrganization || false
      });
    } catch (error) {
      console.error('Login controller error:', error);
      
      if (error.message.includes('already a member')) {
        return ResponseUtil.error(res, 'You are already a member of this organization.', 409);
      }
      
      if (error.message.includes('Invalid') || 
          error.message.includes('credentials') || 
          error.message.includes('Email not confirmed')) {
        return ResponseUtil.error(res, 'Invalid email or password. If you just signed up, please verify your email first.', 401);
      }
      
      next(error);
    }
  }

  /**
   * Logout user
   * POST /api/auth/logout
   */
  async logout(req, res, next) {
    try {
      await authService.logout(req.token);
      return ResponseUtil.success(res, 'Logout successful');
    } catch (error) {
      console.error('Logout controller error:', error);
      // Even if logout fails, return success to client
      return ResponseUtil.success(res, 'Logout successful');
    }
  }

  /**
   * Get current user
   * GET /api/auth/me
   */
  async getMe(req, res, next) {
    try {
      return ResponseUtil.success(res, 'User retrieved successfully', {
        user: req.user
      });
    } catch (error) {
      console.error('GetMe controller error:', error);
      next(error);
    }
  }

  /**
   * Update user profile
   * PUT /api/auth/profile
   */
  async updateProfile(req, res, next) {
    try {
      const updates = req.body;
      const updatedUser = await authService.updateProfile(req.user.id, updates);

      return ResponseUtil.success(res, 'Profile updated successfully', {
        user: updatedUser
      });
    } catch (error) {
      console.error('Update profile controller error:', error);
      next(error);
    }
  }

  /**
   * Request password reset
   * POST /api/auth/forgot-password
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      await authService.forgotPassword(email);

      return ResponseUtil.success(
        res,
        'If an account exists with this email, you will receive a password reset link'
      );
    } catch (error) {
      console.error('Forgot password controller error:', error);
      // Don't expose whether email exists or not
      return ResponseUtil.success(
        res,
        'If an account exists with this email, you will receive a password reset link'
      );
    }
  }

  /**
   * Reset password
   * POST /api/auth/reset-password
   */
  async resetPassword(req, res, next) {
    try {
      const { password } = req.body;
      await authService.resetPassword(req.token, password);

      return ResponseUtil.success(res, 'Password reset successful');
    } catch (error) {
      console.error('Reset password controller error:', error);
      next(error);
    }
  }

  /**
   * Refresh session
   * POST /api/auth/refresh
   */
  async refreshSession(req, res, next) {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return ResponseUtil.error(res, 'Refresh token is required', 400);
      }

      const session = await authService.refreshSession(refresh_token);

      return ResponseUtil.success(res, 'Session refreshed successfully', {
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });
    } catch (error) {
      console.error('Refresh session controller error:', error);
      return ResponseUtil.error(res, 'Invalid or expired refresh token', 401);
    }
  }

  /**
   * Resend verification email
   * POST /api/auth/resend-verification
   */
  async resendVerification(req, res, next) {
    try {
      const { email } = req.body;

      if (!email) {
        return ResponseUtil.error(res, 'Email is required', 400);
      }

      await authService.resendVerificationEmail(email);

      return ResponseUtil.success(
        res,
        'If your email is not verified, a new verification email has been sent'
      );
    } catch (error) {
      console.error('Resend verification controller error:', error);
      // Don't expose whether email exists or not
      return ResponseUtil.success(
        res,
        'If your email is not verified, a new verification email has been sent'
      );
    }
  }

  /**
   * Update user job role (post-auth role selection)
   * PUT /api/auth/update-role
   * Note: This updates job_role in organization_members, not users table
   */
  async updateRole(req, res, next) {
    try {
      const { role, organizationId: providedOrgId } = req.body;
      const userId = req.user.id;

      console.log('📝 updateRole request:', {
        role,
        providedOrgId,
        userId,
        currentOrgId: req.user.current_organization_id,
        userOrgRole: req.user.organization_role
      });

      if (!role) {
        console.error('❌ Missing role in request');
        return ResponseUtil.error(res, 'Role is required', 400);
      }

      // Use provided organizationId or fall back to current_organization_id
      const organizationId = providedOrgId || req.user.current_organization_id;

      if (!organizationId) {
        console.error('❌ No organization ID available (neither provided nor current_organization_id)');
        return ResponseUtil.error(res, 'Organization ID is required. Please join or create an organization first.', 400);
      }

      console.log(`🔄 Updating job_role for user ${userId}: job_role=${role}, orgId=${organizationId}`);

      // Check if already a member
      const { data: existingMembership } = await supabaseAdmin
        .from('organization_members')
        .select('id, role, job_role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .single();

      if (!existingMembership) {
        // Add to organization as member with job_role
        const { error: memberError } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: userId,
            organization_id: organizationId,
            role: 'member', // Permission role
            job_role: role  // Job role (founder/designer/etc)
          });

        if (memberError) {
          console.error('❌ Failed to add user to organization:', memberError);
          throw new Error('Failed to update role');
        }
        
        console.log('✅ User added to organization with job_role:', role);
        
        // Set as current organization
        await supabaseAdmin
          .from('users')
          .update({ current_organization_id: organizationId })
          .eq('id', userId);
      } else {
        // Update job_role for existing member
        const { error: updateError } = await supabaseAdmin
          .from('organization_members')
          .update({ job_role: role })
          .eq('user_id', userId)
          .eq('organization_id', organizationId);

        if (updateError) {
          console.error('❌ Failed to update job_role:', updateError);
          throw new Error('Failed to update role');
        }
        
        console.log('✅ Job role updated to:', role);
        
        // Set as current organization
        await supabaseAdmin
          .from('users')
          .update({ current_organization_id: organizationId })
          .eq('id', userId);
      }

      // Get updated user profile
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('id, email, name, current_organization_id')
        .eq('id', userId)
        .single();

      // Get organization membership with roles
      const { data: membership } = await supabaseAdmin
        .from('organization_members')
        .select('role, job_role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .single();

      const userWithRoles = {
        ...user,
        organization_role: membership?.role,
        job_role: membership?.job_role,
        organization_id: organizationId
      };

      console.log('✅ Role updated successfully');

      return ResponseUtil.success(res, 'Role updated successfully', {
        user: userWithRoles
      });
    } catch (error) {
      console.error('Update role controller error:', error);
      next(error);
    }
  }
}

module.exports = new AuthController();
