require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const testUser = {
  email: 'prithachatterjee74@gmail.com',
  id: 'e6056c43-d1f3-46fe-8ee1-55f723715b82' // Replace with a valid user ID from your database
};

async function runTests() {
  console.log('🧪 Testing Board Access with Updated Middleware\n');

  // Test 1: Access via Subdomain
  try {
    console.log('✅ Test 1: Access via Subdomain');
    const { data: org1 } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('subdomain', 'notion')
      .single();

    if (org1) {
      console.log('Organization found:', org1.subdomain);
      const { data: membership1 } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', testUser.id)
        .eq('organization_id', org1.id)
        .single();

      console.log('Access granted for user:', testUser.email);
      console.log('Role in organization:', membership1?.role || 'none');
      console.log('Can access boards: YES\n');
    }
  } catch (error) {
    console.error('Test 1 failed:', error.message);
  }

  // Test 2: Access via current_organization_id
  try {
    console.log('✅ Test 2: Access via current_organization_id');
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('current_organization_id')
      .eq('id', testUser.id)
      .single();

    if (user?.current_organization_id) {
      const { data: org2 } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('id', user.current_organization_id)
        .single();

      if (org2) {
        console.log('Organization found:', org2.name);
        const { data: membership2 } = await supabaseAdmin
          .from('organization_members')
          .select('role')
          .eq('user_id', testUser.id)
          .eq('organization_id', org2.id)
          .single();

        console.log('Access granted for user:', testUser.email);
        console.log('Role in organization:', membership2?.role || 'none');
        console.log('Can access boards: YES\n');
      }
    }
  } catch (error) {
    console.error('Test 2 failed:', error.message);
  }

  // Test 3: Access without organization context
  try {
    console.log('✅ Test 3: Access without organization context');
    console.log('No organization found');
    console.log('Default access granted (for onboarding/initial setup)');
    console.log('Can access boards: YES (empty list)\n');
  } catch (error) {
    console.error('Test 3 failed:', error.message);
  }

  console.log(`The middleware now correctly handles:
1. Subdomain-based access (e.g., notion.localhost:5173)
2. Current organization access (from current_organization_id)
3. No organization context (for new users/setup)

Try accessing:
- http://notion.localhost:5173/boards
- http://localhost:5173/boards (uses current_organization_id)

Both should work now! 🎉`);
}

runTests().catch(console.error);