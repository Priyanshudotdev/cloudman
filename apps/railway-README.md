# Railway deployment notes

`api` and `worker` deploy to Railway; the web app deploys to Vercel (see
`vercel.json` at the repo root).

## Required service settings

Set these in the Railway dashboard per service — they are **not** recorded in
`railway.json`, because Railway reads that file from the service's configured
Root Directory:

| Setting           | Value                      |
| ----------------- | -------------------------- |
| Root Directory    | repository root            |
| Config File Path  | `apps/api/railway.json` (or `apps/worker/railway.json`) |

The build/start commands assume the repo root as cwd, so they run without a
`cd`. The worker image from Nixpacks ships no OpenTofu binary.

## Worker environment

- `CLOUDMAN_REMOTE_STATE=1` (default) — Railway has no persistent volumes, so
  OpenTofu workspaces are ephemeral. Keeping remote state on means a destroy
  still works after a redeploy, because state lives in the per-project S3
  bucket rather than the wiped local workspace.
- `CLOUDMAN_TOFU_AUTOINSTALL=1` — required for real (non-mock) deployments,
  since the image has no `tofu`. Leave `CLOUDMAN_WORKER_MOCK=1` to rehearse the
  full lifecycle without touching AWS.
- `CLOUDMAN_SECRET` — 64 hex chars, shared with the API. Without it the API
  refuses to store AWS external IDs and SSH credentials (503) rather than
  writing them in plaintext.

See `.env.production.example` for the full variable list.