// Test if webhook endpoint is accessible
const axios = require('axios');

async function testWebhookEndpoint() {
  try {
    console.log('🔍 Testing webhook endpoint...\n');
    
    const url = 'http://localhost:3000/api/stripe/webhook';
    
    console.log(`Sending POST request to: ${url}`);
    
    const response = await axios.post(url, {
      test: 'data'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'test_signature'
      },
      validateStatus: () => true // Accept any status code
    });
    
    console.log(`\n✅ Response Status: ${response.status}`);
    console.log(`Response Data:`, response.data);
    
    if (response.status === 400) {
      console.log('\n✅ Endpoint is working (signature verification failed as expected)');
    } else if (response.status === 404) {
      console.log('\n❌ Endpoint not found! Check route configuration');
    } else {
      console.log('\n⚠️  Unexpected response');
    }
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('\n❌ Backend is not running on port 3000');
    } else {
      console.error('\n❌ Error:', error.message);
    }
  }
}

testWebhookEndpoint();
