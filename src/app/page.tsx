'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StudentNav } from '@/components/student/StudentNav';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageToggle } from '@/components/LanguageToggle';
import { TruncatedText } from '@/components/TruncatedText';

interface SessionState {
  id: string;
  createdAt: string;
  classroomCode?: string;
  role: 'student' | 'teacher' | undefined;
  chatEnabled?: boolean;
  maxStudentEdits?: number;
  hasTeacherAccess?: boolean;
  teacherSessionId?: string | null;
  student?: {
    id: string;
    username: string;
  } | null;
  teacher?: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
}

interface SubmissionComment {
  id: string;
  content: string;
  createdAt: string;
  studentUsername: string | null;
  ownedByCurrentUser: boolean;
}

interface Submission {
  id: string;
  prompt: string;
  createdAt: string;
  status: 'PENDING' | 'SUCCESS' | 'ERROR';
  imageData: string | null;
  imageUrl?: string | null;
  imageMimeType: string | null;
  revisionIndex: number;
  rootSubmissionId: string | null;
  parentSubmissionId: string | null;
  remainingEdits: number;
  errorMessage: string | null;
  isShared: boolean;
  ownedByCurrentUser: boolean;
  studentUsername: string | null;
  likeCount: number;
  likedByCurrentUser: boolean;
  comments: SubmissionComment[];
}

interface FetchSubmissionsResponse {
  submissions: Submission[];
  role?: 'student' | 'teacher';
  nextCursor?: string | null;
}

type SessionResponse = {
  session: SessionState | null;
  studentRemoved?: boolean;
};

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

function toDisplayTime(iso: string) {
  try {
    return timestampFormatter.format(new Date(iso));
  } catch {
    return '';
  }
}

