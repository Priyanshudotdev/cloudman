# Deploying a User's App from GitHub with CloudMan — Research

**Goal:** Allow a user to paste a **GitHub repository URL** into CloudMan and have CloudMan
deploy their application (e.g. a **React** frontend + **Express** backend) to AWS with all the
infrastructure (VPC, compute, load balancer, CDN, DNS) provisioned, generated, and managed by
CloudMan's IaC engine.

**Example asked by the user:** *"I have a React app with an Express server — it should deploy the
React app and the server from the GitHub URL."*

This document summarizes the research: how this works in the AWS ecosystem generally (with
references), how it maps onto **CloudMan's current architecture**, and the concrete work required
to add this capability.

---

## 1. TL;DR — Is this possible today with CloudMan?

**Partially — but not end-to-end.** CloudMan already:

- ✅ Generates real **OpenTofu HCL** from a visual resource graph (`packages/core/src/compiler`).
- ✅ Executes **`tofu plan` / `tofu apply`** in an isolated workspace via BullMQ worker jobs
  (`apps/worker/src/jobs/plan.ts`, `jobs/apply.ts`, `lib/tofu.ts`).
- ✅ Supports compute resources: **`aws_ecs`** (Fargate), **`aws_lambda`**, **`aws_ecr`**,
  plus VPC/subnet/SG, S3, IAM, Route 53, RDS, ALB, CloudFront-style networking, etc.

❌ **What does NOT exist yet** (confirmed by searching the whole repo):

- **No git-clone logic** — nothing fetches a user's source repo.
- **No build step** — nothing compiles a React app (`npm run build`) or containerizes an
  Express app (`docker build`).
- **No artifact upload** — CloudMan's `aws_ecs` expects a **pre-built ECR image** and
  `aws_lambda` (zip mode) expects a **pre-uploaded S3 object**. There is no code that pushes an
  image to ECR or uploads a zip to S3 on the user's behalf.

So CloudMan can **provision and manage the infrastructure**, but today the user has to bring
their own pre-built image/artifacts. The feature you're describing adds the **upper CI/CD half**:
**source → build → publish → deploy**, on top of the IaC half CloudMan already has.

---

## 2. The canonical AWS architecture (with references)

The industry-standard pattern for "deploy a React + Express app from GitHub" splits the app into
two independent deployables:

| Piece | Runs where | Why |
|---|---|---|
| **React frontend** (static files) | **S3 + CloudFront** | Static hosting + global CDN, HTTPS, SPA routing |
| **Express backend** (Node HTTP service) | **ECS Fargate** (containerized, via **ECR**) | Long-running server, scales, managed |
| **CI/CD** | **CodePipeline + CodeBuild** | Clone GitHub → build → push image to ECR / upload `dist/` to S3 → deploy |
| **DNS / TLS (optional)** | **Route 53 + ACM** | Custom domain + SSL |

### 2.1 Backend — Express on ECS Fargate via ECR

Flow: GitHub push → CodePipeline triggers → CodeBuild does `docker build` + `docker push` to
**ECR** → writes `imagedefinitions.json` → CodePipeline deploy stage updates the **ECS service**
(which pulls the new image). Reference buildspec:

```yaml
version: 0.2
phases:
  pre_build:
    commands:
      - aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
  build:
    commands:
      - docker build -t my-app .
      - docker tag my-app:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/my-app:latest
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/my-app:latest
      - printf '[{"name":"my-app-container","imageUri":"%s"}]' $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/my-app:latest > imagedefinitions.json
artifacts:
  files:
    - imagedefinitions.json
```

Then ECS runs the container from ECR behind an **Application Load Balancer** (ALB), with the
task definition referencing the ECR `imageUri`.

### 2.2 Frontend — React on S3 + CloudFront

Flow: GitHub push → CodePipeline triggers → CodeBuild runs `npm ci` + `npm run build` →
`aws s3 sync dist/ s3://bucket --delete` → `aws cloudfront create-invalidation`. Reference:

```yaml
version: 0.2
phases:
  install:
    runtime-versions:
      nodejs: 18
  pre_build:
    commands:
      - npm ci
  build:
    commands:
      - npm run build
  post_build:
    commands:
      - aws s3 sync ./dist s3://my-frontend-app/ --delete
      - aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
artifacts:
  files: '**/*'
  discard-paths: no
```

Key frontend details (from research):
- **SPA routing:** unknown routes must fall back to `index.html` (custom error page for S3 /
  CloudFront function).
- **Cache headers:** hashed assets (`main.a1b2c3d4.js`) get `Cache-Control: public,
  max-age=31536000, immutable`; `index.html` gets `no-cache`.
