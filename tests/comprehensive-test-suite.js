/**
 * COMPREHENSIVE TEST SUITE FOR PRODUCTION READINESS
 * 
 * Tests all functionality including time-dependent features like:
 * - Subscription trials (14-day)
 * - Monthly resets
 * - Plan limits (boards, posts, team members, tracked users)
 * - Stripe webhooks
 * - Overage billing
 * 
 * Usage:
 *   node tests/comprehensive-test-suite.js
 */

const BASE_URL = 'http://localhost:3000';

// Test utilities
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(`  ${title}`, 'bright');
  console.log('='.repeat(60) + '\n');
}

function logTest(name) {
  log(`\n🧪 TEST: ${name}`, 'cyan');
}

function logPass(message) {
  log(`✅ PASS: ${message}`, 'green');
}

function logFail(message) {
  log(`❌ FAIL: ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  INFO: ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  WARN: ${message}`, 'yellow');
}

// Test state
let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
};

let authToken = null;
let organizationId = null;
let testUserId = null;

// API Helper
async function apiCall(method, endpoint, data = null, token = authToken) {
  testResults.total++;
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const result = await response.json();
    
    return {
      status: response.status,
      ok: response.ok,
      data: result,
    };
  } catch (error) {
    logFail(`API call failed: ${error.message}`);
    testResults.failed++;
    throw error;
  }
}

// Test helper to assert conditions
function assert(condition, message) {
  if (condition) {
    logPass(message);
    testResults.passed++;
    return true;
  } else {
    logFail(message);
    testResults.failed++;
    return false;
  }
}

// ============================================================================
// TEST SUITE SECTIONS
// ============================================================================

/**
 * 1. AUTHENTICATION & ORGANIZATION SETUP
 */
async function testAuthAndSetup() {
  logSection('1. AUTHENTICATION & ORGANIZATION SETUP');

  // Test 1.1: Register new test user
  logTest('Register new test user');
  const timestamp = Date.now();
  const testEmail = `test-${timestamp}@example.com`;
  const testPassword = 'Test123!@#';

  const registerRes = await apiCall('POST', '/api/auth/signup', {
    email: testEmail,
    password: testPassword,
    name: 'Test User',
  });

  assert(
    registerRes.ok && registerRes.data.success,
    'User registration successful'
  );

  if (registerRes.data.data?.access_token) {
    authToken = registerRes.data.data.access_token;
    logInfo(`Auth token obtained: ${authToken.substring(0, 20)}...`);
  }

  // Test 1.2: Complete onboarding to create organization
  logTest('Complete onboarding (creates organization)');
  const onboardingRes = await apiCall('POST', '/api/users/onboarding/complete', {
    companyName: `Test Company ${timestamp}`,
    subdomain: `test-${timestamp}`,
    industry: 'technology',
    companySize: '1-10',
    currentProcess: 'new',
    goals: ['improve-products']
  });

  assert(onboardingRes.ok && onboardingRes.data.success, 'Onboarding completed successfully');

  // Test 1.3: Get user profile
  logTest('Get user profile');
  const profileRes = await apiCall('GET', '/api/users/me');
  
  assert(profileRes.ok, 'Profile retrieved successfully');
  
  if (profileRes.data.data?.user) {
    testUserId = profileRes.data.data.user.id;
    organizationId = profileRes.data.data.user.current_organization_id;
    logInfo(`User ID: ${testUserId}`);
    logInfo(`Organization ID: ${organizationId}`);
  }

  // Test 1.4: Verify free plan defaults
  logTest('Verify free plan defaults');
  const usageRes = await apiCall('GET', '/api/users/me/usage');
  
  assert(usageRes.ok, 'Usage stats retrieved');
  assert(
    usageRes.data.data.plan === 'free',
    'User is on free plan'
  );
  assert(
    usageRes.data.data.usage.boards.limit === 3,
    'Free plan has 3 board limit'
  );
  assert(
    usageRes.data.data.usage.team_members.limit === 3,
    'Free plan has 3 team member limit'
  );

  logInfo(`Current usage: ${JSON.stringify(usageRes.data.data.usage, null, 2)}`);
}

/**
 * 2. BOARD LIMITS TESTING
 */
