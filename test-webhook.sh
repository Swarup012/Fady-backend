#!/bin/bash
# Test webhook with Stripe CLI

echo "🧪 Testing Stripe Webhook..."
echo ""
echo "This will trigger a test event and check if it's saved to database"
echo ""

# Check if Stripe CLI is running
if ! pgrep -f "stripe listen" > /dev/null; then
    echo "❌ Stripe CLI is not running!"
    echo ""
    echo "Please start it in another terminal:"
    echo "  ./start-stripe-cli.sh"
    exit 1
fi

echo "✅ Stripe CLI is running"
echo ""

# Trigger a test event
echo "🚀 Triggering test checkout.session.completed event..."
echo ""

# Note: You'll need to run this inside the Stripe CLI container
# Or use the stripe CLI installed on your system
echo "Run this command in your Stripe CLI terminal:"
echo ""
echo "  stripe trigger checkout.session.completed"
echo ""
echo "Then run: node check-stripe-events-detailed.js"
echo ""
echo "You should see the event in the database!"
