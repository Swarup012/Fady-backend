# 🔴 Redis Caching Setup Guide

This guide explains how to set up Redis caching for the Fady backend application, supporting both **Docker** (for development) and **Upstash** (for staging/production).

---

## 🎯 Overview

**Redis Environment Strategy:**

| Environment | Redis Setup | Use Case |
|-------------|------------|----------|
| **Development** | Docker (local) | Local development, testing |
| **Staging** | Upstash (free tier) | Testing in production-like environment |
| **Production** | Upstash (paid/free tier) | Live application |

---

## 📦 What's Cached?

### Phase 1: Quick Wins (Currently Implemented) ✅

1. **Board Lists** - `boards:org:{orgId}:role:{role}:jobrole:{jobRole}`
   - TTL: 1 hour (3600s)
   - Impact: 🚀🚀🚀🚀🚀
   - Invalidated on: board create/update/delete

2. **User Sessions** - `user:session:{userId}` (coming next)
   - TTL: 30 minutes (1800s)
   - Impact: 🚀🚀🚀🚀🚀

### Phase 2: Core Features (Next)

3. **Post Lists** - `posts:board:{slug}:{sort}:{page}`
   - TTL: 5 minutes (300s)
   - Impact: 🚀🚀🚀🚀

4. **Comments Tree** - `comments:post:{postId}:user:{userId}`
   - TTL: 5 minutes (300s)
   - Impact: 🚀🚀🚀🚀

5. **Post Details** - `post:{postId}`
   - TTL: 10 minutes (600s)
   - Impact: 🚀🚀🚀🚀

---

## 🐳 Option 1: Docker Redis (Development)

### Step 1: Start Redis Container

```bash
cd Fady-backend

# Start Redis with Docker Compose
docker-compose up -d

# Verify Redis is running
docker ps | grep fady-redis

# Test Redis connection
docker exec -it fady-redis redis-cli ping
# Should output: PONG
```

### Step 2: Configure Environment

Create or update `.env` file:

```env
# Redis Configuration (Development)
REDIS_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=  # Optional, leave empty for local dev
```

### Step 3: Start Backend Server

```bash
npm start
```

You should see:
```
🔴 Initializing Redis: Docker (local)
✅ Redis Docker connected successfully
🚀 Redis Docker ready to accept commands
🔴 Redis: Connected and ready
```

### Redis Commands (Development)

```bash
# Monitor Redis in real-time
docker exec -it fady-redis redis-cli MONITOR

# Check cache keys
docker exec -it fady-redis redis-cli KEYS "*"

# Get specific value
docker exec -it fady-redis redis-cli GET "boards:org:123"

# Check TTL
docker exec -it fady-redis redis-cli TTL "boards:org:123"

# Flush all cache (clear everything)
docker exec -it fady-redis redis-cli FLUSHALL

# Get Redis info
docker exec -it fady-redis redis-cli INFO stats

# Stop Redis
docker-compose down

# Stop and remove data
docker-compose down -v
```

---

## ☁️ Option 2: Upstash Redis (Staging/Production)

### Step 1: Create Upstash Account

1. Go to **https://upstash.com/**
2. Click **"Get Started"** or **"Sign Up"**
3. Sign in with **GitHub** (no credit card required!)
4. Verify your email if prompted

### Step 2: Create Redis Database

1. After logging in, click **"Create Database"**
2. Fill in the details:
   - **Name:** `fady-cache` (or any name you prefer)
   - **Type:** Regional (free tier)
   - **Region:** Choose closest to your users/server
     - US East (N. Virginia) - `us-east-1`
     - Europe (Ireland) - `eu-west-1`
     - Asia Pacific (Tokyo) - `ap-northeast-1`
   - **Primary Region:** Same as above
   - **Read Regions:** None (free tier)
3. Click **"Create"**

### Step 3: Get Connection Credentials

After database creation, you'll see:

1. **REST API** section (this is what we use):
   - `UPSTASH_REDIS_REST_URL` - Copy this
   - `UPSTASH_REDIS_REST_TOKEN` - Copy this