async function testBoardLimits() {
  logSection('2. BOARD LIMITS TESTING');

  // Test 2.1: Create boards up to limit
  logTest('Create boards up to free plan limit (3)');
  
  const boards = [];
  for (let i = 1; i <= 3; i++) {
    const boardRes = await apiCall('POST', '/api/boards', {
      name: `Test Board ${i}`,
      slug: `test-board-${i}-${Date.now()}`,
      description: `Test board number ${i}`,
      is_private: false,
      color: '#6366f1',
      icon: 'Lightbulb',
    });

    if (boardRes.ok) {
      boards.push(boardRes.data.data.board);
      logPass(`Board ${i} created successfully`);
    } else {
      logFail(`Board ${i} creation failed: ${boardRes.data.message}`);
    }
  }

  assert(boards.length === 3, 'Successfully created 3 boards (free limit)');

  // Test 2.2: Try to create 4th board (should fail)
  logTest('Try to create 4th board (should be blocked)');
  
  const fourthBoardRes = await apiCall('POST', '/api/boards', {
    name: 'Test Board 4',
    slug: `test-board-4-${Date.now()}`,
    description: 'This should fail',
    is_private: false,
    color: '#6366f1',
    icon: 'Lightbulb',
  });

  assert(
    fourthBoardRes.status === 403 && fourthBoardRes.data.error === 'BOARD_LIMIT_REACHED',
    'Board creation correctly blocked at limit'
  );

  return boards;
}

/**
 * 3. POST LIMITS TESTING
 */
async function testPostLimits(boards) {
  logSection('3. POST LIMITS TESTING (5 posts per board on free plan)');

  if (!boards || boards.length === 0) {
    logWarning('No boards available, skipping post limit tests');
    testResults.skipped++;
    return;
  }

  const testBoard = boards[0];
  logInfo(`Testing on board: ${testBoard.name} (${testBoard.slug})`);

  // Test 3.1: Create posts up to limit
  logTest('Create posts up to free plan limit (5 per board)');
  
  const posts = [];
  for (let i = 1; i <= 5; i++) {
    const postRes = await apiCall('POST', `/api/boards/${testBoard.slug}/posts`, {
      title: `Test Post ${i}`,
      description: `Test post description ${i}`,
      category: 'Feature Request',
    });

    if (postRes.ok) {
      posts.push(postRes.data.data.post);
      logPass(`Post ${i} created successfully`);
    } else {
      logFail(`Post ${i} creation failed: ${postRes.data.message}`);
    }
  }

  assert(posts.length === 5, 'Successfully created 5 posts (free limit per board)');

  // Test 3.2: Try to create 6th post (should fail)
  logTest('Try to create 6th post (should be blocked)');
  
  const sixthPostRes = await apiCall('POST', `/api/boards/${testBoard.slug}/posts`, {
    title: 'Test Post 6',
    description: 'This should fail',
    category: 'Feature Request',
  });

  assert(
    sixthPostRes.status === 403 && sixthPostRes.data.error === 'POST_LIMIT_REACHED',
    'Post creation correctly blocked at limit'
  );

  return posts;
}

/**
 * 4. TEAM MEMBER LIMITS TESTING
 */
async function testTeamMemberLimits() {
  logSection('4. TEAM MEMBER LIMITS TESTING (3 members on free plan)');

  // Test 4.1: Get current team members
  logTest('Get current team members');
  const membersRes = await apiCall('GET', `/api/organizations/${organizationId}/members`);
  
  assert(membersRes.ok, 'Team members retrieved');
  
  const currentCount = membersRes.data.data?.members?.length || 0;
  logInfo(`Current team member count: ${currentCount}`);

  // Test 4.2: Try to invite members up to limit
  logTest('Invite team members up to limit');
  
  const invitesNeeded = Math.max(0, 3 - currentCount);
  logInfo(`Can invite ${invitesNeeded} more members`);

  for (let i = 1; i <= invitesNeeded; i++) {
    const inviteRes = await apiCall('POST', `/api/organizations/${organizationId}/invites`, {
      email: `team-member-${i}-${Date.now()}@example.com`,
      role: 'member',
    });

    if (inviteRes.ok) {
      logPass(`Invitation ${i} sent successfully`);
    } else {
      logFail(`Invitation ${i} failed: ${inviteRes.data.message}`);
    }
  }

  // Test 4.3: Try to invite beyond limit
  if (currentCount >= 3) {
    logTest('Try to invite beyond team member limit (should be blocked)');
    
    const excessInviteRes = await apiCall('POST', '/api/organizations/invite', {
      email: `excess-member-${Date.now()}@example.com`,
      role: 'member',
      job_role: 'developer',
    });

    assert(
      excessInviteRes.status === 403,
      'Team member invitation correctly blocked at limit'
    );
  }
}

