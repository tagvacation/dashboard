export interface Channel {
  id: string
  name: string
  emoji: string
  sheetId: string
  sheetTab: string
  gcsBucket: string
  gcsSaJson?: string    // override SA if different per channel
  ytRefreshToken?: string
  ytClientId?: string
  ytClientSecret?: string
  ytRedirectUri?: string
}

// Parse channels from env — falls back to single channel from legacy env vars
export function getChannels(): Channel[] {
  // Multi-channel mode
  if (process.env.CHANNELS_CONFIG) {
    try {
      return JSON.parse(process.env.CHANNELS_CONFIG)
    } catch (e) {
      console.error('Invalid CHANNELS_CONFIG JSON:', e)
    }
  }

  // Single channel fallback (backward compat with current .env)
  return [{
    id: 'default',
    name: process.env.CHANNEL_NAME || 'KathaKar',
    emoji: '🪔',
    sheetId: process.env.SHEET_ID || '',
    sheetTab: process.env.SHEET_TAB || 'Sheet2',
    gcsBucket: process.env.GCS_BUCKET || '',
    ytRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    ytClientId: process.env.YOUTUBE_CLIENT_ID,
    ytClientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    ytRedirectUri: process.env.YOUTUBE_REDIRECT_URI,
  }]
}

export function getChannel(id?: string): Channel {
  const channels = getChannels()
  if (!id) return channels[0]
  return channels.find(c => c.id === id) || channels[0]
}

export function getSharedSaCredentials() {
  return JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
}
