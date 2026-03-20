// src/services/webhook-delivery.service.js
// Phase 1: HTTP delivery, signature generation, Discord/Slack formatting, retry logic

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { supabaseAdmin } = require('../config/supabase.config');
const webhookService = require('./webhook.service');

// Retry delay schedule (milliseconds) — 5 attempts with exponential backoff
// Attempt 1: immediate (first try)
// Attempt 2: 1 minute later
// Attempt 3: 5 minutes later
// Attempt 4: 30 minutes later
// Attempt 5: 2 hours later
const RETRY_DELAYS = [
  0,                    // Attempt 1: immediate
  1  * 60 * 1000,       // Attempt 2: 1 minute
  5  * 60 * 1000,       // Attempt 3: 5 minutes
  30 * 60 * 1000,       // Attempt 4: 30 minutes
  2  * 60 * 60 * 1000,  // Attempt 5: 2 hours
];

const MAX_ATTEMPTS = RETRY_DELAYS.length;

class WebhookDeliveryService {

  // ─────────────────────────────────────────────────────────────
  // Signature
  // ─────────────────────────────────────────────────────────────

  /**
   * Generate HMAC SHA256 signature for a payload.
   * Receivers can verify: HMAC-SHA256(secret, timestamp + '.' + body) === signature
   */
  generateSignature(secretKey, timestamp, body) {
    const signingPayload = `${timestamp}.${body}`;
    return crypto
      .createHmac('sha256', secretKey)
      .update(signingPayload)
      .digest('hex');
  }

  // ─────────────────────────────────────────────────────────────
  // Platform Formatters
  // ─────────────────────────────────────────────────────────────

  /**
   * Format a standard event payload into a Discord embed message.
   */
  formatForDiscord(payload, subdomain = null) {
    const { event_type, data, actor, organization } = payload;

    const colorMap = {
      'post.created':        0x5865F2,
      'post.updated':        0xFEE75C,
      'post.status_changed': 0x57F287,
      'post.deleted':        0xED4245,
      'comment.created':     0xEB459E,
      'vote.created':        0x57F287,
      'board.created':       0x5865F2,
      'changelog.published': 0xFEE75C,
    };

    const emojiMap = {
      'post.created':        '📝',
      'post.updated':        '✏️',
      'post.status_changed': '🔄',
      'post.deleted':        '🗑️',
      'comment.created':     '💬',
      'vote.created':        '👍',
      'board.created':       '📋',
      'changelog.published': '📢',
    };

    const emoji = emojiMap[event_type] || '🔔';
    const color = colorMap[event_type] || 0x5865F2;
    const label = event_type.replace('.', ' ').replace(/_/g, ' ');
    const title = `${emoji} ${label.charAt(0).toUpperCase() + label.slice(1)}`;

    const fields = [];

    // Build fields based on event type
    if (data?.post) {
      const post = data.post;
      if (post.title)           fields.push({ name: 'Post', value: post.title, inline: false });
      if (post.board?.name)     fields.push({ name: 'Board', value: post.board.name, inline: true });
      if (post.status)          fields.push({ name: 'Status', value: post.status.replace(/-/g, ' '), inline: true });
      if (post.votes !== undefined) fields.push({ name: 'Votes', value: String(post.votes), inline: true });
      if (post.author?.name)    fields.push({ name: 'Author', value: post.author.name, inline: true });
    }

    if (data?.comment) {
      if (data.comment.content) fields.push({ name: 'Comment', value: data.comment.content.substring(0, 1024), inline: false });
      if (data.comment.author?.name) fields.push({ name: 'By', value: data.comment.author.name, inline: true });
      if (data.post?.title)     fields.push({ name: 'On Post', value: data.post.title, inline: true });
    }

    if (data?.old_status && data?.new_status) {
      fields.push({ name: 'Old Status', value: data.old_status.replace(/-/g, ' '), inline: true });
      fields.push({ name: 'New Status', value: data.new_status.replace(/-/g, ' '), inline: true });
    }

    if (data?.changelog) {
      if (data.changelog.title) fields.push({ name: 'Changelog', value: data.changelog.title, inline: false });
      if (data.changelog.type)  fields.push({ name: 'Type', value: data.changelog.type, inline: true });
    }

    if (data?.board && !data?.post) {
      if (data.board.name) fields.push({ name: 'Board', value: data.board.name, inline: true });
      if (data.board.slug) fields.push({ name: 'Slug', value: data.board.slug, inline: true });
    }

    if (actor?.name) fields.push({ name: 'Triggered by', value: actor.name, inline: true });

    // Build embed object — only include fields/url if non-empty/valid
    const embed = {
      title,
      color,
      footer: { text: 'Faddy Webhooks' },
      timestamp: payload.timestamp,
    };

    if (fields.length > 0) embed.fields = fields;

    // Only set url if it's a fully qualified URL
    const embedUrl = this._extractUrl(data, subdomain);
    if (embedUrl && embedUrl.startsWith('http')) embed.url = embedUrl;

    return { embeds: [embed] };
  }

