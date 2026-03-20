// src/routes/webhook.routes.js
// Phase 1: Webhook management routes

const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');
const { body, param } = require('express-validator');
// validate middleware is applied inline via express-validator's validationResult in the controller

// ─────────────────────────────────────────────────────────────
// Validation rules
// ─────────────────────────────────────────────────────────────

const createWebhookValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Webhook name is required')
    .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
  body('url')
    .trim()
    .notEmpty().withMessage('Webhook URL is required')
    .isURL({ require_protocol: true }).withMessage('Must be a valid URL including protocol (https://)'),
  body('type')
    .optional()
    .isIn(['custom', 'discord', 'slack']).withMessage('Type must be one of: custom, discord, slack'),
  body('events')
    .isArray({ min: 1 }).withMessage('At least one event type must be selected'),
  body('events.*')
    .isString().withMessage('Each event must be a string'),
  body('board_ids')
    .optional({ nullable: true })
    .isArray().withMessage('board_ids must be an array of UUIDs'),
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
];

const updateWebhookValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
  body('url')
    .optional()
    .trim()
    .isURL({ require_protocol: true }).withMessage('Must be a valid URL including protocol (https://)'),
  body('type')
    .optional()
    .isIn(['custom', 'discord', 'slack']).withMessage('Type must be one of: custom, discord, slack'),
  body('events')
    .optional()
    .isArray({ min: 1 }).withMessage('At least one event type must be selected'),
  body('events.*')
    .optional()
    .isString().withMessage('Each event must be a string'),
  body('board_ids')
    .optional({ nullable: true })
    .isArray().withMessage('board_ids must be an array of UUIDs'),
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active must be a boolean'),
];

// ─────────────────────────────────────────────────────────────
// Routes
// Note: authenticate + injectOrganization are applied in app.js
// ─────────────────────────────────────────────────────────────

// GET /api/webhooks/events     — list supported event types (before /:id to avoid conflict)
router.get('/events', webhookController.listEventTypes.bind(webhookController));

// GET /api/webhooks/event-log  — audit log of all fired webhook events
router.get('/event-log', webhookController.listEvents.bind(webhookController));

// GET /api/webhooks — list all webhooks for the org
router.get('/', webhookController.listWebhooks.bind(webhookController));

// POST /api/webhooks — create a new webhook
router.post(
  '/',
  createWebhookValidation,
  webhookController.createWebhook.bind(webhookController),
);

// GET /api/webhooks/:id — get single webhook
router.get('/:id', webhookController.getWebhook.bind(webhookController));

// PUT /api/webhooks/:id — update webhook
router.put(
  '/:id',
  updateWebhookValidation,
  webhookController.updateWebhook.bind(webhookController),
);

// DELETE /api/webhooks/:id — delete webhook
router.delete('/:id', webhookController.deleteWebhook.bind(webhookController));

// POST /api/webhooks/:id/test — send test delivery
router.post('/:id/test', webhookController.testWebhook.bind(webhookController));

// POST /api/webhooks/:id/regenerate-key — regenerate signing secret
router.post('/:id/regenerate-key', webhookController.regenerateSecretKey.bind(webhookController));

// GET /api/webhooks/:id/deliveries — list delivery logs (paginated)
router.get('/:id/deliveries', webhookController.listDeliveries.bind(webhookController));

// GET /api/webhooks/:id/deliveries/:deliveryId — get single delivery details
router.get('/:id/deliveries/:deliveryId', webhookController.getDelivery.bind(webhookController));

// POST /api/webhooks/:id/deliveries/:deliveryId/retry — retry a failed delivery
router.post('/:id/deliveries/:deliveryId/retry', webhookController.retryDelivery.bind(webhookController));

module.exports = router;
