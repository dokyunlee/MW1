import { getAnswerKey } from '@/lib/server/answer-key';
import { isSessionId, noStoreJson, publicError } from '@/lib/server/http';
import { callRpc, getSession } from '@/lib/server/supabase';
import {
  getElapsedTimeSeconds,
  getTimeRemainingSeconds,
  hasTimeLimitExceeded,
} from '@/lib/server/time-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const sessionId = new URL(request.url).searchParams.get('sessionId');
    if (!isSessionId(sessionId)) {
      return noStoreJson({ error: 'This session is invalid.' }, { status: 400 });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return noStoreJson({ error: 'Session not found.' }, { status: 404 });
    }

    const timeRemainingSeconds = getTimeRemainingSeconds(session.started_at);
    const elapsedTimeSeconds = getElapsedTimeSeconds(session.started_at);
    const timeLimitExceeded = hasTimeLimitExceeded(session.started_at);

    if (session.status !== 'started' || session.current_index >= session.total_tasks) {
      return noStoreJson({
        status: session.status,
        currentIndex: session.current_index,
        totalTasks: session.total_tasks,
        completed: session.status === 'completed',
        elapsedTimeSeconds,
        timeLimitExceeded,
        timeRemainingSeconds,
        task: null,
      });
    }

    const receiptId = session.receipt_order?.[session.current_index];
    const answerKey = receiptId ? getAnswerKey(receiptId) : null;
    if (!answerKey) {
      throw new Error('Session receipt order is invalid');
    }

    const shownAt = await callRpc<string>('mark_current_task_shown', {
      p_session_id: sessionId,
    });

    return noStoreJson({
      status: session.status,
      currentIndex: session.current_index,
      totalTasks: session.total_tasks,
      completed: false,
      elapsedTimeSeconds,
      timeLimitExceeded,
      timeRemainingSeconds,
      task: {
        receiptId: answerKey.receiptId,
        imageUrl: `/receipts/${answerKey.fileName}`,
        question: answerKey.question,
        presentationIndex: session.current_index,
        shownAt,
      },
    });
  } catch (error) {
    return publicError(error);
  }
}
