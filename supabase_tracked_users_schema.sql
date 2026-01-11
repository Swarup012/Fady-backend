-- =====================================================
-- TRACKED USERS FEATURE - DATABASE SCHEMA
-- =====================================================
-- Purpose: Track unique users who interact with feedback
-- for usage-based pricing and analytics
-- =====================================================

-- 1. CREATE TRACKED USERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS tracked_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Organization & User Identity
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_identifier VARCHAR(255) NOT NULL, -- email or user_id
  identification_method VARCHAR(20) NOT NULL DEFAULT 'email', -- 'email' or 'user_id'
  
  -- User Info (for display in admin dashboard)
  display_name VARCHAR(255),
  email VARCHAR(255),
  
  -- Billing Period (format: "YYYY-MM" e.g., "2026-01")
  billing_period VARCHAR(7) NOT NULL,
  
  -- Tracking Metadata
  first_tracked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP NOT NULL DEFAULT NOW(),
  total_actions INTEGER DEFAULT 1, -- Total actions this period
  
  -- Action Breakdown (for analytics)
  posts_created INTEGER DEFAULT 0,
  votes_cast INTEGER DEFAULT 0,
  comments_made INTEGER DEFAULT 0,
  
  -- Additional metadata (JSON for flexibility)
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- UNIQUE CONSTRAINT: One record per user per org per billing period
  CONSTRAINT unique_tracked_user_per_period 
    UNIQUE(organization_id, user_identifier, billing_period)
);

-- 2. CREATE INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_tracked_users_org_period 
  ON tracked_users(organization_id, billing_period);

CREATE INDEX IF NOT EXISTS idx_tracked_users_identifier 
  ON tracked_users(user_identifier);

CREATE INDEX IF NOT EXISTS idx_tracked_users_period 
  ON tracked_users(billing_period);

CREATE INDEX IF NOT EXISTS idx_tracked_users_last_activity 
  ON tracked_users(last_activity_at);

CREATE INDEX IF NOT EXISTS idx_tracked_users_org_email 
  ON tracked_users(organization_id, email) 
  WHERE email IS NOT NULL;

-- 3. UPDATE ORGANIZATIONS TABLE
-- =====================================================
-- Add tracked user limit and cache columns
-- NOTE: tracked_users_limit is NULL by default - uses plan-based limits from middleware
--       Free tier: 20, Pro tier: Unlimited (from plan-limits.middleware.js)
ALTER TABLE organizations 
  ADD COLUMN IF NOT EXISTS tracked_users_limit INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tracked_users_count_cache INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracked_users_last_reset DATE,
  ADD COLUMN IF NOT EXISTS tracked_users_overage_allowed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracked_users_notification_sent_at TIMESTAMP;

-- 4. CREATE TRACKED USER ACTIONS TABLE (Optional - for detailed analytics)
-- =====================================================
CREATE TABLE IF NOT EXISTS tracked_user_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracked_user_id UUID NOT NULL REFERENCES tracked_users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Action details
  action_type VARCHAR(50) NOT NULL, -- 'create_post', 'vote', 'comment'
  resource_type VARCHAR(50), -- 'post', 'comment', 'board'
  resource_id UUID, -- ID of the resource
  
  -- Context
  session_id VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for actions table
CREATE INDEX IF NOT EXISTS idx_tracked_actions_user 
  ON tracked_user_actions(tracked_user_id);

CREATE INDEX IF NOT EXISTS idx_tracked_actions_org 
  ON tracked_user_actions(organization_id);

CREATE INDEX IF NOT EXISTS idx_tracked_actions_created 
  ON tracked_user_actions(created_at);

-- 5. CREATE FUNCTION TO UPDATE UPDATED_AT
-- =====================================================
CREATE OR REPLACE FUNCTION update_tracked_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. CREATE TRIGGER FOR AUTO-UPDATE
-- =====================================================
DROP TRIGGER IF EXISTS trigger_update_tracked_users_updated_at ON tracked_users;
CREATE TRIGGER trigger_update_tracked_users_updated_at
  BEFORE UPDATE ON tracked_users
  FOR EACH ROW
  EXECUTE FUNCTION update_tracked_users_updated_at();

-- 7. CREATE FUNCTION TO GET CURRENT BILLING PERIOD
-- =====================================================
CREATE OR REPLACE FUNCTION get_current_billing_period()
RETURNS VARCHAR(7) AS $$
BEGIN
  RETURN TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM');
END;
$$ LANGUAGE plpgsql;

-- 8. CREATE FUNCTION TO COUNT TRACKED USERS
-- =====================================================
CREATE OR REPLACE FUNCTION count_tracked_users(
  p_organization_id UUID,
  p_billing_period VARCHAR(7)
)
RETURNS INTEGER AS $$
DECLARE
  user_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count
  FROM tracked_users
  WHERE organization_id = p_organization_id
    AND billing_period = p_billing_period;
  
  RETURN user_count;
END;
$$ LANGUAGE plpgsql;

-- 9. ENABLE ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE tracked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_user_actions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see tracked users from their organization
CREATE POLICY tracked_users_org_isolation ON tracked_users
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM organization_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY tracked_actions_org_isolation ON tracked_user_actions
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM organization_members 
      WHERE user_id = auth.uid()
    )
  );

-- 10. GRANT PERMISSIONS
-- =====================================================
-- Grant service role full access (for backend operations)
GRANT ALL ON tracked_users TO service_role;
GRANT ALL ON tracked_user_actions TO service_role;

-- Grant authenticated users read access (through RLS)
GRANT SELECT ON tracked_users TO authenticated;
GRANT SELECT ON tracked_user_actions TO authenticated;

-- 11. ADD COMMENTS FOR DOCUMENTATION
-- =====================================================
COMMENT ON TABLE tracked_users IS 'Tracks unique users who interact with feedback for usage-based pricing';
COMMENT ON COLUMN tracked_users.user_identifier IS 'Email address or user_id used to identify unique users';
COMMENT ON COLUMN tracked_users.billing_period IS 'Format: YYYY-MM. Resets monthly for billing purposes';
COMMENT ON COLUMN tracked_users.total_actions IS 'Total number of actions (posts + votes + comments) this billing period';

COMMENT ON TABLE tracked_user_actions IS 'Detailed log of all tracked user actions for analytics';

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Next steps:
-- 1. Run this SQL in Supabase SQL Editor
-- 2. Verify tables created: SELECT * FROM tracked_users LIMIT 1;
-- 3. Implement backend tracking service
-- =====================================================
