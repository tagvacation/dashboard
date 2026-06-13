'use client'
import { signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'

type Mode = 'login' | 'signup'
type Step = 'details' | 'code'

function LoginInner() {
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'

  const [mode, setMode] = useState<Mode>('login')
  const [step, setStep] = useState<Step>('details')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    if (status === 'authenticated') router.push(callbackUrl)
  }, [status, callbackUrl, router])

  function switchMode(next: Mode) {
    setMode(next)
    setStep('details')
    setError('')
    setInfo('')
    setCode('')
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const res = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, mode, name, phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not send code')
        return
      }
      setStep('code')
      setInfo(
        data.devCode
          ? `Email not configured — your code is ${data.devCode}`
          : `We sent a 6-digit code to ${email}`
      )
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await signIn('credentials', { email, code, redirect: false })
      if (res?.error) {
        setError('Invalid or expired code. Try again.')
        return
      }
      router.push(callbackUrl)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full py-3 px-4 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-300 transition-all'

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 flex flex-col">
      <nav className="px-6 h-14 flex items-center">
        <a href="/welcome" className="flex items-center gap-2 font-semibold text-gray-900">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-sm">✦</span>
          AI Studio
        </a>
      </nav>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="text-sm text-gray-500 mt-1.5">
              {step === 'code'
                ? 'Enter the code we emailed you'
                : mode === 'login'
                ? 'Sign in with your email'
                : 'Sign up to get started'}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            {step === 'details' ? (
              <form onSubmit={sendCode} className="space-y-3">
                {mode === 'signup' && (
                  <input
                    type="text" required value={name} onChange={e => setName(e.target.value)}
                    placeholder="Full name" autoComplete="name" className={inputClass}
                  />
                )}
                <input
                  type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email" className={inputClass}
                />
                {mode === 'signup' && (
                  <input
                    type="tel" required value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="Phone number" autoComplete="tel" className={inputClass}
                  />
                )}

                {error && <p className="text-xs text-red-500">{error}</p>}

                <button
                  type="submit" disabled={busy}
                  className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-95 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all shadow-sm"
                >
                  {busy ? 'Sending…' : 'Send code'}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyCode} className="space-y-3">
                {info && <p className="text-xs text-gray-500">{info}</p>}
                <input
                  type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className={`${inputClass} text-center tracking-[0.5em] text-lg font-semibold`}
                />

                {error && <p className="text-xs text-red-500">{error}</p>}

                <button
                  type="submit" disabled={busy || code.length !== 6}
                  className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-95 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all shadow-sm"
                >
                  {busy ? 'Verifying…' : 'Verify & continue'}
                </button>
                <button
                  type="button" onClick={() => { setStep('details'); setError(''); setInfo('') }}
                  className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ← Use a different email
                </button>
              </form>
            )}
          </div>

          <p className="text-center mt-6 text-xs text-gray-500">
            {mode === 'login' ? (
              <>New to AI Studio?{' '}
                <button onClick={() => switchMode('signup')} className="text-purple-600 hover:text-purple-700 font-medium">Create an account</button>
              </>
            ) : (
              <>Already have an account?{' '}
                <button onClick={() => switchMode('login')} className="text-purple-600 hover:text-purple-700 font-medium">Sign in</button>
              </>
            )}
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
