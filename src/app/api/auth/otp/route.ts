import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { sql, ensureDb } from '@/lib/db'
import { sendOtpEmail, isMailerConfigured } from '@/lib/mailer'
import { hashCode } from '@/lib/otp'

export const runtime = 'nodejs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const OTP_TTL_MIN = 10

export async function POST(req: NextRequest) {
  try {
    await ensureDb()
    const body = await req.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const mode = body.mode === 'signup' ? 'signup' : 'login'
    const name = body.name ? String(body.name).trim() : null
    const phone = body.phone ? String(body.phone).trim() : null

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    }

    const [existing] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`

    if (mode === 'signup') {
      if (existing) {
        return NextResponse.json({ error: 'An account with this email already exists. Please log in.' }, { status: 409 })
      }
      if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      if (!phone || phone.replace(/\D/g, '').length < 8) {
        return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
      }
    } else {
      if (!existing) {
        return NextResponse.json({ error: 'No account found for this email. Please sign up.' }, { status: 404 })
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000)

    await sql`
      INSERT INTO otp_codes (email, code_hash, mode, name, phone, attempts, expires_at, created_at)
      VALUES (${email}, ${hashCode(email, code)}, ${mode}, ${name}, ${phone}, 0, ${expiresAt}, NOW())
      ON CONFLICT (email) DO UPDATE SET
        code_hash = EXCLUDED.code_hash,
        mode = EXCLUDED.mode,
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        attempts = 0,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW()
    `

    const { delivered } = await sendOtpEmail(email, code)

    // When SMTP isn't configured (local dev), return the code so it can be used.
    return NextResponse.json({
      ok: true,
      delivered,
      ...(isMailerConfigured() ? {} : { devCode: code }),
    })
  } catch (e) {
    console.error('OTP send error:', e)
    return NextResponse.json({ error: 'Could not send code. Try again.' }, { status: 500 })
  }
}
