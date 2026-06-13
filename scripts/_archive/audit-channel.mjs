/**
 * KathaKar channel audit — pulls everything YouTube will give us:
 * channel stats, all videos, analytics aggregates, per-video retention,
 * traffic sources, search terms, demographics, countries.
 *
 * Outputs JSON to ../audit-output/YYYY-MM-DD/
 *
 * Run from dashboard/: node scripts/audit-channel.mjs
 */

import { google } from 'googleapis'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// ─── Load .env manually (avoids --env-file quirks with JSON values) ──────────
function loadEnv(path) {
  const content = readFileSync(path, 'utf-8')
  for (const line of content.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}
loadEnv('.env')

for (const k of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI', 'YOUTUBE_REFRESH_TOKEN']) {
  if (!process.env[k]) { console.error(`Missing env var: ${k}`); process.exit(1) }
}

// ─── Output dir ──────────────────────────────────────────────────────────────
const today = new Date().toISOString().split('T')[0]
const OUTPUT_DIR = join('..', 'audit-output', today)
mkdirSync(OUTPUT_DIR, { recursive: true })

const save = (name, data) => {
  writeFileSync(join(OUTPUT_DIR, name), JSON.stringify(data, null, 2))
  console.log(`  ✓ saved ${name}`)
}
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)

// ─── Auth ────────────────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI,
)
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN })

const yt = google.youtube({ version: 'v3', auth: oauth2Client })
const yta = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client })

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function tryReport(name, params) {
  try {
    const res = await yta.reports.query(params)
    save(name, { params, data: res.data })
    return res.data
  } catch (e) {
    const msg = e?.response?.data?.error?.message || e.message
    log(`  ✗ ${name} failed: ${msg}`)
    save(name, { error: msg, params })
    return null
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log(`Output dir: ${OUTPUT_DIR}`)

  // 1. Channel info
  log('Fetching channel info...')
  const chRes = await yt.channels.list({
    mine: true,
    part: ['snippet', 'statistics', 'contentDetails', 'brandingSettings', 'topicDetails'],
  })
  const channel = chRes.data.items?.[0]
  if (!channel) { console.error('No channel found'); process.exit(1) }
  const channelId = channel.id
  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads

  const channelData = {
    id: channelId,
    title: channel.snippet.title,
    description: channel.snippet.description,
    customUrl: channel.snippet.customUrl,
    publishedAt: channel.snippet.publishedAt,
    country: channel.snippet.country,
    subscribers: parseInt(channel.statistics.subscriberCount || '0'),
    totalViews: parseInt(channel.statistics.viewCount || '0'),
    videoCount: parseInt(channel.statistics.videoCount || '0'),
    keywords: channel.brandingSettings?.channel?.keywords,
    topicCategories: channel.topicDetails?.topicCategories,
    thumbnail: channel.snippet.thumbnails?.high?.url,
  }
  save('01-channel.json', channelData)
  log(`Channel: ${channelData.title} | ${channelData.subscribers} subs | ${channelData.videoCount} videos | ${channelData.totalViews} total views`)

  // 2. All video IDs via uploads playlist
  log('Fetching all video IDs...')
  const videoIds = []
  let pageToken = undefined
  do {
    const res = await yt.playlistItems.list({
      playlistId: uploadsPlaylistId,
      part: ['contentDetails'],
      maxResults: 50,
      pageToken,
    })
    res.data.items.forEach(it => videoIds.push(it.contentDetails.videoId))
    pageToken = res.data.nextPageToken
  } while (pageToken)
  log(`Found ${videoIds.length} videos`)

  // 3. Video metadata + stats in batches of 50
  const videos = []
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const res = await yt.videos.list({
      id: batch,
      part: ['snippet', 'statistics', 'contentDetails', 'status'],
    })
    res.data.items.forEach(v => videos.push({
      id: v.id,
      title: v.snippet.title,
      description: v.snippet.description,
      tags: v.snippet.tags || [],
      categoryId: v.snippet.categoryId,
      publishedAt: v.snippet.publishedAt,
      thumbnail: v.snippet.thumbnails?.high?.url,
      duration: v.contentDetails.duration,
      views: parseInt(v.statistics.viewCount || '0'),
      likes: parseInt(v.statistics.likeCount || '0'),
      comments: parseInt(v.statistics.commentCount || '0'),
      privacyStatus: v.status.privacyStatus,
    }))
  }
  videos.sort((a, b) => b.views - a.views)
  save('02-videos.json', videos)
  log(`Top video: "${videos[0]?.title}" @ ${videos[0]?.views} views`)
  log(`Worst video: "${videos[videos.length-1]?.title}" @ ${videos[videos.length-1]?.views} views`)

  // 4. Analytics aggregates
  const todayD = today
  const day28 = new Date(Date.now() - 28*86400000).toISOString().split('T')[0]
  const day90 = new Date(Date.now() - 90*86400000).toISOString().split('T')[0]
  const channelStart = channelData.publishedAt.split('T')[0]
  const baseMetrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares'

  log('Fetching channel aggregates...')
  await tryReport('03-aggregate-28d.json', {
    ids: `channel==${channelId}`, startDate: day28, endDate: todayD, metrics: baseMetrics,
  })
  await tryReport('03-aggregate-90d.json', {
    ids: `channel==${channelId}`, startDate: day90, endDate: todayD, metrics: baseMetrics,
  })
  await tryReport('03-aggregate-lifetime.json', {
    ids: `channel==${channelId}`, startDate: channelStart, endDate: todayD, metrics: baseMetrics,
  })

  // 5. Per-video metrics (top 10 + bottom 5 + most recent 5)
  log('Fetching per-video metrics...')
  const topVids = videos.slice(0, 10)
  const bottomVids = videos.slice(-5)
  const recentVids = [...videos].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 5)
  const targetIds = [...new Set([
    ...topVids.map(v => v.id),
    ...bottomVids.map(v => v.id),
    ...recentVids.map(v => v.id),
  ])]
  save('00-target-videos.json', {
    top10: topVids.map(v => ({ id: v.id, title: v.title, views: v.views })),
    bottom5: bottomVids.map(v => ({ id: v.id, title: v.title, views: v.views })),
    recent5: recentVids.map(v => ({ id: v.id, title: v.title, views: v.views, publishedAt: v.publishedAt })),
    targetIds,
  })

  const perVideoMetrics = []
  for (const vid of targetIds) {
    try {
      const res = await yta.reports.query({
        ids: `channel==${channelId}`,
        startDate: channelStart,
        endDate: todayD,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained',
        filters: `video==${vid}`,
      })
      perVideoMetrics.push({ videoId: vid, data: res.data })
    } catch (e) {
      const msg = e?.response?.data?.error?.message || e.message
      perVideoMetrics.push({ videoId: vid, error: msg })
    }
  }
  save('04-per-video-metrics.json', perVideoMetrics)

  // 6. Retention curves
  log('Fetching retention curves...')
  const retentionData = []
  for (const vid of targetIds) {
    try {
      const res = await yta.reports.query({
        ids: `channel==${channelId}`,
        startDate: channelStart,
        endDate: todayD,
        metrics: 'audienceWatchRatio,relativeRetentionPerformance',
        dimensions: 'elapsedVideoTimeRatio',
        filters: `video==${vid};audienceType==ORGANIC`,
        sort: 'elapsedVideoTimeRatio',
      })
      retentionData.push({ videoId: vid, data: res.data })
    } catch (e) {
      const msg = e?.response?.data?.error?.message || e.message
      retentionData.push({ videoId: vid, error: msg })
    }
  }
  save('05-retention.json', retentionData)

  // 7. Traffic sources (channel-wide, 90 days)
  log('Fetching traffic sources...')
  await tryReport('06-traffic-sources.json', {
    ids: `channel==${channelId}`,
    startDate: day90, endDate: todayD,
    metrics: 'views,estimatedMinutesWatched,averageViewDuration',
    dimensions: 'insightTrafficSourceType',
    sort: '-views',
  })

  // 8. Search terms
  await tryReport('07-search-terms.json', {
    ids: `channel==${channelId}`,
    startDate: day90, endDate: todayD,
    metrics: 'views',
    dimensions: 'insightTrafficSourceDetail',
    filters: 'insightTrafficSourceType==YT_SEARCH',
    sort: '-views',
    maxResults: 50,
  })

  // 9. Demographics
  log('Fetching demographics...')
  await tryReport('08-demographics.json', {
    ids: `channel==${channelId}`,
    startDate: day90, endDate: todayD,
    metrics: 'viewerPercentage',
    dimensions: 'ageGroup,gender',
  })

  // 10. Top countries
  await tryReport('09-countries.json', {
    ids: `channel==${channelId}`,
    startDate: day90, endDate: todayD,
    metrics: 'views,estimatedMinutesWatched,averageViewDuration',
    dimensions: 'country',
    sort: '-views',
    maxResults: 20,
  })

  // 11. Device + playback location
  await tryReport('10-device.json', {
    ids: `channel==${channelId}`,
    startDate: day90, endDate: todayD,
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'deviceType',
    sort: '-views',
  })

  await tryReport('11-playback-location.json', {
    ids: `channel==${channelId}`,
    startDate: day90, endDate: todayD,
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'insightPlaybackLocationType',
    sort: '-views',
  })

  // 12. Daily timeseries (90d) — for trend analysis
  await tryReport('12-daily-timeseries.json', {
    ids: `channel==${channelId}`,
    startDate: day90, endDate: todayD,
    metrics: 'views,estimatedMinutesWatched,subscribersGained',
    dimensions: 'day',
    sort: 'day',
  })

  log('Audit complete')
}

main().catch(e => {
  console.error('FATAL:', e.message)
  if (e.errors) console.error(JSON.stringify(e.errors, null, 2))
  process.exit(1)
})
