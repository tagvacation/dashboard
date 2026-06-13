/**
 * Competitor research — find viral channels in target formats,
 * pull their stats + top videos to extract the real formula.
 *
 * Outputs to ../audit-output/{date}/competitors/
 */

import { google } from 'googleapis'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

function loadEnv(path) {
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('='); if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}
loadEnv('.env')

const today = new Date().toISOString().split('T')[0]
const OUT = join('..', 'audit-output', today, 'competitors')
mkdirSync(OUT, { recursive: true })

const save = (name, data) => {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2))
  console.log(`  ✓ ${name}`)
}
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`)

const oauth = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI,
)
oauth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN })
const yt = google.youtube({ version: 'v3', auth: oauth })

// ─── Search for channels by keyword ──────────────────────────────────────────
async function searchChannels(query, maxResults = 15) {
  const res = await yt.search.list({
    part: ['snippet'], q: query, type: ['channel'], maxResults, regionCode: 'IN', relevanceLanguage: 'hi',
  })
  return (res.data.items || []).map(i => ({
    id: i.snippet.channelId, title: i.snippet.channelTitle, description: i.snippet.description,
  }))
}

// ─── Search for top videos by keyword (sorted by view) ───────────────────────
async function searchTopVideos(query, maxResults = 20) {
  const res = await yt.search.list({
    part: ['snippet'], q: query, type: ['video'], maxResults, order: 'viewCount',
    regionCode: 'IN', relevanceLanguage: 'hi', videoDuration: 'short',
    publishedAfter: '2026-03-01T00:00:00Z', // only last 3 months
  })
  const ids = (res.data.items || []).map(i => i.id.videoId).filter(Boolean)
  if (!ids.length) return []
  const vRes = await yt.videos.list({ id: ids, part: ['snippet','statistics','contentDetails'] })
  return (vRes.data.items || []).map(v => ({
    id: v.id,
    channelId: v.snippet.channelId,
    channelTitle: v.snippet.channelTitle,
    title: v.snippet.title,
    description: v.snippet.description?.slice(0, 500),
    tags: v.snippet.tags || [],
    publishedAt: v.snippet.publishedAt,
    duration: v.contentDetails.duration,
    views: parseInt(v.statistics.viewCount || '0'),
    likes: parseInt(v.statistics.likeCount || '0'),
    comments: parseInt(v.statistics.commentCount || '0'),
    url: `https://youtube.com/shorts/${v.id}`,
  })).sort((a,b) => b.views - a.views)
}

