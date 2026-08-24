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
3. Drag **EC2**, **S3**, **VPC**, **Subnet** and **Security Group** nodes onto the
   canvas, connect dependencies (arrow = "depends on"), configure each node in
   the side panel
4. **Validate** compiles the graph to OpenTofu server-side and reports issues
5. **Save** stores a new immutable graph version
6. **Deploy** opens the live deployment view:
   - worker validates, prepares a workspace, runs `tofu init/validate/plan`
   - plan summary (create/update/destroy counts per resource) appears for review
   - you approve → worker runs `tofu apply` streaming progress until completion

#### Networking wiring rules

Edges are consumer → dependency. The graph validator enforces:

- a **subnet** must connect to exactly one **VPC**, and its CIDR must fall
  inside the VPC's block (`SUBNET_NO_VPC`, `SUBNET_MULTIPLE_VPCS`,
  `SUBNET_CIDR_OUTSIDE_VPC`)
- an **instance** may live in at most one subnet (`EC2_MULTIPLE_SUBNETS`)
- a **security group** must resolve to a VPC either directly (`sg → vpc`) or by
  inheritance through an attached instance's subnet (`SG_NO_VPC`)

The compiler turns these edges into real references: instances receive
`subnet_id` / `vpc_security_group_ids`, subnets receive `vpc_id`, security
groups get an explicit allow-all egress plus their configured ingress rules.

### Connecting your AWS account

Deployments run against **your** AWS account via cross-account role assumption.
Register an AWS connection in *Settings → AWS connections* (role ARN + external
ID), then use **Verify** to prove the chain end-to-end before deploying:
CloudMan calls `sts:AssumeRole` with your external ID and resolves
`sts:GetCallerIdentity` with the temporary credentials.

<details>
<summary>IAM trust policy runbook</summary>

In the target account, create a role (e.g. `CloudManDeployRole`) with a trust
policy that allows CloudMan's worker principal to assume it, conditioned on the
external ID you chose in the connection form:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<WORKER_ACCOUNT_ID>:root" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "sts:ExternalId": "<YOUR_EXTERNAL_ID>" }
      }
    }
  ]
}
```

Attach permissions the deployments need, e.g. for the current resource set:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateVpc", "ec2:DeleteVpc",
        "ec2:CreateSubnet", "ec2:DeleteSubnet",
        "ec2:CreateSecurityGroup", "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress",
        "ec2:Describe*", "ec2:CreateTags", "ec2:DeleteTags",
        "ec2:RunInstances", "ec2:TerminateInstances", "ec2:ModifyInstanceAttribute",
        "s3:CreateBucket", "s3:DeleteBucket", "s3:ListBucket", "s3:Get*",
        "s3:PutBucketVersioning", "s3:PutEncryptionConfiguration"
      ],
      "Resource": "*"
    }
  ]
}
```

Notes:

- Choose a random external ID (≥ 8 chars); it prevents the confused-deputy
  attack and is stored encrypted at rest when `CLOUDMAN_SECRET` is set on the API.
- Scope `Resource` tighter in production (specific VPC/bucket ARN patterns).

</details>

For local experiments you can instead set `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` on the worker env.

### State management

Each project gets a dedicated OpenTofu state backend: by default the worker
creates `s3://cloudman-tfstate-<projectId>` in the deployment region (in the
target account, via the assumed role) and writes a `backend.tf` with native S3
lockfile locking before `tofu init`. Destroy runs read state from the same
bucket, so teardown works even if the local workspace was wiped. State buckets
are retained after destroys for auditability — remove them manually if you
don't want them. Set `CLOUDMAN_REMOTE_STATE=0` on the worker to keep state in
the local workspace instead.

## Verification status

- `packages/core`: 27 unit tests (validation, cycles, topological order, IR defaults,
  CIDR math, networking wiring rules, compiled HCL assertions) — `bun test`
- Compiler output accepted by OpenTofu's own HCL parser (`tofu fmt -check` clean)
- Full lifecycle verified end-to-end (mock mode): canvas graph → queued → planned →
  approved → completed, with persisted audit trail and live SSE events
- Networking stack verified end-to-end (mock mode): vpc → subnet → security group →
  instance wiring, CIDR containment rejection, guarded deletes, destroy + workspace cleanup
- Ops hardening verified end-to-end (mock mode): guarded deletes, deployment
  cancellation at every stage, worker-restart reconciliation, encrypted external IDs
- Real mode verified up to the AWS boundary (graceful failure without credentials)

## Roadmap

- Cost estimation & risk analysis on plans
- AI-assisted graph generation (natural language → infrastructure graph)

## Scripts

| Command             | Purpose                          |
| ------------------- | -------------------------------- |
| `bun run check`     | Biome lint/format (write mode)   |
| `bun run check-types` | TypeScript across all packages |
| `bun test`          | Core domain tests                |
| `docker compose up -d` | Start MongoDB + Redis         |
