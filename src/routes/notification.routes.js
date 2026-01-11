// src/routes/notification.routes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');

// ============================================
// PUBLIC ROUTES (No authentication)
// ============================================

// Unsubscribe via email link
router.get('/unsubscribe/:token', notificationController.getUnsubscribePage);
router.post('/unsubscribe/:token', notificationController.confirmUnsubscribe);

// ============================================
// AUTHENTICATED ROUTES
// ============================================

// Get user notification preferences
router.get('/preferences', authenticate, notificationController.getPreferences);

// Update user notification preferences
router.put('/preferences', authenticate, notificationController.updatePreferences);

// Get notification history for user
router.get('/history', authenticate, notificationController.getHistory);

// ============================================
// INTERNAL ROUTES (Backend only - add auth check in production)
// ============================================

// Manually trigger queue processing (for testing)
router.post('/internal/process-queue', notificationController.processQueue);

// Get queue status
router.get('/internal/queue-status', notificationController.getQueueStatus);

module.exports = router;