- **API base URL:** bake `REACT_APP_API_BASE_URL` / `VITE_API_BASE_URL` into the build at
  compile time so the frontend knows where the Express API lives.
- **CORS:** Express must allow the CloudFront origin explicitly.

### 2.3 Why treat frontend and backend separately?

- React build output is static files — serving them from S3 behind CloudFront is cheaper,
  globally faster, and infinitely scalable vs. putting them in the container.
- The Express server is a long-running HTTP service that needs a managed compute platform
  (ECS Fargate) — it is a different concern.
- Hosting both in one container works locally but discards CDN/static-hosting benefits.

*(References section 6 lists the primary sources for these pipelines.)*

---

## 3. CloudMan current architecture (what we're building on)

### 3.1 Monorepo layout (Turborepo)

```
apps/
  api/        Hono REST API (projects, compile, deploy, analytics, generate, aws connections)
  web/        Next.js UI (canvas editor, project home, deploy history, settings)
  worker/     BullMQ job worker (plan/apply) → runs `tofu`
packages/
  core/       The IaC engine: registry → graph → IR → OpenTofu HCL / CloudFormation
  db/         Mongoose models (project, deployment, aws-connection, ...)
  queue/      BullMQ queue + event types (plan queue, apply queue, maintenance queue)
  auth/  config/  env/  ui/
```

### 3.2 The core IaC engine (`packages/core`)

Pipeline: **resource registry → graph → IR (`buildIR`) → `compileIR` → HCL files** (and a
CloudFormation export).

- Registry of resource types with **zod schemas** in `packages/core/src/registry/resources/*`
  e.g. `ecs.ts`, `ecr.ts`, `lambda.ts`, plus VPC, subnet, SG, IAM, S3, RDS, Route53, ALB.
- Compiler at `packages/core/src/compiler/index.ts` generates `*.tf` HCL. For ECS it emits an
  `aws_ecs_task_definition` whose `image_uri` is wired to the **ECR `repository_url`**
  (compiler/index.ts ~695, 826-829), or a literal `image` override on the ECS resource.

**Critical finding:** the ECS `image_uri` and Lambda zip `s3` code both assume the artifact
**already exists** in ECR/S3. `packages/core/src/registry/resources/ecs.ts` has fields
`imageTag`, `image` (literal override); `lambda.ts` has `codeSource: image|zip`, `s3CodeBucket`,
`s3CodeKey`. **There is no `sourceRepo` / `buildCommand` / `dockerfile` concept today.**

### 3.3 Execution (`apps/api` + `apps/worker`)

- API routes include `compile.ts` (returns generated files + cost + risks), `deployments.ts`
  (plan/apply via `getPlanQueue`/`getApplyQueue`, SSE event streaming), `projects.ts`,
  `analytics.ts`, `generate.ts` (blueprint templates).
- Worker (`apps/worker/src/jobs/plan.ts`, `jobs/apply.ts`) shells out to OpenTofu via
  `lib/tofu.ts` (`runTofu` → `spawn`), writing state through `lib/state-backend.ts` and
  streaming events via `lib/events.ts` / `packages/queue`.
- AWS credentials come from the user's stored **AWS connection** (`aws-connection` model),
  used to build the OpenTofu backend/provider env.

### 3.4 Compute resources today

- **`aws_ecs` (Fargate):** takes `cpu`, `memory`, `containerPort`, `desiredCount`, `imageTag`,
  optional literal `image`. Task definition `image_uri` couples to the wired ECR repo.
- **`aws_ecr`:** holds Docker images (with `scanOnPush`, `tagMutability`).
- **`aws_lambda`:** `image` or `zip` code source; zip needs `s3CodeBucket`/`s3CodeKey`.

---

## 4. How to add "Deploy from GitHub URL" to CloudMan

Because CloudMan already owns infra generation + OpenTofu execution, the new capability is the
**CI/CD "source→artifact" leg**. There are **three viable approaches**, from least to most code.

### Approach A (Recommended, lowest friction) — CloudMan provisions CodePipeline/CodeBuild, GitHub does the CI

**Big idea:** CloudMan generates *the CI/CD infrastructure* as OpenTofu (CodePipeline +
CodeBuild + IAM roles), which watches a GitHub repo and builds/deploys the app automatically.
The Express app builds to **ECR/ECS** (Fargate + ALB); the React app builds to **S3 + CloudFront**.
CloudMan still manages state, plan, apply, and the app stack — but the actual commit→build→push
happens inside AWS CodeBuild/CodePipeline.

Does CloudMan need to run git/docker on the worker? **No** — AWS does the cloning and building.

**What to add:**

