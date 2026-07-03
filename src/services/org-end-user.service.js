const { supabaseAdmin } = require('../config/supabase.config');

/**
 * Upsert org-scoped end-user identity after verified SDK identify.
 */
async function upsertOrgEndUser({
  organization_id,
  widget_instance_id,
  external_user_id,
  email,
  name,
  identity_type = 'verified',
  custom_fields = {},
}) {
  const now = new Date().toISOString();

  const { data: existing, error: findError } = await supabaseAdmin
    .from('org_end_users')
    .select('*')
    .eq('organization_id', organization_id)
    .eq('external_user_id', external_user_id)
    .maybeSingle();

  if (findError) throw findError;

  const row = {
    organization_id,
    widget_instance_id,
    external_user_id,
    email,
    name,
    identity_type,
    custom_fields,
    verified_at: identity_type === 'verified' ? now : null,
    last_seen_at: now,
    updated_at: now,
  };

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('org_end_users')
      .update({
        email: email || existing.email,
        name: name || existing.name,
        identity_type,
        custom_fields: { ...(existing.custom_fields || {}), ...custom_fields },
        widget_instance_id,
        verified_at: identity_type === 'verified' ? now : existing.verified_at,
        last_seen_at: now,
        updated_at: now,
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from('org_end_users')
    .insert([row])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Link all org_end_users with matching email to a portal users.id (global auth).
 */
async function linkOrgEndUsersToAuthUser(email, userId) {
  if (!email || !userId) return { count: 0 };

  const normalized = String(email).trim().toLowerCase();

  const { data, error } = await supabaseAdmin
    .from('org_end_users')
    .update({
      user_id: userId,
      identity_type: 'verified',
      updated_at: new Date().toISOString(),
    })
    .eq('email', normalized)
    .is('user_id', null)
    .select('id');

  if (error) throw error;
  return { count: data?.length || 0 };
}

module.exports = {
  upsertOrgEndUser,
  linkOrgEndUsersToAuthUser,
};
