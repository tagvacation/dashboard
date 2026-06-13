'use client'
import { useState } from 'react'

export default function KeysPage() {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const toggleReveal = (id: string) => setRevealed(r => ({ ...r, [id]: !r[id] }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">API Keys</h2>
        <p className="text-sm text-white/40 mt-1">Secrets used to call AI services on your behalf</p>
      </div>

      <div className="relative bg-gradient-to-br from-orange-500/10 to-pink-500/10 border border-orange-500/20 rounded-2xl p-5 overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-orange-500/20 rounded-full blur-2xl" />
        <div className="relative flex items-start gap-3">
          <div className="text-2xl shrink-0">🔐</div>
          <div className="text-sm">
            <p className="font-semibold mb-1">About API keys</p>
            <p className="text-white/60 leading-relaxed">
              For most AI Studio features, your <a href="/profile/accounts" className="text-purple-300 hover:text-purple-200 underline underline-offset-2">Google Cloud Account</a> handles
              authentication via service account JSON. API keys here are for legacy/optional fallbacks (older Gemini API key flow, etc.).
              Most users don&apos;t need to set anything on this page.
            </p>
          </div>
        </div>
      </div>

      {/* Gemini API Key (legacy fallback) */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold">Gemini API Key</h3>
            <p className="text-xs text-white/40 mt-0.5">Optional — used only when Service Account auth fails or you prefer key-based access</p>
          </div>
          <span className="px-2 py-0.5 text-xs font-medium bg-white/10 text-white/60 rounded-full">Optional</span>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 bg-black/40 border border-white/10 rounded-xl">
            <span className="text-xs text-white/30 font-mono">{revealed.gemini ? 'AIzaSyXXXXXXXXXXXXXX (set via env)' : '•••••••••••••••••••••••'}</span>
            <button onClick={() => toggleReveal('gemini')}
              className="ml-auto text-xs text-white/40 hover:text-white transition-colors">
              {revealed.gemini ? 'Hide' : 'Reveal'}
            </button>
          </div>
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-purple-300 hover:text-purple-200 text-xs font-medium transition-colors">
            Get an API key at aistudio.google.com/apikey
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </a>
        </div>
      </div>

      {/* Coming soon section */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
        <h3 className="text-base font-bold mb-1">Other integrations</h3>
        <p className="text-xs text-white/40 mb-4">More providers coming soon</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {['OpenAI', 'ElevenLabs', 'Anthropic', 'Cloudflare R2', 'Stripe', 'Razorpay'].map(name => (
            <div key={name} className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/5 rounded-xl">
              <span className="text-sm text-white/50">{name}</span>
              <span className="text-xs text-white/30">Soon</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
