/**
 * Invitation Service
 * Handles organization invitation logic: create, verify, accept, revoke
 * Implements 7-day expiry and strict email validation
 */

const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase.config');

class InvitationService {
  /**
   * Generate a secure random token for invitation
   * @returns {string} 64-character hex token
   */
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new organization invitation
   * @param {string} organizationId - Organization UUID
   * @param {string} email - Email address to invite
   * @param {string} invitedBy - User ID of the inviter (must be owner)
   * @param {string} role - Role to assign (default: 'member')
   * @returns {Promise<object>} Created invitation
   */
  async createInvitation(organizationId, email, invitedBy, role = 'member') {
    try {
      // Validate inputs
      if (!organizationId || !email || !invitedBy) {
        throw new Error('Missing required fields: organizationId, email, invitedBy');
      }

      // Validate email format
      const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
      if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
      }

      // Validate role
      if (!['member', 'admin'].includes(role)) {
        throw new Error('Invalid role. Must be "member" or "admin"');
      }

      // Check if inviter is owner
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', invitedBy)
        .single();

      if (memberError || !membership) {
        throw new Error('Inviter is not a member of this organization');
      }

      if (membership.role !== 'owner') {
        throw new Error('Only organization owners can send invitations');
      }

      // Check if user is already a member
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

      if (existingUser) {
        const { data: existingMember } = await supabaseAdmin
          .from('organization_members')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('user_id', existingUser.id)
          .single();

        if (existingMember) {
          throw new Error('User is already a member of this organization');
        }
      }

      // Check for existing pending invitation
      const { data: existingInvite } = await supabaseAdmin
        .from('organization_invitations')
        .select('id, status, expires_at')
        .eq('organization_id', organizationId)
        .eq('email', email)
        .eq('status', 'pending')
        .gte('expires_at', new Date().toISOString())
        .single();

      if (existingInvite) {
        throw new Error('A pending invitation already exists for this email');
      }

      // Generate token and set expiry (7 days)
      const token = this.generateToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create invitation
      const { data: invitation, error } = await supabaseAdmin
        .from('organization_invitations')
        .insert({
          organization_id: organizationId,
          email: email.toLowerCase(),
          token,
          role,
          invited_by: invitedBy,
          status: 'pending',
          expires_at: expiresAt.toISOString(),
        })
        .select(`
          *,
          organization:organizations!organization_id(id, name, slug),
          inviter:users!invited_by(id, name, email)
        `)
        .single();

      if (error) {
        console.error('Error creating invitation:', error);
        throw new Error(`Failed to create invitation: ${error.message}`);
      }

      console.log(`✅ Invitation created for ${email} to join ${invitation.organization.name}`);
      return invitation;
    } catch (error) {
      console.error('InvitationService.createInvitation error:', error);
      throw error;
    }
  }

  /**
   * Verify an invitation token
   * @param {string} token - Invitation token
   * @returns {Promise<object>} Invitation details if valid
   */
  async verifyToken(token) {
    try {
      if (!token) {
        throw new Error('Token is required');
      }

      // First, expire old invitations
      await this.expireOldInvitations();

      // Fetch invitation with organization details
      const { data: invitation, error } = await supabaseAdmin
        .from('organization_invitations')
        .select(`
          *,
          organization:organizations!organization_id(id, name, slug, logo_url),
          inviter:users!invited_by(id, name, email)
        `)
        .eq('token', token)
        .single();

      if (error || !invitation) {
        throw new Error('Invalid or expired invitation token');
      }

      // Check if already accepted
      if (invitation.status === 'accepted') {
        throw new Error('This invitation has already been accepted');
      }

      // Check if revoked
      if (invitation.status === 'revoked') {
        throw new Error('This invitation has been revoked');
      }

      // Check if expired
      if (invitation.status === 'expired' || new Date(invitation.expires_at) < new Date()) {
        await supabaseAdmin
          .from('organization_invitations')
          .update({ status: 'expired' })
          .eq('id', invitation.id);

        throw new Error('This invitation has expired');
      }

      return invitation;
    } catch (error) {
      console.error('InvitationService.verifyToken error:', error);
      throw error;
    }
  }

  /**
   * Accept an invitation
   * @param {string} token - Invitation token
   * @param {string} userId - User ID accepting the invitation
   * @param {string} userEmail - Email of the user accepting
   * @returns {Promise<object>} Created membership
   */
  async acceptInvitation(token, userId, userEmail) {
    try {
      if (!token || !userId || !userEmail) {
        throw new Error('Missing required fields: token, userId, userEmail');
      }

      // Verify the invitation
      const invitation = await this.verifyToken(token);

      // Strict email validation - must match exactly
      if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw new Error('This invitation was sent to a different email address. Please log in with the invited email.');
      }

      // Check if user is already a member
      const { data: existingMember } = await supabaseAdmin
        .from('organization_members')
        .select('id')
        .eq('organization_id', invitation.organization_id)
        .eq('user_id', userId)
        .single();

      if (existingMember) {
        // Mark invitation as accepted anyway
        await supabaseAdmin
          .from('organization_invitations')
          .update({ 
            status: 'accepted',
            accepted_at: new Date().toISOString()
          })
          .eq('id', invitation.id);

        throw new Error('You are already a member of this organization');
      }

      // Create organization membership
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .insert({
          organization_id: invitation.organization_id,
          user_id: userId,
          role: invitation.role,
          job_role: 'marketer', // Default job role for invited members (lowercase to match DB constraint)
          invited_by: invitation.invited_by,
          joined_via: 'invite',
        })
        .select(`
          *,
          organization:organizations!organization_id(id, name, slug),
          user:users!user_id(id, name, email)
        `)
        .single();

      if (memberError) {
        console.error('Error creating membership:', memberError);
        throw new Error(`Failed to accept invitation: ${memberError.message}`);
      }

      // Mark invitation as accepted
      await supabaseAdmin
        .from('organization_invitations')
        .update({ 
          status: 'accepted',
          accepted_at: new Date().toISOString()
        })
        .eq('id', invitation.id);

      console.log(`✅ User ${userEmail} accepted invitation to ${invitation.organization.name}`);
      return membership;
    } catch (error) {
      console.error('InvitationService.acceptInvitation error:', error);
      throw error;
    }
  }

  /**
   * List all invitations for an organization
   * @param {string} organizationId - Organization UUID
   * @param {string} status - Filter by status (optional)
   * @returns {Promise<array>} List of invitations
   */
  async listInvitations(organizationId, status = null) {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      // Expire old invitations first
      await this.expireOldInvitations();

      let query = supabaseAdmin
        .from('organization_invitations')
        .select(`
          *,
          inviter:users!invited_by(id, name, email, avatar_url)
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data: invitations, error } = await query;

      if (error) {
        console.error('Error listing invitations:', error);
        throw new Error(`Failed to list invitations: ${error.message}`);
      }

      return invitations || [];
    } catch (error) {
      console.error('InvitationService.listInvitations error:', error);
      throw error;
    }
  }

  /**
   * Revoke an invitation
   * @param {string} invitationId - Invitation UUID
   * @param {string} organizationId - Organization UUID (for verification)
   * @returns {Promise<object>} Updated invitation
   */
  async revokeInvitation(invitationId, organizationId) {
    try {
      if (!invitationId || !organizationId) {
        throw new Error('Missing required fields: invitationId, organizationId');
      }

      // Verify invitation belongs to organization
      const { data: invitation, error: fetchError } = await supabaseAdmin
        .from('organization_invitations')
        .select('id, status, organization_id')
        .eq('id', invitationId)
        .eq('organization_id', organizationId)
        .single();

      if (fetchError || !invitation) {
        throw new Error('Invitation not found');
      }

      if (invitation.status !== 'pending') {
        throw new Error(`Cannot revoke invitation with status: ${invitation.status}`);
      }

      // Update status to revoked
      const { data: updated, error } = await supabaseAdmin
        .from('organization_invitations')
        .update({ status: 'revoked' })
        .eq('id', invitationId)
        .select()
        .single();

      if (error) {
        console.error('Error revoking invitation:', error);
        throw new Error(`Failed to revoke invitation: ${error.message}`);
      }

      console.log(`✅ Invitation ${invitationId} revoked`);
      return updated;
    } catch (error) {
      console.error('InvitationService.revokeInvitation error:', error);
      throw error;
    }
  }

  /**
   * Resend an invitation (creates new token with fresh expiry)
   * @param {string} invitationId - Invitation UUID
   * @param {string} organizationId - Organization UUID (for verification)
   * @returns {Promise<object>} Updated invitation
   */
  async resendInvitation(invitationId, organizationId) {
    try {
      if (!invitationId || !organizationId) {
        throw new Error('Missing required fields: invitationId, organizationId');
      }

      // Fetch existing invitation
      const { data: invitation, error: fetchError } = await supabaseAdmin
        .from('organization_invitations')
        .select(`
          *,
          organization:organizations!organization_id(id, name, slug),
          inviter:users!invited_by(id, name, email)
        `)
        .eq('id', invitationId)
        .eq('organization_id', organizationId)
        .single();

      if (fetchError || !invitation) {
        throw new Error('Invitation not found');
      }

      if (invitation.status === 'accepted') {
        throw new Error('Cannot resend an accepted invitation');
      }

      // Generate new token and extend expiry
      const newToken = this.generateToken();
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);

      // Update invitation
      const { data: updated, error } = await supabaseAdmin
        .from('organization_invitations')
        .update({
          token: newToken,
          status: 'pending',
          expires_at: newExpiresAt.toISOString(),
        })
        .eq('id', invitationId)
        .select(`
          *,
          organization:organizations!organization_id(id, name, slug),
          inviter:users!invited_by(id, name, email)
        `)
        .single();

      if (error) {
        console.error('Error resending invitation:', error);
        throw new Error(`Failed to resend invitation: ${error.message}`);
      }

      console.log(`✅ Invitation resent to ${updated.email}`);
      return updated;
    } catch (error) {
      console.error('InvitationService.resendInvitation error:', error);
      throw error;
    }
  }

  /**
   * Expire old invitations (run periodically or before checks)
   * @returns {Promise<number>} Number of invitations expired
   */
  async expireOldInvitations() {
    try {
      const { data, error } = await supabaseAdmin
        .from('organization_invitations')
        .update({ status: 'expired' })
        .eq('status', 'pending')
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) {
        console.error('Error expiring invitations:', error);
        return 0;
      }

      if (data && data.length > 0) {
        console.log(`⏰ Expired ${data.length} old invitation(s)`);
      }

      return data ? data.length : 0;
    } catch (error) {
      console.error('InvitationService.expireOldInvitations error:', error);
      return 0;
    }
  }

  /**
   * Delete an invitation permanently (cleanup)
   * @param {string} invitationId - Invitation UUID
   * @returns {Promise<boolean>} Success status
   */
  async deleteInvitation(invitationId) {
    try {
      const { error } = await supabaseAdmin
        .from('organization_invitations')
        .delete()
        .eq('id', invitationId);

      if (error) {
        console.error('Error deleting invitation:', error);
        throw new Error(`Failed to delete invitation: ${error.message}`);
      }

      console.log(`🗑️ Invitation ${invitationId} deleted`);
      return true;
    } catch (error) {
      console.error('InvitationService.deleteInvitation error:', error);
      throw error;
    }
  }
}

module.exports = new InvitationService();
