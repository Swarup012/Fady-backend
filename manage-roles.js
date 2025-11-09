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

async function showMultiOrgStructure() {
  try {
    console.log('═══════════════════════════════════════');
    console.log('📊 MULTI-ORGANIZATION STRUCTURE');
    console.log('═══════════════════════════════════════\n');
    
    // Get all organizations
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain')
      .order('created_at', { ascending: true });
    
    console.log(`🏢 Organizations (${orgs?.length || 0}):\n`);
    
    for (const org of orgs) {
      console.log(`┌─ ${org.name} (${org.subdomain})`);
      console.log(`│  ID: ${org.id}`);
      
      // Get members
      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('role, user_id, users(email, role)')
        .eq('organization_id', org.id);
      
      console.log(`│  Members: ${members?.length || 0}`);
      members?.forEach((m, i) => {
        const isLast = i === members.length - 1;
        const prefix = isLast ? '└──' : '├──';
        console.log(`${prefix} ${m.users.email}`);
        console.log(`    │  Organization Role: ${m.role} (permission level)`);
        console.log(`    │  Job Role: ${m.users.role || 'not set'} (content filtering)`);
      });
      console.log('');
    }
    
    console.log('═══════════════════════════════════════');
    console.log('👥 USERS & THEIR MEMBERSHIPS');
    console.log('═══════════════════════════════════════\n');
    
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, email, role, current_organization_id')
      .order('created_at', { ascending: true });
    
    for (const user of users) {
      console.log(`👤 ${user.email}`);
      console.log(`   Job Role: ${user.role || 'not set'}`);
      console.log(`   Current Org ID: ${user.current_organization_id || 'none'}`);
      
      // Get all memberships
      const { data: memberships } = await supabaseAdmin
        .from('organization_members')
        .select('role, organization_id, organizations(name, subdomain)')
        .eq('user_id', user.id);
      
      console.log(`   Member of ${memberships?.length || 0} organizations:`);
      memberships?.forEach(m => {
        const isCurrent = m.organization_id === user.current_organization_id;
        console.log(`     • ${m.organizations.name} - ${m.role} ${isCurrent ? '← ACTIVE' : ''}`);
      });
      console.log('');
    }
    
    console.log('═══════════════════════════════════════');
    console.log('✅ HOW IT WORKS (LIKE CANNY)');
    console.log('═══════════════════════════════════════\n');
    console.log('1. User visits notion.localhost:5173/login');
    console.log('2. Frontend detects subdomain = "notion"');
    console.log('3. Fetches organization ID for "notion"');
    console.log('4. Passes organizationId to backend during login');
    console.log('5. Backend adds user to organization_members with role="member"');
    console.log('6. Backend sets current_organization_id = notion ID');
    console.log('7. User sees notion\'s dashboard with member permissions');
    console.log('8. User can switch between organizations later\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

showMultiOrgStructure();
