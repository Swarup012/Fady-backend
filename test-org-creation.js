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

async function setupProperStructure() {
  try {
    console.log('🔧 Setting up proper multi-org structure...\n');
    
    // User 1: swarupbasu325@gmail.com - owner of notion
    const user1 = {
      email: 'swarupbasu325@gmail.com',
      id: '3a560b98-18bc-4180-9daf-4a3094ac05c9',
      ownOrg: 'd661e245-3da2-47e2-83eb-14092d634270' // notion
    };
    
    // User 2: prithachatterjee74@gmail.com - owner of startups
    const user2 = {
      email: 'prithachatterjee74@gmail.com',
      id: 'f58b812b-b499-432e-b990-5f74e33dcecc',
      ownOrg: 'bd853a39-555f-4ef3-963b-3d282ceeae5a' // startups
    };
    
    // Add user1 as owner of notion
    console.log(`1. Adding ${user1.email} as OWNER of notion...`);
    await supabaseAdmin
      .from('organization_members')
      .upsert({
        user_id: user1.id,
        organization_id: user1.ownOrg,
        role: 'owner',
        joined_at: new Date().toISOString()
      }, { onConflict: 'user_id,organization_id' });
    console.log('   ✅ Done\n');
    
    // Add user2 as owner of startups
    console.log(`2. Adding ${user2.email} as OWNER of startups...`);
    await supabaseAdmin
      .from('organization_members')
      .upsert({
        user_id: user2.id,
        organization_id: user2.ownOrg,
        role: 'owner',
        joined_at: new Date().toISOString()
      }, { onConflict: 'user_id,organization_id' });
    console.log('   ✅ Done\n');
    
    // Keep user2 as member of notion (cross-org membership)
    console.log(`3. Keeping ${user2.email} as MEMBER of notion (already done)...\n`);
    
    console.log('✅ Structure setup complete!\n');
    console.log('📊 Expected structure:');
    console.log('   • swarupbasu325@gmail.com: owner of notion');
    console.log('   • prithachatterjee74@gmail.com: owner of startups + member of notion\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

setupProperStructure();
