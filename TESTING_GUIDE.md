# 🧪 TESTING GUIDE - Production Ready Checklist

## Quick Start

```bash
# Run comprehensive test suite
cd /home/swarup/HDD/Fady/Fady-backend
node test-suite.js
```

## 📋 Testing Checklist

### ✅ Automated Tests (Run with test-suite.js)
- [x] User registration & login
- [x] Free tier board limits (3 boards)
- [x] Free tier post limits (5 posts per board)
- [x] Free tier team member limits (3 members)
- [x] Usage statistics API
- [x] Basic CRUD operations

### ⏰ Time-Dependent Features (Manual SQL)

#### 1. Test 14-Day Trial
```sql
-- Set trial for your organization
UPDATE organizations SET 
  subscription_plan = 'starter',
  subscription_status = 'trialing',
  trial_end_date = NOW() + INTERVAL '14 days',
  current_period_start = NOW(),
  current_period_end = NOW() + INTERVAL '14 days'
WHERE id = 'YOUR_ORG_ID';

-- Verify unlimited boards work
-- Try creating 4+ boards (should succeed)

-- Test trial ending soon (3 days left)
UPDATE organizations SET 
  trial_end_date = NOW() + INTERVAL '3 days'
WHERE id = 'YOUR_ORG_ID';

-- Test trial expired
UPDATE organizations SET 
  trial_end_date = NOW() - INTERVAL '1 day',
  subscription_status = 'free'
WHERE id = 'YOUR_ORG_ID';
```

#### 2. Test Active Subscription
```sql
-- Set active starter subscription
UPDATE organizations SET 
  subscription_plan = 'starter',
  subscription_status = 'active',
  trial_end_date = NULL,
  stripe_subscription_id = 'sub_test123',
  stripe_customer_id = 'cus_test123',
  current_period_start = NOW(),
  current_period_end = NOW() + INTERVAL '1 month'
WHERE id = 'YOUR_ORG_ID';

-- Verify:
-- - Unlimited boards ✓
-- - Unlimited posts ✓
-- - 5 team members ✓
-- - 125+ tracked users ✓
```

#### 3. Test Tracked Users Overage
```sql
-- Simulate 175 tracked users (50 overage)
UPDATE organizations SET 
  tracked_users = 175,
  tracked_users_limit = 125
WHERE id = 'YOUR_ORG_ID';

-- Check overage calculation
-- Overage: 175 - 125 - 25 (grace) = 25 users
-- Cost: 25 / 50 = 0.5 blocks = $3.00

-- Get usage with overage
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/tracked-users/usage
```

#### 4. Test Monthly Reset
```sql
-- Simulate previous month
UPDATE organizations SET 
  current_period_start = NOW() - INTERVAL '1 month',
  current_period_end = NOW(),
  tracked_users = 200
WHERE id = 'YOUR_ORG_ID';

-- Trigger manual reset
curl http://localhost:3000/api/cron/monthly-reset

-- Verify tracked_users reset to 0
SELECT tracked_users, current_period_start 
FROM organizations 
WHERE id = 'YOUR_ORG_ID';
```

### 🎯 Stripe Webhook Testing

#### Setup Stripe CLI
```bash
# Install Stripe CLI
# macOS: brew install stripe/stripe-cli/stripe
# Linux: Download from https://github.com/stripe/stripe-cli/releases

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

#### Test Webhook Events
```bash
# 1. Test checkout completed (trial started)
stripe trigger checkout.session.completed

# 2. Test trial ending (3 days warning)
stripe trigger customer.subscription.trial_will_end

# 3. Test payment succeeded
stripe trigger invoice.payment_succeeded

# 4. Test payment failed
stripe trigger invoice.payment_failed

# 5. Test subscription cancelled
stripe trigger customer.subscription.deleted

