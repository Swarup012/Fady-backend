/**
 * Invitation Controller
 * Handles HTTP requests for organization invitations
 */

const invitationService = require('../services/invitation.service');
const emailService = require('../services/email.service');

class InvitationController {
  /**
   * Create a new invitation
   * POST /api/organizations/:orgId/invites
   */
  async createInvitation(req, res) {
    try {
      const { orgId } = req.params;
      const { email, role, jobRole } = req.body;
      const inviterId = req.user.id;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // Create invitation
      const invitation = await invitationService.createInvitation(
        orgId,
        email,
        inviterId,
        role || 'member',
        jobRole || 'other'
      );

      // Send invitation email
      try {
        await emailService.sendInvitationEmail(
          invitation.email,
          invitation.token,
          invitation.organization,
          invitation.inviter.name || invitation.inviter.email,
          invitation.role
        );
      } catch (emailError) {
        console.error('Failed to send invitation email:', emailError);
        // Don't fail the request if email fails, just log it
      }

      res.status(201).json({
        message: 'Invitation created and sent successfully',
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expires_at: invitation.expires_at,
          created_at: invitation.created_at,
        },
      });
    } catch (error) {
      console.error('CreateInvitation error:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Verify an invitation token (public endpoint)
   * GET /api/invitations/verify/:token
   */
  async verifyToken(req, res) {
    try {
      const { token } = req.params;

      const invitation = await invitationService.verifyToken(token);

      res.json({
        valid: true,
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expires_at: invitation.expires_at,
          organization: invitation.organization,
          inviter: {
            name: invitation.inviter.name || invitation.inviter.email,
          },
        },
      });
    } catch (error) {
      console.error('VerifyToken error:', error);
      res.status(400).json({ 
        valid: false,
        error: error.message 
      });
    }
  }

  /**
   * Accept an invitation
   * POST /api/invitations/accept/:token
   */
  async acceptInvitation(req, res) {
    try {
      const { token } = req.params;
      const userId = req.user.id;
      const userEmail = req.user.email;

      const membership = await invitationService.acceptInvitation(
        token,
        userId,
        userEmail
      );

      res.json({
        message: 'Invitation accepted successfully',
        membership: {
          id: membership.id,
          organization_id: membership.organization_id,
          role: membership.role,
          organization: membership.organization,
        },
      });
    } catch (error) {
      console.error('AcceptInvitation error:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * List invitations for an organization
   * GET /api/organizations/:orgId/invites
   */
  async listInvitations(req, res) {
    try {
      const { orgId } = req.params;
      const { status } = req.query;

      const invitations = await invitationService.listInvitations(orgId, status);

      res.json({
        invitations: invitations.map(inv => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          status: inv.status,
          expires_at: inv.expires_at,
          created_at: inv.created_at,
          accepted_at: inv.accepted_at,
          inviter: inv.inviter ? {
            name: inv.inviter.name || inv.inviter.email,
            avatar_url: inv.inviter.avatar_url,
          } : null,
        })),
      });
    } catch (error) {
      console.error('ListInvitations error:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Revoke an invitation
   * DELETE /api/organizations/:orgId/invites/:inviteId
   */
  async revokeInvitation(req, res) {
    try {
      const { orgId, inviteId } = req.params;

      await invitationService.revokeInvitation(inviteId, orgId);

      res.json({
        message: 'Invitation revoked successfully',
      });
    } catch (error) {
      console.error('RevokeInvitation error:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Resend an invitation
   * POST /api/organizations/:orgId/invites/:inviteId/resend
   */
  async resendInvitation(req, res) {
    try {
      const { orgId, inviteId } = req.params;

      const invitation = await invitationService.resendInvitation(inviteId, orgId);

      // Send email again with new token
      try {
        await emailService.sendInvitationEmail(
          invitation.email,
          invitation.token,
          invitation.organization,
          invitation.inviter.name || invitation.inviter.email,
          invitation.role
        );
      } catch (emailError) {
        console.error('Failed to send invitation email:', emailError);
        return res.status(500).json({ 
          error: 'Invitation updated but email failed to send' 
        });
      }

      res.json({
        message: 'Invitation resent successfully',
        invitation: {
          id: invitation.id,
          email: invitation.email,
          expires_at: invitation.expires_at,
        },
      });
    } catch (error) {
      console.error('ResendInvitation error:', error);
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new InvitationController();
