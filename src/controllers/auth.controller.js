const authService = require('../services/auth.service');
const ResponseUtil = require('../utils/response.util');

class AuthController {
  /**
   * Register new user
   * POST /api/auth/signup
   */
  async signup(req, res, next) {
    try {
      const { email, password, name } = req.body;

      const result = await authService.signup({ email, password, name });

      // Handle case where email confirmation is required
      if (!result.session) {
        return ResponseUtil.success(
          res,
          'User registered successfully. Please check your email to verify your account before logging in.',
          {
            user: result.user,
            emailConfirmationRequired: true
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
          emailConfirmationRequired: false
        },
        201
      );
    } catch (error) {
      console.error('Signup controller error:', error);
      
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
   * Login user
   * POST /api/auth/login
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const result = await authService.login({ email, password });

      return ResponseUtil.success(res, 'Login successful', {
        user: result.user,
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token
      });
    } catch (error) {
      console.error('Login controller error:', error);
      
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
}

module.exports = new AuthController();
