'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface TeacherSessionState {
  id: string;
  createdAt: string;
  isActive: boolean;
  chatEnabled: boolean;
  maxStudentEdits: number;
}

interface ActivitySubmission {
  id: string;
  prompt: string;
  role: 'STUDENT' | 'TEACHER';
  createdAt: string;
  status: 'PENDING' | 'SUCCESS' | 'ERROR';
  revisionIndex: number;
  parentSubmissionId: string | null;
  rootSubmissionId: string | null;
  imageData: string | null;
  imageMimeType: string | null;
  errorMessage: string | null;
  isShared: boolean;
  studentUsername: string | null;
}

interface ActivityApiSubmission extends Omit<ActivitySubmission, 'studentUsername'> {
  student: { username: string | null } | null;
}

interface ActivityResponse {
  session: TeacherSessionState;
  submissions: ActivityApiSubmission[];
}

interface GallerySubmission {
  id: string;
  prompt: string;
  createdAt: string;
  status: 'PENDING' | 'SUCCESS' | 'ERROR';
  revisionIndex: number;
  imageData: string | null;
  imageMimeType: string | null;
  isShared: boolean;
  studentUsername: string | null;
}

type ImagesResponse = {
  submissions?: Array<GallerySubmission & { remainingEdits?: number; ownedByCurrentUser?: boolean }>;
};

interface TeacherChatMessage {
  id: string;
  content: string;
  sender: 'STUDENT' | 'AI';
  createdAt: string;
}

interface TeacherChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  student: {
    id: string;
    username: string | null;
  } | null;
  messages: TeacherChatMessage[];
}

interface TeacherChatsResponse {
  threads?: Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    student: {
      id: string;
      username: string | null;
    } | null;
    messages: Array<{
      id: string;
      content: string;
      sender: 'STUDENT' | 'AI';
      createdAt: string;
    }>;
  }>;
}

interface SessionResponse {
  session: {
    id: string;
    createdAt: string;
    classroomCode?: string;
    role: 'student' | 'teacher' | undefined;
    chatEnabled?: boolean;
    maxStudentEdits?: number;
    teacher?: {
      id: string;
      username: string;
      displayName: string | null;
    } | null;
  } | null;
}

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(iso: string) {
  try {
    return timestampFormatter.format(new Date(iso));
  } catch {
    return '';
  }
}

