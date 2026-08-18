import { getAnswerKey } from '@/lib/server/answer-key';
import { isSessionId, noStoreJson, publicError, readJsonObject } from '@/lib/server/http';
import { validateAnswer } from '@/lib/server/normalization';
import { callRpc, getSession } from '@/lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const answer = typeof body?.answer === 'string' ? body.answer.trim() : '';
    const receiptId = typeof body?.receiptId === 'string' ? body.receiptId : '';

    if (!body || !isSessionId(body.sessionId) || !receiptId || !answer || answer.length > 500) {
      return noStoreJson({ error: 'Please check your submission.' }, { status: 400 });
    }

    const session = await getSession(body.sessionId);
    if (!session || session.status !== 'started') {
      return noStoreJson({ error: 'No active session was found.' }, { status: 409 });
    }

    const expectedReceiptId = session.receipt_order?.[session.current_index];
    if (!expectedReceiptId || receiptId !== expectedReceiptId) {
      return noStoreJson({ error: 'This submission does not match the current task.' }, { status: 409 });
    }

    const answerKey = getAnswerKey(expectedReceiptId);
    if (!answerKey) {
      throw new Error('Answer key is missing for the current receipt');
    }

    const newIndex = await callRpc<number>('save_experiment_response', {
      p_session_id: body.sessionId,
      p_receipt_id: expectedReceiptId,
      p_assigned_type: answerKey.assignedType,
      p_worker_answer: answer,
      p_is_correct: validateAnswer(answer, answerKey.correctAnswer),
    });

    return noStoreJson({ saved: true, hasMore: newIndex < session.total_tasks });
  } catch (error) {
    return publicError(error);
  }
}
