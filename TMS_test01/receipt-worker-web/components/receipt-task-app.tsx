'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  HEARTBEAT_INTERVAL_MS,
  SESSION_STORAGE_KEY,
  TASK_TIME_LIMIT_SECONDS,
  TOTAL_TASKS,
} from '@/lib/constants';
import type { CurrentTaskResponse } from '@/lib/types';

type Phase = 'loading' | 'requester' | 'instructions' | 'task' | 'complete' | 'error';

type ReceiptTaskAppProps = {
  googleFormUrl?: string;
};

const REQUESTER_MESSAGE =
  'Thank you for participating in our task. Please carefully review the virtual receipt and enter the requested information into the provided fields. Make sure that each value matches the receipt exactly and check your entries for any errors.';

function RequesterMessage({ message }: { message: string }) {
  return (
    <section className="requester-message" aria-labelledby="requester-message-title">
      <div className="requester-message-heading">
        <MessageIcon />
        <h2 id="requester-message-title">Message from the requester</h2>
      </div>
      <p>{message}</p>
    </section>
  );
}

function OnboardingHeading() {
  return (
    <header className="intro-heading">
      <h1>Virtual Receipt OCR Task</h1>
      <p>Review {TOTAL_TASKS} receipts and answer one question about each.</p>
    </header>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Unable to process the request.');
  }
  return payload;
}

