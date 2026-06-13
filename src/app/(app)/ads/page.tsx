'use client'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface CloudCred { id: string; name: string; project_id: string; bucket: string }

const CATEGORIES = ['Haircare', 'Skincare', 'Food / Snack', 'Beverage', 'Jewelry', 'Fashion', 'Electronics', 'Home / Kitchen', 'Health / Wellness', 'Other']
const TONES = [
  { id: 'emotional',    label: 'Emotional',    desc: 'Warm, heartfelt — pulls heartstrings' },
  { id: 'funny',        label: 'Funny',        desc: 'Light, playful — makes them smile' },
  { id: 'bold',         label: 'Bold',         desc: 'Confident, direct — energetic claim' },
  { id: 'informative',  label: 'Informative',  desc: 'Cites benefits, evidence-driven' },
  { id: 'warm',         label: 'Warm',         desc: 'Nurturing aunty/dadi vibe' },
]
const DURATIONS = [
  { sec: 15, label: '15s', sub: '2 scenes' },
  { sec: 30, label: '30s', sub: '4 scenes', recommended: true },
  { sec: 60, label: '60s', sub: '8 scenes' },
]

export default function CreateAdPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [price, setPrice] = useState('')
  const [benefits, setBenefits] = useState(['', ''])
  const [audience, setAudience] = useState('')
  const [tone, setTone] = useState('emotional')
  const [duration, setDuration] = useState(30)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [creds, setCreds] = useState<CloudCred[]>([])
  const [credentialId, setCredentialId] = useState<string>('default')

  useEffect(() => {
    fetch('/api/credentials').then(r => r.json()).then(d => {
      setCreds(d.credentials || [])
    }).catch(() => {})
  }, [])

  const onImageSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return setError('Please choose an image file')
    if (file.size > 8 * 1024 * 1024) return setError('Image too large (max 8MB)')
    setError('')
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = e => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files[0]) onImageSelect(e.dataTransfer.files[0])
  }

  const missing: string[] = []
  if (!name.trim()) missing.push('product name')
  if (benefits.filter(b => b.trim()).length < 2) missing.push('at least 2 benefits')
  if (!audience.trim()) missing.push('target audience')
  const isValid = missing.length === 0

  const submit = async () => {
    if (!isValid) { setError('Fill product name, audience, and at least 2 benefits'); return }
    setSubmitting(true); setError('')

    try {
      let imageGcsUri: string | undefined
      if (imageFile) {
        const formData = new FormData()
        formData.append('image', imageFile)
        const upRes = await fetch('/api/ads/upload-image', { method: 'POST', body: formData })
        if (!upRes.ok) {
          const err = await upRes.json().catch(() => ({ error: 'Image upload failed' }))
          throw new Error(err.error || 'Image upload failed')
        }
        imageGcsUri = (await upRes.json()).gcsUri
      }

      const res = await fetch('/api/ads/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), category,
          price: price ? parseFloat(price) : undefined,
          benefits: benefits.filter(b => b.trim()),
          target_audience: audience.trim(),
          tone, duration_sec: duration,
          imageGcsUri,
          credentialId: credentialId === 'default' ? null : credentialId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')

      router.push('/library')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <div className="px-4 md:px-8 py-8 max-w-3xl mx-auto">
      {/* Hero */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-purple-500/20 border border-purple-500/30 rounded-full text-xs font-semibold text-purple-300 mb-3">
          🎤 AI Ad — Talking Product
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Create an AI ad</h1>
        <p className="mt-1.5 text-sm text-white/40">Tell us about your product. We&apos;ll generate a 1st-person Hindi ad in ~10 minutes.</p>
      </div>

      <div className="space-y-5">
        {/* 1. Product details */}
        <FormCard step="01" title="Product details" subtitle="What are you advertising?">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Product name *" hint="e.g., Sundri Hair Oil">
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Type your product name"
                className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm placeholder-white/30 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all" />
            </Field>
            <Field label="Category *">
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all">
                {CATEGORIES.map(c => <option key={c} value={c} className="bg-black">{c}</option>)}
              </select>
            </Field>
            <Field label="Price (₹)" hint="Optional — used in CTA if set">
              <input value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="349"
                className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm placeholder-white/30 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all" />
            </Field>
          </div>
        </FormCard>

        {/* 2. Benefits + audience + tone */}
        <FormCard step="02" title="What does it solve?" subtitle="3-5 key benefits or pain points your product addresses">
          <Field label="Key benefits *" hint="Add 3-5 bullets. The narrator will mention these.">
            <div className="space-y-2">
              {benefits.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-white/30 w-4 text-center">{i + 1}.</span>
                  <input value={b}
                    onChange={e => setBenefits(bs => bs.map((x, idx) => idx === i ? e.target.value : x))}
                    placeholder={i === 0 ? 'Stops hair fall in 4 weeks' : i === 1 ? 'Adds natural shine' : 'Another benefit...'}
                    className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm placeholder-white/30 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all" />
                  {benefits.length > 2 && (
                    <button type="button"
                      onClick={() => setBenefits(bs => bs.filter((_, idx) => idx !== i))}
                      className="p-1.5 text-white/30 hover:text-red-400 transition-colors">✕</button>
                  )}
                </div>
              ))}
              {benefits.length < 5 && (
                <button type="button"
                  onClick={() => setBenefits(bs => [...bs, ''])}
                  className="text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors">
                  + Add benefit
                </button>
              )}
            </div>
          </Field>

          <Field label="Target audience *" hint="Be specific — affects voice + tone">
            <input value={audience} onChange={e => setAudience(e.target.value)}
              placeholder="e.g., Women 25-45, urban, hair-conscious"
              className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm placeholder-white/30 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all" />
          </Field>

          <Field label="Tone">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {TONES.map(t => (
                <button key={t.id} type="button" onClick={() => setTone(t.id)}
                  className={`p-3 rounded-xl border-2 text-left transition-all
                    ${tone === t.id
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                  <p className={`text-sm font-semibold ${tone === t.id ? 'text-purple-300' : 'text-white/80'}`}>{t.label}</p>
                  <p className="text-xs text-white/40 mt-0.5 leading-snug">{t.desc}</p>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Duration">
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map(d => (
                <button key={d.sec} type="button" onClick={() => setDuration(d.sec)}
                  className={`relative p-3 rounded-xl border-2 transition-all text-center
                    ${duration === d.sec
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                  {d.recommended && (
                    <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-purple-600 text-white text-xs font-medium rounded-full">★</span>
                  )}
                  <p className={`text-lg font-bold ${duration === d.sec ? 'text-purple-300' : 'text-white/90'}`}>{d.label}</p>
                  <p className="text-xs text-white/40">{d.sub}</p>
                </button>
              ))}
            </div>
          </Field>
        </FormCard>

        {/* 3. Image upload */}
        <FormCard step="03" title="Product image" subtitle="Upload your real product photo — Veo animates your actual product, not a generic one">
          {!imagePreview ? (
            <div
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
              className="relative border-2 border-dashed border-purple-500/30 hover:border-purple-500/60 rounded-2xl p-8 text-center bg-purple-500/5 hover:bg-purple-500/10 transition-all cursor-pointer">
              <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={e => e.target.files?.[0] && onImageSelect(e.target.files[0])}
                className="absolute inset-0 opacity-0 cursor-pointer" />
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center text-2xl">📸</div>
              <p className="text-sm font-semibold">Drop product image here</p>
              <p className="text-xs text-white/40 mt-1">PNG, JPG or WebP · max 8MB · plain background works best</p>
              <p className="text-xs text-white/30 mt-3">Optional — without image, AI generates a generic product visual</p>
            </div>
          ) : (
            <div className="flex items-center gap-4 p-4 bg-white/[0.03] border border-white/10 rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Product preview" className="w-24 h-24 object-cover rounded-xl border border-white/10" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{imageFile?.name}</p>
                <p className="text-xs text-white/40 mt-0.5">{((imageFile?.size || 0) / 1024).toFixed(0)} KB</p>
                <p className="text-xs text-purple-300 font-medium mt-2 inline-flex items-center gap-1">
                  ✓ Veo will use this as reference
                </p>
              </div>
              <button type="button" onClick={() => { setImageFile(null); setImagePreview('') }}
                className="px-3 py-1.5 text-xs font-medium text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                Remove
              </button>
            </div>
          )}
        </FormCard>

        {/* 4. Cloud Account (where compute is billed) */}
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-sm font-semibold">☁ Bill compute to</p>
              <p className="text-xs text-white/40 mt-0.5">
                Veo/TTS/Gemini calls run on this Cloud Account. Default = the platform&apos;s account (env).
              </p>
            </div>
            <Link href="/profile/accounts" className="text-xs text-purple-300 hover:text-purple-200 whitespace-nowrap transition-colors">
              + Add account
            </Link>
          </div>
          <select value={credentialId} onChange={e => setCredentialId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all">
            <option value="default" className="bg-black">Default (platform account)</option>
            {creds.map(c => (
              <option key={c.id} value={c.id} className="bg-black">
                {c.name} — {c.project_id}
              </option>
            ))}
          </select>
          {creds.length === 0 && (
            <p className="mt-2 text-xs text-white/30">
              Tip: add your own Google Cloud account in <Link href="/profile/accounts" className="text-purple-300 hover:text-purple-200">Cloud Accounts</Link> to use your free $300 trial credit.
            </p>
          )}
        </div>

        {/* Submit */}
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          {error && (
            <div className="mb-4 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-300">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <div>
              {isValid ? (
                <>
                  <p className="text-sm font-semibold">Ready to generate</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    Estimated cost: <strong className="text-white/70">₹{duration === 15 ? 300 : duration === 30 ? 600 : 1200}</strong> (Veo Full) · Time: ~{duration === 15 ? 5 : duration === 30 ? 8 : 14} min
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-amber-300">Fill required fields first</p>
                  <p className="text-xs text-white/50 mt-0.5">Missing: {missing.join(', ')}</p>
                </>
              )}
            </div>
            <button onClick={submit} disabled={submitting || !isValid}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold shadow-lg shadow-purple-500/30 transition-all">
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Starting...
                </span>
              ) : '✦ Generate Ad'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FormCard({ step, title, subtitle, children }: { step: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-5">
        <div className="text-3xl font-bold bg-gradient-to-br from-purple-400 to-pink-400 bg-clip-text text-transparent">{step}</div>
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-white/40 mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-xs font-semibold text-white/70">{label}</label>
        {hint && <span className="text-xs text-white/30">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
