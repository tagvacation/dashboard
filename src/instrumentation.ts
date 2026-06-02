export async function register() {
  // Only run on Node.js server (not Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCron } = await import('./lib/cron')
    startCron()
  }
}
