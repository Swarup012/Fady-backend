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

async function debugAndFix() {
  try {
    console.log('🔍 Debugging organization members...\n');
    
    // Get all users
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, email, current_organization_id')
      .order('created_at', { ascending: true });
    
    console.log(`Found ${users?.length || 0} users:\n`);
    
    for (const user of users) {
      console.log(`📧 ${user.email}`);
      console.log(`   Current org: ${user.current_organization_id || 'none'}`);
      
      if (user.current_organization_id) {
        // Check if user is in organization_members
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', user.current_organization_id)
          .single();
        
        if (membership) {
          console.log(`   ✅ In organization_members: ${membership.role}`);
        } else {
          console.log(`   ❌ NOT in organization_members! Adding as owner...`);
          
          // Add to organization_members as owner
          const { error } = await supabaseAdmin
            .from('organization_members')
            .insert({
              user_id: user.id,
              organization_id: user.current_organization_id,
              role: 'owner',
              joined_at: new Date().toISOString()
            });
          
          if (error) {
            console.log(`      Error: ${error.message}`);
          } else {
            console.log(`      ✅ Added as owner`);
          }
        }
      }
      console.log('');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

debugAndFix();
