'use client'
import { useEffect } from 'react'
import Lenis from 'lenis'

export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.0,              // 1s ease — feels modern, not sluggish
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),  // smooth out
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.5,
      lerp: 0.1,                  // interpolation factor — lower = smoother
    })

    function raf(time: number) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }
    const rafId = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
    }
  }, [])

  return null
}
