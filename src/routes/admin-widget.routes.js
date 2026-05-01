const express = require('express');
const router = express.Router();
const adminWidgetController = require('../controllers/admin-widget.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { injectOrganization } = require('../middleware/organization.middleware');
const { requireAdmin } = require('../middleware/organization-role.middleware');

// All widget management routes require authentication and organization context
router.use(authenticate);
router.use(injectOrganization);

// Get all widgets for organization
router.get('/', adminWidgetController.getWidgets);

// Create new widget (admin/owner only)
router.post('/', requireAdmin, adminWidgetController.createWidget);

// Get single widget
router.get('/:id', adminWidgetController.getWidget);

// Update widget (admin/owner only)
router.put('/:id', requireAdmin, adminWidgetController.updateWidget);

// Delete widget (admin/owner only)
router.delete('/:id', requireAdmin, adminWidgetController.deleteWidget);

module.exports = router;
