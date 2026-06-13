import nodemailer from 'nodemailer'

/**
 * SMTP transport built from env. Configure these in .env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * For Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=<gmail>,
 *   SMTP_PASS=<16-char app password>.
 *
 * If SMTP is not configured, the OTP is logged to the server console instead of
 * being emailed (dev fallback) — see isMailerConfigured().
 */

export function isMailerConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

let _transport: nodemailer.Transporter | null = null

function getTransport(): nodemailer.Transporter {
  if (_transport) return _transport
  const port = Number(process.env.SMTP_PORT || 465)
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
  return _transport
}

/**
 * Send a 6-digit login/signup code. In dev (no SMTP), logs to console and returns
 * { delivered: false } so the caller can surface the code for local testing.
 */
export async function sendOtpEmail(to: string, code: string): Promise<{ delivered: boolean }> {
  if (!isMailerConfigured()) {
    console.log(`[mailer] SMTP not configured — OTP for ${to} is: ${code}`)
    return { delivered: false }
  }

  const from = process.env.SMTP_FROM || `AI Studio <${process.env.SMTP_USER}>`
  await getTransport().sendMail({
    from,
    to,
    subject: `${code} is your AI Studio verification code`,
    text: `Your AI Studio verification code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
        <h2 style="margin:0 0 4px;font-size:18px">Verify your email</h2>
        <p style="margin:0 0 24px;color:#666;font-size:14px">Enter this code to continue to AI Studio.</p>
        <div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;background:#f5f3ff;color:#6d28d9;padding:18px;border-radius:12px">${code}</div>
        <p style="margin:24px 0 0;color:#999;font-size:12px">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
      </div>
    `,
  })
  return { delivered: true }
}