// ─── Channel deep-dive ────────────────────────────────────────────────────────
async function channelDeepDive(channelId) {
  const chRes = await yt.channels.list({
    id: [channelId], part: ['snippet','statistics','contentDetails','brandingSettings'],
  })
  const ch = chRes.data.items?.[0]
  if (!ch) return null

  const uploadsPlaylistId = ch.contentDetails.relatedPlaylists.uploads

  // Get all video IDs (cap at 200 to keep quota reasonable)
  const videoIds = []
  let pageToken
  for (let pages = 0; pages < 4; pages++) { // 4 pages = 200 videos max
    const res = await yt.playlistItems.list({
      playlistId: uploadsPlaylistId, part: ['contentDetails','snippet'],
      maxResults: 50, pageToken,
    })
    res.data.items.forEach(it => videoIds.push(it.contentDetails.videoId))
    pageToken = res.data.nextPageToken
    if (!pageToken) break
  }

  // Get stats in batches of 50
  const videos = []
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const res = await yt.videos.list({ id: batch, part: ['snippet','statistics','contentDetails'] })
    res.data.items.forEach(v => videos.push({
      id: v.id, title: v.snippet.title, publishedAt: v.snippet.publishedAt,
      duration: v.contentDetails.duration,
      views: parseInt(v.statistics.viewCount || '0'),
      likes: parseInt(v.statistics.likeCount || '0'),
      comments: parseInt(v.statistics.commentCount || '0'),
      tags: v.snippet.tags || [],
    }))
  }
  videos.sort((a,b) => b.views - a.views)

  return {
    channel: {
      id: ch.id,
      title: ch.snippet.title,
      description: ch.snippet.description,
      publishedAt: ch.snippet.publishedAt,
      country: ch.snippet.country,
      customUrl: ch.snippet.customUrl,
      subscribers: parseInt(ch.statistics.subscriberCount || '0'),
      totalViews: parseInt(ch.statistics.viewCount || '0'),
      videoCount: parseInt(ch.statistics.videoCount || '0'),
      thumbnail: ch.snippet.thumbnails?.high?.url,
      keywords: ch.brandingSettings?.channel?.keywords,
    },
    videos,
    stats: {
      fetchedVideos: videos.length,
      avgViews: Math.round(videos.reduce((s, v) => s + v.views, 0) / Math.max(videos.length, 1)),
      medianViews: videos.length ? videos.sort((a,b) => a.views - b.views)[Math.floor(videos.length/2)].views : 0,
      topVideoViews: videos[0]?.views || 0,
      worstVideoViews: videos[videos.length-1]?.views || 0,
    },
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const QUERIES = {
  halku: ['halku bhaiya', 'halku hindi', 'हलकू', 'hulk bhaiya hindi'],
  cake_city: ['cake city hindi shorts', 'edible city ai shorts', 'rasgulla city ai'],
  dada_magical: ['dada magical pen hindi shorts', 'dadi doraemon hindi ai', 'magical object village hindi'],
  vegetable: ['vegetable family hindi shorts ai', 'sabzi family hindi ai'],
}

async function main() {
  log(`Output dir: ${OUT}`)
  const allTopVideos = []
  const allChannels = new Map()

  // 1. Search top videos in each category
  for (const [category, queries] of Object.entries(QUERIES)) {
    log(`Searching category: ${category}`)
    const categoryVids = []
    for (const q of queries) {
      try {
        const vids = await searchTopVideos(q, 15)
        vids.forEach(v => v.searchQuery = q)
        categoryVids.push(...vids)
        log(`  "${q}" → ${vids.length} videos (top: ${vids[0]?.views || 0} views)`)
      } catch (e) {
        log(`  "${q}" failed: ${e.message}`)
      }
    }
    // Dedupe by video ID
    const dedup = Array.from(new Map(categoryVids.map(v => [v.id, v])).values())
      .sort((a,b) => b.views - a.views)
    save(`videos-${category}.json`, dedup)
    dedup.slice(0, 5).forEach(v => log(`    🔥 ${v.views.toLocaleString()} views: "${v.title.slice(0,60)}" — ${v.channelTitle}`))
    allTopVideos.push(...dedup)

    // Track unique channels
    dedup.forEach(v => {
      if (!allChannels.has(v.channelId)) {
        allChannels.set(v.channelId, { channelId: v.channelId, channelTitle: v.channelTitle, viralVideos: [], category })
      }
      allChannels.get(v.channelId).viralVideos.push({ id: v.id, title: v.title, views: v.views })
    })
  }

  save('all-top-videos.json', allTopVideos.sort((a,b) => b.views - a.views))

  // 2. Deep-dive on top channels (any channel with 2+ viral hits or 100K+ views on one video)
  const targetChannels = Array.from(allChannels.values())
    .filter(c => c.viralVideos.length >= 2 || c.viralVideos.some(v => v.views >= 100_000))
    .sort((a,b) => Math.max(...b.viralVideos.map(v=>v.views)) - Math.max(...a.viralVideos.map(v=>v.views)))
    .slice(0, 15) // top 15 candidate channels

  log(`Deep-diving ${targetChannels.length} channels...`)
  const channelDeepDives = []
  for (const tc of targetChannels) {
    try {
      log(`  Deep-dive: ${tc.channelTitle}`)
      const dive = await channelDeepDive(tc.channelId)
      if (dive) {
        dive.discoveredVia = tc.category
        dive.searchHits = tc.viralVideos
        channelDeepDives.push(dive)
        log(`    ${dive.channel.subscribers.toLocaleString()} subs, ${dive.channel.videoCount} videos, median ${dive.stats.medianViews.toLocaleString()} views`)
      }
    } catch (e) {
      log(`    ✗ ${e.message}`)
    }
  }
  save('channel-deep-dives.json', channelDeepDives)

  // 3. Summary
  const summary = {
    totalVideosScanned: allTopVideos.length,
    totalChannelsFound: allChannels.size,
    channelsDeepDived: channelDeepDives.length,
    topVideos: allTopVideos.slice(0, 20).map(v => ({
      views: v.views, title: v.title, channel: v.channelTitle,
      duration: v.duration, publishedAt: v.publishedAt, url: v.url,
      category: v.searchQuery,
    })),
    topChannelsByMedianViews: channelDeepDives
      .sort((a,b) => b.stats.medianViews - a.stats.medianViews)
      .slice(0, 10)
      .map(c => ({
        title: c.channel.title,
        subscribers: c.channel.subscribers,
        videoCount: c.channel.videoCount,
        medianViews: c.stats.medianViews,
        topVideoViews: c.stats.topVideoViews,
        createdAt: c.channel.publishedAt,
        category: c.discoveredVia,
      })),
  }
  save('summary.json', summary)

  log('Competitor research complete')
  log(`Channels deep-dived: ${channelDeepDives.length}`)
  log(`Top video found: ${allTopVideos[0]?.views.toLocaleString() || 0} views — "${allTopVideos[0]?.title?.slice(0,80) || ''}"`)
}

main().catch(e => {
  console.error('FATAL:', e.message)
  if (e.errors) console.error(JSON.stringify(e.errors, null, 2))
  process.exit(1)
})
