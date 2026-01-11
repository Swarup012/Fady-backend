const axios = require('axios');
require('dotenv').config();

const BACKEND_URL = 'http://localhost:3000';

// You'll need to replace these with actual values from your database
const TEST_USER_TOKEN = process.argv[2]; // Pass token as argument
const TEST_ORG_ID = process.argv[3]; // Pass org ID as argument

async function testTracking() {
  console.log('🧪 Testing Tracked Users Feature\n');

  if (!TEST_USER_TOKEN) {
    console.error('❌ Please provide user token as argument:');
    console.error('   node test-tracking.js YOUR_TOKEN YOUR_ORG_ID');
    console.error('\n💡 Get your token from browser localStorage or login response');
    process.exit(1);
  }

  try {
    // Step 1: Check current count
    console.log('1️⃣ Checking current tracked users count...');
    const countBefore = await axios.get(`${BACKEND_URL}/api/tracked-users/count`, {
      headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` }
    });
    console.log(`   Current: ${countBefore.data.data.count} / ${countBefore.data.data.limit}`);

    // Step 2: Get boards to post to
    console.log('\n2️⃣ Getting boards...');
    const boardsResponse = await axios.get(`${BACKEND_URL}/api/boards`, {
      headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` }
    });
    
    if (!boardsResponse.data.data || boardsResponse.data.data.length === 0) {
      console.error('❌ No boards found. Please create a board first.');
      return;
    }
    
    const board = boardsResponse.data.data[0];
    console.log(`   Using board: ${board.name} (${board.slug})`);

    // Step 3: Create a test post
    console.log('\n3️⃣ Creating test post...');
    const postData = {
      title: `Test Post for Tracking - ${Date.now()}`,
      description: 'Testing if tracked users feature works correctly'
    };

    const postResponse = await axios.post(
      `${BACKEND_URL}/api/boards/${board.slug}/posts`,
      postData,
      { headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` } }
    );

    if (postResponse.data.success) {
      console.log(`   ✅ Post created: ${postResponse.data.data.title}`);
    }

    // Step 4: Wait a moment for tracking to complete
    console.log('\n4️⃣ Waiting for tracking to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 5: Check count again
    console.log('\n5️⃣ Checking tracked users count again...');
    const countAfter = await axios.get(`${BACKEND_URL}/api/tracked-users/count`, {
      headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` }
    });
    console.log(`   New count: ${countAfter.data.data.count} / ${countAfter.data.data.limit}`);

    // Step 6: Verify tracking worked
    if (countAfter.data.data.count > countBefore.data.data.count) {
      console.log('\n✅ SUCCESS! User was tracked!');
      console.log(`   Tracked users increased from ${countBefore.data.data.count} to ${countAfter.data.data.count}`);
    } else if (countBefore.data.data.count > 0) {
      console.log('\n⚠️  Count did not increase (user may have been tracked before in this billing period)');
    } else {
      console.log('\n❌ FAILED! User was not tracked');
    }

    // Step 7: Get usage details
    console.log('\n6️⃣ Getting detailed usage stats...');
    const usageResponse = await axios.get(`${BACKEND_URL}/api/tracked-users/usage`, {
      headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` }
    });
    
    const usage = usageResponse.data.data;
    console.log(`   Total tracked: ${usage.count}`);
    console.log(`   Breakdown:`);
    console.log(`     - Posts created: ${usage.breakdown.create_post}`);
    console.log(`     - Votes cast: ${usage.breakdown.vote}`);
    console.log(`     - Comments made: ${usage.breakdown.comment}`);
    console.log(`   Status: ${usage.status}`);

  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.error('   Token is invalid or expired. Please get a fresh token.');
    }
  }
}

testTracking();