  /**
   * Format a standard event payload into a Slack block kit message.
   */
  formatForSlack(payload, subdomain = null) {
    const { event_type, data, actor } = payload;

    const emojiMap = {
      'post.created':        ':memo:',
      'post.updated':        ':pencil2:',
      'post.status_changed': ':arrows_counterclockwise:',
      'post.deleted':        ':wastebasket:',
      'comment.created':     ':speech_balloon:',
      'vote.created':        ':thumbsup:',
      'board.created':       ':clipboard:',
      'changelog.published': ':mega:',
    };

    const emoji = emojiMap[event_type] || ':bell:';
    const label = event_type.replace('.', ' ').replace(/_/g, ' ');
    const title = `${emoji} ${label.charAt(0).toUpperCase() + label.slice(1)}`;

    // Slack header block has a 150 char limit
    const headerText = title.length > 150 ? title.substring(0, 147) + '...' : title;
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: headerText, emoji: true },
      },
    ];

    // Build main text section
    const lines = [];

    if (data?.post) {
      const post = data.post;
      if (post.title)           lines.push(`*Post:* ${post.title}`);
      if (post.board?.name)     lines.push(`*Board:* ${post.board.name}`);
      if (post.status)          lines.push(`*Status:* ${post.status.replace(/-/g, ' ')}`);
      if (post.author?.name)    lines.push(`*Author:* ${post.author.name}`);
      if (post.votes !== undefined) lines.push(`*Votes:* ${post.votes}`);
    }

    if (data?.old_status && data?.new_status) {
      lines.push(`*Status Changed:* ${data.old_status.replace(/-/g, ' ')} → ${data.new_status.replace(/-/g, ' ')}`);
    }

    if (data?.comment) {
      if (data.post?.title)          lines.push(`*Post:* ${data.post.title}`);
      if (data.comment.author?.name) lines.push(`*Comment by:* ${data.comment.author.name}`);
      if (data.comment.content)      lines.push(`*Comment:* ${data.comment.content.substring(0, 300)}`);
    }

    if (data?.changelog) {
      if (data.changelog.title) lines.push(`*Changelog:* ${data.changelog.title}`);
      if (data.changelog.type)  lines.push(`*Type:* ${data.changelog.type}`);
    }

    if (data?.board && !data?.post) {
      if (data.board.name) lines.push(`*Board:* ${data.board.name}`);
      if (data.board.slug) lines.push(`*Slug:* ${data.board.slug}`);
    }

    if (actor?.name) lines.push(`*By:* ${actor.name}`);

    // Always add at least a fallback text section (Slack requires content after header)
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: lines.length > 0 ? lines.join('\n') : `Event: *${event_type}*`,
      },
    });

    // Add action button if URL is fully qualified
    const url = this._extractUrl(data, subdomain);
    if (url && url.startsWith('http')) {
      blocks.push({
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: 'View Details', emoji: true },
          url,
          style: 'primary',
        }],
      });
    }

    return { blocks };
  }

  // ─────────────────────────────────────────────────────────────
  // Core Delivery
  // ─────────────────────────────────────────────────────────────

  /**
   * Deliver a webhook event to a single webhook endpoint.
   * Handles formatting, signing, HTTP request, and logging.
   *
   * @param {object} webhook - Full webhook row from DB
   * @param {object} standardPayload - The standard event payload object
   * @param {number} attemptNumber - Which attempt this is (1, 2, or 3)
   * @param {string|null} existingDeliveryId - Pass to update an existing delivery record on retry
   */
  async deliver(webhook, standardPayload, attemptNumber = 1, existingDeliveryId = null) {
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Choose payload format based on webhook type
    const subdomain = standardPayload.organization?.subdomain || null;
    let body;
    if (webhook.type === 'discord') {
      body = this.formatForDiscord(standardPayload, subdomain);
    } else if (webhook.type === 'slack') {
      body = this.formatForSlack(standardPayload, subdomain);
    } else {
      body = standardPayload; // Raw standard payload for custom webhooks
    }

    const bodyString = JSON.stringify(body);
    const signature = this.generateSignature(webhook.secret_key, timestamp, bodyString);

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Faddy-Webhooks/1.0',
      'X-Faddy-Event': standardPayload.event_type,
      'X-Faddy-Delivery': standardPayload.event_id,
      'X-Faddy-Timestamp': timestamp,
      'X-Faddy-Signature': `sha256=${signature}`,
    };

    // Create or fetch delivery record
    // Always store the standardPayload (not the formatted body) so retries can rebuild correctly
    let deliveryId = existingDeliveryId;
    if (!deliveryId) {
      deliveryId = await this._createDeliveryRecord({
        webhookId: webhook.id,
        eventType: standardPayload.event_type,
        eventId: standardPayload.event_id,
        attemptNumber,
        requestUrl: webhook.url,
        requestHeaders: headers,
        requestBody: standardPayload,
      });
    } else {
      // Update attempt number on existing delivery record
      await supabaseAdmin
        .from('webhook_deliveries')
        .update({ attempt_number: attemptNumber, status: 'retrying', next_retry_at: null })
        .eq('id', deliveryId);
    }

    // Make HTTP request
    const startTime = Date.now();
    let responseStatus = null;
    let responseBody = null;
    let errorMessage = null;
    let success = false;

    try {
      const result = await this._makeHttpRequest(webhook.url, headers, bodyString);
      responseStatus = result.statusCode;
      responseBody = result.body?.substring(0, 2000); // Truncate large bodies
      const responseTimeMs = Date.now() - startTime;

      // 2xx = success
      success = responseStatus >= 200 && responseStatus < 300;

      if (!success) {
        console.error(`❌ [Webhook] HTTP ${responseStatus} response body: ${responseBody}`);
      }

      const canRetry = !success && attemptNumber < MAX_ATTEMPTS;
      await this._updateDeliveryRecord(deliveryId, {
        status: success ? 'success' : (canRetry ? 'retrying' : 'failed'),
        response_status: responseStatus,
        response_body: responseBody,
        response_time_ms: responseTimeMs,
        delivered_at: success ? new Date().toISOString() : null,
        error_message: success ? null : `Received HTTP ${responseStatus}`,
        next_retry_at: canRetry ? this._nextRetryTime(attemptNumber) : null,
      });

    } catch (err) {
      errorMessage = err.message;
      const responseTimeMs = Date.now() - startTime;
      const canRetryOnError = attemptNumber < MAX_ATTEMPTS;

      await this._updateDeliveryRecord(deliveryId, {
        status: canRetryOnError ? 'retrying' : 'failed',
        response_status: null,
        response_body: null,
        response_time_ms: responseTimeMs,
        error_message: errorMessage,
        next_retry_at: canRetryOnError ? this._nextRetryTime(attemptNumber) : null,
      });
    }

    // Update webhook stats
    await webhookService.incrementDeliveryStats(webhook.id, { success });
    if (success) await webhookService.markVerified(webhook.id);

    console.log(`📤 Webhook delivery [${webhook.type}] ${webhook.url} — event: ${standardPayload.event_type} — attempt: ${attemptNumber} — status: ${success ? '✅ success' : '❌ failed'} (HTTP ${responseStatus || 'N/A'})`);

    return { success, deliveryId, responseStatus, errorMessage };
  }

  /**
   * Trigger all matching webhooks for an event.
   * This is the main entry point called from controllers/services when events occur.
   *
   * @param {string} organizationId
   * @param {string} eventType         e.g. 'post.created'
   * @param {string} entityType        e.g. 'post'
   * @param {string} entityId          UUID of the entity
   * @param {object} eventData         Event-specific data for the payload
   * @param {object} actor             { id, name, email } — who triggered the event
   * @param {object} organization      { id, name, subdomain }
   * @param {string|null} boardId      UUID of the board (for filtering)
   */
  async triggerEvent({ organizationId, eventType, entityType, entityId, eventData, actor, organization, boardId = null }) {
    try {
      // 1. Find all active webhooks subscribed to this event
      const matchingWebhooks = await webhookService.findMatchingWebhooks(organizationId, eventType, boardId);

      if (!matchingWebhooks || matchingWebhooks.length === 0) {
        return { triggered: 0 };
      }

      // 1b. Fetch org subdomain if not already provided (needed for URL building)
      if (!organization?.subdomain) {
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('id, name, subdomain')
          .eq('id', organizationId)
          .single();
        if (org) organization = org;
      }

      // 2. Build the standard payload
      const standardPayload = this._buildStandardPayload({
        eventType,
        entityId,
        eventData,
        actor,
        organization,
      });

      // 3. Log the event
      await webhookService.logEvent({
        organizationId,
        eventType,
        entityType,
        entityId,
        payload: standardPayload,
        triggeredBy: actor?.id || null,
        boardId,
        webhooksTriggered: matchingWebhooks.length,
      });

      // 4. Deliver to each matching webhook (fire & forget — don't block the request)
      const deliveryPromises = matchingWebhooks.map(webhook =>
        this.deliver(webhook, standardPayload, 1)
          .catch(err => console.error(`❌ Webhook delivery error for ${webhook.id}:`, err.message))
      );

      // Run deliveries in parallel without blocking
      Promise.all(deliveryPromises).catch(err =>
        console.error('❌ Webhook batch delivery error:', err.message)
      );

      return { triggered: matchingWebhooks.length };
    } catch (err) {
      console.error('❌ triggerEvent error:', err.message);
      return { triggered: 0, error: err.message };
    }
  }

  /**
   * Send a test delivery for a webhook (sends a sample post.created payload).
   */
  async sendTestDelivery(webhook, organizationId) {
    const samplePayload = this._buildStandardPayload({
      eventType: 'post.created',
      entityId: '00000000-0000-0000-0000-000000000001',
      eventData: {
        post: {
          id: '00000000-0000-0000-0000-000000000001',
          title: 'Test Webhook — This is a sample post',
          description: 'This is a test delivery from Faddy to verify your webhook is working correctly.',
          status: 'open',
          votes: 0,
          board: { id: '00000000-0000-0000-0000-000000000002', name: 'Feature Requests', slug: 'features' },
          author: { id: null, name: 'Faddy System', email: 'system@faddy.site' },
          url: `https://${organizationId}.faddy.site/feedback/boards/features`,
          created_at: new Date().toISOString(),
        },
      },
      actor: { id: null, name: 'Faddy System', email: 'system@faddy.site' },
      organization: { id: organizationId, name: 'Your Organization', subdomain: 'yourorg' },
    });
    samplePayload.event_id = `test_${Date.now()}`;

    return this.deliver(webhook, samplePayload, 1);
  }

  /**
   * Retry a failed delivery by delivery ID.
   */
  async retryDelivery(deliveryId, organizationId) {
    // Fetch delivery + webhook
    const { data: delivery, error: dErr } = await supabaseAdmin
      .from('webhook_deliveries')
      .select('*, webhook:webhooks(*)')
      .eq('id', deliveryId)
      .single();

    if (dErr || !delivery) throw new Error('Delivery not found');

    // Verify webhook belongs to the org
    if (delivery.webhook.organization_id !== organizationId) {
      throw new Error('Access denied');
    }

    if (delivery.status === 'success') {
      throw new Error('Delivery was already successful');
    }

    if (delivery.attempt_number >= MAX_ATTEMPTS) {
      throw new Error(`Maximum retry attempts (${MAX_ATTEMPTS}) reached`);
    }

    const nextAttempt = delivery.attempt_number + 1;
    return this.deliver(delivery.webhook, delivery.request_body, nextAttempt, deliveryId);
  }

  // ─────────────────────────────────────────────────────────────
  // Delivery Logs
  // ─────────────────────────────────────────────────────────────

  /**
   * Get delivery logs for a webhook (paginated).
   */
  async getDeliveries(webhookId, organizationId, { page = 1, limit = 20, status = null } = {}) {
    // Verify webhook belongs to org
    await webhookService.getWebhook(webhookId, organizationId);

    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('webhook_deliveries')
      .select('id, event_type, event_id, attempt_number, max_attempts, request_url, response_status, response_time_ms, status, error_message, created_at, delivered_at, next_retry_at', { count: 'exact' })
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) throw error;

    return { deliveries: data, total: count, page, limit };
  }

  /**
   * Get full details of a single delivery (includes request/response bodies).
   */
  async getDelivery(deliveryId, webhookId, organizationId) {
    // Verify webhook belongs to org
    await webhookService.getWebhook(webhookId, organizationId);

    const { data, error } = await supabaseAdmin
      .from('webhook_deliveries')
      .select('*')
      .eq('id', deliveryId)
      .eq('webhook_id', webhookId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new Error('Delivery not found');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────────────────────────
  // Retry Worker (called by scheduler)
  // ─────────────────────────────────────────────────────────────

  /**
   * Process all deliveries that are in 'retrying' status and due for retry.
   * Intended to be called by a cron job every minute.
   */
  async processRetryQueue() {
    const now = new Date().toISOString();

    const { data: pending, error } = await supabaseAdmin
      .from('webhook_deliveries')
      .select('*, webhook:webhooks(*)')
      .eq('status', 'retrying')
      .lte('next_retry_at', now)
      .limit(50); // Process max 50 at a time

    if (error || !pending || pending.length === 0) return { processed: 0 };

    console.log(`🔄 Retry queue: processing ${pending.length} failed deliveries...`);

    let processed = 0;
    for (const delivery of pending) {
      if (!delivery.webhook || !delivery.webhook.is_active) continue;

      const nextAttempt = delivery.attempt_number + 1;
      try {
        // Rebuild a minimal standard payload from the stored event_type and request_body
        // request_body may be the formatted (Discord/Slack) payload, so we rebuild standard payload
        const standardPayload = this._buildStandardPayload({
          eventType: delivery.event_type,
          entityId: delivery.event_id,
          eventData: delivery.request_body?.data || delivery.request_body || {},
          actor: delivery.request_body?.actor || null,
          organization: delivery.request_body?.organization || { id: delivery.webhook.organization_id },
        });
        await this.deliver(delivery.webhook, standardPayload, nextAttempt, delivery.id);
        processed++;
      } catch (err) {
        console.error(`❌ Retry failed for delivery ${delivery.id}:`, err.message);
      }
    }

    return { processed };
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Build the standard webhook payload object.
   */
  _buildStandardPayload({ eventType, entityId, eventData, actor, organization }) {
    return {
      event_id: `evt_${eventType.replace('.', '_')}_${entityId}_${Date.now()}`,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      organization: {
        id: organization?.id || null,
        name: organization?.name || null,
        subdomain: organization?.subdomain || null,
      },
      data: eventData || {},
      actor: actor
        ? { id: actor.id || null, name: actor.name || null, email: actor.email || null, avatar_url: actor.avatar_url || null }
        : null,
    };
  }

  /**
   * Create a new delivery record in the DB.
   */
  async _createDeliveryRecord({ webhookId, eventType, eventId, attemptNumber, requestUrl, requestHeaders, requestBody }) {
    const { data, error } = await supabaseAdmin
      .from('webhook_deliveries')
      .insert({
        webhook_id: webhookId,
        event_type: eventType,
        event_id: eventId || null,
        attempt_number: attemptNumber,
        max_attempts: MAX_ATTEMPTS,
        request_url: requestUrl,
        request_headers: requestHeaders,
        request_body: requestBody,
        status: 'pending',
        response_status: null,
        response_body: null,
        response_time_ms: null,
        error_message: null,
        delivered_at: null,
        next_retry_at: null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('⚠️ Failed to create delivery record:', error.message);
      return null;
    }

    return data.id;
  }

  /**
   * Update a delivery record after an attempt.
   */
  async _updateDeliveryRecord(deliveryId, updates) {
    if (!deliveryId) return;
    const { error } = await supabaseAdmin
      .from('webhook_deliveries')
      .update(updates)
      .eq('id', deliveryId);

    if (error) console.error('⚠️ Failed to update delivery record:', error.message);
  }

  /**
   * Compute the timestamp for the next retry.
   */
  _nextRetryTime(currentAttempt) {
    // currentAttempt is 1-based; index into RETRY_DELAYS by currentAttempt (next slot)
    const delay = RETRY_DELAYS[currentAttempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
    return new Date(Date.now() + delay).toISOString();
  }

  /**
   * Make an HTTP/HTTPS POST request. Returns { statusCode, body }.
   */
  _makeHttpRequest(url, headers, body) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000, // 10 second timeout
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out after 10 seconds'));
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Extract a URL from event data (for Discord embeds / Slack buttons).
   * Requires organization subdomain to build full URLs.
   */
  _extractUrl(data, subdomain) {
    // Priority 1: use the pre-built URL from the event payload (exact frontend URL)
    if (data?.post?.url && data.post.url.startsWith('http')) return data.post.url;

    // Priority 2: build from subdomain as fallback
    const base = subdomain ? `https://${subdomain}.faddy.site` : null;
    if (!base) return null;

    if (data?.post?.id && data?.post?.board?.slug) {
      return `${base}/board/${data.post.board.slug}/${data.post.id}`;
    }
    if (data?.changelog?.slug) {
      return `${base}/changelog`;
    }
    if (data?.board?.slug) {
      return `${base}/feedback/boards/${data.board.slug}`;
    }
    return null;
  }

  /**
   * Extract a short description from event data.
   */
  _extractDescription(data) {
    if (data?.post?.title) return `**${data.post.title}**${data.post.description ? `\n${data.post.description.substring(0, 200)}` : ''}`;
    if (data?.comment?.content) return data.comment.content.substring(0, 300);
    if (data?.changelog?.title) return `**${data.changelog.title}**`;
    if (data?.board?.name) return `Board: **${data.board.name}**`;
    return null;
  }
}

module.exports = new WebhookDeliveryService();
