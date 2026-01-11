const trackedUsersController = require('./src/controllers/tracked-users.controller');
const { supabaseAdmin } = require('./src/config/supabase.config');

async function testRecalculate() {
  try {
    console.log('🧪 Testing Recalculate Cache Endpoint\n');
    
    // Get notion organization and owner
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain, tracked_users_count_cache')
      .eq('subdomain', 'notion')
      .single();
    
    const { data: owner } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', 'swarupbasu325@gmail.com')
      .single();
    
    console.log('📊 Organization:', org.name, org.id);
    console.log('📊 Current cache:', org.tracked_users_count_cache);
    console.log('👤 User:', owner.email);
    
    // Get user's role in the organization
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', owner.id)
      .eq('organization_id', org.id)
      .single();
    
    console.log('👤 User role:', membership?.role);
    
    // Mock request object
    const mockReq = {
      user: {
        id: owner.id,
        email: owner.email,
        current_organization_id: org.id,
        organization_role: membership?.role
      },
      organization: {
        id: org.id,
        name: org.name
      },
      body: {}
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
    
    // Test recalculateCache endpoint
    console.log('\n🔍 Testing POST /api/tracked-users/recalculate...\n');
    await trackedUsersController.recalculateCache(mockReq, mockRes);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testRecalculate();
