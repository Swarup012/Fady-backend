const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkTracking() {
  console.log('🔍 Checking if post creation was tracked...\n');
  
  // Get notion organization ID
  const { data: notionOrg } = await supabase
    .from('organizations')
    .select('id, name, tracked_users_count_cache, tracked_users_limit')
    .eq('name', 'notion')
    .single();
  
  if (!notionOrg) {
    console.log('❌ Notion organization not found');
    return;
  }
  
  console.log(`📊 Notion Organization:`);
  console.log(`   ID: ${notionOrg.id}`);
  console.log(`   Cached count: ${notionOrg.tracked_users_count_cache || 0}`);
  console.log(`   Limit: ${notionOrg.tracked_users_limit}`);
  
  // Check tracked users for notion org
  const { data: trackedUsers, error } = await supabase
    .from('tracked_users')
    .select('*')
    .eq('organization_id', notionOrg.id)
    .eq('billing_period', '2025-12')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }
  
  console.log(`\n📈 Tracked users in database: ${trackedUsers.length}`);
  
  if (trackedUsers.length > 0) {
    console.log('\n✅ SUCCESS! Users are being tracked:\n');
    trackedUsers.forEach((user, i) => {
      console.log(`  ${i + 1}. User: ${user.user_identifier}`);
      console.log(`     - Posts: ${user.posts_created}`);
      console.log(`     - Votes: ${user.votes_cast}`);
      console.log(`     - Comments: ${user.comments_made}`);
      console.log(`     - Total actions: ${user.total_actions}`);
      console.log(`     - First seen: ${new Date(user.first_seen).toLocaleString()}`);
      console.log(`     - Last activity: ${new Date(user.last_activity).toLocaleString()}`);
      console.log('');
    });
  } else {
    console.log('\n⚠️  No users tracked yet');
    console.log('\nPossible reasons:');
    console.log('1. Post creation might not have triggered tracking');
    console.log('2. Check backend logs for errors');
    console.log('3. Middleware might not be firing');
  }
  
  // Check recent posts
  const { data: recentPosts } = await supabase
    .from('posts')
    .select('id, title, created_at, author_id')
    .order('created_at', { ascending: false })
    .limit(3);
  
  console.log('\n📝 Recent posts:');
  recentPosts.forEach(post => {
    console.log(`   - ${post.title} (ID: ${post.id.substring(0, 8)}...)`);
    console.log(`     Author ID: ${post.author_id}`);
    console.log(`     Created: ${new Date(post.created_at).toLocaleString()}`);
  });
}

checkTracking().catch(console.error);
