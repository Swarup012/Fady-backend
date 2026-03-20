const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class NginxConfigService {
  constructor() {
    this.configDir = process.env.NGINX_SITES_AVAILABLE || '/etc/nginx/sites-available/custom-domains';
    this.enabledDir = '/etc/nginx/sites-enabled/custom-domains';
    this.templatePath = path.join(__dirname, '../../nginx-templates/custom-domain.conf.template');
  }

  /**
   * Create Nginx configuration for custom domain
   */
  async createConfig(domain, organizationId) {
    try {
      // Read template
      const template = await fs.readFile(this.templatePath, 'utf-8');

      // Replace placeholders
      const config = template
        .replace(/\{\{DOMAIN\}\}/g, domain)
        .replace(/\{\{ORGANIZATION_ID\}\}/g, organizationId)
        .replace(/\{\{CERT_PATH\}\}/g, `/etc/letsencrypt/live/${domain}/fullchain.pem`)
        .replace(/\{\{KEY_PATH\}\}/g, `/etc/letsencrypt/live/${domain}/privkey.pem`);

      // Create config file
      const configPath = path.join(this.configDir, `${domain}.conf`);
      await fs.writeFile(configPath, config, 'utf-8');

      // Create symlink in sites-enabled
      const enabledPath = path.join(this.enabledDir, `${domain}.conf`);
      try {
        await fs.unlink(enabledPath); // Remove if exists
      } catch (err) {
        // Ignore if doesn't exist
      }
      await fs.symlink(configPath, enabledPath);

      console.log(`Nginx config created for ${domain}`);
      return configPath;
    } catch (error) {
      console.error('Error creating Nginx config:', error);
      throw error;
    }
  }

  /**
   * Remove Nginx configuration
   */
  async removeConfig(configPath) {
    try {
      const domain = path.basename(configPath, '.conf');
      const enabledPath = path.join(this.enabledDir, `${domain}.conf`);

      // Remove symlink
      try {
        await fs.unlink(enabledPath);
      } catch (err) {
        console.error('Error removing symlink:', err);
      }

      // Remove config file
      await fs.unlink(configPath);

      console.log(`Nginx config removed for ${domain}`);
      
      // Reload nginx
      await this.reloadNginx();
    } catch (error) {
      console.error('Error removing Nginx config:', error);
      throw error;
    }
  }

  /**
   * Test Nginx configuration
   */
  async testConfig() {
    try {
      const { stdout, stderr } = await execPromise('sudo nginx -t');
      console.log('Nginx test output:', stdout);
      if (stderr) console.log('Nginx test stderr:', stderr);
      return { success: true, output: stdout };
    } catch (error) {
      console.error('Nginx config test failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reload Nginx
   */
  async reloadNginx() {
    try {
      // Test config first
      const testResult = await this.testConfig();
      if (!testResult.success) {
        throw new Error('Nginx config test failed');
      }

      // Reload nginx
      await execPromise('sudo systemctl reload nginx');
      console.log('Nginx reloaded successfully');
      return { success: true };
    } catch (error) {
      console.error('Error reloading Nginx:', error);
      throw error;
    }
  }

  /**
   * Check if config exists for domain
   */
  async configExists(domain) {
    try {
      const configPath = path.join(this.configDir, `${domain}.conf`);
      await fs.access(configPath);
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new NginxConfigService();