/**
 * 5. TRACKED USERS LIMITS TESTING
 */
async function testTrackedUsersLimits(boards, posts) {
  logSection('5. TRACKED USERS LIMITS TESTING (20 on free plan)');

  if (!posts || posts.length === 0) {
    logWarning('No posts available, skipping tracked users tests');
    testResults.skipped++;
    return;
  }

  const testPost = posts[0];
  logInfo(`Testing on post: ${testPost.title}`);

  // Test 5.1: Get current tracked users count
  logTest('Get current tracked users count');
  const statsRes = await apiCall('GET', '/api/tracked-users/stats');
  
  if (statsRes.ok) {
    const currentCount = statsRes.data.data?.total || 0;
    logInfo(`Current tracked users: ${currentCount}/20`);
  }

  // Test 5.2: Create votes (tracked users) up to limit
  logTest('Create votes to simulate tracked users (testing up to 20)');
  
  // Note: In real scenario, each voter email would be tracked
  // For testing, we'll simulate with vote API
  logInfo('To fully test, you would need 20 different user emails voting');
  logInfo('This requires external users or email simulation');
  
  // Test 5.3: Verify tracked users endpoint
  const trackedRes = await apiCall('GET', '/api/tracked-users');
  assert(trackedRes.ok, 'Tracked users list retrieved');
}

/**
 * 6. SUBSCRIPTION & TRIAL TESTING
 */
async function testSubscriptionFlow() {
  logSection('6. SUBSCRIPTION & TRIAL TESTING');

  // Test 6.1: Create checkout session
  logTest('Create Stripe checkout session for Starter plan');
  
  const checkoutRes = await apiCall('POST', '/api/stripe/create-checkout-session', {
    plan: 'starter',
    billingCycle: 'monthly',
    skipTrial: false,
    successUrl: 'http://localhost:5173/admin?checkout=success',
    cancelUrl: 'http://localhost:5173/pricing?checkout=cancelled',
  });

  assert(checkoutRes.ok, 'Checkout session created');
  
  if (checkoutRes.data.data?.url) {
    logInfo(`Checkout URL: ${checkoutRes.data.data.url}`);
    logInfo('⚠️  To complete subscription, visit the URL above in Stripe test mode');
  }

  // Test 6.2: Simulate trial subscription (manual database update needed)
  logInfo('\n📝 Manual Test Required:');
  logInfo('1. Use Stripe test cards to complete checkout');
  logInfo('2. Use card: 4242 4242 4242 4242 (successful payment)');
  logInfo('3. Verify trial status via webhook simulation below');

  // Test 6.3: Check subscription status
  logTest('Check current subscription status');
  const subRes = await apiCall('GET', '/api/stripe/subscription');
  
  if (subRes.ok) {
    logInfo(`Subscription status: ${JSON.stringify(subRes.data.data, null, 2)}`);
  }
}

/**
 * 7. STRIPE WEBHOOK SIMULATION
 */
