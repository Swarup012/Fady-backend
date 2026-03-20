const customDomainService = require('../services/custom-domain.service');
const dnsVerificationService = require('../services/dns-verification.service');
const sslCertificateService = require('../services/ssl-certificate.service');
const nginxConfigService = require('../services/nginx-config.service');

class CustomDomainController {
  /**
   * Add new custom domain
   * POST /api/custom-domains
   */
  async addDomain(req, res) {
    try {
      const { domain } = req.body;
      const organizationId = req.organization.id;

      if (!domain) {
        return res.status(400).json({ error: 'Domain is required' });
      }

      const customDomain = await customDomainService.addCustomDomain(organizationId, domain);

      return res.status(201).json({
        message: 'Custom domain added successfully',
        data: customDomain
      });
    } catch (error) {
      console.error('Error adding custom domain:', error);
      return res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get organization's custom domain
   * GET /api/custom-domains
   */
  async getDomain(req, res) {
    try {
      const organizationId = req.organization.id;
      const customDomain = await customDomainService.getOrganizationDomain(organizationId);

      if (!customDomain) {
        return res.status(404).json({ error: 'No custom domain found' });
      }

      // Add DNS instructions if not verified
      if (!customDomain.is_verified) {
        customDomain.dns_records = customDomainService.getDNSInstructions(
          customDomain.domain,
          customDomain.verification_token
        );
      }

      return res.json({ data: customDomain });
    } catch (error) {
      console.error('Error getting custom domain:', error);
      return res.status(500).json({ error: 'Failed to get custom domain' });
    }
  }

  /**
   * Verify domain ownership
   * POST /api/custom-domains/:id/verify
   */
  async verifyDomain(req, res) {
    try {
      const { id } = req.params;
      const organizationId = req.organization.id;

      // Get domain
      const customDomain = await customDomainService.getCustomDomain(id, organizationId);

      if (!customDomain) {
        return res.status(404).json({ error: 'Custom domain not found' });
      }

      if (customDomain.is_verified) {
        return res.json({
          message: 'Domain already verified',
          data: customDomain
        });
      }

      // Verify DNS records
      const verification = await dnsVerificationService.verifyDomain(
        customDomain.domain,
        customDomain.verification_token
      );

      if (!verification.verified) {
        return res.status(400).json({
          error: 'Domain verification failed',
          details: verification
        });
      }

      // Update verification status
      const updatedDomain = await customDomainService.updateVerificationStatus(id, true);

      // Trigger SSL certificate generation in background
      this.setupSSL(updatedDomain).catch(error => {
        console.error('SSL setup failed:', error);
      });

      return res.json({
        message: 'Domain verified successfully',
        data: updatedDomain
      });
    } catch (error) {
      console.error('Error verifying domain:', error);
      return res.status(500).json({ error: 'Failed to verify domain' });
    }
  }

  /**
   * Setup SSL certificate and Nginx config (background task)
   */
  async setupSSL(customDomain) {
    try {
      console.log(`Setting up SSL for ${customDomain.domain}...`);

      // Generate Nginx configuration
      const nginxConfigPath = await nginxConfigService.createConfig(customDomain.domain, customDomain.organization_id);

      // Generate SSL certificate
      const sslResult = await sslCertificateService.generateCertificate(customDomain.domain);

      if (sslResult.success) {
        // Update SSL status
        await customDomainService.updateSSLStatus(customDomain.id, 'active', {
          ssl_issued_at: new Date().toISOString(),
          ssl_expires_at: sslResult.expiresAt,
          nginx_config_path: nginxConfigPath
        });

        // Reload Nginx
        await nginxConfigService.reloadNginx();

        console.log(`SSL setup complete for ${customDomain.domain}`);
      } else {
        await customDomainService.updateSSLStatus(customDomain.id, 'failed', {
          error_message: sslResult.error
        });
      }
    } catch (error) {
      console.error('SSL setup error:', error);
      await customDomainService.updateSSLStatus(customDomain.id, 'failed', {
        error_message: error.message
      });
    }
  }

  /**
   * Delete custom domain
   * DELETE /api/custom-domains/:id
   */
  async deleteDomain(req, res) {
    try {
      const { id } = req.params;
      const organizationId = req.organization.id;

      const customDomain = await customDomainService.getCustomDomain(id, organizationId);

      if (!customDomain) {
        return res.status(404).json({ error: 'Custom domain not found' });
      }

      // Remove Nginx config
      if (customDomain.nginx_config_path) {
        await nginxConfigService.removeConfig(customDomain.nginx_config_path);
      }

      // Soft delete domain
      await customDomainService.deleteCustomDomain(id, organizationId);

      return res.json({ message: 'Custom domain deleted successfully' });
    } catch (error) {
      console.error('Error deleting custom domain:', error);
      return res.status(500).json({ error: 'Failed to delete custom domain' });
    }
  }

  /**
   * Get DNS verification status
   * GET /api/custom-domains/:id/dns-status
   */
  async getDNSStatus(req, res) {
    try {
      const { id } = req.params;
      const organizationId = req.organization.id;

      const customDomain = await customDomainService.getCustomDomain(id, organizationId);

      if (!customDomain) {
        return res.status(404).json({ error: 'Custom domain not found' });
      }

      const verification = await dnsVerificationService.verifyDomain(
        customDomain.domain,
        customDomain.verification_token
      );

      return res.json({
        data: {
          domain: customDomain.domain,
          ...verification
        }
      });
    } catch (error) {
      console.error('Error checking DNS status:', error);
      return res.status(500).json({ error: 'Failed to check DNS status' });
    }
  }
}

module.exports = new CustomDomainController();