# 6. Test subscription updated
stripe trigger customer.subscription.updated
```

### 🔍 Manual Testing Scenarios

#### Scenario 1: New User Journey
1. Register new user → Creates free org
2. Create 3 boards → Should succeed
3. Try 4th board → Should show upgrade dialog
4. Create 5 posts per board → Should succeed
5. Try 6th post → Should show upgrade dialog

#### Scenario 2: Trial User Journey
1. Start 14-day trial (use SQL above)
2. Create 10+ boards → Should succeed
3. Create 100+ posts → Should succeed
4. Wait 3 days (or simulate) → Should see trial ending warning
5. Trial expires → Revert to free limits

#### Scenario 3: Paid User Journey
1. Set active subscription (use SQL above)
2. Create unlimited boards/posts → Should succeed
3. Add 5 team members → Should succeed
4. Reach 175 tracked users → Calculate overage
5. Check billing dashboard → Should show $6 overage

#### Scenario 4: Subscription Cancellation
1. Set active subscription
2. Cancel subscription (via Stripe webhook)
3. Access until period end → Should still work
4. After period end → Revert to free limits

### 📊 Production Readiness Checklist

#### Backend
- [ ] All API endpoints tested
- [ ] Plan limits enforced correctly
- [ ] Stripe webhooks working
- [ ] Monthly reset cron job scheduled
- [ ] Error handling for all scenarios
- [ ] Logs readable and useful
- [ ] Database indexes optimized
- [ ] Environment variables secured

#### Frontend
- [ ] Upgrade dialogs show correctly
- [ ] Usage indicators accurate
- [ ] Trial countdown displays
- [ ] Billing page functional
- [ ] Checkout flow completes
- [ ] Cancel flow works
- [ ] Mobile responsive
- [ ] Dark mode works

#### Security
- [ ] API authentication required
- [ ] RLS policies active
- [ ] Stripe webhook signature verified
- [ ] SQL injection protected
- [ ] XSS protection enabled
- [ ] CORS configured correctly

#### Monitoring
- [ ] Error tracking setup (Sentry)
- [ ] Usage analytics tracking
- [ ] Server monitoring (CPU, memory)
- [ ] Database query performance
- [ ] Stripe dashboard monitored

### 🚀 Quick Test Commands

```bash
# 1. Test backend health
curl http://localhost:3000/health

# 2. Test user registration
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test@123","name":"Test User"}'

# 3. Test usage API
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/users/me/usage

# 4. Test board creation
curl -X POST http://localhost:3000/api/boards \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Board","description":"Test","color":"#6366f1","icon":"Lightbulb"}'

# 5. Check backend logs
docker logs fady-backend --tail 100

# 6. Check backend logs (follow)
docker logs fady-backend -f | grep -E "Board limit|limit reached|✅|🚫"
```

### 📈 Load Testing (Optional)

```bash
# Install Artillery
npm install -g artillery

# Create test config (artillery.yml)
# Run load test
artillery run artillery-config.yml
```

### 🐛 Common Issues & Solutions

#### Issue: Upgrade dialog not showing
- Check browser console for errors
- Verify API returns `upgrade_required: true`
- Check frontend error handling

#### Issue: Trial not activating
- Verify Stripe webhook received
- Check database subscription_status
- Review backend logs for webhook errors

#### Issue: Monthly reset not working
- Check cron job is scheduled
- Verify server timezone is UTC
- Test manual trigger: `curl /api/cron/monthly-reset`

#### Issue: Tracked users not counting
- Verify RLS policies allow tracking
- Check tracked_users table for entries
- Review post/comment/vote creation

### 📝 Before Production Deployment

1. **Run full test suite**: `node test-suite.js`
2. **Test all SQL scenarios** (trial, active, overage, reset)
3. **Test Stripe webhooks** with Stripe CLI
4. **Manual UI testing** (all upgrade flows)
5. **Check error logs** for any warnings
6. **Verify Stripe is in live mode** (not test mode)
7. **Set up monitoring** (error tracking, uptime)
8. **Backup database** before going live
9. **Test rollback procedure**
10. **Document any known issues**

### 🎯 Success Criteria

- ✅ All automated tests pass
- ✅ Free tier limits enforced (3 boards, 5 posts, 3 members)
- ✅ Trial works correctly (14 days)
- ✅ Paid subscription enables unlimited features
- ✅ Overage billing calculates correctly
- ✅ Monthly reset works
- ✅ Upgrade dialogs show at right time
- ✅ No console errors in production
- ✅ Stripe webhooks process successfully
- ✅ All payment flows complete

## Need Help?

Check logs:
- Backend: `docker logs fady-backend`
- Frontend: Browser DevTools Console
- Database: Supabase Dashboard → Logs
- Stripe: Stripe Dashboard → Developers → Webhooks

Good luck! 🚀
