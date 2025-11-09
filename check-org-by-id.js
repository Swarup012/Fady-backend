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

async function checkOrg() {
  try {
    console.log('🔍 Checking organization and finding real owner...\n');
    
    // Get the organization
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('subdomain', 'notion')
      .single();
    
    if (!org) {
      console.log('❌ Organization not found');
      return;
    }
    
    console.log('🏢 Organization: notion');
    console.log(`   ID: ${org.id}`);
    console.log(`   Created at: ${org.created_at}`);
    console.log(`   Created by: ${org.created_by || 'NULL'}\n`);
    
    // Check all users who have this as current org
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, email, created_at')
      .eq('current_organization_id', org.id)
      .order('created_at', { ascending: true });
    
    console.log(`👥 Users with this as current org (${users?.length || 0}):\n`);
    
    if (users && users.length > 0) {
      for (const user of users) {
        console.log(`   ${user.email}`);
        console.log(`      Created: ${user.created_at}`);
        
        // Check if in organization_members
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', org.id)
          .single();
        
        console.log(`      In org_members: ${membership ? membership.role : 'NO ❌'}`);
        console.log('');
      }
      
      // The FIRST user (oldest) should be the owner who created it
      const realOwner = users[0];
      console.log(`\n✅ Real owner should be: ${realOwner.email} (first user)\n`);
      
      // Check their current membership
      const { data: ownerMembership } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', realOwner.id)
        .eq('organization_id', org.id)
        .single();
      
      if (!ownerMembership) {
        console.log('❌ Owner is NOT in organization_members! Adding...');
        
        const { error } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: realOwner.id,
            organization_id: org.id,
            role: 'owner',
            joined_at: realOwner.created_at
          });
        
        if (error) {
          console.log(`   Error: ${error.message}`);
        } else {
          console.log(`   ✅ Added ${realOwner.email} as owner`);
        }
      } else if (ownerMembership.role !== 'owner') {
        console.log(`❌ Owner has wrong role: ${ownerMembership.role}. Fixing...`);
        
        const { error } = await supabaseAdmin
          .from('organization_members')
          .update({ role: 'owner' })
          .eq('user_id', realOwner.id)
          .eq('organization_id', org.id);
        
        if (error) {
          console.log(`   Error: ${error.message}`);
        } else {
          console.log(`   ✅ Updated ${realOwner.email} to owner`);
        }
      } else {
        console.log(`✅ Owner already has correct role: ${ownerMembership.role}`);
      }
      
      // Fix prithachatterjee74 back to member
      const prithaUser = users.find(u => u.email === 'prithachatterjee74@gmail.com');
      if (prithaUser && prithaUser.id !== realOwner.id) {
        console.log(`\n🔧 Fixing prithachatterjee74@gmail.com back to member...`);
        
        const { error } = await supabaseAdmin
          .from('organization_members')
          .update({ role: 'member' })
          .eq('user_id', prithaUser.id)
          .eq('organization_id', org.id);
        
        if (error) {
          console.log(`   Error: ${error.message}`);
        } else {
          console.log(`   ✅ Changed back to member`);
        }
      }
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkOrg();
