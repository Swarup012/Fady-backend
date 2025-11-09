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

async function addUserToOrg() {
  try {
    const userEmail = 'swarupbasu325@gmail.com';
    const orgSubdomain = 'notion';
    
    console.log(`🔧 Adding ${userEmail} to ${orgSubdomain} organization...\n`);
    
    // Get user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', userEmail)
      .single();
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    // Get organization
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain')
      .eq('subdomain', orgSubdomain)
      .single();
    
    if (!org) {
      console.log('❌ Organization not found');
      return;
    }
    
    console.log(`👤 User: ${user.email} (${user.id})`);
    console.log(`🏢 Organization: ${org.name} (${org.id})\n`);
    
    // Check if already a member
    const { data: existing } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', org.id)
      .single();
    
    if (existing) {
      console.log(`✅ User is already a member with role: ${existing.role}`);
      return;
    }
    
    // Add as admin (since they're a developer/owner)
    const { error } = await supabaseAdmin
      .from('organization_members')
      .insert({
        user_id: user.id,
        organization_id: org.id,
        role: 'admin', // Make them admin
        joined_at: new Date().toISOString()
      });
    
    if (error) {
      console.log('❌ Error:', error.message);
    } else {
      console.log('✅ User added as ADMIN');
      
      // Update current_organization_id
      await supabaseAdmin
        .from('users')
        .update({ current_organization_id: org.id })
        .eq('id', user.id);
      
      console.log('✅ Updated current_organization_id\n');
      console.log('🎉 Done! User can now access the dashboard.');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

addUserToOrg();
