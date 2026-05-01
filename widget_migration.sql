-- Widget Instances Table
-- Stores embeddable widget configurations for organizations
CREATE TABLE IF NOT EXISTS widget_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL DEFAULT 'Default Widget',
  api_key VARCHAR(255) UNIQUE NOT NULL,
  default_board_id UUID REFERENCES boards(id) ON DELETE SET NULL,
  allowed_domains TEXT[] DEFAULT '{}',
  branding JSONB DEFAULT '{}',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on api_key for fast lookups
CREATE INDEX IF NOT EXISTS idx_widget_instances_api_key ON widget_instances(api_key);
CREATE INDEX IF NOT EXISTS idx_widget_instances_organization_id ON widget_instances(organization_id);

-- External Users Table
-- Stores users from external apps who interact with widgets
CREATE TABLE IF NOT EXISTS external_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_instance_id UUID NOT NULL REFERENCES widget_instances(id) ON DELETE CASCADE,
  external_user_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  name VARCHAR(255),
  context JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(widget_instance_id, external_user_id)
);

-- Create indexes for external users
CREATE INDEX IF NOT EXISTS idx_external_users_widget_instance_id ON external_users(widget_instance_id);
CREATE INDEX IF NOT EXISTS idx_external_users_external_user_id ON external_users(external_user_id);

-- Feedback Votes Table (for widget users)
-- Stores votes from external users on posts
CREATE TABLE IF NOT EXISTS upvotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  external_user_id UUID REFERENCES external_users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, external_user_id)
);

-- Create indexes for upvotes
CREATE INDEX IF NOT EXISTS idx_upvotes_post_id ON upvotes(post_id);
CREATE INDEX IF NOT EXISTS idx_upvotes_external_user_id ON upvotes(external_user_id);

-- Add external_user_id column to posts table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'external_user_id'
  ) THEN
    ALTER TABLE posts ADD COLUMN external_user_id UUID REFERENCES external_users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index on external_user_id in posts table
CREATE INDEX IF NOT EXISTS idx_posts_external_user_id ON posts(external_user_id);

-- Function to increment vote count
CREATE OR REPLACE FUNCTION increment_vote_count(post_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE posts
  SET upvotes = upvotes + 1
  WHERE id = post_id;
END;
$$ LANGUAGE plpgsql;

-- Function to decrement vote count
CREATE OR REPLACE FUNCTION decrement_vote_count(post_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE posts
  SET upvotes = GREATEST(upvotes - 1, 0)
  WHERE id = post_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_widget_instances_updated_at ON widget_instances;
CREATE TRIGGER update_widget_instances_updated_at
  BEFORE UPDATE ON widget_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_external_users_updated_at ON external_users;
CREATE TRIGGER update_external_users_updated_at
  BEFORE UPDATE ON external_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies

-- Enable RLS on widget_instances
ALTER TABLE widget_instances ENABLE ROW LEVEL SECURITY;

-- Policy: Organization members can view their organization's widgets
CREATE POLICY "Organization members can view widgets"
  ON widget_instances FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Organization owners/admins can create widgets
CREATE POLICY "Organization owners/admins can create widgets"
  ON widget_instances FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Policy: Organization owners/admins can update widgets
CREATE POLICY "Organization owners/admins can update widgets"
  ON widget_instances FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Policy: Organization owners/admins can delete widgets
CREATE POLICY "Organization owners/admins can delete widgets"
  ON widget_instances FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Enable RLS on external_users
ALTER TABLE external_users ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can manage external users (for widget API)
CREATE POLICY "Service role can manage external users"
  ON external_users FOR ALL
  USING (auth.role() = 'service_role');

-- Enable RLS on upvotes
ALTER TABLE upvotes ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can manage upvotes (for widget API)
CREATE POLICY "Service role can manage upvotes"
  ON upvotes FOR ALL
  USING (auth.role() = 'service_role');

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE widget_instances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE external_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE upvotes TO authenticated;
GRANT EXECUTE ON FUNCTION increment_vote_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_vote_count(UUID) TO authenticated;
