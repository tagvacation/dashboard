import { NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
)
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN })

export async function GET() {
  // Guard: credentials must be configured
  if (!process.env.YOUTUBE_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'YouTube not connected. Click "Connect YT" to authorize.' }, { status: 401 })
  }

  try {
    const yt = google.youtube({ version: 'v3', auth: oauth2Client })

    // Step 1: Get channel info (basic — always works with YouTube Data API v3)
    const channelRes = await yt.channels.list({
      part: ['statistics', 'snippet'],
      mine: true,
    }).catch(err => {
      const msg = err?.response?.data?.error?.message || err.message
      throw new Error(`Channel fetch failed: ${msg}`)
    })

    const channel = channelRes.data.items?.[0]
    if (!channel) {
      return NextResponse.json({ error: 'No YouTube channel found for this account. Make sure the channel exists.' }, { status: 404 })
    }
    const channelId = channel.id!

    const channelData = {
      name: channel.snippet?.title || '',
      thumbnail: channel.snippet?.thumbnails?.medium?.url || '',
      subscribers: parseInt(channel.statistics?.subscriberCount || '0'),
      totalViews: parseInt(channel.statistics?.viewCount || '0'),
      videoCount: parseInt(channel.statistics?.videoCount || '0'),
    }

    // Step 2: Get recent videos (last 10, sorted by date)
    const videosRes = await yt.search.list({
      part: ['snippet'],
      channelId,
      order: 'date',
      type: ['video'],
      maxResults: 10,
    }).catch(() => null) // non-fatal

    const videoIds = videosRes?.data.items?.map(v => v.id?.videoId).filter(Boolean) as string[] || []
    let videoItems: { id: string; title: string; thumbnail: string; publishedAt: string; views: number; likes: number }[] = []

    if (videoIds.length > 0) {
      const statsRes = await yt.videos.list({
        part: ['statistics', 'snippet'],
        id: videoIds,
      }).catch(() => null)

      videoItems = (statsRes?.data.items || []).map(v => ({
        id: v.id!,
        title: v.snippet?.title || '',
        thumbnail: v.snippet?.thumbnails?.medium?.url || '',
        publishedAt: v.snippet?.publishedAt || '',
        views: parseInt(v.statistics?.viewCount || '0'),
        likes: parseInt(v.statistics?.likeCount || '0'),
      })).sort((a, b) => b.views - a.views) // sort by views desc
    }

    // Step 3: YouTube Analytics (separate API — might not be enabled, treat as optional)
    let analyticsMetrics = { views: 0, watchMinutes: 0, subscribersGained: 0, likes: 0, comments: 0 }
    let analyticsError = ''

    try {
      const ytAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client })
      const endDate = new Date().toISOString().split('T')[0]
      const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const overallRes = await ytAnalytics.reports.query({
        ids: `channel==${channelId}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,subscribersGained,likes,comments',
      })

      const row = overallRes.data.rows?.[0] || []
      analyticsMetrics = {
        views: Number(row[0]) || 0,
        watchMinutes: Number(row[1]) || 0,
        subscribersGained: Number(row[2]) || 0,
        likes: Number(row[3]) || 0,
        comments: Number(row[4]) || 0,
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string; status?: string } } }; message?: string }
      const status = e?.response?.data?.error?.status
      const message = e?.response?.data?.error?.message || e?.message || ''

      if (status === 'PERMISSION_DENIED' || message.includes('disabled')) {
        analyticsError = 'YouTube Analytics API not enabled. Enable it in Google Cloud Console → APIs → YouTube Analytics API.'
      } else if (message.includes('quota')) {
        analyticsError = 'YouTube Analytics quota exceeded. Try again tomorrow.'
      } else {
        analyticsError = `Analytics unavailable: ${message}`
      }
    }

    return NextResponse.json({
      channel: channelData,
      period: { days: 28 },
      metrics: analyticsMetrics,
      analyticsError: analyticsError || null,
      topVideos: videoItems.map(v => ({
        videoId: v.id,
        title: v.title,
        thumbnail: v.thumbnail,
        url: `https://youtube.com/shorts/${v.id}`,
        views: v.views,
        likes: v.likes,
        publishedAt: v.publishedAt,
      })),
    })

  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: { message?: string; code?: number } } }; message?: string }
    const apiError = err?.response?.data?.error
    const code = apiError?.code
    const message = apiError?.message || err?.message || 'Unknown error'

    console.error('Analytics error:', message)

    if (code === 401 || message.includes('invalid_grant') || message.includes('Token has been expired')) {
      return NextResponse.json({
        error: 'YouTube token expired. Go to Settings → Connect YouTube to re-authorize.',
      }, { status: 401 })
    }

    if (message.includes('quota')) {
      return NextResponse.json({ error: 'YouTube API quota exceeded. Try again tomorrow.' }, { status: 429 })
    }

    return NextResponse.json({ error: `YouTube API error: ${message}` }, { status: 500 })
  }
}
