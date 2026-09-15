# AI generation jobs

The job model behind every generative door (AGL-2904): one customer brief
carried through one or more model steps by a Firestore state machine, so that
work longer than a request survives the request. The console route runs what
it can inline; the platform job beat resumes whatever is left. The document is
the whole state — no process holds anything the next beat cannot read back.

Code, all in the AI plugin (`libs/plugins/ai`, AGL-2939):
`src/lib/model/ai-jobs.types.ts` (the model),
`src/lib/jobs/ai-jobs.ts` (the machine, the step registry, the sweep),
`src/lib/jobs/ai-job-text-step.ts` and `src/lib/jobs/ai-job-theme-step.ts`
(the `text` and `theme` steps),
`src/lib/jobs/ai-job-plan-step.ts` (the plan step every planned kind runs first),
`src/lib/server/ai-jobs-route.ts`, `ai-jobs-events-route.ts`,
`ai-jobs-cancel.ts` and `ai-jobs-resume.ts` (the doors, registered on the
console dispatcher by `src/lib/server.ts`), `src/lib/jobs/ai-jobs-beat.ts` (the
beat). The building doctrine every generator runs through is
`src/lib/runtime/ai-doctrine.ts`, with its validators in
`src/lib/runtime/ai-doctrine-validators.ts` (below).

## Outputs are drafts, never a publish

Every output a job produces is a new draft or a new unpublished version of an
existing resource. A job never flips a version pointer, never registers a
route and never sends anything; a person opens the draft the job names and
publishes it through the door that already exists for that resource. That is
what lets a job run with no visitor, no session and no confirm gate: the thing
it writes cannot be seen by anyone but the workspace until a member chooses
otherwise. The `text` kind has no document of its own and carries its copy on
the output itself. The `theme` kind writes nothing at all: its output carries
a proposal, which a person puts in the theme editor and saves there.

## The document

`orgs/{orgId}/aiJobs/{jobId}` — member-readable, server-written only (the
rules deny every client write). Fields:

| field | meaning |
| --- | --- |
| `kind` | `AiJobKind` — what the job produces. `text` and `theme` have runners; every other kind fails fast with "not available yet" until its own issue lands. |
| `status` | `queued` → `running` → `done` / `failed` / `canceled`, with `needs_input` and `needs_review` as the two parked states (below). |
| `brief`, `inputs` | The customer's brief verbatim and the kind-specific scalars a runner reads. |
| `steps[]` | The step plan: `name`, `status`, `startedAt`/`endedAt`, `creditsSpent`, `attempts`, a customer-safe `error`. |
| `outputs[]` | What the job wrote, addressed by `resource` + `id` (+ `versionId`, `hostId`, `hostSubdomain`) so the console can build an "open draft" link without knowing what the runner did. A console URL names a site by its subdomain, so a link is built from `hostSubdomain` and an output without one gets none. A page's document carries its estimated first-visit `load`. |
| `plan` | The plan a planned kind builds from: `reuse`, `create`, `screens`, the inventory `labels` it references, and `status` `proposed` → `confirmed` with who confirmed it and when. |
| `review` | While the job is `needs_review`: the `reason` (`plan` or `doctrine`), the customer-safe `message`, and the rules the last answer broke. |
| `creditsReserved`, `creditsSpent` | A nominal hold per outstanding step, and the real spend at the plan's credit rate. |
| `lease` | `{ owner, until }` while a step runs — see below. |
| `expiresAt` | 180 days from creation, the assist exchange's clock: the brief is verbatim customer text (`docs/DATA_RETENTION.md`). |
| `error` | Customer-safe only. Provider detail goes to the server log beside the ids. |

## The lease

A step runs under a lease: an owner id and an `until` instant 90 s out. The
console route and two overlapping beats can all look at one job inside the
same minute, and only one of them may spend the reservation for its step. A
claim is a transaction (`claimNextStep`) that refuses while another owner's
lease is live; an expired lease is simply claimable, which is how a step
abandoned by a frozen process is recovered — the stale lease is released by
being taken, not by a sweep of its own. `heartbeatStep` extends a lease a long
step still holds, and refuses once someone else has recovered it.

## Credits, per step

`runAiJobStep` is the one place a step is claimed, metered, run and recorded,
in that order:

1. claim the lease (a refused claim costs nothing);
2. `reserveAssistMessage` — the same read-and-increment transaction the chat
   route takes, so a job cannot slip past the org's monthly ceiling by being
   asynchronous. The console route's gate ladder takes this reservation
   before the job exists and hands it to the first step; every later step
   reserves for itself;
