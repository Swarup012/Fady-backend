const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class SSLCertificateService {
  constructor() {
    this.certbotEmail = process.env.CERTBOT_EMAIL || 'admin@faddy.site';
  }

  /**
   * Generate SSL certificate using Certbot
   */
  async generateCertificate(domain) {
    try {
      console.log(`Generating SSL certificate for ${domain}...`);

      // Use certbot with standalone mode (requires port 80/443 available)
      // OR use DNS challenge if you have API access to DNS provider
      const command = `sudo certbot certonly --webroot -w /var/www/html -d ${domain} --email ${this.certbotEmail} --agree-tos --non-interactive`;

      const { stdout, stderr } = await execPromise(command);
      
      console.log('Certbot output:', stdout);
      if (stderr) console.error('Certbot errors:', stderr);

      // Check if certificate was generated
      const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
      const keyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;

      // Verify certificate exists
      try {
        await execPromise(`ls ${certPath}`);
        await execPromise(`ls ${keyPath}`);
      } catch (error) {
        throw new Error('Certificate files not found after generation');
      }

      // Get certificate expiration date
      const { stdout: certInfo } = await execPromise(
        `sudo openssl x509 -enddate -noout -in ${certPath}`
      );
      
      const expiryMatch = certInfo.match(/notAfter=(.+)/);
      const expiresAt = expiryMatch ? new Date(expiryMatch[1]) : null;

      return {
        success: true,
        certPath,
        keyPath,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        message: 'SSL certificate generated successfully'
      };
    } catch (error) {
      console.error('SSL generation error:', error);
      return {
        success: false,
        error: error.message || 'Failed to generate SSL certificate'
      };
    }
  }

  /**
   * Renew SSL certificate (called by cron/scheduled job)
   */
  async renewCertificate(domain) {
    try {
      console.log(`Renewing SSL certificate for ${domain}...`);

      const command = `sudo certbot renew --cert-name ${domain} --non-interactive`;
      const { stdout, stderr } = await execPromise(command);

      console.log('Renewal output:', stdout);
      if (stderr) console.error('Renewal errors:', stderr);

      return {
        success: true,
        message: 'SSL certificate renewed successfully'
      };
    } catch (error) {
      console.error('SSL renewal error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check certificate expiration status
   */
  async checkExpiration(domain) {
    try {
      const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
      
      const { stdout } = await execPromise(
        `sudo openssl x509 -enddate -noout -in ${certPath}`
      );

      const expiryMatch = stdout.match(/notAfter=(.+)/);
      if (!expiryMatch) {
        throw new Error('Could not parse certificate expiration date');
      }

      const expiresAt = new Date(expiryMatch[1]);
      const daysUntilExpiry = Math.floor((expiresAt - new Date()) / (1000 * 60 * 60 * 24));

      return {
        expiresAt: expiresAt.toISOString(),
        daysUntilExpiry,
        needsRenewal: daysUntilExpiry < 30
      };
    } catch (error) {
      console.error('Error checking expiration:', error);
      return null;
    }
  }

  /**
   * Revoke SSL certificate
   */
  async revokeCertificate(domain) {
    try {
      console.log(`Revoking SSL certificate for ${domain}...`);

      const command = `sudo certbot revoke --cert-name ${domain} --non-interactive`;
      await execPromise(command);

      // Delete certificate files
      const deleteCommand = `sudo certbot delete --cert-name ${domain} --non-interactive`;
      await execPromise(deleteCommand);

      return {
        success: true,
        message: 'SSL certificate revoked successfully'
      };
    } catch (error) {
      console.error('SSL revocation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new SSLCertificateService();
