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

async function fixOrgOwner() {
  try {
    const notionOrgId = '56c9e22a-cff5-474f-a6ab-fb4a753bfea5';
    const userEmail = 'prithachatterjee74@gmail.com';
    
    console.log('🔧 Fixing organization owner...\n');
    
    // Get user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', userEmail)
      .single();
    
    console.log(`👤 User: ${user.email}`);
    console.log(`   ID: ${user.id}\n`);
    
    // Update organization_members to owner
    const { error: updateError } = await supabaseAdmin
      .from('organization_members')
      .update({ role: 'owner' })
      .eq('user_id', user.id)
      .eq('organization_id', notionOrgId);
    
    if (updateError) {
      console.log('❌ Error updating role:', updateError.message);
    } else {
      console.log('✅ Updated role to owner in organization_members');
    }
    
    // Update organizations table owner_id
    const { error: orgError } = await supabaseAdmin
      .from('organizations')
      .update({ owner_id: user.id })
      .eq('id', notionOrgId);
    
    if (orgError) {
      console.log('❌ Error updating organization:', orgError.message);
    } else {
      console.log('✅ Updated owner_id in organizations table\n');
    }
    
    // Verify
    console.log('📊 Verification:\n');
    
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', notionOrgId)
      .single();
    
    console.log(`   organization_members role: ${membership?.role || 'NOT FOUND'}`);
    
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', notionOrgId)
      .single();
    
    console.log(`   organization owner_id: ${org?.owner_id || 'NULL'}`);
    console.log(`   Match: ${org?.owner_id === user.id ? '✅' : '❌'}\n`);
    
    console.log('🎉 Done! User is now the owner.');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

fixOrgOwner();