3. run the step's registered runner;
4. `recordAssistCost` at the serving model's rates, so the usage rollup and
   the invoice see a job's tokens exactly as they see a chat turn's;
5. record the step: its credits, its outputs, one `adminAudit` row
   (`ai.job.output`) per output.

A refused reservation is not a failure. The org is out of credits, over its
cap or has switched overage off — all things a member can change — so the job
parks as `needs_input` with the refusal in customer-safe words, and the beat
re-queues it once it has rested an hour. `failed` is reserved for a step that
cannot succeed by waiting: a kind with no runner, a provider failure that is
not retryable, a model refusal (which is metered — tokens were spent), a step
that got nothing usable out of the model's answer (metered too, with the
step's own `failure` sentence), or a step that has exhausted its attempts. A
retryable failure or a budget that ended first hands the message back and
re-queues the step, and so does a step that fails before it reaches the
provider — its outcome carries no tokens and no cost, so nothing is metered.

A step runner writes drafts and returns. It does not touch the job document,
the meter or the lease.

## Planning, and a job that waits for a person

A job whose kind builds site structure (`AI_PLANNED_JOB_KINDS`: page, site,
component, layout, template, form, email) runs a `plan` step first, once its
generation runner is registered — until then the kind fails fast and free, as
before. The plan step reads the site inventory and asks for a typed plan
through `runValidatedGeneration('plan', …)`. What it returns is recorded like
any step's result, and then the job stops for a person: it parks as
`needs_review` with the plan on the document.

`needs_review` is a different state from `needs_input` on purpose. The beat
re-queues `needs_input` hourly, because the org's standing may have changed;
nothing a timer does can confirm a plan, and re-running a step whose answer
broke a building rule twice would spend again on the same refusal. So neither
beat query matches `needs_review`, and only a member resumes it:

- **reason `plan`** — the plan step completed; confirming marks the plan
  `confirmed` and runs the generation step, which executes the plan;
- **reason `doctrine`** — an answer broke a building rule on its re-ask; the
  step went back to `pending` with its spend recorded, and trying again runs
  it once more with its attempts started over.

`resumeAiJob` is that transition, in one transaction, and cancel ends either.

## The building doctrine

Every generator — the plan step today, the page, component, layout, template,
form and email generators after it — calls `runValidatedGeneration(kind, …)`
from `src/lib/runtime/ai-doctrine.ts` rather than `runAiRequest` directly:

```ts
runValidatedGeneration('plan', input: AiPlanGenerationInput): Promise<AiValidatedGeneration<AiBuildPlan>>
runValidatedGeneration(kind: AiOutputKind, input: AiTreeGenerationInput): Promise<AiValidatedGeneration<AiValidatedTree>>
runValidatedGeneration<T>(kind: string, input: AiCustomGenerationInput<T>): Promise<AiValidatedGeneration<T>>
```

The input names the routing `step`, the door's static `instructions`, the
site `inventory` (`readSiteInventory(orgId, hostId)`), the `messages`, the
strict `tool`, and optionally `maxTokens`, `thinking`, `effort` and `signal`.
A tree kind may add `context` (asset sizes, the brand, embeds, framing) and
`otherPages`; the doctrine's own checks always run for `plan` and the six
palette kinds, and a door can only `extend` them. A kind the doctrine has no
reader for (a theme change, an edit) brings its own `check`, and rule 13 is
still held on its answer.

The loop sends, in cache order: the doctrine block (cached, identical for
every org, with the acceptable-use rules), the door's instructions, the
surface's palette catalog (cached), and the compact site inventory
(volatile). It checks the answer; on a violation it asks once more with the
broken rules named and only the offending parts quoted; when the second
answer still breaks a rule it returns `needs_input` with a customer-safe
message. Every attempt's tokens are summed on the result, and the job
machine meters them. The result is `ok` with the value, `needs_input` with
the violations, or `refused`.

The validators hold the seventeen rules by construction: one detector per rule
for trees and plans, each naming its rule number and a customer-safe sentence,
and the rule-17 scorer, which measures nodes, stored bytes (`nodeMapBytes`),
image bytes, embeds, font families and an email's rendered HTML against
`AI_OUTPUT_BUDGETS` in `runtime/ai-palette.ts`. A page's estimated load starts
from `ESTIMATED_PAGE_TRANSFER_BYTES`, the measured weight of a published page.

## The doors

Registered under `/api/ai/jobs` by the plugin's console API surface:

- `POST /api/ai/jobs` `{ orgId, hostId?, kind, brief, inputs? }` climbs the
  whole gate ladder (`aiGenerative`, `release_ai_generative`, the `ai-generate`
  switch, the `ai.generate` permission, a per-uid window, a reservation),
  creates the job and runs its first step inline under a 25 s budget. A step
  that finishes in time answers with the job `done`; one that does not is
  aborted, re-queued, and answers `queued` for the beat. A `theme` job must
  name its site.
