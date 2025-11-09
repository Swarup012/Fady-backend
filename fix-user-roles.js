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

async function fixUserRoles() {
  try {
    const userId = 'f58b812b-b499-432e-b990-5f74e33dcecc'; // prithachatterjee74
    const notionOrgId = 'd661e245-3da2-47e2-83eb-14092d634270';
    
    console.log('🔧 Adding user to notion organization as member...\n');
    
    // First, check if already exists
    const { data: existing } = await supabaseAdmin
      .from('organization_members')
      .select('*')
      .eq('user_id', userId)
      .eq('organization_id', notionOrgId)
      .single();
    
    if (existing) {
      console.log('✅ User already a member!');
      console.log(`   Role: ${existing.role}\n`);
      return;
    }
    
    // Add to organization_members
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
      console.log('   Details:', error);
    } else {
      console.log('✅ Successfully added!');
      console.log(`   Role: ${data.role}`);
      console.log(`   Org: ${data.organization_id}\n`);
    }
    
    // Verify
    const { data: memberships } = await supabaseAdmin
      .from('organization_members')
      .select('role, organizations(name, subdomain)')
      .eq('user_id', userId);
    
    console.log(`📊 User now member of ${memberships?.length || 0} organizations:`);
    memberships?.forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.organizations.name} - Role: ${m.role}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
  }
}

fixUserRoles();
