require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Using SUPABASE_SERVICE_KEY from .env
);

(async () => {
  const { data: orgs } = await supabase.from('organizations').select('*');
  const { data: members } = await supabase.from('organization_members').select('*');
  const { data: users } = await supabase.from('users').select('id, email, name, current_organization_id, onboarding_completed').order('created_at', { ascending: false }).limit(5);
  
  console.log('\n📊 Database Status:\n');
  console.log('Organizations:', orgs?.length || 0);
  if (orgs) orgs.forEach(o => console.log('  -', o.name, '(' + o.subdomain + ')'));
  
  console.log('\nOrganization Members:', members?.length || 0);
  if (members) members.forEach(m => {
    const jobInfo = m.job_role ? ` (${m.job_role})` : '';
    console.log('  - User:', m.user_id.slice(0,8), '→ Org:', m.organization_id.slice(0,8), '- Role:', m.role + jobInfo);
  });
  
  console.log('\nRecent Users:');
  if (users) users.forEach(u => {
    const orgId = u.current_organization_id ? u.current_organization_id.slice(0,8) : 'NULL';
    const onboarded = u.onboarding_completed ? '✅' : '❌';
    console.log('  -', u.email, '- current_org:', orgId, '- onboarded:', onboarded);
  });
})();
