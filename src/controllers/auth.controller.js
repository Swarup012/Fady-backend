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
   * Update user role (post-auth role selection)
   * PUT /api/auth/update-role
   */
  async updateRole(req, res, next) {
    try {
      const { role, organizationId } = req.body;
      const userId = req.user.id;

      if (!role) {
        return ResponseUtil.error(res, 'Role is required', 400);
      }

      console.log(`🔄 Updating role for user ${userId}: role=${role}, orgId=${organizationId}`);

      // Update user's job role in users table
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .update({ 
          role,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select('id, email, name, role, current_organization_id')
        .single();

      if (userError) {
        console.error('❌ Failed to update user role:', userError);
        throw new Error('Failed to update role');
      }

      // If organizationId is provided, add user to that organization
      if (organizationId) {
        console.log(`🏢 Adding user to organization: ${organizationId}`);
        
        // Check if already a member
        const { data: existingMembership } = await supabaseAdmin
          .from('organization_members')
          .select('id, role')
          .eq('user_id', userId)
          .eq('organization_id', organizationId)
          .single();

        if (!existingMembership) {
          // Add to organization as member
          const { error: memberError } = await supabaseAdmin
            .from('organization_members')
            .insert({
              user_id: userId,
              organization_id: organizationId,
              role: 'member' // Organization role, not job role
            });

          if (memberError) {
            console.error('❌ Failed to add user to organization:', memberError);
          } else {
            console.log('✅ User added to organization');
            
            // Set as current organization if user doesn't have one
            if (!user.current_organization_id) {
              await supabaseAdmin
                .from('users')
                .update({ current_organization_id: organizationId })
                .eq('id', userId);
              
              user.current_organization_id = organizationId;
            }
          }
        } else {
          console.log('ℹ️ User already a member of this organization');
          
          // Set as current organization
          await supabaseAdmin
            .from('users')
            .update({ current_organization_id: organizationId })
            .eq('id', userId);
          
          user.current_organization_id = organizationId;
        }
      }

      console.log('✅ Role updated successfully');

      return ResponseUtil.success(res, 'Role updated successfully', {
        user
      });
    } catch (error) {
      console.error('Update role controller error:', error);
      next(error);
    }
  }
}

module.exports = new AuthController();
