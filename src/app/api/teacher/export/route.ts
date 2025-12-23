import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyTeacherAccess } from '@/lib/session';
import PDFDocument from 'pdfkit';
import { Buffer } from 'node:buffer';
import path from 'path';
import fs from 'fs';

const resolveImageBuffer = (data: string | null): Buffer | null => {
  if (!data) return null;
  try {
    if (data.startsWith('/api/uploads/')) {
      const relativePath = data.split('/api/uploads/')[1];
      if (!relativePath) return null;
      const filePath = path.join(process.cwd(), 'uploads', ...relativePath.split('/'));
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
      return null;
    }
    const b64 = data.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(b64, 'base64');
  } catch (e) {
    return null;
  }
};

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function GET() {
  try {
    const teacherAccess = await verifyTeacherAccess();
    if (!teacherAccess) {
      return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
    }

    const sessionId = teacherAccess.sessionId;

    // Fetch session with all related data
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        promptEntries: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            prompt: true,
            createdAt: true,
            status: true,
            revisionIndex: true,
            rootSubmissionId: true,
            parentSubmissionId: true,
            imageData: true,
            referenceImages: true,
            imageMimeType: true,
            errorMessage: true,
            isShared: true,
            studentId: true,
            student: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        chatThreads: {
          orderBy: { createdAt: 'asc' },
          include: {
            student: {
              select: {
                id: true,
                username: true,
              },
            },
            messages: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                content: true,
                sender: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ message: 'Session not found.' }, { status: 404 });
    }

    // Group submissions by student and then by root submission
    const submissionsByStudent = new Map<string, Array<typeof session.promptEntries[0]>>();
    for (const submission of session.promptEntries) {
      const studentId = submission.studentId || 'unknown';
      if (!submissionsByStudent.has(studentId)) {
        submissionsByStudent.set(studentId, []);
      }
      submissionsByStudent.get(studentId)!.push(submission);
    }

    // Group submissions by root ID for each student
    const imageSessionsByStudent = new Map<string, Map<string, Array<typeof session.promptEntries[0]>>>();
    for (const [studentId, submissions] of submissionsByStudent.entries()) {
      const byRoot = new Map<string, Array<typeof session.promptEntries[0]>>();
      for (const submission of submissions) {
        const rootId = submission.rootSubmissionId || submission.id;
        if (!byRoot.has(rootId)) {
          byRoot.set(rootId, []);
        }
        byRoot.get(rootId)!.push(submission);
      }
      // Sort submissions within each root group by creation time
      for (const [rootId, subs] of byRoot.entries()) {
        byRoot.set(rootId, subs.sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ));
      }
      imageSessionsByStudent.set(studentId, byRoot);
    }

    // Group chat threads by student
    const chatsByStudent = new Map<string, Array<typeof session.chatThreads[0]>>();
    for (const thread of session.chatThreads) {
      const studentId = thread.studentId || 'unknown';
      if (!chatsByStudent.has(studentId)) {
        chatsByStudent.set(studentId, []);
      }
      chatsByStudent.get(studentId)!.push(thread);
    }
    // Sort threads chronologically for each student
    for (const [studentId, threads] of chatsByStudent.entries()) {
      chatsByStudent.set(studentId, threads.sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ));
    }

    // Get all unique students
    const allStudentIds = new Set([
      ...submissionsByStudent.keys(),
      ...chatsByStudent.keys(),
    ]);

    // Create PDF with promise-based buffer collection
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 50,
        size: 'LETTER',
        info: {
          Title: `Classroom Session Report - ${session.classroomCode}`,
          Author: 'ClassroomGen',
          Subject: 'Session Export',
        },
      });

      // Register Chinese font
      const fontPath = path.join(process.cwd(), 'public/fonts/NotoSansSC-Regular.woff');
      doc.registerFont('NotoSansSC', fontPath);
      doc.font('NotoSansSC');

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).fillColor('#6B46C1').text('Classroom Session Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).fillColor('#000000');
      doc.text(`Classroom Code: ${session.classroomCode}`, { align: 'center' });
      doc.text(`Session Started: ${formatDate(session.createdAt)}`, { align: 'center' });
      if (session.endedAt) {
        doc.text(`Session Ended: ${formatDate(session.endedAt)}`, { align: 'center' });
      }
      doc.moveDown(2);

      // Process each student
      const sortedStudentIds = Array.from(allStudentIds).sort();

      for (const studentId of sortedStudentIds) {
        const studentSubmissions = submissionsByStudent.get(studentId) || [];
        const studentChats = chatsByStudent.get(studentId) || [];
        const studentName = studentSubmissions[0]?.student?.username ||
          studentChats[0]?.student?.username ||
          'Unknown Student';

        // Student header
        doc.addPage();
        doc.fontSize(16).fillColor('#6B46C1').text(`Student: ${studentName}`, { underline: true });
        doc.moveDown();

        // Chat Conversations Section
        if (studentChats.length > 0) {
          doc.fontSize(14).fillColor('#8B5CF6').text('Chat Conversations', { underline: true });
          doc.moveDown(0.5);

          for (const thread of studentChats) {
            doc.fontSize(12).fillColor('#000000');
            doc.text(`Thread: ${thread.title}`, { continued: false });
            doc.fontSize(10).fillColor('#666666');
            doc.text(`Started: ${formatDate(thread.createdAt)}`, { indent: 20 });
            doc.moveDown(0.3);

            for (const message of thread.messages) {
              const senderLabel = message.sender === 'STUDENT' ? 'Student' : 'AI Assistant';
              doc.fontSize(10).fillColor('#000000');
              doc.text(`${senderLabel} (${formatDate(message.createdAt)}):`, { indent: 30, continued: false });
              doc.fontSize(10).fillColor('#333333');
              doc.text(message.content, { indent: 40, align: 'left', width: 450 });
              doc.moveDown(0.5);
            }
            doc.moveDown();
          }
          doc.moveDown();
        }

        // Image Generations Section
        const imageSessions = imageSessionsByStudent.get(studentId);
        if (imageSessions && imageSessions.size > 0) {
          doc.fontSize(14).fillColor('#8B5CF6').text('Image Generations', { underline: true });
          doc.moveDown(0.5);

          // Sort root IDs by creation time of first submission
          const sortedRootIds = Array.from(imageSessions.entries())
            .sort(([, a], [, b]) => {
              const aTime = new Date(a[0]?.createdAt || 0).getTime();
              const bTime = new Date(b[0]?.createdAt || 0).getTime();
              return aTime - bTime;
            })
            .map(([rootId]) => rootId);

          for (let sessionIndex = 0; sessionIndex < sortedRootIds.length; sessionIndex++) {
            const rootId = sortedRootIds[sessionIndex];
            const submissions = imageSessions.get(rootId) || [];
            const firstSubmission = submissions[0];

            if (!firstSubmission) continue;

            doc.fontSize(12).fillColor('#000000');
            doc.text(`Image Session ${sessionIndex + 1}`, { underline: true });
            doc.moveDown(0.3);

            // List all submissions in this session (original + refinements)
            for (const submission of submissions) {
              const isOriginal = submission.revisionIndex === 0;
              const indent = isOriginal ? 20 : 30;
              const label = isOriginal ? 'Original Image' : `Refinement ${submission.revisionIndex}`;

              const startY = doc.y;
              if (startY > doc.page.height - 150) doc.addPage();

              doc.fontSize(11).fillColor('#000000').text(`${label}:`, { indent });

              // 1. Reference Images
              let refImages: string[] = [];
              if (submission.referenceImages) {
                try {
                  const parsed = JSON.parse(submission.referenceImages);
                  if (Array.isArray(parsed)) refImages = parsed;
                } catch (e) { /* ignore */ }
              }

              if (refImages.length > 0) {
                const refIndent = indent + 10;
                doc.fontSize(9).fillColor('#555555').text('Reference Images:', { indent: refIndent });
                doc.moveDown(0.2);
                let refX = doc.page.margins.left + refIndent;
                const refY = doc.y;
                let maxHeight = 0;

                for (const ref of refImages) {
                  const buf = resolveImageBuffer(ref);
                  if (buf) {
                    try {
                      doc.image(buf, refX, refY, { fit: [80, 80] });
                      refX += 90;
                      if (80 > maxHeight) maxHeight = 80;
                    } catch (e) { }
                  }
                }
                if (maxHeight > 0) doc.y = refY + maxHeight + 5;
              }

              // 2. Prompt
              const contentIndent = indent + 10;
              doc.fontSize(10).fillColor('#333333');
              doc.text(`Prompt: "${submission.prompt}"`, { indent: contentIndent, width: 450 });
              doc.fontSize(9).fillColor('#666666');
              doc.text(`Created: ${formatDate(submission.createdAt)}`, { indent: contentIndent });

              // 3. Generated Image
              if (submission.imageData && submission.status === 'SUCCESS') {
                doc.moveDown(0.2);
                const buf = resolveImageBuffer(submission.imageData);
                if (buf) {
                  try {
                    if (doc.y + 200 > doc.page.height) doc.addPage();

                    const imgX = doc.page.margins.left + contentIndent;
                    doc.image(buf, imgX, doc.y, { fit: [200, 200] });
                    doc.y += 210;
                  } catch (e) {
                    doc.text('[Image Error]', { indent: contentIndent });
                  }
                } else {
                  doc.text('[Image Not Found]', { indent: contentIndent });
                }
              }

              // Status
              if (submission.status === 'ERROR') {
                doc.fontSize(9).fillColor('#DC2626').text(`Error: ${submission.errorMessage}`, { indent: contentIndent });
              } else if (submission.status === 'PENDING') {
                doc.fontSize(9).fillColor('#F59E0B').text('Status: PENDING', { indent: contentIndent });
              } else if (submission.status === 'SUCCESS' && submission.isShared) {
                doc.fontSize(9).fillColor('#8B5CF6').text('Shared with class', { indent: contentIndent });
              }

              doc.moveDown(0.5);
            }

            doc.moveDown();
          }
        }

        // If student has no activity
        if (studentChats.length === 0 && (!imageSessions || imageSessions.size === 0)) {
          doc.fontSize(10).fillColor('#666666').text('No activity recorded for this student.');
        }

        doc.moveDown();
      }

      // Footer on last page
      doc.fontSize(8).fillColor('#999999');
      doc.text(
        `Generated on ${formatDate(new Date())} | Total Students: ${sortedStudentIds.length}`,
        { align: 'center' }
      );

      // Finalize PDF
      doc.end();
    });

    const pdfBytes = new Uint8Array(pdfBuffer);

    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="session-${session.classroomCode}-${new Date().toISOString().split('T')[0]}.pdf"`,
        'Content-Length': pdfBytes.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('Failed to generate PDF export', error);
    return NextResponse.json(
      { message: 'Failed to generate PDF export', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
