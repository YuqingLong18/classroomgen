const { ClassroomLoadTest } = require('./load-test');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

class IntensiveLoadTest extends ClassroomLoadTest {

    async shareImage(student, submissionId) {
        const cookieString = [
            `${this.SESSION_COOKIE}=${student.cookies[this.SESSION_COOKIE]}`,
            `${this.ROLE_COOKIE}=${student.cookies[this.ROLE_COOKIE]}`,
            `${this.STUDENT_COOKIE}=${student.cookies[this.STUDENT_COOKIE]}`,
        ].join('; ');

        try {
            const response = await fetch(`${this.baseUrl}/api/images/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cookie': cookieString },
                body: JSON.stringify({ submissionId, share: true })
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    async measureGalleryLoad(student) {
        const cookieString = [
            `${this.SESSION_COOKIE}=${student.cookies[this.SESSION_COOKIE]}`,
            `${this.ROLE_COOKIE}=${student.cookies[this.ROLE_COOKIE]}`,
            `${this.STUDENT_COOKIE}=${student.cookies[this.STUDENT_COOKIE]}`,
        ].join('; ');

        const start = Date.now();
        // Fetch 50 items to simulate initial page load
        const res = await fetch(`${this.baseUrl}/api/images?limit=50`, {
            headers: { Cookie: cookieString }
        });
        await res.json();
        return Date.now() - start;
    }

    async measureTeacherDashboard() {
        const cookieString = [
            `${this.SESSION_COOKIE}=${this.teacherCookies[this.SESSION_COOKIE]}`,
            `${this.ROLE_COOKIE}=${this.teacherCookies[this.ROLE_COOKIE]}`,
        ].join('; ');

        const start = Date.now();
        const res = await fetch(`${this.baseUrl}/api/session`, {
            headers: { Cookie: cookieString }
        });
        await res.json();
        return Date.now() - start;
    }
}

async function runIntensiveTest() {
    console.log('🚀 Starting Intensive Stress Test: 100 Students, 10s Generation Window (Refined)');

    const username = 'stress_teacher_hq_2'; // Use new teacher to avoid old state
    const password = 'pass123';

    // 1. Ensure Teacher
    let teacher = await prisma.teacher.findUnique({ where: { username } });
    if (!teacher) {
        const passwordHash = await bcrypt.hash(password, 10);
        teacher = await prisma.teacher.create({
            data: { username, passwordHash, displayName: 'HQ Teacher 2' }
        });
    }

    const test = new IntensiveLoadTest({
        teacherUsername: username,
        teacherPassword: password,
        studentCount: 100,
        concurrentRequests: 100,
        staggerDelay: 100, // 100ms * 100 students = 10s
        exportPdf: true,
        outputDir: 'test-results',
    });

    console.log(`\n--- Step 1: Login & Setup ---`);
    await test.loginTeacher();
    await test.createTestStudents();
    await test.loginStudents();

    console.log(`\n--- Step 2: 100 Students Generate Images (10s window) ---`);
    // Manually run generation loop instead of test.run()

    // Copy-paste logic from Helper manual run
    const requests = [];
    const prompts = Array.from({ length: test.concurrentRequests }, (_, i) =>
        test.TEST_PROMPTS[i % test.TEST_PROMPTS.length]
    );

    for (let i = 0; i < prompts.length; i++) {
        // Precise staging: 100ms exactly
        if (i > 0) await new Promise(r => setTimeout(r, 100)); // 100ms stagger

        const student = test.studentCookies[i % test.studentCookies.length];
        if (!student) continue;

        requests.push(test.generateImage(student, prompts[i], i + 1));
    }

    test.results = await Promise.all(requests);
    console.log('Requests sent. Polling for completion...');

    await test.pollForCompletion();

    // Calculate Wait Times
    const successful = test.completionTimes.filter(t => t.finalStatus === 'SUCCESS');
    if (successful.length === 0) {
        console.log("❌ No images generated successfully. Check server logs.");
    } else {
        const maxWaitTime = Math.max(...successful.map(s => s.waitTime));
        console.log(`[Metric] Max Generation Wait Time: ${(maxWaitTime / 1000).toFixed(2)}s`);
        console.log(`[Metric] Success Rate: ${successful.length}/${test.concurrentRequests}`);
    }

    // Step 3: Share All Images
    console.log(`\n--- Step 3: Sharing All Images to Gallery ---`);
    const shareStart = Date.now();
    await Promise.all(successful.map(record => {
        const student = test.studentCookies.find(s => s.username === record.studentUsername);
        return test.shareImage(student, record.submissionId);
    }));
    console.log(`Shared ${successful.length} images in ${(Date.now() - shareStart) / 1000}s`);

    // Step 4: New Student Gallery Load
    console.log(`\n--- Step 4: New Student Gallery Load Test ---`);
    const newStudentName = 'bench_student_final';
    const loginRes = await fetch(`${test.baseUrl}/api/student/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomCode: test.classroomCode, name: newStudentName })
    });

    let newStudentCookies = {};
    const setCookieHeaders = loginRes.headers.getSetCookie();
    for (const h of setCookieHeaders) {
        const [nv] = h.split(';');
        const [n, v] = nv.split('=');
        newStudentCookies[n.trim()] = v;
    }

    const galleryLoadTime = await test.measureGalleryLoad({ cookies: newStudentCookies });
    console.log(`[Metric] Gallery Full Load Time (New Student): ${galleryLoadTime}ms`);

    // Step 5: Teacher Dashboard Load
    console.log(`\n--- Step 5: Teacher Dashboard Load Test ---`);
    const teacherLoadTime = await test.measureTeacherDashboard();
    console.log(`[Metric] Teacher Dashboard Refresh Time: ${teacherLoadTime}ms`);

    // Export PDF
    if (test.exportPdf) {
        await test.downloadPdf();
    }

    await prisma.$disconnect();
}

runIntensiveTest().catch(console.error);