Example:
```
UPSTASH_REDIS_REST_URL=https://us1-example-12345.upstash.io
UPSTASH_REDIS_REST_TOKEN=AbCdEf1234567890...
```

### Step 4: Configure Environment

Update `.env` for **staging/production**:

```env
# Redis Configuration (Upstash - Staging/Production)
REDIS_ENV=production
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here
```

### Step 5: Deploy & Test

```bash
# Start server (production mode)
npm start
```

You should see:
```
🔴 Initializing Redis: Upstash (cloud)
✅ Upstash Redis initialized
🔴 Redis: Connected and ready
```

### Upstash Dashboard Features

1. **CLI Tab:**
   - Run Redis commands directly in browser
   - Example: `GET boards:org:123`

2. **Data Browser:**
   - View all keys
   - See TTL, size, type
   - Delete keys manually

3. **Metrics:**
   - Daily requests count
   - Storage usage
   - Hit/miss ratio (if available)

4. **Logs:**
   - View recent commands
   - Debug issues

---

## 🔧 Environment Variables Reference

### Development (Docker)

```env
REDIS_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### Staging (Upstash)

```env
REDIS_ENV=staging
UPSTASH_REDIS_REST_URL=https://your-staging-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-staging-token
```

### Production (Upstash)

```env
REDIS_ENV=production
UPSTASH_REDIS_REST_URL=https://your-production-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-production-token
```

---

## 📊 Cache Key Naming Convention

All cache keys follow this pattern:

```
{resource}:{identifier}:{sub-resource}
```

### Examples:

| Resource | Cache Key | TTL |
|----------|-----------|-----|
| Board list | `boards:org:123:role:admin:jobrole:none` | 1h |
| User session | `user:session:abc-123` | 30m |
| Post list | `posts:board:feature-requests:latest:1` | 5m |
| Comments | `comments:post:456:user:abc` | 5m |
| Post details | `post:789` | 10m |
| Upvote status | `upvote:user123:post456` | 15m |

---

## 🚀 Testing Cache

### 1. Test Board List Caching

```bash
# First request - should hit database
curl http://localhost:3000/api/boards

# Check Redis (Docker)
docker exec -it fady-redis redis-cli KEYS "boards:*"

# Second request - should hit cache (faster!)
curl http://localhost:3000/api/boards

# Check logs - you should see "✅ Cache HIT"
```

### 2. Test Cache Invalidation

```bash
# Create a new board
curl -X POST http://localhost:3000/api/boards \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Board","description":"Testing cache"}'

# Check Redis - old cache should be deleted
docker exec -it fady-redis redis-cli KEYS "boards:*"

# Get boards again - should fetch fresh data
curl http://localhost:3000/api/boards
```

### 3. Test TTL Expiration

```bash
# Set a test key with 10 second TTL
docker exec -it fady-redis redis-cli SET "test:key" "value" EX 10

# Check immediately
docker exec -it fady-redis redis-cli GET "test:key"
# Output: "value"

# Wait 10 seconds...

# Check again
docker exec -it fady-redis redis-cli GET "test:key"
# Output: (nil)
```

---

## 📈 Monitoring

### Check Cache Hit Rate (Development)

```bash
# Get Redis stats
docker exec -it fady-redis redis-cli INFO stats

# Look for:
# - keyspace_hits
# - keyspace_misses
# Hit Rate = hits / (hits + misses) * 100
```

### Upstash Dashboard

1. Go to https://console.upstash.com/
2. Select your database
3. View **"Metrics"** tab for:
   - Daily command count
   - Storage usage
   - Performance graphs

---

## 🐛 Troubleshooting

### Issue: "Redis connection failed"

**Solution:**
```bash
# Check if Redis is running (Docker)
docker ps | grep fady-redis

# If not running, start it
docker-compose up -d

