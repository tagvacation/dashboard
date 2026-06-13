import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from '@/components/SessionProvider'
import { SmoothScroll } from '@/components/SmoothScroll'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AI Reel Studio',
  description: 'Generate viral AI videos with Veo + Gemini',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SmoothScroll />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
