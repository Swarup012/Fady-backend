const app = require('./src/app');
const config = require('./src/config/env.config');
const { initializeRedis, testRedisConnection, closeRedis } = require('./src/config/redis.config');
const { initializeSocket, closeSocket } = require('./src/socket/socket.config');
const { validateStripeConfig } = require('./src/config/stripe.config');
const { initializeScheduler, stopScheduler } = require('./src/jobs/scheduler');
const http = require('http');

const PORT = config.port;

// Initialize Redis before starting server
initializeRedis();

// Create HTTP server (needed for Socket.io)
const server = http.createServer(app);

// Initialize Socket.io
initializeSocket(server);

// Store scheduled jobs for cleanup
let scheduledJobs = null;

server.listen(PORT, async () => {
  console.log('=================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${config.nodeEnv}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Auth API: http://localhost:${PORT}/api/auth`);
  
  // Test Redis connection
  const redisOk = await testRedisConnection();
  if (redisOk) {
    console.log('🔴 Redis: Connected and ready');
  } else {
    console.log('⚠️  Redis: Not available (running without cache)');
  }
  
  console.log('🔌 Socket.io: Ready for real-time connections');
  
  // Validate Stripe configuration
  try {
    await validateStripeConfig();
    console.log('💳 Stripe: Ready for payments');
  } catch (error) {
    console.log('⚠️  Stripe: Not configured (payments disabled)');
  }
  
  // Initialize cron jobs
  try {
    scheduledJobs = initializeScheduler();
    console.log('🕐 Cron jobs: Initialized successfully');
  } catch (error) {
    console.error('⚠️  Cron jobs: Failed to initialize:', error.message);
  }
  
  console.log('=================================');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  if (scheduledJobs) stopScheduler(scheduledJobs);
  await closeSocket();
  await closeRedis();
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  if (scheduledJobs) stopScheduler(scheduledJobs);
  await closeSocket();
  await closeRedis();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
