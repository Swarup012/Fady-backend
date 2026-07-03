const crypto = require('crypto');

/** Max age of signed identity payloads (seconds) */
const IDENTITY_TIMESTAMP_WINDOW_SEC = 300;

const RESERVED_IDENTITY_KEYS = new Set([
  'userID',
  'id',
  'userId',
  'email',
  'name',
  'timestamp',
  'hash',
  'identity',
  'identity_mode',
  'custom_fields',
  'title',
  'description',
  'category',
  'feedback_id',
  'external_user_id',
]);

/**
 * Build HMAC payload: userID + ":" + email + ":" + timestamp
 */
function buildIdentityPayload(userID, email, timestamp) {
  return `${userID}:${email}:${timestamp}`;
}

/**
 * Generate HMAC-SHA256 hex digest for widget SDK identity.
 */
function generateIdentityHash(apiSecret, userID, email, timestamp) {
  const payload = buildIdentityPayload(userID, email, timestamp);
  return crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
}

/**
 * Verify widget SDK identity signature.
 */
function verifyIdentityHash(apiSecret, { userID, email, timestamp, hash }) {
  if (!apiSecret) {
    return { valid: false, error: 'Widget API secret is not configured' };
  }
  if (!userID || !email || timestamp === undefined || timestamp === null || !hash) {
    return { valid: false, error: 'Missing required identity fields (userID, email, timestamp, hash)' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { valid: false, error: 'Invalid timestamp' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > IDENTITY_TIMESTAMP_WINDOW_SEC) {
    return { valid: false, error: 'Identity signature expired' };
  }

  const expected = generateIdentityHash(apiSecret, userID, email, String(timestamp));
  const expectedBuf = Buffer.from(expected, 'hex');
  let providedBuf;

  try {
    providedBuf = Buffer.from(String(hash), 'hex');
  } catch {
    return { valid: false, error: 'Invalid hash format' };
  }

  if (expectedBuf.length !== providedBuf.length) {
    return { valid: false, error: 'Invalid identity signature' };
  }

  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, error: 'Invalid identity signature' };
  }

  return { valid: true };
}

/**
 * Parse identity from request body (flat or nested under `identity`).
 */
function extractIdentityFromBody(body = {}) {
  const src = body.identity && typeof body.identity === 'object' ? body.identity : body;

  const userID = src.userID || src.id || src.userId || null;
  const email = src.email ? String(src.email).trim().toLowerCase() : null;
  const name = src.name ? String(src.name).trim() : null;
  const timestamp = src.timestamp;
  const hash = src.hash;
  const identity_mode = src.identity_mode || 'verified';

  let custom_fields =
    src.custom_fields && typeof src.custom_fields === 'object' ? { ...src.custom_fields } : {};

  for (const [key, value] of Object.entries(src)) {
    if (!RESERVED_IDENTITY_KEYS.has(key) && value !== undefined && value !== null) {
      custom_fields[key] = value;
    }
  }

  return { userID, email, name, timestamp, hash, identity_mode, custom_fields };
}

module.exports = {
  IDENTITY_TIMESTAMP_WINDOW_SEC,
  buildIdentityPayload,
  generateIdentityHash,
  verifyIdentityHash,
  extractIdentityFromBody,
};
