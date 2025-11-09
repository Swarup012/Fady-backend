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

async function checkUserOrg() {
  try {
    const userEmail = 'prithachatterjee74@gmail.com';
    
    console.log(`🔍 Checking current state for: ${userEmail}\n`);
    
    // Get user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, current_organization_id')
      .eq('email', userEmail)
      .single();
    
    console.log(`👤 User: ${user.email}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Current org ID: ${user.current_organization_id}\n`);
    
    // Get all memberships
    const { data: memberships } = await supabaseAdmin
      .from('organization_members')
      .select('role, organization_id, organizations(name, subdomain)')
      .eq('user_id', user.id);
    
    console.log(`🏢 User is member of ${memberships?.length || 0} organizations:\n`);
    
    memberships?.forEach((m, i) => {
      const isCurrent = m.organization_id === user.current_organization_id;
      console.log(`${i + 1}. ${m.organizations.name} (${m.organizations.subdomain})`);
      console.log(`   Org ID: ${m.organization_id}`);
      console.log(`   Role: ${m.role}`);
      console.log(`   ${isCurrent ? '← CURRENT ORGANIZATION ✅' : ''}\n`);
    });
    
    // Get all organizations
    console.log('📊 All organizations in database:\n');
    const { data: allOrgs } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain')
      .order('created_at', { ascending: true });
    
    allOrgs?.forEach((org, i) => {
      console.log(`${i + 1}. ${org.name} (${org.subdomain})`);
      console.log(`   ID: ${org.id}\n`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkUserOrg();
