#!/bin/bash
# Start Stripe CLI for webhook forwarding

echo "🚀 Starting Stripe CLI webhook forwarding..."
echo ""
echo "This will forward Stripe webhook events to your local backend"
echo "Keep this terminal open while developing!"
echo ""

# Forward webhooks to local backend
docker run --rm -it --network host stripe/stripe-cli \
  listen \
  --forward-to http://localhost:3000/api/stripe/webhook

# Note: The webhook secret (whsec_...) will be shown when this starts
# Copy it and add to your .env file as STRIPE_WEBHOOK_SECRET