1. **New registry resources** (new `packages/core/src/registry/resources/*.ts`):
   - `aws_codebuild_project` (source = GitHub `location` = repo URL, `buildspec`).
   - `aws_codepipeline` (Source stage = GitHub → Build stage = CodeBuild → Deploy stage = ECS/S3).
   - `aws_codeconnections_connection` (or a CodeStar/GitHub connection) for GitHub auth.
   - `aws_s3_bucket` + `aws_cloudfront_distribution` for the frontend (S3 static + OAC origin).
2. **Extend the ECS/Lambda/S3 resource schemas** with a "source" attachment:
   ```ts
   // pseudo-schema addition
   source: {
     repoUrl: z.string().url(),          // https://github.com/owner/repo
     branch: z.string().default("main"),
     buildCommand: z.string().default("npm run build"),
     artifactPath: z.string().default("dist"),  // frontend
     // OR
     dockerfilePath: z.string().default("Dockerfile"), // backend
   }
   ```
3. **Compiler** (`packages/core/src/compiler`): when a compute/frontend resource carries a
   `source`, emit the CodeBuild/CodePipeline buildspec + pipeline wiring in addition to the app
   resources. CloudMan's `compileIR` already returns file lists — just add these files.
4. **UI:** in the canvas, add a "Source repo" section on ECS/Lambda/S3 nodes (paste GitHub URL,
   branch, build command). Let user pick the blueprint, then attach the repo.
5. **Worker:** no code needed for CI in Approach A (OpenTofu just `apply`s the pipeline). The
   existing plan/apply path already deploys the pipeline.

**Trade-off:** the user must give CloudMan/CodePipeline a GitHub *connection* (a one-time AWS
CodeConnections auth), but CloudMan does not need Docker/git on the worker. This is the cleanest
"set it and it keeps deploying on every push" experience.

---

### Approach B — Worker-host build (CloudMan clones + builds + pushes)

CloudMan's *worker* does the clone/build and uploads artifacts itself, then CloudMan runs
`tofu apply` referencing them.

**Flow:** user clicks Deploy → API enqueues a new `BUILD` job → worker:
1. `git clone <repoUrl>` into the workspace (needs `git` on the worker host).
2. For backend: `docker build` + `docker push` to the ECR repo CloudMan generated (needs
   `docker` + AWS CLI + credentials on the worker host).
3. For frontend: `npm ci` + `npm run build`, then `aws s3 sync` to the S3 bucket + CloudFront
   invalidation.
4. Then the existing plan/apply jobs run OpenTofu against the stack (ECS task def now points at
   the freshly-pushed ECR image).

**What to add:**
- New worker job processor (`apps/worker/src/jobs/build.ts`) registered in `apps/worker/src/index.ts`.
- New queue (or extend `MaintenanceJobData`/add `BuildJobData` in `packages/queue/src/types.ts`).
- A `source` field on ECS/Lambda/S3 resources (as in Approach A) so the compiler/API knows the
  repo URL + build command.
- CLI tooling available on the worker host (git, docker) — operational dependency.

**Trade-off:** more moving parts and needs Docker/git on the worker; but CloudMan fully owns the
pipeline and stays independent of AWS CodePipeline/CodeConnections.

---

### Approach C — Bring-your-own-artifact (smallest change, "thin" support)

CloudMan just gains the ability to *reference* artifact locations a user already published:
- ECS: let `image` point at any ECR/DockerHub URI (`myapp:latest`, or a public image).
- Lambda zip: provide `s3CodeBucket`/`s3CodeKey`.
- React: host the static files in a bucket that the user (or an external GitHub Action) fills.

This is mostly a **UI + validation** change and requires no new pipelines or worker build code —
but it does *not* satisfy "deploy from the GitHub URL" automatically. Good as an incremental
step / fallback, not the headline feature.

---

## 5. Recommended implementation path (Phased)

Given CloudMan already generates infra and runs OpenTofu, I recommend **Approach A first**:

1. **Data model:** add `source` (repoUrl, branch, buildCommand, artifactPath, dockerfilePath) to
   the `Project` / resource configs in `packages/db` and to the core zod schemas.
2. **Registry + compiler:** new `aws_codebuild_project` / `aws_codepipeline` / `aws_codeconnections`
   / CloudFront resources; extend `compileIR` to emit buildspec + pipeline HCL when a resource
   has a `source`.
3. **Worker:** no change (OpenTofu applies the pipeline). Verify plan/apply handles the added
   resources.
4. **API:** accept GitHub repo URL + branch in the project/compile/deploy payloads; validate
   the URL; return the pipeline outputs (CloudFront URL, ALB/ECS endpoint) as deploy outputs.
