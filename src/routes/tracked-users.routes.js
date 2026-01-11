// src/routes/tracked-users.routes.js

/**
 * =====================================================
 * TRACKED USERS API ROUTES
 * =====================================================
 * Endpoints for viewing and managing tracked users
 * =====================================================
 */

const express = require('express');
const router = express.Router();
const trackedUsersController = require('../controllers/tracked-users.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { injectOrganization } = require('../middleware/organization.middleware');

// =====================================================
// ALL ROUTES REQUIRE AUTHENTICATION
// =====================================================

// Get current tracked user count and usage stats
router.get(
  '/count',
  authenticate,
  injectOrganization,
  trackedUsersController.getCount
);

// Get usage stats (detailed dashboard metrics)
router.get(
  '/usage',
  authenticate,
  injectOrganization,
  trackedUsersController.getUsageStats
);

// Get tracked users list (paginated)
router.get(
  '/list',
  authenticate,
  injectOrganization,
  trackedUsersController.getList
);

// Get historical data (past months)
router.get(
  '/history',
  authenticate,
  injectOrganization,
  trackedUsersController.getHistory
);

// Export tracked users as CSV
router.get(
  '/export',
  authenticate,
  injectOrganization,
  trackedUsersController.exportCSV
);

// Recalculate cache (admin only)
router.post(
  '/recalculate',
  authenticate,
  injectOrganization,
  trackedUsersController.recalculateCache
);

module.exports = router;
