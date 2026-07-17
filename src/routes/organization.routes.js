const express = require('express');
const router = express.Router();
const organizationController = require('../controllers/organization.controller');
const invitationController = require('../controllers/invitation.controller');
const jobRolesController = require('../controllers/job-roles.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkInvitationLimit, checkOrganizationLimit } = require('../middleware/plan-limits.middleware');

// Public routes (no authentication required)
// Get organization by subdomain (for signup page to detect organization)
router.get('/subdomain/:subdomain', organizationController.getBySubdomain);

// Check subdomain availability (for onboarding page)
router.get('/subdomain/:subdomain/availability', organizationController.checkSubdomainAvailability);

// All routes below require authentication
router.use(authenticate);

// Get current user's organization
router.get('/me', organizationController.getMyOrganization);

// Get all organizations user belongs to
router.get('/me/all', organizationController.getMyOrganizations);

// Create new organization (with limit check)
router.post('/', checkOrganizationLimit, organizationController.createOrganization);

// Update organization (owners only)
router.put('/:organizationId', organizationController.updateOrganization);

// Get organization members
router.get('/:organizationId/members', organizationController.getMembers);

// Invite user to organization
router.post('/:organizationId/members/invite', checkInvitationLimit, organizationController.inviteUser);

// Update user role in organization
router.put('/:organizationId/members/:userId/role', organizationController.updateUserRole);
// Alternative route matching frontend expectation
router.put('/:organizationId/members/:userId', organizationController.updateUserRole);

// Remove user from organization
router.delete('/:organizationId/members/:userId', organizationController.removeUser);

// =====================================================
// INVITATION ROUTES (NEW - Invite-only system)
// =====================================================

// Create invitation (owner only) - with invitation limit check
router.post('/:orgId/invites', checkInvitationLimit, invitationController.createInvitation);

// List invitations for organization (owner/admin only)
router.get('/:orgId/invites', invitationController.listInvitations);

// Resend invitation (owner only)
router.post('/:orgId/invites/:inviteId/resend', invitationController.resendInvitation);

// Revoke invitation (owner only)
router.delete('/:orgId/invites/:inviteId', invitationController.revokeInvitation);

// =====================================================
// JOB ROLES ROUTES (Dynamic per-org job roles)
// =====================================================

// List all job roles for an organization (any member)
router.get('/:orgId/job-roles', jobRolesController.listJobRoles);

// Create a new custom job role (admin/owner only)
router.post('/:orgId/job-roles', jobRolesController.createJobRole);

// Update a job role's name/icon (admin/owner only; key is immutable)
router.put('/:orgId/job-roles/:roleId', jobRolesController.updateJobRole);

// Delete a job role with cleanup (admin/owner only; blocks non-deletable)
router.delete('/:orgId/job-roles/:roleId', jobRolesController.deleteJobRole);

module.exports = router;
