#!/bin/bash

# Rate Limit Test Script
# Tests post creation rate limit (10 posts/hour for external users)

echo "🧪 Testing Rate Limiting - Post Creation"
echo "=========================================="
echo ""
echo "This will make 12 POST requests to test the rate limit"
echo "Expected: First 10 succeed, requests 11-12 fail with 429"
echo ""

# You need to replace these with actual values
TOKEN="YOUR_ACCESS_TOKEN_HERE"
BOARD_SLUG="faddy"
API_URL="http://localhost:3000"

# Check if TOKEN is set
if [ "$TOKEN" = "YOUR_ACCESS_TOKEN_HERE" ]; then
    echo "❌ ERROR: Please set your access token in the script"
    echo ""
    echo "To get your token:"
    echo "1. Login to http://localhost:5173"
    echo "2. Open browser DevTools (F12) → Application → Local Storage"
    echo "3. Copy the 'access_token' value"
    echo "4. Edit this script and replace YOUR_ACCESS_TOKEN_HERE"
    exit 1
fi

# Counter for successful and failed requests
success_count=0
rate_limited_count=0

# Make 12 requests
for i in {1..12}; do
    echo "Request #$i:"
    
    response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$API_URL/api/boards/$BOARD_SLUG/posts" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"Rate limit test post #$i\",\"description\":\"Testing rate limiting\"}")
    
    # Extract HTTP code
    http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d':' -f2)
    body=$(echo "$response" | sed '/HTTP_CODE:/d')
    
    if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
        echo "  ✅ Success (HTTP $http_code)"
        success_count=$((success_count + 1))
    elif [ "$http_code" = "429" ]; then
        echo "  🚫 Rate Limited (HTTP $http_code)"
        # Parse and show the error message
        message=$(echo "$body" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
        echo "  📝 Message: $message"
        rate_limited_count=$((rate_limited_count + 1))
    else
        echo "  ❌ Failed (HTTP $http_code)"
        echo "  Response: $body"
    fi
    
    # Small delay between requests
    sleep 0.2
done

echo ""
echo "=========================================="
echo "📊 Results:"
echo "   ✅ Successful: $success_count"
echo "   🚫 Rate Limited: $rate_limited_count"
echo "   Expected: 10 successful, 2 rate limited"
echo ""

if [ $success_count -eq 10 ] && [ $rate_limited_count -eq 2 ]; then
    echo "✅ PASS: Rate limiting working correctly!"
else
    echo "⚠️ UNEXPECTED: Results don't match expected behavior"
fi
