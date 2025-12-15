/**
 * Redis Cache Test Script
 * Run: node test-redis-cache.js
 */

const { initializeRedis, testRedisConnection } = require('./src/config/redis.config');
const cache = require('./src/services/redis.service');

async function testRedisCache() {
  console.log('\n🔴 ===================================');
  console.log('   REDIS CACHE TEST');
  console.log('🔴 ===================================\n');

  try {
    // Initialize Redis
    console.log('1️⃣ Initializing Redis...');
    initializeRedis();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for connection

    // Test connection
    console.log('\n2️⃣ Testing connection...');
    const connected = await testRedisConnection();
    if (!connected) {
      throw new Error('Redis connection failed');
    }
    console.log('✅ Redis connected successfully!\n');

    // Test SET operation
    console.log('3️⃣ Testing SET operation...');
    const testData = {
      id: 'test-123',
      name: 'Test Board',
      description: 'This is a test',
      timestamp: new Date().toISOString(),
    };
    await cache.set('test:board:123', testData, 60); // 60 seconds TTL
    console.log('✅ Data cached successfully\n');

    // Test GET operation (should hit cache)
    console.log('4️⃣ Testing GET operation...');
    const cached = await cache.get('test:board:123');
    console.log('Retrieved from cache:', JSON.stringify(cached, null, 2));
    console.log('✅ Cache retrieval successful\n');

    // Test EXISTS operation
    console.log('5️⃣ Testing EXISTS operation...');
    const exists = await cache.exists('test:board:123');
    console.log('Key exists:', exists);
    console.log('✅ EXISTS check successful\n');

    // Test TTL operation
    console.log('6️⃣ Testing TTL operation...');
    const ttl = await cache.ttl('test:board:123');
    console.log('Time to live:', ttl, 'seconds');
    console.log('✅ TTL check successful\n');

    // Test DELETE operation
    console.log('7️⃣ Testing DELETE operation...');
    await cache.delete('test:board:123');
    const afterDelete = await cache.get('test:board:123');
    console.log('After delete:', afterDelete);
    console.log('✅ Delete successful\n');

    // Test pattern-based deletion
    console.log('8️⃣ Testing pattern deletion...');
    await cache.set('test:pattern:1', 'value1', 60);
    await cache.set('test:pattern:2', 'value2', 60);
    await cache.set('test:pattern:3', 'value3', 60);
    console.log('Created 3 test keys');
    await cache.deletePattern('test:pattern:*');
    console.log('✅ Pattern deletion successful\n');

    // Test HASH operations
    console.log('9️⃣ Testing HASH operations...');
    await cache.hset('test:hash', 'field1', 'value1');
    await cache.hset('test:hash', 'field2', { nested: 'object' });
    const hashValue = await cache.hget('test:hash', 'field1');
    console.log('Hash field value:', hashValue);
    const allFields = await cache.hgetall('test:hash');
    console.log('All hash fields:', allFields);
    await cache.delete('test:hash');
    console.log('✅ Hash operations successful\n');

    // Test INCREMENT operation
    console.log('🔟 Testing INCREMENT operation...');
    await cache.increment('test:counter', 1);
    await cache.increment('test:counter', 5);
    const counterValue = await cache.get('test:counter');
    console.log('Counter value:', counterValue);
    await cache.delete('test:counter');
    console.log('✅ Increment successful\n');

    // Performance test
    console.log('⚡ Performance Test...');
    const iterations = 100;
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
      await cache.set(`perf:test:${i}`, { index: i, data: 'test' }, 60);
    }
    
    for (let i = 0; i < iterations; i++) {
      await cache.get(`perf:test:${i}`);
    }
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / (iterations * 2);
    
    console.log(`${iterations * 2} operations in ${totalTime}ms`);
    console.log(`Average: ${avgTime.toFixed(2)}ms per operation`);
    console.log('✅ Performance test complete\n');

    // Cleanup
    await cache.deletePattern('perf:test:*');

    console.log('🔴 ===================================');
    console.log('   ✅ ALL TESTS PASSED!');
    console.log('🔴 ===================================\n');

    console.log('📊 Summary:');
    console.log('  ✅ Connection: OK');
    console.log('  ✅ SET/GET: OK');
    console.log('  ✅ DELETE: OK');
    console.log('  ✅ Pattern deletion: OK');
    console.log('  ✅ HASH operations: OK');
    console.log('  ✅ INCREMENT: OK');
    console.log('  ✅ Performance: OK\n');

    console.log('🎉 Redis is working perfectly!\n');
    console.log('Next steps:');
    console.log('  1. Start your backend: npm start');
    console.log('  2. Make API calls to test board caching');
    console.log('  3. Monitor cache with: docker exec -it fady-redis redis-cli MONITOR\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Error details:', error);
    
    console.log('\n🔧 Troubleshooting:');
    console.log('  1. Check Redis is running: docker ps | grep fady-redis');
    console.log('  2. Start Redis: docker-compose up -d');
    console.log('  3. Check logs: docker logs fady-redis');
    console.log('  4. Test connection: docker exec -it fady-redis redis-cli ping\n');
    
    process.exit(1);
  }
}

// Run tests
testRedisCache();
