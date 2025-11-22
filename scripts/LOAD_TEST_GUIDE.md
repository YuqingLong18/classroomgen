# Load Testing Guide

This guide explains how to run load tests for the image generation endpoint to verify concurrent request handling.

## Prerequisites

1. **Server Running**: Start your development server:
   ```bash
   npm run dev
   ```

2. **Test Accounts**: You need either:
   - **Single Student Mode**: One student account in an active classroom session
   - **Multiple Students Mode**: Teacher account credentials (script will create test students automatically)

3. **Node.js Version**: Requires Node.js 18+ (for native fetch support)

## Quick Start

### Option 1: Multiple Students (Recommended - Realistic Simulation)

This simulates **20 different students** each making requests, which accurately reflects real-world usage:

```bash
node scripts/load-test.js --teacher-username=teacher1 --teacher-password=pass123 --students=20 --concurrent=20
```

The script will:
1. Log in as the teacher (creates a new classroom session automatically)
2. Extract the classroom code from the teacher login response
3. Create 20 test student accounts automatically
4. Log in all 20 students using the classroom code
5. Distribute 20 concurrent requests across the 20 students (1 request per student)

**Note:** You don't need to provide `--classroom-code` when using teacher mode. The script automatically uses the classroom code created during teacher login.

### Option 2: Single Student (Less Realistic)

For quick testing with one student account:

```bash
node scripts/load-test.js --classroom-code=12345678 --username=student1 --password=pass123 --concurrent=20
```

### Option 3: Environment Variables

```bash
TEACHER_USERNAME=teacher1 TEACHER_PASSWORD=pass123 STUDENTS=20 CONCURRENT=20 node scripts/load-test.js
```

### Option 4: Custom Base URL (for production testing)

```bash
BASE_URL=https://your-domain.com TEACHER_USERNAME=teacher1 TEACHER_PASSWORD=pass123 STUDENTS=20 CONCURRENT=20 node scripts/load-test.js
```

## Parameters

### Multiple Students Mode (Recommended)
- `--teacher-username` or `TEACHER_USERNAME`: Teacher username (required)
- `--teacher-password` or `TEACHER_PASSWORD`: Teacher password (required)
- `--students` or `STUDENTS`: Number of test students to create (required, e.g., 20)
- `--concurrent` or `CONCURRENT`: Number of concurrent requests (default: 20)
- `BASE_URL`: Server URL (default: http://localhost:3000)
- **Note:** Classroom code is automatically created when teacher logs in (no need to provide it)

### Single Student Mode
- `--classroom-code` or `CLASSROOM_CODE`: 8-digit classroom code
- `--username` or `USERNAME`: Student username
- `--password` or `PASSWORD`: Student password
- `--concurrent` or `CONCURRENT`: Number of concurrent requests (default: 20)
- `BASE_URL`: Server URL (default: http://localhost:3000)

## Example Test Scenarios

### Test 1: Light Load (10 students, 10 concurrent requests)
```bash
node scripts/load-test.js --teacher-username=teacher1 --teacher-password=pass123 --students=10 --concurrent=10
```

### Test 2: Medium Load (20 students, 20 concurrent requests) - Recommended
```bash
node scripts/load-test.js --teacher-username=teacher1 --teacher-password=pass123 --students=20 --concurrent=20
```

### Test 3: Heavy Load (50 students, 50 concurrent requests)
```bash
node scripts/load-test.js --teacher-username=teacher1 --teacher-password=pass123 --students=50 --concurrent=50
```

### Test 4: Stress Test (100 students, 100 concurrent requests)
```bash
node scripts/load-test.js --teacher-username=teacher1 --teacher-password=pass123 --students=100 --concurrent=100
```

### Single Student Mode (Less Realistic)
```bash
node scripts/load-test.js --classroom-code=12345678 --username=student1 --password=pass123 --concurrent=20
```

## Understanding the Results

The script reports:

1. **Success Rate**: Percentage of successful requests
2. **Response Time Statistics**:
   - Min/Max/Average response times
   - Median, 95th percentile, 99th percentile
3. **Performance Analysis**: 
   - Fast responses (< 500ms) - expected for async queue
   - Slow responses (≥ 500ms) - may indicate blocking

### Expected Results

With the queue system in place:
- ✅ **API Response Time**: Should be < 500ms (requests return immediately)
- ✅ **Success Rate**: Should be 100% (all requests accepted)
- ✅ **Concurrent Processing**: Up to 20 images processing simultaneously

### What to Watch For

⚠️ **Warning Signs**:
- Average response time > 1000ms → Server might be blocking
- Success rate < 95% → Check server logs for errors
- High 99th percentile → Some requests are being delayed

## Monitoring Image Generation

The script only measures API response times. To monitor actual image generation:

1. **Check UI**: Use a student account to view the session (see below)
2. **Check Database**: Query `PromptSubmission` table for status updates
3. **Check Server Logs**: Look for OpenRouter API calls and errors

## Viewing Test Sessions

**Important**: When you log in as a teacher, it creates a NEW session and deactivates the test session. To view the test session, you must use a STUDENT account.

### Method 1: Use Student Credentials from Script Output

The script displays student credentials after creating them:

```
📋 Student Credentials (use these to view the session):
   Student 1: username="ABC123" password="XYZ789"
   Student 2: username="DEF456" password="UVW012"
   ...
```

Then:
1. Go to `http://localhost:3000` (student login page)
2. Enter:
   - **Classroom Code**: The code shown in script output (e.g., `15844518`)
   - **Username**: Any student username from the output
   - **Password**: The corresponding password
3. You'll see all submissions from the test session

### Method 2: Check Database Directly

Query the database:
```sql
-- Find the session
SELECT * FROM Session WHERE classroomCode = '15844518';

-- View submissions
SELECT * FROM PromptSubmission WHERE sessionId = '<session-id>';
```

## Troubleshooting

### "Login failed"
- Verify classroom code is correct
- Ensure student account exists
- Check that session is active

### "Connection refused"
- Make sure server is running (`npm run dev`)
- Check BASE_URL is correct

### High response times
- Check server CPU/memory usage
- Verify queue is processing jobs (check logs)
- Consider reducing `MAX_CONCURRENT_JOBS` if server is overloaded

## Why Multiple Students Mode?

**Single Student Mode** (1 account, 20 requests):
- ❌ Less realistic - all requests use same session cookies
- ❌ Doesn't test database queries with different student IDs
- ❌ Doesn't simulate real-world concurrency patterns

**Multiple Students Mode** (20 accounts, 20 requests):
- ✅ **Realistic** - Each request uses different student credentials
- ✅ **Accurate** - Tests database queries with different student IDs
- ✅ **Real-world** - Simulates actual classroom scenario
- ✅ **Better testing** - Verifies queue handles different users correctly

## Advanced: Custom Student Distribution

If you want more requests per student (e.g., 20 students making 2 requests each = 40 total):

```bash
node scripts/load-test.js --teacher-username=teacher1 --teacher-password=pass123 --students=20 --concurrent=40
```

This creates 20 students and distributes 40 requests across them (2 requests per student).

## How Classroom Code Works

**Multiple Students Mode:**
- Teacher login automatically creates a new classroom session
- The script extracts the classroom code from the login response
- No need to provide `--classroom-code` manually
- Each test run creates a fresh classroom session

**Single Student Mode:**
- Requires an existing classroom code
- You must provide `--classroom-code` manually
- Use this mode if you want to test with an existing session

