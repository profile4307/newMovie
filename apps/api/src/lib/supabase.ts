import { Env } from '../index'

export type SupabaseClient = ReturnType<typeof createSupabaseClient>

export function createSupabaseClient(env: Env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env

  const baseHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Prefer: 'return=representation',
  }

  async function query<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ data: T | null; error: string | null }> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      ...options,
      headers: { ...baseHeaders, ...options.headers },
    })

    if (!res.ok) {
      const err = await res.text()
      return { data: null, error: err }
    }

    const data = (await res.json()) as T
    return { data, error: null }
  }

  async function rpc<T>(
    fnName: string,
    params: Record<string, unknown> = {}
  ): Promise<{ data: T | null; error: string | null }> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      const err = await res.text()
      return { data: null, error: err }
    }

    const text = await res.text()
    const data = text ? (JSON.parse(text) as T) : (null as T)
    return { data, error: null }
  }

  return { query, rpc }
}

export function createAnonClient(env: Env) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = env

  async function verifyToken(token: string): Promise<{ userId: string | null }> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    })
    if (!res.ok) return { userId: null }
    const user = (await res.json()) as { id: string }
    return { userId: user.id }
  }

  return { verifyToken }
}
