const { ClassroomLoadTest } = require('./load-test');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Configuration
const CLASS_COUNT = 5;
const STUDENTS_PER_CLASS = 40;
const CONCURRENT_PER_CLASS = 40; // Everyone submits once
const STAGGER_DELAY = 500; // 0.5s ramp up

async function ensureTeacher(username, password) {
    const existing = await prisma.teacher.findUnique({ where: { username } });
    if (existing) return existing;

    const passwordHash = await bcrypt.hash(password, 10);
    return prisma.teacher.create({
        data: {
            username,
            passwordHash,
            displayName: `Test ${username}`
        }
    });
}

async function runDualScenario() {
    console.log(`🚀 Starting Stress Test Scenario: ${CLASS_COUNT} Classes, ${STUDENTS_PER_CLASS} Students each.`);

    // 1. Ensure Teachers Exist
    const teachers = [];
    for (let i = 1; i <= CLASS_COUNT; i++) {
        const username = `stress_teacher_${i}`;
        const password = 'pass123';
        await ensureTeacher(username, password);
        teachers.push({ username, password });
    }

    console.log(`✅ Teachers provisioned: ${teachers.map(t => t.username).join(', ')}`);

    // 2. Start Parallel Tests
    const tests = teachers.map((teacher, index) => {
        return new ClassroomLoadTest({
            teacherUsername: teacher.username,
            teacherPassword: teacher.password,
            studentCount: STUDENTS_PER_CLASS,
            concurrentRequests: CONCURRENT_PER_CLASS,
            staggerDelay: STAGGER_DELAY,
            exportPdf: true,
            outputDir: 'test-results',
            // Offset start times slightly too? 
            // User said "5 different classroom sessions at the same time", so no offset.
        });
    });

    const startTime = Date.now();

    // Run all
    const results = await Promise.all(tests.map(t => t.run()));

    const totalDuration = Date.now() - startTime;

    // 3. Summarize
    console.log('\n\n===========================================');
    console.log('       STRESS TEST GLOBAL SUMMARY       ');
    console.log('===========================================\n');

    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`Classes: ${CLASS_COUNT}`);
    console.log(`Total Students: ${CLASS_COUNT * STUDENTS_PER_CLASS}`);
    console.log(`Total Images Generated: ${results.reduce((s, r) => s + r.completed, 0)}`);

    const allWaitTimes = results.flatMap(r => r.waitTimes);
    const avgWait = allWaitTimes.reduce((a, b) => a + b, 0) / (allWaitTimes.length || 1);
    const maxWait = Math.max(...allWaitTimes, 0);

    console.log(`Average Wait Time (Global): ${(avgWait / 1000).toFixed(2)}s`);
    console.log(`Max Wait Time: ${(maxWait / 1000).toFixed(2)}s`);

    console.log('\nBy Class:');
    results.forEach(r => {
        console.log(`  ${r.teacher}: ${r.completed}/${r.requested} completed. Avg Wait: ${(r.avgWaitTime / 1000).toFixed(2)}s`);
    });

    console.log('\n✅ PDF Reports extracted to ./test-results/');

    await prisma.$disconnect();
}

runDualScenario().catch(console.error);
