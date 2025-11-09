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

async function checkUsers() {
  try {
    console.log('👥 All Users:\n');
    
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, email, role, organization_role, current_organization_id')
      .order('created_at', { ascending: false });
    
    for (const user of users) {
      console.log(`📧 ${user.email}`);
      console.log(`   User ID: ${user.id}`);
      console.log(`   Job Role: ${user.role || 'null'}`);
      console.log(`   Old org_role: ${user.organization_role || 'null'} (DEPRECATED)`);
      console.log(`   Current org ID: ${user.current_organization_id || 'null'}`);
      
      // Check organization_members for this user
      const { data: memberships } = await supabaseAdmin
        .from('organization_members')
        .select('role, organization_id, organizations(name, subdomain)')
        .eq('user_id', user.id);
      
      if (memberships && memberships.length > 0) {
        console.log(`   Organization Memberships (${memberships.length}):`);
        memberships.forEach((m, i) => {
          const isCurrent = m.organization_id === user.current_organization_id;
          console.log(`     ${i + 1}. ${m.organizations.name} (${m.organizations.subdomain}) - Role: ${m.role}${isCurrent ? ' ← CURRENT' : ''}`);
        });
      } else {
        console.log(`   ❌ No memberships in organization_members table!`);
      }
      
      console.log('');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkUsers();
