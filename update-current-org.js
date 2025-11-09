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

async function updateCurrentOrg() {
  try {
    const userId = 'f58b812b-b499-432e-b990-5f74e33dcecc'; // prithachatterjee74
    const notionOrgId = 'd661e245-3da2-47e2-83eb-14092d634270';
    
    console.log('Updating current_organization_id to notion...\n');
    
    const { error } = await supabaseAdmin
      .from('users')
      .update({ current_organization_id: notionOrgId })
      .eq('id', userId);
    
    if (error) {
      console.log('❌ Error:', error.message);
    } else {
      console.log('✅ Success! current_organization_id updated to notion org');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

updateCurrentOrg();
