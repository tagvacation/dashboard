import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

/**
 * Symmetric encryption for secrets at rest (e.g. users' GCP service-account JSON).
 *
 * Uses AES-256-GCM with a key derived from APP_ENCRYPTION_KEY. Output format:
 *   v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * decryptSecret() passes through any value WITHOUT the `v1:` prefix unchanged, so
 * pre-existing plaintext rows keep working until they're re-saved (then encrypted).
 */

const PREFIX = 'v1'

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set (needed to encrypt/decrypt secrets)')
  // Accept a base64 32-byte key, or derive a stable 32-byte key from any string.
  const b = Buffer.from(raw, 'base64')
  if (b.length === 32) return b
  return createHash('sha256').update(raw).digest()
}

export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`)
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  if (!isEncrypted(blob)) return blob // back-compat: plaintext rows
  const [, ivB64, tagB64, ctB64] = blob.split(':')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
