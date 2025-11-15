// src/routes/roadmap.routes.js
const express = require('express');
const roadmapController = require('../controllers/roadmap.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

// Get public roadmap items for a board
router.get(
  '/public/boards/:boardSlug/roadmap',
  roadmapController.getPublicRoadmapItems
);

// Get single public roadmap item
router.get(
  '/public/roadmap/:itemId',
  roadmapController.getPublicRoadmapItemById
);

// ============================================
// AUTHENTICATED ROUTES (Login required)
// ============================================

// Get roadmap statistics (MUST BE BEFORE /boards/:boardSlug/roadmap)
router.get(
  '/boards/:boardSlug/roadmap/stats',
  roadmapController.getRoadmapStats
);

// Get roadmap items (can see private items if authorized)
router.get(
  '/boards/:boardSlug/roadmap',
  roadmapController.getRoadmapItems
);

// Get single roadmap item
router.get(
  '/roadmap/:itemId',
  roadmapController.getRoadmapItemById
);

// Vote on roadmap item (toggle vote like upvote)
router.post(
  '/roadmap/:itemId/vote',
  authenticate,
  roadmapController.voteRoadmapItem
);

// Check if user has voted
router.get(
  '/roadmap/:itemId/voted',
  authenticate,
  roadmapController.checkUserVote
);

// Get comments for roadmap item
router.get(
  '/roadmap/:itemId/comments',
  roadmapController.getComments
);

// Add comment to roadmap item
router.post(
  '/roadmap/:itemId/comments',
  authenticate,
  roadmapController.addComment
);

// Update comment
router.put(
  '/roadmap/comments/:commentId',
  authenticate,
  roadmapController.updateComment
);

// Delete comment
router.delete(
  '/roadmap/:itemId/comments/:commentId',
  authenticate,
  roadmapController.deleteComment
);

// ============================================
// ADMIN & OWNER ROUTES
// ============================================

// Create roadmap item (Admin & Owner)
router.post(
  '/boards/:boardSlug/roadmap',
  authenticate,
  authorize(['admin', 'owner']),
  roadmapController.createRoadmapItem
);

// Update roadmap item (Admin & Owner)
router.put(
  '/roadmap/:itemId',
  authenticate,
  authorize(['admin', 'owner']),
  roadmapController.updateRoadmapItem
);

// Delete roadmap item (Admin & Owner)
router.delete(
  '/roadmap/:itemId',
  authenticate,
  authorize(['admin', 'owner']),
  roadmapController.deleteRoadmapItem
);

// Add update to roadmap item (Admin & Owner)
router.post(
  '/roadmap/:itemId/updates',
  authenticate,
  authorize(['admin', 'owner']),
  roadmapController.addUpdate
);

// Link feedback to roadmap item (Admin & Owner)
router.post(
  '/roadmap/:itemId/link-feedback',
  authenticate,
  authorize(['admin', 'owner']),
  roadmapController.linkFeedback
);

// Unlink feedback from roadmap item (Admin & Owner)
router.delete(
  '/roadmap/:itemId/link-feedback/:feedbackId',
  authenticate,
  authorize(['admin', 'owner']),
  roadmapController.unlinkFeedback
);

// Reorder roadmap items (Admin & Owner)
router.put(
  '/boards/:boardSlug/roadmap/reorder',
  authenticate,
  authorize(['admin', 'owner']),
  roadmapController.reorderItems
);

module.exports = router;
