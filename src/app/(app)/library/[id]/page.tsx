'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import { use } from 'react'

interface Clip { name: string; url: string }
interface Story {
  story_id: string
  topic: string
  status: string
  theme: string
  notes: string
  created_at: string
  audio_url: string
  youtube_link: string
  final_url?: string
  hasAudio: boolean
  scenes_count?: number
  store_id?: string
  product_url?: string
  variant_id?: string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  clips_ready:   { label: 'Clips ready',       color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  post_produced: { label: 'Reel ready',        color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  published:     { label: 'Live on YouTube',   color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  generating:    { label: 'Generating',        color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  failed:        { label: 'Failed',            color: 'bg-red-500/20 text-red-300 border-red-500/30' },
}

const POLL_STATUSES = new Set(['init','topic','script','audio','veo_submit','veo_poll','generating'])

const GEN_STEPS = ['Concept', 'Script', 'Assets', 'Scenes', 'Compose']
function genStep(runStatus: string, storyStatus: string, log: string[]): number {
  if (storyStatus === 'post_produced' || runStatus === 'complete') return 5
  if (storyStatus === 'clips_ready' || log.some(l => /Composit/i.test(l))) return 4
  if (runStatus === 'veo_submit') return 3
  if (runStatus === 'audio') return 2
  if (runStatus === 'script') return 1
  return 0
}

export default function StoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [story, setStory] = useState<Story | null>(null)
  const [loading, setLoading] = useState(true)
  const [run, setRun] = useState<{ status: string; log: string[] } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Lazy clips — only fetched (and only downloaded) when the user opens the section.
  const [clips, setClips] = useState<Clip[] | null>(null)
  const [clipsOpen, setClipsOpen] = useState(false)
  const [clipsLoading, setClipsLoading] = useState(false)
  const [playing, setPlaying] = useState<Set<string>>(new Set())
  const [lazyAudio, setLazyAudio] = useState('')

  // Shoppable settings (product link + store) + size optimizer
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])
  const [prodUrl, setProdUrl] = useState('')
  const [storeSel, setStoreSel] = useState('')
  const [settingsInit, setSettingsInit] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState('')
  const [reducing, setReducing] = useState(false)
  const [reduceMsg, setReduceMsg] = useState('')
  const [reduceWidth, setReduceWidth] = useState(540)
  const [webUrl, setWebUrl] = useState('')

  useEffect(() => { fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || [])).catch(() => {}) }, [])
  useEffect(() => {
    if (story && !settingsInit) { setProdUrl(story.product_url || ''); setStoreSel(story.store_id || ''); setSettingsInit(true) }
  }, [story, settingsInit])

  const loadClips = useCallback(async () => {
    setClipsOpen(true)
    if (clips || clipsLoading) return
    setClipsLoading(true)
    try {
      const d = await fetch(`/api/stories/${id}/clips`).then(r => r.json())
      setClips(Array.isArray(d.clips) ? d.clips : [])
      if (d.audio_url) setLazyAudio(d.audio_url)
    } catch { setClips([]) }
    finally { setClipsLoading(false) }
  }, [id, clips, clipsLoading])

  async function deleteStory() {
    if (!confirm('Delete this video permanently? This removes the reel, all clips and audio. This cannot be undone.')) return
    setDeleting(true)
    try {
      const r = await fetch(`/api/stories/${id}`, { method: 'DELETE' })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Delete failed') }
      router.push('/library')
    } catch (e) { alert(e instanceof Error ? e.message : 'Delete failed'); setDeleting(false) }
  }

  async function saveSettings() {
    setSavingSettings(true); setSettingsMsg('')
    try {
      const r = await fetch(`/api/stories/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_url: prodUrl.trim(), store_id: storeSel }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setSettingsMsg(d.variant_id ? 'Saved · add-to-cart ready ✓' : 'Saved ✓')
    } catch (e) { setSettingsMsg(e instanceof Error ? e.message : 'Save failed') }
    finally { setSavingSettings(false) }
  }

  async function reduceSize() {
    setReducing(true); setReduceMsg('')
    try {
      const r = await fetch(`/api/stories/${id}/reduce`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width: reduceWidth }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Reduce failed')
      setReduceMsg(`Web version ready: ${d.size_mb} MB ✓`)
      if (d.url) setWebUrl(d.url)
    } catch (e) { setReduceMsg(e instanceof Error ? e.message : 'Reduce failed') }
    finally { setReducing(false) }
  }

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const [sRes, pRes] = await Promise.all([
          fetch(`/api/stories/${id}`).then(r => r.json()),
          fetch(`/api/pipeline/${id}`).then(r => r.ok ? r.json() : null).catch(() => null),
        ])
        if (cancelled) return
        const s = sRes.story || null
        setStory(s)
        if (pRes) setRun({ status: pRes.status || '', log: Array.isArray(pRes.log) ? pRes.log : [] })
        setLoading(false)
        if (s && POLL_STATUSES.has(s.status)) timer = setTimeout(tick, 4000)
      } catch { if (!cancelled) setLoading(false) }
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [id])

  if (loading) return (
    <div className="px-4 md:px-8 py-8 max-w-5xl mx-auto">
      <div className="h-4 w-24 bg-white/[0.05] rounded animate-pulse mb-6" />
      <div className="h-6 w-24 bg-white/[0.05] rounded-full animate-pulse mb-3" />
      <div className="h-7 w-2/3 bg-white/[0.05] rounded animate-pulse mb-2" />
      <div className="h-3 w-1/3 bg-white/[0.05] rounded animate-pulse mb-8" />
      <div className="aspect-[9/16] max-w-sm mx-auto bg-white/[0.03] border border-white/10 rounded-2xl animate-pulse" />
    </div>
  )

  if (!story) return (
    <div className="px-4 md:px-8 py-8 max-w-3xl mx-auto text-center py-20">
      <p className="text-lg font-semibold">Story not found</p>
      <p className="text-sm text-white/40 mt-1">It may have been deleted or you don&apos;t have access</p>
      <Link href="/library" className="inline-block mt-6 px-4 py-2 bg-white text-black rounded-xl text-sm font-semibold">← Back to library</Link>
    </div>
  )

  const status = STATUS_LABEL[story.status]
  const audioUrl = story.audio_url || lazyAudio
  const isAd = story.theme === 'ai_ad'
  const clipCount = clips ? clips.length : (story.scenes_count || 0)

  return (
    <div className="px-4 md:px-8 py-8 max-w-5xl mx-auto">
      <Link href="/library" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors mb-4">← Library</Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {status && <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${status.color}`}>{status.label}</span>}
            {isAd && <span className="text-xs px-2 py-0.5 bg-pink-500/20 text-pink-300 border border-pink-500/30 rounded-full font-medium">🎤 AI Ad</span>}
            {story.youtube_link && (
              <a href={story.youtube_link} target="_blank" rel="noreferrer"
                className="text-xs px-2 py-0.5 bg-red-500/20 text-red-300 border border-red-500/30 rounded-full font-medium hover:bg-red-500/30 transition-colors">▶ Live on YouTube</a>
            )}
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight leading-snug">{story.topic}</h1>
          <p className="text-xs text-white/30 font-mono mt-2">{story.story_id}</p>
        </div>
        <button onClick={deleteStory} disabled={deleting}
          className="shrink-0 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40">
          {deleting ? 'Deleting…' : '🗑 Delete'}
        </button>
      </div>

      {story.notes && (
        <div className="my-4 px-3.5 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300">⚠ {story.notes}</div>
      )}

      {/* Final reel — primary view */}
      {story.final_url ? (
        <div className="mt-6 mb-8 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-purple-500/20 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-purple-200">✨ Final reel (clips + audio merged)</p>
              <p className="text-xs text-white/50 mt-0.5">Ready to publish or share</p>
            </div>
            <div className="flex gap-2">
              <a href={story.final_url} download className="px-3 py-1.5 bg-white text-black rounded-lg text-xs font-semibold hover:bg-white/90 transition-colors">⬇ Master MP4</a>
              <a href={webUrl || story.final_url.replace('/reel.mp4', '/reel_preview.mp4')} download
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition-colors" title="Small web/slider version (with audio)">⬇ Web version</a>
            </div>
          </div>
          <div className="p-5 flex justify-center bg-black/40">
            <video src={story.final_url} controls preload="metadata" className="rounded-xl max-h-[70vh] aspect-[9/16] bg-black" />
          </div>
        </div>
      ) : story.status === 'failed' ? (
        <div className="mt-6 mb-8 p-5 bg-red-500/10 border border-red-500/20 rounded-2xl text-sm">
          <p className="font-semibold text-red-300 mb-1">Generation failed</p>
          <p className="text-red-300/70">{story.notes || 'Something went wrong. Check the log below or try regenerating.'}</p>
        </div>
      ) : (() => {
        const step = genStep(run?.status || '', story.status, run?.log || [])
        const pct = Math.min(100, Math.round((step / GEN_STEPS.length) * 100))
        const recent = (run?.log || []).slice(-4)
        return (
          <div className="mt-6 mb-8 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="animate-spin w-4 h-4 text-purple-300" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm font-bold text-purple-100">Generating your video…</p>
              <span className="ml-auto text-xs text-white/50">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between mb-4">
              {GEN_STEPS.map((label, i) => (
                <div key={label} className="flex flex-col items-center gap-1 flex-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border
                    ${i < step ? 'bg-purple-500 border-purple-500 text-white' : i === step ? 'border-purple-400 text-purple-300 animate-pulse' : 'border-white/15 text-white/30'}`}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span className={`text-[10px] ${i <= step ? 'text-white/70' : 'text-white/30'}`}>{label}</span>
                </div>
              ))}
            </div>
            {recent.length > 0 && (
              <div className="bg-black/40 rounded-lg p-3 font-mono text-[11px] text-white/50 space-y-0.5 max-h-28 overflow-hidden">
                {recent.map((l, i) => <div key={i} className="truncate">{String(l).replace(/^\[[^\]]+\]\s*/, '')}</div>)}
              </div>
            )}
            <p className="text-xs text-white/30 mt-3">Auto-refreshing every 4s — you can leave this page; generation continues.</p>
          </div>
        )
      })()}

      {/* Shoppable settings */}
      {isAd && (
        <div className="mb-8 bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          <p className="text-sm font-semibold mb-1">🛍 Shoppable settings</p>
          <p className="text-xs text-white/40 mb-4">Link this video to a product + store (for the slider feed + Shopify add-to-cart), and optimize its size for the web.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">Product URL</label>
              <input value={prodUrl} onChange={e => setProdUrl(e.target.value)} placeholder="https://store.com/products/..."
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm placeholder-white/30 focus:outline-none focus:border-purple-400" />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Store</label>
              <select value={storeSel} onChange={e => setStoreSel(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-purple-400">
                <option value="" className="bg-black">None</option>
                {stores.map(s => <option key={s.id} value={s.id} className="bg-black">{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button onClick={saveSettings} disabled={savingSettings}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-lg text-sm font-semibold">{savingSettings ? 'Saving…' : 'Save settings'}</button>
            {settingsMsg && <span className="text-xs text-white/60">{settingsMsg}</span>}
            <div className="ml-auto flex items-center gap-2">
              {reduceMsg && <span className="text-xs text-white/60">{reduceMsg}</span>}
              <select value={reduceWidth} onChange={e => setReduceWidth(Number(e.target.value))}
                className="px-2 py-2 bg-black/40 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-purple-400">
                <option value={480} className="bg-black">Small · 480p (~3MB)</option>
                <option value={540} className="bg-black">Medium · 540p (~5MB)</option>
                <option value={720} className="bg-black">Large · 720p (~8MB)</option>
              </select>
              <button onClick={reduceSize} disabled={reducing || !story.final_url}
                className="px-4 py-2 bg-white/10 hover:bg-white/15 disabled:opacity-40 rounded-lg text-sm font-semibold whitespace-nowrap"
                title={story.final_url ? 'Re-encode a smaller web/slider version' : 'No final reel yet'}>{reducing ? 'Optimizing…' : '⤓ Reduce size'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Narration audio */}
      {audioUrl && (
        <div className="mb-8 bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">🎙 Narration audio</p>
            <a href={audioUrl} download className="text-xs text-white/50 hover:text-white transition-colors">⬇ Download</a>
          </div>
          <audio src={audioUrl} controls preload="none" className="w-full" />
        </div>
      )}

      {/* Individual clips — collapsed; loaded + downloaded only on demand */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white/70">Individual clips{clipCount ? ` (${clipCount})` : ''}</h2>
          {!clipsOpen && clipCount > 0 && (
            <button onClick={loadClips} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium">Show clips</button>
          )}
          {clipsOpen && (
            <button onClick={() => setClipsOpen(false)} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium">Hide</button>
          )}
        </div>

        {!clipsOpen ? (
          <p className="text-xs text-white/30">{clipCount > 0 ? 'Hidden to keep this page fast — click “Show clips” to load them. Each scene downloads only when you play it.' : 'No clips yet.'}</p>
        ) : clipsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: Math.max(4, Math.min(clipCount || 4, 8)) }).map((_, i) => (
              <div key={i} className="aspect-[9/16] bg-white/[0.03] border border-white/10 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : clips && clips.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {clips.map((clip, i) => {
              const isPlaying = playing.has(clip.name)
              return (
                <div key={clip.name} className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
                  {isPlaying ? (
                    <video src={clip.url} controls autoPlay className="w-full aspect-[9/16] bg-black object-cover" />
                  ) : (
                    <button onClick={() => setPlaying(prev => new Set(prev).add(clip.name))}
                      className="group relative w-full aspect-[9/16] bg-black flex items-center justify-center">
                      <span className="w-12 h-12 rounded-full bg-white/15 group-hover:bg-white/25 backdrop-blur flex items-center justify-center text-xl transition-colors">▶</span>
                      <span className="absolute bottom-2 left-2 text-[11px] text-white/60 font-medium">Tap to play</span>
                    </button>
                  )}
                  <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="text-white/60 font-medium">Scene {String(i + 1).padStart(2, '0')}</span>
                    <a href={clip.url} download className="text-white/40 hover:text-white transition-colors">⬇</a>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-white/30 text-sm">No clips found</div>
        )}
      </div>

      {/* Advanced actions footer */}
      <div className="mt-12 pt-6 border-t border-white/5 flex flex-wrap gap-3 items-center justify-between">
        <p className="text-xs text-white/30">Need scene history, publish UI, or scheduled posting?</p>
        <Link href={`/legacy-dashboard?tab=stories&story=${story.story_id}`} className="text-xs text-white/50 hover:text-white transition-colors">↗ Open in advanced view</Link>
      </div>
    </div>
  )
}
