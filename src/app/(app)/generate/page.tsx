'use client'
import Link from 'next/link'

export default function GeneratePage() {
  return (
    <div className="px-4 md:px-8 py-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Generate</h1>
        <p className="text-sm text-white/40 mt-1.5">Choose what to create</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AI Ad — modern card */}
        <Link href="/ads"
          className="group relative bg-gradient-to-br from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/30 rounded-2xl p-6 overflow-hidden transition-all">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-pink-500/30 rounded-full blur-3xl group-hover:bg-pink-500/40 transition-colors" />
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-3xl mb-4">🎤</div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold">AI Ad</h2>
              <span className="text-xs px-1.5 py-0.5 bg-white/15 rounded-full font-semibold">NEW</span>
            </div>
            <p className="text-sm text-white/70 leading-relaxed">
              Talking product monologue ads. Upload your product image, get a 30-second Hindi ad with your actual product.
            </p>
            <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold">
              Create AI Ad
              <span className="group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
          </div>
        </Link>

        {/* Story generation — links to legacy for now */}
        <Link href="/legacy-dashboard?tab=generate"
          className="group bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 hover:border-white/20 rounded-2xl p-6 transition-all">
          <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-3xl mb-4">✦</div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold">Story Video</h2>
            <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded-full font-semibold border border-amber-500/30">LEGACY</span>
          </div>
          <p className="text-sm text-white/60 leading-relaxed">
            Veggie Drama, Halku, KathaKar Moral, Dada Magic. Pick template, click generate. Hindi narration auto-included.
          </p>
          <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-white/80">
            Open generator
            <span className="group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
        </Link>
      </div>

      <div className="mt-8 p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-sm">
        <p className="font-semibold text-amber-300 mb-1">Story generator is being rebuilt</p>
        <p className="text-amber-300/70 leading-relaxed">
          The story video flow (template picker, live progress, etc.) still uses the legacy interface.
          The AI Ad wizard is the first feature on the new platform — story generation gets the same treatment next.
        </p>
      </div>
    </div>
  )
}