export function ReceiptTaskApp({ googleFormUrl }: ReceiptTaskAppProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [sessionId, setSessionId] = useState('');
  const [prolificParticipantId, setProlificParticipantId] = useState('');
  const [current, setCurrent] = useState<CurrentTaskResponse | null>(null);
  const [answer, setAnswer] = useState('');
  const [zoom, setZoom] = useState(0.85);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [elapsedTimeSeconds, setElapsedTimeSeconds] = useState(0);
  const answerInputRef = useRef<HTMLInputElement>(null);

  const finalize = useCallback(async (id: string) => {
    await api<{ completed: true }>('/api/session/complete', {
      method: 'POST',
      body: JSON.stringify({ sessionId: id }),
    });
    setPhase('complete');
  }, []);

  const loadCurrent = useCallback(
    async (id: string) => {
      const data = await api<CurrentTaskResponse>(
        `/api/task/current?sessionId=${encodeURIComponent(id)}`,
      );
      setCurrent(data);
      if (data.elapsedTimeSeconds !== null) {
        setElapsedTimeSeconds(data.elapsedTimeSeconds);
      }

      if (data.completed) {
        setPhase('complete');
      } else if (data.status === 'opened') {
        setPhase('requester');
      } else if (data.status === 'started' && data.currentIndex >= data.totalTasks) {
        await finalize(id);
      } else if (data.task) {
        setAnswer('');
        setPhase('task');
        window.setTimeout(() => answerInputRef.current?.focus(), 100);
      } else {
        throw new Error('Unable to load the current task.');
      }
    },
    [finalize],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        let id = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (!id) {
          id = window.crypto.randomUUID();
          window.localStorage.setItem(SESSION_STORAGE_KEY, id);
        }
        if (!active) return;
        setSessionId(id);

        try {
          await loadCurrent(id);
        } catch (initialError) {
          if (!(initialError instanceof Error) || !initialError.message.includes('not found')) {
            throw initialError;
          }
          await api('/api/session/open', {
            method: 'POST',
            body: JSON.stringify({ sessionId: id }),
          });
          await loadCurrent(id);
        }
      } catch (initializationError) {
        if (!active) return;
        setError(
          initializationError instanceof Error
            ? initializationError.message
            : 'Unable to prepare the session.',
        );
        setPhase('error');
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [loadCurrent]);

  useEffect(() => {
    if (!sessionId || phase !== 'task') return;

    const heartbeat = () => {
      void fetch('/api/session/heartbeat', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };

    const interval = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', heartbeat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', heartbeat);
    };
  }, [phase, sessionId]);

  useEffect(() => {
    const serverElapsedTime = current?.elapsedTimeSeconds;
    if (phase !== 'task' || serverElapsedTime === null || serverElapsedTime === undefined) return;

    const synchronizedAtMs = Date.now();
    const updateTimer = () => {
      const secondsSinceSync = Math.floor((Date.now() - synchronizedAtMs) / 1000);
      setElapsedTimeSeconds(serverElapsedTime + secondsSinceSync);
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(interval);
  }, [current?.elapsedTimeSeconds, phase]);

  async function startTask(event: FormEvent) {
    event.preventDefault();
    const normalizedParticipantId = prolificParticipantId.trim();
    if (!sessionId || !normalizedParticipantId || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/session/start', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          prolificParticipantId: normalizedParticipantId,
        }),
      });
      await loadCurrent(sessionId);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Unable to start the task.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !current?.task || !answer.trim() || busy) return;

    setBusy(true);
    setError('');
    try {
      const result = await api<{ saved: true; hasMore: boolean }>('/api/task/submit', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          receiptId: current.task.receiptId,
          answer: answer.trim(),
        }),
      });

      if (result.hasMore) {
        await loadCurrent(sessionId);
      } else {
        await finalize(sessionId);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to save the response.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <main className="center-stage" aria-busy="true">
        <section className="status-card">
          <span className="spinner" aria-hidden="true" />
          <h1>Preparing your task</h1>
          <p>Please wait a moment.</p>
        </section>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="center-stage">
        <section className="status-card error-card">
          <div className="status-icon">!</div>
          <p className="eyebrow">Connection error</p>
          <h1>Unable to load the task</h1>
          <p>{error}</p>
          <button className="primary-button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (phase === 'requester') {
    return (
      <main className="center-stage intro-stage">
        <section className="intro-card requester-card">
          <OnboardingHeading />
          <RequesterMessage message={REQUESTER_MESSAGE} />
          <div className="onboarding-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => setPhase('instructions')}
            >
              Next page
              <ArrowIcon />
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (phase === 'instructions') {
    const hasParticipantId = prolificParticipantId.trim().length > 0;
    return (
      <main className="center-stage intro-stage">
        <section className="intro-card instructions-card">
          <OnboardingHeading />
          <header className="intro-heading instructions-heading">
            <h1>How it works</h1>
          </header>

          <div className="instruction-panel">
            <ol>
              <li><span>1</span><p>Review the receipt image.</p></li>
              <li><span>2</span><p>Read the question on the screen.</p></li>
              <li><span>3</span><p>Enter your answer based on the receipt.</p></li>
              <li><span>4</span><p>Submit your answer to move to the next receipt.</p></li>
              <li><span>5</span><p>Repeat these steps until all 40 receipts are complete.</p></li>
              <li><span>6</span><p>After completing all 40 receipts, complete the survey to finish the task.</p></li>
            </ol>
          </div>

          <div className="time-limit-notice">
            <TimerIcon />
            <p>
              <strong>Target time: approximately 20 minutes.</strong>
            </p>
          </div>

          <form className="participant-form" onSubmit={startTask}>
            <label htmlFor="prolific-participant-id">Prolific Participant ID</label>
            <input
              id="prolific-participant-id"
              name="prolificParticipantId"
              value={prolificParticipantId}
              onChange={(event) => setProlificParticipantId(event.target.value)}
              placeholder="Enter your Prolific Participant ID"
              autoComplete="off"
              maxLength={200}
              disabled={busy}
            />
            {error && <p className="inline-error" role="alert">{error}</p>}
            {hasParticipantId && (
              <div className="onboarding-actions">
                <button className="primary-button start-button" type="submit" disabled={busy}>
                  {busy ? 'Preparing…' : 'Start task'}
                  {!busy && <ArrowIcon />}
                </button>
              </div>
            )}
          </form>
        </section>
      </main>
    );
  }

  if (phase === 'complete') {
    return (
      <main className="center-stage complete-stage">
        <section className="status-card complete-card">
          <h1>Receipt review complete</h1>
          <div className="completion-note" aria-labelledby="completion-message-title">
            <div className="requester-message-heading">
              <MessageIcon />
              <h2 id="completion-message-title">Message from the requester</h2>
            </div>
            <div>
              Thank you for completing all 40 receipt tasks.<br />
              To complete the overall task and receive your Prolific completion code, please complete the final survey.
            </div>
          </div>
          {googleFormUrl && (
            <div className="survey-panel">
              <a
                className="primary-button survey-button"
                href={googleFormUrl}
                target="_blank"
                rel="noreferrer"
              >
                Start survey
                <ExternalLinkIcon />
              </a>
            </div>
          )}
        </section>
      </main>
    );
  }

  const task = current?.task;
  if (!task || !current) return null;
  const itemNumber = current.currentIndex + 1;
  const progress = (itemNumber / current.totalTasks) * 100;
  const timeLimitExceeded = elapsedTimeSeconds > TASK_TIME_LIMIT_SECONDS;
  const displayedTimerSeconds = timeLimitExceeded
    ? elapsedTimeSeconds - TASK_TIME_LIMIT_SECONDS
    : TASK_TIME_LIMIT_SECONDS - elapsedTimeSeconds;
  const timerLabel = timeLimitExceeded ? 'Time over' : 'Time remaining';

  return (
    <main className="task-shell">
      <header className="task-header">
        <div className="task-brand"><ReceiptIcon /><span>Receipt Review</span></div>
        <div className="header-stats">
          <div className="progress-copy" aria-label={`Progress ${itemNumber} / ${current.totalTasks}`}>
            <span>Progress</span>
            <strong>{itemNumber} <small>/ {current.totalTasks}</small></strong>
          </div>
          <div
            className={`timer-copy ${timeLimitExceeded ? 'timer-warning' : ''}`}
            aria-label={`${timerLabel} ${timeLimitExceeded ? '+' : ''}${formatTime(displayedTimerSeconds)}`}
            role="timer"
          >
            <TimerIcon />
            <span>{timerLabel}</span>
            <strong>{timeLimitExceeded ? '+' : ''}{formatTime(displayedTimerSeconds)}</strong>
          </div>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </header>

      <section className="task-grid">
        <article className="receipt-panel">
          <div className="panel-heading">
            <div><span className="step-label">STEP {String(itemNumber).padStart(2, '0')}</span><h1>Receipt</h1></div>
            <div className="zoom-controls" aria-label="Image zoom controls">
              <button type="button" onClick={() => setZoom((value) => Math.max(0.7, value - 0.2))} aria-label="Zoom out">−</button>
              <output aria-live="polite">{Math.round(zoom * 100)}%</output>
              <button type="button" onClick={() => setZoom((value) => Math.min(2.4, value + 0.2))} aria-label="Zoom in">+</button>
              <button type="button" className="reset-button" onClick={() => setZoom(0.85)}>Reset</button>
            </div>
          </div>
          <div className="receipt-viewport">
            {/* A regular img keeps the full-resolution receipt available while zooming. */}
            <img
              key={task.imageUrl}
              src={task.imageUrl}
              alt={`Receipt ${itemNumber}`}
              style={{ width: `${zoom * 100}%` }}
              draggable={false}
            />
          </div>
          <p className="zoom-hint">If the image is too small, use + to zoom in and scroll to review it.</p>
        </article>

        <article className="answer-panel">
          <div className="question-number">QUESTION {String(itemNumber).padStart(2, '0')}</div>
          <h2>{task.question}</h2>
          <p className="answer-guidance">Answer based on the information shown on the receipt.</p>
          <form onSubmit={submitAnswer}>
            <label htmlFor="worker-answer">Answer</label>
            <input
              ref={answerInputRef}
              id="worker-answer"
              name="answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Enter your answer"
              autoComplete="off"
              maxLength={500}
              disabled={busy}
            />
            {error && <p className="inline-error" role="alert">{error}</p>}
            <button className="primary-button submit-button" type="submit" disabled={busy || !answer.trim()}>
              {busy ? 'Saving…' : itemNumber === current.totalTasks ? 'Submit and complete' : 'Submit and next'}
              {!busy && <ArrowIcon />}
            </button>
          </form>
        </article>
      </section>
    </main>
  );
}

function ReceiptIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z"/><path d="M9 7h6M9 11h6M9 15h3"/></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
}

function TimerIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M9 2h6M12 5v3M12 13l3-2"/></svg>;
}

function MessageIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H9l-4 4V5Z"/><path d="M9 9h6M9 12h4"/></svg>;
}

function ExternalLinkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9"/><path d="M18 13v6H5V6h6"/></svg>;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
