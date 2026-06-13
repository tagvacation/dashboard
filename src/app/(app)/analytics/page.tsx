'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Channel {
  id: string
  name: string
  emoji: string
}

interface Analytics {
  channel: { name?: string; subscribers: number; videoCount: number; totalViews: number; thumbnail?: string }
  metrics: { views: number; watchMinutes: number; subscribersGained: number; likes: number; comments: number }
  topVideos: { videoId: string; title: string; thumbnail: string; url: string; views: number; likes: number; publishedAt: string }[]
  analyticsError?: string | null
}

const fmt = (n: number | undefined) => {
  if (n === undefined || n === null) return '–'
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`
  if (n >= 100_000)    return `${(n / 100_000).toFixed(1)}L`
  if (n >= 1000)       return `${(n / 1000).toFixed(1)}K`
  return String(n || 0)
}

export default function AnalyticsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [selected, setSelected] = useState<string>('')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/channels').then(r => r.json()).then(d => {
      setChannels(d.channels || [])
      if (d.channels?.[0]) setSelected(d.channels[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true); setError(''); setData(null)
    fetch(`/api/analytics?channelId=${selected}`).then(async r => {
      const d = await r.json()
      if (!r.ok || d.error) setError(d.error || `HTTP ${r.status}`)
      else setData(d)
      setLoading(false)
    }).catch(e => { setError(e.message); setLoading(false) })
  }, [selected])

  return (
    <div className="px-4 md:px-8 py-8 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-white/40 mt-1.5">YouTube performance per channel</p>
        </div>
        {channels.length > 0 && (
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className="px-3.5 py-2 bg-white/[0.03] border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20">
            {channels.map(c => <option key={c.id} value={c.id} className="bg-black">{c.emoji} {c.name}</option>)}
          </select>
        )}
      </div>

      {channels.length === 0 && !loading && (
        <div className="text-center py-16">
          <p className="text-sm text-white/40">No channels yet. <Link href="/profile/channels" className="text-purple-300 hover:text-purple-200">Add one</Link> to see analytics.</p>
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-24 bg-white/[0.03] border border-white/10 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 mb-6">
          <p className="text-sm font-semibold text-red-300 mb-1">Couldn&apos;t load analytics</p>
          <p className="text-xs text-red-300/70">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Channel card */}
          {data.channel && (
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 mb-6 flex items-center gap-4">
              {data.channel.thumbnail ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={data.channel.thumbnail} alt="" className="w-14 h-14 rounded-full border border-white/10" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-xl">▶</div>
              )}
              <div>
                <p className="font-semibold">{data.channel.name}</p>
                <p className="text-xs text-white/50 mt-0.5">
                  {fmt(data.channel.subscribers)} subscribers · {data.channel.videoCount} videos · {fmt(data.channel.totalViews)} total views
                </p>
              </div>
              <a href="https://studio.youtube.com" target="_blank" rel="noreferrer"
                className="ml-auto px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium transition-colors">
                YouTube Studio →
              </a>
            </div>
          )}

          {/* Last 28 days metrics */}
          {data.analyticsError ? (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl px-4 py-3 mb-6">
              <p className="text-sm text-amber-300">⚠ {data.analyticsError}</p>
            </div>
          ) : (
            <div className="mb-8">
              <p className="text-xs text-white/40 mb-2 px-1 uppercase tracking-wider font-semibold">Last 28 days</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Views',         value: fmt(data.metrics.views), color: 'from-blue-500/20' },
                  { label: 'Watch min',     value: fmt(data.metrics.watchMinutes), color: 'from-purple-500/20' },
                  { label: '+ Subs',        value: `+${data.metrics.subscribersGained}`, color: 'from-emerald-500/20' },
                  { label: 'Likes',         value: fmt(data.metrics.likes), color: 'from-pink-500/20' },
                  { label: 'Comments',      value: fmt(data.metrics.comments), color: 'from-amber-500/20' },
                ].map(m => (
                  <div key={m.label} className={`relative bg-white/[0.03] border border-white/10 rounded-2xl p-4 overflow-hidden`}>
                    <div className={`absolute inset-0 bg-gradient-to-br ${m.color} to-transparent opacity-60`} />
                    <div className="relative">
                      <p className="text-2xl font-bold">{m.value}</p>
                      <p className="text-xs text-white/50 mt-0.5">{m.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top videos */}
          {data.topVideos?.length > 0 && (
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Recent videos</h3>
                <span className="text-xs text-white/30">{data.topVideos.length} videos</span>
              </div>
              <div className="divide-y divide-white/5">
                {data.topVideos.map((v, i) => (
                  <a key={v.videoId} href={v.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                    <span className="text-xs font-bold text-white/30 w-5 shrink-0">{i + 1}</span>
                    {v.thumbnail ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={v.thumbnail} alt="" className="w-14 h-10 rounded-lg object-cover shrink-0 border border-white/10" />
                    ) : (
                      <div className="w-14 h-10 rounded-lg bg-white/5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/90 truncate">{v.title}</p>
                      {v.publishedAt && (
                        <p className="text-xs text-white/40 mt-0.5">
                          {new Date(v.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold text-white/90">{fmt(v.views)}</p>
                      <p className="text-xs text-white/40">{fmt(v.likes)} likes</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
