const express = require('express');
const router = express.Router();
const customDomainController = require('../controllers/custom-domain.controller');
const { requireAdmin } = require('../middleware/organization-role.middleware');

// All routes require admin role (owner or admin)
router.use(requireAdmin);

// Add custom domain
router.post('/', customDomainController.addDomain);

// Get organization's custom domain
router.get('/', customDomainController.getDomain);

// Verify domain ownership
router.post('/:id/verify', customDomainController.verifyDomain);

// Get DNS verification status
router.get('/:id/dns-status', customDomainController.getDNSStatus);

// Delete custom domain
router.delete('/:id', customDomainController.deleteDomain);

module.exports = router;
