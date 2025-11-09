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

async function fixMigration() {
  try {
    console.log('🔍 Checking current state...\n');
    
    // Get all users with organizations
    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, organization_id, organization_role, current_organization_id, created_at')
      .not('organization_id', 'is', null);
    
    if (userError) {
      console.log('❌ Error fetching users:', userError.message);
      return;
    }
    
    console.log(`📊 Found ${users.length} users with organizations\n`);
    
    // Check existing memberships
    const { data: existingMembers } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, organization_id, role');
    
    console.log(`📋 Existing memberships: ${existingMembers?.length || 0}\n`);
    
    // Migrate each user
    for (const user of users) {
      console.log(`👤 ${user.email}`);
      console.log(`   org_id: ${user.organization_id}`);
      console.log(`   org_role: ${user.organization_role || 'member'}`);
      
      // Check if already exists
      const exists = existingMembers?.find(
        m => m.user_id === user.id && m.organization_id === user.organization_id
      );
      
      if (exists) {
        console.log(`   ✓ Already in organization_members`);
      } else {
        // Add to organization_members
        const { error: insertError } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: user.id,
            organization_id: user.organization_id,
            role: user.organization_role || 'member',
            joined_at: user.created_at
          });
        
        if (insertError) {
          console.log(`   ❌ Error adding: ${insertError.message}`);
        } else {
          console.log(`   ✅ Added to organization_members`);
        }
      }
      
      // Set current_organization_id if null
      if (!user.current_organization_id) {
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ current_organization_id: user.organization_id })
          .eq('id', user.id);
        
        if (updateError) {
          console.log(`   ❌ Error updating current_org: ${updateError.message}`);
        } else {
          console.log(`   ✅ Set current_organization_id`);
        }
      }
      
      console.log('');
    }
    
    // Final count
    const { count } = await supabaseAdmin
      .from('organization_members')
      .select('*', { count: 'exact', head: true });
    
    console.log(`\n✅ Migration fixed!`);
    console.log(`   Total memberships now: ${count}`);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

fixMigration();
