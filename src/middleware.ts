import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth/login']

// Routes that bypass middleware body buffering (large uploads)
// Auth is handled inside the route handler itself
const BYPASS_PATHS = [
  /^\/api\/stories\/[^/]+\/upload-final$/,
  /^\/api\/stories\/[^/]+\/publish-youtube$/,
]

function getExpectedToken() {
  const raw = `${process.env.DASHBOARD_PASSWORD}:${process.env.JWT_SECRET}`
  return Buffer.from(raw).toString('base64')
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Pass through upload routes without reading body — prevents 10MB Next.js buffer limit
  // These routes do their own auth check internally
  if (BYPASS_PATHS.some(r => r.test(pathname))) {
    return NextResponse.next()
  }

  const token = req.cookies.get('auth_token')?.value

  if (!token || token !== getExpectedToken()) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo_jpg.jpg).*)'],
}
