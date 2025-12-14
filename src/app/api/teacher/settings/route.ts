import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyTeacherAccess } from '@/lib/session';

const bodySchema = z
  .object({
    chatEnabled: z.boolean().optional(),
    maxStudentEdits: z.number().int().min(1).max(10).optional(),
  })
  .refine((value) => value.chatEnabled !== undefined || value.maxStudentEdits !== undefined, {
    message: 'Provide at least one setting to update.',
  });

export async function PATCH(request: Request) {
  const teacherAccess = await verifyTeacherAccess();
  if (!teacherAccess) {
    return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
  }
  
  const sessionId = teacherAccess.sessionId;

  try {
    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.parse(json);

    const updateData: { chatEnabled?: boolean; maxStudentEdits?: number } = {};

    if (parsed.chatEnabled !== undefined) {
      updateData.chatEnabled = parsed.chatEnabled;
    }

    if (parsed.maxStudentEdits !== undefined) {
      updateData.maxStudentEdits = parsed.maxStudentEdits;
    }

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: updateData,
      select: {
        id: true,
        chatEnabled: true,
        maxStudentEdits: true,
      },
    });

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Failed to update teacher settings', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid settings.' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to update settings at this time.' }, { status: 500 });
  }
}
