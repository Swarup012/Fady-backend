const express = require('express');
const router = express.Router({ mergeParams: true });
const aiChatController = require('../controllers/aiChat.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

/**
 * AI Chat Conversation Routes
 * ===========================
 * Mounted at: /api/organizations/:orgId/ai-chat
 * (mergeParams: true so :orgId from the parent router is accessible)
 *
 * All routes: authenticate → authorize(['admin','owner']) → controller
 * (org scope is validated inside each controller handler via assertOrgScope)
 */

router.use(authenticate, authorize(['admin', 'owner']));

// Conversations
router.get('/conversations',          aiChatController.listConversations);
router.post('/conversations',         aiChatController.createConversation);
router.delete('/conversations/:id',   aiChatController.deleteConversation);

// Messages inside a conversation
router.get('/conversations/:id/messages',  aiChatController.getMessages);
router.post('/conversations/:id/messages', aiChatController.sendMessage);

module.exports = router;
