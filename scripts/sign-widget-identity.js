#!/usr/bin/env node
/**
 * Server-side HMAC signer for widget SDK (production pattern).
 *
 * Usage:
 *   node scripts/sign-widget-identity.js <api_secret> <userID> <email> [name]
 *
 * Example:
 *   node scripts/sign-widget-identity.js wsec_abc user-123 jane@acme.com "Jane Doe"
 */
const {
  generateIdentityHash,
} = require('../src/services/widget-hmac.service');

async function main() {
  const [, , apiSecret, userID, email, name] = process.argv;

  if (!apiSecret || !userID || !email) {
    console.error('Usage: node scripts/sign-widget-identity.js <api_secret> <userID> <email> [name]');
    process.exit(1);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const hash = generateIdentityHash(apiSecret, userID, email, String(timestamp));

  const payload = {
    userID,
    email,
    name: name || null,
    timestamp,
    hash,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main();
