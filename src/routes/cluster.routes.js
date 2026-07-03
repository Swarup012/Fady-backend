const express = require('express');
const router = express.Router();
const clusterController = require('../controllers/cluster.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { injectOrganization } = require('../middleware/organization.middleware');

/**
 * Internal secret middleware — protects endpoints called only by the Next.js server.
 * These are NOT exposed to end users; they are machine-to-machine only.
 */
function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_API_SECRET;
  const provided = req.headers['x-internal-secret'];

  // If no secret is configured (local dev without .env), allow through with a warning
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ success: false, error: 'Internal secret not configured' });
    }
    console.warn('⚠️  INTERNAL_API_SECRET not set — allowing internal request in dev mode');
    return next();
  }

  if (provided !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized internal request' });
  }

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC (admin-authenticated) routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/clusters/boards/:boardId
 * Returns all clusters for a board with labels, post counts, and AI metadata.
 * Used by the admin dashboard cluster insights panel.
 */
router.get(
  '/boards/:boardId',
  authenticate,
  injectOrganization,
  authorize(['admin', 'owner']),
  clusterController.getBoardClusters
);

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL routes (called by Next.js server only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PATCH /api/clusters/assign-post
 * Persists cluster_key to a post after AI resolution.
 */
router.patch(
  '/assign-post',
  requireInternalSecret,
  clusterController.assignPostClusterKey
);

/**
 * POST /api/clusters/check-debounce
 * Redis debounce check for label refresh.
 * Returns 204 if already queued, 200 if caller should proceed.
 */
router.post(
  '/check-debounce',
  requireInternalSecret,
  clusterController.checkDebounce
);

/**
 * GET /api/clusters/sample-posts
 * Returns sample posts for a cluster (feeds AI label generation).
 */
router.get(
  '/sample-posts',
  requireInternalSecret,
  clusterController.getSamplePosts
);

/**
 * POST /api/clusters/upsert-label
 * Stores AI label + summary in cluster_labels table.
 */
router.post(
  '/upsert-label',
  requireInternalSecret,
  clusterController.upsertClusterLabel
);

module.exports = router;
