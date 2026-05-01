const userService = require('../services/user.service');
const responseUtil = require('../utils/response.util');
const cache = require('../services/redis.service');

const userController = {
  /**
   * Get current user profile
   */
  async getCurrentUser(req, res, next) {
    try {
      const userId = req.user.id;
      const user = await userService.getUserById(userId);
      
      return responseUtil.success(res, 'User retrieved successfully', { user });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Switch to a different organization
   */
  async switchOrganization(req, res, next) {
    try {
      const userId = req.user.id;
      const { organizationId } = req.body;

      if (!organizationId) {
        return responseUtil.error(res, 'Organization ID is required', 400);
      }

      const result = await userService.switchOrganization(userId, organizationId);

      // Invalidate cached session so next request gets fresh org data
      await cache.invalidateUserSessions(userId);

      return responseUtil.success(res, 'Switched organization successfully', result);
    } catch (error) {
      if (error.message.includes('not a member')) {
        return responseUtil.error(res, error.message, 403);
      }
      next(error);
    }
  },

  /**
   * Save onboarding progress
   */
  async saveOnboardingProgress(req, res, next) {
    try {
      const userId = req.user.id;
      const { step, data } = req.body;

      const result = await userService.saveOnboardingProgress(userId, step, data);
      return responseUtil.success(res, 'Onboarding progress saved', result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Complete onboarding
   */
  async completeOnboarding(req, res, next) {
    try {
      const userId = req.user.id;
      const onboardingData = req.body;

      console.log('📝 Onboarding completion request:', {
        userId,
        companyName: onboardingData.companyName,
        subdomain: onboardingData.subdomain,
        hasFirstBoard: !!onboardingData.firstBoard
      });

      const result = await userService.completeOnboarding(userId, onboardingData);

      // Invalidate cached session so next request gets fresh org data
      await cache.invalidateUserSessions(userId);

      return responseUtil.success(res, 'Onboarding completed successfully', result);
    } catch (error) {
      console.error('❌ Onboarding completion error:', error);
      next(error);
    }
  },
};

module.exports = userController;
