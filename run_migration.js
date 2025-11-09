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

async function runMigration() {
  try {
    console.log('🔄 Running organization_members migration...\n');
    
    // Step 1: Get all users with organizations
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, organization_id, organization_role, created_at')
      .not('organization_id', 'is', null);
    
    if (usersError) {
      console.log('❌ Error fetching users:', usersError.message);
      return;
    }
    
    console.log(`📊 Found ${users.length} users with organizations\n`);
    
    // Step 2: Insert into organization_members
    let successCount = 0;
    let errorCount = 0;
    
    for (const user of users) {
      const { error: insertError } = await supabaseAdmin
        .from('organization_members')
        .insert({
          user_id: user.id,
          organization_id: user.organization_id,
          role: user.organization_role || 'member',
          joined_at: user.created_at
        });
      
      if (insertError) {
        console.log(`❌ Error for user ${user.id}:`, insertError.message);
        errorCount++;
      } else {
        successCount++;
      }
    }
    
    console.log(`\n✅ Migration complete!`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    
    // Step 3: Update current_organization_id
    console.log('\n🔄 Setting current_organization_id for users...\n');
    
    for (const user of users) {
      if (!user.current_organization_id) {
        await supabaseAdmin
          .from('users')
          .update({ current_organization_id: user.organization_id })
          .eq('id', user.id);
      }
    }
    
    console.log('✅ current_organization_id updated for all users\n');
    
    // Step 4: Verify
    const { count } = await supabaseAdmin
      .from('organization_members')
      .select('*', { count: 'exact', head: true });
    
    console.log(`📊 Total organization_members records: ${count}\n`);
    
  } catch (err) {
    console.error('❌ Migration error:', err.message);
  }
}

runMigration();
