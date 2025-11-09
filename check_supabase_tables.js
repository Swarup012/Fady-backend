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

async function checkTables() {
  try {
    console.log('🔍 Checking if organization_members table exists...\n');
    
    // Try to query organization_members table
    const { data, error } = await supabaseAdmin
      .from('organization_members')
      .select('*')
      .limit(1);
    
    if (error) {
      console.log('❌ organization_members table does NOT exist');
      console.log('Error:', error.message);
      console.log('\n⚠️  YOU NEED TO RUN THE MIGRATION SQL!\n');
      console.log('Steps:');
      console.log('1. Go to https://supabase.com/dashboard');
      console.log('2. Select your project');
      console.log('3. Click "SQL Editor" in the left sidebar');
      console.log('4. Click "New Query"');
      console.log('5. Copy the entire content of: supabase_organization_members_migration.sql');
      console.log('6. Paste and click "Run"');
      return;
    }
    
    console.log('✅ organization_members table EXISTS!');
    console.log(`Found ${data?.length || 0} sample records\n`);
    
    // Check current_organization_id column
    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, organization_id, current_organization_id')
      .limit(3);
    
    if (userError) {
      console.log('⚠️  Error checking users table:', userError.message);
    } else {
      console.log('📊 Sample users:');
      users.forEach(u => {
        console.log(`  - ${u.email}`);
        console.log(`    old org_id: ${u.organization_id || 'null'}`);
        console.log(`    current_org_id: ${u.current_organization_id || 'null'}`);
      });
    }
    
    // Count organization_members
    const { count } = await supabaseAdmin
      .from('organization_members')
      .select('*', { count: 'exact', head: true });
    
    console.log(`\n✅ Migration appears complete!`);
    console.log(`   Total organization memberships: ${count || 0}`);
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkTables();
