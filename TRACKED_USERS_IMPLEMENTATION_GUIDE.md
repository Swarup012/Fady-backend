# Tracked Users Feature - Implementation Guide

## 📋 What's Been Created

### 1. Database Schema
**File:** `supabase_tracked_users_schema.sql`
- ✅ `tracked_users` table - Stores unique users per billing period
- ✅ `tracked_user_actions` table - Detailed action logs (optional)
- ✅ Organizations table columns added (limits, cache, notifications)
- ✅ Indexes for performance
- ✅ RLS policies for security
- ✅ Helper functions for counting

### 2. Backend Service
**File:** `src/services/tracked-users.service.js`
- ✅ Main tracking function (`trackUser`)
- ✅ Limit checking
- ✅ Cache management
- ✅ Usage statistics
- ✅ Monthly reset logic
- ✅ Notification triggers

### 3. Middleware
**File:** `src/middleware/tracking.middleware.js`
- ✅ Non-blocking tracking (fire-and-forget)
- ✅ Post creation tracking
- ✅ Vote tracking
- ✅ Comment tracking
- ✅ "On behalf of" customer support

### 4. API Routes
**File:** `src/routes/tracked-users.routes.js`
- ✅ GET `/api/tracked-users/count` - Current count
- ✅ GET `/api/tracked-users/usage` - Dashboard stats
- ✅ GET `/api/tracked-users/list` - Paginated list
- ✅ GET `/api/tracked-users/history` - Past months
- ✅ GET `/api/tracked-users/export` - CSV export

### 5. Controller
**File:** `src/controllers/tracked-users.controller.js`
- ✅ Handles all API requests
- ✅ Permission checks
- ✅ CSV generation

---

## 🚀 Next Steps to Complete Implementation

### Step 1: Run Database Migration

```bash
# Copy the SQL file to your Supabase project
# Go to Supabase Dashboard → SQL Editor
# Paste the contents of supabase_tracked_users_schema.sql
# Click "Run"
```

**Verify:**
```sql
SELECT * FROM tracked_users LIMIT 1;
SELECT * FROM organizations LIMIT 1;
-- Should see new columns: tracked_users_limit, tracked_users_count_cache, etc.
```

### Step 2: Register Routes in app.js

Add this to your `src/app.js`:

```javascript
// After other routes
const trackedUsersRoutes = require('./routes/tracked-users.routes');
app.use('/api/tracked-users', authenticate, injectOrganization, trackedUsersRoutes);
```

### Step 3: Integrate Tracking Middleware

#### Option A: Add to Existing Routes

**For Post Creation** - Update `src/routes/post.routes.js`:
```javascript
const { trackPostCreation } = require('../middleware/tracking.middleware');

// Add tracking middleware AFTER authentication
router.post('/', 
  authenticate, 
  injectOrganization, 
  trackPostCreation,  // ← ADD THIS
  postController.createPost
);
```

**For Voting** - Update `src/routes/vote.routes.js` (or wherever votes are):
```javascript
const { trackVote } = require('../middleware/tracking.middleware');

router.post('/vote', 
  authenticate, 
  injectOrganization, 
  trackVote,  // ← ADD THIS
  voteController.castVote
);
```

**For Comments** - Update `src/routes/comment.routes.js`:
```javascript
const { trackComment } = require('../middleware/tracking.middleware');

router.post('/', 
  authenticate, 
  injectOrganization, 
  trackComment,  // ← ADD THIS
  commentController.createComment
);
```

#### Option B: Track Directly in Controllers

If you prefer to track in controllers instead of middleware:

```javascript
// In post.controller.js
const { trackUserDirectly } = require('../middleware/tracking.middleware');

createPost: async (req, res) => {
  // ... create post logic ...
  
  // Track user (non-blocking)
  trackUserDirectly(
    organizationId, 
    req.user.email, 
    'create_post',
    { name: req.user.name, email: req.user.email }
  );
  
  return res.json({ success: true, post });
}
```

### Step 4: Set Initial Plan Limits

Run this SQL to set default limits based on plans:

```sql
-- Update existing organizations with default limits
UPDATE organizations
SET tracked_users_limit = CASE
  WHEN subscription_plan = 'free' THEN 100
  WHEN subscription_plan = 'starter' THEN 1000
  WHEN subscription_plan = 'professional' THEN 5000
  WHEN subscription_plan = 'business' THEN 999999
  ELSE 100
END
WHERE tracked_users_limit IS NULL OR tracked_users_limit = 100;
```

### Step 5: Set Up Cron Job for Monthly Reset

**Option A: Using Node-Cron (if running continuously)**

Create `src/jobs/tracking-reset.job.js`:
```javascript
const cron = require('node-cron');
const trackedUsersService = require('../services/tracked-users.service');

// Run at 00:00 UTC on 1st of each month
cron.schedule('0 0 1 * *', async () => {
  console.log('Running monthly tracking reset...');
  try {
    await trackedUsersService.resetMonthlyTracking();
    console.log('✅ Monthly reset complete');
  } catch (error) {
    console.error('❌ Monthly reset failed:', error);
  }
});
```

Then import in `src/app.js`:
```javascript
require('./jobs/tracking-reset.job');
```

**Option B: Using External Cron (Recommended)**

Set up a cron job to hit an endpoint:
```bash
# In your server's crontab
0 0 1 * * curl -X POST http://your-backend.com/api/admin/reset-tracking
```

