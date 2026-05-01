const express = require('express');
const router = express.Router();
const widgetController = require('../controllers/widget.controller');
const { validateWidgetOrigin } = require('../middleware/widget.middleware');

// Widget API routes (public, but origin-validated)
// These are called from the embeddable widget

// Identify external user
router.post('/identify', widgetController.identify);

// Get feedback list
router.get('/feedback', widgetController.getFeedback);

// Create feedback
router.post('/feedback', widgetController.createFeedback);

// Vote on feedback
router.post('/vote', widgetController.vote);

// Get widget configuration
router.get('/config', widgetController.getConfig);

module.exports = router;