- `GET /api/ai/jobs?orgId=` lists the org's jobs newest first.
- `GET /api/ai/jobs/{jobId}/events?orgId=` is server-sent events: a `state`
  frame now, a re-read every 2 s that emits on change, `reconnect` at 55 s.
- `POST /api/ai/jobs/{jobId}/cancel` `{ orgId }` — idempotent; a step in
  flight finishes, records its cost, and finds the job canceled. Audited
  (`ai.job.cancel`).
- `POST /api/ai/jobs/{jobId}/resume` `{ orgId, hostId }` — confirms a plan or
  tries a refused step again. It spends, so it climbs the whole ladder the
  create door climbs, refuses a site that is not the job's, and runs the next
  step inline on its reservation. Audited (`ai.job.resume`).

The read and cancel doors climb the ladder's rungs up to the lockdown verdict
and stop there — no rate window, no reservation — through
`libs/plugins/ai/src/lib/server/ai-jobs-gate.ts`. Every door requires the request
to NAME the org (AGL-1934).

## The theme kind

`theme` (AGL-2938) proposes a change to one site's theme covering every control
the theme editor exposes, and nothing the editor does not.

- **The catalog is the editor's.** The editor's fields, bounds, token names and
  writes live in `@aglyn/shared-ui-theme/util/theme-editor-fields` (what a site
  inherits when it sets nothing is `theme-editor-defaults`), and the console's
  `theme-editor.constants.ts` re-exports them. The tool the model answers
  through, `src/lib/tools/ai-theme-tool.ts`, is derived from that catalog, and
  its spec holds parity in both directions: every control has a tool field,
  and every tool field is a control. The editor's own spec holds the other
  half — every control it renders is in the catalog, and the catalog renders.
- **What the step reads.** The job's site, checked against the job's org, with
  its overrides resolved (`resolveSiteTheme`) and its source decided by
  `hostThemeSource`; and brand colors (`src/lib/jobs/ai-theme-brand-inputs.ts`):
  a white-label workspace's brand color, colors read from the site logo when
  the logo is an asset of the site's or its org's media library, and colors
  read from a public https page the brief links to, fetched through the
  plugin-fetch SSRF guard. Only hex colors from those reach the prompt.
- **What the model is asked.** One static, cached rules block and one strict
  tool; the site's inventory — each control with the value the site set or the
  default it inherits — the brand colors and the brief ride in the user turn.
  The call sits in one local function, `runValidatedGenerationStandIn`, which
  has the signature and the result of the building doctrine's custom overload
  (AGL-2935): the theme's validation in `check`, one re-ask naming only what
  was wrong (no tool call, or nothing usable), then `needs_input`. It becomes
  `runValidatedGeneration('theme', …)` when the doctrine lands, and the
  runtime caller named in the subprocessor gate's `AI_DOORS` moves with it.
- **What the proposal holds** (`src/lib/model/ai-theme-proposal.ts`): control
  changes with the value each had, component override leaves, corrections,
  and what was dropped and why. A `modify` brief reaches only the parts of the
  theme it names ("warmer" reaches colors); an accent changed for light gets a
  dark value unless the site's dark scheme is off; every pair the proposal
  touches clears the publish check's contrast bars (text on the page and the
  paper at 4.5:1, the primary on the page at 3:1), moved to the nearest shade
  that does and named.
- **The output** is `{ resource: 'theme', id: 'proposal', hostId,
  hostSubdomain, label, proposal }`, audited as `ai.job.output` and filed in
  both activity feeds under the site's theme.
- **Applying it** happens in the console, never in the job. The AI plugin's
  `ai-theme-proposal` widget sits in the Theme section's `hostTheme` zone,
  previews the proposal before and after with the editor's own preview,
  re-checks contrast against the theme as it is now, and hands the result to
  `proposeDraft`, which puts it in the editor as unsaved changes. The editor's
  Save stores it the way every edit is stored: an installed theme's override
  patch, the changed values only on a default theme, or the site's own theme
  in place.

## The beat

