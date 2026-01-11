const { supabaseAdmin } = require('./src/config/supabase.config');
const trackedUsersService = require('./src/services/tracked-users.service');

async function testExternalUserTracking() {
  try {
    console.log('🧪 Testing External User Tracking\n');
    
    // Get notion organization
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain')
      .eq('subdomain', 'notion')
      .single();
    
    console.log('📊 Organization:', org.name);
    console.log('🆔 Organization ID:', org.id);
    
    // Simulate external user voting
    console.log('\n🎯 Simulating external user vote...');
    await trackedUsersService.trackUser(
      org.id,
      'external-user@example.com',
      'vote',
      {
        name: 'External Test User',
        email: 'external-user@example.com'
      }
    );
    
    console.log('✅ Vote tracked successfully!');
    
    // Check tracked users
    console.log('\n👥 Checking tracked users...');
    const { data: trackedUsers } = await supabaseAdmin
      .from('tracked_users')
      .select('*')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
      .limit(5);
    
    console.log(`\n📈 Total tracked users: ${trackedUsers?.length || 0}`);
    trackedUsers?.forEach((user, idx) => {
      console.log(`\n${idx + 1}. ${user.user_identifier}`);
      console.log(`   Actions: ${user.total_actions} (Posts: ${user.posts_created}, Votes: ${user.votes_cast}, Comments: ${user.comments_made})`);
      console.log(`   Last activity: ${new Date(user.last_activity_at).toLocaleString()}`);
    });
    
    // Check usage
    const usage = await trackedUsersService.getUsage(org.id);
    console.log('\n📊 Usage Stats:');
    console.log(JSON.stringify(usage, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }
}

testExternalUserTracking();
