#!/usr/bin/env node

/**
 * Load testing script for image generation endpoint
 */

const fs = require('fs');
const path = require('path');

class ClassroomLoadTest {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'http://localhost:3000';
    this.teacherUsername = config.teacherUsername;
    this.teacherPassword = config.teacherPassword;
    this.classroomCode = config.classroomCode;
    this.username = config.username;
    this.password = config.password;
    this.studentCount = config.studentCount || 0;
    this.concurrentRequests = config.concurrentRequests || 1;
    this.staggerDelay = config.staggerDelay || 0;
    this.exportPdf = config.exportPdf || false;
    this.outputDir = config.outputDir || 'test-results';

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    this.teacherCookies = {};
    this.studentCookies = [];
    this.results = [];
    this.completionTimes = [];

    // Cookie names
    this.SESSION_COOKIE = 'classroom_session_id';
    this.ROLE_COOKIE = 'classroom_role';
    this.STUDENT_COOKIE = 'classroom_student_id';

    this.TEST_PROMPTS = [
      'A beautiful sunset over mountains with vibrant colors',
      'A futuristic cityscape with flying cars and neon lights',
      'A cute cat playing with a ball of yarn',
      'An abstract painting with geometric shapes',
      'A peaceful forest scene with sunlight filtering through trees',
      // ... (keeping list short for brevity, but could use full list)
      'A robot chef cooking in a modern kitchen',
      'A magical castle floating in the clouds',
    ];
  }

  log(msg) {
    console.log(`[${this.teacherUsername || 'Student'}] ${msg}`);
  }

  async loginTeacher() {
    this.log(`Logging in as teacher (${this.teacherUsername})...`);
    const response = await fetch(`${this.baseUrl}/api/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.teacherUsername, password: this.teacherPassword }),
    });

    if (!response.ok) {
      throw new Error(`Teacher login failed: ${response.statusText}`);
    }

    const setCookieHeaders = response.headers.getSetCookie();
    for (const cookieHeader of setCookieHeaders) {
      const [nameValue] = cookieHeader.split(';');
      const [name, value] = nameValue.split('=');
      this.teacherCookies[name.trim()] = value;
    }

    const data = await response.json();
    this.classroomCode = data.session?.classroomCode;

    if (!this.classroomCode) throw new Error('No classroom code returned');
    this.log(`Logged in. Classroom Code: ${this.classroomCode}`);
  }

  async createTestStudents() {
    this.log(`Generating ${this.studentCount} test student identities...`);
    // No API call needed anymore, students just join
    this.studentCredentials = Array.from({ length: this.studentCount }, (_, i) => ({
      username: `student_${i + 1}`
    }));
  }

  async loginStudents() {
    this.log(`Logging in ${this.studentCredentials.length} students...`);
    const promises = this.studentCredentials.map(async (cred) => {
      try {
        const response = await fetch(`${this.baseUrl}/api/student/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroomCode: this.classroomCode,
            name: cred.username,
          }),
        });

        if (!response.ok) {
          // const err = await response.json().catch(() => ({}));
          // this.log(`Login failed for ${cred.username}: ${err.message}`);
          return null;
        }

        const cookies = {};
        const setCookieHeaders = response.headers.getSetCookie();
        for (const cookieHeader of setCookieHeaders) {
          const [nameValue] = cookieHeader.split(';');
          const [name, value] = nameValue.split('=');
          cookies[name.trim()] = value;
        }
        return { username: cred.username, cookies };
      } catch (e) {
        return null;
      }
    });

    const results = await Promise.all(promises);
    this.studentCookies = results.filter(r => r !== null);
    this.log(`Successfully logged in ${this.studentCookies.length} students`);
  }

  async generateImage(student, prompt, requestId) {
    const startTime = Date.now();
    try {
      const cookieString = [
        `${this.SESSION_COOKIE}=${student.cookies[this.SESSION_COOKIE]}`,
        `${this.ROLE_COOKIE}=${student.cookies[this.ROLE_COOKIE]}`,
        `${this.STUDENT_COOKIE}=${student.cookies[this.STUDENT_COOKIE]}`,
      ].join('; ');

      const response = await fetch(`${this.baseUrl}/api/images/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString,
        },
        body: JSON.stringify({ prompt }),
      });

      const data = await response.json();
      return {
        requestId,
        studentUsername: student.username,
        success: response.ok,
        submissionId: data.submission?.id,
        status: data.submission?.status || 'UNKNOWN',
        requestTime: startTime,
        duration: Date.now() - startTime,
        cookies: student.cookies,
      };

    } catch (error) {
      return {
        requestId,
        studentUsername: student.username,
        success: false,
        error: error.message,
        requestTime: startTime,
        duration: Date.now() - startTime,
      };
    }
  }

  async run() {
    try {
      if (this.teacherUsername) {
        await this.loginTeacher();
        if (this.studentCount > 0) {
          await this.createTestStudents();
          await this.loginStudents();
        }
      } else if (this.username) {
        // Single student mode not implemented fully in this refactor for brevity but logic is similar
        this.log('Single student logic placeholder');
      }

      this.log(`Starting ${this.concurrentRequests} requests with ${this.staggerDelay}ms stagger...`);

      const requests = [];
      const prompts = Array.from({ length: this.concurrentRequests }, (_, i) =>
        this.TEST_PROMPTS[i % this.TEST_PROMPTS.length]
      );

      // Using a loop with delay to stagger
      for (let i = 0; i < prompts.length; i++) {
        // Random additional gap around 0.5s (0.3 - 0.7s)
        const randomGap = this.staggerDelay ? Math.floor(Math.random() * 400) + (this.staggerDelay - 200) : 0;
        if (i > 0 && randomGap > 0) await new Promise(r => setTimeout(r, randomGap));

        const student = this.studentCookies[i % this.studentCookies.length];
        if (!student) continue;

        requests.push(this.generateImage(student, prompts[i], i + 1));
      }

      this.results = await Promise.all(requests);
      this.log('Requests completed. Polling for completion...');

      await this.pollForCompletion();

      if (this.exportPdf && this.teacherUsername) {
        await this.downloadPdf();
      }

      return this.analyzeResults();

    } catch (e) {
      this.log(`Error running test: ${e.message}`);
      throw e;
    }
  }

  async pollForCompletion() {
    const pending = this.results.filter(r => r.success && r.status === 'PENDING');
    if (pending.length === 0) return;

    const startPoll = Date.now();
    const maxWait = 300000; // 5m

    const submissionIds = new Set(pending.map(p => p.submissionId));
    const completedMap = new Map();

    while (Date.now() - startPoll < maxWait && completedMap.size < pending.length) {
      // Group by student to check efficiently
      // In a real scenario, we might just poll ALL students, but that's expensive for client
      // We'll verify a subset or just poll each student who has pending
      // To save API calls, we'll iterate students who have pending items
      const studentsToCheck = new Set(pending.filter(p => !completedMap.has(p.submissionId)).map(p => p.studentUsername));

      for (const username of studentsToCheck) {
        const student = this.studentCookies.find(s => s.username === username);
        if (!student) continue;

        const submissions = await this.fetchSubmissions(student.cookies);
        for (const sub of submissions) {
          if (submissionIds.has(sub.id) && !completedMap.has(sub.id)) {
            if (sub.status === 'SUCCESS' || sub.status === 'ERROR') {
              const original = pending.find(p => p.submissionId === sub.id);
              completedMap.set(sub.id, {
                ...original,
                completionTime: Date.now(),
                waitTime: Date.now() - original.requestTime,
                finalStatus: sub.status,
                error: sub.errorMessage
              });
            }
          }
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    this.completionTimes = Array.from(completedMap.values());
  }

  async fetchSubmissions(cookies) {
    const cookieString = [
      `${this.SESSION_COOKIE}=${cookies[this.SESSION_COOKIE]}`,
      `${this.ROLE_COOKIE}=${cookies[this.ROLE_COOKIE]}`,
      `${this.STUDENT_COOKIE}=${cookies[this.STUDENT_COOKIE]}`,
    ].join('; ');

    try {
      const res = await fetch(`${this.baseUrl}/api/images?limit=10`, { // limit to recent
        headers: { Cookie: cookieString }
      });
      const data = await res.json();
      return data.submissions || [];
    } catch (e) {
      return [];
    }
  }

  async downloadPdf() {
    this.log('Downloading session PDF...');
    const cookieString = [
      `${this.SESSION_COOKIE}=${this.teacherCookies[this.SESSION_COOKIE]}`,
      `${this.ROLE_COOKIE}=${this.teacherCookies[this.ROLE_COOKIE]}`,
    ].join('; ');

    try {
      const res = await fetch(`${this.baseUrl}/api/teacher/export`, {
        headers: { Cookie: cookieString }
      });

      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        const filename = `session-${this.classroomCode}-report.pdf`;
        const filepath = path.join(this.outputDir, filename);
        fs.writeFileSync(filepath, buffer);
        this.log(`PDF saved to ${filepath}`);
      } else {
        this.log(`Failed to export PDF: ${res.status}`);
      }
    } catch (e) {
      this.log(`Error exporting PDF: ${e.message}`);
    }
  }

  analyzeResults() {
    const success = this.completionTimes.filter(t => t.finalStatus === 'SUCCESS');
    const avgWait = success.reduce((a, b) => a + b.waitTime, 0) / (success.length || 1);

    this.log(`Test Complete. Generated ${success.length}/${this.concurrentRequests} images.`);
    this.log(`Avg Wait Time: ${(avgWait / 1000).toFixed(2)}s`);

    return {
      teacher: this.teacherUsername,
      requested: this.concurrentRequests,
      completed: success.length,
      avgWaitTime: avgWait,
      waitTimes: success.map(s => s.waitTime)
    };
  }
}

// CLI Support
if (require.main === module) {
  // Parse args
  const getArg = (name) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

  const config = {
    baseUrl: process.env.BASE_URL,
    teacherUsername: getArg('teacher-username') || process.env.TEACHER_USERNAME,
    teacherPassword: getArg('teacher-password') || process.env.TEACHER_PASSWORD,
    studentCount: parseInt(getArg('students') || process.env.STUDENTS || '0'),
    concurrentRequests: parseInt(getArg('concurrent') || process.env.CONCURRENT || '1'),
    exportPdf: process.argv.includes('--export-pdf'),
  };

  if (config.teacherUsername) {
    const test = new ClassroomLoadTest(config);
    test.run().catch(console.error);
  } else {
    console.log("Usage: node scripts/load-test.js --teacher-username=... --students=5 --concurrent=5 --export-pdf");
  }
}

module.exports = { ClassroomLoadTest };
