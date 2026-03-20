// src/services/webhook-events.js
// Phase 2: Central webhook event emitter
// This module is called by services (post, board, changelog) after mutations
// to fire webhook deliveries asynchronously (non-blocking).

const webhookDeliveryService = require('./webhook-delivery.service');

/**
 * Fire a webhook event for a given organization.
 * Always non-blocking — errors are logged but never propagate.
 *
 * @param {string} organizationId  - The org that owns the webhooks
 * @param {string} eventType       - e.g. 'post.created'
 * @param {object} payload         - The event payload object
 */
async function emitWebhookEvent(organizationId, eventType, payload) {
  if (!organizationId) {
    console.warn(`⚠️  [Webhook] Skipping ${eventType} — no organizationId`);
    return;
  }

  console.log(`🔗 [Webhook] Emitting ${eventType} for org: ${organizationId}`);

  // Fire and forget — do NOT await at call site
  webhookDeliveryService
    .triggerEvent({
      organizationId,
      eventType,
      entityType: eventType.split('.')[0],
      entityId: payload?.post?.id || payload?.comment?.id || payload?.board?.id || payload?.changelog?.id || null,
      eventData: payload,
      actor: null,
      organization: { id: organizationId },
      boardId: payload?.post?.board?.id || payload?.board?.id || null,
    })
    .catch((err) => {
      console.error(`❌ [Webhook] triggerEvent failed for ${eventType}:`, err.message);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed helpers — one per event type so call sites are clean
// ─────────────────────────────────────────────────────────────────────────────

/**
 * post.created
 */
function emitPostCreatedWebhook(organizationId, post, frontendOrigin = null) {
  const boardSlug = post.board?.slug || null;
  const postUrl = (frontendOrigin && boardSlug && post.id)
    ? `${frontendOrigin}/board/${boardSlug}/${post.id}`
    : null;

  emitWebhookEvent(organizationId, 'post.created', {
    post: {
      id:          post.id,
      title:       post.title,
      description: post.description,
      status:      post.status,
      votes:       post.upvotes || 0,
      url:         postUrl,
      board: post.board
        ? { id: post.board.id, name: post.board.name, slug: post.board.slug }
        : null,
      author: post.author
        ? { id: post.author.id, name: post.author.name, email: post.author.email }
        : null,
      created_at: post.created_at,
    },
  });
}

/**
 * post.updated
 */
function emitPostUpdatedWebhook(organizationId, post, changedFields = {}, frontendOrigin = null) {
  const boardSlug = post.board?.slug || null;
  const postUrl = (frontendOrigin && boardSlug && post.id)
    ? `${frontendOrigin}/board/${boardSlug}/${post.id}`
    : null;

  emitWebhookEvent(organizationId, 'post.updated', {
    post: {
      id:     post.id,
      title:  post.title,
      status: post.status,
      votes:  post.upvotes || 0,
      url:    postUrl,
      board: post.board
        ? { id: post.board.id, name: post.board.name, slug: post.board.slug }
        : null,
      updated_at: post.updated_at || new Date().toISOString(),
    },
    changed_fields: changedFields,
  });
}

/**
 * post.status_changed
 */
function emitPostStatusChangedWebhook(organizationId, post, oldStatus, newStatus, frontendOrigin = null) {
  const boardSlug = post.board?.slug || null;
  const postUrl = (frontendOrigin && boardSlug && post.id)
    ? `${frontendOrigin}/board/${boardSlug}/${post.id}`
    : null;

  emitWebhookEvent(organizationId, 'post.status_changed', {
    post: {
      id:    post.id,
      title: post.title,
      url:   postUrl,
      board: post.board
        ? { id: post.board.id, name: post.board.name, slug: post.board.slug }
        : null,
    },
    old_status: oldStatus,
    new_status: newStatus,
    changed_at: new Date().toISOString(),
  });
}

/**
 * post.deleted
 */
function emitPostDeletedWebhook(organizationId, postId, postTitle, boardSlug) {
  emitWebhookEvent(organizationId, 'post.deleted', {
    post: {
      id:    postId,
      title: postTitle,
      board: boardSlug ? { slug: boardSlug } : null,
    },
    deleted_at: new Date().toISOString(),
  });
}

/**
 * comment.created
 */
function emitCommentCreatedWebhook(organizationId, comment, post) {
  emitWebhookEvent(organizationId, 'comment.created', {
    comment: {
      id:         comment.id,
      content:    comment.content,
      is_admin:   comment.is_admin,
      created_at: comment.created_at,
      author: comment.author
        ? { id: comment.author.id, name: comment.author.name, email: comment.author.email }
        : null,
    },
    post: post
      ? { id: post.id, title: post.title }
      : { id: comment.post_id },
  });
}

/**
 * vote.created  (upvote added — not fired on removal)
 */
function emitVoteCreatedWebhook(organizationId, postId, postTitle, userId, trackingCode) {
  emitWebhookEvent(organizationId, 'vote.created', {
    post: {
      id:    postId,
      title: postTitle || null,
    },
    voter_id:      userId        || null,
    tracking_code: trackingCode  || null,
    voted_at:      new Date().toISOString(),
  });
}

/**
 * board.created
 */
function emitBoardCreatedWebhook(organizationId, board) {
  emitWebhookEvent(organizationId, 'board.created', {
    board: {
      id:          board.id,
      name:        board.name,
      slug:        board.slug,
      description: board.description,
      is_private:  board.is_private,
      icon:        board.icon,
      created_at:  board.created_at,
    },
  });
}

/**
 * changelog.published
 */
function emitChangelogPublishedWebhook(organizationId, changelog, frontendOrigin = null) {
  const changelogUrl = frontendOrigin ? `${frontendOrigin}/changelog` : null;

  emitWebhookEvent(organizationId, 'changelog.published', {
    changelog: {
      id:           changelog.id,
      title:        changelog.title,
      slug:         changelog.slug,
      type:         changelog.type,
      description:  changelog.description,
      published_at: changelog.published_at,
      url:          changelogUrl,
      author: changelog.author
        ? { id: changelog.author.id, name: changelog.author.name }
        : null,
    },
  });
}

module.exports = {
  emitWebhookEvent,
  emitPostCreatedWebhook,
  emitPostUpdatedWebhook,
  emitPostStatusChangedWebhook,
  emitPostDeletedWebhook,
  emitCommentCreatedWebhook,
  emitVoteCreatedWebhook,
  emitBoardCreatedWebhook,
  emitChangelogPublishedWebhook,
};
