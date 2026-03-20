// src/routes/paddle.routes.js
const express = require('express');
const router = express.Router();
const paddleController = require('../controllers/paddle.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { injectOrganization } = require('../middleware/organization.middleware');

// =====================================================
// PUBLIC ROUTES
// =====================================================

/**
 * GET /api/paddle/pricing
 * Get pricing configuration (no auth required)
 */
router.get('/pricing', paddleController.getPricing);

// =====================================================
// AUTHENTICATED ROUTES
// =====================================================
// All routes below require authentication and organization context
router.use(authenticate);
router.use(injectOrganization);

/**
 * POST /api/paddle/create-checkout-session
 * Create Paddle checkout session for subscription
 */
router.post('/create-checkout-session', paddleController.createCheckoutSession);

/**
 * GET /api/paddle/subscription
 * Get current Paddle subscription details
 */
router.get('/subscription', paddleController.getSubscription);

/**
 * GET /api/paddle/invoices
 * Get invoices/payment history
 */
router.get('/invoices', paddleController.getInvoices);

/**
 * POST /api/paddle/subscription/cancel
 * Cancel Paddle subscription (effective at end of billing period)
 */
router.post('/subscription/cancel', paddleController.cancelSubscription);

/**
 * POST /api/paddle/subscription/update-plan
 * Update subscription plan (upgrade from Starter to Pro or vice versa)
 */
router.post('/subscription/update-plan', paddleController.updateSubscriptionPlan);

module.exports = router;
