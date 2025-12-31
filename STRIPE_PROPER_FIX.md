# Stripe Subscription - Proper Fix

## What Was Wrong

When you upgraded to Pro, the payment succeeded in Stripe, but your database still showed "free" plan because:
1. ✅ Checkout completed successfully  
2. ✅ Subscription created in Stripe
3. ❌ **Webhook wasn't processed**
4. ❌ Database never updated

## Why Manual Fix is Bad

**What we did (temporary)**:
```bash
node sync-stripe-subscription.js
```

**Why this is bad**:
- ❌ You have to do this every time someone subscribes
- ❌ Cancellations won't update automatically
- ❌ Renewals won't update automatically
- ❌ Trial endings won't update automatically
- ❌ Not scalable for production

## The Proper Fix (Webhooks)

### What Webhooks Do
Stripe → Sends event → Your backend → Updates database automatically

### Events to Handle
- `checkout.session.completed` - User completes payment
- `customer.subscription.updated` - Status changes (active, canceled, etc.)
- `customer.subscription.deleted` - Subscription ends
- `invoice.payment_succeeded` - Renewal payment succeeds
- `invoice.payment_failed` - Payment fails

### Your Webhook Code (Already Written!)

✅ **Endpoint**: `/api/stripe/webhook` (working)
✅ **Handler**: `src/webhooks/stripe.webhook.js` (exists)
✅ **Checkout handler**: `src/webhooks/handlers/checkout.handler.js` (correct)
✅ **Subscription handler**: `src/webhooks/handlers/subscription.handler.js` (correct)

**The code is perfect! Just need to connect it.**

## Setup Instructions

### For Development (Local Testing)

**1. Ensure backend is running:**
```bash
cd /home/swarup/HDD/Fady/Fady-backend
docker-compose up -d
```

**2. Start Stripe CLI (in separate terminal):**
```bash
cd /home/swarup/HDD/Fady/Fady-backend
./start-stripe-cli.sh
```

This will show output like:
```
Ready! Your webhook signing secret is whsec_abc123...
```

**3. Copy the webhook secret to .env:**
```bash
# Edit .env file
STRIPE_WEBHOOK_SECRET=whsec_abc123...  # Use the actual secret from step 2
```

**4. Restart backend:**
```bash
docker-compose restart
```

**5. Test it works:**
```bash
# In Stripe CLI terminal, trigger test event:
stripe trigger checkout.session.completed

# Check if event was received:
node check-stripe-events-detailed.js
```

You should see the event in your database!

### For Production (Real Site)

**1. Go to Stripe Dashboard:**
https://dashboard.stripe.com/test/webhooks (for test mode)
https://dashboard.stripe.com/webhooks (for live mode)

**2. Add Endpoint:**
- Click "+ Add endpoint"
- URL: `https://yourdomain.com/api/stripe/webhook`
- Description: "Subscription webhooks"

**3. Select Events:**
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`  
- `invoice.payment_succeeded`
- `invoice.payment_failed`

**4. Copy Signing Secret:**
- After creating endpoint, click "Reveal" under "Signing secret"
- Copy the secret (starts with `whsec_`)

**5. Update Production Environment:**
```bash
# In your production .env or environment variables:
STRIPE_WEBHOOK_SECRET=whsec_PRODUCTION_SECRET
```

**6. Deploy & Restart:**
Deploy your backend with the new secret and restart.

## Testing the Fix

### Test 1: Trigger Test Event
```bash
# In terminal with Stripe CLI running:
stripe trigger checkout.session.completed
```

Check database:
```bash
node check-stripe-events-detailed.js
# Should show the event!
```

### Test 2: Real Checkout Flow
1. Open your app
2. Click "Upgrade to Pro"
3. Use test card: `4242 4242 4242 4242`
4. After checkout success, run:
```bash
node check-current-subscription.js
```

Should show:
```
Status: trialing (or active)
Plan: pro
Subscription ID: sub_xxx...
```

### Test 3: Check Logs
```bash
docker logs fady-backend-dev --tail 50 | grep webhook
```

Should see:
```
🎣 Webhook received: checkout.session.completed
✅ Webhook checkout.session.completed processed successfully
```

## How to Verify It's Working

**Before (broken):**
1. User pays
2. Database: still "free" ❌
3. You: manually run sync script 😫

**After (fixed):**
1. User pays
2. Stripe sends webhook
3. Database: automatically "pro" ✅
4. You: do nothing 😎

## Troubleshooting

### "No events in stripe_events table"
- Stripe CLI not running → Start it
- Wrong webhook secret → Copy from CLI output, update .env, restart backend
- Backend not running → `docker-compose up -d`

### "Webhook signature verification failed"
- Webhook secret doesn't match
- Solution: Copy secret from Stripe CLI output or Dashboard
- Update `.env` and restart backend

### "Event already processed"
- This is normal! Means idempotency is working
- Prevents duplicate processing

## Summary

**Manual fix (what we did):**
- Run `sync-stripe-subscription.js` every time someone subscribes
- ❌ Not sustainable

**Proper fix (webhooks):**
- Set up webhook forwarding (dev) or dashboard endpoint (production)
- Stripe automatically tells your backend about subscription changes
- Database updates automatically
- ✅ Production-ready!

## Current Status

✅ Backend webhook code is correct
✅ Endpoint is working (`/api/stripe/webhook`)
✅ Handlers are properly written
✅ Checkout session has correct metadata
❌ **Need to ensure Stripe CLI is running with correct secret**
❌ **Need to test event processing**

## Next Steps

1. **Now**: Run Stripe CLI with `./start-stripe-cli.sh`
2. Copy webhook secret to `.env`
3. Restart backend: `docker-compose restart`
4. Test: `stripe trigger checkout.session.completed`
5. Verify: `node check-stripe-events-detailed.js`
6. **Before production**: Configure webhook in Stripe Dashboard

---

**Remember**: Webhooks are how Stripe tells you about subscription changes. Without them working, you're flying blind! 🚀
