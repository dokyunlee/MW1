'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  HEARTBEAT_INTERVAL_MS,
  SESSION_STORAGE_KEY,
  TASK_TIME_LIMIT_SECONDS,
} from '@/lib/constants';
import type { CurrentTaskResponse } from '@/lib/types';

type Phase = 'loading' | 'intro' | 'task' | 'complete' | 'error';

type ReceiptTaskAppProps = {
  googleFormUrl?: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || '요청을 처리하지 못했습니다.');
  }
  return payload;
}

export function ReceiptTaskApp({ googleFormUrl }: ReceiptTaskAppProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [sessionId, setSessionId] = useState('');
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
        setPhase('intro');
      } else if (data.status === 'started' && data.currentIndex >= data.totalTasks) {
        await finalize(id);
      } else if (data.task) {
        setAnswer('');
        setPhase('task');
        window.setTimeout(() => answerInputRef.current?.focus(), 100);
      } else {
        throw new Error('현재 작업을 불러오지 못했습니다.');
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
          if (!(initialError instanceof Error) || !initialError.message.includes('찾을 수 없습니다')) {
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
            : '세션을 준비하지 못했습니다.',
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

  async function startTask() {
    if (!sessionId || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/session/start', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      await loadCurrent(sessionId);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '작업을 시작하지 못했습니다.');
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
      const message = submitError instanceof Error ? submitError.message : '답변을 저장하지 못했습니다.';
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
          <h1>작업을 준비하고 있습니다</h1>
          <p>잠시만 기다려주세요.</p>
        </section>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="center-stage">
        <section className="status-card error-card">
          <div className="status-icon">!</div>
          <p className="eyebrow">연결 오류</p>
          <h1>작업을 불러오지 못했습니다</h1>
          <p>{error}</p>
          <button className="primary-button" onClick={() => window.location.reload()}>
            다시 시도
          </button>
        </section>
      </main>
    );
  }

  if (phase === 'intro') {
    return (
      <main className="center-stage intro-stage">
        <section className="intro-card">
          <h1>영수증을 보고<br />질문에 답해주세요</h1>
          <p className="intro-lead">
            총 50개의 영수증을 확인하게 됩니다. 각 영수증을 충분히 살펴본 후 정확하게
            답변해주세요.
          </p>

          <div className="instruction-panel">
            <p className="instruction-title">작업 방법</p>
            <ol>
              <li><span>1</span><p>영수증 이미지를 확인합니다.</p></li>
              <li><span>2</span><p>화면에 제시된 질문을 확인합니다.</p></li>
              <li><span>3</span><p>영수증을 바탕으로 답변을 입력합니다.</p></li>
              <li><span>4</span><p>답변을 제출하면 다음 영수증으로 이동합니다.</p></li>
              <li><span>5</span><p>50개의 영수증을 완료하면 작업이 종료됩니다.</p></li>
            </ol>
            <div className="time-limit-notice"><TimerIcon /><span>전체 작업 기준 시간은 20분이며, 이후에도 계속 진행할 수 있습니다.</span></div>
          </div>

          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="primary-button start-button" onClick={startTask} disabled={busy}>
            {busy ? '준비 중…' : '작업 시작'}
            {!busy && <ArrowIcon />}
          </button>
        </section>
      </main>
    );
  }

  if (phase === 'complete') {
    return (
      <main className="center-stage complete-stage">
        <section className="status-card complete-card">
          <div className="complete-icon" aria-hidden="true"><CheckIcon /></div>
          <p className="eyebrow">Task complete</p>
          <h1>모든 작업을 완료했습니다</h1>
          <p>50개의 영수증 검토가 안전하게 저장되었습니다.</p>
          <div className="completion-note">
            참여해주신 시간과 세심한 판단에 감사드립니다.
          </div>
          {googleFormUrl && (
            <div className="survey-panel">
              <h2>마지막 설문</h2>
              <p>아래 버튼을 눌러 후속 설문을 작성해주세요.</p>
              <a
                className="primary-button survey-button"
                href={googleFormUrl}
                target="_blank"
                rel="noreferrer"
              >
                설문 작성하기
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
  const timerLabel = timeLimitExceeded ? '초과 시간' : '남은 시간';

  return (
    <main className="task-shell">
      <header className="task-header">
        <div className="task-brand"><ReceiptIcon /><span>Receipt Review</span></div>
        <div className="header-stats">
          <div className="progress-copy" aria-label={`진행률 ${itemNumber} / ${current.totalTasks}`}>
            <span>진행률</span>
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
            <div><span className="step-label">STEP {String(itemNumber).padStart(2, '0')}</span><h1>영수증 확인</h1></div>
            <div className="zoom-controls" aria-label="이미지 확대/축소">
              <button type="button" onClick={() => setZoom((value) => Math.max(0.7, value - 0.2))} aria-label="축소">−</button>
              <output aria-live="polite">{Math.round(zoom * 100)}%</output>
              <button type="button" onClick={() => setZoom((value) => Math.min(2.4, value + 0.2))} aria-label="확대">+</button>
              <button type="button" className="reset-button" onClick={() => setZoom(0.85)}>Reset</button>
            </div>
          </div>
          <div className="receipt-viewport">
            {/* A regular img keeps the full-resolution receipt available while zooming. */}
            <img
              key={task.imageUrl}
              src={task.imageUrl}
              alt={`${itemNumber}번째 영수증`}
              style={{ width: `${zoom * 100}%` }}
              draggable={false}
            />
          </div>
          <p className="zoom-hint">이미지가 작다면 + 버튼으로 확대하고 스크롤해 확인하세요.</p>
        </article>

        <article className="answer-panel">
          <div className="question-number">QUESTION {String(itemNumber).padStart(2, '0')}</div>
          <h2>{task.question}</h2>
          <p className="answer-guidance">영수증에 표시된 내용을 기준으로 답변해주세요.</p>
          <form onSubmit={submitAnswer}>
            <label htmlFor="worker-answer">답변</label>
            <input
              ref={answerInputRef}
              id="worker-answer"
              name="answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="답변을 입력하세요"
              autoComplete="off"
              maxLength={500}
              disabled={busy}
            />
            {error && <p className="inline-error" role="alert">{error}</p>}
            <button className="primary-button submit-button" type="submit" disabled={busy || !answer.trim()}>
              {busy ? '저장 중…' : itemNumber === current.totalTasks ? '제출하고 완료' : '제출하고 다음'}
              {!busy && <ArrowIcon />}
            </button>
          </form>
          <div className="privacy-note">
            <LockIcon />
            <p><strong>답변은 안전하게 저장됩니다.</strong><span>제출 후에는 이전 문항으로 돌아갈 수 없습니다.</span></p>
          </div>
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

function ExternalLinkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9"/><path d="M18 13v6H5V6h6"/></svg>;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
