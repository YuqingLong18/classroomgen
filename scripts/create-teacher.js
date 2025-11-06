#!/usr/bin/env node

// Simple CLI to add a teacher account with hashed password.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function showUsage() {
  console.log(`Usage: node scripts/create-teacher.js --username <name> --password <password> [--display-name <name>]

Creates a teacher record using the ClassroomGen Prisma schema.
`);
}

function readFlag(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`Missing value for ${flag}.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showUsage();
    process.exit(0);
  }

  const username = readFlag('--username');
  const password = readFlag('--password');
  const displayName = readFlag('--display-name');

  if (!username || !password) {
    console.error('Both --username and --password are required.');
    showUsage();
    process.exit(1);
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length === 0) {
    console.error('Username cannot be blank.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const teacher = await prisma.teacher.create({
    data: {
      username: trimmedUsername,
      passwordHash,
      displayName: displayName?.trim() || null,
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      createdAt: true,
    },
  });

  console.log('Created teacher account:');
  console.log(`  id: ${teacher.id}`);
  console.log(`  username: ${teacher.username}`);
  console.log(`  displayName: ${teacher.displayName ?? '(none)'}`);
  console.log(`  createdAt: ${teacher.createdAt.toISOString()}`);
}

main()
  .catch((error) => {
    console.error('Failed to create teacher:', error.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
