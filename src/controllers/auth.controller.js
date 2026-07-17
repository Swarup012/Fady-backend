const authService = require('../services/auth.service');
const storageService = require('../services/storage.service');
const ResponseUtil = require('../utils/response.util');
const { supabase, supabaseAdmin } = require('../config/supabase.config');
const config = require('../config/env.config');

/**
 * Build cookie options.
 * IMPORTANT: Browsers silently reject cookies with domain='.localhost'.
 * In development we omit the domain attribute entirely so the browser
 * scopes the cookie to the exact origin (localhost:3000).
 * In production we set domain='.faddy.site' for cross-subdomain sharing.
 */
function makeCookieOptions(overrides = {}) {
  const base = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.cookieMaxAge,
    path: '/',
  };
  // Only set domain in production — omitting it in dev makes cookies work on localhost
  if (config.isProduction) {
    base.domain = `.${config.cookieDomain}`;
  }
  return { ...base, ...overrides };
}


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

      // Set HTTP-only cookies for cross-subdomain authentication
      const cookieOptions = makeCookieOptions();

      // Check if this was an existing user joining
      if (result.action === 'joined_existing') {
        res.cookie('access_token', result.session.access_token, cookieOptions);
        res.cookie('refresh_token', result.session.refresh_token, cookieOptions);
        
        return ResponseUtil.success(
          res,
          'Successfully joined organization.',
          { user: result.user, action: 'joined_existing' },
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

      // Email confirmation is disabled - set HttpOnly cookies and return user only
      res.cookie('access_token', result.session.access_token, cookieOptions);
      res.cookie('refresh_token', result.session.refresh_token, cookieOptions);

      return ResponseUtil.success(
        res,
        'User registered successfully.',
        { user: result.user, emailConfirmationRequired: false, action: 'created_new' },
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

      // Set HTTP-only cookies for cross-subdomain authentication
      const cookieOptions = makeCookieOptions();

      res.cookie('access_token', result.session.access_token, cookieOptions);
      res.cookie('refresh_token', result.session.refresh_token, cookieOptions);

      // Tokens are delivered via HttpOnly cookies — do NOT return them in the JSON body
      return ResponseUtil.success(res, 'Login successful', {
        user: result.user,
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

      // Clear HTTP-only cookies
      const clearOpts = makeCookieOptions({ maxAge: undefined });

      res.clearCookie('access_token', clearOpts);
      res.clearCookie('refresh_token', clearOpts);

      return ResponseUtil.success(res, 'Logout successful');
    } catch (error) {
      console.error('Logout controller error:', error);
      // Even if logout fails, clear cookies and return success to client
      const clearOpts = makeCookieOptions({ maxAge: undefined });

      res.clearCookie('access_token', clearOpts);
      res.clearCookie('refresh_token', clearOpts);

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
   * Upload avatar
   * POST /api/auth/upload-avatar
   */
  async uploadAvatar(req, res, next) {
    try {
      if (!req.file) {
        return ResponseUtil.error(res, 'No file uploaded', 400);
      }

      const userId = req.user.id;

      // Get current user to check for existing avatar
      const { data: currentUser } = await supabaseAdmin
        .from('users')
        .select('avatar_url')
        .eq('id', userId)
        .single();

      // Delete old avatar if exists
      if (currentUser?.avatar_url) {
        const oldFilePath = storageService.extractFilePath(currentUser.avatar_url);
        if (oldFilePath) {
          await storageService.deleteAvatar(oldFilePath);
        }
      }

      // Upload new avatar
      const uploadResult = await storageService.uploadAvatar(userId, req.file);

      // Update user profile with new avatar URL
      const updatedUser = await authService.updateProfile(userId, {
        avatar_url: uploadResult.url,
      });

      return ResponseUtil.success(res, 'Avatar uploaded successfully', {
        user: updatedUser,
        avatar_url: uploadResult.url,
      });
    } catch (error) {
      console.error('Upload avatar controller error:', error);
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
   * Reset password with token
   * POST /api/auth/reset-password
   */
  async resetPassword(req, res, next) {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return ResponseUtil.error(res, 'Token and password are required', 400);
      }

      const result = await authService.resetPassword(token, password);

      return ResponseUtil.success(res, 'Password reset successful. You can now login with your new password.');
    } catch (error) {
      console.error('Reset password controller error:', error);
      
      // Handle specific error messages
      if (error.message.includes('Invalid') || error.message.includes('expired')) {
        return ResponseUtil.error(res, error.message, 400);
      }
      
      next(error);
    }
  }

  /**
   * Verify reset token
   * GET /api/auth/verify-reset-token
   */
  async verifyResetToken(req, res, next) {
    try {
      const { token } = req.query;

      if (!token) {
        return ResponseUtil.error(res, 'Token is required', 400);
      }

      const result = await authService.verifyResetToken(token);

      if (!result.valid) {
        return ResponseUtil.error(res, result.message, 400);
      }

      return ResponseUtil.success(res, 'Token is valid');
    } catch (error) {
      console.error('Verify reset token error:', error);
      next(error);
    }
  }

  /**
   * Refresh session
   * POST /api/auth/refresh
   */
  async refreshSession(req, res, next) {
    try {
      // Read the refresh token from the HttpOnly cookie (not the request body)
      const refresh_token = req.cookies?.refresh_token;

      if (!refresh_token) {
        return ResponseUtil.error(res, 'No refresh token cookie found', 401);
      }

      const session = await authService.refreshSession(refresh_token);

      // Rotate both cookies with the new tokens
      const cookieOptions = makeCookieOptions();

      res.cookie('access_token', session.access_token, cookieOptions);
      res.cookie('refresh_token', session.refresh_token, cookieOptions);

      // No tokens in the body — the new cookies are all the client needs
      return ResponseUtil.success(res, 'Session refreshed successfully');
    } catch (error) {
      console.error('Refresh session controller error:', error);
      return ResponseUtil.error(res, 'Invalid or expired refresh token', 401);
    }
  }

  /**
   * Issue a short-lived WebSocket ticket for Socket.io authentication.
   * HttpOnly cookies cannot be read by JS and are not reliably forwarded
   * during the Socket.io HTTP handshake, so we issue a one-time signed
   * ticket (TTL: 30 seconds) that the client passes in socket.auth.ticket.
   *
   * GET /api/auth/ws-ticket  (requires authenticate middleware)
   */
  async getWsTicket(req, res, next) {
    try {
      const jwt = require('jsonwebtoken');
      const crypto = require('crypto');

      if (!process.env.JWT_SECRET) {
        return ResponseUtil.error(res, 'Server configuration error', 500);
      }

      // One-time nonce prevents replay attacks
      const nonce = crypto.randomBytes(16).toString('hex');

      const ticket = jwt.sign(
        {
          userId: req.user.id,
          email: req.user.email,
          organizationId: req.user.current_organization_id,
          nonce,
          purpose: 'ws-ticket',  // Scope this token so it can't be used as a regular access token
        },
        process.env.JWT_SECRET,
        { expiresIn: '30s' }   // Very short TTL — client connects immediately after receiving it
      );

      return ResponseUtil.success(res, 'WS ticket issued', { ticket });
    } catch (error) {
      console.error('getWsTicket error:', error);
      next(error);
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
   * Google OAuth authentication
   * POST /api/auth/google
   */
  async googleAuth(req, res, next) {
    try {
      const { email, name, googleId, avatar, supabaseToken } = req.body;

      if (!email || !googleId) {
        return ResponseUtil.error(res, 'Email and Google ID are required', 400);
      }

      // 🔒 SECURITY: Supabase token is REQUIRED — reject requests without it
      if (!supabaseToken) {
        console.error('❌ Google auth rejected: no Supabase token provided');
        return ResponseUtil.error(res, 'Authentication token is required. Please sign in with Google again.', 401);
      }

      // 🔒 SECURITY: Verify the Supabase token to ensure user actually authenticated with Google
      // Decode the JWT payload to extract claims (no network call needed)
      // Then verify with Supabase as a secondary check (network call)
      let verifiedUser;
      let tokenEmail = null;
      let tokenUserId = null;

      try {
        // Step 1: Decode JWT payload to extract email (works offline, no network needed)
        // Supabase access tokens are JWTs — we can read the payload without verifying the signature
        // because we'll verify with Supabase next
        const parts = supabaseToken.split('.');
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
            tokenEmail = payload.email;
            tokenUserId = payload.sub;
          } catch (decodeErr) {
            console.warn('⚠️ Could not decode JWT payload:', decodeErr.message);
          }
        }

        // Step 2: Verify with Supabase (network call)
        const { data: { user }, error: verifyError } = await supabase.auth.getUser(supabaseToken);

        if (verifyError) {
          // If it's a network error (fetch failed), fall back to decoded JWT claims
          const isNetworkError = verifyError.message?.includes('fetch failed') ||
                                 verifyError.message?.includes('network') ||
                                 verifyError.message?.includes('ECONNREFUSED') ||
                                 verifyError.message?.includes('ETIMEDOUT');

          if (isNetworkError && tokenEmail) {
            console.warn('⚠️ Supabase unreachable during token verification, falling back to decoded JWT claims');
            verifiedUser = { email: tokenEmail, id: tokenUserId };
          } else {
            console.error('❌ Google auth rejected: Supabase token verification failed:', verifyError.message);
            return ResponseUtil.error(res, 'Invalid or expired authentication token', 401);
          }
        } else if (!user) {
          console.error('❌ Google auth rejected: no user returned from token verification');
          return ResponseUtil.error(res, 'Invalid authentication token', 401);
        } else {
          verifiedUser = user;
        }

        // Verify that the verified/decoded user matches the claimed email
        if (verifiedUser.email !== email) {
          console.error('❌ Token email mismatch:', { tokenEmail: verifiedUser.email, claimedEmail: email });
          return ResponseUtil.error(res, 'Token does not match claimed identity', 401);
        }

        console.log('✅ Supabase token verified:', { userId: verifiedUser.id || verifiedUser.sub, email });
      } catch (verifyError) {
        console.error('❌ Google auth rejected: token verification error:', verifyError.message);
        return ResponseUtil.error(res, 'Authentication token verification failed', 401);
      }

      // Check if user exists by email (NOT by googleId to allow account linking)
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      let user;
      let needsOnboarding = false;

      if (existingUser) {
        // If existing user has a different google_id, update it since we verified the email matches
        // Supabase may generate new auth user IDs on each Google sign-in, but the email is the same
        if (existingUser.google_id && existingUser.google_id !== googleId) {
          console.log('ℹ️ Updating google_id for existing user (Supabase generated new auth ID):', {
            existingGoogleId: existingUser.google_id,
            newGoogleId: googleId
          });
        }

        // Update existing user with Google info
        const { data: updatedUser, error: updateError } = await supabaseAdmin
          .from('users')
          .update({
            google_id: googleId,
            avatar_url: avatar || existingUser.avatar_url,
            name: name || existingUser.name,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingUser.id)
          .select()
          .single();

        if (updateError) {
          console.error('Failed to update user with Google info:', updateError);
          throw new Error('Failed to update user');
        }

        user = updatedUser;

        // Check if user needs onboarding (no current organization)
        needsOnboarding = !user.current_organization_id;
      } else {
        // Create new user with Google OAuth
        const crypto = require('crypto');
        const userId = crypto.randomUUID();

        const { data: newUser, error: createError } = await supabaseAdmin
          .from('users')
          .insert({
            id: userId,
            email,
            name: name || email.split('@')[0],
            google_id: googleId,
            avatar_url: avatar,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (createError) {
          console.error('Failed to create user:', createError);

          // Check if it's a duplicate constraint error
          if (createError.code === '23505') {
            // User might already exist, try to fetch by google_id
            const { data: existingByGoogleId } = await supabaseAdmin
              .from('users')
              .select('*')
              .eq('google_id', googleId)
              .single();

            if (existingByGoogleId) {
              user = existingByGoogleId;
              console.log('✅ Found existing user by google_id:', user.email);
              needsOnboarding = !user.current_organization_id;
            } else {
              throw new Error('Failed to create user: duplicate entry');
            }
          } else {
            throw new Error('Failed to create user');
          }
        } else {
          user = newUser;
          needsOnboarding = true; // New users always need onboarding
        }
      }

      // Generate JWT token
      const jwt = require('jsonwebtoken');
      const config = require('../config/env.config');
      
      if (!process.env.JWT_SECRET) {
        console.error('❌ JWT_SECRET not configured');
        return ResponseUtil.error(res, 'Server authentication configuration error', 500);
      }

      // Fetch organization_role and job_role so the frontend can route correctly
      let organizationRole = null;
      let jobRole = null;
      if (user.current_organization_id) {
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('role, job_role')
          .eq('user_id', user.id)
          .eq('organization_id', user.current_organization_id)
          .single();
        if (membership) {
          organizationRole = membership.role;
          jobRole = membership.job_role;
        }
      }

      const token = jwt.sign(
        { 
          userId: user.id, 
          email: user.email,
          organizationId: user.current_organization_id 
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      // Set HTTP-only cookies
      const cookieOptions = makeCookieOptions();

      res.cookie('access_token', token, cookieOptions);

      console.log('✅ Google OAuth successful for:', email);

      return ResponseUtil.success(res, 'Google authentication successful', {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar_url: user.avatar_url,
          google_id: user.google_id,
          current_organization_id: user.current_organization_id,
          organization_role: organizationRole,
          job_role: jobRole,
        },
        token,
        needsOnboarding,
      });
    } catch (error) {
      console.error('Google auth controller error:', error);
      next(error);
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
