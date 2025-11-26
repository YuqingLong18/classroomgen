#!/usr/bin/env node

/**
 * Load testing script for image generation endpoint
 * 
 * Usage (single student - less realistic):
 *   node scripts/load-test.js --classroom-code=12345678 --username=student1 --password=pass123 --concurrent=20
 * 
 * Usage (multiple students - realistic simulation):
 *   node scripts/load-test.js --teacher-username=teacher1 --teacher-password=pass123 --students=20 --concurrent=20
 *   Note: Classroom code is automatically created when teacher logs in
 * 
 * Or set environment variables:
 *   TEACHER_USERNAME=teacher1 TEACHER_PASSWORD=pass123 STUDENTS=20 CONCURRENT=20 node scripts/load-test.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Parse arguments
function getArg(name, envVar) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.split('=')[1] || process.env[envVar];
}

const CLASSROOM_CODE = getArg('classroom-code', 'CLASSROOM_CODE');
const USERNAME = getArg('username', 'USERNAME');
const PASSWORD = getArg('password', 'PASSWORD');
const TEACHER_USERNAME = getArg('teacher-username', 'TEACHER_USERNAME');
const TEACHER_PASSWORD = getArg('teacher-password', 'TEACHER_PASSWORD');
const NUM_STUDENTS = parseInt(getArg('students', 'STUDENTS') || '0', 10);
const CONCURRENT = parseInt(getArg('concurrent', 'CONCURRENT') || '20', 10);

// Cookie names
const SESSION_COOKIE = 'classroom_session_id';
const ROLE_COOKIE = 'classroom_role';
const STUDENT_COOKIE = 'classroom_student_id';

// Test prompts (varied to simulate real usage)
const TEST_PROMPTS = [
  'A beautiful sunset over mountains with vibrant colors',
  'A futuristic cityscape with flying cars and neon lights',
  'A cute cat playing with a ball of yarn',
  'An abstract painting with geometric shapes',
  'A peaceful forest scene with sunlight filtering through trees',
  'A robot chef cooking in a modern kitchen',
  'A magical castle floating in the clouds',
  'A vintage car driving on a coastal road',
  'A space station orbiting a distant planet',
  'A cozy coffee shop interior with warm lighting',
  'A dragon flying over a medieval village',
  'A tropical beach with palm trees and turquoise water',
  'A steampunk airship in the sky',
  'A zen garden with raked sand and stones',
  'A cyberpunk street scene at night',
  'A fairy tale cottage in an enchanted forest',
  'A modern art gallery with abstract sculptures',
  'A vintage train station with steam engines',
  'A underwater scene with colorful coral reefs',
  'A mountain cabin surrounded by snow',
];

/**
 * Login as a teacher and get session cookies + classroom code
 */
