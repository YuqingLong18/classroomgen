const { ClassroomLoadTest } = require('./load-test');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const CLASS_COUNT = 5;

async function runExport() {
    console.log(`🚀 Starting Batch Report Export for ${CLASS_COUNT} Classes.`);

    const teachers = [];
    for (let i = 1; i <= CLASS_COUNT; i++) {
        const username = `stress_teacher_${i}`;
        teachers.push({ username, password: 'pass123' });
    }

    // Start Export Jobs
    const tests = teachers.map((teacher, index) => {
        return new ClassroomLoadTest({
            teacherUsername: teacher.username,
            teacherPassword: teacher.password,
            studentCount: 0,
            concurrentRequests: 0,
            exportPdf: true,
            outputDir: 'test-results',
        });
    });

    await Promise.all(tests.map(t => t.run()));

    console.log('\n✅ All PDF Reports updated in ./test-results/');
    await prisma.$disconnect();
}

runExport().catch(console.error);
