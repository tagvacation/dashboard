'use client'
import { useEffect, useState } from 'react'

interface Channel {
  id: string
  name: string
  emoji: string
  gcs_bucket?: string
  sheet_id?: string
  yt_refresh_token?: string
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', emoji: '📺', sheet_id: '', sheet_tab: 'Sheet2', gcs_bucket: 'ai_clip_007' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const r = await fetch('/api/channels').then(r => r.json())
      setChannels(r.channels || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!form.id || !form.name || !form.sheet_id || !form.gcs_bucket) { setError('All fields required'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }
    await load(); setShowForm(false); setSaving(false)
    setForm({ id: '', name: '', emoji: '📺', sheet_id: '', sheet_tab: 'Sheet2', gcs_bucket: 'ai_clip_007' })
  }

  const remove = async (id: string, name: string) => {
    if (!confirm(`Deactivate "${name}"?`)) return
    await fetch(`/api/channels/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">YouTube Channels</h2>
          <p className="text-sm text-white/40 mt-1">Connect channels for direct publishing and analytics</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-white hover:bg-white/90 text-black rounded-lg text-sm font-semibold transition-colors whitespace-nowrap">
            + Add Channel
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold">Add YouTube Channel</h3>
            <button onClick={() => { setShowForm(false); setError('') }}
              className="text-white/40 hover:text-white transition-colors text-sm">✕</button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1.5">Channel ID (slug)</label>
                <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                  placeholder="kissopedia"
                  className="w-full px-3 py-2 text-sm font-mono bg-black/40 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1.5">Display name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Kissopedia"
                  className="w-full px-3 py-2 text-sm bg-black/40 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1.5">Emoji</label>
                <input value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))}
                  maxLength={4}
                  className="w-full px-3 py-2 text-sm bg-black/40 border border-white/10 rounded-lg text-white text-center focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1.5">Google Sheet ID</label>
                <input value={form.sheet_id} onChange={e => setForm(f => ({ ...f, sheet_id: e.target.value }))}
                  placeholder="1ABC...xyz"
                  className="w-full px-3 py-2 text-sm font-mono bg-black/40 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1.5">GCS Bucket</label>
                <input value={form.gcs_bucket} onChange={e => setForm(f => ({ ...f, gcs_bucket: e.target.value }))}
                  className="w-full px-3 py-2 text-sm font-mono bg-black/40 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2 text-xs text-blue-300">
              ℹ After creating, click <strong>Connect YT</strong> on the channel to authorize OAuth for upload + analytics.
            </div>

            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}

            <button onClick={save} disabled={saving}
              className="w-full py-2.5 bg-white hover:bg-white/90 disabled:opacity-40 text-black rounded-xl text-sm font-semibold transition-colors">
              {saving ? 'Creating...' : '+ Create Channel'}
            </button>
          </div>
        </div>
      )}

      {!loading && channels.length === 0 && !showForm && (
        <div className="text-center py-16 text-white/30 text-sm">
          No channels yet. Add one to publish your videos directly.
        </div>
      )}

      {!loading && channels.length > 0 && (
        <div className="space-y-2">
          {channels.map(ch => {
            const connected = !!ch.yt_refresh_token
            return (
              <div key={ch.id} className="group bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 hover:border-white/20 rounded-2xl p-4 transition-all">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-xl shrink-0">{ch.emoji || '📺'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{ch.name}</p>
                      <span className="text-xs font-mono text-white/40">{ch.id}</span>
                      {connected ? (
                        <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full font-medium">✓ Connected</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full font-medium">⚠ Not connected</span>
                      )}
                    </div>
                    {ch.gcs_bucket && <p className="text-xs text-white/40 mt-0.5 font-mono">Bucket: {ch.gcs_bucket}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={`/api/auth/youtube?channelId=${ch.id}`}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                        ${connected ? 'bg-white/5 hover:bg-white/10 text-white/70' : 'bg-red-500/20 hover:bg-red-500/30 text-red-300'}`}>
                      {connected ? '↻ Re-auth' : 'Connect YT →'}
                    </a>
                    <button onClick={() => remove(ch.id, ch.name)}
                      className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 text-xs transition-all">
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {loading && <div className="text-center py-12 text-white/30 text-sm">Loading channels...</div>}
    </div>
  )
}
