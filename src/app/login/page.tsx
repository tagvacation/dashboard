'use client'
import { signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, Suspense } from 'react'

function LoginInner() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'

  useEffect(() => {
    if (status === 'authenticated') router.push(callbackUrl)
  }, [status, callbackUrl, router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 flex flex-col">
      {/* Top bar */}
      <nav className="px-6 h-14 flex items-center">
        <a href="/welcome" className="flex items-center gap-2 font-semibold text-gray-900">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-sm">✦</span>
          AI Studio
        </a>
      </nav>

      {/* Centered card */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
            <p className="text-sm text-gray-500 mt-1.5">Sign in to continue to AI Studio</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <button
              onClick={() => signIn('google', { callbackUrl })}
              disabled={status === 'loading'}
              className="w-full py-3 px-4 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-800 border border-gray-200 rounded-xl text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {status === 'loading' ? 'Loading...' : 'Continue with Google'}
            </button>

            <p className="text-xs text-gray-400 text-center mt-6 leading-relaxed">
              By signing in you agree to our terms.<br />
              No credit card required.
            </p>
          </div>

          <p className="text-center mt-6 text-xs text-gray-500">
            New to AI Studio? <a href="/welcome" className="text-purple-600 hover:text-purple-700 font-medium">See how it works →</a>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  )
}