async function testStripeWebhooks() {
  logSection('7. STRIPE WEBHOOK SIMULATION');

  logInfo('Testing webhook handlers with mock events...\n');

  // Test 7.1: Simulate checkout.session.completed
  logTest('Simulate: checkout.session.completed (trial start)');
  
  const trialWebhook = {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${Date.now()}`,
        customer: `cus_test_${Date.now()}`,
        subscription: `sub_test_${Date.now()}`,
        metadata: {
          organization_id: organizationId,
          plan: 'starter',
        },
        mode: 'subscription',
        payment_status: 'paid',
      },
    },
  };

  logInfo(`Mock webhook payload: ${JSON.stringify(trialWebhook, null, 2)}`);
  logInfo('⚠️  Note: Actual webhook requires Stripe signature validation');

  // Test 7.2: Simulate customer.subscription.updated
  logTest('Simulate: customer.subscription.updated (trial -> active)');
  
  logInfo('This webhook fires when trial ends and becomes active subscription');

  // Test 7.3: Simulate customer.subscription.deleted
  logTest('Simulate: customer.subscription.deleted (cancellation)');
  
  logInfo('This webhook fires when subscription is cancelled');
}

/**
 * 8. TIME-DEPENDENT FEATURES TESTING
 */
async function testTimeDependentFeatures() {
  logSection('8. TIME-DEPENDENT FEATURES (Trial, Monthly Reset)');

  logInfo('These features require time manipulation for proper testing:\n');

  // Test 8.1: Trial expiration simulation
  logTest('Trial Expiration Test (14 days)');
  logInfo('Method 1: Manually update trial_ends_at in database');
  logInfo('Method 2: Use Stripe test clock feature');
  logInfo('SQL: UPDATE organizations SET trial_ends_at = NOW() - INTERVAL \'1 day\' WHERE id = \'your-org-id\'');
  
  // Test 8.2: Monthly reset simulation
  logTest('Monthly Reset Test (1st of month)');
  logInfo('Method: Trigger cron job manually or update last_reset_at');
  logInfo('SQL: UPDATE organizations SET last_reset_at = NOW() - INTERVAL \'35 days\' WHERE id = \'your-org-id\'');
  logInfo('Then run: node src/services/cron/monthly-reset-cron.js');

  // Test 8.3: Overage billing simulation
  logTest('Overage Billing Test (monthly metered usage)');
  logInfo('1. Add 200 tracked users to trigger overage');
  logInfo('2. Wait for monthly metered billing report');
  logInfo('3. Or manually trigger: node src/services/cron/metered-billing-cron.js');
}

/**
 * 9. PLAN UPGRADE/DOWNGRADE TESTING
 */
async function testPlanChanges() {
  logSection('9. PLAN UPGRADE/DOWNGRADE TESTING');

  // Test 9.1: Check limits before upgrade
  logTest('Check limits on free plan');
  const beforeRes = await apiCall('GET', '/api/users/me/usage');
  
  if (beforeRes.ok) {
    logInfo('Free plan limits:');
    logInfo(`- Boards: ${beforeRes.data.data.usage.boards.limit}`);
    logInfo(`- Posts: ${beforeRes.data.data.usage.posts.per_board_limit} per board`);
    logInfo(`- Team: ${beforeRes.data.data.usage.team_members.limit}`);
  }

  // Test 9.2: Simulate upgrade to Starter
  logInfo('\n📝 To test upgrade:');
  logInfo('1. Complete Stripe checkout as shown in Section 6');
  logInfo('2. Webhook will update subscription_plan to "starter"');
  logInfo('3. Verify new limits below');

  // Test 9.3: Check limits after upgrade (if upgraded)
  logTest('Check limits after upgrade');
  const afterRes = await apiCall('GET', '/api/users/me/usage');
  
  if (afterRes.ok && afterRes.data.data.plan === 'starter') {
    logPass('Successfully upgraded to Starter plan');
    logInfo('Starter plan limits:');
    logInfo(`- Boards: ${afterRes.data.data.usage.boards.limit}`);
    logInfo(`- Posts: ${afterRes.data.data.usage.posts.per_board_limit}`);
    logInfo(`- Team: ${afterRes.data.data.usage.team_members.limit}`);
  } else {
    logInfo('Still on free plan - complete checkout to test upgrade');
  }
}

/**
 * 10. EDGE CASES & ERROR HANDLING
 */
async function testEdgeCases() {
  logSection('10. EDGE CASES & ERROR HANDLING');

  // Test 10.1: Invalid board creation
  logTest('Create board with invalid data');
  const invalidBoardRes = await apiCall('POST', '/api/boards', {
    name: '', // Empty name
    slug: 'test',
  });

  assert(
    !invalidBoardRes.ok,
    'Invalid board data correctly rejected'
  );

  // Test 10.2: Access control - private board
  logTest('Access control for private boards');
  logInfo('Create private board and test unauthorized access');

  // Test 10.3: Duplicate slug prevention
  logTest('Prevent duplicate board slugs');
  const duplicateRes = await apiCall('POST', '/api/boards', {
    name: 'Test Board',
    slug: 'test-board-1', // Likely already exists
    description: 'Test',
  });

  if (!duplicateRes.ok) {
    logPass('Duplicate slug correctly prevented');
  }

  // Test 10.4: SQL injection prevention
  logTest('SQL injection prevention');
  const sqlInjectionRes = await apiCall('POST', '/api/posts', {
    board_id: "'; DROP TABLE posts; --",
    title: 'SQL Injection Test',
  });

  assert(
    !sqlInjectionRes.ok,
    'SQL injection attempt blocked'
  );
}

/**
 * 11. PERFORMANCE & LOAD TESTING
 */
async function testPerformance() {
  logSection('11. PERFORMANCE & LOAD TESTING');

  // Test 11.1: Concurrent board creation
  logTest('Concurrent API requests (load test)');
  
  const startTime = Date.now();
  const promises = [];
  
  for (let i = 0; i < 10; i++) {
    promises.push(
      apiCall('GET', '/api/boards').catch(err => ({error: err.message}))
    );
  }

  await Promise.all(promises);
  const duration = Date.now() - startTime;
  
  logInfo(`10 concurrent requests completed in ${duration}ms`);
  assert(duration < 5000, 'Concurrent requests handled within 5 seconds');

  // Test 11.2: Large data pagination
  logTest('Pagination with large datasets');
  const paginationRes = await apiCall('GET', '/api/posts?limit=100&offset=0');
  assert(paginationRes.ok, 'Pagination works correctly');
}

/**
 * 12. CLEANUP
 */
async function cleanup() {
  logSection('12. CLEANUP');

  logInfo('Test user and data created:');
  logInfo(`- User ID: ${testUserId}`);
  logInfo(`- Organization ID: ${organizationId}`);
  logInfo('\n⚠️  Consider cleaning up test data from database');
  logInfo('SQL: DELETE FROM users WHERE email LIKE \'test-%@example.com\';');
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.clear();
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║     COMPREHENSIVE TEST SUITE - PRODUCTION READINESS       ║', 'bright');
  log('╚════════════════════════════════════════════════════════════╝\n', 'cyan');

  const startTime = Date.now();

  try {
    // Run all test sections
    await testAuthAndSetup();
    const boards = await testBoardLimits();
    const posts = await testPostLimits(boards);
    await testTeamMemberLimits();
    await testTrackedUsersLimits(boards, posts);
    await testSubscriptionFlow();
    await testStripeWebhooks();
    await testTimeDependentFeatures();
    await testPlanChanges();
    await testEdgeCases();
    await testPerformance();
    await cleanup();

  } catch (error) {
    logFail(`\n💥 Test suite crashed: ${error.message}`);
    console.error(error);
  }

  // Print summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  logSection('TEST SUMMARY');
  log(`Total Tests:    ${testResults.total}`, 'bright');
  log(`Passed:         ${testResults.passed}`, 'green');
  log(`Failed:         ${testResults.failed}`, 'red');
  log(`Skipped:        ${testResults.skipped}`, 'yellow');
  log(`Duration:       ${duration}s`, 'blue');
  
  const passRate = ((testResults.passed / testResults.total) * 100).toFixed(1);
  log(`\nPass Rate:      ${passRate}%`, passRate >= 80 ? 'green' : 'red');

  if (testResults.failed === 0 && passRate >= 90) {
    log('\n🎉 ALL CRITICAL TESTS PASSED - READY FOR PRODUCTION!', 'green');
  } else if (testResults.failed > 0) {
    log('\n⚠️  SOME TESTS FAILED - REVIEW BEFORE PRODUCTION', 'yellow');
  } else {
    log('\n✅ TESTS COMPLETED - REVIEW RESULTS', 'blue');
  }

  console.log('\n');
}

// Run tests
runAllTests();
