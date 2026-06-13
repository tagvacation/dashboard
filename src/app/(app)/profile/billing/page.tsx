'use client'
import { useSession } from 'next-auth/react'

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '₹0',
    period: 'forever',
    features: ['5 videos / month', 'All viral templates', 'Watermark on output', 'Email support'],
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '₹499',
    period: '/ month',
    features: ['50 videos / month', 'No watermark', 'YouTube auto-publish', 'Scheduled posting', 'Priority generation'],
    highlight: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    price: '₹2,499',
    period: '/ month',
    features: ['Unlimited videos', 'Multi-channel (5+)', 'Brand-safe AI ads', 'Priority support', 'White-label option'],
    highlight: false,
  },
]

export default function BillingPage() {
  const { data: session } = useSession()
  const currentPlan = session?.user?.plan || 'free'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Billing</h2>
        <p className="text-sm text-white/40 mt-1">Your plan, usage, and payment methods</p>
      </div>

      {/* Current plan */}
      <div className="relative bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-6 overflow-hidden">
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-purple-500/20 rounded-full blur-3xl" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider mb-1">Current plan</p>
              <h3 className="text-3xl font-bold capitalize">{currentPlan}</h3>
              <p className="text-sm text-white/60 mt-1">
                {currentPlan === 'agency' ? 'Full access · admin tier' :
                 currentPlan === 'pro' ? 'No watermark · unlimited usage' :
                 currentPlan === 'hobby' ? '30 videos/month' :
                 'Free forever · upgrade for more'}
              </p>
            </div>
            {currentPlan === 'free' && (
              <a href="#plans"
                className="px-5 py-2.5 bg-white hover:bg-white/90 text-black rounded-xl text-sm font-semibold transition-colors whitespace-nowrap">
                Upgrade →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Usage placeholder */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Videos this month', value: '0', sub: 'of 5 included' },
          { label: 'Storage used',       value: '0 MB',    sub: 'in your bucket' },
          { label: 'Next billing date',  value: '—',  sub: 'no payment scheduled' },
        ].map(m => (
          <div key={m.label} className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
            <p className="text-2xl font-bold">{m.value}</p>
            <p className="text-xs text-white/60 mt-1">{m.label}</p>
            <p className="text-xs text-white/30 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Plan picker */}
      <div id="plans">
        <h3 className="text-base font-bold mb-1">Compare plans</h3>
        <p className="text-xs text-white/40 mb-4">Payment integration coming soon — these are reference prices</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map(p => {
            const isCurrent = p.id === currentPlan
            return (
              <div key={p.id}
                className={`relative rounded-2xl p-6 ${
                  p.highlight
                    ? 'bg-gradient-to-br from-purple-600 to-pink-600 text-white shadow-2xl shadow-purple-500/30'
                    : 'bg-white/[0.03] border border-white/10'
                }`}>
                {p.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-purple-700 rounded-full text-xs font-bold shadow-lg">
                    MOST POPULAR
                  </div>
                )}
                <p className={`text-sm font-semibold ${p.highlight ? 'opacity-90' : 'text-white/60'}`}>{p.name}</p>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <p className="text-4xl font-bold">{p.price}</p>
                  <p className={`text-xs ${p.highlight ? 'opacity-80' : 'text-white/50'}`}>{p.period}</p>
                </div>
                <ul className={`mt-5 space-y-2 text-sm ${p.highlight ? '' : 'text-white/70'}`}>
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-2">
                      <span className={`mt-0.5 ${p.highlight ? 'opacity-90' : 'text-purple-400'}`}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button disabled={isCurrent}
                  className={`mt-6 w-full py-2.5 text-center rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-default
                    ${p.highlight ? 'bg-white text-purple-700 hover:bg-purple-50' : 'bg-white text-black hover:bg-white/90'}`}>
                  {isCurrent ? '✓ Current plan' : 'Choose plan'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Invoices placeholder */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
        <h3 className="text-base font-bold mb-3">Invoices</h3>
        <div className="text-center py-8 text-white/40 text-sm">
          No invoices yet. They&apos;ll appear here after your first payment.
        </div>
      </div>
    </div>
  )
}
