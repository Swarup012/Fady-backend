-- =============================================
-- PADDLE MIGRATION SCRIPT (for Fady-backend)
-- =============================================
-- This script adds Paddle support while keeping Stripe logic intact for migration/testing.

-- 1. Add Paddle columns to organizations table
ALTER TABLE organizations 
  ADD COLUMN IF NOT EXISTS paddle_customer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS paddle_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS paddle_plan_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(32) DEFAULT 'stripe';

-- 2. Add Paddle columns to overage_charges table
ALTER TABLE overage_charges 
  ADD COLUMN IF NOT EXISTS paddle_invoice_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS paddle_charge_id VARCHAR(255);

-- 3. Add Paddle columns to subscription_history table
ALTER TABLE subscription_history 
  ADD COLUMN IF NOT EXISTS paddle_event_id VARCHAR(255);

-- 4. Create paddle_events table for webhook/audit logging
CREATE TABLE IF NOT EXISTS paddle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  organization_id UUID REFERENCES organizations(id),
  processed BOOLEAN DEFAULT TRUE,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paddle_events_event_id 
  ON paddle_events(event_id);
CREATE INDEX IF NOT EXISTS idx_paddle_events_organization 
  ON paddle_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_paddle_events_type 
  ON paddle_events(event_type);

-- 5. (Optional) Add comments for documentation
COMMENT ON COLUMN organizations.paddle_customer_id IS 'Paddle Customer ID - Links organization to Paddle customer record';
COMMENT ON COLUMN organizations.paddle_subscription_id IS 'Paddle Subscription ID - Active subscription in Paddle';
COMMENT ON COLUMN organizations.paddle_plan_id IS 'Paddle Plan ID';
COMMENT ON COLUMN organizations.billing_provider IS 'Billing provider: stripe or paddle';
COMMENT ON COLUMN overage_charges.paddle_invoice_id IS 'Paddle Invoice ID for overage charge';
COMMENT ON COLUMN overage_charges.paddle_charge_id IS 'Paddle Charge ID for overage charge';
COMMENT ON COLUMN subscription_history.paddle_event_id IS 'Paddle Event ID for this subscription change';
COMMENT ON TABLE paddle_events IS 'Stores all processed Paddle webhook events for idempotency and audit';

-- =============================================
-- END OF SCRIPT
-- =============================================
