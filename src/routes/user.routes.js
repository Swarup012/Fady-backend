const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { getUsageStats } = require('../middleware/plan-limits.middleware');

// All user routes require authentication
router.use(authenticate);

// Get current user profile
router.get('/me', userController.getCurrentUser);

// Get usage statistics
router.get('/me/usage', getUsageStats);

// Update current organization
router.put('/me/current-organization', userController.switchOrganization);

// Onboarding routes
router.post('/onboarding/progress', userController.saveOnboardingProgress);
router.post('/onboarding/complete', userController.completeOnboarding);

module.exports = router;
