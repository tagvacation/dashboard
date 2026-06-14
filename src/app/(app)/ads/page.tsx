'use client'
import Link from 'next/link'

const FLOWS = [
  {
    href: '/ads/new?style=mascot',
    emoji: '🦸',
    title: 'Mascot Drama',
    desc: 'Your product becomes a hero character that battles the problem — talking, animated, high-energy story. Best for fun, attention-grabbing social ads.',
    tag: 'Animated · talking characters',
  },
  {
    href: '/ads/new?style=emotional',
    emoji: '✨',
    title: 'Product Story',
    desc: 'Emotional, lifestyle b-roll with your real product composited in and a clean end-card. Best for premium, benefit-led brand ads.',
    tag: 'Realistic · real product',
  },
]

export default function AdsChooserPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 md:py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Create an AI Ad</h1>
        <p className="text-sm text-white/40 mt-1.5">Pick the creative format — each has its own tailored form.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {FLOWS.map(f => (
          <Link key={f.href} href={f.href}
            className="group relative bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 hover:border-purple-400/40 rounded-2xl p-6 transition-all overflow-hidden">
            <div className="absolute -top-16 -right-16 w-48 h-48 bg-gradient-to-br from-purple-500/10 to-pink-500/5 rounded-full blur-3xl group-hover:from-purple-500/20 transition-all" />
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center text-2xl mb-4">{f.emoji}</div>
              <h2 className="text-lg font-bold group-hover:text-purple-300 transition-colors">{f.title}</h2>
              <p className="text-xs text-purple-300/70 font-medium mt-1">{f.tag}</p>
              <p className="text-sm text-white/50 mt-3 leading-relaxed">{f.desc}</p>
              <p className="text-sm font-semibold text-purple-400 mt-4 inline-flex items-center gap-1">
                Start →
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
