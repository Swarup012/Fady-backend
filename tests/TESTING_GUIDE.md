# 🧪 TESTING GUIDE FOR PRODUCTION READINESS

## Quick Start

```bash
# 1. Install dependencies (if needed)
cd /home/swarup/HDD/Fady/Fady-backend
npm install

# 2. Make sure backend is running
docker ps | grep fady-backend

# 3. Run comprehensive test suite
node tests/comprehensive-test-suite.js
```

## 📋 What Gets Tested

### ✅ Automated Tests (Instant)
1. **Authentication & Setup** - User registration, login, profile
2. **Board Limits** - Create 3 boards (free limit), block 4th board
3. **Post Limits** - Create 5 posts per board (free limit), block 6th
4. **Team Member Limits** - Invite up to 3 members, block 4th
5. **Tracked Users** - Monitor voter/commenter tracking
6. **API Error Handling** - Invalid data, SQL injection prevention
7. **Performance** - Concurrent requests, pagination
8. **Edge Cases** - Duplicate slugs, access control

### ⏰ Time-Dependent Tests (Manual)
9. **Trial Period (14 days)** - See Section A below
10. **Monthly Reset** - See Section B below
11. **Subscription Changes** - See Section C below
12. **Overage Billing** - See Section D below

---

## A. Testing 14-Day Trial (Without Waiting)

### Method 1: Database Time Manipulation

```bash
# Connect to your Supabase database
# Or use local postgres: psql -U postgres -d fady

# 1. Create a test subscription with trial
INSERT INTO organizations (id, name, subdomain, slug, subscription_plan, subscription_status, trial_ends_at)
VALUES (
  gen_random_uuid(),
  'Trial Test Org',
  'trial-test',
  'trial-test',
  'starter',
  'trialing',
  NOW() + INTERVAL '14 days'
);

# 2. Simulate trial ending (set trial_ends_at to past)
UPDATE organizations 
SET trial_ends_at = NOW() - INTERVAL '1 day'
WHERE slug = 'trial-test';

# 3. Run trial expiration cron job manually
node src/services/cron/trial-expiration-cron.js

# 4. Verify subscription downgraded to free
SELECT subscription_plan, subscription_status, trial_ends_at 
FROM organizations 
WHERE slug = 'trial-test';
```

### Method 2: Stripe Test Clock (Recommended)

```bash
# 1. Go to Stripe Dashboard → Developers → Test Clocks
# 2. Create a new test clock
# 3. Fast-forward time by 14 days
# 4. Observe webhook events firing automatically
```

---

## B. Testing Monthly Reset (Without Waiting)

### Simulate Last Month

```sql
-- 1. Set last_reset_at to 35 days ago
UPDATE organizations 
SET last_reset_at = NOW() - INTERVAL '35 days'
WHERE id = 'YOUR_ORG_ID';

-- 2. Add some test usage data
UPDATE organizations 
SET tracked_users_current_month = 150
WHERE id = 'YOUR_ORG_ID';
```

```bash
# 3. Run monthly reset cron manually
node src/services/cron/monthly-reset-cron.js

# 4. Verify reset happened
# Check logs for: "🔄 Monthly reset successful"
```

### Test Reset Logic

```bash
# Check what will be reset
SELECT 
  id,
  name,
  tracked_users_current_month,
  last_reset_at,
  NOW() - last_reset_at AS days_since_reset
FROM organizations
WHERE NOW() - last_reset_at > INTERVAL '30 days';
```

---

## C. Testing Subscription Changes

### Test Free → Starter Upgrade

```bash
# 1. Create test user on free plan (use test suite)
node tests/comprehensive-test-suite.js

# 2. Get Stripe checkout URL from logs
# Or manually create checkout session:
curl -X POST http://localhost:3000/api/stripe/create-checkout-session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "plan": "starter",
    "billingCycle": "monthly",
    "skipTrial": false
  }'

# 3. Use Stripe test card to complete checkout
# Card: 4242 4242 4242 4242
# Exp: Any future date
# CVC: Any 3 digits

# 4. Webhook will automatically:
#    - Update subscription_plan to 'starter'
#    - Set subscription_status to 'trialing'
#    - Set trial_ends_at to +14 days
#    - Grant unlimited boards/posts

# 5. Verify upgrade
curl http://localhost:3000/api/users/me/usage \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should show:
# - plan: "starter"
# - boards.limit: "unlimited"
# - posts.limit: "unlimited"
```

### Test Starter → Free Downgrade

