// Rate Limit Test Script
// Run with: node test-rate-limit.js

const axios = require('axios');

const API_URL = 'http://localhost:3000';

// IMPORTANT: Replace with your actual access token
// Get it from browser DevTools → Application → Local Storage → access_token
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsImtpZCI6Im9YTU9RYytjL09JVkpmazIiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2F0dmR4dG51aW1weWhwa25yd3d3LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJhNzFhYjIwYy1lMGY3LTQxYjktOWI2NS0wNTgxMWIzYjhmZGIiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY3NTIwMzA3LCJpYXQiOjE3Njc1MTY3MDcsImVtYWlsIjoic3dhcnVwYmFzdTMyNUBnbWFpbC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoic3dhcnVwYmFzdTMyNUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IlN3YXJ1cCBCYXN1IiwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiJhNzFhYjIwYy1lMGY3LTQxYjktOWI2NS0wNTgxMWIzYjhmZGIifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc2NzUxNjcwN31dLCJzZXNzaW9uX2lkIjoiODAyNzI5MmYtZmE4OS00NTFhLWI0NDMtMzkwYWI5YjBhZTkxIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.BnzTn-_h-lsjY0AAHPZqmDzEFyYuQ1SnPNOg8DPgFCs';

const BOARD_SLUG = 'faddy'; // Change to your board slug

async function testRateLimit() {
  console.log('🧪 Testing Rate Limiting - Post Creation');
  console.log('==========================================');
  console.log('');
  console.log('This will make 12 POST requests to test the rate limit');
  console.log('Expected: First 10 succeed, requests 11-12 fail with 429');
  console.log('');

  if (ACCESS_TOKEN === 'YOUR_ACCESS_TOKEN_HERE') {
    console.log('❌ ERROR: Please set your access token in the script');
    console.log('');
    console.log('To get your token:');
    console.log('1. Login to http://localhost:5173');
    console.log('2. Open browser DevTools (F12) → Application → Local Storage');
    console.log('3. Copy the "access_token" value');
    console.log('4. Edit test-rate-limit.js and replace YOUR_ACCESS_TOKEN_HERE');
    process.exit(1);
  }

  const results = {
    success: 0,
    rateLimited: 0,
    failed: 0,
  };

  for (let i = 1; i <= 12; i++) {
    try {
      console.log(`Request #${i}:`);
      
      const response = await axios.post(
        `${API_URL}/api/boards/${BOARD_SLUG}/posts`,
        {
          title: `Rate limit test post #${i}`,
          description: 'Testing rate limiting functionality',
        },
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`  ✅ Success (HTTP ${response.status})`);
      console.log(`  📝 Post ID: ${response.data.data?.post?.id || 'N/A'}`);
      results.success++;
      
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (status === 429) {
          console.log(`  🚫 Rate Limited (HTTP ${status})`);
          console.log(`  📝 Message: ${data.message}`);
          console.log(`  ⏱️  Reset in: ${Math.ceil(data.resetIn / 60)} minutes`);
          console.log(`  📊 Limit: ${data.limit} requests per ${data.window}`);
          results.rateLimited++;
        } else {
          console.log(`  ❌ Failed (HTTP ${status})`);
          console.log(`  📝 Error: ${data.message || error.message}`);
          results.failed++;
        }
      } else {
        console.log(`  ❌ Network Error: ${error.message}`);
        results.failed++;
      }
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('');
  console.log('==========================================');
  console.log('📊 Results:');
  console.log(`   ✅ Successful: ${results.success}`);
  console.log(`   🚫 Rate Limited: ${results.rateLimited}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log('   Expected: 10 successful, 2 rate limited, 0 failed');
  console.log('');

  if (results.success === 10 && results.rateLimited === 2 && results.failed === 0) {
    console.log('✅ PASS: Rate limiting working correctly!');
    console.log('');
    console.log('🔍 Verification: Check Redis keys');
    console.log('   Run: docker exec -it fady-redis redis-cli KEYS "rate_limit:*"');
  } else {
    console.log('⚠️ UNEXPECTED: Results don\'t match expected behavior');
    if (results.failed > 0) {
      console.log('');
      console.log('💡 Possible issues:');
      console.log('   - Invalid access token (expired or wrong)');
      console.log('   - Board doesn\'t exist');
      console.log('   - Backend not running');
      console.log('   - Organization post limit already reached');
    }
  }
}

// Run the test
testRateLimit().catch(error => {
  console.error('❌ Test failed with error:', error.message);
  process.exit(1);
});
