#!/usr/bin/env node

/**
 * Helper script to view a session by classroom code
 * 
 * Usage:
 *   node scripts/view-session.js --classroom-code=12345678
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function getArg(name, envVar) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.split('=')[1] || process.env[envVar];
}

const CLASSROOM_CODE = getArg('classroom-code', 'CLASSROOM_CODE');

async function viewSession() {
  if (!CLASSROOM_CODE) {
    console.error('❌ Missing classroom code!\n');
    console.error('Usage:');
    console.error('  node scripts/view-session.js --classroom-code=12345678');
    console.error('\nOr set environment variable:');
    console.error('  CLASSROOM_CODE=12345678 node scripts/view-session.js');
    process.exit(1);
  }

  console.log(`🔍 Looking up session for classroom code: ${CLASSROOM_CODE}\n`);

  try {
    // We need to query the database directly since there's no public API
    // Instead, we'll provide instructions on how to view it
    console.log('📋 To view this session:\n');
    console.log('Option 1: Use Student Login (Recommended)');
    console.log(`   1. Go to ${BASE_URL}`);
    console.log(`   2. Enter classroom code: ${CLASSROOM_CODE}`);
    console.log(`   3. Use any student credentials from the load test output`);
    console.log(`   4. You'll see all submissions from the test\n`);
    
    console.log('Option 2: Check Database');
    console.log(`   Query the Session table where classroomCode = '${CLASSROOM_CODE}'`);
    console.log(`   Then query PromptSubmission where sessionId matches\n`);
    
    console.log('⚠️  Important:');
    console.log('   - If you log in as TEACHER, it will create a NEW session');
    console.log('   - This will DEACTIVATE the test session');
    console.log('   - Always use STUDENT login to view test sessions\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

viewSession().catch(error => {
  console.error('❌ Failed:', error);
  process.exit(1);
});

