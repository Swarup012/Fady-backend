const dns = require('dns').promises;

class DNSVerificationService {
  /**
   * Verify TXT record exists for domain ownership
   * @param {string} domain - The domain to verify (e.g., "feedback.acme.com")
   * @param {string} expectedValue - The verification token to look for
   * @returns {Promise<boolean>} - True if verification record found
   */
  async verifyTXTRecord(domain, expectedValue) {
    try {
      // Construct the verification subdomain
      // For domain "feedback.acme.com", we check "_faddy-verify.feedback.acme.com"
      const verificationDomain = `_faddy-verify.${domain}`;
      
      console.log(`🔍 Checking TXT records for: ${verificationDomain}`);
      
      // Query TXT records
      const records = await dns.resolveTxt(verificationDomain);
      
      // TXT records are returned as array of arrays: [["value1"], ["value2"]]
      // Flatten and check if our expected value exists
      const flatRecords = records.flat();
      
      console.log(`📝 Found TXT records:`, flatRecords);
      
      const found = flatRecords.some(record => 
        record.trim() === expectedValue.trim()
      );
      
      if (found) {
        console.log(`✅ Verification record found for ${domain}`);
      } else {
        console.log(`❌ Verification record NOT found for ${domain}`);
        console.log(`   Expected: ${expectedValue}`);
        console.log(`   Found: ${flatRecords.join(', ')}`);
      }
      
      return found;
    } catch (error) {
      // ENOTFOUND or ENODATA means no TXT records found
      if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
        console.log(`❌ No TXT records found for ${domain}`);
        return false;
      }
      
      // Other DNS errors
      console.error(`🔴 DNS verification error for ${domain}:`, error.message);
      throw new Error(`DNS verification failed: ${error.message}`);
    }
  }

  /**
   * Verify CNAME record points to our domain
   * @param {string} domain - The custom domain (e.g., "feedback.acme.com")
   * @param {string} expectedTarget - Our domain (e.g., "faddy.site")
   * @returns {Promise<boolean>} - True if CNAME points correctly
   */
  async verifyCNAME(domain, expectedTarget = 'faddy.site') {
    try {
      console.log(`🔍 Checking CNAME for: ${domain}`);
      
      // Query CNAME records
      const records = await dns.resolveCname(domain);
      
      console.log(`📝 Found CNAME records:`, records);
      
      // Check if any CNAME points to our domain
      const found = records.some(record => 
        record.toLowerCase().includes(expectedTarget.toLowerCase())
      );
      
      if (found) {
        console.log(`✅ CNAME correctly points to ${expectedTarget}`);
      } else {
        console.log(`❌ CNAME does NOT point to ${expectedTarget}`);
        console.log(`   Expected: ${expectedTarget}`);
        console.log(`   Found: ${records.join(', ')}`);
      }
      
      return found;
    } catch (error) {
      if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') {
        console.log(`❌ No CNAME record found for ${domain}`);
        return false;
      }
      
      console.error(`🔴 CNAME verification error for ${domain}:`, error.message);
      throw new Error(`CNAME verification failed: ${error.message}`);
    }
  }

  /**
   * Verify both TXT and CNAME records
   * @param {string} domain - The custom domain
   * @param {string} verificationToken - The TXT record token
   * @returns {Promise<{txtValid: boolean, cnameValid: boolean, allValid: boolean}>}
   */
  async verifyDomain(domain, verificationToken) {
    try {
      const [txtValid, cnameValid] = await Promise.all([
        this.verifyTXTRecord(domain, verificationToken),
        this.verifyCNAME(domain)
      ]);

      const allValid = txtValid && cnameValid;

      return {
        txtValid,
        cnameValid,
        allValid,
        message: allValid 
          ? 'Domain verified successfully' 
          : 'Domain verification incomplete'
      };
    } catch (error) {
      console.error('🔴 Domain verification error:', error);
      throw error;
    }
  }

  /**
   * Generate a verification token
   * @param {string} organizationId - Organization UUID
   * @returns {string} - Verification token
   */
  generateVerificationToken(organizationId) {
    // Create a unique token based on org ID and timestamp
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    return `faddy-verify-${organizationId.substring(0, 8)}-${randomString}`;
  }
}

module.exports = new DNSVerificationService();
