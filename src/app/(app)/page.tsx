'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

interface Stats {
  totalStories: number
  totalAds: number
  totalPublished: number
  joinedDays: number
}

interface RecentStory {
  story_id: string
  topic: string
  status: string
  theme: string
  created_at: string
  youtube_link?: string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  clips_ready:   { label: 'Ready to merge',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  post_produced: { label: 'Ready to publish', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  published:     { label: 'Live',             color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  generating:    { label: 'Generating',       color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  failed:        { label: 'Failed',           color: 'bg-red-500/20 text-red-300 border-red-500/30' },
}

export default function HomePage() {
  const { data: session } = useSession()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<RecentStory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/profile/stats').then(r => r.json()).catch(() => null),
      fetch('/api/stories').then(r => r.json()).catch(() => ({ stories: [] })),
    ]).then(([s, r]) => {
      setStats(s)
      setRecent((r.stories || []).slice(0, 5))
      setLoading(false)
    })
  }, [])

  const firstName = session?.user?.name?.split(' ')[0] || 'there'

  return (
    <div className="px-4 md:px-8 py-8 max-w-6xl mx-auto">
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Welcome back, <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">{firstName}</span>
        </h1>
        <p className="text-sm text-white/40 mt-1.5">Here&apos;s what&apos;s happening on your AI Studio</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Stories generated', value: stats?.totalStories, color: 'from-purple-500/20' },
          { label: 'AI ads created',    value: stats?.totalAds,     color: 'from-pink-500/20' },
          { label: 'Published to YT',   value: stats?.totalPublished, color: 'from-orange-500/20' },
          { label: 'Days as member',    value: stats?.joinedDays,   color: 'from-blue-500/20' },
        ].map(s => (
          <div key={s.label} className="relative bg-white/[0.03] border border-white/10 rounded-2xl p-5 overflow-hidden">
            <div className={`absolute inset-0 bg-gradient-to-br ${s.color} to-transparent opacity-60`} />
            <div className="relative">
              <p className="text-3xl font-bold">{loading ? '…' : (s.value ?? '–')}</p>
              <p className="text-xs text-white/50 mt-1">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Two-column: Quick actions + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick actions */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-semibold text-white/70 mb-3 px-1">Quick start</h2>
          <div className="space-y-2">
            {[
              { href: '/ads',          emoji: '🎤', title: 'Create AI Ad',     desc: 'Talking product ad with image',     gradient: 'from-pink-500/20 to-purple-500/20' },
              { href: '/generate',     emoji: '✦', title: 'Generate Story',    desc: 'Veggie Drama, Halku, Moral...',     gradient: 'from-purple-500/20 to-blue-500/20' },
              { href: '/library',      emoji: '▤', title: 'Open Library',      desc: 'View all stories and ads',           gradient: 'from-blue-500/20 to-cyan-500/20' },
              { href: '/profile/accounts', emoji: '☁', title: 'Add Cloud Account', desc: 'Connect another GCP for more capacity', gradient: 'from-orange-500/20 to-pink-500/20' },
            ].map(a => (
              <Link key={a.href} href={a.href}
                className="group relative block p-4 bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 hover:border-white/20 rounded-2xl transition-all overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-br ${a.gradient} to-transparent opacity-0 group-hover:opacity-50 transition-opacity`} />
                <div className="relative flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl shrink-0">{a.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold group-hover:text-white">{a.title}</p>
                    <p className="text-xs text-white/40 mt-0.5">{a.desc}</p>
                  </div>
                  <span className="text-white/30 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all">→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-semibold text-white/70">Recent activity</h2>
            <Link href="/library" className="text-xs text-white/40 hover:text-white transition-colors">View all →</Link>
          </div>

          <div className="bg-white/[0.03] border border-white/10 rounded-2xl divide-y divide-white/5 overflow-hidden">
            {loading ? (
              [1, 2, 3].map(i => (
                <div key={i} className="p-4 animate-pulse">
                  <div className="h-3 bg-white/10 rounded w-3/4 mb-2" />
                  <div className="h-2 bg-white/5 rounded w-1/3" />
                </div>
              ))
            ) : recent.length === 0 ? (
              <div className="p-10 text-center">
                <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-2xl mx-auto mb-3">📹</div>
                <p className="text-sm font-semibold">No stories yet</p>
                <p className="text-xs text-white/40 mt-1">Generate your first story or ad to see it here</p>
              </div>
            ) : recent.map(story => {
              const status = STATUS_LABEL[story.status]
              return (
                <Link key={story.story_id}
                  href={`/legacy-dashboard?tab=stories&story=${story.story_id}`}
                  className="flex items-center gap-3 p-4 hover:bg-white/[0.03] transition-colors">
                  <div className={`w-1.5 h-12 rounded-full ${status ? status.color.split(' ')[0].replace('/20', '') : 'bg-gray-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/90 line-clamp-1">{story.topic}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {status && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium border ${status.color}`}>
                          {status.label}
                        </span>
                      )}
                      <span className="text-xs text-white/30">
                        {new Date(story.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                      {story.youtube_link && (
                        <span className="text-xs text-red-400">▶ Live</span>
                      )}
                    </div>
                  </div>
                  <span className="text-white/20 text-sm">→</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
