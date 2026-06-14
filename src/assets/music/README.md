# Background music for AI ads

Drop royalty-free / licensed audio tracks here, **named by mood** so the mood picker works:

| File | Mood (form option) |
|------|--------------------|
| `epic.mp3`   | Epic / cinematic |
| `upbeat.mp3` | Upbeat / energetic |
| `warm.mp3`   | Warm / emotional |
| `calm.mp3`   | Calm / clean |

(`.mp3`, `.m4a`, `.aac`, `.wav`, `.ogg` all work.) The compositor
(`src/lib/pipeline/ad-composite.ts` → `findMusic(mood)`) picks the file whose name
**starts with the chosen mood**, mixes it **under** the dialogue at ~16% volume, and
loops it to fit. The Ads form's "Background music" select sets the mood (Auto = by tone).
If a mood file is missing it falls back to the first track; if the folder is empty, ads
play with dialogue + ambient only (no music). "No music" skips it entirely.

Suggested sources (clear the license yourself before commercial use):
- YouTube Audio Library, Pixabay Music, Uppbeat, or a track you own.

Pick an energetic / cinematic instrumental ~30–60s; it loops automatically to fit the ad.
