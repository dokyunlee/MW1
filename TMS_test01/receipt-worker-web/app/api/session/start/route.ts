import { getReceiptIds } from '@/lib/server/answer-key';
import { isSessionId, noStoreJson, publicError, readJsonObject } from '@/lib/server/http';
import { fisherYatesShuffle } from '@/lib/server/randomize';
import { callRpc, getSession } from '@/lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (!body || !isSessionId(body.sessionId)) {
      return noStoreJson({ error: '유효하지 않은 세션입니다.' }, { status: 400 });
    }

    const session = await getSession(body.sessionId);
    if (!session) {
      return noStoreJson({ error: '세션을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (session.status === 'opened') {
      await callRpc<null>('start_experiment_session', {
        p_session_id: body.sessionId,
        p_receipt_order: fisherYatesShuffle(getReceiptIds()),
      });
    }

    return noStoreJson({ started: true });
  } catch (error) {
    return publicError(error);
  }
}
