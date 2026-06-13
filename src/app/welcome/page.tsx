'use client'
import Link from 'next/link'
import { useSession } from 'next-auth/react'

const HERO_IMG = 'https://storage.googleapis.com/ai_clip_007/landing/hero.png'
const TEMPLATES_IMG = 'https://storage.googleapis.com/ai_clip_007/landing/feature-templates.png'

export default function WelcomePage() {
  const { data: session } = useSession()
  const isAuth = !!session?.user
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden">
      {/* Ambient background glow */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-purple-500/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-pink-500/15 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/2 w-[700px] h-[700px] bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      {/* Nav */}
      <nav className="sticky top-0 z-20 backdrop-blur-xl bg-black/30 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/welcome" className="flex items-center gap-2.5 font-bold">
            <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/50">✦</span>
            <span className="tracking-tight">AI Studio</span>
          </Link>
          <div className="hidden md:flex items-center gap-1 text-sm">
            <a href="#features" className="px-3 py-2 text-white/60 hover:text-white transition-colors">Features</a>
            <a href="#templates" className="px-3 py-2 text-white/60 hover:text-white transition-colors">Templates</a>
            <a href="#how" className="px-3 py-2 text-white/60 hover:text-white transition-colors">How it works</a>
            <a href="#pricing" className="px-3 py-2 text-white/60 hover:text-white transition-colors">Pricing</a>
          </div>
          {isAuth ? (
            <Link href="/"
              className="px-4 py-2 bg-white hover:bg-white/90 text-black rounded-lg font-semibold text-sm transition-colors shadow-lg">
              Open dashboard →
            </Link>
          ) : (
            <Link href="/login"
              className="px-4 py-2 bg-white hover:bg-white/90 text-black rounded-lg font-semibold text-sm transition-colors shadow-lg">
              Get started
            </Link>
          )}
        </div>
      </nav>

      {/* HERO */}
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-32">
        <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-10 items-center">
          {/* Left — text */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs font-medium text-white/80 mb-6 backdrop-blur">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shadow-lg shadow-green-400/50" />
              Powered by Veo 3.1 + Gemini 2.5
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
              Hindi AI videos<br />
              in <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-orange-300 bg-clip-text text-transparent">10 minutes</span>
            </h1>

            <p className="mt-6 text-lg text-white/60 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Pre-built viral templates for stories, ads, and devotional content.
              Bring your own Google Cloud credit — your cost stays ₹0.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link href={isAuth ? '/' : '/login'}
                className="w-full sm:w-auto px-6 py-3.5 bg-white hover:bg-white/90 text-black rounded-xl font-semibold shadow-2xl shadow-white/10 transition-all flex items-center justify-center gap-2 group">
                {isAuth ? 'Open dashboard' : 'Start free with Google'}
                <span className="group-hover:translate-x-0.5 transition-transform">→</span>
              </Link>
              <a href="#templates"
                className="w-full sm:w-auto px-6 py-3.5 bg-white/5 hover:bg-white/10 backdrop-blur border border-white/10 text-white rounded-xl font-semibold transition-all">
                See templates
              </a>
            </div>

            <p className="mt-4 text-xs text-white/40">No credit card · Google&apos;s free $300 trial · 100+ videos free</p>
          </div>

          {/* Right — hero image */}
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-br from-purple-500/30 via-pink-500/20 to-transparent blur-2xl" />
            <div className="relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl shadow-purple-500/20">
              <img src={HERO_IMG} alt="" className="w-full h-auto" />
            </div>
            {/* Floating badges */}
            <div className="absolute -bottom-4 -left-4 px-3 py-2 bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl flex items-center gap-2 shadow-2xl">
              <div className="w-7 h-7 rounded-lg bg-purple-500 flex items-center justify-center text-sm">🍆</div>
              <div className="text-xs">
                <p className="font-semibold">Veggie Drama</p>
                <p className="text-white/50">5M+ views proven</p>
              </div>
            </div>
            <div className="absolute -top-4 -right-4 px-3 py-2 bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl flex items-center gap-2 shadow-2xl">
              <div className="w-7 h-7 rounded-lg bg-pink-500 flex items-center justify-center text-sm">🎤</div>
              <div className="text-xs">
                <p className="font-semibold">AI Ads</p>
                <p className="text-white/50">Your real product</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-white/5 bg-white/[0.02] backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { num: '10min', sub: 'Average generation time' },
            { num: '0%', sub: 'Filter rejection on ads' },
            { num: '₹0', sub: 'Compute cost to you' },
            { num: '6+', sub: 'Proven viral templates' },
          ].map(s => (
            <div key={s.num}>
              <p className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">{s.num}</p>
              <p className="text-xs text-white/50 mt-1">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold text-purple-400 uppercase tracking-widest mb-3">Why creators choose us</p>
            <h2 className="text-4xl font-bold tracking-tight">Built for Hindi-first AI content</h2>
            <p className="mt-3 text-white/50 max-w-2xl mx-auto">Every layer tuned for Indian creators and D2C brands. No generic tools, no copy-paste from English platforms.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { emoji: '🎬', title: 'Proven viral templates', body: 'Vegetable Drama, Halku, Dada Magic, AI Ads. Formats already getting millions of views.', glow: 'from-purple-500/20' },
              { emoji: '🇮🇳', title: 'Hindi-native, safe', body: 'Chirp3-HD Hindi voices. Veo content filter rules baked in. No wasted credits on rejected scenes.', glow: 'from-pink-500/20' },
              { emoji: '💰', title: 'Bring your own credit', body: 'Use Google&apos;s free $300 trial. Your videos, your bucket, your control. We don&apos;t charge for compute.', glow: 'from-orange-500/20' },
              { emoji: '🎤', title: 'AI ads for D2C brands', body: 'Upload product image. Generate 30-sec ad with your actual product. Charge clients ₹2-5K each.', glow: 'from-purple-500/20' },
              { emoji: '🚀', title: '1-click generation', body: 'Topic → script → narration → 8-15 video clips. Fully automated. ~10 minutes per video.', glow: 'from-pink-500/20' },
              { emoji: '📊', title: 'Per-channel analytics', body: 'Track YouTube performance directly. Retention curves, CTR, traffic sources — see what works.', glow: 'from-orange-500/20' },
            ].map(f => (
              <div key={f.title} className="group relative bg-white/[0.03] border border-white/10 hover:border-white/20 rounded-2xl p-6 transition-all hover:bg-white/[0.05]">
                <div className={`absolute inset-0 bg-gradient-to-br ${f.glow} to-transparent opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity`} />
                <div className="relative">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl mb-4">{f.emoji}</div>
                  <h3 className="text-base font-bold mb-2">{f.title}</h3>
                  <p className="text-sm text-white/60 leading-relaxed">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TEMPLATES section with image */}
      <section id="templates" className="py-20 md:py-28 border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
          <div className="relative order-2 lg:order-1">
            <div className="absolute -inset-4 bg-gradient-to-br from-pink-500/20 to-purple-500/20 blur-2xl" />
            <div className="relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl shadow-pink-500/10 bg-black">
              <img src={TEMPLATES_IMG} alt="" className="w-full h-auto" />
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <p className="text-xs font-semibold text-pink-400 uppercase tracking-widest mb-3">Template library</p>
            <h2 className="text-4xl font-bold tracking-tight">Pick a format, click generate</h2>
            <p className="mt-4 text-white/60 leading-relaxed">
              Each template comes with proven prompts, anchor system, scene structure, and safety rules.
              You just provide the input — the engine handles structure, pacing, and Veo compatibility.
            </p>

            <div className="mt-8 space-y-3">
              {[
                { emoji: '🍆', name: 'Veggie Drama', desc: 'Class-divide love stories with vegetable characters' },
                { emoji: '🟢', name: 'Halku — Desi Hulk', desc: 'Massive gentle giant searching for mummy&apos;s love' },
                { emoji: '🎤', name: 'AI Ad (1st-person)', desc: 'Talking product ads. Upload your product image.' },
                { emoji: '🪔', name: 'KathaKar Moral', desc: 'Hindi moral stories with karma twists' },
                { emoji: '👵', name: 'Dada Touch Magic', desc: 'Anything grandpa touches turns to something else' },
              ].map(t => (
                <div key={t.name} className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-xl shrink-0">{t.emoji}</div>
                  <div>
                    <p className="font-semibold text-sm">{t.name}</p>
                    <p className="text-xs text-white/50">{t.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-20 md:py-28 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold text-orange-400 uppercase tracking-widest mb-3">How it works</p>
            <h2 className="text-4xl font-bold tracking-tight">Three steps to your first video</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { n: '01', t: 'Sign in & connect', b: 'Sign in with Google. Paste your Google Cloud service account JSON — encrypted at rest. We walk you through enabling Veo + TTS APIs.' },
              { n: '02', t: 'Pick a template, customize', b: 'Choose a viral format or ad template. For ads: upload your product image. Add details. We handle prompts, scenes, narration.' },
              { n: '03', t: 'Generate, edit, publish', b: 'Audio in 30 seconds. Clips in ~10 minutes. Download the ZIP to edit in CapCut, or publish directly to YouTube.' },
            ].map(s => (
              <div key={s.n} className="relative bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                <div className="absolute top-4 right-4 text-6xl font-bold bg-gradient-to-br from-white/20 to-white/5 bg-clip-text text-transparent leading-none">
                  {s.n}
                </div>
                <div className="relative pt-12">
                  <h3 className="text-lg font-bold mb-2">{s.t}</h3>
                  <p className="text-sm text-white/60 leading-relaxed">{s.b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-20 md:py-28 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold text-purple-400 uppercase tracking-widest mb-3">Pricing</p>
            <h2 className="text-4xl font-bold tracking-tight">Start free. Pay only for the platform.</h2>
            <p className="mt-3 text-white/50 max-w-xl mx-auto">Compute costs go to YOUR Google account — your $300 free trial covers 100+ videos.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { name: 'Free', price: '₹0', period: 'forever', highlight: false,
                features: ['5 videos / month', 'All viral templates', 'Watermark on output', 'Email support'], cta: 'Start free' },
              { name: 'Pro', price: '₹499', period: '/ month', highlight: true,
                features: ['50 videos / month', 'No watermark', 'YouTube auto-publish', 'Scheduled posting', 'Priority generation'], cta: 'Go Pro' },
              { name: 'Agency', price: '₹2,499', period: '/ month', highlight: false,
                features: ['Unlimited videos', 'Multi-channel (5+)', 'Brand-safe AI ads', 'Priority support', 'White-label option'], cta: 'Contact us' },
            ].map(t => (
              <div key={t.name}
                className={`relative rounded-2xl p-6 ${t.highlight
                  ? 'bg-gradient-to-br from-purple-600 to-pink-600 text-white shadow-2xl shadow-purple-500/30 scale-105'
                  : 'bg-white/[0.03] border border-white/10'}`}>
                {t.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-purple-700 rounded-full text-xs font-bold shadow-lg">
                    MOST POPULAR
                  </div>
                )}
                <p className={`text-sm font-semibold ${t.highlight ? 'opacity-90' : 'text-white/60'}`}>{t.name}</p>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <p className="text-4xl font-bold">{t.price}</p>
                  <p className={`text-xs ${t.highlight ? 'opacity-80' : 'text-white/50'}`}>{t.period}</p>
                </div>
                <ul className={`mt-6 space-y-2.5 text-sm ${t.highlight ? '' : 'text-white/70'}`}>
                  {t.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5">
                      <span className={`mt-0.5 ${t.highlight ? 'opacity-90' : 'text-purple-400'}`}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/login"
                  className={`mt-7 block w-full py-3 text-center rounded-xl text-sm font-semibold transition-colors
                    ${t.highlight ? 'bg-white text-purple-700 hover:bg-purple-50' : 'bg-white text-black hover:bg-white/90'}`}>
                  {t.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA strip */}
      <section className="py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold tracking-tight">Ready to make your first AI video?</h2>
          <p className="mt-3 text-white/60">Sign in with Google. Connect your free Cloud account. Generate.</p>
          <Link href="/login"
            className="mt-8 inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-xl font-semibold shadow-2xl shadow-purple-500/30 transition-all group">
            Start free with Google
            <span className="group-hover:translate-x-0.5 transition-transform">→</span>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-black/50 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/40">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs">✦</span>
            <span>AI Studio · Made in India</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <Link href="/login" className="hover:text-white transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
