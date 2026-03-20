// src/controllers/webhook.controller.js
// Phase 1: Webhook CRUD + delivery logs + test + retry

const webhookService = require('../services/webhook.service');
const webhookDeliveryService = require('../services/webhook-delivery.service');
const ResponseUtil = require('../utils/response.util');
const { supabaseAdmin } = require('../config/supabase.config');

class WebhookController {

  // ─────────────────────────────────────────────────────────────
  // Webhook CRUD
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/webhooks
   * List all webhooks for the authenticated user's organization.
   */
  async listWebhooks(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      if (!organizationId) {
        return ResponseUtil.error(res, 'No organization found. Please complete onboarding.', 400);
      }

      const webhooks = await webhookService.listWebhooks(organizationId);

      return ResponseUtil.success(res, 'Webhooks retrieved successfully', {
        webhooks,
        count: webhooks.length,
      });
    } catch (err) {
      console.error('listWebhooks error:', err);
      next(err);
    }
  }

  /**
   * GET /api/webhooks/events
   * Return all supported event types (for the UI event picker).
   */
  async listEventTypes(req, res, next) {
    try {
      const events = webhookService.getSupportedEvents();
      return ResponseUtil.success(res, 'Event types retrieved successfully', { events });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/webhooks/:id
   * Get a single webhook by ID (scoped to org). Does NOT expose secret_key.
   */
  async getWebhook(req, res, next) {
    try {
      const { id } = req.params;
      const organizationId = req.user.organization_id;

      const webhook = await webhookService.getWebhook(id, organizationId);

      // Never send secret_key to the client except when regenerating
      const { secret_key, ...safeWebhook } = webhook;

      return ResponseUtil.success(res, 'Webhook retrieved successfully', { webhook: safeWebhook });
    } catch (err) {
      if (err.message === 'Webhook not found') {
        return ResponseUtil.error(res, 'Webhook not found', 404);
      }
      console.error('getWebhook error:', err);
      next(err);
    }
  }

  /**
   * POST /api/webhooks
   * Create a new webhook.
   * Body: { name, url, type, events, board_ids?, description? }
   */
  async createWebhook(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      if (!organizationId) {
        return ResponseUtil.error(res, 'No organization found. Please complete onboarding.', 400);
      }

      const { name, url, type, events, board_ids, description } = req.body;

      if (!name || !url || !events) {
        return ResponseUtil.error(res, 'name, url, and events are required', 400);
      }

      const webhook = await webhookService.createWebhook({
        organizationId,
        name,
        url,
        type: type || 'custom',
        events,
        board_ids: board_ids || null,
        description: description || null,
        createdBy: req.user.id,
      });

      // Don't expose secret_key in list response, but DO expose it on creation (one time)
      console.log(`✅ Webhook created: ${webhook.name} (${webhook.type}) for org ${organizationId}`);

      return ResponseUtil.success(res, 'Webhook created successfully. Save your secret key — it will not be shown again.', { webhook }, 201);
    } catch (err) {
      if (
        err.message.includes('Invalid URL') ||
        err.message.includes('HTTPS') ||
        err.message.includes('private/internal') ||
        err.message.includes('event type') ||
        err.message.includes('webhook type') ||
        err.message.includes('At least one event') ||
        err.message.includes('already exists')
      ) {
        return ResponseUtil.error(res, err.message, 400);
      }
      console.error('createWebhook error:', err);
      next(err);
    }
  }

  /**
   * PUT /api/webhooks/:id
   * Update a webhook.
   * Body: any of { name, url, type, events, board_ids, description, is_active }
   */
  async updateWebhook(req, res, next) {
    try {
      const { id } = req.params;
      const organizationId = req.user.organization_id;

      const webhook = await webhookService.updateWebhook(id, organizationId, req.body);

      // Strip secret_key from response
      const { secret_key, ...safeWebhook } = webhook;

      return ResponseUtil.success(res, 'Webhook updated successfully', { webhook: safeWebhook });
    } catch (err) {
      if (err.message === 'Webhook not found') {
        return ResponseUtil.error(res, 'Webhook not found', 404);
      }
      if (
        err.message.includes('Invalid URL') ||
        err.message.includes('HTTPS') ||
        err.message.includes('private/internal') ||
        err.message.includes('event type') ||
        err.message.includes('webhook type') ||
        err.message.includes('At least one event') ||
        err.message.includes('already exists')
      ) {
        return ResponseUtil.error(res, err.message, 400);
      }
      console.error('updateWebhook error:', err);
      next(err);
    }
  }

  /**
   * DELETE /api/webhooks/:id
   * Delete a webhook.
   */
  async deleteWebhook(req, res, next) {
    try {
      const { id } = req.params;
      const organizationId = req.user.organization_id;

      await webhookService.deleteWebhook(id, organizationId);

      console.log(`🗑️ Webhook deleted: ${id} for org ${organizationId}`);

      return ResponseUtil.success(res, 'Webhook deleted successfully');
    } catch (err) {
      console.error('deleteWebhook error:', err);
      next(err);
    }
  }

  /**
   * POST /api/webhooks/:id/regenerate-key
   * Regenerate the signing secret for a webhook.
   * Returns the new secret — only time it's visible.
   */
  async regenerateSecretKey(req, res, next) {
    try {
      const { id } = req.params;
      const organizationId = req.user.organization_id;

      const result = await webhookService.regenerateSecretKey(id, organizationId);

      console.log(`🔑 Secret regenerated for webhook: ${id}`);

      return ResponseUtil.success(res, 'Secret key regenerated. Save it — it will not be shown again.', {
        webhook_id: result.webhook.id,
        webhook_name: result.webhook.name,
        new_secret: result.new_secret,
      });
    } catch (err) {
      if (err.message === 'Webhook not found') {
        return ResponseUtil.error(res, 'Webhook not found', 404);
      }
      console.error('regenerateSecretKey error:', err);
      next(err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Test
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/webhooks/:id/test
   * Send a test delivery to the webhook URL.
   */
  async testWebhook(req, res, next) {
    try {
      const { id } = req.params;
      const organizationId = req.user.organization_id;

      // Fetch the full webhook (including secret_key needed for signing)
      const webhook = await webhookService.getWebhook(id, organizationId);

      const result = await webhookDeliveryService.sendTestDelivery(webhook, organizationId);

      return ResponseUtil.success(
        res,
        result.success
          ? `✅ Test delivery successful (HTTP ${result.responseStatus})`
          : `❌ Test delivery failed (HTTP ${result.responseStatus || 'N/A'} — ${result.errorMessage || 'Unknown error'})`,
        {
          success: result.success,
          delivery_id: result.deliveryId,
          response_status: result.responseStatus,
          error_message: result.errorMessage || null,
        },
        result.success ? 200 : 200, // Always 200 — the test ran, even if the endpoint rejected it
      );
    } catch (err) {
      if (err.message === 'Webhook not found') {
        return ResponseUtil.error(res, 'Webhook not found', 404);
      }
      console.error('testWebhook error:', err);
      next(err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Delivery Logs
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/webhooks/:id/deliveries
   * List delivery logs for a webhook (paginated).
   * Query params: page, limit, status
   */
  async listDeliveries(req, res, next) {
    try {
      const { id } = req.params;
      const organizationId = req.user.organization_id;
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const status = req.query.status || null;

      const result = await webhookDeliveryService.getDeliveries(id, organizationId, { page, limit, status });

      return ResponseUtil.success(res, 'Deliveries retrieved successfully', result);
    } catch (err) {
      if (err.message === 'Webhook not found') {
        return ResponseUtil.error(res, 'Webhook not found', 404);
      }
      console.error('listDeliveries error:', err);
      next(err);
    }
  }

  /**
   * GET /api/webhooks/:id/deliveries/:deliveryId
   * Get full details of a single delivery (includes request/response body).
   */
  async getDelivery(req, res, next) {
    try {
      const { id, deliveryId } = req.params;
      const organizationId = req.user.organization_id;

      const delivery = await webhookDeliveryService.getDelivery(deliveryId, id, organizationId);

      return ResponseUtil.success(res, 'Delivery retrieved successfully', { delivery });
    } catch (err) {
      if (err.message === 'Webhook not found' || err.message === 'Delivery not found') {
        return ResponseUtil.error(res, err.message, 404);
      }
      console.error('getDelivery error:', err);
      next(err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Event Log
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/webhooks/events
   * List webhook events fired for the organization (paginated).
   * Query: page, limit, event_type
   */
  async listEvents(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const eventType = req.query.event_type || null;
      const offset = (page - 1) * limit;

      let query = supabaseAdmin
        .from('webhook_events')
        .select('id, event_type, entity_type, entity_id, triggered_by, board_id, webhooks_triggered, created_at', { count: 'exact' })
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (eventType) query = query.eq('event_type', eventType);

      const { data, error, count } = await query;
      if (error) throw error;

      return ResponseUtil.success(res, 'Events retrieved successfully', {
        events: data,
        total: count,
        page,
        limit,
      });
    } catch (err) {
      console.error('listEvents error:', err);
      next(err);
    }
  }

  /**
   * POST /api/webhooks/:id/deliveries/:deliveryId/retry
   * Manually retry a failed delivery.
   */
  async retryDelivery(req, res, next) {
    try {
      const { id, deliveryId } = req.params;
      const organizationId = req.user.organization_id;

      const result = await webhookDeliveryService.retryDelivery(deliveryId, organizationId);

      return ResponseUtil.success(
        res,
        result.success ? 'Retry successful' : 'Retry attempted but delivery failed again',
        {
          success: result.success,
          delivery_id: result.deliveryId,
          response_status: result.responseStatus,
          error_message: result.errorMessage || null,
        },
      );
    } catch (err) {
      if (err.message === 'Delivery not found' || err.message === 'Webhook not found') {
        return ResponseUtil.error(res, err.message, 404);
      }
      if (err.message === 'Access denied') {
        return ResponseUtil.error(res, 'Access denied', 403);
      }
      if (err.message.includes('Maximum retry') || err.message.includes('already successful')) {
        return ResponseUtil.error(res, err.message, 400);
      }
      console.error('retryDelivery error:', err);
      next(err);
    }
  }
}

module.exports = new WebhookController();
