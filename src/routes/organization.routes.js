const express = require('express');
const router = express.Router();
const organizationController = require('../controllers/organization.controller');
const { authenticate } = require('../middleware/auth.middleware');

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

// Create new organization
router.post('/', organizationController.createOrganization);

// Update organization (owners only)
router.put('/:organizationId', organizationController.updateOrganization);

// Get organization members
router.get('/:organizationId/members', organizationController.getMembers);

// Invite user to organization
router.post('/:organizationId/members/invite', organizationController.inviteUser);

// Update user role in organization
router.put('/:organizationId/members/:userId/role', organizationController.updateUserRole);
// Alternative route matching frontend expectation
router.put('/:organizationId/members/:userId', organizationController.updateUserRole);

// Remove user from organization
router.delete('/:organizationId/members/:userId', organizationController.removeUser);

module.exports = router;
