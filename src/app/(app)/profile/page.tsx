'use client'
import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'

interface Stats {
  totalStories: number
  totalAds: number
  totalPublished: number
  joinedDays: number
}

export default function ProfilePage() {
  const { data: session } = useSession()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/profile/stats').then(r => r.json()).then(setStats).catch(() => {})
  }, [])

  if (!session?.user) return <div className="text-white/40">Loading...</div>

  const user = session.user
  const planConfig = {
    free:    { label: 'Free',    color: 'bg-gray-500/20 text-gray-300 border-gray-500/30' },
    hobby:   { label: 'Hobby',   color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    pro:     { label: 'Pro',     color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
    agency:  { label: 'Agency',  color: 'bg-gradient-to-r from-purple-500/30 to-pink-500/30 text-white border-purple-500/40' },
  }[user.plan] || { label: user.plan, color: 'bg-white/10 text-white/70 border-white/20' }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Profile</h2>
        <p className="text-sm text-white/40 mt-1">Your identity, plan, and overview</p>
      </div>

      {/* Identity card */}
      <div className="relative bg-white/[0.03] border border-white/10 rounded-2xl p-6 overflow-hidden">
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-gradient-to-br from-purple-500/20 to-pink-500/10 rounded-full blur-3xl" />
        <div className="relative flex items-start gap-5">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="w-20 h-20 rounded-full border border-white/10" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-3xl font-bold">
              {user.name?.[0] || user.email[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-xl font-bold">{user.name || 'Anonymous'}</h3>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${planConfig.color}`}>
                {planConfig.label}
              </span>
              {user.role === 'admin' && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/30">
                  Admin
                </span>
              )}
            </div>
            <p className="text-sm text-white/60 mt-1">{user.email}</p>
            <p className="text-xs text-white/30 mt-3 font-mono">user_id: {user.id.slice(0, 8)}...</p>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total stories', value: stats?.totalStories, color: 'from-purple-500/20' },
          { label: 'AI ads created', value: stats?.totalAds, color: 'from-pink-500/20' },
          { label: 'Published to YT', value: stats?.totalPublished, color: 'from-orange-500/20' },
          { label: 'Days as member', value: stats?.joinedDays, color: 'from-blue-500/20' },
        ].map(s => (
          <div key={s.label} className="relative bg-white/[0.03] border border-white/10 rounded-2xl p-5 overflow-hidden">
            <div className={`absolute inset-0 bg-gradient-to-br ${s.color} to-transparent opacity-50`} />
            <div className="relative">
              <p className="text-3xl font-bold">{s.value ?? '–'}</p>
              <p className="text-xs text-white/40 mt-1">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-white/80 mb-4">Quick actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { href: '/profile/accounts', emoji: '☁', title: 'Add a Cloud Account', desc: 'Connect another Google Cloud project for more Veo capacity' },
            { href: '/profile/channels', emoji: '▶', title: 'Connect YouTube',     desc: 'Link a YouTube channel for direct publishing' },
            { href: '/ads',             emoji: '🎤', title: 'Create AI Ad',       desc: 'Generate a talking-product ad from product image + details' },
            { href: '/',                emoji: '✦', title: 'Open dashboard',      desc: 'Generate stories, view analytics, manage content' },
          ].map(a => (
            <a key={a.title} href={a.href}
              className="group flex items-start gap-3 p-3 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 hover:border-white/10 rounded-xl transition-all">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-lg shrink-0">{a.emoji}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold group-hover:text-purple-300 transition-colors">{a.title}</p>
                <p className="text-xs text-white/40 mt-0.5">{a.desc}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
