import 'server-only';

type SessionRow = {
  session_id: string;
  status: 'opened' | 'started' | 'completed';
  opened_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_seen_at: string;
  total_tasks: number;
  current_index: number;
  current_shown_at: string | null;
  receipt_order: string[] | null;
};

function credentials() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serverKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) must be configured',
    );
  }

  return { url, serverKey };
}

export async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, serverKey } = credentials();
  const headers = new Headers(init.headers);
  headers.set('apikey', serverKey);
  headers.set('Content-Type', 'application/json');
  headers.delete('Authorization');
  if (!serverKey.startsWith('sb_secret_')) {
    headers.set('Authorization', `Bearer ${serverKey}`);
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: 'no-store',
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const fields = [
    'session_id',
    'status',
    'opened_at',
    'started_at',
    'completed_at',
    'last_seen_at',
    'total_tasks',
    'current_index',
    'current_shown_at',
    'receipt_order',
  ].join(',');
  const rows = await supabaseRequest<SessionRow[]>(
    `experiment_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=${fields}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function callRpc<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  return supabaseRequest<T>(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
