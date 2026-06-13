import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

const PUBLIC_PATHS = [
  '/welcome',            // public landing page
  '/login',
  '/api/auth',           // NextAuth callback routes
  '/api/health',
]

// Routes that bypass middleware body buffering (large uploads).
// Auth check happens inside the route handler.
const BYPASS_PATHS = [
  /^\/api\/stories\/[^/]+\/upload-final$/,
  /^\/api\/stories\/[^/]+\/publish-youtube$/,
  /^\/api\/ads\/upload-image$/,         // accepts up to 8MB image
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  if (BYPASS_PATHS.some(r => r.test(pathname))) {
    return NextResponse.next()
  }

  // Check NextAuth session token
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET,
  })

  if (!token?.userId) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Unauthenticated visitors land on /welcome (marketing) by default,
    // not the bare /login form. They can click "Sign in" from there.
    return NextResponse.redirect(new URL('/welcome', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo_jpg.jpg).*)'],
}
