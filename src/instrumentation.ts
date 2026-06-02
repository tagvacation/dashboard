// Instrumentation hook — intentionally empty.
// Cron is handled by Railway's built-in cron job service
// which calls POST /api/cron every minute.
export async function register() {}
