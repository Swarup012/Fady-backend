const conversationService = require('../services/aiChatConversation.service');
const ResponseUtil = require('../utils/response.util');

/**
 * AiChatController
 * ================
 * Handles conversation + message CRUD for the AI Chat feature.
 *
 * SECURITY (2-layer — identical pattern to feedbackChat.controller.js):
 *
 * Layer 1: Route middleware — authenticate + authorize(['admin','owner'])
 *   → req.user.organization_id is set from the verified JWT.
 *
 * Layer 2: Every handler calls assertOrgScope() which compares
 *   req.params.orgId (URL) against req.user.organization_id (JWT session).
 *   → 403 on any mismatch. Data fetches use ONLY the session org ID.
 */

/**
 * Asserts the URL :orgId matches the session org. Returns 403 if not.
 * Always returns the session org ID so callers use it exclusively.
 */
function assertOrgScope(req, res) {
  const sessionOrgId = req.user?.organization_id;
  const urlOrgId = req.params.orgId;

  if (!sessionOrgId) {
    ResponseUtil.error(res, 'No organization associated with this session.', 403);
    return null;
  }

  if (urlOrgId !== sessionOrgId) {
    console.warn(
      `⚠️ [AiChat] Org mismatch — URL: ${urlOrgId}, Session: ${sessionOrgId}, user: ${req.user?.email}`
    );
    ResponseUtil.error(res, 'Organization ID mismatch. You can only access your own org data.', 403);
    return null;
  }

  return sessionOrgId;
}

const aiChatController = {

  // ─── GET /api/organizations/:orgId/ai-chat/conversations ────────────────
  async listConversations(req, res) {
    try {
      const orgId = assertOrgScope(req, res);
      if (!orgId) return;

      const conversations = await conversationService.listConversations(orgId, req.user.id);
      return ResponseUtil.success(res, 'Conversations retrieved', { conversations }, 200);
    } catch (err) {
      console.error('❌ listConversations error:', err);
      return ResponseUtil.error(res, err.message, 500);
    }
  },

  // ─── POST /api/organizations/:orgId/ai-chat/conversations ───────────────
  async createConversation(req, res) {
    try {
      const orgId = assertOrgScope(req, res);
      if (!orgId) return;

      const { firstMessage } = req.body;
      if (!firstMessage || typeof firstMessage !== 'string' || !firstMessage.trim()) {
        return ResponseUtil.error(res, 'firstMessage is required to create a conversation.', 400);
      }

      const conversation = await conversationService.createConversation(
        orgId,
        req.user.id,
        firstMessage.trim()
      );

      return ResponseUtil.success(res, 'Conversation created', { conversation }, 201);
    } catch (err) {
      console.error('❌ createConversation error:', err);
      return ResponseUtil.error(res, err.message, 500);
    }
  },

  // ─── DELETE /api/organizations/:orgId/ai-chat/conversations/:id ─────────
  async deleteConversation(req, res) {
    try {
      const orgId = assertOrgScope(req, res);
      if (!orgId) return;

      const { id } = req.params;
      await conversationService.deleteConversation(id, orgId, req.user.id);
      return ResponseUtil.success(res, 'Conversation deleted', {}, 200);
    } catch (err) {
      console.error('❌ deleteConversation error:', err);
      return ResponseUtil.error(res, err.message, 500);
    }
  },

  // ─── GET /api/organizations/:orgId/ai-chat/conversations/:id/messages ───
  async getMessages(req, res) {
    try {
      const orgId = assertOrgScope(req, res);
      if (!orgId) return;

      const { id } = req.params;
      const messages = await conversationService.getMessages(id, orgId, req.user.id);
      return ResponseUtil.success(res, 'Messages retrieved', { messages }, 200);
    } catch (err) {
      console.error('❌ getMessages error:', err);
      return ResponseUtil.error(res, err.message, 500);
    }
  },

  // ─── POST /api/organizations/:orgId/ai-chat/conversations/:id/messages ──
  /**
   * Persists a completed exchange (user message + AI reply) to the DB.
   * The frontend streams via the SSE /feedback-chat endpoint for real-time
   * display, then calls this endpoint once streaming is done to save both turns.
   * This avoids calling the AI twice (stream once, save once).
   */
  async sendMessage(req, res) {
    try {
      const orgId = assertOrgScope(req, res);
      if (!orgId) return;

      const { id: conversationId } = req.params;
      const { userText, assistantText } = req.body;

      if (!userText || typeof userText !== 'string' || !userText.trim()) {
        return ResponseUtil.error(res, 'userText is required.', 400);
      }
      if (!assistantText || typeof assistantText !== 'string' || !assistantText.trim()) {
        return ResponseUtil.error(res, 'assistantText is required.', 400);
      }
      if (userText.length > 2000) {
        return ResponseUtil.error(res, 'userText exceeds 2000 character limit.', 400);
      }

      // Persist both turns atomically + bump conversation updated_at
      const { userMessage, assistantMessage } = await conversationService.saveExchange(
        conversationId,
        userText.trim(),
        assistantText.trim(),
        orgId,
        req.user.id
      );

      return ResponseUtil.success(res, 'Messages saved', { userMessage, assistantMessage }, 201);
    } catch (err) {
      console.error('❌ sendMessage error:', err);
      return ResponseUtil.error(res, err.message, 500);
    }
  },
};

module.exports = aiChatController;
