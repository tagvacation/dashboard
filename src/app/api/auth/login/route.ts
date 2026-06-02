import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'


export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  // Simple deterministic token — same logic as middleware
  const raw = `${process.env.DASHBOARD_PASSWORD}:${process.env.JWT_SECRET}`
  const token = Buffer.from(raw).toString('base64')

  const res = NextResponse.json({ success: true })
  res.cookies.set('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
  return res
}
