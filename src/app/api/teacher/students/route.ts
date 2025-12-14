import { NextResponse } from 'next/server';
import { z } from 'zod';
import { StudentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyTeacherAccess } from '@/lib/session';

const updateSchema = z.object({
  studentId: z.string().cuid(),
  action: z.literal('kick'),
});

export async function GET() {
  const teacherAccess = await verifyTeacherAccess();
  if (!teacherAccess) {
    return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
  }
  
  const sessionId = teacherAccess.sessionId;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { isActive: true },
  });

  if (!session || !session.isActive) {
    return NextResponse.json({ message: 'Session is not active.' }, { status: 403 });
  }

  const students = await prisma.student.findMany({
    where: { sessionId: sessionId! },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      username: true,
      status: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ students });
}

export async function PATCH(request: Request) {
  try {
    const teacherAccess = await verifyTeacherAccess();
    if (!teacherAccess) {
      return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
    }
    
    const sessionId = teacherAccess.sessionId;

    const json = await request.json();
    const { studentId, action } = updateSchema.parse(json);

    if (action !== 'kick') {
      return NextResponse.json({ message: 'Unsupported action.' }, { status: 400 });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, sessionId: true, status: true },
    });

    if (!student || student.sessionId !== sessionId) {
      return NextResponse.json({ message: 'Student not found in this session.' }, { status: 404 });
    }

    if (student.status === StudentStatus.REMOVED) {
      return NextResponse.json({ student: { id: student.id, status: student.status } });
    }

    const updated = await prisma.student.update({
      where: { id: studentId },
      data: { status: StudentStatus.REMOVED },
      select: { id: true, status: true },
    });

    return NextResponse.json({ student: updated });
  } catch (error) {
    console.error('Failed to update student status', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to update student.' }, { status: 500 });
  }
}
