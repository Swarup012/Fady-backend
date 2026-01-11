// Test script to verify tracking fix
const { supabaseAdmin } = require('./src/config/supabase.config');
const trackedUsersService = require('./src/services/tracked-users.service');

(async () => {
  try {
    console.log('🧪 Testing Tracking Fix\n');
    console.log('='.repeat(50));
    
    // Get notion org (you're owner)
    const { data: notionOrg } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('subdomain', 'notion')
      .single();
    
    // Get startups org (you're NOT a member)
    const { data: startupsOrg } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('subdomain', 'startups')
      .single();
    
    // Your user ID
    const yourUserId = 'f180e3aa-ad7e-40b2-88cf-bc4f9d4b14b0';
    const yourEmail = 'swarupbasu325@gmail.com';
    
    console.log(`\n📋 Setup:`);
    console.log(`   Your email: ${yourEmail}`);
    console.log(`   Notion org ID: ${notionOrg.id}`);
    console.log(`   Startups org ID: ${startupsOrg.id}`);
    
    // Check membership
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('*')
      .eq('user_id', yourUserId);
    
    console.log(`\n👥 Your memberships:`);
    for (const m of membership || []) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', m.organization_id)
        .single();
      console.log(`   - ${org.name} (${m.role})`);
    }
    
    // Test 1: Track in notion org (should skip - you're owner)
    console.log(`\n🧪 TEST 1: Upvote in NOTION org (you're owner)`);
    console.log(`   Expected: SKIP tracking`);
    console.log(`   Reason: You're internal team member`);
    
    // Check before count
    const { data: notionBefore } = await supabaseAdmin
      .from('tracked_users')
      .select('*')
      .eq('organization_id', notionOrg.id)
      .eq('user_identifier', yourEmail)
      .eq('billing_period', '2026-01')
      .maybeSingle();
    
    console.log(`   Before: ${notionBefore ? 'Already tracked' : 'Not tracked'}`);
    
    // Try to track
    const isInternalNotion = await checkIsInternal(yourUserId, notionOrg.id);
    console.log(`   isInternalTeamMember: ${isInternalNotion}`);
    
    if (!isInternalNotion) {
      await trackedUsersService.trackUser(notionOrg.id, yourEmail, 'vote', {
        email: yourEmail,
        name: 'Swarup Basu'
      });
    }
    
    // Check after count
    const { data: notionAfter } = await supabaseAdmin
      .from('tracked_users')
      .select('*')
      .eq('organization_id', notionOrg.id)
      .eq('user_identifier', yourEmail)
      .eq('billing_period', '2026-01')
      .maybeSingle();
    
    console.log(`   After: ${notionAfter ? 'Tracked!' : 'Not tracked'}`);
    console.log(`   ✅ Result: ${isInternalNotion ? 'CORRECTLY SKIPPED' : '❌ SHOULD HAVE SKIPPED'}`);
    
    // Test 2: Track in startups org (should track - you're NOT a member)
    console.log(`\n🧪 TEST 2: Upvote in STARTUPS org (you're NOT a member)`);
    console.log(`   Expected: TRACK user`);
    console.log(`   Reason: You're external to startups org`);
    
    // Check before count
    const { data: startupsBefore } = await supabaseAdmin
      .from('tracked_users')
      .select('*')
      .eq('organization_id', startupsOrg.id)
      .eq('user_identifier', yourEmail)
      .eq('billing_period', '2026-01')
      .maybeSingle();
    
    console.log(`   Before: ${startupsBefore ? `Already tracked (${startupsBefore.total_actions} actions)` : 'Not tracked'}`);
    
    // Try to track
    const isInternalStartups = await checkIsInternal(yourUserId, startupsOrg.id);
    console.log(`   isInternalTeamMember: ${isInternalStartups}`);
    
    if (!isInternalStartups) {
      await trackedUsersService.trackUser(startupsOrg.id, yourEmail, 'vote', {
        email: yourEmail,
        name: 'Swarup Basu'
      });
    }
    
    // Check after count
    const { data: startupsAfter } = await supabaseAdmin
      .from('tracked_users')
      .select('*')
      .eq('organization_id', startupsOrg.id)
      .eq('user_identifier', yourEmail)
      .eq('billing_period', '2026-01')
      .maybeSingle();
    
    console.log(`   After: ${startupsAfter ? `Tracked! (${startupsAfter.total_actions} actions)` : 'Not tracked'}`);
    console.log(`   ✅ Result: ${!isInternalStartups && startupsAfter ? '✅ CORRECTLY TRACKED' : '❌ SHOULD HAVE TRACKED'}`);
    
    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 Summary:`);
    console.log(`   Notion org: ${isInternalNotion ? '✅ Correctly skipped' : '❌ Should skip'}`);
    console.log(`   Startups org: ${!isInternalStartups && startupsAfter ? '✅ Correctly tracked' : '❌ Should track'}`);
    console.log(`\n✅ Fix is ${(isInternalNotion && !isInternalStartups && startupsAfter) ? 'WORKING!' : 'NOT working yet'}`);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
  }
})();

// Helper function
async function checkIsInternal(userId, organizationId) {
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  
  return data && ['owner', 'admin', 'member'].includes(data.role);
}
