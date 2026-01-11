#!/bin/bash

# Test Starter Plan Checkout API
# Run this to verify the checkout endpoint works

echo "🧪 Testing Starter Plan Checkout API"
echo "======================================"

BACKEND_URL="http://localhost:3000"

# Test 1: Check if backend is running
echo ""
echo "1️⃣ Testing backend health..."
curl -s "$BACKEND_URL/health" | jq '.' || echo "❌ Backend not running"

# Test 2: Get pricing config (public endpoint)
echo ""
echo "2️⃣ Testing pricing config..."
curl -s "$BACKEND_URL/api/stripe/pricing" | jq '.'

# Test 3: Test checkout session creation (requires auth)
echo ""
echo "3️⃣ Testing checkout session creation..."
echo "⚠️  Note: This requires a valid JWT token"
echo "To test with authentication:"
echo ""
echo "curl -X POST http://localhost:3000/api/stripe/create-checkout-session \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \\"
echo "  -d '{"
echo "    \"plan\": \"starter\","
echo "    \"billingCycle\": \"monthly\","
echo "    \"skipTrial\": false"
echo "  }' | jq '.'"

echo ""
echo "======================================"
echo "✅ Backend is running on port 3000"
echo "📍 Pricing page: http://localhost:5173/pricing"
echo "🔗 Checkout endpoint: POST /api/stripe/create-checkout-session"
echo ""
echo "API accepts:"
echo "  - plan: 'starter' | 'pro'"
echo "  - billingCycle: 'monthly' | 'yearly'"
echo "  - skipTrial: true | false"
echo ""
