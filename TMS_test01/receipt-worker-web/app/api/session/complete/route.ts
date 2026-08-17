import { isSessionId, noStoreJson, publicError, readJsonObject } from '@/lib/server/http';
import { callRpc } from '@/lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (!body || !isSessionId(body.sessionId)) {
      return noStoreJson({ error: '유효하지 않은 세션입니다.' }, { status: 400 });
    }

    await callRpc<null>('complete_experiment_session', { p_session_id: body.sessionId });
    return noStoreJson({ completed: true });
  } catch (error) {
    return publicError(error);
  }
}
