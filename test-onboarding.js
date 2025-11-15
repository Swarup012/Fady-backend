require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testOnboardingFlow() {
  console.log('\n🧪 Testing Onboarding Flow\n');
  
  // Get a test user
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (!users || users.length === 0) {
    console.error('❌ No users found');
    return;
  }
  
  const testUser = users[0];
  console.log('👤 Test User:', testUser.email);
  
  // Test data from onboarding
  const testOrgData = {
    name: 'Test Company',
    subdomain: 'test-company',
    description: 'Test description',
    industry: 'SaaS/Software',
    company_size: '2-10',
    website: 'https://test.com',
    plan: 'free',
    max_users: 10,
    max_boards: 5,
  };
  
  console.log('\n1️⃣ Testing organization creation...');
  console.log('Data:', testOrgData);
  
  try {
    // Step 1: Create organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert(testOrgData)
      .select()
      .single();
    
    if (orgError) {
      console.error('❌ Failed to create organization:', {
        message: orgError.message,
        code: orgError.code,
        details: orgError.details,
        hint: orgError.hint
      });
      return;
    }
    
    console.log('✅ Organization created:', org.id);
    
    // Step 2: Add user to organization_members
    console.log('\n2️⃣ Adding user to organization_members...');
    const { data: member, error: memberError } = await supabaseAdmin
      .from('organization_members')
      .insert({
        user_id: testUser.id,
        organization_id: org.id,
        role: 'owner',
        joined_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (memberError) {
      console.error('❌ Failed to add member:', {
        message: memberError.message,
        code: memberError.code,
        details: memberError.details,
        hint: memberError.hint
      });
      // Cleanup
      await supabaseAdmin.from('organizations').delete().eq('id', org.id);
      return;
    }
    
    console.log('✅ Member added:', member.role);
    
    // Step 3: Update user's current_organization_id
    console.log('\n3️⃣ Updating user current_organization_id...');
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ current_organization_id: org.id })
      .eq('id', testUser.id);
    
    if (updateError) {
      console.error('❌ Failed to update user:', {
        message: updateError.message,
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint
      });
    } else {
      console.log('✅ User updated');
    }
    
    console.log('\n✅ All steps completed successfully!');
    console.log('🧹 Cleaning up test data...');
    
    // Cleanup
    await supabaseAdmin.from('organization_members').delete().eq('id', member.id);
    await supabaseAdmin.from('organizations').delete().eq('id', org.id);
    await supabaseAdmin.from('users').update({ current_organization_id: null }).eq('id', testUser.id);
    
    console.log('✅ Test complete!\n');
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
  }
}

testOnboardingFlow();
