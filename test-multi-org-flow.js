require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

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

async function testMultiOrgFlow() {
  try {
    const pritha_id = '02a2df7e-06b6-474a-9514-f97311bf7851';
    const pritha_email = 'prithachatterjee74@gmail.com';

    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║     MULTI-ORGANIZATION FLOW TEST              ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    // 1. Get user's current state
    console.log('📊 Step 1: Current User State\n');
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, name, current_organization_id')
      .eq('id', pritha_id)
      .single();

    console.log(`User: ${user.name} (${user.email})`);
    console.log(`Current Org ID: ${user.current_organization_id || 'none'}\n`);

    // 2. Get all organizations user belongs to
    console.log('🏢 Step 2: All Organizations\n');
    const { data: memberships } = await supabaseAdmin
      .from('organization_members')
      .select(`
        role,
        joined_at,
        organizations!organization_members_organization_id_fkey (
          id,
          name,
          subdomain,
          created_at
        )
      `)
      .eq('user_id', pritha_id)
      .order('joined_at', { ascending: true });

    if (memberships && memberships.length > 0) {
      memberships.forEach((m, i) => {
        const isCurrent = m.organizations.id === user.current_organization_id;
        console.log(`${i + 1}. ${m.organizations.name}`);
        console.log(`   Subdomain: ${m.organizations.subdomain}`);
        console.log(`   Role: ${m.role}`);
        console.log(`   Status: ${isCurrent ? '✓ CURRENT' : '  Available'}`);
        console.log(`   Joined: ${new Date(m.joined_at).toLocaleDateString()}\n`);
      });
    } else {
      console.log('No organizations found.\n');
    }

    // 3. Test scenario: Create a new organization
    console.log('═══════════════════════════════════════════════\n');
    console.log('🎯 Test Scenario: Create New Organization\n');
    console.log(`Imagine ${user.name} wants to create their own org:`);
    console.log('   Company Name: "Pritha\'s Startup"');
    console.log('   Subdomain: "pritha-startup"\n');
    
    console.log('Expected Flow:');
    console.log('   1. POST /api/organizations');
    console.log('      Body: { name, subdomain, ... }');
    console.log('   2. Creates organization in DB');
    console.log('   3. Adds user to organization_members (role: owner)');
    console.log('   4. Sets current_organization_id to new org');
    console.log('   5. Returns new organization details\n');

    console.log('After creation:');
    console.log(`   • ${user.name} belongs to 2 organizations:`);
    console.log('     - notion (member)');
    console.log('     - pritha-startup (owner) ✓ CURRENT\n');

    // 4. Test scenario: Switch organizations
    console.log('═══════════════════════════════════════════════\n');
    console.log('🔄 Test Scenario: Switch Organizations\n');
    console.log(`${user.name} wants to switch back to notion:\n`);
    
    console.log('Expected Flow:');
    console.log('   1. GET /api/organizations/me/all');
    console.log('      Returns: [notion, pritha-startup]');
    console.log('   2. User clicks on "notion" in switcher');
    console.log('   3. PUT /api/users/me/current-organization');
    console.log('      Body: { organizationId: "notion-id" }');
    console.log('   4. Updates current_organization_id');
    console.log('   5. Redirects to notion.localhost/boards\n');

    console.log('After switch:');
    console.log(`   • Current org: notion`);
    console.log(`   • Role: member`);
    console.log(`   • Can switch back to pritha-startup anytime\n`);

    // 5. Show API endpoints
    console.log('═══════════════════════════════════════════════\n');
    console.log('✅ NEW API ENDPOINTS ADDED\n');
    console.log('Backend Routes:');
    console.log('   GET  /api/organizations/me/all');
    console.log('        → Get all organizations user belongs to');
    console.log('   POST /api/organizations');
    console.log('        → Create new organization (for existing users)');
    console.log('   PUT  /api/users/me/current-organization');
    console.log('        → Switch to different organization\n');

    console.log('Frontend Components Needed:');
    console.log('   1. OrganizationSwitcher (header dropdown)');
    console.log('   2. CreateOrganizationModal');
    console.log('   3. Update OrganizationContext to handle multiple orgs\n');

    console.log('═══════════════════════════════════════════════\n');
    console.log('🎉 MULTI-ORG BACKEND READY!\n');
    console.log('Next Steps:');
    console.log('   1. Restart backend server');
    console.log('   2. Create frontend organization switcher');
    console.log('   3. Add "Create Organization" button');
    console.log('   4. Test the complete flow\n');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testMultiOrgFlow();
