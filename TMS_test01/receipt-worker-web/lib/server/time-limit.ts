import { TASK_TIME_LIMIT_SECONDS } from '@/lib/constants';

export function getTimeRemainingSeconds(
  startedAt: string | null,
  nowMs = Date.now(),
): number | null {
  if (!startedAt) return null;

  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new Error('Session started_at is invalid');
  }

  const deadlineMs = startedAtMs + TASK_TIME_LIMIT_SECONDS * 1000;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function getElapsedTimeSeconds(
  startedAt: string | null,
  nowMs = Date.now(),
): number | null {
  if (!startedAt) return null;

  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new Error('Session started_at is invalid');
  }

  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

export function hasTimeLimitExceeded(startedAt: string | null, nowMs = Date.now()): boolean {
  if (!startedAt) return false;

  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new Error('Session started_at is invalid');
  }

  return nowMs - startedAtMs > TASK_TIME_LIMIT_SECONDS * 1000;
}
