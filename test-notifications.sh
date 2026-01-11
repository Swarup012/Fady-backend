#!/bin/bash

# Test Notification System
echo "🧪 Testing Notification System"
echo "================================"

# Get access token (replace with your actual token)
TOKEN="YOUR_ACCESS_TOKEN_HERE"
BASE_URL="http://localhost:3000/api"

echo ""
echo "1️⃣ Testing notification preferences..."
curl -s -X GET "$BASE_URL/notifications/preferences" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

echo ""
echo "2️⃣ Testing queue status..."
curl -s -X GET "$BASE_URL/notifications/internal/queue-status" | jq '.'

echo ""
echo "3️⃣ Manually processing queue..."
curl -s -X POST "$BASE_URL/notifications/internal/process-queue" | jq '.'

echo ""
echo "✅ Test complete!"
