import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import PDFDocument from 'pdfkit';
import { Buffer } from 'node:buffer';

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
    const { sessionId, role } = await getSessionFromCookies();

    if (!sessionId || role !== 'teacher') {
      return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
    }

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
              if (submission.revisionIndex === 0) {
                // Original submission
                doc.fontSize(11).fillColor('#000000');
                doc.text('Original Image:', { indent: 20 });
                doc.fontSize(10).fillColor('#333333');
                doc.text(`Prompt: "${submission.prompt}"`, { indent: 30, width: 450 });
                doc.fontSize(9).fillColor('#666666');
                doc.text(`Created: ${formatDate(submission.createdAt)}`, { indent: 30 });
                
                // Add image if available
                if (submission.imageData && submission.status === 'SUCCESS') {
                  try {
                    const imageBuffer = Buffer.from(submission.imageData, 'base64');
                    const imageWidth = 200;
                    const imageHeight = 150;
                    const x = doc.page.margins.left + 30;
                    const y = doc.y;
                    
                    doc.image(imageBuffer, x, y, {
                      width: imageWidth,
                      height: imageHeight,
                      fit: [imageWidth, imageHeight],
                    });
                    doc.y = y + imageHeight + 10;
                  } catch (imageError) {
                    console.error('Failed to embed image in PDF:', imageError);
                    doc.fontSize(9).fillColor('#666666');
                    doc.text('[Image could not be embedded]', { indent: 30 });
                  }
                }
                
                if (submission.status === 'ERROR') {
                  doc.fontSize(9).fillColor('#DC2626');
                  doc.text(`Status: ERROR - ${submission.errorMessage || 'Generation failed'}`, { indent: 30 });
                } else if (submission.status === 'PENDING') {
                  doc.fontSize(9).fillColor('#F59E0B');
                  doc.text('Status: PENDING', { indent: 30 });
                } else {
                  doc.fontSize(9).fillColor('#10B981');
                  doc.text('Status: SUCCESS', { indent: 30 });
                  if (submission.isShared) {
                    doc.fontSize(9).fillColor('#8B5CF6');
                    doc.text('Shared with class', { indent: 30 });
                  }
                }
              } else {
                // Refinement
                doc.fontSize(10).fillColor('#000000');
                doc.text(`Refinement ${submission.revisionIndex}:`, { indent: 30 });
                doc.fontSize(10).fillColor('#333333');
                doc.text(`Prompt: "${submission.prompt}"`, { indent: 40, width: 440 });
                doc.fontSize(9).fillColor('#666666');
                doc.text(`Created: ${formatDate(submission.createdAt)}`, { indent: 40 });
                
                // Add image if available
                if (submission.imageData && submission.status === 'SUCCESS') {
                  try {
                    const imageBuffer = Buffer.from(submission.imageData, 'base64');
                    const imageWidth = 180;
                    const imageHeight = 135;
                    const x = doc.page.margins.left + 40;
                    const y = doc.y;
                    
                    doc.image(imageBuffer, x, y, {
                      width: imageWidth,
                      height: imageHeight,
                      fit: [imageWidth, imageHeight],
                    });
                    doc.y = y + imageHeight + 10;
                  } catch (imageError) {
                    console.error('Failed to embed image in PDF:', imageError);
                    doc.fontSize(9).fillColor('#666666');
                    doc.text('[Image could not be embedded]', { indent: 40 });
                  }
                }
                
                if (submission.status === 'ERROR') {
                  doc.fontSize(9).fillColor('#DC2626');
                  doc.text(`Status: ERROR - ${submission.errorMessage || 'Generation failed'}`, { indent: 40 });
                } else if (submission.status === 'PENDING') {
                  doc.fontSize(9).fillColor('#F59E0B');
                  doc.text('Status: PENDING', { indent: 40 });
                } else {
                  doc.fontSize(9).fillColor('#10B981');
                  doc.text('Status: SUCCESS', { indent: 40 });
                }
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

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="session-${session.classroomCode}-${new Date().toISOString().split('T')[0]}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
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
