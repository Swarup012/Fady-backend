# 🐳 Docker Paddle Integration Testing Guide

Your Paddle integration is configured and ready to test with Docker!

---

## ✅ Current Setup

```bash
✅ PADDLE_VENDOR_ID: 45674
✅ PADDLE_API_KEY: pdl_sdbx_apikey_... (configured)
✅ PADDLE_STARTER_PLAN_ID_MONTHLY: pri_01keznsq9qbqh8ws8f7wq9mebc
✅ PADDLE_STARTER_PLAN_ID_YEARLY: pri_01kezp4t4d87xwbxcj3j5v0t40
✅ PADDLE_WEBHOOK_SECRET: ntfset_01kf01gprezev0tzt9jk21ns3m
```

**Docker Configuration:**
- ✅ Backend container: `fady-backend` (port 3000)
- ✅ Redis container: `fady-redis` (port 6379)
- ✅ Environment variables loaded via `.env` file
- ✅ Health checks configured

---

## 🚀 Quick Start

### **1. Start Your Docker Containers**

```bash
cd Fady-backend

# Start all services (backend + redis)
docker-compose up -d

# Check if containers are running
docker-compose ps

# View logs
docker-compose logs -f backend
```

### **2. Verify Backend is Running**

```bash
# Check health endpoint
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","timestamp":"..."}
```

---

## 🧪 Test Your Paddle Integration

### **Option 1: Quick Verification (Inside Docker)**

```bash
# Run setup verification inside Docker container
docker-compose exec backend node tmp_rovodev_verify-paddle-setup.js

# Expected: 5/5 checks passed ✅
```

### **Option 2: Test Webhook Endpoint**

```bash
# Test webhook with valid signature (from your host machine)
node tmp_rovodev_test-paddle-webhook.js

# Or run it inside Docker
docker-compose exec backend node tmp_rovodev_test-paddle-webhook.js
```

### **Option 3: Full Test Suite**

```bash
# Run all tests inside Docker
docker-compose exec backend bash tmp_rovodev_run-all-paddle-tests.sh
```

---

## 🌐 Paddle Webhook URL

### **For Local Development with ngrok:**

```bash
# Terminal 1: Your Docker containers are already running
docker-compose up -d

# Terminal 2: Start ngrok tunnel
ngrok http 3000

# You'll get a URL like: https://abc123.ngrok.io
# Your Paddle webhook URL is:
https://abc123.ngrok.io/api/paddle/webhook
```

**Configure in Paddle Dashboard:**
1. Go to: https://vendors.paddle.com/
2. Developer Tools → Webhooks
3. Add URL: `https://abc123.ngrok.io/api/paddle/webhook`
4. The secret is already in your `.env` ✅

### **For Production Deployment:**

```
https://your-production-domain.com/api/paddle/webhook
```

Replace with your actual domain (Render, Railway, AWS, etc.)

---

## 🔍 Debug & Monitor

### **View Backend Logs**
```bash
# Follow logs in real-time
docker-compose logs -f backend

# View last 100 lines
docker-compose logs --tail=100 backend

# Search for Paddle webhook events
docker-compose logs backend | grep -i paddle
```

### **Check Webhook Calls**
```bash
# Watch for incoming webhooks
docker-compose logs -f backend | grep "Paddle Webhook received"
```

### **Test Manual Webhook Call**
```bash
# Send test webhook to your Docker container
curl -X POST http://localhost:3000/api/paddle/webhook \
  -H "Content-Type: application/json" \
  -H "x-paddle-signature: test_signature" \
  -d '{
    "alert_name": "subscription_created",
    "event_id": "evt_test_123",
    "subscription_id": "sub_test_123"
  }'

# Expected: 401 Unauthorized (signature verification working!)
```

---

## 🛠️ Common Docker Commands

### **Restart Services**
```bash
# Restart backend only
docker-compose restart backend

# Restart all services
docker-compose restart

# Rebuild and restart (after code changes)
docker-compose up -d --build
```

### **View Environment Variables**
```bash
# Check if Paddle env vars are loaded
docker-compose exec backend env | grep PADDLE
```

### **Access Container Shell**
```bash
# Open bash in backend container
docker-compose exec backend sh

# Then run commands inside:
node tmp_rovodev_verify-paddle-setup.js
```

### **Stop Services**
```bash
# Stop all containers
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

---

## 📋 Testing Checklist

- [x] Environment variables configured in `.env`
- [x] Docker containers running
- [ ] Backend health check passing
- [ ] Webhook endpoint accessible at `/api/paddle/webhook`
- [ ] ngrok tunnel (for local testing) or production URL
- [ ] Webhook URL configured in Paddle Dashboard
- [ ] Test webhook with sample event
- [ ] Monitor logs for webhook events

---

## 🎯 Next Steps

### **1. Test Webhook Locally with ngrok**
```bash
# Start ngrok
ngrok http 3000

# Add ngrok URL to Paddle Dashboard
# Send test event from Paddle Dashboard
# Check Docker logs: docker-compose logs -f backend
```

### **2. Test Checkout Flow**
```bash
# Create a test checkout session (replace YOUR_TOKEN with actual auth token)
curl -X POST http://localhost:3000/api/stripe/create-checkout-session \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "plan": "starter",
    "billingCycle": "monthly",
    "skipTrial": false,
    "successUrl": "http://localhost:3000/success",
    "cancelUrl": "http://localhost:3000/cancel"
  }'
```

### **3. Deploy to Production**
- Push code to your repository
- Deploy Docker containers to production
- Update Paddle webhook URL to production domain
- Monitor production logs

---

## 🚨 Troubleshooting

### **Issue: Container won't start**
```bash
# Check logs
docker-compose logs backend

# Check if port 3000 is already in use
lsof -i :3000

# Force rebuild
docker-compose up -d --build --force-recreate
```

### **Issue: Environment variables not loading**
```bash
# Verify .env file exists
ls -la .env

# Check env vars in container
docker-compose exec backend env | grep PADDLE

# Restart after .env changes
docker-compose restart backend
```

### **Issue: Webhook signature verification failing**
```bash
# Check if PADDLE_WEBHOOK_SECRET is loaded
docker-compose exec backend env | grep PADDLE_WEBHOOK_SECRET

# View webhook logs
docker-compose logs backend | grep -i "webhook"
```

---

## 💡 Pro Tips

1. **Keep containers running** during development - no need to restart for most changes
2. **Use `docker-compose logs -f`** to monitor real-time webhook events
3. **ngrok is perfect** for local testing before production
4. **Test webhook security** by sending invalid signatures (should get 401)
5. **Check Redis connection** if you see caching issues: `docker-compose exec redis redis-cli ping`

---

## 🎉 You're All Set!

Your Paddle integration is running in Docker and ready to accept:
- ✅ Checkout requests at: `http://localhost:3000/api/stripe/create-checkout-session`
- ✅ Webhooks at: `http://localhost:3000/api/paddle/webhook`

**Start Docker and test:**
```bash
docker-compose up -d
docker-compose logs -f backend
```
