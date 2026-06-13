import { createHash } from 'crypto'

/**
 * Hash an OTP bound to its email so a leaked hash can't be replayed for another
 * address. Used when storing (otp send route) and verifying (auth authorize).
 */
export function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email.toLowerCase()}:${code}`).digest('hex')
}
