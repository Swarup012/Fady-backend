-- ============================================================
-- Migration: Add organization_job_roles table
-- Purpose: Replace hardcoded JOB_ROLES with per-org custom roles
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Create the table
CREATE TABLE IF NOT EXISTS organization_job_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key           TEXT NOT NULL,          -- immutable after creation, snake_case slugified
  icon          TEXT NOT NULL DEFAULT 'User',  -- Lucide icon name
  is_deletable  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, key)
);

-- 2. Index for fast per-org lookups
CREATE INDEX IF NOT EXISTS idx_org_job_roles_org_id
  ON organization_job_roles(organization_id);

-- ============================================================
-- 3. Seed DEFAULT roles for ALL existing organizations
--    (new orgs get seeded in organizationService.createOrganization)
-- ============================================================
DO $$
DECLARE
  org RECORD;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    -- Skip if already seeded (idempotent)
    IF NOT EXISTS (
      SELECT 1 FROM organization_job_roles
      WHERE organization_id = org.id
    ) THEN
      INSERT INTO organization_job_roles (organization_id, name, key, icon, is_deletable) VALUES
        (org.id, 'Founder / CEO',    'founder',          'Rocket',      true),
        (org.id, 'Product Manager',  'product_manager',  'Briefcase',   true),
        (org.id, 'Developer',        'developer',        'Code',        true),
        (org.id, 'Designer',         'designer',         'Palette',     true),
        (org.id, 'Marketer',         'marketer',         'TrendingUp',  true),
        (org.id, 'Other',            'other',            'UserCircle',  false);  -- 'other' is NOT deletable
    END IF;
  END LOOP;
END $$;

-- 3. Add job_role column to organization_invitations
ALTER TABLE organization_invitations 
ADD COLUMN IF NOT EXISTS job_role TEXT DEFAULT 'other';
