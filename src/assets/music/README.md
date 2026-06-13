# Background music for AI ads

Drop one royalty-free / licensed audio track here (`.mp3`, `.m4a`, `.aac`, `.wav`, or `.ogg`).

The mascot-ad compositor (`src/lib/pipeline/ad-composite.ts` → `findMusic()`) auto-detects
the first audio file in this folder and mixes it **under** the dialogue at low volume
(~16%). If no file is present, ads simply use the clips' dialogue + ambient (no music).

Suggested sources (clear the license yourself before commercial use):
- YouTube Audio Library, Pixabay Music, Uppbeat, or a track you own.

Pick an energetic / cinematic instrumental ~30–60s; it loops automatically to fit the ad.
