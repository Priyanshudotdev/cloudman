# CloudMan

> **CloudMan is a visual AWS infrastructure control plane** that lets developers design
> infrastructure on a node-based canvas, review the generated OpenTofu plan, and safely
> deploy it into their own AWS account.

Technically: CloudMan converts a visual infrastructure graph into an intermediate
representation (CloudMan IR), compiles it to OpenTofu, executes deployments through an
isolated worker using AWS STS AssumeRole, and streams deployment state back to the
frontend in real time.

## How it works

```
                USER
                 │
        ┌────────▼────────┐
        │  React Web App  │   drag/drop EC2 · S3, configure resources
        │  Visual Canvas  │
        └────────┬────────┘
           Graph JSON (REST)
        ┌────────▼────────┐
        │    API (Hono)   │   auth · projects · graphs · validation
        │  Graph Engine   │   compile preview · deployment control
        └───┬─────────┬───┘
            │         │  BullMQ (infra-plan / infra-apply)
     MongoDB│      ┌──▼──────┐
            │      │ Worker  │   workspace → STS AssumeRole
            │      │         │   tofu init/validate/plan/apply
            │      └──┬──────┘
            │         │ events (Redis pub/sub)
            │      ┌──▼──────┐
            │      │ API SSE │──► live deployment logs in browser
            ▼      └─────────┘
        Graph versions · Deployments · Plan summaries
```

Every deployment follows a strict lifecycle with **human approval** in the middle:

```
queued → initializing → planning → planned → awaiting_approval
       → [user reviews plan] → apply_queued → applying → completed | failed
```

## Monorepo layout

| Path                  | What it is                                                              |
| --------------------- | ----------------------------------------------------------------------- |
| `apps/web`            | Next.js 16 frontend — canvas editor, config panel, deploy drawer         |
| `apps/api`            | Hono control-plane API — REST + Better Auth + SSE                        |
| `apps/worker`         | Long-running worker — OpenTofu execution, STS AssumeRole                 |
| `packages/core`       | Domain engine: graph schema, validation, dependency resolution, **CloudMan IR**, IR→OpenTofu compiler |
| `packages/queue`      | BullMQ queue definitions + Redis pub/sub event bus                       |
| `packages/db`         | Mongoose models (projects, graph versions, deployments, AWS connections) |
| `packages/auth`       | Better Auth (email/password) on the MongoDB adapter                      |
| `packages/env`        | Type-safe environment schemas per app (`server`, `worker`, `queue`, `db`, `web`) |
| `packages/ui`         | Shared shadcn-style components                                           |

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Docker (for local MongoDB + Redis)
- OpenTofu binary for real deployments (`winget install OpenTofu.Tofu`, or set
  `CLOUDMAN_TOFU_AUTOINSTALL=1` on the worker to auto-download it)

## Getting started

```bash
bun install

# local infrastructure
docker compose up -d

# development (three shells, or use turbo)
bun run dev          # everything via turborepo
bun run dev:web      # http://localhost:3001
bun run dev:api      # http://localhost:4000
bun run dev:worker   # consumes infra-plan / infra-apply queues
```

Each app reads its own `.env` (see `.env.example`). The worker defaults to
`CLOUDMAN_WORKER_MOCK=0`; set `CLOUDMAN_WORKER_MOCK=1` to simulate tofu execution
without touching AWS.

## Using CloudMan

1. Sign up at `http://localhost:3001/login`
2. Create a project from the dashboard
3. Drag **EC2** and **S3** nodes onto the canvas, connect dependencies
   (arrow = "depends on"), configure each node in the side panel
4. **Validate** compiles the graph to OpenTofu server-side and reports issues
5. **Save** stores a new immutable graph version
6. **Deploy** opens the live deployment view:
   - worker validates, prepares a workspace, runs `tofu init/validate/plan`
   - plan summary (create/update/destroy counts per resource) appears for review
   - you approve → worker runs `tofu apply` streaming progress until completion

### Connecting your AWS account

Deployments run against **your** AWS account. Create an IAM role CloudMan may assume
(trust policy restricted by external ID) and register its ARN as an AWS connection;
the worker calls `sts:AssumeRole` per deployment and never stores long-term keys.
For local experiments you can instead set `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` on the worker env.

## Verification status

- `packages/core`: 15 unit tests (validation, cycles, topological order, IR defaults,
  compiled HCL assertions) — `bun test`
- Compiler output accepted by OpenTofu's own HCL parser (`tofu fmt -check` clean)
- Full lifecycle verified end-to-end (mock mode): canvas graph → queued → planned →
  approved → completed, with persisted audit trail and live SSE events
- Real mode verified up to the AWS boundary (graceful failure without credentials)

## Roadmap

- VPC / subnet / security-group resource types
- S3 state backend per project
- Cost estimation & risk analysis on plans
- AI-assisted graph generation (natural language → infrastructure graph)

## Scripts

| Command             | Purpose                          |
| ------------------- | -------------------------------- |
| `bun run check`     | Biome lint/format (write mode)   |
| `bun run check-types` | TypeScript across all packages |
| `bun test`          | Core domain tests                |
| `docker compose up -d` | Start MongoDB + Redis         |
