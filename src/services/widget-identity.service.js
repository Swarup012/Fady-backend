const widgetService = require('./widget.service');
const trackedUsersService = require('./tracked-users.service');
const orgEndUserService = require('./org-end-user.service');
const {
  verifyIdentityHash,
  extractIdentityFromBody,
} = require('./widget-hmac.service');

class WidgetIdentityError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getWidgetSettings(widget) {
  return {
    require_sdk_identity: true,
    show_voting: true,
    allow_anonymous: false,
    ...(widget.settings || {}),
  };
}

/**
 * Reject Phase 3 identity modes with 501.
 */
function rejectComingSoonIdentityModes(body) {
  const mode = body.identity_mode || body.identity?.identity_mode;
  if (mode === 'anonymous') {
    throw new WidgetIdentityError(
      'This identity mode is coming soon. Use SDK + HMAC (verified) identity.',
      501,
    );
  }
}

/**
 * Resolve and verify SDK identity, upsert external_users + org_end_users.
 */
async function resolveVerifiedIdentity(widget, body) {
  rejectComingSoonIdentityModes(body);

  const settings = getWidgetSettings(widget);
  const identity = extractIdentityFromBody(body);

  let finalUserID = identity.userID;
  let finalIdentityType = 'verified';

  if (identity.identity_mode === 'email_only') {
    if (settings.require_sdk_identity !== false) {
      throw new WidgetIdentityError('Widget requires verified SDK identity (Strict Mode ON)', 403);
    }
    if (!identity.email) {
      throw new WidgetIdentityError('Email is required for email_only mode', 400);
    }
    // Generate a pseudo-userID based on email since they don't have a backend UUID
    finalUserID = `email_${Buffer.from(identity.email).toString('hex').substring(0, 16)}`;
    finalIdentityType = 'email_only';
  } else {
    // Verified mode (default)
    if (settings.require_sdk_identity !== false) {
      if (!widget.api_secret) {
        throw new WidgetIdentityError(
          'Widget API secret is not configured. Generate one in Admin → Widgets.',
          503,
        );
      }

      const verification = verifyIdentityHash(widget.api_secret, identity);
      if (!verification.valid) {
        throw new WidgetIdentityError(verification.error || 'Invalid identity signature', 401);
      }

      if (!identity.email) {
        throw new WidgetIdentityError('Email is required for verified SDK identity', 400);
      }
    }

    if (!finalUserID) {
      throw new WidgetIdentityError('userID is required', 400);
    }
  }

  const organizationId = widget.organization_id;
  if (!organizationId) {
    throw new WidgetIdentityError('Widget organization not configured', 500);
  }

  const externalUser = await widgetService.createOrUpdateExternalUser({
    widget_instance_id: widget.id,
    external_user_id: finalUserID,
    email: identity.email,
    name: identity.name,
    context: identity.custom_fields,
  });

  const orgEndUser = await orgEndUserService.upsertOrgEndUser({
    organization_id: organizationId,
    widget_instance_id: widget.id,
    external_user_id: finalUserID,
    email: identity.email,
    name: identity.name,
    identity_type: finalIdentityType,
    custom_fields: identity.custom_fields,
  });

  return { identity, externalUser, orgEndUser, organizationId };
}

/**
 * Fire-and-forget tracked_users billing meter.
 */
function trackWidgetEngagement(organizationId, orgEndUser, actionType) {
  if (!organizationId || !orgEndUser?.email) return;

  trackedUsersService
    .trackUser(organizationId, orgEndUser.email, actionType, {
      name: orgEndUser.name,
      email: orgEndUser.email,
      metadata: {
        identity_type: orgEndUser.identity_type,
        source: 'widget_sdk',
        org_end_user_id: orgEndUser.id,
        custom_fields: orgEndUser.custom_fields,
      },
    })
    .catch((err) => console.warn('⚠️ Widget tracked_users failed (non-fatal):', err.message));
}

module.exports = {
  WidgetIdentityError,
  getWidgetSettings,
  resolveVerifiedIdentity,
  trackWidgetEngagement,
  rejectComingSoonIdentityModes,
};
