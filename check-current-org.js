// Check which organization the user is logged into
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkCurrentUser() {
  console.log('🔍 Available organizations:\n');
  
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, slug, subscription_status, subscription_plan')
    .order('created_at', { ascending: false });

  if (orgs) {
    orgs.forEach((org, i) => {
      const status = org.subscription_status === 'active' || org.subscription_status === 'trialing' ? '✅ PRO' : '❌ FREE';
      console.log(`${i + 1}. ${status} ${org.name} (${org.slug})`);
      console.log(`   ID: ${org.id}`);
      console.log(`   Status: ${org.subscription_status}, Plan: ${org.subscription_plan}\n`);
    });
  }

  console.log('\n💡 To check which org you are logged into:');
  console.log('1. Open browser console (F12)');
  console.log('2. Go to Application > Local Storage');
  console.log('3. Look for your auth token and check organization_id');
  console.log('\nOr run this in browser console:');
  console.log('fetch("/api/users/me").then(r=>r.json()).then(d=>console.log("Org ID:", d.data.user.organization_id))');
}

checkCurrentUser();
