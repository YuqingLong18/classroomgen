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
  referenceImages: string | null; // JSON string
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
    hasTeacherAccess?: boolean;
    teacherSessionId?: string | null;
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

interface SessionStudent {
  id: string;
  username: string;
  status: 'ACTIVE' | 'REMOVED';
  createdAt: string;
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

import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageToggle } from '@/components/LanguageToggle';

export default function TeacherDashboard() {
  const { t } = useLanguage();
  const [session, setSession] = useState<SessionResponse['session']>(null);
  const [loading, setLoading] = useState(true);
  const [returningToTeacher, setReturningToTeacher] = useState(false);
  const [returnToTeacherError, setReturnToTeacherError] = useState<string | null>(null);
  const [teacherUsername, setTeacherUsername] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [activity, setActivity] = useState<ActivitySubmission[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [students, setStudents] = useState<SessionStudent[]>([]);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [studentActionId, setStudentActionId] = useState<string | null>(null);
  const [chats, setChats] = useState<TeacherChatThread[]>([]);
  const [expandedChats, setExpandedChats] = useState<string[]>([]);
  const [chatEnabledSetting, setChatEnabledSetting] = useState(true);
  const [maxEditsDraft, setMaxEditsDraft] = useState(3);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<{ src: string; prompt: string; mimeType: string | null } | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const sessionRequestIdRef = useRef(0);
  const autoReturnAttemptedRef = useRef(false);

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
      const [activityRes, chatsRes, studentsRes] = await Promise.all([
        fetch('/api/teacher/activity', { credentials: 'include' }),
        fetch('/api/teacher/chats', { credentials: 'include' }),
        fetch('/api/teacher/students', { credentials: 'include' }),
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

      if (studentsRes.ok) {
        const studentData = await studentsRes.json();
        setStudents(studentData.students ?? []);
        setStudentsError(null);
      } else {
        const error = await studentsRes.json().catch(() => ({ message: 'Unable to load students.' }));
        setStudentsError(error.message ?? 'Unable to load students.');
        setStudents([]);
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
    const handlePageShow = () => {
      void loadSession();
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [loadSession]);

  const handleReturnToTeacher = useCallback(async () => {
    setReturningToTeacher(true);
    setReturnToTeacherError(null);
    try {
      invalidatePendingSessionLoads();
      const res = await fetch('/api/teacher/return-to-teacher', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to return to teacher view.' }));
        setReturnToTeacherError(error.message ?? 'Failed to return to teacher view.');
        return;
      }

      const confirmed = await waitForSessionRole('teacher');
      if (!confirmed) {
        await loadSession();
      }
    } catch (error) {
      console.error('Failed to return to teacher view', error);
      setReturnToTeacherError('Failed to return to teacher view.');
    } finally {
      setReturningToTeacher(false);
    }
  }, [invalidatePendingSessionLoads, loadSession, waitForSessionRole]);

  useEffect(() => {
    if (loading) return;
    if (!session) return;
    if (session.role === 'teacher') return;
    if (!session.hasTeacherAccess) return;
    if (autoReturnAttemptedRef.current) return;

    autoReturnAttemptedRef.current = true;
    void handleReturnToTeacher();
  }, [loading, session, handleReturnToTeacher]);

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

  const loadApiKeyStatus = useCallback(async () => {
    if (!session || session.role !== 'teacher') {
      return;
    }
    try {
      const res = await fetch('/api/teacher/api-key', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setHasApiKey(data.hasApiKey ?? false);
      }
    } catch (error) {
      console.error('Failed to load API key status', error);
    }
  }, [session]);

  useEffect(() => {
    if (session?.role === 'teacher') {
      void loadApiKeyStatus();
    }
  }, [session?.role, loadApiKeyStatus]);

  const handleSaveApiKey = useCallback(async () => {
    if (!apiKeyValue.trim()) {
      setApiKeyError('API key cannot be empty');
      return;
    }

    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      const res = await fetch('/api/teacher/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKey: apiKeyValue.trim() }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to save API key.' }));
        setApiKeyError(error.message ?? 'Failed to save API key.');
        return;
      }

      setHasApiKey(true);
      setShowApiKeyInput(false);
      setApiKeyValue('');
      setApiKeyError(null);
    } catch (error) {
      console.error('Failed to save API key', error);
      setApiKeyError('Failed to save API key.');
    } finally {
      setApiKeySaving(false);
    }
  }, [apiKeyValue]);

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

    if (session?.hasTeacherAccess && session.role !== 'teacher') {
      const confirmed = window.confirm(
        'You already have an active classroom. Signing in again will end the current session for everyone and create a new classroom. Continue?',
      );
      if (!confirmed) {
        return;
      }
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
      setStudents([]);
      setStudentActionId(null);
      setStudentsError(null);
      setStudentsError(null);
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
  }, [teacherUsername, teacherPassword, session, waitForSessionRole, loadSession, loadActivity, invalidatePendingSessionLoads]);

  const handleEndSession = useCallback(async () => {
    setFormLoading(true);
    try {
      await fetch('/api/session/end', {
        method: 'POST',
        credentials: 'include',
      });
      await loadSession();
      setStudents([]);
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

  const handleKickStudent = useCallback(
    async (studentId: string) => {
      if (!session?.id) return;
      setStudentActionId(studentId);
      setStudentsError(null);
      try {
        const res = await fetch('/api/teacher/students', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ studentId, action: 'kick' }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStudentsError(data.message ?? 'Unable to remove student.');
          return;
        }

        setStudents((prev) =>
          prev.map((entry) =>
            entry.id === studentId ? { ...entry, status: 'REMOVED' } : entry,
          ),
        );
      } catch (error) {
        console.error('Failed to remove student', error);
        setStudentsError('Unable to remove student right now.');
      } finally {
        setStudentActionId(null);
      }
    },
    [session?.id],
  );

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
        <p className="text-lg text-gray-600">{t.common.loading}</p>
      </main>
    );
  }

  if (!session || session.role !== 'teacher') {
    if (session?.hasTeacherAccess) {
      return (
        <main className="min-h-screen bg-white text-gray-900 flex items-center justify-center p-6">
          <div className="w-full max-w-lg space-y-6">
            <header className="space-y-2 text-center">
              <div className="flex justify-end mb-2">
                <LanguageToggle />
              </div>
              <h1 className="text-3xl font-semibold text-purple-700">{t.teacher.controlCenter}</h1>
              <p className="text-sm text-gray-600">
                Returning you to the teacher dashboard for your active classroom.
              </p>
            </header>
            <section className="bg-blue-50 rounded-2xl p-6 space-y-4 border border-blue-200">
              {returnToTeacherError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {returnToTeacherError}
                </div>
              ) : null}
              <button
                onClick={() => void handleReturnToTeacher()}
                disabled={returningToTeacher}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition disabled:bg-gray-300 disabled:text-gray-500"
              >
                {returningToTeacher ? t.common.loading : t.teacher.returnToTeacherView}
              </button>
              <p className="text-xs text-gray-600">
                If you sign in again here, you will start a new classroom and end the current session for everyone.
              </p>
            </section>
            <section className="bg-white rounded-2xl p-6 space-y-4 border border-gray-200">
              <p className="text-sm text-gray-700">
                Need a fresh classroom instead? Sign in below.
              </p>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-gray-600" htmlFor="teacher-username">
                  {t.teacher.username}
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
                  {t.teacher.password}
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
                {formLoading ? t.teacher.signingIn : t.teacher.enterDashboard}
              </button>
            </section>
          </div>
        </main>
      );
    }

    return (
      <main className="min-h-screen bg-white text-gray-900 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-8">
          <header className="space-y-2 text-center">
            <div className="flex justify-end mb-2">
              <LanguageToggle />
            </div>
            <h1 className="text-3xl font-semibold text-purple-700">{t.teacher.controlCenter}</h1>
            <p className="text-sm text-gray-600">
              {t.teacher.signInDesc}
            </p>
          </header>
          <section className="bg-purple-50 rounded-2xl p-6 space-y-5 border border-purple-200">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-gray-600" htmlFor="teacher-username">
                {t.teacher.username}
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
                {t.teacher.password}
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
              {formLoading ? t.teacher.signingIn : t.teacher.enterDashboard}
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
        {/* API Key Configuration Section - At the very top */}
        {session && session.role === 'teacher' && (
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            {!showApiKeyInput ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">{t.teacher.apiKeyTitle}:</span>
                  {hasApiKey ? (
                    <span className="text-sm text-green-700 font-medium">{t.teacher.apiKeyConfigured}</span>
                  ) : (
                    <span className="text-sm text-orange-700 font-medium">Not configured</span>
                  )}
                </div>
                <button
                  onClick={() => {
                    setShowApiKeyInput(true);
                    setApiKeyValue('');
                    setApiKeyError(null);
                  }}
                  className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
                >
                  {hasApiKey ? t.teacher.useNewKey : t.teacher.saveApiKey}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700 flex-shrink-0">{t.teacher.apiKeyTitle}:</label>
                  <input
                    type="password"
                    value={apiKeyValue}
                    onChange={(e) => {
                      setApiKeyValue(e.target.value);
                      setApiKeyError(null);
                    }}
                    placeholder={t.teacher.apiKeyPlaceholder}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  />
                  <button
                    onClick={handleSaveApiKey}
                    disabled={apiKeySaving || !apiKeyValue.trim()}
                    className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white px-4 py-2 rounded-lg transition"
                  >
                    {apiKeySaving ? t.teacher.savingApiKey : t.teacher.saveApiKey}
                  </button>
                  <button
                    onClick={() => {
                      setShowApiKeyInput(false);
                      setApiKeyValue('');
                      setApiKeyError(null);
                    }}
                    className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg transition"
                  >
                    {t.common.cancel}
                  </button>
                </div>
                {apiKeyError && (
                  <p className="text-sm text-red-600">{apiKeyError}</p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Header */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between pb-6 border-b border-gray-200">
          <div className="space-y-1">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-semibold text-gray-900">{t.teacher.dashboardTitle}</h1>
              <LanguageToggle />
            </div>
            <p className="text-sm text-gray-600">
              {t.teacher.hello} <span className="font-medium text-gray-900">{teacherDisplayName}</span>.
              {classroomCode ? (
                <>
                  {' '}
                  {t.teacher.classroomCode}:{' '}
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
              {refreshing ? t.common.loading : t.common.refresh}
            </button>
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/teacher/join-as-student', {
                    method: 'POST',
                    credentials: 'include',
                  });
                  if (res.ok) {
                    window.location.href = '/';
                  } else {
                    const error = await res.json().catch(() => ({ message: 'Failed to join as student.' }));
                    alert(error.message ?? 'Failed to join as student.');
                  }
                } catch (error) {
                  console.error('Failed to join as student', error);
                  alert('Failed to join as student.');
                }
              }}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
            >
              {t.teacher.joinAsStudent}
            </button>
            <button
              onClick={() => {
                window.open('/api/teacher/export', '_blank');
              }}
              className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition"
            >
              {t.teacher.exportPdf}
            </button>
            <button
              onClick={() => void handleEndSession()}
              className="text-sm bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition"
            >
              {t.teacher.endSession}
            </button>
          </div>
        </header>

        {/* Settings Section - Collapsible */}
        <section className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('settings')}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
          >
            <h2 className="text-lg font-semibold text-gray-900">{t.teacher.sessionSettings}</h2>
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
                    <p className="text-xs uppercase tracking-wide text-gray-600">{t.teacher.chatAssistant}</p>
                    <p className="text-sm text-gray-900">
                      {chatEnabledSetting ? t.teacher.enabled : t.teacher.disabled}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleToggleChatAssistant()}
                    disabled={settingsSaving}
                    className={`text-xs font-semibold px-3 py-2 rounded-lg transition ${chatEnabledSetting
                      ? 'bg-red-100 text-red-700 hover:bg-red-200'
                      : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                      } ${settingsSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {settingsSaving ? t.common.saving : chatEnabledSetting ? t.teacher.disable : t.teacher.enable}
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

        {/* Student Roster Section - Collapsible */}
        <section className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('students')}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
          >
            <h2 className="text-lg font-semibold text-gray-900">Student Roster</h2>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${collapsedSections.has('students') ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsedSections.has('students') && (
            <div className="px-4 pb-4 space-y-4 border-t border-gray-200">
              <div className="pt-4 space-y-1">
                <p className="text-sm text-gray-700">
                  Students join with the classroom code. Review nicknames and remove any that are inappropriate.
                </p>
                <p className="text-xs text-gray-500">
                  Removing a name will immediately sign the student out and prompt them to choose a new one.
                </p>
              </div>
              {studentsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {studentsError}
                </div>
              ) : null}
              {students.length === 0 ? (
                <p className="text-sm text-gray-600">{t.teacher.noStudentsJoined}</p>
              ) : (
                <div className="space-y-3">
                  {students.map((student) => (
                    <div
                      key={student.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{student.username}</p>
                        <p className="text-xs text-gray-600">{t.teacher.joined} {formatTimestamp(student.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${student.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-200 text-gray-700'
                            }`}
                        >
                          {student.status === 'ACTIVE' ? t.teacher.active : t.teacher.removed}
                        </span>
                        {student.status === 'ACTIVE' ? (
                          <button
                            onClick={() => void handleKickStudent(student.id)}
                            disabled={studentActionId === student.id}
                            className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-md transition disabled:opacity-60"
                          >
                            {studentActionId === student.id ? t.common.removing : t.teacher.rejectName}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">{t.teacher.waitingForRename}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
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
            <h2 className="text-lg font-semibold text-gray-900">{t.teacher.imageGenerations}</h2>
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
                  {t.teacher.noImagesGenerated}
                </div>
              ) : (
                <div className="pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {groupedSubmissions.flatMap((group) => {
                      const firstSubmission = group.submissions[0];
                      const studentName = firstSubmission?.studentUsername ?? t.teacher.unknownStudent;
                      const isShared = group.submissions.some((s) => s.isShared);

                      return group.submissions.map((submission) => {
                        let imageSrc = null;
                        if (submission.imageData) {
                          if (submission.imageData.startsWith('/api/uploads/')) {
                            imageSrc = submission.imageData;
                          } else {
                            imageSrc = `data:${submission.imageMimeType ?? 'image/png'};base64,${submission.imageData}`;
                          }
                        }

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

                              {/* Reference Images Display */}
                              {submission.referenceImages && (() => {
                                try {
                                  const refs = JSON.parse(submission.referenceImages) as string[];
                                  if (refs.length > 0) {
                                    return (
                                      <div className="flex gap-1 overflow-x-auto py-1 scrollbar-thin">
                                        {refs.map((refImg, i) => (
                                          <div key={i} className="relative w-10 h-10 flex-shrink-0 rounded border border-gray-200 overflow-hidden bg-gray-50">
                                            <Image src={refImg} alt="Ref" fill className="object-cover" unoptimized />
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  }
                                } catch (e) { return null; }
                              })()}

                              {/* Image Preview or Status */}
                              {submission.status === 'PENDING' ? (
                                <div className="h-32 flex flex-col items-center justify-center gap-2 bg-gray-50 rounded-lg">
                                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-600 border-t-transparent"></div>
                                  <span className="text-xs text-gray-600">{t.common.generating}</span>
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
                                  {submission.errorMessage ?? t.common.generationFailed}
                                </div>
                              ) : null}

                              {/* Metadata */}
                              <div className="flex items-center justify-between text-xs text-gray-600">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium">{studentName}</span>
                                  <span>{submission.revisionIndex === 0 ? t.teacher.original : `${t.teacher.refinement} ${submission.revisionIndex}`}</span>
                                </div>
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className={`px-2 py-0.5 rounded text-xs ${submission.status === 'SUCCESS' ? 'bg-green-100 text-green-700' :
                                    submission.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-red-100 text-red-700'
                                    }`}>
                                    {submission.status}
                                  </span>
                                  {isShared && submission.revisionIndex === 0 && (
                                    <span className="text-purple-600 text-xs">{t.common.shared}</span>
                                  )}
                                </div>
                              </div>
                              <span className="text-sm text-gray-500">
                                {toDisplayTime(submission.createdAt)}
                              </span>
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
            <h2 className="text-lg font-semibold text-gray-900">{t.teacher.chatConversations}</h2>
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
                  {t.teacher.noStudentChats}
                </div>
              ) : (
                <div className="space-y-4 pt-4">
                  {chatsByStudent.map((group) => (
                    <div key={group.studentName} className="border border-gray-200 rounded-lg">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <h3 className="text-sm font-semibold text-gray-900">{group.studentName}</h3>
                        <p className="text-xs text-gray-600">{group.threads.length} {group.threads.length === 1 ? t.teacher.conversation : t.teacher.conversations}</p>
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
                                    {t.teacher.updated} {formatTimestamp(thread.updatedAt)} · {thread.messages.length} {t.teacher.messages}
                                  </p>
                                </div>
                                <button
                                  onClick={() => toggleChatExpansion(thread.id)}
                                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-md transition"
                                >
                                  {isExpanded ? t.common.collapse : t.common.view}
                                </button>
                              </div>
                              {lastMessage && (
                                <p className="text-sm text-gray-600 line-clamp-2">
                                  {lastMessage.sender === 'STUDENT' ? t.common.student : t.common.ai}: {lastMessage.content}
                                </p>
                              )}
                              {isExpanded && (
                                <div className="space-y-3 border border-gray-200 rounded-lg bg-gray-50 p-4">
                                  {thread.messages.length === 0 ? (
                                    <p className="text-xs text-gray-600">{t.teacher.noMessagesInConversation}</p>
                                  ) : (
                                    thread.messages.map((message) => (
                                      <div key={message.id} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs text-gray-600">
                                          <span>{message.sender === 'STUDENT' ? t.common.student : t.common.aiAssistant}</span>
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