```sql
-- 1. Simulate subscription cancellation
UPDATE organizations 
SET 
  subscription_plan = 'free',
  subscription_status = 'canceled',
  stripe_subscription_id = NULL
WHERE id = 'YOUR_ORG_ID';

-- 2. Verify limits restored
SELECT * FROM organizations WHERE id = 'YOUR_ORG_ID';
```

```bash
# 3. Try creating 4th board (should fail)
curl -X POST http://localhost:3000/api/boards \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "4th Board Test",
    "slug": "4th-board-test",
    "description": "Should fail on free plan"
  }'

# Expected: 403 error with "BOARD_LIMIT_REACHED"
```

---

## D. Testing Overage Billing

### Simulate 200 Tracked Users

```sql
-- 1. Insert test tracked users beyond limit
-- Free plan: 20 limit
-- Starter plan: 125 base + 25 grace = 150 before overage

-- Set up: Update to starter plan
UPDATE organizations 
SET 
  subscription_plan = 'starter',
  subscription_status = 'active',
  tracked_users_limit = 125
WHERE id = 'YOUR_ORG_ID';

-- 2. Simulate 200 tracked users
INSERT INTO tracked_users (organization_id, email, name)
SELECT 
  'YOUR_ORG_ID',
  'user' || generate_series(1, 200) || '@test.com',
  'User ' || generate_series(1, 200);

-- 3. Check current count
SELECT COUNT(*) FROM tracked_users 
WHERE organization_id = 'YOUR_ORG_ID';
-- Should show: 200

-- 4. Calculate overage
-- 200 - 150 (125 base + 25 grace) = 50 overage
-- 50 users = 1 block of 50 = $6 charge
```

```bash
# 5. Run metered billing cron
node src/services/cron/metered-billing-cron.js

# 6. Check Stripe dashboard for usage record
# Should show: 1 unit reported for metered price
# Expected charge: $6 at end of billing period
```

### Test Overage API

```bash
# Get overage status
curl http://localhost:3000/api/users/me/usage \
  -H "Authorization: Bearer YOUR_TOKEN"

# Response should show:
{
  "tracked_users": {
    "current": 200,
    "base_limit": 125,
    "grace_limit": 150,
    "overage": 50,
    "overage_blocks": 1,
    "overage_cost": 6.00
  }
}
```

---

## E. Stripe Webhook Testing

### Local Webhook Testing with Stripe CLI

```bash
# 1. Install Stripe CLI
# https://stripe.com/docs/stripe-cli

# 2. Login to Stripe
stripe login

# 3. Forward webhooks to local server
stripe listen --forward-to http://localhost:3000/api/stripe/webhook

# 4. Test specific webhook events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger invoice.payment_succeeded

# 5. Watch backend logs
docker logs -f fady-backend | grep "webhook"
```

### Manual Webhook Simulation (Without Stripe CLI)

```bash
# You can also manually call webhook handler with mock data
# Note: This bypasses signature verification

curl -X POST http://localhost:3000/api/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "customer.subscription.updated",
    "data": {
      "object": {
        "id": "sub_test_123",
        "customer": "cus_test_123",
        "status": "active",
        "metadata": {
          "organization_id": "YOUR_ORG_ID",
          "plan": "starter"
        }
      }
    }
  }'
```

---

## F. Performance Testing

### Load Test with Apache Bench

```bash
# Install apache2-utils
sudo apt-get install apache2-utils

# Test 100 concurrent requests
ab -n 100 -c 10 -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/boards

# Expected results:
# - Time per request: < 500ms
# - Failed requests: 0
# - Requests per second: > 20
```

### Memory Leak Test

```bash
# Monitor memory during load test
docker stats fady-backend

# Run load test for 5 minutes
for i in {1..300}; do
  curl http://localhost:3000/api/boards \
    -H "Authorization: Bearer YOUR_TOKEN" &
  sleep 1
done

# Memory should remain stable (not growing continuously)
```

---

## G. Security Testing

### Test SQL Injection Prevention

```bash
# Try SQL injection in various endpoints
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "board_id": "'"'"'; DROP TABLE posts; --",
    "title": "SQL Injection Test"
  }'

# Expected: 400 or 500 error, NOT data deletion
```

### Test XSS Prevention

```bash
# Try XSS in post title
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "board_id": "VALID_BOARD_ID",
    "title": "<script>alert(\"XSS\")</script>"
  }'

# Expected: Script should be escaped/sanitized in response
```

### Test Rate Limiting

```bash
# Send 100 rapid requests
for i in {1..100}; do
  curl http://localhost:3000/api/boards \
    -H "Authorization: Bearer YOUR_TOKEN"
done

# Expected: Some requests should return 429 (Too Many Requests)
```

