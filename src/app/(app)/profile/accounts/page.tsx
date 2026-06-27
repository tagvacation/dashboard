'use client'
import { useEffect, useState } from 'react'

interface Cred {
  id: string
  name: string
  project_id: string
  bucket: string
  is_active: boolean
  created_at: string
}

export default function AccountsPage() {
  const [creds, setCreds] = useState<Cred[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [form, setForm] = useState({ id: '', name: '', project_id: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const r = await fetch('/api/credentials').then(r => r.json())
      setCreds(r.credentials || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const handleJsonPaste = (text: string) => {
    setJsonText(text); setError('')
    try {
      const parsed = JSON.parse(text)
      if (parsed.type !== 'service_account') return
      setForm(f => ({
        ...f,
        project_id: parsed.project_id || f.project_id,
        id: f.id || `account_${(parsed.project_id || '').slice(0, 10)}`,
        name: f.name || parsed.project_id || '',
      }))
    } catch { /* not yet valid JSON */ }
  }

  const save = async () => {
    if (!jsonText.trim()) { setError('Paste your service account JSON first'); return }
    if (!form.name || !form.project_id) { setError('Name and project_id are required'); return }
    try { JSON.parse(jsonText) } catch { setError('Invalid JSON'); return }

    setSaving(true); setError('')
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, sa_json: jsonText }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }
    await load()
    setForm({ id: '', name: '', project_id: '' })
    setJsonText('')
    setShowForm(false)
    setSaving(false)
  }

  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return
    await fetch('/api/credentials', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Cloud Accounts</h2>
          <p className="text-sm text-white/40 mt-1">Connect multiple Google Cloud projects for more Veo capacity</p>
        </div>
        {!showForm && creds.length > 0 && (
          <button onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-white hover:bg-white/90 text-black rounded-lg text-sm font-semibold transition-colors whitespace-nowrap">
            + Add Account
          </button>
        )}
      </div>

      {/* Setup explainer */}
      <div className="relative bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-5 overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-purple-500/20 rounded-full blur-2xl" />
        <div className="relative flex items-start gap-3">
          <div className="text-2xl shrink-0">💡</div>
          <div className="text-sm">
            <p className="font-semibold mb-1">How Cloud Accounts work</p>
            <p className="text-white/60 leading-relaxed">
              Each account is one Google Cloud project with Veo + TTS + Gemini enabled.
              Generation compute is charged to YOUR Google account (use the free $300 trial).
              You can add multiple accounts to alternate between them when quotas reset.
            </p>
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-purple-300 hover:text-purple-200 text-xs font-medium mt-2 transition-colors">
              Open Google Cloud Console
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* Add form */}
      {(showForm || (creds.length === 0 && !loading)) && (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold">Add Google Cloud Account</h3>
            {creds.length > 0 && (
              <button onClick={() => { setShowForm(false); setError(''); setJsonText(''); setForm({ id: '', name: '', project_id: '' }) }}
                className="text-white/40 hover:text-white transition-colors text-sm">✕</button>
            )}
          </div>

          <div className="space-y-4">
            {/* JSON paste */}
            <div>
              <label className="text-xs font-semibold text-white/70 block mb-2">
                Service Account JSON
                <span className="text-white/40 font-normal ml-1">— from GCP → IAM → Service Accounts → Keys</span>
              </label>
              <textarea value={jsonText} onChange={e => handleJsonPaste(e.target.value)}
                rows={6} spellCheck={false}
                placeholder={'{\n  "type": "service_account",\n  "project_id": "your-project",\n  "private_key": "-----BEGIN PRIVATE KEY-----",\n  ...\n}'}
                className="w-full px-3 py-2.5 text-xs font-mono bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 resize-none leading-relaxed" />
              {jsonText && (() => { try { JSON.parse(jsonText); return <p className="text-xs text-green-400 mt-1.5">✓ Valid JSON detected</p> } catch { return <p className="text-xs text-red-400 mt-1.5">Invalid JSON</p> } })()}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1.5">Display name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., My Personal Account"
                  className="w-full px-3 py-2 text-sm bg-black/40 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1.5">Project ID</label>
                <input value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                  placeholder="my-project-12345"
                  className="w-full px-3 py-2 text-sm font-mono bg-black/40 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
              </div>
            </div>
            <p className="text-xs text-white/40">
              Just the service-account JSON — no bucket needed. Your account is used only for Veo/Imagen compute; storage is handled by the platform.
            </p>

            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}

            <button onClick={save} disabled={saving}
              className="w-full py-2.5 bg-white hover:bg-white/90 disabled:opacity-40 text-black rounded-xl text-sm font-semibold transition-colors">
              {saving ? 'Saving...' : '+ Add Account'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {!loading && creds.length > 0 && (
        <div className="space-y-2">
          {creds.map(c => (
            <div key={c.id} className="group relative bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 hover:border-white/20 rounded-2xl p-4 transition-all">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-xl shrink-0">☁</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{c.name}</p>
                    {c.is_active && <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full font-medium">Active</span>}
                  </div>
                  <p className="text-xs text-white/40 mt-0.5 font-mono">{c.project_id}</p>
                </div>
                <button onClick={() => remove(c.id, c.name)}
                  className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 text-xs font-medium transition-all">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="text-center py-12 text-white/30 text-sm">Loading accounts...</div>}
    </div>
  )
}
