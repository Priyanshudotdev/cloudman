---
name: cloudman-conventions
description: CloudMan repo invariants and conventions. Use when adding or changing a resource kind, touching the graph/IR/compiler pipeline, writing API routes or worker jobs, editing deployment lifecycle or auth, or modifying config/registry files — i.e. any change to packages/core, packages/db, packages/queue, packages/auth, apps/api, apps/worker, or the resource catalog.
---

# CloudMan Conventions

CloudMan is a visual AWS control plane: a node canvas compiles to OpenTofu
(graph → IR → HCL/CloudFormation), deployed through a BullMQ worker that
assumes a customer's IAM role. Most of the ways to break it are consistency
failures across distant files, so read this before editing.

## When to use

- Adding or changing a resource kind, or anything in `packages/core/src/registry`
- Touching `graph/`, `ir/`, `compiler/`, `export/`, `cost/`
- Writing an API route (`apps/api/src/routes`) or worker job (`apps/worker/src/jobs`)
- Changing deployment lifecycle states, auth, or secret handling
- Editing `apps/web/src/lib/resource-catalog.ts`, `packages/db`, `packages/queue`
- Touching turbo/docker/vercel/railway config or env schemas

## Layout

```
apps/web      Next.js 16 frontend, canvas editor (:3001)
apps/api      Hono control plane, REST + SSE + Better Auth (:4000)
apps/worker   BullMQ consumer: OpenTofu execution, SSH repo deploys
packages/core graph schema, validation, IR, HCL + CFN compiler, cost, risk, blueprints
packages/db   Mongoose models + AES-256-GCM secret helpers
packages/queue BullMQ queues + Redis pub/sub event bus
packages/auth Better Auth factory (Mongo adapter)
packages/repo repo-deploy domain: stack detection, build recipes, runtime rendering
packages/env  t3-env schemas (server | web | worker | queue | db)
packages/ui   shadcn-style components
```

## The pipeline is the contract

`validateGraph()` → `buildIR()` → `compileIR()` / `exportCloudFormation()` /
`estimateCost()` / `analyzeRisks()`. IR is the single fan-out point; nothing
downstream re-reads the graph.

Edges are **consumer → dependency**: `{source, target}` means "source depends
on target", so the target is emitted first. Validation is rule-based with error
codes (`SUBNET_CIDR_OUTSIDE_VPC`, `SG_NO_VPC`, `LAMBDA_NO_REPOSITORY`, …) —
when you add a wiring rule, add the code to `graph/validate.ts` **and** a test.

## Adding a resource kind: six places

Miss one and the failure is silent (each site has a `default` that returns
nothing). Update all of:

1. `packages/core/src/registry/resources/<kind>.ts` — `z.strictObject` schema +
   `defineResource({ type, tofuKind, label, category })`. Export the option
   arrays so the UI and prompt can reuse them.
2. `packages/core/src/registry/index.ts` — import, add to the registration
   array, re-export the config type.
3. `packages/core/src/ir/transform.ts` — `mapAttributes` switch: camelCase →
   snake_case. Encode references as `*_ref` / `*_refs` holding **graph node
   ids**, never addresses.
4. `packages/core/src/compiler/index.ts` — a `writeX` in the `compileIR` switch.
   Resolve cross-resource references with `refAddress()` / `refAttr()`; both
   throw on an unknown id. Use `hclString()` for user data and
   `hclInterpString()` **only** for interpolations you construct yourself.
5. `packages/core/src/export/cloudformation.ts` — `KIND_PREFIX` entry plus a
   `resourceBlocks` branch. Keep it semantically equivalent to the HCL backend;
   `conformance.test.ts` compares them.
6. `apps/web/src/lib/resource-catalog.ts` — UI spec (icon, accent, idPrefix,
   fields).

Then: run `bun run generate-catalog` in `apps/web` (regenerates
`resource-catalog.generated.ts` from the zod schemas) and keep the hand-written
field list in sync. If a catalog option isn't in the schema enum, saving the
graph 422s — the catalog must be a subset of the schema, never wider.

## Deployment lifecycle

```
queued → initializing → planning → awaiting_approval → apply_queued → applying → completed | failed
                                                                                  ↘ canceled (pre-apply only)
```

- `planned` was removed: do not reintroduce it.
- `awaiting_approval` is the human gate. API allows cancel only before
  `apply_queued`; there is **no mid-apply cancel**, and apply re-checks
  `canceled` before starting and before marking completed.