# Check logs
docker logs fady-redis
```

### Issue: "Upstash connection failed"

**Solution:**
1. Verify environment variables are set correctly
2. Check URL doesn't have trailing slash
3. Verify token is complete (they're long!)
4. Test connection in Upstash CLI tab

### Issue: "Cache not working"

**Solution:**
```bash
# Test Redis connection
docker exec -it fady-redis redis-cli ping

# Check if cache is enabled in logs
# Look for: "✅ Cache enabled"

# Verify keys are being created
docker exec -it fady-redis redis-cli KEYS "*"
```

### Issue: "Running out of memory"

**Solution:**
```bash
# Check memory usage
docker exec -it fady-redis redis-cli INFO memory

# Current config: 256MB max with LRU eviction
# Keys will be automatically evicted when full

# Manually clear cache if needed
docker exec -it fady-redis redis-cli FLUSHALL
```

---

## 💰 Upstash Free Tier Limits

### What You Get Free:

- ✅ **10,000 commands/day**
- ✅ **256 MB storage**
- ✅ **Unlimited databases**
- ✅ **Global edge network**
- ✅ **TLS encryption**
- ✅ **No credit card required**
- ✅ **Never expires**

### Estimated Usage (100 daily active users):

| Operation | Commands/Day |
|-----------|--------------|
| Load boards | 100 |
| Load posts | 500 |
| Load comments | 1,000 |
| Check upvotes | 2,000 |
| Session checks | 1,000 |
| Misc operations | 1,000 |
| **TOTAL** | **~5,600** ✅ |

**Result:** Well within 10,000 free limit!

### When to Upgrade:

- 200+ daily active users
- Heavy traffic days
- Real-time features

**Cost after free:** $0.20 per 100k commands = $2/month for 1M commands

---

## 🔄 Cache Invalidation Rules

| Event | Cache Keys Deleted |
|-------|-------------------|
| Board created | `boards:org:{orgId}:*` |
| Board updated | `boards:org:{orgId}:*`, `board:{boardId}`, `board:slug:{slug}` |
| Board deleted | `boards:org:{orgId}:*`, `board:{boardId}`, `board:slug:{slug}` |
| Post created | `posts:board:{slug}:*` (coming) |
| Post updated | `posts:board:{slug}:*`, `post:{postId}` (coming) |
| Comment added | `comments:post:{postId}:*` (coming) |

---

## 📚 Useful Redis Commands

```bash
# Get all keys
KEYS *

# Get value
GET key

# Set value with TTL
SET key "value" EX 3600

# Delete key
DEL key

# Check TTL remaining
TTL key

# Check if key exists
EXISTS key

# Get all hash fields
HGETALL key

# Increment counter
INCR counter:views

# Flush all data
FLUSHALL

# Get info
INFO stats
INFO memory
INFO keyspace
```

---

## 🎯 Next Steps

### Phase 1 (Completed) ✅
- [x] Set up Docker Redis
- [x] Install Redis clients
- [x] Implement board list caching
- [x] Add cache invalidation

### Phase 2 (Coming Next)
- [ ] Cache user sessions
- [ ] Cache post lists
- [ ] Cache comments tree
- [ ] Add monitoring dashboard

### Phase 3 (Future)
- [ ] Cache upvote status
- [ ] Cache aggregated stats
- [ ] Add cache warming
- [ ] Implement rate limiting

---

## 📞 Support

### Issues?

1. Check Docker is running: `docker ps`
2. Check Redis logs: `docker logs fady-redis`
3. Test connection: `docker exec -it fady-redis redis-cli ping`
4. View server logs for cache hits/misses

### Upstash Support

- Documentation: https://docs.upstash.com/redis
- Discord: https://discord.gg/upstash
- Email: support@upstash.com

---

## 🎉 Success Metrics

### Current (Without Cache):
- Board list load: ~300-400ms
- Database queries: 100% on every request

### Target (With Cache):
- Board list load: ~10-20ms ⚡️
- Database queries: -70-80% reduction 📉
- Cache hit rate: >80% 🎯

---

**Ready to experience 24x faster responses?** 🚀

Let's cache everything! 🔴
