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

async function checkBoards() {
  try {
    console.log('🔍 Checking boards in database...\n');
    
    // Get all boards
    const { data: boards, error } = await supabaseAdmin
      .from('boards')
      .select('*');
    
    if (error) {
      console.log('❌ Error fetching boards:', error.message);
      return;
    }
    
    console.log(`📊 Total boards: ${boards?.length || 0}\n`);
    
    if (boards && boards.length > 0) {
      boards.forEach((board, i) => {
        console.log(`${i + 1}. ${board.name} (${board.slug})`);
        console.log(`   ID: ${board.id}`);
        console.log(`   Organization ID: ${board.organization_id || 'NULL ❌'}`);
        console.log(`   Owner ID: ${board.owner_id || 'NULL'}`);
        console.log('');
      });
    } else {
      console.log('⚠️  No boards found in database');
      console.log('   This is normal if you haven\'t created any boards yet.\n');
    }
    
    // Check organizations
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('*');
    
    console.log(`🏢 Total organizations: ${orgs?.length || 0}\n`);
    
    if (orgs && orgs.length > 0) {
      orgs.forEach((org, i) => {
        console.log(`${i + 1}. ${org.name} (${org.subdomain})`);
        console.log(`   ID: ${org.id}`);
        console.log('');
      });
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkBoards();
