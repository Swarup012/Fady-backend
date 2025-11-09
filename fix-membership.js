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

async function fixMembership() {
  try {
    const userId = 'f58b812b-b499-432e-b990-5f74e33dcecc'; // prithachatterjee74
    const notionOrgId = 'd661e245-3da2-47e2-83eb-14092d634270';
    
    console.log('Adding user to notion organization as member...\n');
    
    const { data, error } = await supabaseAdmin
      .from('organization_members')
      .insert({
        user_id: userId,
        organization_id: notionOrgId,
        role: 'member',
        joined_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.log('❌ Error:', error.message);
    } else {
      console.log('✅ Success!');
      console.log('   User:', data.user_id);
      console.log('   Org:', data.organization_id);
      console.log('   Role:', data.role);
    }
    
    // Verify
    console.log('\n🔍 Verifying all memberships:\n');
    
    const { data: allMemberships } = await supabaseAdmin
      .from('organization_members')
      .select('role, organization_id, organizations(name, subdomain)')
      .eq('user_id', userId);
    
    allMemberships.forEach((m, i) => {
      console.log(`${i + 1}. ${m.organizations.name} (${m.organizations.subdomain}) - Role: ${m.role}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

fixMembership();