export default function TeacherDashboard() {
  const [session, setSession] = useState<SessionResponse['session']>(null);
  const [loading, setLoading] = useState(true);
  const [teacherUsername, setTeacherUsername] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [activity, setActivity] = useState<ActivitySubmission[]>([]);
  const [gallery, setGallery] = useState<GallerySubmission[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [credentialCount, setCredentialCount] = useState(10);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Array<{ username: string; password: string }>>([]);
  const [chats, setChats] = useState<TeacherChatThread[]>([]);
  const [expandedChats, setExpandedChats] = useState<string[]>([]);
  const [chatEnabledSetting, setChatEnabledSetting] = useState(true);
  const [maxEditsDraft, setMaxEditsDraft] = useState(3);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const sessionRequestIdRef = useRef(0);

  const invalidatePendingSessionLoads = useCallback(() => {
    sessionRequestIdRef.current += 1;
  }, []);

  const loadSession = useCallback(async () => {
    const requestId = ++sessionRequestIdRef.current;
    try {
      const res = await fetch('/api/session', { credentials: 'include' });
      const data: SessionResponse = await res.json();
      if (sessionRequestIdRef.current !== requestId) {
        return;
      }
      setSession(data.session);
    } catch (error) {
      console.error('Failed to load session', error);
      if (sessionRequestIdRef.current !== requestId) {
        return;
      }
      setSession(null);
    } finally {
      if (sessionRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const waitForSessionRole = useCallback(async (expectedRole: 'teacher') => {
    const attempts = 20;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        if (!res.ok) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        const data: SessionResponse = await res.json();
        if (data.session?.role === expectedRole) {
          setSession(data.session);
          setLoading(false);
          return data.session;
        }
      } catch (error) {
        console.error('Failed to confirm session role', error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }, []);

  const loadActivity = useCallback(async () => {
    if (!session?.id) return;
    setRefreshing(true);
    try {
      const [activityRes, galleryRes, chatsRes] = await Promise.all([
        fetch('/api/teacher/activity', { credentials: 'include' }),
        fetch('/api/images', { credentials: 'include' }),
        fetch('/api/teacher/chats', { credentials: 'include' }),
      ]);

      if (activityRes.ok) {
        const activityData: ActivityResponse = await activityRes.json();
        setActivity(
          activityData.submissions.map(({ student, ...rest }) => ({
            ...rest,
            studentUsername: student?.username ?? null,
          })),
        );
        setSession((prev) =>
          prev
            ? {
                ...prev,
                chatEnabled: activityData.session.chatEnabled,
                maxStudentEdits: activityData.session.maxStudentEdits,
              }
            : prev,
        );
      }

      if (galleryRes.ok) {
        const galleryData: ImagesResponse = await galleryRes.json();
        setGallery(
          (galleryData.submissions ?? []).map((entry) => ({
            id: entry.id,
            prompt: entry.prompt,
            createdAt: entry.createdAt,
            status: entry.status,
            revisionIndex: entry.revisionIndex,
            imageData: entry.imageData,
            imageMimeType: entry.imageMimeType,
            isShared: entry.isShared,
            studentUsername: entry.studentUsername ?? null,
          })),
        );
      }

      if (chatsRes.ok) {
        const chatData: TeacherChatsResponse = await chatsRes.json();
        const chatThreads: TeacherChatThread[] = (chatData.threads ?? []).map((thread) => ({
          id: thread.id,
          title: thread.title,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          student: thread.student ?? null,
          messages: (thread.messages ?? []).map((message) => ({
            id: message.id,
            content: message.content,
            sender: message.sender,
            createdAt: message.createdAt,
          })),
        }));
        setChats(chatThreads);
      }
    } catch (error) {
      console.error('Failed to load activity', error);
    } finally {
      setRefreshing(false);
    }
  }, [session?.id]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadSession();
    }, 15000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadSession]);

  useEffect(() => {
    if (session?.id && session.role === 'teacher') {
      void loadActivity();
    }
  }, [session?.id, session?.role, loadActivity]);

  useEffect(() => {
    if (session?.role === 'teacher') {
      if (typeof session.chatEnabled === 'boolean') {
        setChatEnabledSetting(session.chatEnabled);
      }
      if (typeof session.maxStudentEdits === 'number' && Number.isFinite(session.maxStudentEdits)) {
        setMaxEditsDraft(session.maxStudentEdits);
      }
    }
  }, [session?.role, session?.chatEnabled, session?.maxStudentEdits]);

  const handleTeacherLogin = useCallback(async () => {
    if (teacherUsername.trim().length === 0) {
      setFormError('Enter your teacher username to continue.');
      return;
    }
    if (teacherPassword.length === 0) {
      setFormError('Enter your teacher password to continue.');
      return;
    }

    setFormLoading(true);
    setFormError(null);
    try {
      const res = await fetch('/api/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: teacherUsername.trim(),
          password: teacherPassword,
        }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Unable to sign in.' }));
        setFormError(error.message ?? 'Unable to sign in.');
        return;
      }

      type TeacherLoginPayload = {
        session?: {
          id: string;
          classroomCode: string;
          createdAt: string;
          chatEnabled: boolean;
          maxStudentEdits: number;
        };
        teacher?: {
          id: string;
          username: string;
          displayName: string | null;
        } | null;
      };

      const payload = (await res.json().catch(() => null)) as TeacherLoginPayload | null;

      setTeacherPassword('');
      setCredentials([]);
      setChats([]);
      setExpandedChats([]);

      invalidatePendingSessionLoads();

      if (payload?.session) {
        setSession({
          id: payload.session.id,
          createdAt: payload.session.createdAt,
          role: 'teacher',
          chatEnabled: payload.session.chatEnabled,
          maxStudentEdits: payload.session.maxStudentEdits,
          classroomCode: payload.session.classroomCode,
          teacher: payload.teacher ?? null,
        });
        setLoading(false);
        setChatEnabledSetting(payload.session.chatEnabled);
        setMaxEditsDraft(payload.session.maxStudentEdits);
      }

      const confirmed = await waitForSessionRole('teacher');
      if (!confirmed) {
        await loadSession();
      }
      await loadActivity();
    } catch (error) {
      console.error('Failed to sign in as teacher', error);
      setFormError('Something went wrong while signing in.');
    } finally {
      setFormLoading(false);
    }
  }, [teacherUsername, teacherPassword, waitForSessionRole, loadSession, loadActivity, invalidatePendingSessionLoads]);

  const handleEndSession = useCallback(async () => {
    setFormLoading(true);
    try {
      await fetch('/api/session/end', {
        method: 'POST',
        credentials: 'include',
      });
      await loadSession();
      setCredentials([]);
      setActivity([]);
      setGallery([]);
      setChats([]);
      setExpandedChats([]);
      setTeacherUsername('');
      setTeacherPassword('');
    } catch (error) {
      console.error('Failed to end session', error);
    } finally {
      setFormLoading(false);
    }
  }, [loadSession]);

  const handleGenerateCredentials = useCallback(async () => {
    if (!session?.id) return;
    const safeCount = Math.min(50, Math.max(1, Math.floor(credentialCount)));
    setCredentialCount(safeCount);
    setCredentialLoading(true);
    setCredentialError(null);
    try {
      const res = await fetch('/api/teacher/students/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ count: safeCount }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Unable to generate credentials.' }));
        setCredentialError(error.message ?? 'Unable to generate credentials.');
        return;
      }

      const data = await res.json();
      setCredentials(data.credentials ?? []);
    } catch (error) {
      console.error('Failed to generate credentials', error);
      setCredentialError('Something went wrong while generating credentials.');
    } finally {
      setCredentialLoading(false);
    }
  }, [credentialCount, session?.id]);

  const handleDownloadCredentials = useCallback(() => {
    if (credentials.length === 0) return;
    const rows = [['Username', 'Password'], ...credentials.map(({ username, password }) => [username, password])];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `student-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [credentials]);

  const handleToggleChatAssistant = useCallback(async () => {
    if (!session?.id) return;
    const nextValue = !chatEnabledSetting;
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsNotice(null);

    try {
      const res = await fetch('/api/teacher/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ chatEnabled: nextValue }),
      });

      if (res.status === 403) {
        const error = await res.json().catch(() => ({ message: 'Teacher access only. Please rejoin the dashboard.' }));
        setSettingsError(error.message ?? 'Teacher access only. Please rejoin the dashboard.');
        await loadSession();
        return;
      }

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Unable to update chat assistant.' }));
        setSettingsError(error.message ?? 'Unable to update chat assistant.');
        return;
      }

      const data = await res.json();
      const updated = data.session as { chatEnabled?: boolean; maxStudentEdits?: number } | undefined;
      const resolvedChatEnabled =
        typeof updated?.chatEnabled === 'boolean' ? updated.chatEnabled : nextValue;

      setChatEnabledSetting(resolvedChatEnabled);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              chatEnabled: resolvedChatEnabled,
              maxStudentEdits:
                typeof updated?.maxStudentEdits === 'number'
                  ? updated.maxStudentEdits
                  : prev.maxStudentEdits,
            }
          : prev,
      );

      if (typeof updated?.maxStudentEdits === 'number') {
        setMaxEditsDraft(updated.maxStudentEdits);
      }

      setSettingsNotice(
        resolvedChatEnabled ? 'Chat assistant enabled for students.' : 'Chat assistant disabled for students.',
      );
    } catch (error) {
      console.error('Failed to update chat assistant', error);
      setSettingsError('Unable to update the chat assistant right now.');
    } finally {
      setSettingsSaving(false);
    }
  }, [session?.id, chatEnabledSetting, loadSession]);

  const handleSaveMaxEdits = useCallback(async () => {
    if (!session?.id) return;
    const parsed = Number.isFinite(maxEditsDraft) ? maxEditsDraft : 1;
    const safeValue = Math.min(10, Math.max(1, Math.floor(parsed)));
    setMaxEditsDraft(safeValue);
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsNotice(null);

    try {
      const res = await fetch('/api/teacher/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ maxStudentEdits: safeValue }),
      });

      if (res.status === 403) {
        const error = await res.json().catch(() => ({ message: 'Teacher access only. Please rejoin the dashboard.' }));
        setSettingsError(error.message ?? 'Teacher access only. Please rejoin the dashboard.');
        await loadSession();
        return;
      }

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Unable to update refinements.' }));
        setSettingsError(error.message ?? 'Unable to update refinements.');
        return;
      }

      const data = await res.json();
      const updated = data.session as { chatEnabled?: boolean; maxStudentEdits?: number } | undefined;
      const resolvedMaxEdits =
        typeof updated?.maxStudentEdits === 'number' ? updated.maxStudentEdits : safeValue;

      setMaxEditsDraft(resolvedMaxEdits);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              maxStudentEdits: resolvedMaxEdits,
              chatEnabled:
                typeof updated?.chatEnabled === 'boolean' ? updated.chatEnabled : prev.chatEnabled,
            }
          : prev,
      );

      if (typeof updated?.chatEnabled === 'boolean') {
        setChatEnabledSetting(updated.chatEnabled);
      }

      setSettingsNotice(
        `Students now have ${resolvedMaxEdits} ${resolvedMaxEdits === 1 ? 'edit' : 'edits'} per image.`,
      );
    } catch (error) {
      console.error('Failed to update maximum student refinements', error);
      setSettingsError('Unable to update the maximum refinements right now.');
    } finally {
      setSettingsSaving(false);
    }
  }, [session?.id, maxEditsDraft, loadSession]);

  const toggleChatExpansion = useCallback((threadId: string) => {
    setExpandedChats((prev) =>
      prev.includes(threadId) ? prev.filter((id) => id !== threadId) : [...prev, threadId],
    );
  }, []);

  const promptsByRoot = useMemo(() => {
    const groups = new Map<string, ActivitySubmission[]>();
    for (const entry of activity) {
      const rootId = entry.rootSubmissionId ?? entry.id;
      const list = groups.get(rootId) ?? [];
      groups.set(rootId, [...list, entry]);
    }
    return Array.from(groups.values()).map((entries) =>
      entries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    );
  }, [activity]);

  const chatsByStudent = useMemo(() => {
    const groups = new Map<string, { studentName: string; threads: TeacherChatThread[] }>();
    for (const thread of chats) {
      const key = thread.student?.id ?? 'unknown';
      const entry = groups.get(key) ?? {
        studentName: thread.student?.username ?? 'Unknown student',
        threads: [],
      };
      entry.threads.push(thread);
      groups.set(key, entry);
    }
    return Array.from(groups.values()).map((group) => ({
      studentName: group.studentName,
      threads: group.threads.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    }));
  }, [chats]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--color-surface-subtle)] text-[var(--color-foreground)]">
        Loading teacher dashboard...
      </main>
    );
  }

  if (!session || session.role !== 'teacher') {
    return (
      <main className="min-h-screen bg-[var(--color-surface-subtle)] text-[var(--color-foreground)] flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-8">
          <header className="space-y-2 text-center">
            <h1 className="text-3xl font-semibold text-[var(--color-accent-strong)]">Teacher Control Center</h1>
            <p className="text-sm text-[var(--color-muted)]">
              Sign in with your assigned teacher credentials to open a fresh classroom and share the code with students.
            </p>
          </header>
          <section className="bg-[var(--color-accent-soft)]/40 backdrop-blur rounded-2xl p-6 space-y-5 border border-[var(--color-border)]/70">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]" htmlFor="teacher-username">
                Username
              </label>
              <input
                id="teacher-username"
                type="text"
                value={teacherUsername}
                onChange={(event) => {
                  setTeacherUsername(event.target.value);
                  setFormError(null);
                }}
                autoComplete="username"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition"
                placeholder="e.g. ms-jackson"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]" htmlFor="teacher-password">
                Password
              </label>
              <input
                id="teacher-password"
                type="password"
                value={teacherPassword}
                onChange={(event) => {
                  setTeacherPassword(event.target.value);
                  setFormError(null);
                }}
                autoComplete="current-password"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition"
                placeholder="Enter your password"
              />
            </div>
            {formError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {formError}
              </div>
            ) : null}
            <button
              onClick={() => void handleTeacherLogin()}
              disabled={formLoading || teacherUsername.trim().length === 0 || teacherPassword.length === 0}
              className="w-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-white font-semibold py-2 rounded-lg transition disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)]"
            >
              {formLoading ? 'Signing in...' : 'Enter dashboard'}
            </button>
          </section>
        </div>
      </main>
    );
  }

  const resolvedDisplayName = session.teacher?.displayName?.trim() ?? null;
  const teacherDisplayName = resolvedDisplayName && resolvedDisplayName.length > 0
    ? resolvedDisplayName
    : session.teacher?.username ?? 'Teacher';
  const classroomCode = session.classroomCode ?? '';

  const displayMaxEdits = Number.isFinite(session.maxStudentEdits ?? Number.NaN)
    ? (session.maxStudentEdits as number)
    : Number.isNaN(maxEditsDraft)
      ? 3
      : maxEditsDraft;

  return (
    <main className="min-h-screen bg-[var(--color-surface-muted)] text-[var(--color-foreground)]">
      <div className="max-w-7xl mx-auto px-8 py-10 space-y-10">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold">Teacher Dashboard</h1>
            <p className="text-sm text-[var(--color-muted)]">
              Hello <span className="text-[var(--color-foreground)] font-medium">{teacherDisplayName}</span>.
              {classroomCode ? (
                <>
                  {' '}
                  Share classroom code{' '}
                  <span className="font-mono tracking-[0.35em] text-lg text-[var(--color-accent)]">{classroomCode}</span> with students to let them join.
                </>
              ) : null}{' '}
              Monitor prompts, review generated images, and export today&apos;s class session.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={() => void loadActivity()}
              className="text-sm bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface)] px-4 py-2 rounded-lg"
            >
              {refreshing ? 'Refreshing...' : 'Refresh data'}
            </button>
            <button
              onClick={() => {
                window.open('/api/teacher/export', '_blank');
              }}
              className="text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-white px-4 py-2 rounded-lg"
            >
              Export session JSON
            </button>
            <button
              onClick={() => void handleEndSession()}
              className="text-sm bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg"
            >
              End session
            </button>
          </div>
        </header>

        <section className="bg-[var(--color-surface)]/80 rounded-2xl border border-[var(--color-border)]/70 p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-[var(--color-muted-foreground)]">Classroom code</p>
            <p className="font-mono text-2xl text-[var(--color-accent)] tracking-widest">
              {classroomCode || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-muted-foreground)]">Session ID</p>
            <p className="font-mono text-[var(--color-muted)] text-sm">{session.id}</p>
          </div>
            <div>
              <p className="text-xs text-[var(--color-muted-foreground)]">Started</p>
              <p className="text-sm text-[var(--color-muted)]">{formatTimestamp(session.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-muted-foreground)]">Total submissions</p>
              <p className="text-sm text-[var(--color-muted)]">{activity.length}</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface-subtle)] px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">Chat assistant</p>
                <p className="text-sm text-[var(--color-foreground)]">
                  {chatEnabledSetting ? 'On for students' : 'Off for students'}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Students lose access immediately when disabled.</p>
              </div>
              <button
                onClick={() => void handleToggleChatAssistant()}
                disabled={settingsSaving}
                className={`text-xs font-semibold px-3 py-2 rounded-lg transition border ${
                  chatEnabledSetting
                    ? 'bg-rose-600/20 border-rose-500 text-rose-200 hover:bg-rose-600/30'
                    : 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30'
                } ${settingsSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {settingsSaving ? 'Saving...' : chatEnabledSetting ? 'Turn off' : 'Turn on'}
              </button>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface-subtle)] px-4 py-3">
              <div>
                <label className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]" htmlFor="max-edits">
                  Max refinements per image
                </label>
                <p className="text-sm text-[var(--color-foreground)]">
                  {displayMaxEdits} {displayMaxEdits === 1 ? 'edit' : 'edits'} allowed
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Choose between 1 and 10 total AI image generations in a chain.</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <input
                  id="max-edits"
                  type="number"
                  min={1}
                  max={10}
                  value={Number.isNaN(maxEditsDraft) ? '' : maxEditsDraft}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === '') {
                      setMaxEditsDraft(Number.NaN);
                      return;
                    }
                    const value = Number(raw);
                    setMaxEditsDraft(Number.isNaN(value) ? Number.NaN : value);
                  }}
                  className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  disabled={settingsSaving}
                />
                <button
                  onClick={() => void handleSaveMaxEdits()}
                  disabled={settingsSaving}
                  className={`text-xs font-semibold px-3 py-2 rounded-lg transition border bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]/80 ${
                    settingsSaving ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  {settingsSaving ? 'Saving...' : 'Update limit'}
                </button>
              </div>
            </div>
          </div>
          {settingsError ? (
            <div className="rounded-lg border border-rose-500 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {settingsError}
            </div>
          ) : null}
          {settingsNotice ? (
            <div className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-3 text-sm text-[var(--color-accent)]">
              {settingsNotice}
            </div>
          ) : null}
        </section>

        <section className="bg-[var(--color-surface)]/80 rounded-2xl border border-[var(--color-border)]/70 p-6 space-y-6">
          <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Generate student credentials</h2>
              <p className="text-xs text-[var(--color-muted-foreground)]">Create quick sign-ins for today&apos;s class. Each username and password is eight characters.</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-[var(--color-muted-foreground)]" htmlFor="credential-count">
                Number of students
              </label>
              <input
                id="credential-count"
                type="number"
                min={1}
                max={50}
                value={credentialCount}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setCredentialCount(Number.isNaN(value) ? 0 : value);
                }}
                className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <button
                onClick={() => void handleGenerateCredentials()}
                disabled={credentialLoading}
                className="text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-white px-4 py-2 rounded-lg disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)]"
              >
                {credentialLoading ? 'Generating...' : 'Create logins'}
              </button>
            </div>
          </header>
          {credentialError ? (
            <div className="rounded-lg border border-rose-400 bg-rose-500/20 px-4 py-3 text-sm text-rose-100">
              {credentialError}
            </div>
          ) : null}
          {credentials.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 justify-between items-center">
                <p className="text-xs text-[var(--color-muted)]">Share each row with a student. Passwords are only shown here once.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleDownloadCredentials()}
                    className="text-xs bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface)] text-[var(--color-muted)] px-3 py-2 rounded-md"
                  >
                    Download CSV
                  </button>
                  <button
                    onClick={() => void window.print()}
                    className="text-xs bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface)] text-[var(--color-muted)] px-3 py-2 rounded-md"
                  >
                    Print page
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]/70">
                <table className="min-w-full divide-y divide-[var(--color-border)]/70 text-sm">
                  <thead className="bg-[var(--color-accent-soft)]/30">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-[var(--color-muted)]">#</th>
                      <th className="px-4 py-2 text-left font-semibold text-[var(--color-muted)]">Username</th>
                      <th className="px-4 py-2 text-left font-semibold text-[var(--color-muted)]">Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credentials.map((credential, index) => (
                      <tr key={credential.username} className={index % 2 === 0 ? 'bg-transparent' : 'bg-[var(--color-accent-soft)]/30'}>
                        <td className="px-4 py-2 text-[var(--color-muted)]">{index + 1}</td>
                        <td className="px-4 py-2 font-mono text-[var(--color-foreground)]">{credential.username}</td>
                        <td className="px-4 py-2 font-mono text-[var(--color-foreground)]">{credential.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--color-muted-foreground)]">No login cards generated yet.</p>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Prompt timeline</h2>
          {promptsByRoot.length === 0 ? (
            <div className="bg-[var(--color-surface)]/80 border border-[var(--color-border)]/70 rounded-2xl p-6 text-[var(--color-muted-foreground)] text-sm">
              No prompts yet. Students can join with the classroom password to begin.
            </div>
          ) : (
            <div className="space-y-4">
              {promptsByRoot.map((entries) => (
                <article key={entries[0]?.id} className="bg-[var(--color-surface)]/80 border border-[var(--color-border)]/70 rounded-2xl p-6 space-y-4">
                  <header className="space-y-1">
                    <p className="text-sm text-[var(--color-muted)]">Started {formatTimestamp(entries[0]?.createdAt ?? '')}</p>
                    <p className="text-lg font-medium text-[var(--color-foreground)]">{entries[0]?.prompt}</p>
                  </header>
                  <ol className="space-y-3">
                    {entries.map((entry) => (
                      <li key={entry.id} className="border border-[var(--color-border)]/70 rounded-xl px-4 py-3">
                        <div className="flex flex-wrap justify-between gap-3 text-xs text-[var(--color-muted)]">
                          <span>{formatTimestamp(entry.createdAt)}</span>
                          <span>Revision {entry.revisionIndex}</span>
                          <span>Status: {entry.status}</span>
                          {entry.errorMessage ? <span className="text-rose-300">{entry.errorMessage}</span> : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-[0.7rem] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                          <span>Owner: {entry.studentUsername ?? (entry.role === 'TEACHER' ? 'Teacher' : 'Unassigned')}</span>
                          <span>{entry.isShared ? 'Shared with class' : 'Private'}</span>
                        </div>
                        <p className="mt-2 text-sm text-[var(--color-foreground)]">{entry.prompt}</p>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Chat conversations</h2>
          {chatsByStudent.length === 0 ? (
            <div className="bg-[var(--color-surface)]/80 border border-[var(--color-border)]/70 rounded-2xl p-6 text-[var(--color-muted-foreground)] text-sm">
              No student chats have been started yet.
            </div>
          ) : (
            <div className="space-y-4">
              {chatsByStudent.map((group) => (
                <article key={group.studentName} className="bg-[var(--color-surface)]/80 border border-[var(--color-border)]/70 rounded-2xl">
                  <header className="border-b border-[var(--color-border)]/70 px-6 py-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--color-foreground)]">{group.studentName}</h3>
                      <p className="text-xs text-[var(--color-muted-foreground)]">{group.threads.length} conversation{group.threads.length === 1 ? '' : 's'}</p>
                    </div>
                  </header>
                  <div className="divide-y divide-[var(--color-border)]/70">
                    {group.threads.map((thread) => {
                      const isExpanded = expandedChats.includes(thread.id);
                      const lastMessage = thread.messages[thread.messages.length - 1];
                      return (
                        <div key={thread.id} className="px-6 py-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-[var(--color-foreground)]">{thread.title}</p>
                              <p className="text-xs text-[var(--color-muted-foreground)]">
                                Updated {formatTimestamp(thread.updatedAt)} · {thread.messages.length} messages
                              </p>
                            </div>
                            <button
                              onClick={() => toggleChatExpansion(thread.id)}
                              className="text-xs bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface)] text-[var(--color-muted)] px-3 py-2 rounded-md"
                            >
                              {isExpanded ? 'Collapse' : 'View conversation'}
                            </button>
                          </div>
                          <p className="text-sm text-[var(--color-muted)] line-clamp-2">
                            {lastMessage ? `${lastMessage.sender === 'STUDENT' ? 'Student' : 'AI'}: ${lastMessage.content}` : 'No messages yet'}
                          </p>
                          {isExpanded ? (
                            <div className="space-y-3 border border-[var(--color-border)]/70 rounded-xl bg-[var(--color-surface)]/70 p-4">
                              {thread.messages.length === 0 ? (
                                <p className="text-xs text-[var(--color-muted-foreground)]">No messages in this conversation.</p>
                              ) : (
                                thread.messages.map((message) => (
                                  <div key={message.id} className="space-y-1">
                                    <div className="flex items-center justify-between text-[0.65rem] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                                      <span>{message.sender === 'STUDENT' ? 'Student' : 'AI Assistant'}</span>
                                      <span>{formatTimestamp(message.createdAt)}</span>
                                    </div>
                                    <div className="markdown-message text-sm text-[var(--color-foreground)] bg-[var(--color-accent-soft)]/30 border border-[var(--color-border)]/70 rounded-lg px-3 py-2">
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                          a: ({ ...props }) => (
                                            <a
                                              {...props}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="underline text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
                                            />
                                          ),
                                          code: ({ className, children, ...props }) => {
                                            const isInline = (props as { inline?: boolean }).inline;
                                            if (isInline) {
                                              return (
                                                <code
                                                  className={`rounded bg-[var(--color-accent-soft)]/40 px-1 py-0.5 text-[0.8rem] ${className ?? ''}`}
                                                >
                                                  {children}
                                                </code>
                                              );
                                            }
                                            return (
                                              <pre
                                                className={`rounded-xl bg-[var(--color-surface-subtle)] px-3 py-3 text-[0.8rem] text-[var(--color-foreground)] overflow-x-auto ${className ?? ''}`}
                                              >
                                                <code>{children}</code>
                                              </pre>
                                            );
                                          },
                                          p: ({ children }) => <p className="leading-relaxed whitespace-pre-wrap">{children}</p>,
                                          ul: ({ children }) => <ul className="ml-4 list-disc space-y-1">{children}</ul>,
                                          ol: ({ children }) => <ol className="ml-4 list-decimal space-y-1">{children}</ol>,
                                          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                          h1: ({ children }) => <h1 className="text-base font-semibold mb-2">{children}</h1>,
                                          h2: ({ children }) => <h2 className="text-sm font-semibold mb-2">{children}</h2>,
                                          h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                                        }}
                                      >
                                        {message.content}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Generated images</h2>
          {gallery.length === 0 ? (
            <div className="bg-[var(--color-surface)]/80 border border-[var(--color-border)]/70 rounded-2xl p-6 text-[var(--color-muted-foreground)] text-sm">
              Images will appear here as students complete generations.
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {gallery
                .filter((entry) => entry.status === 'SUCCESS' && entry.imageData)
                .map((entry) => (
                  <figure key={entry.id} className="bg-[var(--color-surface)]/80 border border-[var(--color-border)]/70 rounded-2xl overflow-hidden">
                    <div className="relative w-full aspect-[4/3]">
                      <Image
                        src={`data:${entry.imageMimeType ?? 'image/png'};base64,${entry.imageData}`}
                        alt={entry.prompt}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                    <figcaption className="p-4 space-y-2">
                      <p className="text-sm text-[var(--color-foreground)]">{entry.prompt}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)] flex flex-wrap gap-3">
                        <span>{formatTimestamp(entry.createdAt)}</span>
                        <span>Revision {entry.revisionIndex}</span>
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)] flex flex-wrap gap-3">
                        <span>Owner: {entry.studentUsername ?? 'Unknown'}</span>
                        <span>{entry.isShared ? 'Shared' : 'Private'}</span>
                      </p>
                    </figcaption>
                  </figure>
                ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
