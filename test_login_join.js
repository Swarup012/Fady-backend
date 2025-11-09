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

async function testLoginJoin() {
  try {
    // Simulate: prithachatterjee74@gmail.com trying to join "notion" organization
    const userEmail = 'prithachatterjee74@gmail.com';
    const targetOrgSubdomain = 'notion';
    
    console.log(`🧪 Testing: ${userEmail} joining ${targetOrgSubdomain}\n`);
    
    // Step 1: Get user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, current_organization_id')
      .eq('email', userEmail)
      .single();
    
    console.log(`👤 User found: ${user.email}`);
    console.log(`   Current org ID: ${user.current_organization_id}\n`);
    
    // Step 2: Get target organization
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain')
      .eq('subdomain', targetOrgSubdomain)
      .single();
    
    console.log(`🏢 Target organization: ${org.name}`);
    console.log(`   Org ID: ${org.id}\n`);
    
    // Step 3: Check if already member
    const { data: existingMembership } = await supabaseAdmin
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.id)
      .eq('organization_id', org.id)
      .single();
    
    if (existingMembership) {
      console.log(`✅ User is already a member with role: ${existingMembership.role}\n`);
    } else {
      console.log(`❌ User is NOT a member yet\n`);
      console.log(`🔄 Adding user to organization_members as "member"...\n`);
      
      // Add to organization_members
      const { data: newMember, error: insertError } = await supabaseAdmin
        .from('organization_members')
        .insert({
          user_id: user.id,
          organization_id: org.id,
          role: 'member'
        })
        .select()
        .single();
      
      if (insertError) {
        console.log(`❌ Error adding user:`, insertError);
      } else {
        console.log(`✅ Successfully added user as member!`);
        console.log(`   Role: ${newMember.role}\n`);
      }
      
      // Update current_organization_id
      await supabaseAdmin
        .from('users')
        .update({ current_organization_id: org.id })
        .eq('id', user.id);
      
      console.log(`✅ Updated current_organization_id to ${org.id}\n`);
    }
    
    // Step 4: Verify final state
    console.log(`📊 Final state check:\n`);
    
    const { data: allMemberships } = await supabaseAdmin
      .from('organization_members')
      .select('role, organization_id, organizations(name, subdomain)')
      .eq('user_id', user.id);
    
    console.log(`${userEmail} is member of ${allMemberships.length} organizations:`);
    allMemberships.forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.organizations.name} (${m.organizations.subdomain}) - Role: ${m.role}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

testLoginJoin();
