'use client'
import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'

interface Story {
  story_id: string
  topic: string
  status: string
  theme: string
  category_id?: string
  created_at: string
  youtube_link?: string
  scenes_count?: number
  store_id?: string
  final_url?: string
  hasAudio: boolean
}
interface Store { id: string; name: string }

const STATUS_LABEL: Record<string, { label: string; color: string; bar: string }> = {
  clips_ready:   { label: 'Ready to merge',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', bar: 'bg-emerald-400' },
  post_produced: { label: 'Ready to publish', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',           bar: 'bg-blue-400' },
  published:     { label: 'Live',             color: 'bg-violet-500/20 text-violet-300 border-violet-500/30',     bar: 'bg-violet-400' },
  generating:    { label: 'Generating',       color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',       bar: 'bg-amber-400' },
  failed:        { label: 'Failed',           color: 'bg-red-500/20 text-red-300 border-red-500/30',             bar: 'bg-red-400' },
}
const GENERATING = new Set(['queued', 'claimed', 'generating', 'init', 'topic', 'script', 'audio', 'veo_submit', 'veo_poll'])

export default function LibraryPage() {
  const [stories, setStories] = useState<Story[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')      // all | stories | ads
  const [storeFilter, setStoreFilter] = useState('all')    // all | <store id> | none
  const [search, setSearch] = useState('')
  const storeFilterRef = useRef(storeFilter)
  storeFilterRef.current = storeFilter

  useEffect(() => { fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || [])).catch(() => {}) }, [])

  // Load + auto-refresh while anything is still generating. Re-runs when the store filter changes.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const sf = storeFilterRef.current
        const qs = sf !== 'all' && sf !== 'none' ? `?store=${encodeURIComponent(sf)}` : ''
        const d = await fetch(`/api/stories${qs}`).then(r => r.json())
        if (cancelled) return
        setStories(d.stories || [])
        setLoading(false)
        if ((d.stories || []).some((s: Story) => GENERATING.has(s.status))) timer = setTimeout(tick, 5000)
      } catch { if (!cancelled) setLoading(false) }
    }
    setLoading(true)
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [storeFilter])

  const storeName = (id?: string) => stores.find(s => s.id === id)?.name
  const filtered = stories
    .filter(s => filter === 'all' || (filter === 'ads' ? s.theme === 'ai_ad' : s.theme !== 'ai_ad'))
    .filter(s => storeFilter !== 'none' || !s.store_id)   // "No store" handled client-side
    .filter(s => !search || s.topic.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="px-4 md:px-8 py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-sm text-white/40 mt-1">All your generated stories and ads</p>
        </div>
        <div className="flex gap-2">
          <Link href="/ads" className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg">🎤 New Ad</Link>
          <Link href="/generate" className="px-4 py-2 bg-white hover:bg-white/90 text-black rounded-xl text-sm font-semibold transition-colors">✦ New Story</Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="flex bg-white/[0.03] border border-white/10 rounded-xl p-1">
          {[
            { id: 'all',     label: `All (${stories.length})` },
            { id: 'stories', label: 'Stories' },
            { id: 'ads',     label: 'AI Ads' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f.id ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Store filter */}
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
          className="px-3 py-2 bg-white/[0.03] border border-white/10 rounded-xl text-xs font-medium text-white/80 focus:outline-none focus:border-purple-400">
          <option value="all" className="bg-black">🛍 All stores</option>
          {stores.map(s => <option key={s.id} value={s.id} className="bg-black">{s.name}</option>)}
          <option value="none" className="bg-black">— No store</option>
        </select>

        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by topic..."
            className="w-full px-3.5 py-2 bg-white/[0.03] border border-white/10 rounded-xl text-sm placeholder-white/30 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-white/[0.03] border border-white/10 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-3xl mx-auto mb-4">📹</div>
          <p className="text-sm font-semibold">No videos match</p>
          <p className="text-xs text-white/40 mt-1">Try a different filter or search term</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(story => {
            const status = STATUS_LABEL[story.status]
            const isAd = story.theme === 'ai_ad'
            const sName = storeName(story.store_id)
            return (
              <Link key={story.story_id} href={`/library/${story.story_id}`}
                className="group bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 hover:border-white/20 rounded-2xl p-4 transition-all">
                <div className="flex items-start gap-3">
                  <div className={`w-1 self-stretch min-h-[40px] rounded-full ${status?.bar || 'bg-white/20'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/90 line-clamp-2 leading-snug font-medium">{story.topic}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {status && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium border ${status.color}`}>{status.label}</span>}
                      {isAd && <span className="text-xs px-1.5 py-0.5 bg-pink-500/20 text-pink-300 border border-pink-500/30 rounded-full font-medium">🎤 Ad</span>}
                      {sName && <span className="text-xs px-1.5 py-0.5 bg-white/5 text-white/60 border border-white/10 rounded-full font-medium">🛍 {sName}</span>}
                      <span className="text-xs text-white/30">{story.scenes_count || 0} clips</span>
                      {story.youtube_link && <span className="text-xs text-red-400 font-medium">▶ Live</span>}
                      <span className="text-xs text-white/30 ml-auto">{new Date(story.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
