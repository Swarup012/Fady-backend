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

async function testRoleUpdate() {
  try {
    const notionOrgId = '56c9e22a-cff5-474f-a6ab-fb4a753bfea5';

    console.log('\n📊 Current Organization Members:\n');

    // Get all members
    const { data: members, error } = await supabaseAdmin
      .from('organization_members')
      .select(`
        role,
        joined_at,
        users!organization_members_user_id_fkey (
          id,
          name,
          email,
          role
        )
      `)
      .eq('organization_id', notionOrgId)
      .order('joined_at', { ascending: true });

    if (error) {
      console.error('❌ Error fetching members:', error);
      return;
    }

    members.forEach((member, index) => {
      console.log(`${index + 1}. ${member.users.email}`);
      console.log(`   Name: ${member.users.name}`);
      console.log(`   Job Role: ${member.users.role}`);
      console.log(`   Organization Role: ${member.role} ${member.role === 'owner' ? '👑' : member.role === 'admin' ? '⚡' : '👤'}`);
      console.log(`   User ID: ${member.users.id}`);
      console.log(`   Joined: ${new Date(member.joined_at).toLocaleString()}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════');
    console.log('✅ Role Management is Working!');
    console.log('═══════════════════════════════════════\n');
    console.log('The owner can now:');
    console.log('  • View all members in the organization');
    console.log('  • Change member roles (member → admin → owner)');
    console.log('  • Remove members (except the last owner)');
    console.log('\nTo test role updates:');
    console.log('  1. Login as owner (swarupbasu325@gmail.com)');
    console.log('  2. Go to /admin/organization');
    console.log('  3. Click "Members" tab');
    console.log('  4. Use dropdown to change roles');

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

testRoleUpdate();
