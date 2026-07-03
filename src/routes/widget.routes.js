const express = require('express');
const router = express.Router();
const widgetController = require('../controllers/widget.controller');
const { validateWidgetOrigin } = require('../middleware/widget.middleware');
const { createRateLimiter } = require('../middleware/rate-limiter.middleware');

// Create a rate limiter instance (30 requests per minute)
const widgetRateLimiter = createRateLimiter(30, 60 * 1000);

// Widget API routes (public, but origin-validated)
// Apply origin validation middleware to all widget routes
router.use(validateWidgetOrigin);

// Identify external user
router.post('/identify', widgetController.identify.bind(widgetController));

// Get feedback list
router.get('/feedback', widgetController.getFeedback.bind(widgetController));

// Create feedback
router.post('/feedback', widgetRateLimiter, widgetController.createFeedback.bind(widgetController));

// Vote on feedback
router.post('/vote', widgetRateLimiter, widgetController.vote.bind(widgetController));

// Get widget configuration
router.get('/config', widgetController.getConfig.bind(widgetController));

module.exports = router;
