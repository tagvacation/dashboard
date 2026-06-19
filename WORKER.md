# Web + Worker split (Railway)

Heavy generation (Veo polling, Imagen, **ffmpeg compositing**) used to run *inside* the Next.js
web process — which pegged CPU and made the dashboard crawl during a render. It now runs in a
separate **worker** so the dashboard stays responsive.

```
 ┌────────────┐  enqueue (status='queued')   ┌──────────────┐
 │  web (Next)│ ───────────────────────────▶ │  Postgres    │
 │  dashboard │ ◀─────────────────────────── │ pipeline_runs│
 └────────────┘     read status/progress     └──────┬───────┘
                                                     │ claim (FOR UPDATE SKIP LOCKED)
                                              ┌──────▼───────┐
                                              │   worker     │  Veo · Imagen · ffmpeg
                                              └──────────────┘
```

## How it works
- **web**: `/api/ads/generate` and `/api/pipeline/run` call `runOrEnqueue()`. With `USE_WORKER=1`
  they just set the `pipeline_runs` row to `status='queued'` and return instantly.
- **worker** (`npm run worker` → `scripts/worker.mts`): polls `claimNextJob()` (atomic, SKIP
  LOCKED), runs the right pipeline via `dispatchJob()`, one job at a time. Crash-safe: jobs left
  `claimed` for >5 min are requeued; mid-run crashes are left `failed` (never auto-re-run, to avoid
  double-spending Veo).
- **Fallback**: if `USE_WORKER` is **not** set, the API runs the pipeline **inline** (exactly the
  old behaviour) — so local dev and "no worker deployed yet" both keep working.

## Deploy on Railway (one project, $20 Pro, one account)
Both services use the **same repo / Dockerfile** — only the start command + one env var differ.

1. **web service** (your existing one)
   - Start command: default (`npm run start`)
   - Add env var: `USE_WORKER=1`
2. **worker service** (New Service → from the same repo)
   - **Custom Start Command**: `npm run worker`
   - Env vars (same as web): `DATABASE_URL`, `APP_ENCRYPTION_KEY` (to decrypt stored SA keys),
     and any others the pipeline needs. It does **not** serve HTTP, so no PORT/health route.
3. Both point at the **same Postgres** (shared) and the **same GCS** (per-user creds from the DB).

That's it — generation now happens on the worker; the web service only does DB reads/writes.

## Local
```bash
# terminal 1 — dashboard (inline mode, no worker needed)
npm run dev
# OR, to exercise the real split locally:
USE_WORKER=1 npm run dev      # terminal 1: enqueues
npm run worker                # terminal 2: drains the queue
```

## Notes
- `tsx` is a dependency now (runs the TS worker). The Docker image already `COPY . .` + `npm ci`,
  so `src/` and `tsx` are present in the image.
- Scale: the claim is `FOR UPDATE SKIP LOCKED`, so you can run **multiple** worker replicas safely
  if you ever need more throughput (each grabs different jobs).
- Also check your **Postgres region** matches the app region — cross-region DB latency (~300ms/query)
  is a separate cause of slowness the split doesn't fix.
```
