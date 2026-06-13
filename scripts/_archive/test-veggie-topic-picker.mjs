/**
 * Test the Veggie Drama topic picker prompt — generate 5 sample topics.
 * Free (Gemini), takes ~30 sec.
 *
 * Run from dashboard/: node scripts/test-veggie-topic-picker.mjs
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

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON)
const projectId = process.env.GCP_PROJECT_ID || 'gen-lang-client-0866402603'
const region = 'us-central1'
const model = 'gemini-2.5-flash'

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

const today = new Date().toISOString().split('T')[0]
const OUT = join('..', 'audit-output', today)
mkdirSync(OUT, { recursive: true })

const TOPIC_PICKER_PROMPT = `You are a creative director for a Hindi YouTube channel called "Veggie Drama" — micro-drama stories where vegetable, fruit, and food characters play out classic Indian melodrama tropes.

YOUR JOB: Pick one compelling story topic that uses a UNIVERSAL Hindi melodrama trope cast with vegetable/fruit characters. Output a single JSON object.

PROVEN TROPES (pick one, vary phrasing):
- Wife betrayal → husband rises (पत्नी ने धोखा दिया, पति बन गया करोड़पति)
- Class divide love (अमीर VS गरीब प्यार)
- Friend betrayal & revenge (दोस्त ने धोखा दिया, बदला लिया)
- Mother-in-law cruelty → daughter-in-law triumph (सास की क्रूरता, बहू का जवाब)
- Greedy rich man humbled by poor man's wisdom (अमीर का घमंड, गरीब की सीख)
- Innocent person framed → truth emerges (बेगुनाह को फँसाया, सच सामने आया)
- Forbidden love crosses caste / village rivalry (दो परिवारों की दुश्मनी में प्यार)
- Lost child / family reunion after years (बिछड़ा हुआ बेटा/बेटी मिला)
- Old father abandoned → karma returns (बूढ़े पिता को छोड़ा, कर्म ने सबक दिया)
- Servant turns out to be the rightful heir (नौकर निकला असली वारिस)

VEGETABLE CASTING RULES:
- Pick 2-4 main characters from the standard veggie cast OR invent new ones
- Names should be Hindi food-puns (Aaloo Singh, Mirchi Devi, Baingan Babu, Pyaaz Lal, Tamatar Seth)
- Each character's archetype must match their flavor:
  - Mirchi (chilli) = fiery, hot-tempered
  - Pyaaz (onion) = villain who "makes people cry"
  - Aaloo (potato) = patient, humble
  - Baingan (brinjal) = hardworking poor
  - Tamatar (tomato) = rich, sometimes greedy
  - Adrak (ginger) = wise old
  - Anguri (grapes) = spoiled rich princess
  - Bhindi (okra) = gossipy neighbour / mother-in-law
  - Gajar (carrot) = bright young son

TOPIC RULES:
- Must fit in 90-150 seconds (12-18 scenes)
- Must have a clear EMOTIONAL ARC with reversal
- Must end with either: moral payoff, or Part 2 cliffhanger
- Setting: Indian village, sabzi mandi, kitchen, farm, palace, sometimes modern town
- No real brands, no specific living people
- The topic should be SPECIFIC and EMOTIONALLY RICH, not generic

Return ONLY a JSON object:
{
  "topic": "string — 1-2 sentence Hindi description of the story",
  "trope": "string — which proven trope this uses",
  "main_characters": [{"name": "Aaloo Singh", "species": "potato", "role": "betrayed husband"}],
  "hook_idea": "string — what the first 3 seconds will show, in English",
  "title_draft": "string — proposed YouTube title with emojis matching the formula",
  "format": "single" | "part_1_of_2",
  "estimated_duration_sec": 120
}`

async function callGemini(systemPrompt, userPrompt, temperature = 1.0) {
  const client = await auth.getClient()
  const token = await client.getAccessToken()

  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty response')
  return JSON.parse(text)
}

async function main() {
  console.log('Generating 5 sample veggie drama topics...\n')
  const topics = []

  for (let i = 1; i <= 5; i++) {
    try {
      // Vary the user prompt slightly to ensure diverse topics
      const userPrompt = `Generate fresh story topic #${i}. Make it DIFFERENT from typical clichés. Be SPECIFIC about the conflict and emotional core. Return JSON only.`
      const topic = await callGemini(TOPIC_PICKER_PROMPT, userPrompt, 1.1)
      topics.push(topic)
      console.log(`━━━━━━ Topic ${i} ━━━━━━━━━━━━━━━━━━━━━━━━━`)
      console.log(`📺 Title:  ${topic.title_draft}`)
      console.log(`🎬 Trope:  ${topic.trope}`)
      console.log(`📖 Topic:  ${topic.topic}`)
      console.log(`👥 Cast:   ${topic.main_characters.map(c => `${c.name} (${c.species}, ${c.role})`).join('; ')}`)
      console.log(`🎯 Hook:   ${topic.hook_idea}`)
      console.log(`⏱  Format: ${topic.format} · ~${topic.estimated_duration_sec}s\n`)
    } catch (e) {
      console.error(`✗ Topic ${i} failed: ${e.message}`)
    }
  }

  writeFileSync(join(OUT, 'veggie-topics-test.json'), JSON.stringify(topics, null, 2))
  console.log(`Saved ${topics.length} topics to ${join(OUT, 'veggie-topics-test.json')}`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
