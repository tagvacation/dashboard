import { NextResponse } from 'next/server'
import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
)
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN })

export async function GET() {
  try {
    const yt = google.youtube({ version: 'v3', auth: oauth2Client })
    const ytAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client })

    // Get channel info
    const channelRes = await yt.channels.list({
      part: ['statistics', 'snippet'],
      mine: true,
    })
    const channel = channelRes.data.items?.[0]
    const channelId = channel?.id

    // Date range: last 28 days
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Overall metrics
    const overallRes = await ytAnalytics.reports.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,subscribersGained,likes,comments',
    })

    // Per video metrics (top 10)
    const videoRes = await ytAnalytics.reports.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,likes,averageViewDuration',
      dimensions: 'video',
      sort: '-views',
      maxResults: 10,
    })

    // Get video details for top videos
    const videoIds = videoRes.data.rows?.map((r: any) => r[0]).join(',') || ''
    let videoDetails: any[] = []
    if (videoIds) {
      const detailRes = await yt.videos.list({
        part: ['snippet', 'statistics'],
        id: [videoIds],
      })
      videoDetails = detailRes.data.items || []
    }

    const overall = overallRes.data.rows?.[0] || [0, 0, 0, 0, 0]
    const topVideos = (videoRes.data.rows || []).map((row: any) => {
      const detail = videoDetails.find(v => v.id === row[0])
      return {
        videoId: row[0],
        title: detail?.snippet?.title || row[0],
        thumbnail: detail?.snippet?.thumbnails?.medium?.url || '',
        url: `https://youtube.com/shorts/${row[0]}`,
        views: row[1],
        watchMinutes: row[2],
        likes: row[3],
        avgDuration: Math.round(row[4] || 0),
      }
    })

    return NextResponse.json({
      channel: {
        name: channel?.snippet?.title,
        thumbnail: channel?.snippet?.thumbnails?.medium?.url,
        subscribers: parseInt(channel?.statistics?.subscriberCount || '0'),
        totalViews: parseInt(channel?.statistics?.viewCount || '0'),
        videoCount: parseInt(channel?.statistics?.videoCount || '0'),
      },
      period: { startDate, endDate, days: 28 },
      metrics: {
        views: parseInt(overall[0]) || 0,
        watchMinutes: parseInt(overall[1]) || 0,
        subscribersGained: parseInt(overall[2]) || 0,
        likes: parseInt(overall[3]) || 0,
        comments: parseInt(overall[4]) || 0,
      },
      topVideos,
    })
  } catch (e: any) {
    console.error('Analytics error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