Create admin endpoint:
```javascript
// In admin routes
router.post('/reset-tracking', authenticate, async (req, res) => {
  // Check admin permissions
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  
  await trackedUsersService.resetMonthlyTracking();
  return res.json({ success: true });
});
```

### Step 6: Add to Plan Limits Middleware

Update `src/middleware/plan-limits.middleware.js` to include tracked users:

```javascript
async getUsageStats(req, res) {
  // ... existing code ...
  
  // Add tracked users usage
  const trackedUsersStats = await trackedUsersService.getUsageStats(organizationId);
  
  return res.json({
    // ... existing usage ...
    tracked_users: {
      current: trackedUsersStats.count,
      limit: trackedUsersStats.limit,
      percentage: trackedUsersStats.usage_percent
    }
  });
}
```

### Step 7: Test the Implementation

#### Test 1: Create Post
```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Post", "content": "Testing tracking"}'

# Check tracking
curl http://localhost:3000/api/tracked-users/count \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Test 2: Vote
```bash
curl -X POST http://localhost:3000/api/posts/POST_ID/vote \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check if user count incremented or actions updated
```

#### Test 3: Verify Database
```sql
SELECT * FROM tracked_users 
WHERE organization_id = 'YOUR_ORG_ID' 
  AND billing_period = '2026-01';
```

---

## 📊 Frontend Integration

### 1. Usage Widget Component

Create `src/components/TrackedUsersWidget.tsx`:

```typescript
import { useEffect, useState } from 'react';

export function TrackedUsersWidget() {
  const [usage, setUsage] = useState(null);
  
  useEffect(() => {
    fetch('/api/tracked-users/usage', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setUsage(data.data));
  }, []);
  
  if (!usage) return null;
  
  const percent = usage.usage_percent;
  const statusColor = percent >= 90 ? 'red' : percent >= 80 ? 'yellow' : 'green';
  
  return (
    <div className="p-4 border rounded">
      <h3>Tracked Users ({usage.current_period})</h3>
      <div className="text-2xl font-bold">
        {usage.count} / {usage.limit}
      </div>
      <div className="w-full bg-gray-200 rounded h-2 mt-2">
        <div 
          className={`bg-${statusColor}-500 h-2 rounded`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm mt-2">
        {usage.days_remaining} days remaining
      </p>
    </div>
  );
}
```

### 2. Tracked Users Page

Create `/admin/tracked-users` page showing the list of tracked users.

### 3. Add to Dashboard

Show usage widget in main admin dashboard.

---

## ⚙️ Configuration

### Environment Variables (Optional)

Add to `.env`:
```bash
# Tracked Users Configuration
TRACKED_USERS_ENABLED=true
TRACKED_USERS_LOG_ACTIONS=true  # Store detailed action logs
TRACKED_USERS_NOTIFY_AT_80=true
TRACKED_USERS_NOTIFY_AT_90=true
TRACKED_USERS_NOTIFY_AT_100=true
```

### Plan Limits Configuration

Update `src/config/plans.config.js`:
```javascript
const PLAN_LIMITS = {
  free: {
    boards: 3,
    posts: 20,
    members: 3,
    tracked_users: 100  // ← ADD THIS
  },
  starter: {
    boards: 10,
    posts: 500,
    members: 10,
    tracked_users: 1000  // ← ADD THIS
  },
  professional: {
    boards: 30,
    posts: 2000,
    members: 30,
    tracked_users: 5000  // ← ADD THIS
  },
  business: {
    boards: -1,
    posts: 10000,
    members: -1,
    tracked_users: -1  // ← Unlimited
  }
};
```

---

## 🧪 Testing Checklist

- [ ] Database migration runs successfully
- [ ] Post creation tracks user
- [ ] Voting tracks user
- [ ] Commenting tracks user
- [ ] Same user doesn't get double-counted in same period
- [ ] Cache increments correctly
- [ ] Limit checking works (blocks at 100% if hard limit)
- [ ] Notifications trigger at 80%, 90%, 100%
- [ ] API endpoints return correct data
- [ ] CSV export works
- [ ] Monthly reset works (test with manual trigger)
- [ ] Frontend widget displays correctly

---

## 🚨 Important Notes

### Performance
- ✅ Tracking is **non-blocking** - won't slow down user actions
- ✅ Uses database cache to avoid expensive COUNT queries
- ✅ Indexes created for fast lookups

### Accuracy
- ✅ Uses UNIQUE constraint to prevent duplicates
- ✅ Billing period stored as simple string ("2026-01")
- ✅ Recalculate function available if cache drifts

### Privacy
- ✅ Only stores email/user_id and action counts
- ✅ No IP addresses or device fingerprints
- ✅ RLS policies prevent cross-org access

---

## 📈 Monitoring

### Logs to Watch
```
✅ Tracked new user <email> for org <id>
✅ Updated tracked user <id> - action: vote
📧 Sending approaching_limit_80 notification to org <id>
⚠️ Tracking limit reached for org <id>
🔄 Starting monthly tracking reset...
```

### Metrics to Track
- Total tracked users per org
- Actions per user
- Limit violations
- Cache accuracy (actual count vs cached)
- Tracking failures

---

## 🎯 Next Steps

1. **Run database migration** ✅
2. **Register routes** in app.js
3. **Add tracking middleware** to post/vote/comment routes
4. **Test thoroughly** with your development environment
5. **Set up cron job** for monthly reset
6. **Build frontend components** for dashboard
7. **Monitor in production** for first month

---

Need help with any step? Let me know! 🚀
