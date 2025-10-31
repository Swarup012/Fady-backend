const { supabase, supabaseAdmin } = require('../config/supabase.config');
const config = require('../config/env.config');

class AuthService {
  /**
   * Register a new user - SIMPLIFIED APPROACH
   */
  async signup({ email, password, name }) {
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

      // Step 3: CREATE PROFILE DIRECTLY using admin client
      // No foreign key constraint - just insert the UUID
      console.log('📊 Creating user profile...');
      
      const profileData = {
        id: authUserId,
        email: email,
        name: name,
        role: 'admin',
        avatar_url: null,
        created_at: new Date().toISOString()
      };
      
      console.log('🔍 Attempting insert with data:', { 
        id: authUserId, 
        email, 
        name, 
        role: 'user' 
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

      // Return response
      return {
        user: profile,
        session: authData.session, // Will be null if email confirmation is required
        emailConfirmationRequired: !authData.session
      };

    } catch (error) {
      console.error('❌ Signup failed:', error.message);
      throw error;
    }
  }

  /**
   * Login user
   */
  async login({ email, password }) {
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
        .select('id, email, name, role, avatar_url, created_at')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error('❌ Profile fetch error:', profileError);
        throw new Error('User profile not found');
      }

      console.log('✅ Login successful:', profile.email);

      return {
        user: profile,
        session: data.session
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
   * Get current user
   */
  async getCurrentUser(userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id, email, name, role, avatar_url, created_at')
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
        .select('id, email, name, role, avatar_url, updated_at')
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