function downloadImage(submission: Submission) {
  if (!submission.imageUrl && !submission.imageData) return;
  const mimeType = submission.imageMimeType || 'image/png';
  const prefix = mimeType.split('/')[1] || 'png';
  const link = document.createElement('a');
  link.href = submission.imageUrl || `data:${mimeType};base64,${submission.imageData}`;
  const revisionLabel = submission.revisionIndex > 0 ? `-rev${submission.revisionIndex}` : '';
  link.download = `classroom-image-${submission.id}${revisionLabel}.${prefix}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function StudentHome() {
  const { t } = useLanguage();
  const router = useRouter();
  const [session, setSession] = useState<SessionState | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [classroomCode, setClassroomCode] = useState('');
  const [studentName, setStudentName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('2048x2048');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [fetchingSubmissions, setFetchingSubmissions] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [shareUpdatingId, setShareUpdatingId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [likingId, setLikingId] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentErrors, setCommentErrors] = useState<Record<string, string | null>>({});
  const [commentSubmittingId, setCommentSubmittingId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ src: string; prompt: string; mimeType: string | null } | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionRequestIdRef = useRef(0);

  // ... (keep existing useEffects and handlers)

  const invalidatePendingSessionLoads = useCallback(() => {
    sessionRequestIdRef.current += 1;
  }, []);

  const loadSession = useCallback(async () => {
    const requestId = ++sessionRequestIdRef.current;
    try {
      const res = await fetch('/api/session', { credentials: 'include' });
      if (sessionRequestIdRef.current !== requestId) {
        return;
      }
      if (!res.ok) {
        setSession(null);
        return;
      }
      const data: SessionResponse = await res.json();
      if (sessionRequestIdRef.current !== requestId) {
        return;
      }
      setSession(data.session ?? null);
      if (data.session) {
        setAuthError(null);
      } else if (!data.session && data.studentRemoved) {
        setAuthError('You were removed from the classroom. Enter a new name to rejoin.');
      }
    } catch (error) {
      console.error('Failed to load session', error);
      if (sessionRequestIdRef.current !== requestId) {
        return;
      }
      setSession(null);
    } finally {
      if (sessionRequestIdRef.current === requestId) {
        setInitializing(false);
      }
    }
  }, []);

  const waitForSessionRole = useCallback(async (expectedRole: 'student') => {
    const attempts = 20;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        if (!res.ok) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        const data: SessionResponse = await res.json();
        if (data.session?.role === expectedRole) {
          setSession(data.session);
          setInitializing(false);
          return data.session;
        }
      } catch (error) {
        console.error('Failed to confirm session role', error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return null;
  }, []);

  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadSubmissions = useCallback(async (cursor: string | null = null, isPoll = false) => {
    if (!session?.id) return;
    if (cursor) setIsLoadingMore(true);
    else if (!isPoll) setFetchingSubmissions(true);

    setShareError(null);
    setSocialError(null);
    try {
      const url = new URL('/api/images', window.location.href);
      if (cursor) url.searchParams.set('cursor', cursor);
      url.searchParams.set('limit', '50');

      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as FetchSubmissionsResponse;

      const newSubmissions = data.submissions ?? [];
      setNextCursor(data.nextCursor ?? null);

      if (cursor) {
        // Appending (Load More)
        setSubmissions(prev => {
          // Filter out duplicates just in case
          const existingIds = new Set(prev.map(s => s.id));
          const uniqueNew = newSubmissions.filter((s) => !existingIds.has(s.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        // First page load (or poll)
        if (isPoll) {
          // Smart merge for polling
          setSubmissions(prev => {
            const updatedMap = new Map(newSubmissions.map((s) => [s.id, s]));
            const merged = prev.map(s => {
              if (updatedMap.has(s.id)) {
                return updatedMap.get(s.id)!;
              }
              return s;
            });

            // Prepend completely new items (top of list)
            // Note: This logic assumes new items are always at the top.
            // Check for items in newSubmissions that are NOT in prev
            const prevIds = new Set(prev.map(s => s.id));
            const brandNew = newSubmissions.filter((s) => !prevIds.has(s.id));

            return [...brandNew, ...merged];
          });
        } else {
          // Hard refresh (Initial load)
          setSubmissions(newSubmissions);
          setCommentDrafts({});
          setCommentErrors({});
        }
      }

    } catch (error) {
      console.error('Failed to load submissions', error);
    } finally {
      setFetchingSubmissions(false);
      setIsLoadingMore(false);
    }
  }, [session?.id]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session?.id || session.role !== 'student') return;
    const interval = window.setInterval(() => {
      void loadSession();
    }, 10000);
    return () => {
      window.clearInterval(interval);
    };
  }, [session?.id, session?.role, loadSession]);

  useEffect(() => {
    if (session?.id && session.role === 'student') {
      void loadSubmissions(null, false);
    }
  }, [session?.id, session?.role, loadSubmissions]);

  // Poll for pending submissions to update them when generation completes
  useEffect(() => {
    if (!session?.id || session.role !== 'student') return;

    // Check if there are any pending submissions
    const hasPendingSubmissions = submissions.some(
      (sub) => sub.status === 'PENDING' && sub.ownedByCurrentUser
    );

    if (!hasPendingSubmissions) return;

    // Poll every 2 seconds for pending submissions
    // Only fetch page 1 (cursor=null)
    const interval = window.setInterval(() => {
      void loadSubmissions(null, true);
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [session?.id, session?.role, submissions, loadSubmissions]);

  const handleLogin = useCallback(async () => {
    if (classroomCode.length !== 8) {
      setAuthError('Enter the 8-digit classroom code from your teacher.');
      return;
    }
    if (studentName.trim().length < 2) {
      setAuthError('Enter your name to join the classroom.');
      return;
    }
    setLoggingIn(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/student/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ classroomCode, name: studentName.trim() }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Unable to log in.' }));
        setAuthError(error.message ?? 'Unable to log in.');
        return;
      }

      type StudentLoginPayload = {
        sessionId: string;
        classroomCode: string;
        role: 'student' | 'teacher';
        student?: {
          id: string;
          username: string;
        } | null;
      };

      const payload = (await res.json().catch(() => null)) as StudentLoginPayload | null;

      setClassroomCode('');
      setStudentName('');

      invalidatePendingSessionLoads();

      if (payload?.sessionId && payload.role === 'student') {
        setSession({
          id: payload.sessionId,
          createdAt: new Date().toISOString(),
          role: 'student',
          classroomCode: payload.classroomCode,
          chatEnabled: undefined,
          maxStudentEdits: undefined,
          student: payload.student ?? null,
          teacher: null,
        });
        setInitializing(false);
      }

      const confirmed = await waitForSessionRole('student');
      if (!confirmed) {
        await loadSession();
      }
    } catch (error) {
      console.error('Failed to log in', error);
      setAuthError('Something went wrong. Please try again.');
    } finally {
      setLoggingIn(false);
    }
  }, [classroomCode, studentName, waitForSessionRole, loadSession, invalidatePendingSessionLoads]);

  const handleGenerate = useCallback(
    async (parentSubmissionId?: string, promptOverride?: string) => {
      if (!promptOverride && !prompt.trim()) {
        setGenerateError('Please enter a prompt.');
        return;
      }

      const textPrompt = promptOverride ?? prompt;
      setGeneratingId(parentSubmissionId ?? 'new');
      setGenerateError(null);
      try {
        const body: {
          prompt: string;
          parentSubmissionId?: string;
          size: string;
          referenceImages?: string[];
        } = {
          prompt: textPrompt,
          parentSubmissionId,
          size,
        };

        if (referenceImages.length > 0 && !parentSubmissionId) {
          body.referenceImages = referenceImages;
        }

        const res = await fetch('/api/images/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({ message: 'Image generation failed.' }));
          setGenerateError(error.message ?? 'Image generation failed.');
          return;
        }

        setPrompt('');
        setReferenceImages([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
        // Reload submissions to show the new PENDING submission
        // Polling will automatically update it when generation completes
        await loadSubmissions();
      } catch (error) {
        console.error('Image generation failed', error);
        setGenerateError('Something went wrong while generating the image.');
      } finally {
        setGeneratingId(null);
      }
    },
    [prompt, size, loadSubmissions, referenceImages],
  );

  const handleShareToggle = useCallback(
    async (submissionId: string, share: boolean) => {
      setShareUpdatingId(submissionId);
      setShareError(null);
      try {
        const res = await fetch('/api/images/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ submissionId, share }),
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({ message: 'Unable to update sharing.' }));
          setShareError(error.message ?? 'Unable to update sharing.');
          return;
        }

        setSubmissions((prev) =>
          prev.map((item) =>
            item.id === submissionId ? { ...item, isShared: share } : item,
          ),
        );
      } catch (error) {
        console.error('Failed to update share state', error);
        setShareError('Something went wrong while updating sharing.');
      } finally {
        setShareUpdatingId(null);
      }
    },
    [],
  );

  const handleToggleLike = useCallback(
    async (submissionId: string, like: boolean) => {
      setLikingId(submissionId);
      setSocialError(null);
      try {
        const res = await fetch('/api/images/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ submissionId, like }),
        });

        const data = (await res.json().catch(() => null)) as
          | { submissionId: string; likeCount: number; liked: boolean; message?: string }
          | null;

        if (!res.ok || !data) {
          setSocialError(data?.message ?? 'Unable to update like.');
          return;
        }

        setSubmissions((prev) =>
          prev.map((item) =>
            item.id === submissionId
              ? { ...item, likedByCurrentUser: data.liked, likeCount: data.likeCount }
              : item,
          ),
        );
      } catch (error) {
        console.error('Failed to update like', error);
        setSocialError('Something went wrong while updating likes.');
      } finally {
        setLikingId(null);
      }
    },
    [],
  );

  const handleAddComment = useCallback(
    async (submissionId: string) => {
      const content = (commentDrafts[submissionId] ?? '').trim();
      if (content.length === 0) {
        setCommentErrors((prev) => ({
          ...prev,
          [submissionId]: 'Please enter a comment before submitting.',
        }));
        return;
      }

      setCommentErrors((prev) => ({ ...prev, [submissionId]: null }));
      setCommentSubmittingId(submissionId);
      setSocialError(null);

      try {
        const res = await fetch('/api/images/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ submissionId, content }),
        });

        const data = (await res.json().catch(() => null)) as
          | { submissionId: string; comment?: SubmissionComment; message?: string }
          | null;

        if (!res.ok || !data?.comment) {
          const message = data?.message ?? 'Unable to add comment.';
          setCommentErrors((prev) => ({ ...prev, [submissionId]: message }));
          return;
        }

        const newComment = data.comment;
        if (!newComment) {
          setCommentErrors((prev) => ({ ...prev, [submissionId]: 'Unable to add comment.' }));
          return;
        }

        setSubmissions((prev) =>
          prev.map((item) =>
            item.id === submissionId
              ? { ...item, comments: [...item.comments, newComment] }
              : item,
          ),
        );

        setCommentDrafts((prev) => ({ ...prev, [submissionId]: '' }));
      } catch (error) {
        console.error('Failed to add comment', error);
        setSocialError('Something went wrong while adding your comment.');
      } finally {
        setCommentSubmittingId(null);
      }
    },
    [commentDrafts],
  );

  const groupedSubmissions = useMemo(() => {
    const result = new Map<string, Submission[]>();
    for (const submission of submissions) {
      const rootId = submission.rootSubmissionId ?? submission.id;
      const current = result.get(rootId) ?? [];
      result.set(rootId, [...current, submission]);
    }

    return Array.from(result.entries()).map(([rootId, entries]) => ({
      rootId,
      submissions: entries.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    }));
  }, [submissions]);

  if (initializing) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--color-surface-subtle)]">
        <p className="text-lg text-[var(--color-muted)]">{t.common.loading}</p>
      </main>
    );
  }

  if (!session || session.role !== 'student') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#ede9fe] via-[#f7f5ff] to-[#ffffff] p-6">
        <div className="max-w-md w-full bg-[var(--color-surface)] shadow-[var(--shadow-soft)] rounded-2xl p-8 space-y-6 border border-[var(--color-border)]/70 backdrop-blur">
          <header className="space-y-2 text-center">
            <div className="flex justify-end mb-2">
              <LanguageToggle />
            </div>
            <h1 className="text-2xl font-semibold text-[var(--color-accent-strong)]">{t.student.signInTitle}</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {t.student.signInDesc}
            </p>
            {session?.role === 'teacher' ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {t.student.teacherAccess}{' '}
                <a className="text-[var(--color-accent)] underline" href="/teacher">
                  {t.student.dashboard}
                </a>
                .
              </p>
            ) : null}
          </header>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--color-foreground)]" htmlFor="classroom-code">
                {t.student.classroomCode}
              </label>
              <input
                id="classroom-code"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={classroomCode}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '');
                  setClassroomCode(digits.slice(0, 8));
                  setAuthError(null);
                }}
                placeholder={t.student.classroomCodePlaceholder}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-4 py-3 text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-accent)] transition"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--color-foreground)]" htmlFor="student-name">
                {t.student.yourName}
              </label>
              <input
                id="student-name"
                type="text"
                autoComplete="off"
                value={studentName}
                onChange={(event) => {
                  setStudentName(event.target.value);
                  setAuthError(null);
                }}
                placeholder={t.student.yourNamePlaceholder}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-4 py-3 text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-accent)] transition"
              />
            </div>
            {authError ? <p className="text-sm text-rose-500">{authError}</p> : null}
          </div>
          <button
            onClick={() => void handleLogin()}
            disabled={
              loggingIn ||
              classroomCode.length !== 8 ||
              studentName.trim().length < 2
            }
            className="w-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)] text-white font-medium py-3 rounded-lg transition"
          >
            {loggingIn ? t.student.signingIn : t.student.enterClassroom}
          </button>
          <div className="pt-2 border-t border-[var(--color-border)]">
            <button
              onClick={() => router.push('/teacher')}
              className="w-full text-sm border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-subtle)] font-medium py-2.5 rounded-lg transition"
            >
              {t.student.iAmTeacher}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-[var(--color-foreground)]">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <StudentNav />
              <LanguageToggle />
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-[var(--color-accent-strong)]">{t.student.headerTitle}</h1>
              <p className="text-sm text-[var(--color-muted)]">
                {t.student.headerDesc}
              </p>
            </div>
          </div>
          <div className="text-sm text-[var(--color-muted-foreground)] text-right space-y-1">
            {session.hasTeacherAccess && (
              <div className="mb-2">
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/teacher/return-to-teacher', {
                        method: 'POST',
                        credentials: 'include',
                      });
                      if (res.ok) {
                        window.location.href = '/teacher';
                      } else {
                        const error = await res.json().catch(() => ({ message: 'Failed to return to teacher view.' }));
                        alert(error.message ?? 'Failed to return to teacher view.');
                      }
                    } catch (error) {
                      console.error('Failed to return to teacher view', error);
                      alert('Failed to return to teacher view.');
                    }
                  }}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition"
                >
                  {t.teacher.returnToTeacherView}
                </button>
              </div>
            )}
            <p>
              {t.student.signedInAs}{' '}
              <span className="font-medium text-[var(--color-foreground)]">
                {session.student?.username ?? 'Student'}
              </span>
            </p>
            <p>
              {t.student.sessionStartedAt}{' '}
              <span className="font-medium text-[var(--color-foreground)]">
                {toDisplayTime(session.createdAt)}
              </span>
            </p>
            {session.classroomCode ? (
              <p>
                {t.student.classroomCode}{' '}
                <span className="font-medium text-[var(--color-foreground)]">{session.classroomCode}</span>
              </p>
            ) : null}
          </div>
        </header>

        <section className="bg-[var(--color-surface)] rounded-2xl shadow-[var(--shadow-soft)] border border-[var(--color-border)] p-6 space-y-4 backdrop-blur-sm">
          <h2 className="text-xl font-semibold text-[var(--color-foreground)]">{t.student.createImageTitle}</h2>
          <p className="text-sm text-[var(--color-muted)]">
            {t.student.createImageDesc}
          </p>
          <textarea
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              if (generateError) setGenerateError(null);
            }}
            placeholder={t.student.promptPlaceholder}
            className="w-full min-h-28 rounded-xl border border-[var(--color-border)] bg-[var(--color-input)] px-4 py-3 text-base text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-accent)] transition"
          />
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <label htmlFor="image-size" className="text-sm font-medium text-[var(--color-foreground)]">
                  {t.student.imageSize}:
                </label>
                <select
                  id="image-size"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-accent)] transition"
                >
                  <option value="2048x2048">{t.student.sizeSquare}</option>
                  <option value="2560x1440">{t.student.sizeLandscape}</option>
                  <option value="1440x2560">{t.student.sizePortrait}</option>
                  <option value="4096x4096">{t.student.sizeLargeSquare}</option>
                </select>
              </div>
            </div>

            {/* Drag and Drop Zone */}
            <div
              className={`relative w-full rounded-xl border-2 border-dashed transition-all duration-200 p-6 flex flex-col items-center justify-center gap-3 cursor-pointer group
                ${isDragging
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]/10 scale-[1.005]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent-muted)] hover:bg-[var(--color-surface-subtle)]'
                }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(true);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length > 0) {
                  const newImages: string[] = [];
                  let error: string | null = null;
                  let processed = 0;
                  files.forEach(file => {
                    // Check type
                    if (!file.type.startsWith('image/')) {
                      processed++;
                      if (processed === files.length && !error && newImages.length > 0) {
                        setReferenceImages(prev => [...prev, ...newImages]);
                        setGenerateError(null);
                      }
                      return;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                      error = t.student.imagesTooLarge;
                      processed++;
                      if (processed === files.length && error) setGenerateError(error);
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      if (ev.target?.result) {
                        newImages.push(ev.target.result as string);
                      }
                      processed++;
                      if (processed === files.length) {
                        if (error) setGenerateError(error);
                        else {
                          setGenerateError(null);
                          setReferenceImages(prev => [...prev, ...newImages]);
                        }
                      }
                    };
                    reader.readAsDataURL(file);
                  });
                }
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) {
                    const newImages: string[] = [];
                    let error: string | null = null;
                    let processed = 0;
                    files.forEach(file => {
                      if (file.size > 5 * 1024 * 1024) {
                        error = t.student.imagesTooLarge;
                        processed++;
                        if (processed === files.length && error) setGenerateError(error);
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        if (ev.target?.result) {
                          newImages.push(ev.target.result as string);
                        }
                        processed++;
                        if (processed === files.length) {
                          if (error) setGenerateError(error);
                          else {
                            setGenerateError(null);
                            setReferenceImages(prev => [...prev, ...newImages]);
                          }
                        }
                      };
                      reader.readAsDataURL(file);
                    });
                  }
                }}
              />
              <div className="rounded-full bg-[var(--color-surface-subtle)] p-3 group-hover:scale-110 transition-transform">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-muted-foreground)]"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-[var(--color-foreground)]">{t.student.dropReferenceImages}</p>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">{t.student.orClickToUpload}</p>
              </div>
            </div>

            {referenceImages.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {referenceImages.map((img, idx) => (
                  <div key={idx} className="relative w-24 h-24 rounded-lg overflow-hidden border border-[var(--color-border)] group">
                    <Image
                      src={img}
                      alt={`Reference ${idx + 1}`}
                      fill
                      className="object-cover"
                    />
                    <button
                      onClick={() => {
                        setReferenceImages(prev => prev.filter((_, i) => i !== idx));
                      }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-white"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {generateError ? <p className="text-sm text-rose-600">{generateError}</p> : null}
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <button
              onClick={() => void handleGenerate()}
              disabled={generatingId !== null || prompt.trim().length < 5}
              className="inline-flex items-center gap-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)] text-white font-medium px-5 py-3 rounded-lg transition"
            >
              {generatingId === 'new' ? t.student.generating : t.student.generateImage}
            </button>
            <button
              onClick={() => {
                setPrompt('');
                setReferenceImages([]);
                if (fileInputRef.current) fileInputRef.current.value = '';
                setGenerateError(null);
              }}
              className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition"
            >
              {t.student.clearPrompt}
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Classroom gallery</h2>
            <button
              onClick={() => void loadSubmissions()}
              className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
            >
              {fetchingSubmissions ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          {shareError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {shareError}
            </div>
          ) : null}
          {socialError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {socialError}
            </div>
          ) : null}
          {submissions.length === 0 ? (
            <div className="bg-[var(--color-surface)] border border-dashed border-[var(--color-border)] rounded-2xl p-10 text-center text-[var(--color-muted-foreground)]">
              No images yet. Be the first to create one!
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {groupedSubmissions.map(({ rootId, submissions: chain }) => {
                const first = chain[0];
                const chainShared = chain.some((entry) => entry.isShared);
                const ownedByMe = chain.some((entry) => entry.ownedByCurrentUser);
                const ownerLabel = ownedByMe ? 'You' : first?.studentUsername ?? 'Classmate';
                return (
                  <article key={rootId} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-[var(--shadow-soft)] p-5 space-y-5">
                    <header className="space-y-2">


                      <p className="text-sm text-[var(--color-muted-foreground)]">Started {toDisplayTime(first?.createdAt ?? '')}</p>
                      <TruncatedText
                        text={first?.prompt ?? ''}
                        lines={5}
                        className="text-base font-medium text-[var(--color-foreground)]"
                      />
                      <div className="flex flex-wrap gap-2 text-xs text-[var(--color-muted-foreground)]">
                        <span className="rounded-full bg-[var(--color-surface-subtle)] px-3 py-1 font-medium text-[var(--color-muted)]">
                          Owner: {ownerLabel}
                        </span>
                        <span className={`rounded-full px-3 py-1 font-medium ${chainShared ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'bg-[var(--color-surface-subtle)] text-[var(--color-muted-foreground)]'}`}>
                          {chainShared ? 'Shared with class' : 'Private to you'}
                        </span>
                      </div>
                    </header>
                    <div className="space-y-6">
                      {chain.map((submission) => (
                        <div key={submission.id} className="space-y-3">
                          <div className="relative overflow-hidden rounded-xl border border-[var(--color-border)]">
                            {submission.status === 'PENDING' ? (
                              <div className="h-64 flex flex-col items-center justify-center gap-3 text-[var(--color-muted-foreground)]">
                                <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-accent)] border-t-transparent"></div>
                                <span className="text-sm">Generating image...</span>
                              </div>
                            ) : (submission.imageUrl || submission.imageData) ? (
                              <div
                                className="relative aspect-[4/3] w-full cursor-pointer hover:opacity-95 transition"
                                onClick={() => {
                                  setSelectedImage({
                                    src: submission.imageUrl || `data:${submission.imageMimeType ?? 'image/png'};base64,${submission.imageData}`,
                                    prompt: submission.prompt,
                                    mimeType: submission.imageMimeType
                                  });
                                }}
                              >
                                <Image
                                  src={submission.imageUrl || `data:${submission.imageMimeType ?? 'image/png'};base64,${submission.imageData}`}
                                  alt={submission.prompt}
                                  fill
                                  sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                                  unoptimized
                                  className="object-cover"
                                />
                              </div>
                            ) : (
                              <div className="h-64 flex items-center justify-center text-[var(--color-muted-foreground)] p-4 text-center">
                                {submission.status === 'ERROR' ? (
                                  <span className="text-sm text-rose-400 break-words w-full">
                                    {submission.errorMessage ?? 'Image generation failed'}
                                  </span>
                                ) : (
                                  <span className="text-sm">Image unavailable</span>
                                )}
                              </div>
                            )}
                            <div className="absolute top-3 right-3 text-xs bg-[var(--color-surface)]/80 px-3 py-1 rounded-full text-[var(--color-muted)]">
                              {submission.revisionIndex === 0 ? 'Original' : `Refinement ${submission.revisionIndex}`}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                              Created at {toDisplayTime(submission.createdAt)}
                            </span>
                            {submission.status === 'SUCCESS' ? (
                              <span className="text-xs font-semibold text-[var(--color-accent-strong)] bg-[var(--color-accent-soft)] px-3 py-1 rounded-full">
                                {submission.remainingEdits} refinements left
                              </span>
                            ) : null}
                            {submission.status === 'ERROR' ? (
                              <span className="text-xs font-semibold text-rose-700 bg-rose-100 px-3 py-1 rounded-full">
                                {submission.errorMessage ?? 'Generation failed'}
                              </span>
                            ) : null}
                            {submission.status === 'SUCCESS' && submission.isShared ? (
                              <span className="text-xs font-semibold text-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-1 rounded-full">
                                Shared
                              </span>
                            ) : null}
                          </div>
                          {submission.status === 'SUCCESS' ? (
                            <div className="flex flex-wrap gap-3">
                              <button
                                onClick={() => downloadImage(submission)}
                                className="text-sm font-medium text-[var(--color-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-foreground)] transition"
                              >
                                Download
                              </button>
                              {submission.ownedByCurrentUser ? (
                                <button
                                  onClick={() => void handleShareToggle(submission.id, !submission.isShared)}
                                  disabled={shareUpdatingId === submission.id}
                                  className={`text-sm font-medium rounded-lg px-3 py-2 transition border ${submission.isShared
                                    ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent-soft)]/80'
                                    : 'border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)]'
                                    } disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)]`}
                                >
                                  {shareUpdatingId === submission.id
                                    ? 'Saving...'
                                    : submission.isShared
                                      ? 'Unshare'
                                      : 'Share with class'}
                                </button>
                              ) : null}
                              {submission.ownedByCurrentUser && submission.remainingEdits > 0 ? (
                                <RefineButton
                                  key={`${submission.id}-refine`}
                                  submission={submission}
                                  onRefine={handleGenerate}
                                  disabled={generatingId !== null}
                                />
                              ) : null}
                            </div>
                          ) : null}
                          {submission.status === 'SUCCESS' ? (
                            <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
                              <div className="flex items-center justify-between gap-3">
                                <button
                                  onClick={() => void handleToggleLike(submission.id, !submission.likedByCurrentUser)}
                                  disabled={likingId === submission.id || !submission.isShared}
                                  className={`text-sm font-medium px-4 py-2 rounded-lg transition ${submission.likedByCurrentUser
                                    ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-strong)]'
                                    : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] disabled:hover:bg-[var(--color-surface-subtle)]'
                                    } ${!submission.isShared ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                  {likingId === submission.id
                                    ? 'Saving...'
                                    : submission.likedByCurrentUser
                                      ? 'Unlike'
                                      : 'Like'}
                                </button>
                                <span className="text-sm text-[var(--color-muted)]">
                                  {submission.likeCount} {submission.likeCount === 1 ? 'like' : 'likes'}
                                </span>
                              </div>
                              {submission.isShared ? (
                                <div className="space-y-3">
                                  <div className="space-y-2">
                                    {submission.comments.length === 0 ? (
                                      <p className="text-sm text-[var(--color-muted-foreground)]">No comments yet. Be the first to respond.</p>
                                    ) : (
                                      submission.comments.map((comment) => (
                                        <div key={comment.id} className="space-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                                          <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)]">
                                            <span className="font-medium text-[var(--color-muted)]">
                                              {comment.ownedByCurrentUser
                                                ? 'You'
                                                : comment.studentUsername ?? 'Classmate'}
                                            </span>
                                            <span>{toDisplayTime(comment.createdAt)}</span>
                                          </div>
                                          <p className="text-sm text-[var(--color-foreground)]">{comment.content}</p>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div className="space-y-2">
                                    <textarea
                                      value={commentDrafts[submission.id] ?? ''}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setCommentDrafts((prev) => ({ ...prev, [submission.id]: value }));
                                        if (commentErrors[submission.id]) {
                                          setCommentErrors((prev) => ({ ...prev, [submission.id]: null }));
                                        }
                                      }}
                                      placeholder="Add a comment for your classmates"
                                      className="w-full min-h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-accent)] transition"
                                      disabled={commentSubmittingId === submission.id}
                                    />
                                    {commentErrors[submission.id] ? (
                                      <p className="text-xs text-rose-600">{commentErrors[submission.id]}</p>
                                    ) : null}
                                    <div className="flex justify-end">
                                      <button
                                        onClick={() => void handleAddComment(submission.id)}
                                        disabled={commentSubmittingId === submission.id}
                                        className="text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] disabled:bg-[var(--color-surface-muted)] rounded-lg px-4 py-2 transition"
                                      >
                                        {commentSubmittingId === submission.id ? 'Posting...' : 'Post comment'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-[var(--color-muted-foreground)] italic">
                                  Only you can see this image right now. Share it to let classmates like and comment.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Image Modal */}
        {selectedImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            onClick={() => setSelectedImage(null)}
          >
            <div
              className="relative max-w-5xl w-full bg-[var(--color-surface)] rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative aspect-video bg-[var(--color-surface-subtle)] flex items-center justify-center">
                <Image
                  src={selectedImage.src}
                  alt={selectedImage.prompt}
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
              <div className="p-6 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-[var(--color-foreground)] text-lg mb-1">{t.student.imageDetails}</h3>
                    <p className="text-[var(--color-muted)] max-h-60 overflow-y-auto whitespace-pre-wrap">{selectedImage.prompt}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = selectedImage.src;
                        link.download = 'classroom-image.png';
                        link.click();
                      }}
                      className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-white px-4 py-2 rounded-lg font-medium transition"
                    >
                      {t.common.download}
                    </button>
                    <button
                      onClick={() => setSelectedImage(null)}
                      className="bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-muted)] text-[var(--color-foreground)] px-4 py-2 rounded-lg font-medium transition"
                    >
                      {t.common.close}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

interface RefineButtonProps {
  submission: Submission;
  onRefine: (parentSubmissionId: string, promptOverride: string) => Promise<void>;
  disabled: boolean;
}

function RefineButton({ submission, onRefine, disabled }: RefineButtonProps) {
  const [open, setOpen] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState(submission.prompt);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (refinePrompt.trim().length < 5) {
      setError('Please describe at least five characters.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onRefine(submission.id, refinePrompt);
      setOpen(false);
    } catch (err) {
      console.error('Refine failed', err);
      setError('Unable to refine image.');
    } finally {
      setLoading(false);
    }
  }, [refinePrompt, onRefine, submission.id]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] disabled:bg-[var(--color-surface-muted)] rounded-lg px-3 py-2 transition"
      >
        Refine image
      </button>
    );
  }

  return (
    <div className="w-full border border-[var(--color-border)] rounded-xl p-3 space-y-3 bg-[var(--color-surface-subtle)]">
      <textarea
        value={refinePrompt}
        onChange={(event) => {
          setRefinePrompt(event.target.value);
          if (error) setError(null);
        }}
        className="w-full min-h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-accent)] transition"
      />
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void handleSubmit()}
          disabled={disabled || loading}
          className="text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] disabled:bg-[var(--color-surface-muted)] rounded-lg px-3 py-2 transition"
        >
          {loading ? 'Refining...' : 'Submit refinement'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
