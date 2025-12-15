/**
 * Invitation Routes
 * Routes for organization invitation management
 */

const express = require('express');
const router = express.Router();
const invitationController = require('../controllers/invitation.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Public route - verify invitation token (no auth required)
router.get('/verify/:token', invitationController.verifyToken);

// Protected routes - require authentication
router.post('/accept/:token', authenticate, invitationController.acceptInvitation);

module.exports = router;
