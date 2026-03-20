const { supabase } = require('../config/supabase.config');
const crypto = require('crypto');

class CustomDomainService {
  /**
   * Generate verification token for domain ownership
   */
  generateVerificationToken() {
    return `faddy-verify-${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Add a new custom domain
   */
  async addCustomDomain(organizationId, domain) {
    try {
      // Check if organization can add custom domain (Pro plan, limit 1)
      const { data: canAdd, error: checkError } = await supabase
        .rpc('can_add_custom_domain', { org_id: organizationId });

      if (checkError) throw checkError;
      if (!canAdd) {
        throw new Error('Cannot add custom domain. Upgrade to Pro plan or remove existing domain.');
      }

      // Validate domain format (subdomain only)
      if (!this.isValidSubdomain(domain)) {
        throw new Error('Invalid domain format. Only subdomains are allowed (e.g., feedback.acme.com)');
      }

      // Check if domain already exists
      const { data: existing } = await supabase
        .from('custom_domains')
        .select('id')
        .eq('domain', domain)
        .single();

      if (existing) {
        throw new Error('Domain already exists');
      }

      // Generate verification token
      const verificationToken = this.generateVerificationToken();

      // Insert custom domain
      const { data, error } = await supabase
        .from('custom_domains')
        .insert({
          organization_id: organizationId,
          domain: domain.toLowerCase(),
          verification_token: verificationToken,
          verification_method: 'dns_txt',
          status: 'pending',
          is_verified: false,
          ssl_status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      return {
        ...data,
        dns_records: this.getDNSInstructions(domain, verificationToken)
      };
    } catch (error) {
      console.error('Error adding custom domain:', error);
      throw error;
    }
  }

  /**
   * Get custom domain by ID
   */
  async getCustomDomain(domainId, organizationId) {
    const { data, error } = await supabase
      .from('custom_domains')
      .select('*')
      .eq('id', domainId)
      .eq('organization_id', organizationId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get custom domain for organization
   */
  async getOrganizationDomain(organizationId) {
    const { data, error } = await supabase
      .from('custom_domains')
      .select('*')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data;
  }

  /**
   * Update custom domain verification status
   */
  async updateVerificationStatus(domainId, isVerified) {
    const updates = {
      is_verified: isVerified,
      verified_at: isVerified ? new Date().toISOString() : null,
      status: isVerified ? 'active' : 'pending'
    };

    const { data, error } = await supabase
      .from('custom_domains')
      .update(updates)
      .eq('id', domainId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update SSL status
   */
  async updateSSLStatus(domainId, sslStatus, sslData = {}) {
    const updates = {
      ssl_status: sslStatus,
      ...sslData
    };

    const { data, error } = await supabase
      .from('custom_domains')
      .update(updates)
      .eq('id', domainId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Delete custom domain (soft delete)
   */
  async deleteCustomDomain(domainId, organizationId) {
    const { data, error } = await supabase
      .from('custom_domains')
      .update({
        status: 'deleted',
        deleted_at: new Date().toISOString()
      })
      .eq('id', domainId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Validate subdomain format
   */
  isValidSubdomain(domain) {
    // Must have at least one dot (subdomain.domain.com)
    const parts = domain.split('.');
    if (parts.length < 3) return false;

    // Basic domain validation
    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
    return domainRegex.test(domain);
  }

  /**
   * Get DNS setup instructions
   */
  getDNSInstructions(domain, verificationToken) {
    return [
      {
        type: 'CNAME',
        name: domain.split('.')[0], // subdomain part
        value: 'faddy.site',
        ttl: 3600,
        description: 'Points your subdomain to Faddy'
      },
      {
        type: 'TXT',
        name: `_faddy-verify.${domain.split('.')[0]}`, // _faddy-verify.subdomain
        value: verificationToken,
        ttl: 3600,
        description: 'Verification record to prove domain ownership'
      }
    ];
  }
}

module.exports = new CustomDomainService();
