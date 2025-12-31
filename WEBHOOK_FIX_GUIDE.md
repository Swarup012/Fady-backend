# Stripe Webhook Configuration Guide

## Problem
After upgrading to Pro, the subscription status wasn't automatically updated in the database because webhooks weren't working.

## Root Cause
1. Checkout session completed successfully
2. Subscription created in Stripe
3. BUT webhook event wasn't processed by backend
4. Database remained at "free" plan

## Permanent Fix (3 Steps)

### Step 1: Verify Webhook Secret Matches
```bash
# Your current webhook secret in .env:
STRIPE_WEBHOOK_SECRET=whsec_55a8cfd74488417ec9beff6e061c68b0bd596d71ec4c3b53bd073a61204fabcc

# This should match the Stripe CLI output when you run:
docker run --rm -it --network host stripe/stripe-cli listen --forward-to http://localhost:3000/api/stripe/webhook
```

### Step 2: Restart Backend After Secret Change
```bash
cd /home/swarup/HDD/Fady/Fady-backend
docker-compose restart
```

### Step 3: Keep Stripe CLI Running
The Stripe CLI MUST be running while testing. Check if it's running:
```bash
ps aux | grep stripe
```

If not running, start it:
```bash
docker run --rm -it --network host stripe/stripe-cli \
  listen --forward-to http://localhost:3000/api/stripe/webhook
```

## Test the Fix

### Test 1: Trigger Test Event
```bash
# In Stripe CLI terminal, run:
stripe trigger checkout.session.completed
```

Then check if event was saved:
```bash
cd /home/swarup/HDD/Fady/Fady-backend
node check-stripe-events-detailed.js
```

You should see the event in the database!

### Test 2: Complete Real Checkout
1. Go to your app
2. Click "Upgrade to Pro"
3. Complete checkout with test card: `4242 4242 4242 4242`
4. After success, check database:
```bash
node check-current-subscription.js
```

Should show `subscription_status: trialing` and `subscription_plan: pro`

## Production Setup (Before Going Live)

### Configure Stripe Dashboard Webhook
1. Go to: https://dashboard.stripe.com/test/webhooks
2. Click "+ Add endpoint"
3. Enter URL: `https://YOUR_DOMAIN.com/api/stripe/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the "Signing secret" (starts with `whsec_`)
6. Update production `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_PRODUCTION_SECRET_HERE
   ```

## Troubleshooting

### Webhook Not Firing?
```bash
# Check backend logs
docker logs fady-backend-dev --tail 100 | grep webhook

# Should see: "🎣 Webhook received: checkout.session.completed"
```

### Events Not Saving to Database?
```bash
# Check if stripe_events table exists
node check-stripe-events-detailed.js

# If empty, webhooks aren't reaching the save step
# Check for errors in backend logs
```

### Subscription Status Not Updating?
```bash
# Manual sync (temporary fix):
node sync-stripe-subscription.js

# But fix webhooks so this is automatic!
```

## Why This Matters

**WITHOUT webhooks:**
- User pays → nothing happens in database
- You have to manually sync every subscription
- Subscription changes (cancellations, renewals) don't update
- You can't trust your own database!

**WITH webhooks working:**
- User pays → database updates automatically ✅
- Cancellations → database updates immediately ✅
- Trial ends → status changes automatically ✅
- You can trust your subscription data ✅

## Current Status

✅ Webhook endpoint exists and works
✅ Webhook handler code is correct
✅ Checkout session has correct metadata
✅ Subscription exists in Stripe
❌ Events not being saved to database (FIX THIS!)

## Next Steps

1. Ensure Stripe CLI is running
2. Trigger test event
3. Verify event appears in database
4. If successful, webhooks are working!
5. Test with real checkout
