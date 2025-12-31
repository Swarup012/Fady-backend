// src/routes/stripe.routes.js

/**
 * =====================================================
 * STRIPE API ROUTES
 * =====================================================
 */

const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripe.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { injectOrganization } = require('../middleware/organization.middleware');

// =====================================================
// WEBHOOK ENDPOINT - Registered in app.js BEFORE express.json()
// =====================================================
// The webhook route is registered separately in app.js with express.raw()
// to preserve the raw body needed for Stripe signature verification

// =====================================================
// PUBLIC ROUTES
// =====================================================
// Get pricing configuration (no auth required)
router.get('/pricing', stripeController.getPricing);

// =====================================================
// AUTHENTICATED ROUTES
// =====================================================
// All routes below require authentication and organization context

// Create checkout session (start subscription)
router.post(
  '/create-checkout-session',
  authenticate,
  injectOrganization,
  stripeController.createCheckoutSession
);

// Create customer portal session (manage subscription)
router.post(
  '/create-portal-session',
  authenticate,
  injectOrganization,
  stripeController.createPortalSession
);

// Get current subscription status
router.get(
  '/subscription',
  authenticate,
  injectOrganization,
  stripeController.getSubscription
);

// Get invoices/payment history
router.get(
  '/invoices',
  authenticate,
  injectOrganization,
  stripeController.getInvoices
);

// Get subscription change history
router.get(
  '/subscription/history',
  authenticate,
  injectOrganization,
  authorize(['owner', 'admin']), // Only owners/admins can see history
  stripeController.getSubscriptionHistory
);

// Cancel subscription (prefer using Customer Portal)
router.post(
  '/cancel-subscription',
  authenticate,
  injectOrganization,
  authorize(['owner', 'admin']), // Only owners/admins can cancel
  stripeController.cancelSubscription
);

module.exports = router;
