const feedbackChatService = require('../services/feedbackChat.service');
const ResponseUtil = require('../utils/response.util');

/**
 * FeedbackChatController
 * ======================
 *
 * POST /api/organizations/:orgId/feedback-chat
 *
 * SECURITY ENFORCEMENT (2-layer):
 *
 * Layer 1 — Primary: Route middleware chain enforces:
 *   - `authenticate`       → validates JWT, sets `req.user.organization_id` from session
 *   - `authorize(['admin', 'owner'])` → verifies the user has the correct role
 *
 * Layer 2 — URL param sanity check (this controller):
 *   - Compares `req.params.orgId` (from the URL) with `req.user.organization_id` (from JWT).
 *   - If they don't match → 403. This prevents a tampered URL param from being used
 *     to probe whether another org's data returns differently.
 *   - The actual data fetch uses ONLY `req.user.organization_id` — never `req.params.orgId`.
 *
 * Layer 3 — Data fetch: All DB queries in FeedbackChatService are scoped with
 *   `.eq('organization_id', organizationId)` where organizationId === req.user.organization_id.
 */
class FeedbackChatController {
  /**
   * POST /api/organizations/:orgId/feedback-chat
   * Streams an AI response grounded in the user's org's feedback/cluster data.
   */
  async chat(req, res, next) {
    try {
      const { orgId } = req.params;
      const sessionOrgId = req.user?.organization_id;

      // ── Layer 2: URL param vs session org mismatch check ──────────────────
      // We verify the URL param matches the session to 403 on tampered URLs.
      // We NEVER use orgId to fetch data — sessionOrgId is the authoritative source.
      if (!sessionOrgId) {
        return ResponseUtil.error(res, 'No organization associated with this session', 403);
      }

      if (orgId !== sessionOrgId) {
        console.warn(
          `⚠️ [FeedbackChat] Org ID mismatch — URL param: ${orgId}, Session org: ${sessionOrgId} — user: ${req.user?.email}`
        );
        return ResponseUtil.error(
          res,
          'Organization ID mismatch. You can only access your own organization data.',
          403
        );
      }

      // ── Validate request body ─────────────────────────────────────────────
      const { messages } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return ResponseUtil.error(res, 'messages array is required', 400);
      }

      // Validate message structure (role + text only)
      for (const msg of messages) {
        if (!msg.role || !['user', 'model'].includes(msg.role)) {
          return ResponseUtil.error(res, 'Each message must have role "user" or "model"', 400);
        }
        if (typeof msg.text !== 'string' || msg.text.trim().length === 0) {
          return ResponseUtil.error(res, 'Each message must have a non-empty text field', 400);
        }
        // Safety: cap individual message length
        if (msg.text.length > 2000) {
          return ResponseUtil.error(res, 'Message text exceeds 2000 character limit', 400);
        }
      }

      // Cap conversation history depth to prevent token abuse
      const cappedMessages = messages.slice(-10);

      // The last message MUST be from the user
      if (cappedMessages[cappedMessages.length - 1].role !== 'user') {
        return ResponseUtil.error(res, 'The last message must be from the user', 400);
      }

      console.log(
        `🤖 [FeedbackChat] Chat request from ${req.user?.email} for org ${sessionOrgId} (${cappedMessages.length} messages)`
      );

      // ── Stream response — data fetched using sessionOrgId (not orgId param) ─
      await feedbackChatService.streamChatResponse({
        organizationId: sessionOrgId, // ← ONLY derived from verified JWT session
        messages: cappedMessages,
        res,
      });

    } catch (error) {
      console.error('❌ FeedbackChatController.chat error:', error);
      // If headers already sent (streaming started), we can't send a JSON error
      if (!res.headersSent) {
        next(error);
      }
    }
  }
}

module.exports = new FeedbackChatController();