async function loginTeacher(username, password) {
  const response = await fetch(`${BASE_URL}/api/teacher/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      password,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Login failed' }));
    throw new Error(`Teacher login failed: ${error.message || response.statusText}`);
  }

  // Extract cookies from Set-Cookie headers
  const cookies = {};
  const setCookieHeaders = response.headers.getSetCookie();
  
  for (const cookieHeader of setCookieHeaders) {
    const [nameValue] = cookieHeader.split(';');
    const [name, value] = nameValue.split('=');
    cookies[name.trim()] = value;
  }

  // Extract classroom code from response body
  const data = await response.json();
  const classroomCode = data.session?.classroomCode;

  if (!classroomCode) {
    throw new Error('Teacher login response missing classroom code');
  }

  return { cookies, classroomCode };
}

/**
 * Create test students via teacher API
 */
async function createTestStudents(teacherCookies, count) {
  const cookieString = [
    `${SESSION_COOKIE}=${teacherCookies[SESSION_COOKIE]}`,
    `${ROLE_COOKIE}=${teacherCookies[ROLE_COOKIE]}`,
  ].join('; ');

  const response = await fetch(`${BASE_URL}/api/teacher/students/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieString,
    },
    body: JSON.stringify({ count }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to create students' }));
    throw new Error(`Failed to create students: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  return data.credentials || [];
}

/**
 * Login as a student and get session cookies
 */
async function loginStudent(classroomCode, username, password) {
  const response = await fetch(`${BASE_URL}/api/student/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      classroomCode,
      username,
      password,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Login failed' }));
    throw new Error(`Login failed: ${error.message || response.statusText}`);
  }

  // Extract cookies from Set-Cookie headers
  const cookies = {};
  const setCookieHeaders = response.headers.getSetCookie();
  
  for (const cookieHeader of setCookieHeaders) {
    const [nameValue] = cookieHeader.split(';');
    const [name, value] = nameValue.split('=');
    cookies[name.trim()] = value;
  }

  return cookies;
}

/**
 * Send a single image generation request
 */
async function generateImage(cookies, prompt, requestId, studentUsername = 'unknown') {
  const startTime = Date.now();
  
  try {
    const cookieString = [
      `${SESSION_COOKIE}=${cookies[SESSION_COOKIE]}`,
      `${ROLE_COOKIE}=${cookies[ROLE_COOKIE]}`,
      `${STUDENT_COOKIE}=${cookies[STUDENT_COOKIE]}`,
    ].join('; ');

    const response = await fetch(`${BASE_URL}/api/images/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieString,
      },
      body: JSON.stringify({
        prompt,
      }),
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    const data = await response.json();

    return {
      requestId,
      studentUsername,
      success: response.ok,
      status: response.status,
      duration,
      prompt,
      submissionId: data.submission?.id,
      statusText: data.submission?.status,
      error: data.message,
      requestTime: startTime, // Track when request was sent
      cookies, // Keep cookies for polling
    };
  } catch (error) {
    const endTime = Date.now();
    return {
      requestId,
      studentUsername,
      success: false,
      status: 0,
      duration: endTime - startTime,
      prompt,
      error: error.message,
      requestTime: startTime,
      cookies,
    };
  }
}

/**
 * Fetch submissions for a student to check image generation status
 */
async function fetchSubmissions(cookies) {
  const cookieString = [
    `${SESSION_COOKIE}=${cookies[SESSION_COOKIE]}`,
    `${ROLE_COOKIE}=${cookies[ROLE_COOKIE]}`,
    `${STUDENT_COOKIE}=${cookies[STUDENT_COOKIE]}`,
  ].join('; ');

  const response = await fetch(`${BASE_URL}/api/images`, {
    method: 'GET',
    headers: {
      'Cookie': cookieString,
    },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return data.submissions || [];
}

/**
 * Poll for image generation completion
 */
async function pollForCompletion(results, maxWaitTime = 300000) { // 5 minutes max
  const pendingSubmissions = results
    .filter(r => r.success && r.submissionId && r.statusText === 'PENDING')
    .map(r => ({
      submissionId: r.submissionId,
      requestTime: r.requestTime,
      studentUsername: r.studentUsername,
      requestId: r.requestId,
      cookies: r.cookies,
    }));

  if (pendingSubmissions.length === 0) {
    return [];
  }

  console.log(`\n⏳ Polling for ${pendingSubmissions.length} image(s) to be generated...`);
  console.log(`   (This simulates students waiting for their images to appear)\n`);

  const startPollTime = Date.now();
  const completionTimes = [];
  const submissionIdToResult = new Map();
  pendingSubmissions.forEach(sub => {
    submissionIdToResult.set(sub.submissionId, sub);
  });

  const pollInterval = 2000; // Poll every 2 seconds
  let lastStatusUpdate = Date.now();

  while (Date.now() - startPollTime < maxWaitTime) {
    // Check each student's submissions
    const studentCookiesMap = new Map();
    pendingSubmissions.forEach(sub => {
      if (!studentCookiesMap.has(sub.studentUsername)) {
        studentCookiesMap.set(sub.studentUsername, sub.cookies);
      }
    });

    const checkPromises = Array.from(studentCookiesMap.entries()).map(async ([username, cookies]) => {
      try {
        const submissions = await fetchSubmissions(cookies);
        return { username, submissions };
      } catch (error) {
        return { username, submissions: [] };
      }
    });

    const studentSubmissions = await Promise.all(checkPromises);

    // Check for completed submissions
    const newlyCompleted = [];
    for (const { username, submissions } of studentSubmissions) {
      for (const submission of submissions) {
        if (submissionIdToResult.has(submission.id)) {
          const original = submissionIdToResult.get(submission.id);
          if (submission.status === 'SUCCESS' && !completionTimes.find(ct => ct.submissionId === submission.id)) {
            const completionTime = Date.now();
            const waitTime = completionTime - original.requestTime;
            newlyCompleted.push({
              submissionId: submission.id,
              requestId: original.requestId,
              studentUsername: username,
              requestTime: original.requestTime,
              completionTime,
              waitTime,
            });
            completionTimes.push({
              submissionId: submission.id,
              requestId: original.requestId,
              studentUsername: username,
              requestTime: original.requestTime,
              completionTime,
              waitTime,
            });
          } else if (submission.status === 'ERROR' && !completionTimes.find(ct => ct.submissionId === submission.id)) {
            const completionTime = Date.now();
            const waitTime = completionTime - original.requestTime;
            completionTimes.push({
              submissionId: submission.id,
              requestId: original.requestId,
              studentUsername: username,
              requestTime: original.requestTime,
              completionTime,
              waitTime,
              error: true,
            });
          }
        }
      }
    }

    if (newlyCompleted.length > 0) {
      const elapsed = ((Date.now() - startPollTime) / 1000).toFixed(1);
      console.log(`   ✅ ${newlyCompleted.length} image(s) completed (${elapsed}s elapsed)`);
      lastStatusUpdate = Date.now();
    }

    // Check if all are done
    if (completionTimes.length >= pendingSubmissions.length) {
      break;
    }

    // Show progress every 10 seconds
    if (Date.now() - lastStatusUpdate > 10000) {
      const elapsed = ((Date.now() - startPollTime) / 1000).toFixed(1);
      const remaining = pendingSubmissions.length - completionTimes.length;
      process.stdout.write(`   ⏳ ${remaining} image(s) still generating... (${elapsed}s elapsed)\r`);
      lastStatusUpdate = Date.now();
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  if (completionTimes.length < pendingSubmissions.length) {
    const remaining = pendingSubmissions.length - completionTimes.length;
    console.log(`\n   ⚠️  Timeout: ${remaining} image(s) did not complete within ${maxWaitTime / 1000}s`);
  } else {
    console.log(`\n   ✅ All images generated!\n`);
  }

  return completionTimes;
}

/**
 * Run concurrent load test
 */
async function runLoadTest() {
  // Determine test mode
  const useMultipleStudents = NUM_STUDENTS > 0 && TEACHER_USERNAME && TEACHER_PASSWORD;
  const useSingleStudent = USERNAME && PASSWORD && CLASSROOM_CODE;

  if (!useMultipleStudents && !useSingleStudent) {
    console.error('❌ Missing required parameters!\n');
    console.error('Option 1: Single student (less realistic):');
    console.error('  node scripts/load-test.js --classroom-code=12345678 --username=student1 --password=pass123 --concurrent=20\n');
    console.error('Option 2: Multiple students (realistic simulation):');
    console.error('  node scripts/load-test.js --teacher-username=teacher1 --teacher-password=pass123 --students=20 --concurrent=20\n');
    console.error('Or set environment variables:');
    console.error('  TEACHER_USERNAME=teacher1 TEACHER_PASSWORD=pass123 STUDENTS=20 CONCURRENT=20 node scripts/load-test.js');
    process.exit(1);
  }

  console.log('🚀 Starting load test...\n');
  console.log(`Configuration:`);
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Test Mode: ${useMultipleStudents ? `Multiple Students (${NUM_STUDENTS} students)` : 'Single Student'}`);
  console.log(`  Concurrent Requests: ${CONCURRENT}\n`);

  let studentCredentials = [];
  let studentCookies = [];
  let classroomCode = CLASSROOM_CODE;

  if (useMultipleStudents) {
    // Step 1: Login as teacher (this creates a new classroom session)
    console.log(`📝 Logging in as teacher (${TEACHER_USERNAME})...`);
    let teacherLoginResult;
    try {
      teacherLoginResult = await loginTeacher(TEACHER_USERNAME, TEACHER_PASSWORD);
      classroomCode = teacherLoginResult.classroomCode;
      console.log(`✅ Teacher login successful`);
      console.log(`📚 Classroom Code: ${classroomCode}\n`);
    } catch (error) {
      console.error(`❌ Teacher login failed: ${error.message}`);
      console.error('\nMake sure:');
      console.error('  1. The server is running (npm run dev)');
      console.error('  2. Teacher credentials are correct');
      process.exit(1);
    }

    // Step 2: Create test students
    console.log(`👥 Creating ${NUM_STUDENTS} test students...`);
    try {
      studentCredentials = await createTestStudents(teacherLoginResult.cookies, NUM_STUDENTS);
      console.log(`✅ Created ${studentCredentials.length} test students\n`);
      
      // Display first few student credentials for easy access
      console.log('📋 Student Credentials (use these to view the session):');
      const displayCount = Math.min(5, studentCredentials.length);
      for (let i = 0; i < displayCount; i++) {
        console.log(`   Student ${i + 1}: username="${studentCredentials[i].username}" password="${studentCredentials[i].password}"`);
      }
      if (studentCredentials.length > displayCount) {
        console.log(`   ... and ${studentCredentials.length - displayCount} more students`);
      }
      console.log('');
    } catch (error) {
      console.error(`❌ Failed to create students: ${error.message}`);
      process.exit(1);
    }

    // Step 3: Login all students
    console.log(`🔐 Logging in ${studentCredentials.length} students...`);
    const loginPromises = studentCredentials.map(async (cred, index) => {
      try {
        const cookies = await loginStudent(classroomCode, cred.username, cred.password);
        return { index, cookies, username: cred.username };
      } catch (error) {
        console.error(`  ⚠️  Failed to login student ${cred.username}: ${error.message}`);
        return null;
      }
    });

    const loginResults = await Promise.all(loginPromises);
    studentCookies = loginResults
      .filter(r => r !== null)
      .sort((a, b) => a.index - b.index)
      .map(r => ({ cookies: r.cookies, username: r.username }));

    console.log(`✅ Logged in ${studentCookies.length} students\n`);

    if (studentCookies.length === 0) {
      console.error('❌ No students could be logged in. Aborting test.');
      process.exit(1);
    }
  } else {
    // Single student mode
    console.log(`📝 Logging in as student (${USERNAME})...`);
    try {
      const cookies = await loginStudent(CLASSROOM_CODE, USERNAME, PASSWORD);
      studentCookies = [{ cookies, username: USERNAME }];
      console.log('✅ Login successful\n');
    } catch (error) {
      console.error(`❌ Login failed: ${error.message}`);
      console.error('\nMake sure:');
      console.error('  1. The server is running (npm run dev)');
      console.error('  2. The classroom code is correct');
      console.error('  3. The student account exists');
      process.exit(1);
    }
  }

  // Step 4: Send concurrent requests (distributed across students)
  console.log(`🔥 Sending ${CONCURRENT} concurrent requests${useMultipleStudents ? ` across ${studentCookies.length} students` : ''}...\n`);
  const testStartTime = Date.now();
  
  const prompts = Array.from({ length: CONCURRENT }, (_, i) => 
    TEST_PROMPTS[i % TEST_PROMPTS.length]
  );

  // Distribute requests across students (round-robin)
  const requests = prompts.map((prompt, index) => {
    const studentIndex = index % studentCookies.length;
    const student = studentCookies[studentIndex];
    return generateImage(student.cookies, prompt, index + 1, student.username);
  });

  const results = await Promise.all(requests);
  const testEndTime = Date.now();
  const totalDuration = testEndTime - testStartTime;

  // Step 5: Poll for actual image generation completion
  const completionTimes = await pollForCompletion(results);

  // Step 6: Analyze results
  console.log('📊 Results:\n');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  const durations = results.map(r => r.duration);
  durations.sort((a, b) => a - b);
  
  const min = durations[0];
  const max = durations[durations.length - 1];
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const median = durations[Math.floor(durations.length / 2)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];

  console.log(`Total Requests: ${results.length}`);
  if (useMultipleStudents) {
    // Show distribution by student
    const byStudent = {};
    results.forEach(r => {
      if (!byStudent[r.studentUsername]) {
        byStudent[r.studentUsername] = { total: 0, success: 0, failed: 0 };
      }
      byStudent[r.studentUsername].total++;
      if (r.success) {
        byStudent[r.studentUsername].success++;
      } else {
        byStudent[r.studentUsername].failed++;
      }
    });
    console.log(`Students Used: ${Object.keys(byStudent).length}`);
    console.log(`Requests per Student: ~${Math.ceil(results.length / Object.keys(byStudent).length)}`);
  }
  console.log(`Successful: ${successful.length} (${((successful.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed.length} (${((failed.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`\nResponse Time Statistics:`);
  console.log(`  Total Test Duration: ${totalDuration}ms`);
  console.log(`  Min Response Time: ${min}ms`);
  console.log(`  Max Response Time: ${max}ms`);
  console.log(`  Average Response Time: ${avg.toFixed(2)}ms`);
  console.log(`  Median Response Time: ${median}ms`);
  console.log(`  95th Percentile: ${p95}ms`);
  console.log(`  99th Percentile: ${p99}ms`);

  if (failed.length > 0) {
    console.log(`\n❌ Failed Requests:`);
    failed.forEach(result => {
      console.log(`  Request ${result.requestId} (${result.studentUsername}): ${result.error || `Status ${result.status}`}`);
    });
  }

  // Check if responses are fast (should be < 500ms since we return immediately)
  const fastResponses = successful.filter(r => r.duration < 500);
  const slowResponses = successful.filter(r => r.duration >= 500);
  
  console.log(`\n⚡ Performance Analysis:`);
  console.log(`  Fast responses (< 500ms): ${fastResponses.length} (${((fastResponses.length / successful.length) * 100).toFixed(1)}%)`);
  console.log(`  Slow responses (≥ 500ms): ${slowResponses.length} (${((slowResponses.length / successful.length) * 100).toFixed(1)}%)`);
  
  if (avg > 1000) {
    console.log(`\n⚠️  Warning: Average response time is high (> 1000ms).`);
    console.log(`   This suggests the server might be blocking requests.`);
  } else if (avg < 500) {
    console.log(`\n✅ Excellent: Average response time is low (< 500ms).`);
    console.log(`   The queue system is working correctly!`);
  }

  if (useMultipleStudents) {
    console.log(`\n✅ Realistic Test: Used ${studentCookies.length} different student accounts`);
    console.log(`   This accurately simulates ${studentCookies.length} users making concurrent requests.`);
  } else {
    console.log(`\n⚠️  Note: Using single student account. For realistic testing, use --students option.`);
  }

  // Step 7: Display image generation wait time statistics
  if (completionTimes.length > 0) {
    const waitTimes = completionTimes.map(ct => ct.waitTime);
    waitTimes.sort((a, b) => a - b);
    
    const minWait = waitTimes[0];
    const maxWait = waitTimes[waitTimes.length - 1];
    const avgWait = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
    const medianWait = waitTimes[Math.floor(waitTimes.length / 2)];
    const p95Wait = waitTimes[Math.floor(waitTimes.length * 0.95)];
    const p99Wait = waitTimes[Math.floor(waitTimes.length * 0.99)];

    const errors = completionTimes.filter(ct => ct.error);
    const successes = completionTimes.filter(ct => !ct.error);

    console.log('📸 Image Generation Wait Times (Request → Image Ready):\n');
    console.log(`   Total Images Generated: ${successes.length}`);
    if (errors.length > 0) {
      console.log(`   Errors: ${errors.length}`);
    }
    console.log(`\n   Wait Time Statistics:`);
    console.log(`     Min Wait Time: ${(minWait / 1000).toFixed(2)}s`);
    console.log(`     Max Wait Time: ${(maxWait / 1000).toFixed(2)}s`);
    console.log(`     Average Wait Time: ${(avgWait / 1000).toFixed(2)}s`);
    console.log(`     Median Wait Time: ${(medianWait / 1000).toFixed(2)}s`);
    console.log(`     95th Percentile: ${(p95Wait / 1000).toFixed(2)}s`);
    console.log(`     99th Percentile: ${(p99Wait / 1000).toFixed(2)}s`);

    // Show completion timeline
    if (completionTimes.length > 0) {
      console.log(`\n   📅 Completion Timeline:`);
      const sortedByCompletion = [...completionTimes].sort((a, b) => a.completionTime - b.completionTime);
      const firstCompletion = sortedByCompletion[0];
      const lastCompletion = sortedByCompletion[sortedByCompletion.length - 1];
      const totalGenerationTime = lastCompletion.completionTime - firstCompletion.requestTime;
      
      console.log(`     First image ready: ${((firstCompletion.completionTime - firstCompletion.requestTime) / 1000).toFixed(2)}s after request`);
      console.log(`     Last image ready: ${((lastCompletion.completionTime - lastCompletion.requestTime) / 1000).toFixed(2)}s after request`);
      console.log(`     Total generation window: ${(totalGenerationTime / 1000).toFixed(2)}s`);
      
      // Show distribution
      const fast = waitTimes.filter(w => w < 30000).length; // < 30s
      const medium = waitTimes.filter(w => w >= 30000 && w < 60000).length; // 30-60s
      const slow = waitTimes.filter(w => w >= 60000).length; // > 60s
      
      console.log(`\n   ⚡ Wait Time Distribution:`);
      console.log(`     Fast (< 30s): ${fast} (${((fast / waitTimes.length) * 100).toFixed(1)}%)`);
      console.log(`     Medium (30-60s): ${medium} (${((medium / waitTimes.length) * 100).toFixed(1)}%)`);
      console.log(`     Slow (> 60s): ${slow} (${((slow / waitTimes.length) * 100).toFixed(1)}%)`);
    }

    console.log(`\n   💡 This represents the actual time students wait to see their images.`);
    console.log(`      With ${CONCURRENT} concurrent requests, queue processing ensures fair distribution.\n`);
  } else {
    console.log(`\n⚠️  No images completed during polling period.`);
    console.log(`   This might indicate:`);
    console.log(`   - Image generation is taking longer than expected`);
    console.log(`   - OpenRouter API issues`);
    console.log(`   - Queue processing delays\n`);
  }

  if (useMultipleStudents) {
    console.log(`📚 Classroom Code: ${classroomCode}`);
    console.log(`\n💡 To view this session:`);
    console.log(`   1. Go to http://localhost:3000 (student login page)`);
    console.log(`   2. Enter:`);
    console.log(`      - Classroom Code: ${classroomCode}`);
    console.log(`      - Username: ${studentCredentials[0]?.username || 'any student username'}`);
    console.log(`      - Password: ${studentCredentials[0]?.password || 'any student password'}`);
    console.log(`\n   ⚠️  Note: If you log in as teacher, it will create a NEW session and deactivate this one.`);
    console.log(`   Use a STUDENT account to view the test session.\n`);
  }
}

// Run the test
runLoadTest().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

