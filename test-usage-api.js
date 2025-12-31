// Test the usage API endpoint
require('dotenv').config();

async function testUsageAPI() {
  const BASE_URL = 'http://localhost:3000';
  
  console.log('🧪 Testing Usage API\n');
  console.log('To test with your session:');
  console.log('1. Login to your app in browser');
  console.log('2. Open DevTools (F12)');
  console.log('3. Go to Application > Cookies');
  console.log('4. Copy the "token" cookie value');
  console.log('5. Run: TOKEN=<your-token> node test-usage-api.js\n');
  
  const token = process.env.TOKEN;
  
  if (!token) {
    console.log('❌ No token provided');
    console.log('💡 Set TOKEN environment variable and run again');
    return;
  }
  
  try {
    const fetch = (await import('node-fetch')).default;
    
    // Test usage endpoint
    console.log('📡 Calling GET /api/users/me/usage...\n');
    
    const response = await fetch(`${BASE_URL}/api/users/me/usage`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ API Response:');
      console.log(JSON.stringify(data, null, 2));
      console.log('\n📊 Summary:');
      console.log(`Plan: ${data.data.plan}`);
      console.log(`Boards: ${data.data.usage.boards.current}/${data.data.usage.boards.limit}`);
      console.log(`Can create board: ${data.data.usage.boards.remaining !== 0}`);
    } else {
      console.log('❌ API Error:', data);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testUsageAPI();
