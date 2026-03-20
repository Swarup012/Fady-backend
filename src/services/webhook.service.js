// src/services/webhook.service.js
// Phase 1: Webhook CRUD management + secret generation

const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase.config');

/**
 * Supported event types (Phase 1 MVP)
 */
const SUPPORTED_EVENTS = [
  'post.created',
  'post.updated',
  'post.status_changed',
  'post.deleted',
  'comment.created',
  'vote.created',
  'board.created',
  'changelog.published',
];

/**
 * Supported webhook types
 */
const WEBHOOK_TYPES = ['custom', 'discord', 'slack'];

class WebhookService {
  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Generate a cryptographically secure secret key for signing webhook payloads.
   * Format: whsec_<32 random bytes as hex>
   */
  generateSecretKey() {
    return `whsec_${crypto.randomBytes(32).toString('hex')}`;
  }

  /**
   * Validate the webhook URL.
   * - Must be a valid URL
   * - Must use HTTPS (except localhost in development)
   * - Must not point to internal/private IP ranges (SSRF protection)
   */
  validateWebhookUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL format');
    }

    // Allow http only for localhost (dev/test)
    const isLocalhost =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.endsWith('.localhost');

    if (parsed.protocol !== 'https:' && !isLocalhost) {
      throw new Error('Webhook URL must use HTTPS');
    }

    // SSRF protection — block private IP ranges
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^127\./,
      /^169\.254\./,
      /^0\.0\.0\.0/,
      /^::1$/,
      /^fc00:/,
      /^fe80:/,
    ];
    for (const range of privateRanges) {
      if (range.test(parsed.hostname)) {
        throw new Error('Webhook URL cannot point to a private/internal IP address');
      }
    }

    return true;
  }

  /**
   * Validate event types — all must be from the supported list.
   */
  validateEvents(events) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error('At least one event type must be selected');
    }
    const invalid = events.filter(e => !SUPPORTED_EVENTS.includes(e));
    if (invalid.length > 0) {
      throw new Error(`Unsupported event types: ${invalid.join(', ')}`);
    }
    return true;
  }

  /**
   * Validate webhook type.
   */
  validateType(type) {
    if (!WEBHOOK_TYPES.includes(type)) {
      throw new Error(`Invalid webhook type. Must be one of: ${WEBHOOK_TYPES.join(', ')}`);
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────────────────────

  /**
   * List all webhooks for an organization.
   */
  async listWebhooks(organizationId) {
    const { data, error } = await supabaseAdmin
      .from('webhooks')
      .select('id, name, url, type, events, board_ids, is_active, is_verified, description, created_at, updated_at, last_triggered_at, total_deliveries, failed_deliveries, created_by')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  /**
   * Get a single webhook by ID (scoped to organization).
   */
  async getWebhook(webhookId, organizationId) {
    const { data, error } = await supabaseAdmin
      .from('webhooks')
      .select('*')
      .eq('id', webhookId)
      .eq('organization_id', organizationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new Error('Webhook not found');
      throw error;
    }
    return data;
  }

  /**
   * Create a new webhook.
   */
  async createWebhook({ organizationId, name, url, type = 'custom', events, board_ids = null, description = null, createdBy }) {
    // Validate inputs
    this.validateType(type);
    this.validateWebhookUrl(url);
    this.validateEvents(events);

    const secretKey = this.generateSecretKey();

    const { data, error } = await supabaseAdmin
      .from('webhooks')
      .insert({
        organization_id: organizationId,
        name: name.trim(),
        url: url.trim(),
        type,
        secret_key: secretKey,
        events,
        board_ids: board_ids || null,
        description: description?.trim() || null,
        created_by: createdBy,
        is_active: true,
        is_verified: false,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('A webhook with this name already exists in your organization');
      throw error;
    }

    return data;
  }

  /**
   * Update an existing webhook.
   */
  async updateWebhook(webhookId, organizationId, updates) {
    // Only allow safe fields to be updated
    const allowed = ['name', 'url', 'type', 'events', 'board_ids', 'description', 'is_active'];
    const sanitized = {};
    for (const key of allowed) {
      if (key in updates) sanitized[key] = updates[key];
    }

    if (sanitized.type) this.validateType(sanitized.type);
    if (sanitized.url) this.validateWebhookUrl(sanitized.url);
    if (sanitized.events) this.validateEvents(sanitized.events);
    if (sanitized.name) sanitized.name = sanitized.name.trim();
    if (sanitized.url) sanitized.url = sanitized.url.trim();

    const { data, error } = await supabaseAdmin
      .from('webhooks')
      .update(sanitized)
      .eq('id', webhookId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new Error('Webhook not found');
      if (error.code === '23505') throw new Error('A webhook with this name already exists in your organization');
      throw error;
    }

    return data;
  }

  /**
   * Delete a webhook.
   */
  async deleteWebhook(webhookId, organizationId) {
    const { error } = await supabaseAdmin
      .from('webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('organization_id', organizationId);

    if (error) throw error;
    return true;
  }

  /**
   * Regenerate the secret key for a webhook.
   * Returns the new secret (only shown once to the user).
   */
  async regenerateSecretKey(webhookId, organizationId) {
    const newSecret = this.generateSecretKey();

    const { data, error } = await supabaseAdmin
      .from('webhooks')
      .update({ secret_key: newSecret })
      .eq('id', webhookId)
      .eq('organization_id', organizationId)
      .select('id, name')
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new Error('Webhook not found');
      throw error;
    }

    return { webhook: data, new_secret: newSecret };
  }

  // ─────────────────────────────────────────────────────────────
  // Event Matching
  // ─────────────────────────────────────────────────────────────

  /**
   * Find all active webhooks for an organization that are subscribed to a specific event.
   * Optionally filters by board_id (if webhook has board_ids filter set).
   */
  async findMatchingWebhooks(organizationId, eventType, boardId = null) {
    const { data, error } = await supabaseAdmin
      .from('webhooks')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .contains('events', [eventType]);

    if (error) throw error;
    if (!data || data.length === 0) return [];

    // Apply board filter: if webhook has board_ids set, only trigger if this event's board matches
    return data.filter(webhook => {
      if (!webhook.board_ids || webhook.board_ids.length === 0) return true; // No filter = all boards
      if (!boardId) return true; // Event has no board (e.g. changelog) — pass through
      return webhook.board_ids.includes(boardId);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────────────────────

  /**
   * Increment delivery counters on a webhook row (called after each delivery attempt).
   */
  async incrementDeliveryStats(webhookId, { success }) {
    // Use raw SQL increment to avoid race conditions
    const { error } = await supabaseAdmin.rpc('increment_webhook_stats', {
      p_webhook_id: webhookId,
      p_success: success,
    });

    // Fallback if RPC not available — fetch + update
    if (error) {
      const { data: wh } = await supabaseAdmin
        .from('webhooks')
        .select('total_deliveries, failed_deliveries')
        .eq('id', webhookId)
        .single();

      if (wh) {
        await supabaseAdmin
          .from('webhooks')
          .update({
            total_deliveries: (wh.total_deliveries || 0) + 1,
            failed_deliveries: success ? wh.failed_deliveries : (wh.failed_deliveries || 0) + 1,
            last_triggered_at: new Date().toISOString(),
          })
          .eq('id', webhookId);
      }
    }
  }

  /**
   * Mark a webhook as verified (after first successful delivery).
   */
  async markVerified(webhookId) {
    await supabaseAdmin
      .from('webhooks')
      .update({ is_verified: true })
      .eq('id', webhookId);
  }

  // ─────────────────────────────────────────────────────────────
  // Event Log
  // ─────────────────────────────────────────────────────────────

  /**
   * Log a fired event to the webhook_events table.
   */
  async logEvent({ organizationId, eventType, entityType, entityId, payload, triggeredBy, boardId, webhooksTriggered }) {
    const { data, error } = await supabaseAdmin
      .from('webhook_events')
      .insert({
        organization_id: organizationId,
        event_type: eventType,
        entity_type: entityType,
        entity_id: entityId,
        payload,
        triggered_by: triggeredBy || null,
        board_id: boardId || null,
        webhooks_triggered: webhooksTriggered || 0,
      })
      .select('id')
      .single();

    if (error) {
      console.error('⚠️ Failed to log webhook event:', error.message);
      return null;
    }
    return data?.id;
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers (public)
  // ─────────────────────────────────────────────────────────────

  /**
   * Return list of all supported event types (for the UI event picker).
   */
  getSupportedEvents() {
    return SUPPORTED_EVENTS.map(event => ({
      value: event,
      label: event
        .split('.')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).replace(/_/g, ' '))
        .join(' — '),
      category: event.split('.')[0],
    }));
  }
}

module.exports = new WebhookService();
