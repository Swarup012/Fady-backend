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

async function debugBoardAccess() {
  try {
    console.log('\n🔍 DEBUGGING BOARD ACCESS ISSUE\n');
    
    const pritha_id = '02a2df7e-06b6-474a-9514-f97311bf7851';
    const swarup_id = 'd64dd6c8-2b4b-4d40-a3dd-dcb1064c1174';
    const notion_org_id = '56c9e22a-cff5-474f-a6ab-fb4a753bfea5';

    // Test Pritha's access
    console.log('1️⃣ Checking Pritha\'s Organization Membership\n');
    
    const { data: prithaUser } = await supabaseAdmin
      .from('users')
      .select('id, email, current_organization_id')
      .eq('id', pritha_id)
      .single();
    
    console.log('Pritha User:', prithaUser);
    
    const { data: prithaMembership } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', pritha_id);
    
    console.log('Pritha Memberships:', prithaMembership);
    
    // Test Swarup's access
    console.log('\n2️⃣ Checking Swarup\'s Organization Membership\n');
    
    const { data: swarupUser } = await supabaseAdmin
      .from('users')
      .select('id, email, current_organization_id')
      .eq('id', swarup_id)
      .single();
    
    console.log('Swarup User:', swarupUser);
    
    const { data: swarupMembership } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', swarup_id);
    
    console.log('Swarup Memberships:', swarupMembership);
    
    // Check boards
    console.log('\n3️⃣ Checking Boards in Notion Org\n');
    
    const { data: boards } = await supabaseAdmin
      .from('boards')
      .select('id, name, slug, organization_id')
      .eq('organization_id', notion_org_id);
    
    console.log(`Found ${boards?.length || 0} boards in notion org:`, boards);
    
    // Check what URL they're using
    console.log('\n4️⃣ Common Issues and Solutions\n');
    console.log('❌ Problem: 403 Forbidden when trying to access boards');
    console.log('\n✅ Solutions:');
    console.log('   1. Make sure you\'re accessing from: notion.localhost:5173');
    console.log('      NOT just: localhost:5173');
    console.log('   2. The subdomain must match the organization');
    console.log('   3. You must be logged in as a member of that organization');
    console.log('\n📝 URLs to use:');
    console.log('   • http://notion.localhost:5173/admin');
    console.log('   • http://notion.localhost:5173/boards');
    console.log('   • http://notion.localhost:5173/admin/feedback');
    console.log('\n⚠️ DON\'T use:');
    console.log('   • http://localhost:5173/admin  ← No subdomain!');
    
    // Check if DNS resolution works
    console.log('\n5️⃣ Quick Test\n');
    console.log('Run this in your browser console:');
    console.log('  window.location.hostname');
    console.log('\nShould show: "notion.localhost"');
    console.log('NOT: "localhost"');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugBoardAccess();