---

## H. Database Integrity Testing

### Check Foreign Key Constraints

```sql
-- Test cascade deletes
-- 1. Create test board
INSERT INTO boards (name, slug, organization_id) 
VALUES ('Test Delete', 'test-delete', 'YOUR_ORG_ID');

-- 2. Create posts for board
INSERT INTO posts (board_id, title, user_id, organization_id)
SELECT id, 'Test Post ' || generate_series(1,5), 'USER_ID', 'YOUR_ORG_ID'
FROM boards WHERE slug = 'test-delete';

-- 3. Delete board
DELETE FROM boards WHERE slug = 'test-delete';

-- 4. Verify posts are also deleted (cascade)
SELECT COUNT(*) FROM posts WHERE board_id IN 
  (SELECT id FROM boards WHERE slug = 'test-delete');
-- Should show: 0
```

### Check RLS Policies

```sql
-- Test Row Level Security
-- 1. Try accessing another org's data (should fail)
SELECT * FROM boards WHERE organization_id != 'YOUR_ORG_ID';

-- 2. Should return empty or error based on RLS policies
```

---

## I. Complete Test Checklist

### Before Production Deploy

- [ ] All automated tests pass (`node tests/comprehensive-test-suite.js`)
- [ ] Trial period tested (Method 1 or 2)
- [ ] Monthly reset tested
- [ ] Free → Starter upgrade tested
- [ ] Starter → Free downgrade tested
- [ ] Overage billing tested with 200+ users
- [ ] All Stripe webhooks tested
- [ ] Load test passed (100+ concurrent requests)
- [ ] Memory leak test passed (5+ minutes)
- [ ] SQL injection test passed
- [ ] XSS prevention test passed
- [ ] Rate limiting working
- [ ] Database cascade deletes working
- [ ] RLS policies working
- [ ] All 12 test sections completed

### Production Checklist

- [ ] Environment variables set correctly
- [ ] Stripe webhook endpoint configured
- [ ] Database backups enabled
- [ ] Error monitoring setup (Sentry/etc)
- [ ] Rate limiting enabled
- [ ] SSL/HTTPS enabled
- [ ] CORS configured properly
- [ ] Docker images built with latest code
- [ ] Health check endpoint working
- [ ] Logs configured (CloudWatch/etc)

---

## J. Quick Commands Reference

```bash
# Run full test suite
node tests/comprehensive-test-suite.js

# Run cron jobs manually
node src/services/cron/trial-expiration-cron.js
node src/services/cron/monthly-reset-cron.js
node src/services/cron/metered-billing-cron.js

# Check backend logs
docker logs -f fady-backend

# Check database
psql -U postgres -d fady

# Restart backend
docker restart fady-backend

# Rebuild backend
cd Fady-backend && docker-compose build --no-cache backend

# Test webhook
stripe trigger checkout.session.completed

# Load test
ab -n 100 -c 10 http://localhost:3000/api/boards
```

---

## K. Troubleshooting

### Test failing with "Connection refused"
```bash
# Check backend is running
docker ps | grep fady-backend

# Start backend
cd Fady-backend && docker-compose up -d
```

### Test failing with "Invalid token"
```bash
# Token expires after 30 minutes
# Re-run: node tests/comprehensive-test-suite.js
# It will create fresh token
```

### Overage not calculating correctly
```sql
-- Verify organization settings
SELECT 
  subscription_plan,
  tracked_users_limit,
  tracked_users_current_month
FROM organizations 
WHERE id = 'YOUR_ORG_ID';

-- Recalculate manually
SELECT COUNT(*) FROM tracked_users 
WHERE organization_id = 'YOUR_ORG_ID';
```

### Webhooks not firing
```bash
# Check Stripe webhook endpoint
curl -X POST http://localhost:3000/api/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{"type": "ping"}'

# Should return 200 OK

# Check webhook signing secret
echo $STRIPE_WEBHOOK_SECRET
```

---

## L. Next Steps After All Tests Pass

1. **Deploy to Staging** - Test in production-like environment
2. **Run Tests Again** - On staging with real Stripe test mode
3. **Security Audit** - Use tools like OWASP ZAP
4. **Load Test** - With realistic user traffic simulation
5. **Monitor** - Set up logging and monitoring
6. **Go Live** 🚀

---

**📧 Need Help?**
- Check logs: `docker logs -f fady-backend`
- Database: `psql` or Supabase dashboard
- Stripe: Dashboard → Developers → Logs
