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

async function testLogin() {
  try {
    const email = 'prithachatterjee74@gmail.com';
    const password = 'Pritech@123'; // Replace with actual password
    
    console.log('🔐 Simulating login...\n');
    
    // 1. Sign in with Supabase Auth
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      console.log('❌ Login failed:', error.message);
      return;
    }
    
    console.log('✅ Auth successful\n');
    
    // 2. Get user profile
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();
    
    console.log('👤 User Profile:');
    console.log(`   Email: ${profile.email}`);
    console.log(`   Current org ID: ${profile.current_organization_id}`);
    console.log(`   Old org_role: ${profile.organization_role} (DEPRECATED)\n`);
    
    // 3. Get organization role from organization_members
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role, organization_id, organizations(name, subdomain)')
      .eq('user_id', profile.id)
      .eq('organization_id', profile.current_organization_id)
      .single();
    
    if (membership) {
      console.log('🎭 Organization Membership:');
      console.log(`   Organization: ${membership.organizations.name} (${membership.organizations.subdomain})`);
      console.log(`   Role: ${membership.role} ✅\n`);
      
      const userToReturn = {
        ...profile,
        organization_role: membership.role,
        organization_id: membership.organization_id
      };
      
      console.log('📤 What would be returned to frontend:');
      console.log(`   user.organization_role: "${userToReturn.organization_role}"`);
      console.log(`   user.organization_id: "${userToReturn.organization_id}"\n`);
    } else {
      console.log('❌ No membership found!\n');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

testLogin();
