const organizationService = require('../services/organization.service');
const responseUtil = require('../utils/response.util');

const organizationController = {
  /**
   * Get current user's organization
   */
  async getMyOrganization(req, res) {
    try {
      const userId = req.user.id;
      const data = await organizationService.getUserOrganization(userId);
      
      if (!data || !data.organizations) {
        return responseUtil.success(res, 'No organization found', { organization: null }, 200);
      }

      return responseUtil.success(res, 'Organization retrieved successfully', {
        organization: data.organizations,
        role: data.organization_role,
      }, 200);
    } catch (error) {
      console.error('❌ Get my organization error:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Get all organizations user belongs to
   */
  async getMyOrganizations(req, res) {
    try {
      const userId = req.user.id;
      const organizations = await organizationService.getUserOrganizations(userId);
      
      return responseUtil.success(res, 'Organizations retrieved successfully', {
        organizations,
        count: organizations.length,
      }, 200);
    } catch (error) {
      console.error('❌ Get my organizations error:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Create new organization
   */
  async createOrganization(req, res) {
    try {
      const userId = req.user.id;
      const { name, subdomain, description, industry, company_size, website } = req.body;

      if (!name) {
        return responseUtil.error(res, 'Organization name is required', 400);
      }

      const organization = await organizationService.createOrganizationForUser(
        userId,
        { name, subdomain, description, industry, company_size, website }
      );
      
      return responseUtil.success(res, 'Organization created successfully', {
        organization,
      }, 201);
    } catch (error) {
      console.error('❌ Create organization error:', error);
      if (error.message.includes('already taken') || error.message.includes('Invalid subdomain')) {
        return responseUtil.error(res, error.message, 400);
      }
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Get organization by subdomain
   */
  async getBySubdomain(req, res) {
    try {
      const { subdomain } = req.params;
      const organization = await organizationService.getOrganizationBySubdomain(subdomain);
      
      if (!organization) {
        return responseUtil.error(res, 'Organization not found', 404);
      }

      // Return only public info
      return responseUtil.success(res, 'Organization found', {
        organization: {
          id: organization.id,
          name: organization.name,
          subdomain: organization.subdomain,
          logo_url: organization.logo_url,
        },
      }, 200);
    } catch (error) {
      console.error('❌ Get by subdomain error:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Check subdomain availability
   */
  async checkSubdomainAvailability(req, res) {
    try {
      const { subdomain } = req.params;
      
      // Validate format
      const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
      if (!subdomainRegex.test(subdomain)) {
        return responseUtil.error(res, 'Invalid subdomain format. Use lowercase letters, numbers, and hyphens only.', 400);
      }

      if (subdomain.length < 3 || subdomain.length > 63) {
        return responseUtil.error(res, 'Subdomain must be between 3 and 63 characters.', 400);
      }

      const result = await organizationService.checkSubdomainAvailability(subdomain);
      return responseUtil.success(res, 'Subdomain availability checked', result, 200);
    } catch (error) {
      console.error('❌ Check subdomain availability error:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Update organization
   */
  async updateOrganization(req, res) {
    try {
      const { organizationId } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      const organization = await organizationService.updateOrganization(organizationId, updates, userId);
      return responseUtil.success(res, 'Organization updated successfully', { organization }, 200);
    } catch (error) {
      console.error('❌ Update organization error:', error);
      if (error.message.includes('Unauthorized')) {
        return responseUtil.error(res, error.message, 403);
      }
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Get organization members
   */
  async getMembers(req, res) {
    try {
      const { organizationId } = req.params;
      const userId = req.user.id;

      const members = await organizationService.getOrganizationMembers(organizationId, userId);
      return responseUtil.success(res, 'Members retrieved successfully', { members, count: members.length }, 200);
    } catch (error) {
      console.error('❌ Get members error:', error);
      if (error.message.includes('Unauthorized')) {
        return responseUtil.error(res, error.message, 403);
      }
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Invite user to organization
   */
  async inviteUser(req, res) {
    try {
      const { organizationId } = req.params;
      const { email, role } = req.body;
      const invitedBy = req.user.id;

      if (!email || !role) {
        return responseUtil.error(res, 'Email and role are required', 400);
      }

      const result = await organizationService.inviteUser(organizationId, email, role, invitedBy);
      return responseUtil.success(res, 'Invitation sent successfully', result, 200);
    } catch (error) {
      console.error('❌ Invite user error:', error);
      if (error.message.includes('Unauthorized')) {
        return responseUtil.error(res, error.message, 403);
      }
      if (error.message.includes('limit reached')) {
        return responseUtil.error(res, error.message, 402); // Payment Required
      }
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Update user role
   */
  async updateUserRole(req, res) {
    try {
      const { organizationId, userId: targetUserId } = req.params;
      const { role } = req.body;
      const updatedBy = req.user.id;

      if (!role || !['owner', 'admin', 'member'].includes(role)) {
        return responseUtil.error(res, 'Invalid role. Must be owner, admin, or member', 400);
      }

      const user = await organizationService.updateUserRole(organizationId, targetUserId, role, updatedBy);
      return responseUtil.success(res, 'User role updated successfully', { user }, 200);
    } catch (error) {
      console.error('❌ Update user role error:', error);
      if (error.message.includes('Unauthorized')) {
        return responseUtil.error(res, error.message, 403);
      }
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * Remove user from organization
   */
  async removeUser(req, res) {
    try {
      const { organizationId, userId: targetUserId } = req.params;
      const removedBy = req.user.id;

      await organizationService.removeUser(organizationId, targetUserId, removedBy);
      return responseUtil.success(res, 'User removed from organization successfully', {}, 200);
    } catch (error) {
      console.error('❌ Remove user error:', error);
      if (error.message.includes('Unauthorized')) {
        return responseUtil.error(res, error.message, 403);
      }
      return responseUtil.error(res, error.message, 500);
    }
  },
};

module.exports = organizationController;