`ai:ai-jobs` registers on the platform job beat every minute
(`libs/plugins/ai/src/lib/jobs/ai-jobs-beat.ts`, registered by the plugin's
tenant API surface, which the run-jobs route loads like every plugin's). `sweepAiJobs` reads
queued and running jobs across every org oldest-first by `updatedAt`, plus a
few parked jobs that have rested, and runs steps until 45 s of wall clock is
spent — checked between jobs, with the time left handed to the step in flight
as its abort signal. The ordering is the cursor: a job the sweep touches has
its `updatedAt` moved to the back; one it did not reach keeps its place. Two
collection-group queries rather than one, so a workspace with many parked jobs
cannot fill the candidate list and starve the queue. A `needs_review` job is
in neither query.

The beat is platform-scoped for the coverage guard: it resolves no host and
writes only unpublished drafts under the org. The lock that applies is the
`ai-generate` feature switch, which the handler asks before it claims a step
— a lock that stopped the doors and not the beat would keep spending on every
job already queued.

## Indexes and retention

`cloud/firebase-firestore.indexes.json`: `aiJobs` (status, createdAt desc) at
collection scope for the filtered list; `aiJobs` (status, updatedAt asc) at
collection-group scope for the sweep; and the `expiresAt` TTL override. The
TTL policy is manual gcloud configuration and is recorded as owed in
`docs/FIRESTORE_MANUAL_CONFIG.md` until it is run.

## Allotments, the usage strip and the model switch

AGL-2942 adds three things every door and every step goes through. Code:
`src/lib/model/ai-allotments.ts` (subjects, standings, the verdict, the
refusal and alert words), `src/lib/usage/ai-allotments.ts` (the gate's reads,
the route's writes, erasure), `src/lib/usage/ai-allotment-alerts.ts` (soft
crossings), `src/lib/providers/model-choice.ts` (Auto, the plan's tiers, the
allowlists, the prices), `src/lib/usage/ai-usage-meter.ts` (the strip's
envelope), and the doors `src/lib/server/ai-allotments.ts` and `ai-models.ts`.

- **The documents.** `orgs/{orgId}/aiAllotments/{subject}`, where the subject
  is `member:{uid}`, `collab:{hostId}:{uid}`, `host:{hostId}`, or `org` for the
  org-wide model restriction: `{ subject, scope, uid, hostId, credits, mode,
  models, setBy, updatedAt, alerted }`. Server-written only; the rules let the
  subject, members holding `billing.view`/`billing.manage`, and a site's admin
  collaborator (for that site) read them. Written by `POST /api/ai/allotments`
  under `billing.manage`, or by a site's admin collaborator for the site's other
  collaborators.
- **The rung.** `reserveAssistMessage(…, org, { uid, hostId })` reads the
  allotments that apply inside its transaction, AFTER the workspace's own
  ceilings admitted the request, and refuses as `refusedBy: 'allotment'`
  without moving a counter. A job step passes the job's creator and site, so a
  refused step parks as `needs_input` with the allotment's sentence. A site's
  figure is `assistUsage/{month}.byHost.{hostId}`, which the meter writes in the
  org rollup's batch; the first site allotment of a month seeds the key from
  the roster's own months.
- **Soft crossings** at 80% and 100% are announced once the reservation has
  committed, once per threshold per month (the `alerted` marker, claimed in a
  transaction), as a `billing.usage` notification and an email to the owners and
  admins and to the person the allotment is for.
- **The envelope.** Every door adds `meter` (`AiUsageMeterWire`) to what it
  already answers — the chat `done` event, the copy assistant's JSON, the job
  create response and each quota refusal. The strip reads nothing itself.
- **The model switch.** A door reads an optional `model` and resolves it with
  `resolveAiModelChoice(stepKind, requested, { plan, allotmentModels, orgModels })`:
  honored only when the plan's tiers, the org restriction and the allotment
  allowlists allow it, and the routing table otherwise. A job stores the
  creator's `model`, and the machine hands each runner `modelFor(stepKind)`,
  built the same way from the reservation that step took.

## Adding a step kind

Register a runner with `registerAiJobStep(kind, async (ctx) => …)` beside the
machine. The runner receives the job, the step index, an abort signal, the
machine's Firestore handle (for what the step reads and the drafts it writes),
the org document the reservation was read from, and `modelFor`. A building
kind generates through `runValidatedGeneration` (never the provider directly,
and never `runAiRequest` itself), handing it `ctx.modelFor?.(stepKind)` as the
model, which honors the creator's model pick within the plan and the
allotments. The runner writes its drafts and returns `{ outputs, usage,
estCostUsd, model, stopReason }` — with `refused` for a model decline,
`failure` (a customer-safe sentence) for an answer it could not use, or
`review` when the doctrine gave up. It must not write the job document, take a
reservation, or publish anything. Registering a runner for a planned kind is
what turns on its plan step; a generation runner reads the confirmed plan from
`job.plan`. Kinds with more than one step extend `aiJobStepNames`. A runner
that loads heavy modules registers a lazy wrapper, as `theme` does, so the
machine stays light to load.
