import { getServerSession } from 'next-auth/next'
import { authOptions } from './auth'

/**
 * Get the current user's ID from the session.
 * Returns null if not authenticated.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id || null
}

/**
 * Get the current user's full session.
 * Returns null if not authenticated.
 */
export async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  return session?.user || null
}

/**
 * Throw 401-style error if not authenticated.
 * Use this in API routes that require auth.
 */
export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId()
  if (!id) {
    const err = new Error('Unauthorized') as Error & { status: number }
    err.status = 401
    throw err
  }
  return id
}
