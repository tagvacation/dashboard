'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useState } from 'react'

const NAV_PRIMARY = [
  { href: '/',          icon: '⌂', label: 'Home',         exact: true },
  { href: '/generate',  icon: '✦', label: 'Generate' },
  { href: '/ads',       icon: '🎤', label: 'Create Ad', badge: 'NEW' },
  { href: '/stores',    icon: '🛍', label: 'Stores' },
  { href: '/library',   icon: '▤', label: 'Library' },
  { href: '/analytics', icon: '◎', label: 'Analytics' },
]

const NAV_SETTINGS = [
  { href: '/profile',          icon: '◉', label: 'Profile' },
  { href: '/profile/accounts', icon: '☁', label: 'Cloud Accounts' },
  { href: '/profile/channels', icon: '▶', label: 'YouTube' },
  { href: '/profile/billing',  icon: '◈', label: 'Billing' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const isActive = (href: string, exact?: boolean) => exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')

  const NavItems = ({ items, onClick }: { items: typeof NAV_PRIMARY; onClick?: () => void }) => (
    <>{items.map(item => {
      const active = isActive(item.href, item.exact)
      return (
        <Link key={item.href} href={item.href} onClick={onClick}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
            ${active
              ? 'bg-white/10 text-white border border-white/10'
              : 'border border-transparent text-white/50 hover:text-white hover:bg-white/5'}`}>
          <span className="text-base leading-none w-5 text-center">{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {'badge' in item && item.badge && (
            <span className="text-xs px-1.5 py-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full font-semibold">{item.badge}</span>
          )}
        </Link>
      )
    })}</>
  )

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Ambient gradient (fixed, contained) */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-0 -left-40 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 -right-40 w-[600px] h-[600px] bg-pink-500/10 rounded-full blur-3xl" />
      </div>

      {/* ─── Sticky Top Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <div className="px-4 md:px-6 h-14 flex items-center gap-4">
          {/* Mobile menu toggle */}
          <button onClick={() => setMobileNavOpen(o => !o)}
            className="md:hidden p-2 -ml-2 text-white/70 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={mobileNavOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
            </svg>
          </button>

          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
            <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">✦</span>
            <span className="hidden sm:inline">AI Studio</span>
          </Link>

          {/* Spacer */}
          <div className="flex-1" />

          {/* User menu */}
          {session?.user && (
            <div className="flex items-center gap-3">
              <span className="hidden md:inline text-xs text-white/40">{session.user.email}</span>
              {session.user.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={session.user.image} alt="" className="w-8 h-8 rounded-full border border-white/10" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold">
                  {(session.user.name || session.user.email)[0].toUpperCase()}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ─── Body: sidebar + main ──────────────────────────────────────── */}
      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col w-60 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] border-r border-white/5 px-3 py-5">
          <p className="px-3 mb-2 text-xs font-semibold text-white/30 uppercase tracking-wider">Workspace</p>
          <nav className="space-y-0.5 mb-6">
            <NavItems items={NAV_PRIMARY} />
          </nav>

          <p className="px-3 mb-2 text-xs font-semibold text-white/30 uppercase tracking-wider">Account</p>
          <nav className="space-y-0.5">
            <NavItems items={NAV_SETTINGS} />
          </nav>

          {/* Sign out + legacy link */}
          <div className="mt-auto pt-4 border-t border-white/5 space-y-1">
            <Link href="/legacy-dashboard"
              className="block px-3 py-2 text-xs text-white/30 hover:text-white/60 transition-colors">
              ↗ Legacy dashboard
            </Link>
            <button onClick={() => signOut({ callbackUrl: '/welcome' })}
              className="w-full text-left px-3 py-2 text-xs text-white/30 hover:text-white/70 transition-colors">
              Sign out
            </button>
          </div>
        </aside>

        {/* Mobile Sidebar (drawer) */}
        {mobileNavOpen && (
          <>
            <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
            <aside className="md:hidden fixed top-14 bottom-0 left-0 z-40 w-72 bg-[#0a0a0f] border-r border-white/10 px-3 py-5 overflow-y-auto">
              <p className="px-3 mb-2 text-xs font-semibold text-white/30 uppercase tracking-wider">Workspace</p>
              <nav className="space-y-0.5 mb-6">
                <NavItems items={NAV_PRIMARY} onClick={() => setMobileNavOpen(false)} />
              </nav>
              <p className="px-3 mb-2 text-xs font-semibold text-white/30 uppercase tracking-wider">Account</p>
              <nav className="space-y-0.5">
                <NavItems items={NAV_SETTINGS} onClick={() => setMobileNavOpen(false)} />
              </nav>
              <div className="mt-6 pt-4 border-t border-white/5 space-y-1">
                <Link href="/legacy-dashboard" onClick={() => setMobileNavOpen(false)}
                  className="block px-3 py-2 text-xs text-white/30">↗ Legacy dashboard</Link>
                <button onClick={() => signOut({ callbackUrl: '/welcome' })}
                  className="w-full text-left px-3 py-2 text-xs text-white/30">Sign out</button>
              </div>
            </aside>
          </>
        )}

        {/* Main content area */}
        <main className="flex-1 min-w-0 min-h-[calc(100vh-3.5rem)]">
          {children}
        </main>
      </div>
    </div>
  )
}
