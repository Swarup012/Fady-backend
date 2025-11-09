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

async function simulateMiddleware() {
  try {
    const userEmail = 'prithachatterjee74@gmail.com';
    
    console.log(`🔐 Simulating middleware for: ${userEmail}\n`);
    
    // Get user profile (like middleware does)
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', userEmail)
      .single();
    
    console.log(`👤 User Profile:`);
    console.log(`   Email: ${profile.email}`);
    console.log(`   Role (job): ${profile.role}`);
    console.log(`   Old organization_role: ${profile.organization_role} (DEPRECATED)`);
    console.log(`   Current org ID: ${profile.current_organization_id}\n`);
    
    // Get organization role from organization_members (like middleware does)
    if (profile.current_organization_id) {
      const { data: membership } = await supabaseAdmin
        .from('organization_members')
        .select('role, organization_id, organizations(name, subdomain)')
        .eq('user_id', profile.id)
        .eq('organization_id', profile.current_organization_id)
        .single();
      
      if (membership) {
        console.log(`🎭 Organization Membership:`);
        console.log(`   Organization: ${membership.organizations.name} (${membership.organizations.subdomain})`);
        console.log(`   Organization Role: ${membership.role} ✅ (FROM organization_members)\n`);
        
        // This is what gets sent to frontend
        const userForFrontend = {
          ...profile,
          organization_role: membership.role,  // Override with correct role
          organization_id: membership.organization_id
        };
        
        console.log(`📤 What frontend receives:`);
        console.log(`   user.role: "${userForFrontend.role}" (job function - for content filtering)`);
        console.log(`   user.organization_role: "${userForFrontend.organization_role}" (permission level - for access control)`);
        console.log(`   user.organization_id: "${userForFrontend.organization_id}"\n`);
        
        console.log(`🛡️  ProtectedRoute check:`);
        const allowedRoles = ['owner', 'admin', 'member'];
        const hasAccess = allowedRoles.includes(userForFrontend.organization_role);
        console.log(`   Required roles: ${allowedRoles.join(', ')}`);
        console.log(`   User has: "${userForFrontend.organization_role}"`);
        console.log(`   Has access: ${hasAccess ? '✅ YES' : '❌ NO'}\n`);
      }
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

simulateMiddleware();