- Transitions use CAS: `updateOne({_id, status: <expected>})` plus a
  `modifiedCount === 0` → 409 check. Don't reintroduce read-then-write.
- Queues run `attempts: 1` — recovery is manual via `POST /:id/retry`, which
  must `remove()` the retained BullMQ job (same `jobId` = deployment `_id`)
  before re-adding.
- Every worker job: guard on expected status, wrap in try/catch, set both the
  `error` field and a failure event, rethrow.

## Testing

- `bun test` in `packages/core` and `packages/repo` — no infra needed.
- `apps/api` and `apps/worker` suites need **live MongoDB + Redis**
  (`docker compose up -d`; they use `cloudman_test` / `cloudman_test_worker`
  and separate Redis DBs). Any new deploy path needs a mock-mode test with
  `CLOUDMAN_WORKER_MOCK=1`. Mock mode still writes workspaces and events, so
  assertions on files/events are valid there.
- Bun-specific shim: `process.getBuiltinModule` must return `undefined` for
  `"v8"` or bson 7 throws at import. Already done in both e2e files.
- HCL assertions are `toContain` on formatted text — whitespace-alignment
  changes break tests. Prefer asserting semantics where possible.
- `bunx turbo run check-types`; Biome is non-blocking in CI today.

## Auth and secrets

- `requireAuth` returns 401 without a session. The shared-anon fallback exists
  only behind `ALLOW_ANON=1` (local dev). Never enable it in production —
  every visitor would share one workspace, including stored AWS role ARNs and
  decrypted SSH keys.
- Scope every query by owner: use the `loadOwnedProject` / `loadOwnedDeployment`
  helpers, or filter `{_id, userId: c.get("userId")}` for connections/servers.
  "Not found" and "not yours" both return 404.
- `CLOUDMAN_SECRET` (64 hex chars) encrypts external IDs and SSH credentials
  (AES-256-GCM, `enc:v1:` prefix). Unset means plaintext storage and a loud
  warning — treat a missing value in production as a deploy blocker.
- Never log secret values. `tofu` output is streamed into events verbatim.
- SSH host keys are trust-on-first-use: verify stores the fingerprint, a
  mismatch on later connections is refused.

## Commands

```bash
bun install
docker compose up -d                                  # mongo + redis
bun run dev                                           # turbo: web + api + worker
bun run dev:web                                       # :3001
bun run dev:api                                       # :4000
bun run check-types                                   # tsc across workspaces
bunx turbo run test                                   # all suites (needs mongo+redis)
bun run check                                         # biome --write (mutates!)
bunx biome check .                                    # read-only lint
cd apps/web && bun run generate-catalog               # after zod schema changes
bunx tofu fmt -check -diff apps/worker/**/main.tf    # if tofu is installed
```

## Conventions

- Tabs for indentation, double quotes (Biome). Run `bun run check` on files you
  touch — note it **writes**.
- `packages/config/tsconfig.base.json` is the shared strict baseline.
  `apps/web/tsconfig.json` is standalone and weaker (`noUncheckedIndexedAccess`
  etc. do not apply there) — don't assume parity.
- Topo-deploy: web → **Vercel** (`vercel.json`); api + worker → **Railway**
  (Root Directory = repo root, Config File Path = `apps/<svc>/railway.json`);
  everything → Docker (`docker-compose.prod.yml` + `.env.production.example`).
  Railway has no volumes: keep `CLOUDMAN_REMOTE_STATE=1`.
- Adding an env var means updating **all** of: its schema in `packages/env/src/*`,
  `turbo.json` `globalEnv`, `.env.example`, and `.env.production.example`.
- Internal packages are still `@my-better-t-app/*`; the root package name has
  not been renamed. Don't start a rename mid-change.
- No `TODO`/`FIXME` markers are used in this repo; unfinished work is
  described in doc comments or the README roadmap.

## Auditing with the bundled skills

- `owasp-security` — security review (OWASP Top 10:2025, ASVS, LLM/agentic).
  Run it on anything touching auth, secrets, SSH, HCL emission, or the
  OpenRouter prompt path.
- `web-design-guidelines` — UI/accessibility review of `apps/web` + `packages/ui`.
- `vercel-react-best-practices` — React/Next performance.
- `vercel-composition-patterns` — component API design.
- `turborepo` — task graph, caching, CI.
- `code-review` — diff/PR review workflow.