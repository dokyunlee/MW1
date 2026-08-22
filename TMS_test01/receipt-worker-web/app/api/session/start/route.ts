import { getEligibleReceiptIds } from '@/lib/server/answer-key';
import { normalizeProlificParticipantId } from '@/lib/prolific-participant-id';
import { isSessionId, noStoreJson, publicError, readJsonObject } from '@/lib/server/http';
import { fisherYatesShuffle } from '@/lib/server/randomize';
import { callRpc, getSession } from '@/lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (!body || !isSessionId(body.sessionId)) {
      return noStoreJson({ error: 'This session is invalid.' }, { status: 400 });
    }
    const prolificParticipantId = normalizeProlificParticipantId(body.prolificParticipantId);
    if (!prolificParticipantId) {
      return noStoreJson(
        { error: 'Prolific Participant ID is required.' },
        { status: 400 },
      );
    }

    const session = await getSession(body.sessionId);
    if (!session) {
      return noStoreJson({ error: 'Session not found.' }, { status: 404 });
    }

    if (session.status === 'opened') {
      await callRpc<null>('start_experiment_session', {
        p_session_id: body.sessionId,
        p_receipt_order: fisherYatesShuffle(getEligibleReceiptIds()),
        p_prolific_participant_id: prolificParticipantId,
      });
    }

    return noStoreJson({ started: true });
  } catch (error) {
    return publicError(error);
  }
}