5. **UI:** "Import from GitHub" flow — paste repo URL, choose stack (React static / Express
   container / full-stack), pick branch, and let CloudMan synthesize the graph + pipeline.
   Show live build status from CodeBuild and the app URLs after deploy.
6. **Auth for private repos:** a GitHub PAT / GitHub App connection (or AWS CodeConnections)
   stored on the `aws-connection` (or a new `source` model) — start with public repos only.

The full-stack "React + Express from one GitHub URL" default stack:
- **Express** → ECS Fargate (port from `PORT`/`containerPort`), behind an ALB, image built to
  the CloudMan-provisioned ECR repo.
- **React** → S3 + CloudFront, SPA fallback, hashed-asset caching, `REACT_APP_API_BASE_URL` set
  to the ALB/API URL, CORS open to the CloudFront origin.
- **Infra** → VPC + subnets + SG + IAM wired by the existing engine, all in one OpenTofu apply.

---

## 6. References

### Primary AWS pipeline patterns
- **AWS Prescriptive Guidance — Deploy a React SPA to S3 + CloudFront**:
  https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/deploy-a-react-based-single-page-application-to-amazon-s3-and-cloudfront.html
- **AWS Containers Blog — CI/CD pipeline for ECS with GitHub Actions + CodeBuild** (ECR→ECS,
  task-definition deploy, webhook triggers):
  https://aws.amazon.com/blogs/containers/create-a-ci-cd-pipeline-for-amazon-ecs-with-github-actions-and-aws-codebuild-tests/

### Tutorials / guides (React + Express full-stack on AWS)
- **Detailed full-stack guide — Node/Express on ECS Fargate via CodePipeline/CodeBuild/ECR/ALB
  AND React/Angular on S3 + CloudFront** (buildspec YAML for both):
  https://gist.github.com/usmanshaikh/519fa5c560e62aa7e8e3c257fdc73f9e
- **React deploy with CodePipeline + CodeBuild + S3 + CloudFront (GitHub source, cache
  invalidation Lambda, custom domain / Route53 / ACM)**:
  https://github.com/davidYichengWei/Deploy-React-App-to-AWS-with-CI-CD-pipeline
  (and mirror: https://github.com/julien-muke/aws-codepipeline-react-s3)
- **React to S3 + CloudFront with GitHub Actions OIDC (no long-lived keys)**:
  https://dev.to/franciscogsilverio/automating-react-app-deployments-to-aws-with-github-actions-and-oidc-3487
- **S3 + CloudFront caching strategy for Vite/CRA (immutable hashed assets, no-cache index.html,
  invalidation, OAC private bucket)**:
  https://shortiq.io/blog/deploy-react-aws-s3-cloudfront

### React+Express deployment split (frontend vs backend as separate concerns)
- https://codemia.io/knowledge-hub/path/how_to_deploy_a_react_nodejs_express_application_to_aws
- https://gist.github.com/rmiyazaki6499/b564b40e306707c8ff6ca9c67d38fb6f (EC2 + PM2 variant)

### OpenTofu-adjacent
- **OpenTofu official**: https://github.com/opentofu/opentofu
- **OpenTofu + GitHub Actions (OIDC, plan-on-PR / apply-on-merge)**:
  https://oneuptime.com/blog/post/2026-02-23-use-opentofu-with-github-actions/view
- **ECS Fargate with OpenTofu (cluster, task def, ALB, `lifecycle ignore_changes` for image
  deployments)**:
  https://oneuptime.com/blog/post/2026-03-20-deploy-ecs-service-opentofu/view

---

## 7. Open questions / decision points

Before implementing, a few scoping choices need confirming:

1. **CI engine:** AWS **CodePipeline/CodeBuild** (Approach A, recommended) vs. **worker-host
   git+docker builds** (Approach B) vs. **bring-your-own artifact** (Approach C)?
2. **Public vs private repos:** private repos need a GitHub token / CodeConnections auth.
3. **One repo vs separate repos** for frontend and backend (monorepo with `client/` + `server/`,
   or two repos)?
4. **Deployment shape baked into the resource graph** (infra drawn on the canvas, repo attached
   to compute nodes) vs. **fully auto-synthesized** from a "paste repo URL" flow?
5. **Project-scoped vs per-deploy repo:** store `source` on the Project (one repo per project) or
   on each Deployment (per-deploy, like the existing `awsConnectionId`)?

---

*Research prepared for the CloudMan repo. Scope: feasibility + architecture mapping + concrete
implementation paths. Next step (on confirmation of the above choices): produce a detailed
implementation plan with exact file-by-file changes and a phased milestone list.*
