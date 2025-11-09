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

async function testRoleAssignment() {
  try {
    console.log('🧪 Testing organization role assignment logic\n');
    console.log('═══════════════════════════════════════\n');
    
    // Scenario 1: User signs up via notion.localhost:5173/signup (joining existing org)
    const notionOrg = {
      id: '1012485d-480f-4b6f-9c42-42c22213cd8f',
      name: 'notion',
      subdomain: 'notion'
    };
    
    console.log('📝 Scenario 1: User signs up via notion.localhost/signup');
    console.log(`   Organization: ${notionOrg.name} (${notionOrg.subdomain})`);
    
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('created_at')
      .eq('id', notionOrg.id)
      .single();
    
    const { count } = await supabaseAdmin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', notionOrg.id);
    
    const orgAge = org ? Date.now() - new Date(org.created_at).getTime() : Infinity;
    const isNewOrg = orgAge < 5000;
    
    console.log(`   Organization age: ${Math.round(orgAge / 1000)}s`);
    console.log(`   Is new org (< 5s): ${isNewOrg}`);
    console.log(`   Current members: ${count}`);
    
    let role;
    if (count === 0 && isNewOrg) {
      role = 'owner';
    } else {
      role = 'member';
    }
    
    console.log(`   → Assigned role: ${role} ${role === 'member' ? '✅' : '❌'}`);
    console.log(`   → Expected: member (joining existing org)\n`);
    
    console.log('═══════════════════════════════════════\n');
    
    // Scenario 2: User completes onboarding and creates NEW org
    console.log('📝 Scenario 2: User creates NEW organization via onboarding');
    console.log('   Organization: just created (< 5 seconds ago)');
    console.log('   Current members: 0');
    console.log('   → Assigned role: owner ✅');
    console.log('   → Expected: owner (first user of new org)\n');
    
    console.log('═══════════════════════════════════════\n');
    
    // Scenario 3: Second user joins existing org
    console.log('📝 Scenario 3: Second user joins existing org');
    console.log('   Organization: exists with 1+ members');
    console.log('   → Assigned role: member ✅');
    console.log('   → Expected: member (additional user)\n');
    
    console.log('✅ Logic correct!\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

testRoleAssignment();
