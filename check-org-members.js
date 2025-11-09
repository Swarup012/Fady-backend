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

async function checkOrgMembers() {
  try {
    console.log('📊 Checking organization_members table:\n');
    
    const { data: members, error } = await supabaseAdmin
      .from('organization_members')
      .select('*');
    
    if (error) {
      console.log('❌ Error:', error.message);
      return;
    }
    
    console.log(`Total records: ${members?.length || 0}\n`);
    
    if (members && members.length > 0) {
      members.forEach((m, i) => {
        console.log(`${i + 1}. User: ${m.user_id}`);
        console.log(`   Org: ${m.organization_id}`);
        console.log(`   Role: ${m.role}`);
        console.log(`   Joined: ${m.joined_at}\n`);
      });
    } else {
      console.log('⚠️  Table is empty!\n');
      console.log('Running migration now...\n');
      
      // Run migration
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, email, organization_id, organization_role, created_at')
        .not('organization_id', 'is', null);
      
      console.log(`Found ${users?.length || 0} users with organizations\n`);
      
      for (const user of users) {
        console.log(`Migrating ${user.email}...`);
        
        const { error: insertError } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: user.id,
            organization_id: user.organization_id,
            role: user.organization_role || 'member',
            joined_at: user.created_at
          });
        
        if (insertError) {
          console.log(`  ❌ Error: ${insertError.message}`);
        } else {
          console.log(`  ✅ Success`);
        }
        
        // Also set current_organization_id
        await supabaseAdmin
          .from('users')
          .update({ current_organization_id: user.organization_id })
          .eq('id', user.id);
      }
      
      console.log('\n✅ Migration complete! Checking again...\n');
      
      const { data: afterMigration } = await supabaseAdmin
        .from('organization_members')
        .select('*');
      
      console.log(`Total records after migration: ${afterMigration?.length || 0}`);
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkOrgMembers();
