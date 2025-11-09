require('dotenv').config();
const axios = require('axios');

async function testCreateOrganization() {
  try {
    console.log('\n🧪 Testing Create Organization Endpoint\n');

    // First, login to get a token
    console.log('1️⃣ Logging in...');
    const loginResponse = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'prithachatterjee74@gmail.com',
      password: 'pritha123', // Replace with actual password
      organizationId: '56c9e22a-cff5-474f-a6ab-fb4a753bfea5' // notion org
    });

    const token = loginResponse.data.data.user.access_token;
    console.log('✅ Login successful, got token\n');

    // Try to create organization
    console.log('2️⃣ Creating new organization...');
    const createResponse = await axios.post(
      'http://localhost:3000/api/organizations',
      {
        name: 'Test Startup',
        subdomain: 'test-startup-' + Date.now(),
        description: 'Test organization',
        industry: 'SaaS',
        company_size: '1-10'
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Organization created successfully!');
    console.log('\nResponse:', JSON.stringify(createResponse.data, null, 2));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
      console.error('Data:', error.response.data);
      
      // Check if response is HTML
      if (typeof error.response.data === 'string' && error.response.data.includes('<!DOCTYPE')) {
        console.error('\n⚠️ Received HTML instead of JSON!');
        console.error('This usually means:');
        console.error('  1. The route is not found (404)');
        console.error('  2. The server returned an error page');
        console.error('  3. CORS or middleware issue');
      }
    } else if (error.request) {
      console.error('\n⚠️ No response received');
      console.error('Server might not be running on port 3000');
      console.error('Run: npm start in Fady-backend folder');
    }
  }
}

// Check if server is running first
async function checkServer() {
  try {
    const response = await axios.get('http://localhost:3000/health');
    console.log('✅ Server is running:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Server is not running!');
    console.error('Please run: cd /home/swarup/HDD/Fady/Fady-backend && npm start');
    return false;
  }
}

async function run() {
  const serverRunning = await checkServer();
  if (serverRunning) {
    await testCreateOrganization();
  }
}

run();
