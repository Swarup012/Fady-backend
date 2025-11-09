const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function testSignupResponse() {
  try {
    console.log('🧪 Testing what signup returns...\n');
    
    // Simulate the signup flow
    const testEmail = 'test-user-' + Date.now() + '@example.com';
    const organizationId = 'd661e245-3da2-47e2-83eb-14092d634270'; // notion
    const jobRole = 'product-manager';
    
    console.log('Test parameters:');
    console.log(`  Email: ${testEmail}`);
    console.log(`  Organization: notion`);
    console.log(`  Job Role: ${jobRole}\n`);
    
    // Step 1: Determine organization role
    const { count } = await supabaseAdmin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    
    const organizationRole = (count === 0) ? 'owner' : 'member';
    console.log(`Organization Role (determined): ${organizationRole}`);
    console.log(`  (${count === 0 ? 'First user - becomes owner' : `${count} existing members - becomes member`})\n`);
    
    // Step 2: Simulate what the response would include
    const mockProfile = {
      id: 'mock-user-id',
      email: testEmail,
      name: 'Test User',
      role: jobRole, // This is the JOB role
      created_at: new Date().toISOString()
    };
    
    // OLD WAY (WRONG):
    console.log('❌ OLD signup response (missing organization_role):');
    const oldResponse = {
      action: 'created_new',
      user: mockProfile,
      session: null
    };
    console.log(JSON.stringify(oldResponse.user, null, 2));
    console.log('\n  → ProtectedRoute sees: user.role = "product-manager"');
    console.log('  → ProtectedRoute checks: allowedRoles.includes("product-manager")');
    console.log('  → Result: FALSE ❌ Access Denied!\n');
    
    // NEW WAY (CORRECT):
    console.log('✅ NEW signup response (with organization_role):');
    const userWithOrgRole = {
      ...mockProfile,
      organization_role: organizationRole, // ADD THIS!
      organization_id: organizationId
    };
    const newResponse = {
      action: 'created_new',
      user: userWithOrgRole,
      session: null
    };
    console.log(JSON.stringify(newResponse.user, null, 2));
    console.log('\n  → ProtectedRoute sees: user.organization_role = "member"');
    console.log('  → ProtectedRoute checks: allowedRoles.includes("member")');
    console.log('  → Result: TRUE ✅ Access Granted!\n');
    
    console.log('═══════════════════════════════════════');
    console.log('📊 TWO SEPARATE ROLE SYSTEMS:');
    console.log('═══════════════════════════════════════');
    console.log('1. users.role = "product-manager" (Job function)');
    console.log('   → Used for: Content filtering, job-specific features');
    console.log('   → Examples: designer, engineer, product-manager, founder\n');
    console.log('2. organization_members.role = "owner/admin/member" (Permissions)');
    console.log('   → Used for: Access control, ProtectedRoute');
    console.log('   → Examples: owner, admin, member\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

testSignupResponse();
