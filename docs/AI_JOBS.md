# AI generation jobs

The job model behind every generative door (AGL-2904): one customer brief
carried through one or more model steps by a Firestore state machine, so that
work longer than a request survives the request. The console route runs what
it can inline; the platform job beat resumes whatever is left. The document is
the whole state — no process holds anything the next beat cannot read back.

Code, all in the AI plugin (`libs/plugins/ai`, AGL-2939) except the model:
`libs/aglyn/src/lib/foundation/definitions/ai-jobs.types.ts` (the model),
`src/lib/jobs/ai-jobs.ts` (the machine, the step registry, the sweep),
`src/lib/jobs/ai-job-text-step.ts` (the one step kind that runs today),
`src/lib/server/ai-jobs-route.ts`, `ai-jobs-events-route.ts` and
`ai-jobs-cancel.ts` (the doors, registered on the console dispatcher by
`src/lib/server.ts`), `src/lib/jobs/ai-jobs-beat.ts` (the beat).

## Outputs are drafts, never a publish

Every output a job produces is a new draft or a new unpublished version of an
existing resource. A job never flips a version pointer, never registers a
route and never sends anything; a person opens the draft the job names and
publishes it through the door that already exists for that resource. That is
what lets a job run with no visitor, no session and no confirm gate: the thing
it writes cannot be seen by anyone but the workspace until a member chooses
otherwise. The `text` kind, which ships first, has no document of its own and
carries its copy on the output itself.

## The document

`orgs/{orgId}/aiJobs/{jobId}` — member-readable, server-written only (the
rules deny every client write). Fields:

| field | meaning |
| --- | --- |
| `kind` | `AiJobKind` — what the job produces. Only `text` has a runner today; every other kind fails fast with "not available yet" until its own issue lands. |
| `status` | `queued` → `running` → `done` / `failed` / `canceled`, with `needs_input` as the parked state (below). |
| `brief`, `inputs` | The customer's brief verbatim and the kind-specific scalars a runner reads. |
| `steps[]` | The step plan: `name`, `status`, `startedAt`/`endedAt`, `creditsSpent`, `attempts`, a customer-safe `error`. |
| `outputs[]` | What the job wrote, addressed by `resource` + `id` (+ `versionId`, `hostId`) so the console can build an "open draft" link without knowing what the runner did. |
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
not retryable, a model refusal (which is metered — tokens were spent), or a
step that has exhausted its attempts. A retryable failure or a budget that
ended first hands the message back and re-queues the step.

A step runner writes drafts and returns. It does not touch the job document,
the meter or the lease.

## The doors

Registered under `/api/ai/jobs` by the plugin's console API surface:

- `POST /api/ai/jobs` `{ orgId, hostId?, kind, brief, inputs? }` climbs the
  whole gate ladder (`aiGenerative`, `release_ai_generative`, the `ai-generate`
  switch, a per-uid window, a reservation), creates the job and runs its first
  step inline under a 25 s budget. A step that finishes in time answers with
  the job `done`; one that does not is aborted, re-queued, and answers
  `queued` for the beat.
- `GET /api/ai/jobs?orgId=` lists the org's jobs newest first.
- `GET /api/ai/jobs/{jobId}/events?orgId=` is server-sent events: a `state`
  frame now, a re-read every 2 s that emits on change, `reconnect` at 55 s.
- `POST /api/ai/jobs/{jobId}/cancel` `{ orgId }` — idempotent; a step in
  flight finishes, records its cost, and finds the job canceled. Audited
  (`ai.job.cancel`).

The read and cancel doors climb the ladder's rungs up to the lockdown verdict
and stop there — no rate window, no reservation — through
`libs/plugins/ai/src/lib/server/ai-jobs-gate.ts`. Every door requires the request
to NAME the org (AGL-1934).

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
cannot fill the candidate list and starve the queue.

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

## Adding a step kind

Register a runner with `registerAiJobStep(kind, async (ctx) => …)` beside the
machine. The runner receives the job, the step index and an abort signal,
calls `runAiRequest` (never the provider directly), writes its drafts, and
returns `{ outputs, usage, estCostUsd, model, stopReason }`. It must not write
the job document, take a reservation, or publish anything. Kinds with more
than one step extend `aiJobStepNames`.
