require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Fix existing users who completed onboarding but don't have proper organization_members records
 */
async function fixExistingUsers() {
  console.log('🔧 Fixing existing users who completed onboarding...\n');

  try {
    // 1. Find users with organization_id but no organization_members entry
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, organization_id, current_organization_id, organization_role')
      .not('organization_id', 'is', null);

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }

    console.log(`Found ${users.length} users with organization_id set\n`);

    for (const user of users) {
      console.log(`\n👤 Processing user: ${user.email}`);
      console.log(`   Organization ID: ${user.organization_id}`);
      console.log(`   Current Org ID: ${user.current_organization_id}`);
      console.log(`   Role: ${user.organization_role}`);

      // Check if they have an organization_members entry
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('*')
        .eq('user_id', user.id)
        .eq('organization_id', user.organization_id)
        .single();

      if (memberError && memberError.code === 'PGRST116') {
        // No entry found - create one
        console.log(`   ❌ No organization_members entry found. Creating...`);
        
        const { error: insertError } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: user.id,
            organization_id: user.organization_id,
            role: user.organization_role || 'owner',
            joined_at: new Date().toISOString(),
          });

        if (insertError) {
          console.error(`   ❌ Failed to create membership:`, insertError.message);
        } else {
          console.log(`   ✅ Created organization_members entry with role: ${user.organization_role || 'owner'}`);
        }
      } else if (membership) {
        console.log(`   ✅ Organization_members entry already exists with role: ${membership.role}`);
      } else {
        console.error(`   ❌ Error checking membership:`, memberError);
      }

      // Set current_organization_id if not set
      if (!user.current_organization_id && user.organization_id) {
        console.log(`   🔄 Setting current_organization_id to ${user.organization_id}...`);
        
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ current_organization_id: user.organization_id })
          .eq('id', user.id);

        if (updateError) {
          console.error(`   ❌ Failed to update current_organization_id:`, updateError.message);
        } else {
          console.log(`   ✅ Set current_organization_id`);
        }
      }
    }

    console.log('\n\n✅ Migration complete!');
    console.log('\nSummary:');
    console.log(`- Total users processed: ${users.length}`);
    console.log('- All users now have proper organization_members entries');
    console.log('- All users have current_organization_id set');

  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

fixExistingUsers().catch(console.error);
