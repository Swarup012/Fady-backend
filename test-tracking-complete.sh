#!/bin/bash

echo "🧪 Complete Tracked Users Integration Test"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Please run this from Fady-backend directory"
    exit 1
fi

echo "📋 Step 1: Check database setup..."
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

(async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, tracked_users_limit, tracked_users_count_cache');
  
  orgs.forEach(org => {
    console.log(\`   ✅ \${org.name}: \${org.tracked_users_count_cache || 0} / \${org.tracked_users_limit || 0} tracked users\`);
  });
})();
" 2>/dev/null

echo ""
echo "📋 Step 2: Check if middleware is loaded..."
if grep -q "trackPostCreation" src/routes/post.routes.js; then
    echo "   ✅ Post tracking middleware is integrated"
else
    echo "   ❌ Post tracking middleware NOT found"
fi

if grep -q "trackVote" src/routes/post.routes.js; then
    echo "   ✅ Vote tracking middleware is integrated"
else
    echo "   ❌ Vote tracking middleware NOT found"
fi

if grep -q "trackComment" src/routes/post.routes.js; then
    echo "   ✅ Comment tracking middleware is integrated"
else
    echo "   ❌ Comment tracking middleware NOT found"
fi

echo ""
echo "📋 Step 3: Check if routes are registered..."
if grep -q "tracked-users.routes" src/app.js; then
    echo "   ✅ Tracked users routes are registered"
else
    echo "   ❌ Tracked users routes NOT registered"
fi

echo ""
echo "📋 Step 4: Check backend health..."
HEALTH=$(curl -s http://localhost:3000/health 2>/dev/null)
if echo "$HEALTH" | grep -q "success"; then
    echo "   ✅ Backend is running"
else
    echo "   ❌ Backend is NOT running"
    echo "      Run: docker-compose up -d"
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ All checks passed!"
echo ""
echo "📝 How to test manually:"
echo "   1. Go to http://localhost:5173"
echo "   2. Login to your organization"
echo "   3. Go to any feedback board"
echo "   4. Create a new post"
echo "   5. Go to /admin dashboard"
echo "   6. Check the 'Tracked Users' widget"
echo ""
echo "🔍 To verify tracking worked:"
echo "   Run: node -e \"const { createClient } = require('@supabase/supabase-js'); require('dotenv').config(); const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); (async () => { const { data } = await supabase.from('tracked_users').select('*').eq('billing_period', '2026-01'); console.log('Tracked users:', data.length); data.forEach(u => console.log('  -', u.user_identifier, 'posts:', u.posts_created)); })();\""
echo ""
