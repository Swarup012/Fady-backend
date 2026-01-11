const trackedUsersController = require('./src/controllers/tracked-users.controller');
const { supabaseAdmin } = require('./src/config/supabase.config');

async function testAPI() {
  try {
    console.log('🧪 Testing Tracked Users API\n');
    
    // Get notion organization and owner
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain')
      .eq('subdomain', 'notion')
      .single();
    
    const { data: owner } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', 'swarupbasu325@gmail.com')
      .single();
    
    console.log('📊 Organization:', org.name, org.id);
    console.log('👤 User:', owner.email, owner.id);
    
    // Mock request object (as if coming from frontend)
    const mockReq = {
      user: {
        id: owner.id,
        email: owner.email,
        current_organization_id: org.id
      },
      organization: {
        id: org.id,
        name: org.name
      },
      query: {}
    };
    
    // Mock response object
    const mockRes = {
      status: (code) => {
        mockRes.statusCode = code;
        return mockRes;
      },
      json: (data) => {
        console.log(`\n📤 Response (${mockRes.statusCode || 200}):`);
        console.log(JSON.stringify(data, null, 2));
        return mockRes;
      }
    };
    
    // Test getCount endpoint
    console.log('\n🔍 Testing GET /api/tracked-users/count...');
    await trackedUsersController.getCount(mockReq, mockRes);
    
    // Test getUsageStats endpoint
    console.log('\n🔍 Testing GET /api/tracked-users/usage...');
    await trackedUsersController.getUsageStats(mockReq, mockRes);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }
}

testAPI();
