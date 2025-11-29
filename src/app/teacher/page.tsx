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

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

function toDisplayTime(iso: string) {
  try {
    return timeFormatter.format(new Date(iso));
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
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<{ src: string; prompt: string; mimeType: string | null } | null>(null);
  const sessionRequestIdRef = useRef(0);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const invalidatePendingSessionLoads = useCallback(() => {
    sessionRequestIdRef.current += 1;
  }, []);

  const loadSession = useCallback(async () => {
    const requestId = ++sessionRequestIdRef.current;
    try {
      const res = await fetch('/api/session', { credentials: 'include' });
      // Even if status is not OK, try to parse JSON - API might return 200 with null session
      const text = await res.text();
      if (!text || text.trim().length === 0) {
        // Empty response - treat as no session
        if (sessionRequestIdRef.current === requestId) {
          setSession(null);
          setLoading(false);
        }
        return;
      }
      let data: SessionResponse;
      try {
        data = JSON.parse(text);
      } catch {
        console.error('Failed to parse JSON:', text);
        // Invalid JSON - treat as no session
        if (sessionRequestIdRef.current === requestId) {
          setSession(null);
          setLoading(false);
        }
        return;
      }
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
        const text = await res.text();
        if (!text || text.trim().length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        let data: SessionResponse;
        try {
          data = JSON.parse(text);
        } catch {
          console.error('Failed to parse JSON:', text);
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
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
      const [activityRes, chatsRes] = await Promise.all([
        fetch('/api/teacher/activity', { credentials: 'include' }),
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

  // Group submissions by root ID, similar to student view
  const groupedSubmissions = useMemo(() => {
    const groups = new Map<string, ActivitySubmission[]>();
    for (const entry of activity) {
      const rootId = entry.rootSubmissionId ?? entry.id;
      const list = groups.get(rootId) ?? [];
      groups.set(rootId, [...list, entry]);
    }
    return Array.from(groups.entries()).map(([rootId, entries]) => ({
      rootId,
      submissions: entries.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    }));
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
      <main className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <p className="text-lg text-gray-600">Loading teacher dashboard...</p>
      </main>
    );
  }

  if (!session || session.role !== 'teacher') {
    return (
      <main className="min-h-screen bg-white text-gray-900 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-8">
          <header className="space-y-2 text-center">
            <h1 className="text-3xl font-semibold text-purple-700">Teacher Control Center</h1>
            <p className="text-sm text-gray-600">
              Sign in with your assigned teacher credentials to open a fresh classroom and share the code with students.
            </p>
          </header>
          <section className="bg-purple-50 rounded-2xl p-6 space-y-5 border border-purple-200">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-gray-600" htmlFor="teacher-username">
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
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
                placeholder="e.g. ms-jackson"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-gray-600" htmlFor="teacher-password">
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
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
                placeholder="Enter your password"
              />
            </div>
            {formError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {formError}
              </div>
            ) : null}
            <button
              onClick={() => void handleTeacherLogin()}
              disabled={formLoading || teacherUsername.trim().length === 0 || teacherPassword.length === 0}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded-lg transition disabled:bg-gray-300 disabled:text-gray-500"
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
    <main className="min-h-screen bg-white text-gray-900">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between pb-6 border-b border-gray-200">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">Teacher Dashboard</h1>
            <p className="text-sm text-gray-600">
              Hello <span className="font-medium text-gray-900">{teacherDisplayName}</span>.
              {classroomCode ? (
                <>
                  {' '}
                  Classroom code:{' '}
                  <span className="font-mono tracking-wider text-lg text-purple-600 font-semibold">{classroomCode}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void loadActivity()}
              className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              onClick={() => {
                window.open('/api/teacher/export', '_blank');
              }}
              className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition"
            >
              Export PDF
            </button>
            <button
              onClick={() => void handleEndSession()}
              className="text-sm bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition"
            >
              End Session
            </button>
          </div>
        </header>

        {/* Settings Section - Collapsible */}
        <section className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('settings')}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
          >
            <h2 className="text-lg font-semibold text-gray-900">Session Settings</h2>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${collapsedSections.has('settings') ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsedSections.has('settings') && (
            <div className="px-4 pb-4 space-y-4 border-t border-gray-200">
              <div className="grid gap-4 md:grid-cols-2 pt-4">
                <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-600">Chat assistant</p>
                    <p className="text-sm text-gray-900">
                      {chatEnabledSetting ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleToggleChatAssistant()}
                    disabled={settingsSaving}
                    className={`text-xs font-semibold px-3 py-2 rounded-lg transition ${
                      chatEnabledSetting
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                    } ${settingsSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {settingsSaving ? 'Saving...' : chatEnabledSetting ? 'Disable' : 'Enable'}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <div>
                    <label className="text-xs uppercase tracking-wide text-gray-600" htmlFor="max-edits">
                      Max refinements
                    </label>
                    <p className="text-sm text-gray-900">
                      {displayMaxEdits} {displayMaxEdits === 1 ? 'edit' : 'edits'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
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
                      className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      disabled={settingsSaving}
                    />
                    <button
                      onClick={() => void handleSaveMaxEdits()}
                      disabled={settingsSaving}
                      className="text-xs font-semibold px-3 py-2 rounded-lg transition bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-60"
                    >
                      {settingsSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
              {settingsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {settingsError}
                </div>
              ) : null}
              {settingsNotice ? (
                <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-700">
                  {settingsNotice}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Student Credentials Section - Collapsible */}
        <section className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('credentials')}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
          >
            <h2 className="text-lg font-semibold text-gray-900">Student Accounts</h2>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${collapsedSections.has('credentials') ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsedSections.has('credentials') && (
            <div className="px-4 pb-4 space-y-4 border-t border-gray-200">
              <div className="flex items-center gap-3 pt-4">
                <label className="text-sm text-gray-600" htmlFor="credential-count">
                  Number of students:
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
                  className="w-20 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button
                  onClick={() => void handleGenerateCredentials()}
                  disabled={credentialLoading}
                  className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg disabled:bg-gray-300 disabled:text-gray-500 transition"
                >
                  {credentialLoading ? 'Generating...' : 'Generate'}
                </button>
              </div>
              {credentialError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {credentialError}
                </div>
              ) : null}
              {credentials.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-gray-600">Each username and password is 6 characters (lowercase letters and numbers).</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleDownloadCredentials()}
                        className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-md transition"
                      >
                        Download CSV
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-purple-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold text-gray-700">#</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-700">Username</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-700">Password</th>
                        </tr>
                      </thead>
                      <tbody>
                        {credentials.map((credential, index) => (
                          <tr key={credential.username} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-4 py-2 text-gray-600">{index + 1}</td>
                            <td className="px-4 py-2 font-mono text-gray-900">{credential.username}</td>
                            <td className="px-4 py-2 font-mono text-gray-900">{credential.password}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-600">No credentials generated yet.</p>
              )}
            </div>
          )}
        </section>

        {/* Image Generations Section - Collapsible */}
        <section className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('images')}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
          >
            <h2 className="text-lg font-semibold text-gray-900">Image Generations</h2>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${collapsedSections.has('images') ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsedSections.has('images') && (
            <div className="px-4 pb-4 border-t border-gray-200">
              {groupedSubmissions.length === 0 ? (
                <div className="py-8 text-center text-gray-600 text-sm">
                  No images generated yet. Students can join with the classroom code to begin.
                </div>
              ) : (
                <div className="pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {groupedSubmissions.flatMap((group) => {
                      const firstSubmission = group.submissions[0];
                      const studentName = firstSubmission?.studentUsername ?? 'Unknown';
                      const isShared = group.submissions.some((s) => s.isShared);
                      
                      return group.submissions.map((submission) => {
                        const imageSrc = submission.imageData 
                          ? `data:${submission.imageMimeType ?? 'image/png'};base64,${submission.imageData}`
                          : null;
                        
                        return (
                          <div 
                            key={submission.id} 
                            className="border border-gray-200 rounded-lg p-3 bg-white hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => {
                              if (imageSrc) {
                                setSelectedImage({
                                  src: imageSrc,
                                  prompt: submission.prompt,
                                  mimeType: submission.imageMimeType,
                                });
                              }
                            }}
                          >
                            <div className="space-y-2">
                              {/* Prompt */}
                              <p className="text-xs font-medium text-gray-900 line-clamp-2" title={submission.prompt}>
                                {submission.prompt}
                              </p>
                              
                              {/* Image Preview or Status */}
                              {submission.status === 'PENDING' ? (
                                <div className="h-32 flex flex-col items-center justify-center gap-2 bg-gray-50 rounded-lg">
                                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-600 border-t-transparent"></div>
                                  <span className="text-xs text-gray-600">Generating...</span>
                                </div>
                              ) : imageSrc ? (
                                <div className="relative w-full h-32 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                                  <Image
                                    src={imageSrc}
                                    alt={submission.prompt}
                                    fill
                                    sizes="(max-width: 768px) 150px, 200px"
                                    unoptimized
                                    className="object-cover"
                                  />
                                </div>
                              ) : submission.status === 'ERROR' ? (
                                <div className="h-32 flex items-center justify-center bg-red-50 rounded-lg text-xs text-red-700 px-2 text-center">
                                  {submission.errorMessage ?? 'Generation failed'}
                                </div>
                              ) : null}
                              
                              {/* Metadata */}
                              <div className="flex items-center justify-between text-xs text-gray-600">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium">{studentName}</span>
                                  <span>{submission.revisionIndex === 0 ? 'Original' : `Refinement ${submission.revisionIndex}`}</span>
                                </div>
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className={`px-2 py-0.5 rounded text-xs ${
                                    submission.status === 'SUCCESS' ? 'bg-green-100 text-green-700' :
                                    submission.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-red-100 text-red-700'
                                  }`}>
                                    {submission.status}
                                  </span>
                                  {isShared && submission.revisionIndex === 0 && (
                                    <span className="text-purple-600 text-xs">Shared</span>
                                  )}
                                </div>
                              </div>
                              <div className="text-xs text-gray-500">
                                {toDisplayTime(submission.createdAt)}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Chat Conversations Section - Collapsible */}
        <section className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('chats')}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
          >
            <h2 className="text-lg font-semibold text-gray-900">Chat Conversations</h2>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${collapsedSections.has('chats') ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsedSections.has('chats') && (
            <div className="px-4 pb-4 border-t border-gray-200">
              {chatsByStudent.length === 0 ? (
                <div className="py-8 text-center text-gray-600 text-sm">
                  No student chats have been started yet.
                </div>
              ) : (
                <div className="space-y-4 pt-4">
                  {chatsByStudent.map((group) => (
                    <div key={group.studentName} className="border border-gray-200 rounded-lg">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <h3 className="text-sm font-semibold text-gray-900">{group.studentName}</h3>
                        <p className="text-xs text-gray-600">{group.threads.length} conversation{group.threads.length === 1 ? '' : 's'}</p>
                      </div>
                      <div className="divide-y divide-gray-200">
                        {group.threads.map((thread) => {
                          const isExpanded = expandedChats.includes(thread.id);
                          const lastMessage = thread.messages[thread.messages.length - 1];
                          return (
                            <div key={thread.id} className="px-4 py-3 space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-gray-900">{thread.title}</p>
                                  <p className="text-xs text-gray-600">
                                    Updated {formatTimestamp(thread.updatedAt)} · {thread.messages.length} messages
                                  </p>
                                </div>
                                <button
                                  onClick={() => toggleChatExpansion(thread.id)}
                                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-md transition"
                                >
                                  {isExpanded ? 'Collapse' : 'View'}
                                </button>
                              </div>
                              {lastMessage && (
                                <p className="text-sm text-gray-600 line-clamp-2">
                                  {lastMessage.sender === 'STUDENT' ? 'Student' : 'AI'}: {lastMessage.content}
                                </p>
                              )}
                              {isExpanded && (
                                <div className="space-y-3 border border-gray-200 rounded-lg bg-gray-50 p-4">
                                  {thread.messages.length === 0 ? (
                                    <p className="text-xs text-gray-600">No messages in this conversation.</p>
                                  ) : (
                                    thread.messages.map((message) => (
                                      <div key={message.id} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs text-gray-600">
                                          <span>{message.sender === 'STUDENT' ? 'Student' : 'AI Assistant'}</span>
                                          <span>{formatTimestamp(message.createdAt)}</span>
                                        </div>
                                        <div className="text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-2">
                                          <ReactMarkdown
                                            remarkPlugins={[remarkGfm, remarkMath]}
                                            rehypePlugins={[rehypeKatex]}
                                            components={{
                                              a: ({ ...props }) => (
                                                <a
                                                  {...props}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="underline text-purple-600 hover:text-purple-700"
                                                />
                                              ),
                                              code: ({ className, children, ...props }) => {
                                                const isInline = (props as { inline?: boolean }).inline;
                                                if (isInline) {
                                                  return (
                                                    <code className={`rounded bg-purple-100 px-1 py-0.5 text-xs ${className ?? ''}`}>
                                                      {children}
                                                    </code>
                                                  );
                                                }
                                                return (
                                                  <pre className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-900 overflow-x-auto">
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
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div 
            className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 pr-8">{selectedImage.prompt}</h3>
              <button
                onClick={() => setSelectedImage(null)}
                className="text-gray-500 hover:text-gray-700 transition"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden bg-gray-100">
                <Image
                  src={selectedImage.src}
                  alt={selectedImage.prompt}
                  fill
                  sizes="(max-width: 1024px) 100vw, 1024px"
                  unoptimized
                  className="object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
