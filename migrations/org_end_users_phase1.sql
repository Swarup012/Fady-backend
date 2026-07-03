-- Phase 1: SDK + HMAC identity (org_end_users, api_secret, engagement FKs)
-- Run in Supabase SQL editor

-- ---------------------------------------------------------------------------
-- widget_instances: API secret for HMAC signing
-- ---------------------------------------------------------------------------
ALTER TABLE widget_instances
  ADD COLUMN IF NOT EXISTS api_secret VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_widget_instances_api_secret
  ON widget_instances(api_secret)
  WHERE api_secret IS NOT NULL;

-- ---------------------------------------------------------------------------
-- org_end_users: org-scoped end-user identity (billing, notifications, dedup)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_end_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  widget_instance_id UUID REFERENCES widget_instances(id) ON DELETE SET NULL,
  external_user_id VARCHAR(255),
  email VARCHAR(255),
  name VARCHAR(255),
  identity_type VARCHAR(32) NOT NULL DEFAULT 'verified'
    CHECK (identity_type IN ('verified', 'unverified', 'email_only', 'anonymous')),
  custom_fields JSONB NOT NULL DEFAULT '{}',
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_end_users_org_external_id
  ON org_end_users(organization_id, external_user_id)
  WHERE external_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_end_users_org_email
  ON org_end_users(organization_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_end_users_user_id
  ON org_end_users(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_end_users_organization_id
  ON org_end_users(organization_id);

-- ---------------------------------------------------------------------------
-- posts / upvotes: link engagements to org_end_users
-- ---------------------------------------------------------------------------
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS org_end_user_id UUID REFERENCES org_end_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_org_end_user_id ON posts(org_end_user_id);

ALTER TABLE upvotes
  ADD COLUMN IF NOT EXISTS org_end_user_id UUID REFERENCES org_end_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_upvotes_org_end_user_id ON upvotes(org_end_user_id);

-- ---------------------------------------------------------------------------
-- Notification RPC: include widget / org_end_user emails
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_interested_users_for_post(p_post_id UUID)
RETURNS TABLE (
  email TEXT,
  user_id UUID,
  tracking_code TEXT,
  reasons JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH interested AS (
    -- Internal post author
    SELECT u.email AS em, u.id AS uid, NULL::TEXT AS tc, jsonb_build_array('created') AS rs
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.id = p_post_id AND u.email IS NOT NULL

    UNION ALL

    -- Widget author via org_end_users
    SELECT oeu.email, oeu.user_id, NULL, jsonb_build_array('created')
    FROM posts p
    JOIN org_end_users oeu ON oeu.id = p.org_end_user_id
    WHERE p.id = p_post_id AND oeu.email IS NOT NULL

    UNION ALL

    -- Legacy widget author via external_users
    SELECT eu.email, NULL::UUID, NULL, jsonb_build_array('created')
    FROM posts p
    JOIN external_users eu ON eu.id = p.external_user_id
    WHERE p.id = p_post_id AND eu.email IS NOT NULL AND p.org_end_user_id IS NULL

    UNION ALL

    -- Upvotes: logged-in users
    SELECT u.email, u.id, NULL, jsonb_build_array('voted')
    FROM upvotes v
    JOIN users u ON u.id = v.user_id
    WHERE v.post_id = p_post_id AND u.email IS NOT NULL

    UNION ALL

    -- Upvotes: tracking_code (portal anonymous — email resolved via tracked_users if present)
    SELECT tu.email, NULL::UUID, v.tracking_code, jsonb_build_array('voted')
    FROM upvotes v
    JOIN posts p ON p.id = v.post_id
    JOIN tracked_users tu ON tu.user_identifier = v.tracking_code
      AND tu.organization_id = p.organization_id
    WHERE v.post_id = p_post_id AND v.tracking_code IS NOT NULL AND tu.email IS NOT NULL

    UNION ALL

    -- Upvotes: widget org_end_users
    SELECT oeu.email, oeu.user_id, NULL, jsonb_build_array('voted')
    FROM upvotes v
    JOIN org_end_users oeu ON oeu.id = v.org_end_user_id
    WHERE v.post_id = p_post_id AND oeu.email IS NOT NULL

    UNION ALL

    -- Upvotes: legacy external_users
    SELECT eu.email, NULL::UUID, NULL, jsonb_build_array('voted')
    FROM upvotes v
    JOIN external_users eu ON eu.id = v.external_user_id
    WHERE v.post_id = p_post_id AND eu.email IS NOT NULL AND v.org_end_user_id IS NULL

    UNION ALL

    -- Comments: logged-in users
    SELECT u.email, u.id, NULL, jsonb_build_array('commented')
    FROM comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.post_id = p_post_id AND u.email IS NOT NULL

    UNION ALL

    -- Comments: tracking_code
    SELECT tu.email, NULL::UUID, c.tracking_code, jsonb_build_array('commented')
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    JOIN tracked_users tu ON tu.user_identifier = c.tracking_code
      AND tu.organization_id = p.organization_id
    WHERE c.post_id = p_post_id AND c.tracking_code IS NOT NULL AND tu.email IS NOT NULL
  )
  SELECT
    lower(trim(i.em)) AS email,
    i.uid AS user_id,
    i.tc AS tracking_code,
    jsonb_agg(DISTINCT r) AS reasons
  FROM interested i
  CROSS JOIN LATERAL jsonb_array_elements_text(i.rs) AS r
  WHERE i.em IS NOT NULL AND trim(i.em) <> ''
  GROUP BY lower(trim(i.em)), i.uid, i.tc;
END;
$$;

GRANT EXECUTE ON FUNCTION get_interested_users_for_post(UUID) TO authenticated, service_role;

-- Legacy widgets: generate api_secret via Admin → Ensure Secret, or:
-- UPDATE widget_instances SET api_secret = 'wsec_' || encode(gen_random_bytes(32), 'hex') WHERE api_secret IS NULL;
