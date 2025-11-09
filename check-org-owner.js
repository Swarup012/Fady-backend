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

async function checkOrgOwner() {
  try {
    // Get the notion organization
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('subdomain', 'notion')
      .single();
    
    if (!org) {
      console.log('❌ Notion organization not found');
      return;
    }
    
    console.log('🏢 Organization: notion');
    console.log(`   ID: ${org.id}`);
    console.log(`   Name: ${org.name}`);
    console.log(`   Owner ID: ${org.owner_id || 'NULL'}`);
    console.log(`   Created at: ${org.created_at}\n`);
    
    if (org.owner_id) {
      // Get owner details
      const { data: owner } = await supabaseAdmin
        .from('users')
        .select('email, name')
        .eq('id', org.owner_id)
        .single();
      
      console.log(`👤 Owner: ${owner?.email || 'Unknown'}`);
      
      // Check if owner is in organization_members
      const { data: membership } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', org.owner_id)
        .eq('organization_id', org.id)
        .single();
      
      if (membership) {
        console.log(`   ✅ In organization_members: ${membership.role}`);
      } else {
        console.log(`   ❌ NOT in organization_members! Adding...`);
        
        const { error } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: org.owner_id,
            organization_id: org.id,
            role: 'owner',
            joined_at: org.created_at
          });
        
        if (error) {
          console.log(`      Error: ${error.message}`);
        } else {
          console.log(`      ✅ Added as owner`);
        }
      }
    } else {
      console.log('⚠️  No owner_id set in organization table!');
      console.log('   Checking who should be the owner...\n');
      
      // Find the first user who created the org (oldest member or creator)
      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id, role, joined_at, users(email)')
        .eq('organization_id', org.id)
        .order('joined_at', { ascending: true });
      
      if (members && members.length > 0) {
        console.log(`   Found ${members.length} members:`);
        members.forEach((m, i) => {
          console.log(`     ${i + 1}. ${m.users.email} - ${m.role}`);
        });
        
        // First member should be owner
        const firstMember = members[0];
        if (firstMember.role !== 'owner') {
          console.log(`\n   Promoting ${firstMember.users.email} to owner...`);
          
          const { error } = await supabaseAdmin
            .from('organization_members')
            .update({ role: 'owner' })
            .eq('user_id', firstMember.user_id)
            .eq('organization_id', org.id);
          
          if (error) {
            console.log(`      Error: ${error.message}`);
          } else {
            console.log(`      ✅ Promoted to owner`);
          }
        }
      } else {
        console.log('   ❌ No members found at all!');
      }
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkOrgOwner();
