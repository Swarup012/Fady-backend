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

async function fixCorrectOwner() {
  try {
    const notionOrgId = '56c9e22a-cff5-474f-a6ab-fb4a753bfea5';

    // Get both users
    const { data: swarup } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', 'swarupbasu325@gmail.com')
      .single();

    const { data: pritha } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', 'prithachatterjee74@gmail.com')
      .single();

    console.log('\n📋 Current State:');
    console.log(`swarupbasu325: current_org = ${swarup.current_organization_id || 'none'}`);
    console.log(`prithachatterjee74: current_org = ${pritha.current_organization_id || 'none'}`);

    // 1. Update prithachatterjee74 to member
    console.log('\n1️⃣ Changing prithachatterjee74 to member...');
    const { error: updateError } = await supabaseAdmin
      .from('organization_members')
      .update({ role: 'member' })
      .eq('user_id', pritha.id)
      .eq('organization_id', notionOrgId);

    if (updateError) {
      console.error('❌ Error updating pritha to member:', updateError);
    } else {
      console.log('✅ prithachatterjee74 now has role: member');
    }

    // 2. Add swarupbasu325 as owner
    console.log('\n2️⃣ Adding swarupbasu325 as owner...');
    
    // First check if already exists
    const { data: existingMember } = await supabaseAdmin
      .from('organization_members')
      .select('*')
      .eq('user_id', swarup.id)
      .eq('organization_id', notionOrgId)
      .single();

    if (existingMember) {
      // Update existing
      const { error: updateOwnerError } = await supabaseAdmin
        .from('organization_members')
        .update({ role: 'owner' })
        .eq('user_id', swarup.id)
        .eq('organization_id', notionOrgId);

      if (updateOwnerError) {
        console.error('❌ Error updating swarup to owner:', updateOwnerError);
      } else {
        console.log('✅ Updated swarupbasu325 to owner');
      }
    } else {
      // Insert new
      const { error: insertError } = await supabaseAdmin
        .from('organization_members')
        .insert({
          user_id: swarup.id,
          organization_id: notionOrgId,
          role: 'owner',
          joined_at: new Date().toISOString()
        });

      if (insertError) {
        console.error('❌ Error inserting swarup as owner:', insertError);
      } else {
        console.log('✅ Added swarupbasu325 as owner');
      }
    }

    // 3. Set swarupbasu325's current_organization_id
    console.log('\n3️⃣ Setting swarupbasu325 current_organization_id...');
    const { error: updateUserError } = await supabaseAdmin
      .from('users')
      .update({ current_organization_id: notionOrgId })
      .eq('id', swarup.id);

    if (updateUserError) {
      console.error('❌ Error updating swarup current org:', updateUserError);
    } else {
      console.log('✅ swarupbasu325 current_organization_id set');
    }

    console.log('\n✅ CORRECTION COMPLETE!\n');
    console.log('Final Structure:');
    console.log('  • swarupbasu325@gmail.com: owner');
    console.log('  • prithachatterjee74@gmail.com: member');

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

fixCorrectOwner();
