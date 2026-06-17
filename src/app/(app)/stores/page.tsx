'use client'
import { useEffect, useState, useCallback } from 'react'

interface Store { id: string; name: string; domain: string; platform: string }
interface Feed { text: string; count: number }

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([])
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [feeds, setFeeds] = useState<Record<string, Feed>>({})
  const [open, setOpen] = useState('')
  const [loadingStores, setLoadingStores] = useState(true)

  // Fetch a store's feed once and cache it, so "Copy" is instant (no slow fetch
  // between the click and the clipboard write — that race caused stale copies).
  const fetchFeed = useCallback(async (id: string): Promise<Feed | null> => {
    try {
      const feed = await fetch(`/api/stores/${id}/feed`, { cache: 'no-store' }).then(r => r.json())
      const f: Feed = { text: JSON.stringify(feed, null, 2), count: Array.isArray(feed) ? feed.length : 0 }
      setFeeds(prev => ({ ...prev, [id]: f }))
      return f
    } catch { return null }
  }, [])

  const load = useCallback(() => {
    fetch('/api/stores').then(r => r.json()).then(d => {
      const list: Store[] = d.stores || []
      setStores(list)
      list.forEach(s => fetchFeed(s.id)) // warm the cache in the background
    }).catch(() => {}).finally(() => setLoadingStores(false))
  }, [fetchFeed])
  useEffect(() => { load() }, [load])

  async function createStore() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await fetch('/api/stores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain, platform: 'shopify' }),
      })
      setName(''); setDomain(''); load()
    } finally { setBusy(false) }
  }

  // Copy synchronously from cached text when possible; execCommand fallback if the
  // async clipboard API is blocked (which silently leaves the previous clipboard value).
  async function copyText(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      const ok = document.execCommand('copy'); ta.remove(); return ok
    } catch { return false }
  }

  async function copyFeed(id: string) {
    // Always copy the freshest cached value; refetch only if we don't have it yet.
    const f = feeds[id] || await fetchFeed(id)
    if (!f) return
    const ok = await copyText(f.text)
    if (ok) { setCopied(id); setTimeout(() => setCopied(''), 1500) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Stores</h1>
      <p className="text-sm text-white/40 mt-1.5">Group product videos into a storefront, then copy its JSON feed into the shoppable-slider extension.</p>

      {/* Create */}
      <div className="mt-6 bg-white/[0.03] border border-white/10 rounded-2xl p-5">
        <p className="text-sm font-semibold mb-3">Add a store</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Store name (e.g. The Derma Co)"
            className="flex-1 px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm placeholder-white/30 focus:outline-none focus:border-purple-400" />
          <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="domain (thedermaco.com)"
            className="flex-1 px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm placeholder-white/30 focus:outline-none focus:border-purple-400" />
          <button onClick={createStore} disabled={busy || !name.trim()}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-xl text-sm font-semibold">Add</button>
        </div>
      </div>

      {/* List */}
      <div className="mt-5 space-y-3">
        {loadingStores && (
          <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-20 bg-white/[0.03] border border-white/10 rounded-2xl animate-pulse" />)}</div>
        )}
        {!loadingStores && stores.length === 0 && <p className="text-sm text-white/30">No stores yet — add one above.</p>}
        {stores.map(s => {
          const f = feeds[s.id]
          return (
            <div key={s.id} className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{s.name}</p>
                  <p className="text-xs text-white/40 truncate">
                    {s.domain || 'no domain'} · {s.platform}
                    {f ? ` · ${f.count} video${f.count === 1 ? '' : 's'}` : ' · loading feed…'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setOpen(open === s.id ? '' : s.id)}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium whitespace-nowrap">
                    {open === s.id ? 'Hide' : 'View'}
                  </button>
                  <button onClick={() => copyFeed(s.id)} disabled={!f}
                    className="px-3.5 py-2 bg-white/10 hover:bg-white/15 disabled:opacity-40 rounded-lg text-sm font-medium whitespace-nowrap">
                    {copied === s.id ? 'Copied ✓' : 'Copy JSON feed'}
                  </button>
                </div>
              </div>
              {open === s.id && (
                <textarea readOnly value={f?.text || 'Loading…'}
                  onFocus={e => e.currentTarget.select()}
                  className="mt-3 w-full h-44 px-3 py-2 bg-black/50 border border-white/10 rounded-xl text-xs font-mono text-white/70 resize-y focus:outline-none focus:border-purple-400" />
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-white/30 mt-6">
        Tip: when generating an ad, pick the store and import the product by URL so the feed includes the product link + add-to-cart variant.
      </p>
    </div>
  )
}
