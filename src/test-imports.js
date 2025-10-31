// Create this file: src/test-imports.js
// Run with: node src/test-imports.js

console.log('\n=== TESTING IMPORTS ===\n');

// Test 1: Controller
try {
  const roadmapController = require('./controllers/roadmap.controller');
  console.log('✅ roadmapController imported');
  console.log('   Type:', typeof roadmapController);
  console.log('   Is Object:', typeof roadmapController === 'object');
  
  if (roadmapController) {
    const methods = Object.keys(roadmapController);
    console.log('   Methods count:', methods.length);
    console.log('   Methods:', methods.slice(0, 5).join(', '), '...');
    
    // Test specific methods
    console.log('\n   Testing specific methods:');
    console.log('   - getPublicRoadmapItems:', typeof roadmapController.getPublicRoadmapItems);
    console.log('   - getRoadmapItems:', typeof roadmapController.getRoadmapItems);
    console.log('   - createRoadmapItem:', typeof roadmapController.createRoadmapItem);
  }
} catch (error) {
  console.log('❌ Error importing roadmapController:', error.message);
}

console.log('\n---\n');

// Test 2: Service
try {
  const roadmapService = require('./services/roadmap.service');
  console.log('✅ roadmapService imported');
  console.log('   Type:', typeof roadmapService);
  
  if (roadmapService) {
    const methods = Object.keys(roadmapService);
    console.log('   Methods count:', methods.length);
    console.log('   Methods:', methods.slice(0, 5).join(', '), '...');
  }
} catch (error) {
  console.log('❌ Error importing roadmapService:', error.message);
}

console.log('\n---\n');

// Test 3: Auth Middleware (check both patterns)
try {
  const authMiddleware1 = require('./middleware/auth.middleware');
  console.log('✅ authMiddleware (direct) imported');
  console.log('   Type:', typeof authMiddleware1);
  console.log('   Is Function:', typeof authMiddleware1 === 'function');
  
  if (typeof authMiddleware1 === 'object') {
    console.log('   Keys:', Object.keys(authMiddleware1));
  }
} catch (error) {
  console.log('❌ Error importing authMiddleware (direct):', error.message);
}

try {
  const { authMiddleware } = require('./middleware/auth.middleware');
  console.log('✅ authMiddleware (destructured) imported');
  console.log('   Type:', typeof authMiddleware);
  console.log('   Is Function:', typeof authMiddleware === 'function');
} catch (error) {
  console.log('❌ Error importing authMiddleware (destructured):', error.message);
}

console.log('\n=== END TEST ===\n');
