import { isSessionId, noStoreJson, publicError, readJsonObject } from '@/lib/server/http';
import { supabaseRequest } from '@/lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (!body || !isSessionId(body.sessionId)) {
      return noStoreJson({ error: 'This session is invalid.' }, { status: 400 });
    }

    await supabaseRequest<void>('experiment_sessions?on_conflict=session_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ session_id: body.sessionId }),
    });

    return noStoreJson({ opened: true });
  } catch (error) {
    return publicError(error);
  }
}
