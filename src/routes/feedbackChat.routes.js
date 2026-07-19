const express = require('express');
const router = express.Router({ mergeParams: true });
const feedbackChatController = require('../controllers/feedbackChat.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { createRateLimiter } = require('../middleware/rate-limit.middleware');

/**
 * POST /api/organizations/:orgId/feedback-chat
 *
 * Middleware chain (order matters):
 *  1. authenticate          → verify JWT, set req.user (including req.user.organization_id)
 *  2. authorize(['admin', 'owner']) → ensure the user has an elevated role
 *  3. rateLimitAiChat       → org-scoped Redis rate limit (20 req / hour)
 *  4. feedbackChatController.chat → org param validation + streaming AI response
 */

// 20 AI chat calls per hour per org member — prevents expensive AI spam
const rateLimitAiChat = createRateLimiter('ai_feedback_chat', 20, 3600, 'user');

router.post(
  '/',
  authenticate,
  authorize(['admin', 'owner']),
  rateLimitAiChat,
  feedbackChatController.chat.bind(feedbackChatController)
);

module.exports = router;
