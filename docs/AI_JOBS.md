# AI generation jobs

The job model behind every generative door (AGL-2904): one customer brief
carried through one or more model steps by a Firestore state machine, so that
work longer than a request survives the request. The console route runs what
it can inline; the AI jobs beat, a console route of its own driven every
minute, resumes whatever is left. The document is the whole state — no process
holds anything the next beat cannot read back.

Code, all in the AI plugin (`libs/plugins/ai`, AGL-2939):
`src/lib/model/ai-jobs.types.ts` (the model),
`src/lib/jobs/ai-jobs.ts` (the machine, the step registry, the sweep),
`src/lib/jobs/ai-job-text-step.ts` and `src/lib/jobs/ai-job-theme-step.ts`
(the `text` and `theme` steps),
`src/lib/jobs/ai-job-plan-step.ts` (the plan step every planned kind runs first),
`src/lib/jobs/ai-job-layout-step.ts`, `ai-job-template-step.ts` and
`ai-job-component-step.ts` (the generation steps, below),
`src/lib/server/ai-jobs-route.ts`, `ai-jobs-events-route.ts`,
`ai-jobs-cancel.ts` and `ai-jobs-resume.ts` (the doors, registered on the
console dispatcher by `src/lib/server.ts`), `src/lib/jobs/ai-jobs-beat.ts` and
`src/lib/server/ai-jobs-beat-route.ts` (the beat, below). The building doctrine
every generator runs through is
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

### What a draft asks the member to fill

Where the brief leaves out a fact, such as an address, a phone number or a price,
rule 14 has the copy mark the gap in square brackets instead of inventing it, and
a draft is only ready to publish once a member fills those gaps. So a page, layout,
component or form output's `note` lists the facts in square brackets its draft holds
(AGL-3056), in the member's words and in the order they first appear, each once:
"Before you publish, replace the facts in square brackets, which the brief did not
give: [Office address], [Office phone number] and [Office hours]." A form's note
keeps what the person decides next first. A layout's footer on a live site was the
first to need it: its address, phone and hours were all brackets, and nothing said so.

- **Read once, in one place.** `aiBracketedFacts` (`runtime/ai-doctrine-validators.ts`,
  beside rule 14) reads the copy a tree shows (`aiTreeCopy`: every text prop, and the
  copy an instance fills in) and `aiBracketedFactsNote` (`jobs/ai-job-generation.ts`)
  writes the note, naming at most eight facts and counting the rest.
- **A component's defaults are said once.** A component shows its defaults until a
  page sets its own, so a component job's note reads its defaults as well as its tree,
  and the site inventory keeps the facts each default holds
  (`AiInventoryComponent.bracketedDefaults`, read by `readSiteInventory` and never
  listed in a prompt). A page that places the component and leaves one of those props
  unset gets one sentence for the component however often the page places it: "The
  "Practice area card" component on this page shows [What the firm handles] until you
  replace it."
- **Nothing is refused for it.** A bracketed gap is the honest answer rule 14 asks
  for, so the note costs no prompt byte and no re-ask; a draft copied through the
  duplicate module, or reported by a run cut off after it wrote, carries none.

## The document

`orgs/{orgId}/aiJobs/{jobId}` — member-readable, server-written only (the
rules deny every client write). Fields:

| field | meaning |
| --- | --- |
| `kind` | `AiJobKind` — what the job produces. `text`, `theme`, `layout`, `template`, `form`, `component`, `seo`, `page`, `email`, `campaign`, `products` and `site` have runners; every other kind fails fast with "not available yet" until its own issue lands. |
| `status` | `queued` → `running` → `done` / `failed` / `canceled`, with `needs_input` and `needs_review` as the two parked states (below). |
| `brief`, `inputs` | The customer's brief verbatim and the kind-specific scalars a runner reads. |
| `steps[]` | The step plan: `name`, `status`, `startedAt`/`endedAt`, `creditsSpent`, `attempts`, a customer-safe `error`. |
| `outputs[]` | What the job wrote, addressed by `resource` + `id` (+ `versionId`, `hostId`, `hostSubdomain`) so the console can build an "open draft" link without knowing what the runner did. A console URL names a site by its subdomain, so a link is built from `hostSubdomain` and an output without one gets none. A page's document carries its estimated first-visit `load`. An output may carry a customer-safe `note`: what the person decides next about it, and the facts in square brackets its draft holds ([below](#what-a-draft-asks-the-member-to-fill)). |
| `plan` | The plan a planned kind builds from: `reuse`, `create`, `screens`, the inventory `labels` it references, and `status` `proposed` → `confirmed` with who confirmed it and when. |
| `review` | While the job is `needs_review`: the `reason` (`plan`, `doctrine` or `limit`), the customer-safe `message`, and the rules the last answer broke. |
| `creditsReserved`, `creditsSpent` | A nominal hold per outstanding step while the job can run — zero while it waits for a person, and a confirmed page or site plan's whole-job estimate where that is more — and the real spend at the plan's credit rate. |
| `lease` | `{ owner, until }` while a step runs — see below. |
| `expiresAt` | 180 days from creation, the assist exchange's clock: the brief is verbatim customer text (`docs/DATA_RETENTION.md`). |
| `error` | Customer-safe only. Provider detail goes to the server log beside the ids. |

## The lease

A step runs under a lease: an owner id and an `until` instant
`AI_JOB_LEASE_MS` (330 s) out. The console route and several overlapping
beats can all look at one job inside the same minute, and only one of them may
spend the reservation for its step. A claim is a transaction (`claimNextStep`)
that refuses while another owner's lease is live; an expired lease is simply
claimable, which is how a step abandoned by a process that died is recovered —
the stale lease is released by being taken, not by a sweep of its own.
`heartbeatStep` extends a lease a long step still holds, and refuses once
someone else has recovered it.

The lease outlasts the longest any holder can still be running a step: the
beat route's 300 s function ceiling (AGL-3026). The beat fires every minute
and one sweep may run for most of five, so a lease shorter than that would
run out under a live beat, and the next beat would claim the same step and
call the provider for it a second time.

## Tools a step may call

A tool is a strict structured-output schema and the function that carries out
the model's call, in `libs/plugins/ai/src/lib/tools/`. `duplicate_resource`
(AGL-2984) copies a site resource through core's `duplicateResource` instead
of rebuilding it: the same copy, band arithmetic and activity rows as the
console's duplicate door, and a draft by construction. It calls no provider,
so it is not a door of its own. It takes the calling door's `aiGateLadder`
context as proof the ladder admitted the request — flag, entitlement,
lockdown, rate, band and caps — and adds the two rungs a copy needs:
`ai.generate`, and a host role that may write the site.

## Credits, per step

`runAiJobStep` is the one place a step is claimed, metered, run and recorded,
in that order:

1. ask the workspace's AI pause: a job of a workspace whose AI staff have
   paused is held where it stopped, and nothing below happens (AGL-3037,
   [The beat](#the-beat));
2. claim the lease (a refused claim costs nothing);
3. `reserveAssistMessage` — the same read-and-increment transaction the chat
   route takes, so a job cannot slip past the org's monthly ceiling by being
   asynchronous. The console route's gate ladder takes this reservation
   before the job exists and hands it to the first step; every later step
   reserves for itself;
4. run the step's registered runner;
5. `recordAssistCost` at the serving model's rates, so the usage rollup and
   the invoice see a job's tokens exactly as they see a chat turn's;
6. record the step: its credits, its outputs, one `adminAudit` row
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
A step that stops for a person before the provider, such as one whose site has
no room for its draft, hands its message back the same way.

A step runner writes drafts and returns. It does not touch the job document,
the meter or the lease.

**`creditsReserved` is nominal, and nothing counts it (AGL-3030).** The one real
reservation a step takes is the message `reserveAssistMessage` counts, and it is
settled before the step is recorded: metered with the step's cost, or handed back
when the step spent nothing. The band, the Free taste's account allowance and every
refusal are measured on recorded spend, so a job between steps holds nothing real
against either. The figure is what the console shows a running job as costing
before its bill is known: `AI_JOB_STEP_RESERVE_CREDITS` a step at creation, one
step's worth released as each settles. A job parked `needs_review` shows nothing
held — the step that parks it releases the figure in the write that records it —
and `resumeAiJob` holds it again for the steps a resume queues, or at the
confirmed plan's whole-job estimate (`aiJobPlanCreditEstimate`, AGL-3031) where
that is more. A meter park (`needs_input`) keeps it, because its step runs as soon
as the meter admits it.

## Tokens, per step and per kind

What generation costs in tokens is measured beside what it costs in credits
(AGL-2937), in the four counts the meter prices, under one set of names
(`src/lib/model/ai-tokens.ts`).

- **On the step.** `steps[].tokens` holds `input`, `cachedRead`,
  `cacheWrite` and `output`, the `model` and thinking `effort` of the last
  run, `latencyMs` (time in the runner) and `runs`, summed over every run of
  the step that reached the provider (`addAiJobStepTokens`). `runAiJobStep`
  times the runner and hands the outcome's usage to `recordStep`; a runner
  reports the `effort` it asked for, which `runValidatedGeneration` returns
  on its spend. A step that failed before the provider records none.
- **Why each run stopped (AGL-3042).** `steps[].tokens.lastRuns` lists the
  step's latest runs, oldest first and the last run last: each run's
  `stopReason` — its last model call's, `max_tokens` for one cut off at its
  ceiling — and the `output` tokens it generated. A page pass whose answer and
  re-ask were both cut off reads `{ stopReason: 'max_tokens', output: 2100 }` on
  the job, where before it could only be worked out from the sums. The list
  keeps `AI_JOB_STEP_LAST_RUNS` (12) runs: a page job that builds a layout, a
  form and a component, five sections and its last pass runs nine. An entry is
  at most 67 bytes as Firestore sizes it (field names of 11 and 7 bytes, a stop
  reason cut to `AI_JOB_STEP_STOP_REASON_MAX_CHARS` (40) characters and so 41
  bytes, an 8-byte integer), so a step's list is at most 813 bytes and a job's
  two steps at most 1,626 of the 1,048,576 a document may hold. The machine writes
  it through the Admin SDK in the transaction that records the step, and the
  rules deny every client write to `aiJobs`, so the rules are unchanged. The
  wire summary carries no tokens, so members are shown nothing new.
- **On the org month.** `assistUsage/{month}.kinds.{kind}` holds `requests`,
  `estCostUsd`, `providerCostUsd` and `tokens.{input,cached,cacheWrite,output}`
  for every metered model request, keyed by its `AiUsageKind` — a job step by
  its job's kind. A docs answer is not a request. Both dollar figures count a
  declined Free turn, where the month's top-level `estCostUsd` counts only the
  credited ones; the month's `inputTokens` … `cacheWriteTokens` stay its totals.
- **Two dollar figures, and which is which (AGL-3015).** `estCostUsd` is every
  exchange at the model catalog's **billed** rates — the figure credits are
  drawn from, and the one a band, a cap, an overage line and an invoice are
  measured in. `providerCostUsd` is the same exchanges at what the **provider**
  charges, which on a marked-up model is lower. Read the first to answer "what
  did this workspace draw", the second to answer "what did it cost us" — never
  either for both. `assistProviderCostUsd` in
  `libs/aglyn/src/lib/app-utils/assist-credits.ts` is the one reader of the
  second, and answers with the first for a period closed before the split.
- **On the person's month.** `aiUsageByUser/{uid}/months/{month}.tokens`, the
  same four counts beside `estCostUsd` — the billed figure, so a person's
  dollars, their credits and their share of the workspace are one arithmetic.
  Written on the org rollup's batch.
- **On the signal.** `assistSignals/{id}.kind`, so the fleet board splits
  tokens by kind. A signal written before it is read by its route.
- **Where staff read them.** The staff AI card (`composeStaffOrgAiTokens` in
  `src/lib/usage/staff-org-ai.ts`) and the Assist signal board's *Tokens by
  kind* panel (`src/lib/usage/assist-signal-mining.ts`), which adds the
  95th-percentile output a kind's `max_tokens` is sized against. The cache
  hit rate is `aiCacheHitRate`: reads over everything the prompt was billed
  as, cache writes included.

## What a prompt caches, and what it cannot

A cache breakpoint is a request for caching, not a guarantee (AGL-2937). A
provider will not cache a prefix shorter than its model's minimum: it honors
the markers, caches nothing, and reports a usage row indistinguishable from a
permanent miss. The minimum is a property of the MODEL, not of the tier or the
vendor, and it does not move as a conversation grows.

- **Where the number lives.** `cacheMinTokens` on each `AI_MODEL_CATALOG`
  row, read through `aiModelCacheMinTokens`. An id the catalog does not know
  is assumed to be the dearest one it does, the way the rate fallback is: an
  unrecognized model reads as "this does not cache" rather than promising a
  saving nobody measured.
- **How a door asks.** `aiCachedPrefixChars(system, tools)` in
  `src/lib/runtime/ai-runtime.ts` counts the cached span — the tools, which a
  provider renders ahead of the system blocks, plus every block through the
  last breakpoint — and `aiCachedPrefixCaches(model, …)` answers whether it
  clears the model's minimum, reading four characters to a token so the
  estimate errs toward "it does not".
- **The ledger.** `src/lib/runtime/ai-prompt-cache.spec.ts` scans the source
  for every file that calls `runAiRequest` or `runValidatedGeneration`, so a
  new door cannot be added without a row saying what its prompt caches. It
  holds every request's cached span to a measured size, asserts that span is a
  function of the request's SHAPE and never of the tenant, refuses a static
  block stranded after the last breakpoint, and refuses a step that quotes
  cache reads in `AI_STEP_NOMINAL_USAGE` for a prefix its model will not cache.

Two consequences worth knowing before writing a prompt. A door on the fast
tier has the HIGHEST minimum on the platform, so a step moved there to save
per-token money can cost more per request; and on a door that cannot cache,
every static byte is billed at full input rate on every attempt AND on every
re-ask, so its prompt is worth shortening rather than enriching.

## Rules a kind can actually break

The seventeen building rules are written for a kind that composes a document.
A kind that writes short values a door checks itself — a search listing, an
audit's fixes — can break exactly one of them, so a rule declares the scopes
it binds and `aiDoctrineSystemBlocks` renders only the scope's rules
(AGL-2937).

- `documents` is every rule, and is what a kind gets unless it names another.
- `fields` is rule 13 and the acceptable-use rules. Rule 13 is there because
  the loop ENFORCES it on every custom kind through `detectPublishIntent`, and
  an answer may not be refused for a rule it was never told; the ledger spec
  derives that from the checks rather than from a comment.
- The acceptable-use rules are in every scope, whole. They are the abuse
  guard, not a building rule.
- `AI_DOCTRINE_KIND_SCOPE` names the kinds in the field scope; a new kind that
  writes values rather than composing a document belongs there.

Each scope's block is built once at load, so two workspaces on one door share
one cache entry. A door's own instructions may follow the same discipline: the
listing rules state the rule for a field only when that field is asked for,
and no length in prose, because the strict schema carries every length.

**A rule the schema already states is not stated twice.** A strict tool's
schema rides in the same request as the blocks, ahead of them, so a sentence
written in both is billed twice on a door whose prompt no model will cache.
The listing rules therefore carry only what the schema does not say — how to
write a field rather than what it is — and the image description, whose schema
entry already says what it describes and when to answer `null`, carries no
prose rule at all. The pair is held together by the ledger spec: whatever
`checkAiSeoFields` can refuse an answer for, the REQUEST has to state
somewhere, in a block or in the schema. That test reads the two halves as one
string, so a sentence may move between them freely and may not leave both.

## The eval harness

A token lever ships only when the eval holds (AGL-2937): each output kind has
golden briefs, and every answer to them is scored the way the doctrine holds a
live answer.

- **Where the cases live.** `tools/ai-eval/cases/<kind>/<id>.json`, one file
  per golden brief, filed under its kind: `page`, `template`, `component`,
  `layout`, `form`, `email`, `section` (a section rewrite), `seo`, `product`,
  `catalog` and `categories` (the `products` kind's three answers), `theme`,
  `element`, `blog`, `text` and `chat`. A generator adds its briefs there.
- **What a case holds.** The brief and its framing; the site `inventory` it is
  built for, in the shape `readSiteInventory` returns, and the media `assets`
  its images are measured against; the site's `siteName` where the case gives
  one, which a recording names the site by, and an untitled site where it gives
  none (AGL-3077); for a workspace that lacks something, its
  `capabilities` (what it may create, whether it keeps reusable components, and whether
  it spends the Free taste), which hold the answer to the inline doctrine and the plan to
  what it may create and to the sections the Free wall pays for; for a planned kind, the plan shape a good
  answer has (`expected.plan`: how many screens, what it must reuse, its
  layout, what it may create); `candidates`, each an answer with its plan, its
  rubric grade, and whether it was `authored` by hand or `recorded` from a
  live run; and `controls`, answers that must fail, each naming the checks it
  fails.
- **The checks** (`src/lib/runtime/ai-eval.ts`). *Readable*: the tree
  validator admits it — a page's repeated item written once drawn into its copies
  first, and refused as the page step refuses it (AGL-3053) — or the copy, the fields
  or the theme call are there.
  *Rules*: no doctrine rule is broken, nor the kind's own (a link the chat
  answer was not given, a title line on a blog body); a component answer that
  declares its `props` is held to the component step's own checks too
  (`aiComponentCheck`, AGL-3054). *Budget*: rule 17 for a
  document, the length ceiling for copy. *Plan*: the plan rules and the
  expected shape. *Rubric*: a grade from 1 to 5 for structure, copy fit and
  reuse, passing at a mean of 3.5 with nothing under 3. An answer's score is
  those checks and the rubric averaged, from 0 to 1.
  *Responsive* (AGL-3020): a readable answer of every kind a site renders — a
  page, template, layout, component, section or form; an email's column is fixed
  by its medium — is held to its recorded device audit.
  `tools/scripts/record-ai-page-axe.mts` renders the tree the harness checks
  (`aiEvalAnswerTree`) at every device of the besigner's switcher, as it renders
  the golden pages, and writes `tools/ai-eval/widths.generated.json`, and
  `tools/ai-eval/recordings/widths.generated.json` beside a live run's
  recordings, which is how a recording is measured before it is scored. An answer
  passes with nothing past a screen and no band that keeps its desktop columns on
  a phone, and fails with no recording of its own (`widths-unrecorded`). It gates
  a pass without entering the score, so a page that only works on desktop does not
  pass however it grades, and its kind falls under its floor. The crew page and the
  town template draw their cards as Grid rows, and each keeps its old Stack row as
  a control that fails it; so do the Free About page's items sized 4 at every width
  and the call to action's fixed pixel width.
- **The floors.** `AI_EVAL_FLOORS` holds each kind's pass rate and mean
  score. `npm run test:ai-eval` fails when a kind falls under its floor, when a
  kind has no case, or when a control passes a check it names; the tools
  guards workflow runs it.
- **Offline by default.** CI and every local run read the fixtures and call
  no provider. The candidates on main are authored references, so the offline
  scores prove the scorers and pin the doctrine's verdicts on answers known to
  be good or bad; they measure no model until a live run records one.
- **A live run is explicit.** `AI_EVAL_LIVE=1 npm run eval:ai-live` asks the
  provider for real answers, grades each through `grade_output` on the
  provider's deepest tier, and writes them under
  `tools/ai-eval/recordings/<kind>/`, where the offline harness scores them
  beside the authored ones. It spends real money, so without the variable it
  refuses before anything runs (`tools/ai-eval/record-live.mjs`,
  `recordAiEvalLive`). Each recorder answers through the door that answers
  the kind in production — the plan step's runner, the text step's runner, the
  theme step's own generation call — so a recording measures the production
  request. A page brief is recorded end to end (AGL-3030): the plan step's
  runner, the plan confirmed, then every pass of the page step's runner against
  a site kept in memory (`src/lib/runtime/ai-eval-memory-firestore.ts`), with
  each exchange's tokens and credits under `candidate.steps`, metered as the
  machine meters a step. Any other planned kind records its plan alone until its
  generator is recorded the same way (a `plan`-scope answer, counted toward the
  plan step rather than the kind's floor); a kind whose door is a request route
  (the copy assistant's modes, the chat door) has no recorder yet, and a door
  that gains one registers it with `registerAiEvalRecorder`.
  `AI_EVAL_CASES=<id>[,<id>]` records only the briefs it names. The launcher
  marks the jest it starts, so the shared setup's `.env` scrub (AGL-690) keeps
  the provider key the run was handed even where the repo-root `.env` holds
  the same key (AGL-3038); a run started any other way from such a checkout
  loses the key and stops before its first request, saying why. Where a case
  describes its workspace, the grader is told it the way the plan was — the
  capability lines — and that on a workspace without reusable components or saved
  forms, an item drawn where it repeats and a form drawn on the page are the correct
  build rather than a missed reuse (`aiEvalGraderCapabilities`, AGL-3040). A built
  page's grader is shown what its tree does not hold (AGL-3073): the plan's
  creations and sections (`aiEvalPlanOutline`), and the screen as the draft stored
  it, which a page recording keeps under `candidate.screen` — its address, search
  title and description, its navigation proposal, and an outline of the layout it
  renders inside, with the main landmark placed by `stampDocumentLandmark`
  (`aiEvalBuiltPage`). A recording made before the screen was kept gives the plan's
  screen and says so. The tree it grades goes without the keys the store keeps for
  itself (`aiEvalGraderOutput`), which leaves the recorded About page's grader input
  at 18,372 characters, from 23,600.

## The routing table

What each step kind asks of its model lives in one table, `AI_ROUTING_TABLE`
in `src/lib/providers/routing.ts` (AGL-2937): whether it thinks and at what
effort, its `max_tokens` and what that ceiling is sized from, and the eval
score its golden briefs hold, beside the tier `AI_STEP_TIERS` serves it from.
Every door reads its row rather than a constant of its own.

- **The smallest model that holds the floor.** A row moves to a cheaper tier
  or a lower effort only when a recorded eval holds the floor there. While a
  row's score comes from authored references it says `authored`, and the row
  stays where production has run it.
- **The scores are recomputed.** `src/lib/runtime/ai-eval.spec.ts` recomputes
  each row's pass rate and mean score from the harness, and fails when they
  differ from the row, when a row falls under its floor, or when a fast-tier
  row asks for thinking or effort.
- **The ceilings.** A ceiling is sized from the p95 output the *Tokens by
  kind* panel reports for the kind once production has served it. Until then
  `maxTokensBasis` names what it is sized from, and the same spec holds every
  reference answer under it at three characters a token.
- **A model that takes no setting gets none.** The Anthropic adapter sends
  neither `thinking` nor `effort` to a catalog model whose
  `capabilities.thinking` is false, whatever the door asked for.

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
- **reason `doctrine`** — an answer broke a building rule on its re-ask, or was
  cut off at its output ceiling on both attempts, which the message says in so
  many words: it was too large to build in one pass
  ([An answer cut off at its ceiling](#an-answer-cut-off-at-its-ceiling)); the
  step went back to `pending` with its spend recorded, and trying again runs
  it once more with its attempts started over.

`resumeAiJob` is that transition, in one transaction, and cancel ends either.

### What the plan may create

A plan that names a creation nothing can make is a dead end the member pays for
twice (AGL-3030): once for the plan, and again for the plan they describe after
being told to make the creation by hand — which, on a workspace whose plan does not
include it, they cannot. So before it asks, the plan step reads what the job may
create on its site (`src/lib/model/ai-plan-capabilities.ts`):

- **The workspace.** `readAiPlanCapabilities` in `src/lib/jobs/ai-job-drafts.ts`
  answers every creation kind from the resolved entitlements and the site's counts,
  in the draft writer's own band arithmetic: `reusableComponents` for a component,
  that feature then `formsPerHost` for a saved form, `sharedLayoutsPerHost` and
  `templatesPerHost` with the room each has left, and the plan's datasets. It reads
  only the collections a finite allowance counts. A theme change counts against
  nothing, and an email design is the email plugin's to refuse.
- **The job.** A kind that builds only some plans narrows that
  (`AI_JOB_PLAN_SCOPES` in the plan step): a page job builds the layout, forms and
  components its plan creates (`AI_PAGE_CREATE_KINDS`, AGL-3031) and a site scaffold
  its layout, form and palette change, and each refuses a plan of the wrong shape.
- **The request.** The lines ride the plan's USER turn (`aiJobPlanPrompt`), never a
  system block: they are per workspace and per site, and the doctrine's cached prefix
  stays one entry for the platform. The doctrine states the rule once — rule 7,
  create only what the request says this job may create — and the request states the
  facts. The lines are part of the plan key, so a plan made under other capabilities
  is never reused.
- **The rules.** `validateAiBuildPlan(plan, inventory, framing, capabilities)`
  refuses a creation outside them (`plan-create-not-allowed`, rule 7, one violation a
  creation, saying why and what to do instead), and the plan step adds the kind's
  shape refusal (`plan-job-shape`) — both with the one re-ask every rule gets. A site
  with no layout, where the job may not create one, is not refused for a screen that
  names none; a long list, where no dataset may be made, is asked to be shorter.
- **What a plan places, it reuses or creates (AGL-3040).** A `new:<name>` reference
  that names no entry of `create` is a creation nothing builds: a plan kept with one
  stopped its page at the first pass, sending a Free member to make what Free cannot.
  `aiPlanUndeclaredRefs` (`src/lib/model/ai-build-plan.ts`) lists each one. A screen's
  layout stays rule 2's `plan-screen-without-layout`, whose message follows the
  workspace: plan a layout, put the screen in one the site has, or leave it empty. A
  screen's template or a section's `uses` is rule 7's `plan-creation-undeclared`, one
  violation a name. Where the job may make one more of the kind the reference meant (a
  form when its name, or a section with no form yet, reads as one; a component
  otherwise), the message says to declare it in `create`; where it may not
  (`aiPlanUncreatableKind`), it says to build without it — a Form element, or the item
  drawn in its section, on a workspace without saved forms or reusable components, and
  what the site has elsewhere. A section that places a layout is refused by rule 2
  (`plan-layout-in-section`) and one that places a template by rule 4
  (`plan-template-in-section`): each frames a whole screen. No system block changes, so
  the cached prefix is the same bytes. A plan confirmed before these rules still stops
  at the page and scaffold doors, which name such a reference as a component to create.
- **Inline, where the workspace keeps no reusable components.** A workspace whose plan
  lacks `reusableComponents` can place no component and save no form, so there — and
  only there — the doctrine builds inline: a form is a Form element the page carries,
  with its Form Fields inside it, and a list's repeated items are drawn in one section.
  Rules 1 and 3 state that exception, the plan rules accept it on those capabilities,
  and the tree rules accept it where `AiDoctrineTreeContext.reusableComponents` is
  `false`, which the page step sets from the org's entitlement. Loose fields and a
  form with no field to send are still refused. The tenant renders such a Form as
  authored (only a form bound by `formId` is replaced by its entity's design), and
  `/api/forms/submit` collects a submission with no `formId` under its `formName`,
  within the plan's `formSubmissionsPerMonth`. A section's answer writes that
  repeated item once and lists its copies' values, and the page step draws the copies
  ([A repeated item written once](#a-repeated-item-written-once)).
- **A Free plan fits the Free wall (AGL-3070).** A live Free plan asked for eight sections
  beside the layout its job creates, where the wall's worst case pays for six, and fit
  only because every exchange ran under its ceiling; a plan that does not runs out of
  credits with its page half built. Capabilities read for a workspace whose effective plan
  is Free carry `freeTaste` (`aiPlanCapabilitiesFrom`), and `detectPlanOverFreeWall`
  refuses a plan asking for more sections than `aiFreePageSectionsWithin` fits in
  `FREE_AI_TASTE_CREDITS_PER_MONTH`: the plan, the layouts the job builds first (those it
  creates and may make, and one on a site with none where it may make one, which rule 2
  asks for), a listing a page and the first section's pass, then as many later passes as
  the rest pays for, each at `AI_FREE_PAGE_WORST_CASE_CREDITS`. Those are the figures the
  wall is proven with ([Evals](#evals)), and `ai-job-free-page.spec.ts` derives them again
  and fails when one moves, so the cap and the proof cannot drift. So a Free plan asks
  for at most 9 sections, or 6 when its job creates the layout first. A component or a
  form is never a Free creation (rule 7), so neither is counted. The finding names no
  rule (`plan-over-free-wall`), and its re-ask gives the count to plan within and how to
  get there: a list's repeated items in one section, and no section the brief does not
  ask for. It only lowers what a plan may ask for, and no prompt line or figure changes.
- **A list is one section whose items repeat (AGL-3071).** A live Free plan read the
  inline sentence's old words, "draw a repeated item in its own section", as a section an
  item, and planned "the four areas we practice" as four sections of one item: none was
  built from the one item a repeated section writes once (AGL-3053), and the four came
  out in three shapes. The sentence (`AI_PLAN_INLINE_SENTENCE`, in the plan's user turn)
  now says "draw a list's repeated items in one section", four characters longer, and
  rule 1's `detectPlanSplitLists` refuses two or more sections side by side that each show
  one item of the same kind: they place the same components, or their names give the item
  the same label before a colon or a dash ("practice area: family law"). The re-ask names
  the sections and gives the section to plan instead, as JSON:
  `{"name":"practice areas","uses":[],"items":4}`. It holds on every workspace, since one
  component placed once a section is the same split; there the section it gives keeps the
  component, and a list of labeled sections long enough for rule 1's component is told to
  place one, the site's or one declared in `create`, so the answer it asks for is not
  refused next. Sections of several items are never
  joined, so two lists that share a card stay two lists, as rule 8 counts them. No credit
  figure the Free arithmetic quotes moves.
- **A typed list is counted within its section (AGL-3061).** Rule 8's tree check
  (`detectTypedData`) refuses `AI_TYPED_LIST_MIN_ITEMS` (8) or more same-shaped items
  typed out by hand, counted within the Section they sit in: the unit the plan rule
  counts a section's `items` in. So two short lists that happen to share a card — a
  Free About page's four practice areas and its four steps — are not one long list,
  and a plan the rules kept is never refused at its page for a list it never
  planned. One section's list split across columns is still one list, a tree with no
  Section is one group, and rule 1's repeat check still reads the whole page.
- **Refused before a Confirm.** A plan that passes is asked the kind's admission with
  the plan, as the resume door asks it. A refusal fails the job with the door's
  sentence before any member is shown a Confirm: its plan is not kept, and it holds
  nothing. A door that cannot answer keeps the plan, because the resume door asks
  again before anything is built.

### An identical brief reuses the plan

A plan is the dearest step of a job and the one most often asked for twice: the
same brief run again in a sitting, a job resubmitted after a refused
reservation, two members starting the same work. So the step looks before it
asks (AGL-2937).

`plan.key` is a sha256 of the whole REQUEST — the job's kind and site, the user
turn (which carries the trimmed brief and every scalar input), the model that
would answer, every rendered system block including the site inventory, and the
plan tool's schema — hashed with each part length-prefixed so no two splits of
the same characters collide. It hashes what the model was asked and shown,
never what it answered, and nothing of the brief is recoverable from it. A
`plan.v1` tag leads it, so a change to what a key MEANS strands the old ones
harmlessly: a key nothing matches simply asks the model.

`findAiJobsByPlanKey` reads `orgs/{orgId}/aiJobs` on one equality, `plan.key ==
key`, with no ordering beside it, so Firestore's automatic single-field index
answers it and **no composite index is deployed**. The window and the statuses
are applied in memory, which is what keeps it that way; it is injected as
`findPlansByKey`, like the inventory reader, and `null` turns reuse off.

`aiReusablePlan` takes the newest plan of ANOTHER job that is still `proposed`
or already `confirmed`, on a job that was neither canceled nor failed, proposed
inside `AI_PLAN_REUSE_WINDOW_MS` (fifteen minutes). A canceled or failed job is
excluded even when its plan is good: those are the jobs a member walked away
from, and handing their plan to the next one would make a rejected answer look
like a fresh one. The window covers what the key cannot see — a page published,
a component renamed since the inventory was read, a member who meant something
else the second time.

A reused plan is recorded with `reusedFrom` naming the job it came from,
`status: 'proposed'` whatever the source's was, a fresh `proposedAt` and labels
read from THIS job's inventory: it is this member's plan to confirm. The step
returns zero usage, so the machine's spent-nothing branch releases the
reservation, meters no credit and records no token run, and the step still
completes — confirming runs the generation step as it always did.

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
strict `tool`, and optionally `maxTokens`, `cutOff`, `thinking`, `effort` and
`signal`.
A tree kind may add `context` (asset sizes, the brand, embeds, framing) and
`otherPages`; the doctrine's own checks always run for `plan` and the six
palette kinds, and a door can only `extend` them. A kind the doctrine has no
reader for (a theme change, an edit) brings its own `check`, and rule 13 is
still held on its answer. Such a kind may leave `inventory` out when it builds
from no site structure — the theme step builds from the theme — and then no
inventory block is sent; `null` still says an inventory was not read.

A door whose answer streams to its reader cannot use the loop: by the time the
tool call can be read the answer is on screen, and there is no turn left to
re-ask in. It holds what arrived to the same custom-kind check with
`validateStreamedGeneration(kind, { answer, check })` — rule 13 and the door's
own check, `ok` with the door's findings beside a usable value, `needs_input`
when there is no value or a numbered rule broke — and it shows the model the
loop's catalog through `aiDoctrineCatalog(surface)`. The chat door's edit rung
is that door.

The loop sends, in cache order: the doctrine block (cached, identical for
every org, with the acceptable-use rules), the door's instructions, the
surface's palette catalog (cached), and the compact site inventory
(volatile). It checks the answer; on a violation it asks once more with the
broken rules named and only the offending parts quoted; when the second
answer still breaks a rule it returns `needs_input` with a customer-safe
message. Every attempt's tokens are summed on the result, and the job
machine meters them. The result is `ok` with the value, `needs_input` with
the violations, or `refused`.

### An answer cut off at its ceiling

A call the provider stops on its output ceiling — `max_tokens`, which the
OpenAI-compatible adapter maps `length` onto (`aiStoppedAtCeiling` in
`src/lib/runtime/ai-doctrine.ts`) — was cut off, whatever reached the tool
(AGL-3042). A tool input cut mid-answer arrives partial or empty, and a check
reads the truncation as a shape error: a page section's check said "The answer
could not be used as a section." (`tree-invalid-input`). A re-ask that quotes
that error never asks for less, so it was cut off the same way, and the same
section failed on every retry. So when a cut-off call's answer fails its check,
the attempt is refused as `answer-cut-off` instead — ahead of any numbered rule
the part that arrived already broke, with the shape findings left out — and:

- **The re-ask asks for it smaller.** It says the answer ran past the size one
  answer may have and was cut off, then what makes one of its kind smaller:
  the door's `cutOff.smaller` sentence, or "Build a smaller <kind>." A page
  section's is its element budget, shorter copy and a repeated item drawn no more
  than once: placed as an instance where the workspace keeps reusable components,
  and written once, with the shape spelled out, where it keeps none
  (`aiPageSectionSmaller`). It asks for the whole answer again, smaller. The
  re-ask is a user turn, so no system block and no cached prefix changes.
- **A person reads that it was too large.** `aiDoctrineNeedsInputMessage` reads a
  cut-off refusal as its own sentence rather than "could not be built within
  the building rules": "This section was too large to build in one pass. Try
  again, or describe it smaller." The noun is the door's `cutOff.noun`, a plan or
  a palette kind's own name, or "answer". The review keeps its shape — reason
  `doctrine`, the message, and the finding with rule `null` and code
  `answer-cut-off`.
- **A check that passes is kept.** A cut-off call whose answer still reads and
  keeps every rule is an answer, and the loop returns it.

`ai-job-page-sections.spec.ts` drives the loop with a fake provider through the
real section check: a cut-off `tree` then a small section is kept on the re-ask,
which asks for it smaller and quotes no shape error; cut off twice, the section
ends as `answer-cut-off`, never `tree-invalid-input`. `ai-job-page-step.spec.ts`
holds the same two through the page step, with the review a member reads.

### The inventory, and "more on request"

The site inventory is the one volatile part of that prompt, and the only part
billed at full input rate on every attempt and every re-ask. Three caps meet
there, and they are different numbers on purpose (AGL-2937):

- `AI_SITE_INVENTORY_MAX_PER_KIND` — records of each kind the READER holds
  (`readSiteInventory`). It is the window a lookup can answer from, and a
  record never read cannot be found.
- `AI_SITE_INVENTORY_LISTED_PER_KIND` — records of each kind the prompt block
  LISTS. It is what a prompt can afford to carry every time.
- `AI_SITE_INVENTORY_MAX_CHARS` — the block's ceiling, which cuts the longest
  kind a line at a time so no kind crowds the others out.

A kind with more records than are listed — cut by the listing cap or by the
read itself — is named as having more, and the sentence points at
`look_up_site_inventory` (`src/lib/tools/ai-inventory-lookup-tool.ts`). The
loop offers that tool beside the door's own on EVERY request that carries an
inventory, whatever the site's size: a tool list renders ahead of the system
blocks and is part of what a cache entry is keyed on, so offering it only to
large sites would split the platform's one cached prefix in two. Its schema
names a kind and a search text and nothing of any site.

A turn that calls it rather than answering is answered from the window already
in memory — no Firestore read, and no second scope check, because the request
was already entitled to the window — and the model is asked again with the
rows in the same `id · name · …` shape the block lists them in. That round is
a model call the caller pays for but NOT an answer attempt, so the one re-ask
is still there to be spent on a broken rule; `AI_INVENTORY_LOOKUP_MAX_ROUNDS`
bounds it, and the last answer says it is the last. The re-ask continues the
turn rather than replacing it, so whatever was looked up is still in front of
the model and is not asked for twice. A lookup round is asked at the answer's
ceiling, and nothing tells a request that will look something up from one that
will answer, so the whole generation — its lookup rounds, its answer and its
re-ask — shares one allowance of output, twice the ceiling: each call is asked
for no more than is left of it, and a generation that has spent it stops
(AGL-3036). That is what lets a job step plan its time with lookups in it
([The time budget](#the-time-budget)).

What it buys is rule 7 on a site bigger than its prompt: without it, a plan for
a site with two hundred components can only reuse the forty it was shown, and
creates duplicates of the rest. What it costs is the tool's schema inside each
door's cached prefix — about 195 tokens, written once per cache lifetime and
read at a tenth of an input token after that, and a credit a page on the ten
golden briefs.

Two rules hold what a link does, because a page, a layout or a component links
the same way (AGL-3056). A layout's footer on a live site, a band in `primary.main`,
held a "Request a Consultation" Screen Link that set no color, so its words were
drawn navy on navy; and it linked the home screen, because the site had no
consultation screen.

- **Rule 5, `link-color-on-band`** (`detectInvisibleLinks`). A Screen Link or a Button
  draws its words in its `color`, primary when it names none, unless it inherits, sets
  an `sx` color of its own or is a contained button, whose label is its family's
  contrast text on a fill of its own. It is refused when those words are drawn in the
  family of the band it sits on: the nearest ancestor with an `sx` background in a
  link family's color (`primary`, `secondary`, `success`, `error`, `info` or
  `warning`, in its main, dark or light shade), or an App Bar, which is primary when
  it names no color. A paper surface such as a Card, and any other background, is
  not a band. The re-ask: give it `"color": "inherit"` under a band whose sx color is
  the family's contrast text, or set its own sx color to it.
- **Rule 10, `link-unrelated-screen`** (`detectUnrelatedScreenLinks`), and a sentence
  of rule 10: "A link goes to a screen that does what its words say, or is left out."
  The inventory cannot say what each screen is for, but it can name the screen a
  model falls back to: `aiHomeScreenIds` reads the site's home screens (at the root or
  at `home`, as a seeded site stores its first screen, or named Home) into the tree
  context. A Screen Link or a Button that links one, outside an App Bar, a `header`
  and a `nav`, with words that do not say home, is refused; the re-ask names the words
  and says to link the screen that does, or to leave the link out.
- **What it costs.** Rule 10's sentence is 70 characters of the doctrine, and so of
  every document door's cached prefix: 18 estimated tokens on the page, the plan and
  the layout alike. With the Grid line, the page prefix is 4,598 estimated tokens,
  the largest ceiling the Free wall holds moves from 1,074 to 1,060, and no credit
  figure moves: the first pass still costs 44 credits, the page 190 of the 300 and
  254 with its layout.

The validators hold the seventeen rules by construction: one detector per rule
for trees and plans, each naming its rule number and a customer-safe sentence,
and the rule-17 scorer, which measures nodes, stored bytes (`nodeMapBytes`),
image bytes, embeds, font families and an email's rendered HTML against
`AI_OUTPUT_BUDGETS` in `runtime/ai-palette.ts`. A page's estimated load starts
from `ESTIMATED_PAGE_TRANSFER_BYTES`, the measured weight of a published page.

## The layout and template kinds

`layout` and `template` (AGL-2909) are the first kinds whose generation step
builds a document. Both are planned kinds: a job runs the plan step first and
waits for a member to confirm it, and the generation runner then reads the
confirmed `job.plan` and builds exactly one draft.

- **Runners.** `src/lib/jobs/ai-job-layout-step.ts` and
  `ai-job-template-step.ts`, registered by the plugin's server surface. Each
  calls `runValidatedGeneration('layout' | 'template', …)` on
  `ctx.modelFor?.('job.layout' | 'job.template')`, with the doctrine's tree
  tool, no extended thinking and the routing table's 8,000-token answer
  ceiling, as much of it as fits the least time each step registers on the
  model the job runs ([Every step's least time](#every-steps-least-time)). The
  door's checks
  ride `extend`: a layout places every component the confirmed plan reuses
  and never draws navigation the site keeps as a component (rules 7 and 1); a
  template binds only the tokens its page fills, binds its h1 to the
  subject's title, and places no block that fills itself only on another
  subject's page (rule 8).
- **What a template is for.** `inputs.subject` is `entry` (with
  `inputs.collectionId`, a content collection), `product` or `author`
  (`src/lib/model/ai-template-subjects.ts`). The tokens are the besigner
  insert picker's catalogs for an entry or an author page, and the commerce
  product page resolver's names for a product, which a spec reads from the
  resolver's source. A `url` or `media` prop may hold one of the subject's
  address tokens whole: `AiNodeTreeContext.bindingTokens` admits exactly the
  tokens a caller names, and the palette validator is otherwise unchanged.
- **Examples.** The template step sends the platform's starter pages as a
  cached block after its instructions (`src/lib/runtime/ai-template-examples.ts`),
  each brought up to rules 3, 5, 10 and 11 the same way, shown only when the
  doctrine accepts it with no repair, one page per shape, within 6,000
  characters.
- **Drafts.** `src/lib/jobs/ai-job-drafts.ts` writes the document the host
  resources route would write: that route's allow-list (a spec reads the
  route), its stamps, msgpack nodes, the band met inside the transaction with
  the route's arithmetic, and a name unique among live siblings. The job's id
  is the document id, so a step run again reports its draft rather than
  writing a second. A layout gets its first version. A template is `kind:
  'page'` with `source.type: 'authored'`, a suggested `slug` and no
  placeholders, so Use template asks for nothing and every token stays bound.
  Nothing else is written: no screen, collection, store setting, layout or
  host document names the draft until a member assigns it. A plan that starts
  from a copy (`duplicateOf`) gets that copy through the platform's
  `duplicateResource` and generates nothing.
- **Admission.** A kind registers one check with `registerAiJobAdmission`
  (`src/lib/jobs/ai-job-admission.ts`). The create door asks it after the gate
  ladder and before the job exists, and the resume door asks it again before
  a waiting job runs; a refusal hands the reservation back. A layout or
  template job needs a site of the job's own org and room under that site's
  allowance, and a template job needs inputs that read.
- **A limit review.** When the allowance is used up between the admission and
  the write, the step stops the job `needs_review` with `review.reason`
  `limit` and the route's own sentence as its error; trying again runs the
  step once more.

## The form kind

`form` (AGL-2913) builds one form from a brief: its design and the declaration
the submit route reads, agreeing with each other. It is a planned kind, like
`layout` and `template`.

- **Runner.** `src/lib/jobs/ai-job-form-step.ts` calls
  `runValidatedGeneration('form', …)` on `ctx.modelFor?.('job.form')`, with no
  extended thinking and the routing table's `job.form` ceiling — the doctrine's
  own for a form, which holds the largest form its output budget admits — as
  much of it as fits the least time the step registers, through
  `AI_JOB_FORM_TOOL`: the doctrine's form tree tool plus `routing` (`inbox`,
  `list` or `lead`, with a list name only when the brief names one) and
  `cannotCollect`. The tree is composed on the palette's `form` surface, whose
  Form Field props are the Forms editor's field settings, generated from the
  forms plugin's attributes; `ai-job-form-parity.spec.ts` holds the step's
  vocabulary to them in both directions.
- **The declaration is derived, never answered.** The step stamps the design as
  the Forms page's Create does (the form node bound to the draft's id and
  captioned with its name, a canvas root above it, no dataset binding) and
  reads `fields` off it with `formFieldDeclsFromNodes`. When the fields can
  yield an email address, it replaces any consent-like field the model drew
  with `MARKETING_CONSENT_FORM_FIELD` (`@aglyn/aglyn/app-utils/forms`, the props of
  the Forms editor's Marketing consent preset) and names it as the form's
  `consentFieldName`. A `lead` proposal stores `routing.lead`. The stored
  routing has no place for an email list, so a `list` proposal leaves the form
  on the Inbox.
- **The check.** `extend` runs `checkFormContract` on the stamped draft, with
  two checks of its own: a form with no named field, and a `list` proposal on a
  form with no email field. Each is a rule 3 finding: asked once more, then a
  doctrine review.
- **What it sends.** The brief, the form's name, the confirmed plan as
  references and the site inventory. It reads no email list, contact, CRM
  record or form submission; the step spec seeds each and asserts none is read
  or sent.
- **The draft.** `writeAiDraft` with kind `form`: the resources route's
  allow-list, its entitlement (`reusableComponents`) before `formsPerHost`, the
  canvas-shaped design in msgpack, a `slug` from the unique name, and no
  version — the form's page mints the first when a member opens it. Nothing is
  promoted and no page places it.
- **The output** is `{ resource: 'form', id, hostId, hostSubdomain, label,
  load, note }`, which the drawer links to the form's page. `note` says what
  the person decides next: the lead routing that is on, how to enroll the people
  who tick consent in an email list, and what the brief asked for that a form
  cannot collect, such as a photo upload; then the facts in square brackets the
  form shows ([What a draft asks the member to fill](#what-a-draft-asks-the-member-to-fill)).
- **The goldens.** `src/lib/jobs/fixtures/ai-job-form-goldens.json` holds
  recorded answers (a roofing quote request with a photo upload, a newsletter
  signup, an anonymous survey) that the step spec runs through the doctrine,
  the contract, the draft writer and the consent reader. No spec calls a live
  provider.
## The component kind

`component` (AGL-2908) builds one reusable component from a brief: its tree,
and the typed properties each page that places it fills in. It is a planned
kind, like `layout` and `template`: the plan step runs first, the job waits
for a member to confirm the plan, and the generation step builds exactly one
draft.

- **Runner.** `src/lib/jobs/ai-job-component-step.ts`, registered by the
  plugin's server surface, calls `runValidatedGeneration('component', …)` on
  `ctx.modelFor?.('job.component')` with no extended thinking and the
  8,000-token answer ceiling the layout step keeps, as much of it as fits the
  least time the step registers. The model answers
  through `submit_component` (`src/lib/tools/ai-component-tool.ts`): the
  doctrine's tree, and `props[]` beside it.
- **The kinds are the Properties dialog's.** The tool offers
  `REUSABLE_PROP_KINDS` less the kinds `AI_COMPONENT_PROP_KINDS_NOT_OFFERED`
  names, each with its reason, which leaves Text, Long text, Image, Link, Icon,
  Number, Yes / no and Choice. A spec holds the two tables in both directions,
  and a kind added to the dialog does not compile until it is offered or
  excused. `readAiComponentProps` stores each property as the dialog's cleaner
  does: trimmed, a default in its kind's own type, only the fields the kind
  uses.
- **An icon is the site owner's pick (AGL-3054).** The Icon element draws the
  path its picker stores beside the icon's id, and a model can name an id but
  never the drawing: on a published page, which never loads the icon catalog, an
  icon a model names draws the empty Icon. So the component palette, and no
  other, offers the Icon (`COMPONENT_EXTRA_IDS` in
  `tools/scripts/generate-ai-palette.mts`), and a component binds it to an Icon
  property whose default is empty, for the owner to pick where a page places the
  component; a default that names an icon is refused (`prop-default`). The
  palette validator drops, with a repair, any icon a model writes itself: a value
  on an icon picker (an Icon's `iconId`, a Button's `startIconId`) that is not a
  component's own token, and a word a page fills an instance's Icon property with.
  The plan names an icon field's kind as `name:icon`. A live About page's card had
  none of this: its plan listed `icon:string`, its step declared the icon as Text
  and drew it as an h3-sized span, and three pages filled it with "family",
  "estate" and "realestate".
- **Bindings.** The tree binds a property with `{{prop.<name>}}`. The palette
  validator keeps a whole token in a field that is not copy, and in `hideIf`
  or `hideUnless`, only while `AiNodeTreeContext.definesComponent` is set.
  Which property may sit in which field is
  `src/lib/runtime/ai-component-bindings.ts`: a field that is not typed into (a
  switch, a dropdown, a screen picker, a slider) takes exactly what the
  Attributes panel offers under its `{}` (`reusablePropBindsToField`, over the
  field kind the generated palette records for each prop as `propFields`), as
  its whole value; a field that is typed into takes copy (Text, Long text,
  Number) whole or inside a sentence, an Image only as a picture's source and
  a Link only as an address. An Icon binds only to an icon picker, whole. A
  Choice's answers must be values the dropdown lists (`unofferedChoiceValues`,
  in core so the designer and the check read one rule).
- **The step's check,** through `extend`, is `aiComponentCheck` in
  `src/lib/jobs/ai-job-component-checks.ts`, which is pure, so the step, the eval
  harness and their specs read one definition: every token names a declared
  property and every declared property is bound, and a property bound nowhere
  is re-asked with where its kind binds (`prop-unbound`: "an Icon to an Icon
  element's iconId"); each sits on a field its kind fits; a copy property named
  or labeled as an icon and shown as words is refused as `icon-as-text`, with a
  re-ask to make it an Icon property bound whole to an Icon's `iconId` with the
  default `""` (AGL-3054); its headings are h3 or below, and an h1 or h2 is
  refused as `component-heading-level` (rule 11, AGL-3057); an optional part is
  hidden by a Yes / no labeled
  `Hide …` whose default is false, bound to `hideIf` on that part and never on
  the whole component; a default fits the field it fills and reads in the site's
  voice (rule 14); an Image default is empty or a library picture (rule 9); the
  confirmed plan's reused components are placed, the properties it lists are
  declared, and a field it lists as `name:icon` is an Icon property
  (`plan-prop-kind`, rule 7). A property handed on to a placed component fits the
  kind that component declares.
- **A component's outline sits under its section's (AGL-3057).** A component is
  placed inside a page section, and every section opens with its own h2. A page's
  outline check reads an instance as one node, never the headings the graft puts in
  its place, so a live About page's practice-area card, whose title was an h2, read
  h2, h2, h2, h2 under the section's h2 and nothing refused it. Two fixes were open:
  read each instance's headings in place during the page check, or hold the
  component to headings a section can hold. The second is the smaller: the site
  inventory carries no component tree by construction (a component is its name and
  its props' kinds), so an in-place read would add every placed component's tree to
  every page pass, while the component check reads the one tree its step already
  holds, where the headings are written. Every existing golden holds it: the
  testimonial card has no heading and the eval team member card's name is an h3. A
  component that would be a whole section, its own h2 and all, is refused the same
  way; that section is built on the page.
- **Drafts.** `writeAiDraft` writes the component as the host resources
  route's `reusableComponent` entry does: that entry's allow-list
  (`displayName`, `description`, `rootId`, `nodes`, `props`), msgpack nodes
  and the route's stamps, admitted by the plan's `reusableComponents` feature
  with the route's own refusal, and counted against no allowance. No version
  is written: the component's page mints the first when a member opens it,
  as it does for a component Use template creates. Nothing places the
  component until a member does.
- **Output.** `{ resource: 'reusableComponent', id, versionId: null, hostId,
  hostSubdomain, label, load, note }`, which the drawer links to the component's
  page; `note` lists the facts in square brackets its tree and its defaults show
  ([What a draft asks the member to fill](#what-a-draft-asks-the-member-to-fill)). A plan that starts from a copy gets the copy through
  `duplicateResource('component', …)` and generates nothing.
- **Fit.** The step's spec measures the cached prefix and the golden answer
  (`src/lib/jobs/goldens/`), holds `AI_STEP_NOMINAL_USAGE['job.component']`
  within a quarter of both, and holds an answer and its one re-ask inside the
  beat's budget at the serving rate it states; the least time the step
  registers is [its own](#every-steps-least-time).

### From a selection, not a brief

The same kind has a second entry point (AGL-2908): a section already on a page
saved as a component, from the besigner's Attributes panel. It is not a job —
there is nothing to plan and nothing to wait for — so it is a door of its own,
`POST /api/ai/generate/component` (`src/lib/server/ai-generate-component.ts`),
answering an `AssistEditProposal` that AGL-2906's own card applies.

- **The seam it needs.** `BesignerInspected` carries `editable` (the
  Attributes panel's own rule, `Besigner.dnd.canDragNode`), so a widget knows
  whether this editor may change the element in place without importing the
  editor. Generic core: `libs/besigner/.../contexts/inspected-selection.ts`
  computes it and `besigner-plugin-zones.component.tsx` passes it on.
- **What it sends.** The outline of the open document
  (`describeAssistEditCanvas`, AGL-2906) and the name the member typed. No
  site inventory, no other page, no entry, product, contact or submission.
- **What it answers.** References, never a document: `props[]` with no
  defaults, and `bindings[]` of `{ nodeId, field, prop }`. The check is a
  closed world over the selection's own subtree, with the binding rules read
  from `runtime/ai-component-bindings.ts` — the from-brief step's own module,
  so the two entry points cannot disagree. It offers every kind the from-brief
  step does but Icon (`AI_COMPONENT_SELECTION_PROP_KINDS`): the apply reads each
  default off the live field, and an icon's default is drawn from a path that
  field does not carry. A property bound nowhere is re-asked with where its kind
  binds.
- **Refused before spend.** A selection that is the document, that carries the
  `main` landmark or a second h1 (rule 11), or that the outline stops short of
  describing whole.
- **The apply.** `applyAssistEditSavingComponent` (`components/assist-edit-canvas.ts`)
  runs AGL-2866's recipe: the definition is read off the live subtree with
  core's `reusableComponentDefinitionFrom`, each bound field's CURRENT value
  becomes that property's default, the component is created through
  `POST /api/hosts/resources` (entitlement and allow-list enforced there), and
  the subtree is swapped for an instance with `replaceSubtreeWithInstance`
  inside one `canvas.batch`. One undo step, on the open draft. The only
  document created is the component; nothing is saved or published.
- **The op.** `saveAsComponent`, in `ASSIST_EDIT_OP_KINDS` with the diff line
  and the op-count word `component`. The chat rung's tool does not offer it.
- **The golden.** `src/lib/jobs/goldens/component-from-selection.json`: a
  feature section with an optional second button.

## The `site` kind

`site` (AGL-2911) is the full-site scaffold, and the one kind that generates
nothing itself.

- **It delegates.** `src/lib/jobs/ai-job-site-step.ts` reads the confirmed plan,
  works out the UNITS it implies, and hands each to the runner registered for
  the kind that owns it — `theme` for the palette change, `layout`, `form`,
  `page` for each screen, `email` for the welcome email — under a job of that
  kind derived from the scaffold's. So a page a scaffold builds is a page job's
  page, held to the same doctrine and written by the same draft writer, and a
  kind whose step this deployment has not loaded is simply not among the units.
  The scaffold asks no model anything.
- **The units, in build order.** The palette change first (a member reads it
  while the pages build), then the layout every page renders inside and the form
  they place — a page binds both by id, so they must exist — then the pages,
  then the welcome email. Each unit's derived job carries `$id`
  `<jobId>-<slot>`, which is what every step already addresses its draft by, so
  a unit re-run after its write finds its own draft rather than writing a
  second.
- **One unit a pass.** The step runs one delegated pass and asks the machine to
  continue, so every pass is one reservation, one provider exchange and one
  recorded spend: the org's monthly ceiling binds a scaffold exactly as it binds
  a chat turn, and credits running out mid-scaffold is the machine's own
  `needs_input` park, resumed by the beat where it stopped. Where it stopped is
  read from the job's OUTPUTS — each unit reports one output of its own resource
  when it completes — so nothing is kept anywhere else. A pass needs the time
  the step that builds its unit registers for the job derived for it
  (`aiSiteJobRunMinimumMs`, AGL-3035): the beat starts the palette change only
  with a theme step's time left, and a page only with a page pass's.
- **What a page is told.** The derived plan holds ONE screen and no creations,
  with every `new:<name>` reference the scaffold has already built resolved to
  the real id and added to `reuse`. That is what a page job's plan rules accept,
  and it is why a page places the scaffold's own form by id rather than planning
  one of its own. SEO travels with each page: the page step writes its search
  listing on its own last pass.
- **The plans it admits.** `src/lib/model/ai-site-job.ts`: four to eight screens,
  each with sections and at most eight of them, unique addresses, at least one
  page in the navigation, and creations limited to a layout, a form and a theme
  change. Anything else is a job of its own, named in the refusal with where a
  member makes it. Refused at confirmation, before a credit is spent.
- **The pass bound.** A scaffold's unit is a whole page, so the default bound an
  audit keeps would cut a real site short: the kind registers its own through
  `registerAiJobStepPasses`, sized to the largest plan the rules admit.
- **Shared with the page job.** A page job builds its plan's creations through the
  same pieces (AGL-3031): `aiCreationUnit` makes a creation a unit, `aiRunJobUnit`
  runs one delegated pass and reports whether the unit is built, and
  `aiSiteBuiltRefs` with `aiSiteUnitJob` resolve `new:<name>` to what was built. A
  creation unit is told the plan's reuse less what the plan's screens place
  themselves, so a layout is never refused for leaving out a card a page places.
- **The estimate is the guard rail.** `aiPlanCreditEstimate` counts the plan's
  passes — one a section, one more a page, one a creation — at the machine's
  nominal credits per step, and the plan proposal shows it beside the button
  that confirms it. It is an estimate and says so; what a step really costs is
  its model's tokens, recorded on the job as it runs.
- **The agency batch.** `src/lib/server/ai-jobs-batch.ts` with the `orgSites`
  console zone's card (`ai-site-batch-card.component.tsx`): one brief across
  many of the org's sites with the business name, city and brand varied per
  site, one `site` job each under one batch id, and a progress table that links
  into each site. Every job is an ordinary scaffold — it plans, it waits for its
  own confirmation, it writes only drafts.

## The doors

Registered under `/api/ai/jobs` by the plugin's console API surface:

- `POST /api/ai/jobs` `{ orgId, hostId?, kind, brief, inputs? }` climbs the
  whole gate ladder (`aiGenerative`, `release_ai_generative`, the `ai-generate`
  switch, the `ai.generate` permission, a per-uid window, a reservation),
  creates the job and runs its first step inline under a 25 s budget. A step
  that finishes in time answers with the job `done`; one that does not is
  aborted, re-queued, and answers `queued` for the beat. A step that says it
  needs more than that budget (`minimumMs`, below) is never started here at
  all: the door hands the reservation back and answers `queued`, so the beat
  runs it with a budget of its own. Every step but a `text` job's is such a
  step (AGL-3026, AGL-3035): a plan, every generation step and every pass of a
  page or a scaffold registers more than 25 s, so only a `text` job — whose one
  request at its ceiling fits the door — runs here, and every other job
  answers `queued` and runs on the beat. A job whose workspace's AI staff paused
  once the ladder had admitted the request is held the same way (AGL-3037). A
  `theme` job must name its site.
- `POST /api/ai/jobs/batch` `{ orgId, brief, businessType, pages, welcomeEmail?,
  sites: [{ hostId, businessName?, city?, brand? }], model? }` is the agency
  batch (AGL-2911): it climbs the same ladder on the ORG axis, holds the plan
  band (`hostLimit ≥ 25`), asks `ai.generate` again for each named site and
  puts each site through the `site` kind's own admission, then creates one
  `site` job per admitted site under one `batchId` and runs NO step — so it
  spends nothing and hands the ladder's reservation straight back. It answers
  `202 { batchId, jobs, refused }`; a site the caller cannot use is reported in
  `refused`, never silently dropped, and a batch where no site could start is a
  403.
- `GET /api/ai/jobs?orgId=` lists the org's jobs newest first. Each summary
  carries `batch`, read off the job's inputs, which is how the console groups a
  run — the only input on the wire form, because a batch id names nothing the
  member wrote.
- `GET /api/ai/jobs/{jobId}/events?orgId=` is server-sent events: a `state`
  frame now, a re-read every 2 s that emits on change, `reconnect` at 55 s.
- `POST /api/ai/jobs/{jobId}/cancel` `{ orgId }` — idempotent; a step in
  flight finishes, records its cost, and finds the job canceled. Audited
  (`ai.job.cancel`).
- `POST /api/ai/jobs/{jobId}/resume` `{ orgId, hostId }` — confirms a plan or
  tries a refused step again. It spends, so it climbs the whole ladder the
  create door climbs, refuses a site that is not the job's, and runs the next
  step inline on its reservation, or leaves a step that needs more time than
  its budget queued for the beat the way the create door does. The admission
  check it asks is handed the plan being confirmed, so a kind that builds only
  some plans refuses the rest here, before any generation spend. Audited
  (`ai.job.resume`).

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
- **What the model is asked.** The call is
  `runValidatedGeneration('theme', …)`: the doctrine's cached block, which
  carries the acceptable-use rules, then the step's own cached rules block,
  and one strict tool. The site's theme — each control with the value the site
  set or the default it inherits — the brand colors and the brief ride in the
  user turn, and no site inventory is sent. The theme's validation is the
  `check`; the doctrine holds rule 13 beside it and re-asks once naming what
  was refused (no tool call, or nothing usable), and a second refusal fails
  the step with its own sentence. The subprocessor gate's `AI_DOORS` lists the
  doctrine as the runtime caller, with what the theme step sends through it.
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

## The email and campaign kinds

`email` and `campaign` (AGL-2912) are the first kinds whose drafts ANOTHER
plugin writes. `email` is a planned kind — its plan is confirmed first, then
its generation step builds one design; `campaign` is unplanned, because there
is one thing to build and a plan over it would be a plan of one.

- **Runners.** `src/lib/jobs/ai-job-email-step.ts` and
  `ai-job-campaign-step.ts`, registered by the plugin's server surface. Both
  generate through `generateAiEmail`, which calls
  `runValidatedGeneration('email', …)` with the doctrine's email tree tool
  widened by `subjects` and `preheaders`, no extended thinking, and the
  routing table's 6,000-token ceiling for the step kind, as much of it as fits
  the least time the step registers on the model the job runs. Only the step
  kind differs (`job.email`, `job.campaign`), so the routing table can price,
  route and time them apart.
- **The door's own checks** ride `extend`: every block sits inside an
  `emailSection`; every `emailButton` links somewhere; the only merge tokens
  are `{{contact.firstName}}`, `{{contact.name}}` and `{{contact.email}}`, and
  only in text; exactly as many `emailProduct` blocks as the job binds
  products; three different subject lines and three preheaders, within their
  lengths and carrying no merge token. When those hold, the design is rendered
  through the owning plugin's `check` and a render problem is re-asked as a
  violation, so a design that does not render is never stored.
- **Drafts through a seam, not an import.** A plugin never imports another's
  internals, so the owner registers a writer for its resource on
  `libs/aglyn/src/lib/plugin-manager/plugin-resource-drafts.ts` — the email
  plugin for `emailDesign` (`server-email-drafts.ts`), the marketing plugin
  for `campaign` (`server/campaign-manage.ts`) — and the step asks for one by
  resource name. Every rule stays the owner's: `refusal` (role and room),
  `check` (well-formed, pure), `read` (the draft under an id) and `write`.
  Both writes are keyed by the job's id, so a run cut off between them finds
  what it wrote: two drafts are reported, a design alone is drafted into its
  campaign from the copy the design stores, and neither spends.
- **Admission.** `src/lib/jobs/ai-job-plugin-drafts.ts` is the caller's half of
  that contract: a site of the job's own org, the owning plugin on for the
  site and past its release flag with its writer registered, the kind's own
  check, then each owner's `refusal` for the member the drafts are for.
- **Where campaign email begins.** A campaign job also needs the entitlement
  the composer and the send route read,
  `checkQuota(org, 'emailSendsPerMonth', 0).allowed` — asked in the admission
  and again in the step, where a refusal stops the job `needs_review` with
  `reason: 'limit'`. The refusal names no plan; the billing page does. Email
  designs are generated on any plan with AI generation.
- **Nothing is sent.** The campaign is written `draft` with only the fields a
  draft holds — the design it sends, its subject, its preheader and the
  alternatives — and no audience, schedule, sender or experiment. The
  scheduled processor queries `status == 'scheduled'`, which a draft never is,
  and no send function is reachable from either step; `ai-job-campaign-step.spec.ts`
  holds both halves.
- **What the model is NOT shown** (`src/lib/jobs/ai-email-bindings.ts`). For
  a campaign email, the published disclosure covers the brief, the site summary
  and the content being worked on — not lists, contacts, CRM records, product
  records or engagement statistics. So each of those runs in code and reaches the model
  at most as a count:
  - **Products** are bound by id from `inputs.productIds`, else from products
    the brief names verbatim. The prompt carries how many cards to place; the
    ids are set on the `emailProduct` nodes after the answer.
  - **The list** a campaign is for is suggested when the brief names one of
    the org's lists, and is set on nothing. It reaches the person as the
    output's `note`.
  - **The send time** is `campaignSendTime` in `@aglyn/shared-ui-email-campaigns`
    over that list's past sends on this site, and is said only in the note.
- **Outputs.** An `emailScreen` output for the design (which opens in the
  screen besigner, as the Emails page's Edit design does) and, for a campaign,
  a `campaign` output carrying the note. A campaign that could not be drafted
  reports NO outputs, because the design alone is not what was asked for.
- **Where the subject and preheader alternatives live**, for the experiments
  kind to read later: on the screen document as `emailSubjectVariants` and
  `emailPreheaderVariants`, and on the drafted campaign email as
  `subjectVariants` and `preheaderVariants`. The first of each is also the
  stored subject and preheader.

## The beat

The beat is a console route, `POST /api/admin/ai-jobs-beat` (AGL-3026). The
plugin's console API surface registers its handler
(`src/lib/server/ai-jobs-beat-route.ts`, which runs `runAiJobsBeat` in
`src/lib/jobs/ai-jobs-beat.ts`), and the console app serves that exact path
from a named route, `apps/console/app/api/admin/ai-jobs-beat/route.ts`, whose
only job is the function time a sweep needs: `maxDuration = 300`, where the
plugin dispatcher's ceiling is a door's 60. Cloud Scheduler calls it every
minute through `consoleAiJobsBeat` in `cloud/functions/src/index.ts`, on the
console's `CRON_SECRET` as `x-cron-secret`: the route answers 501 while the
secret is unset and 401 to a request that does not carry it. It stamps
`ai-jobs-beat` for `/api/health/crons` on every call that does, a call the
switch holds included.

It runs on the console because every step calls the AI provider, and the
provider's key is held by the console alone: the tenant app serves every
published site and holds no provider key, so a step it ran could only fail.
The tenant loads no server surface of this plugin at all — `plugins.config.json`
gives the plugin no `tenantApi` register function — so nothing that serves a
site registers a job kind, a provider or a beat. `/api/admin/` is the path
because the console's edge lets a request past its bot challenge there when it
carries the cron secret's header; a route anywhere else would need a firewall
rule before a scheduler could reach it. It is the one path the plugin registers
outside its own prefixes.

Each beat sweeps under a lease owner of its own (`beat:<uuid>`), fixed for the
whole sweep. `sweepAiJobs` reads queued and running jobs across every org
oldest-first by `updatedAt`, plus a few parked jobs that have rested, and runs
steps until `AI_JOB_SWEEP_BUDGET_MS` (280 s) of wall clock is spent — checked
between jobs, with the time left handed to the step in flight as its abort
signal. The slowest step is fitted to the budget rather than the budget to
it: no step registers more time than a beat can give the first step it starts
([The time budget](#the-time-budget)). The 20 s left of the route's 300 s is
the route's own work around the sweep: loading the plugin surfaces on a cold
start, the lockdown read and the beat's mark, and the last step's record after
its provider call. A beat still running when the next minute fires overlaps
it, and the lease keeps the two apart. The ordering is the cursor: a job the
sweep touches has its `updatedAt` moved to the back; one it did not reach
keeps its place. Two collection-group queries rather than one, so a workspace
with many parked jobs cannot fill the candidate list and starve the queue. A
`needs_review` job is in neither query.

A step that says how long it needs (`minimumMs`) is left queued and untouched
when less than that is left, rather than started and cut off, and keeps its
place at the front of the next beat's queue. Once every due job has had its
turn, a job whose timed step asked to continue runs again in the same sweep
while the time it needs is left, for at most `AI_JOB_SWEEP_MAX_JOBS` further
runs — which is how the page kind builds a page one section to a pass, under
[The page kind](#the-page-kind).

The beat resolves no host and writes only unpublished drafts under the org.
The lock that applies is the `ai-generate` feature switch, which the handler
asks before it claims a step — a lock that stopped the doors and not the beat
would keep spending on every job already queued. The switch composes the
platform lock, and a beat it holds answers 200 `{ held: true }`: an operator's
decision, not a fault for the scheduler to log every minute.

**A workspace whose AI staff have paused runs none of its jobs (AGL-3037).** The
staff org page's Pause AI writes the same switch for one workspace
(`feature--ai-generate--org--{orgId}`), and every jobs door refuses that
workspace's requests through the gate ladder's rung. A job queued before the
pause has no request to refuse, so `runAiJobStep` asks the ladder's own verdict —
`featureLockdownRefusal({ feature: 'ai-generate', staff, orgId })`, through the
reader `src/lib/jobs/ai-jobs-pause.ts` registers from the console surface — before
it claims a step, for queued and running jobs alike, whatever door or beat is
running it.

- **Held, not failed.** The pause is a spend stop that staff lift with Resume AI,
  or that ends at its own expiry, and it leaves the plan, the add-on and every
  entitlement as they were, so what it stops should run again once it lifts —
  the same reading the beat already gives the switch platform-wide, where a job
  it leaves queued stays queued. A site that switched AI off is the workspace's
  own lasting choice instead, and its job fails (AGL-3028).
- **Nothing spent, nothing moved but the queue.** A held job calls no runner,
  takes no reservation and hands back one a door already held; no lease is taken
  and no attempt counted, so resuming runs it from the step it stopped at. Only
  its `updatedAt` moves: the beat's queue is ordered by it, and a paused
  workspace's jobs left at the front would fill every beat's candidates and
  starve every other workspace's. The sweep counts them as `paused`.
- **Staff still verify.** A verified staff caller on an inline door passes, as the
  ladder lets staff through; the beat has no caller. A reader that cannot answer
  is not a pause, as the lockdown reads fail open.

## The `seo` kind

SEO by AI (AGL-2910): `src/lib/jobs/ai-job-seo-step.ts`, its generation call in
`src/lib/runtime/seo-fields.ts`, its strict tools and their answer checks in
`src/lib/tools/ai-seo-tool.ts`, and the audit's scoring — no model — in
`src/lib/runtime/seo-audit.ts`. `inputs.target` names the work:

- `screen` (`screenId`, `versionId`, `fields`, `keywords`): one page's search
  listing, written from the version's text. Asked by the "Write SEO" card in
  the page's SEO panel, through the `seoFields` zone.
- `product` (`name`, `text`, `productId`, `currentTitle`, `currentDescription`,
  `fields`): one product's listing, from what the product editor handed over.
  The step never reads a product document; the commerce plugin's editor hosts
  the same zone through `useConsoleWidgetSlot`.
- `site` (`keywords`, one `/path: keyword, keyword` line a page): the audit.

Every output is `resource: 'seo'` with a `proposal` (`src/lib/model/ai-seo.ts`),
and the step writes nothing. `generateSeoFields` is the stable entry point a page
generator calls for a new page's title and description.

**An audit continues.** The first pass reads the pages the sitemap lists — the
routing map less template, status and non-public screens, through the shared
predicates — with their published versions and the shared layouts; scores every
page; records `audit:report`; and runs the first unit of generated work. Each
later pass runs one more unit — `audit:site` (structured data and the agent
guidance `/llms.txt` leads with), then `audit:fixes:{n}` batches of pages — and
returns `continue: true` while units remain. The machine records a continuing
pass exactly as it records a finished step (the cost, the credits, the outputs,
the audit rows) and hands the same step back as `pending`, its attempts reset
and its `passes` counted; `AI_JOB_STEP_MAX_PASSES` bounds it. Every pass is one
reservation and one provider exchange, so a large site is a few beats of work,
and the job's `creditsSpent` is what the whole audit cost.

**Apply.** `POST /api/ai/seo/apply { orgId, hostId, jobId }`
(`src/lib/server/ai-seo-apply.ts`) takes a finished audit. It opens a NEW
version per page with content fixes — the published version copied, the fixes
applied to the copy by `src/lib/runtime/seo-content-fixes.ts`, a new or rewritten
heading passed through `validateAiNodeTree` — and records the pages whose
listing values wait in their SEO card as the job's `applied.staged`. It never
writes a screen's `seo` or `versionId`, nor the host document; the site-wide
proposals go into the site SEO form as unsaved edits. A page this job already
opened a version for keeps it. Audited `ai.job.apply`, logged `ai.seo.applied`,
behind the jobs read gate, the site's content-write role and the site's
lockdown verdict.

**The doctrine.** Every generation the step makes, whether a listing, an
audit's site proposal or a batch of fixes, runs through
`runValidatedGeneration` (AGL-3009): the doctrine's cached block, which carries
the acceptable-use rules, then the step's own cached rules, and no site
inventory. An answer that breaks a check is asked for once more, with the
broken rules named and the parts at fault quoted; one that still breaks one
ends `needs_input` in the doctrine's sentence (`aiDoctrineNeedsInputMessage`),
which fails a listing's job and becomes an audit unit's note.

## The page kind

`page` (AGL-2907) builds one screen from a brief, as an unpublished draft. It
is a planned kind: the plan step runs first, and once a member confirms the
plan the generation runner builds the layout, forms and components the plan
creates, then its one screen (AGL-3031). A member starts one from "Describe it"
on a site's Screens page (the `hostScreens` widget zone) or from AI jobs in the
Assist panel.

- **Runner.** `src/lib/jobs/ai-job-page-step.ts`, registered by the plugin's
  server surface with `registerAiJobStep('page', runner, { minimumMs:
  AI_JOB_PAGE_STEP_MINIMUM_MS, minimumMsFor: aiPageJobRunMinimumMs })`. The
  generation step continues: each pass builds the next section of the plan's
  screen and answers `continue`, and the last pass builds nothing new. Every
  pass is one reservation and one generation, a section's lookup rounds, its
  answer and its one re-ask.
- **Creations first (AGL-3031).** A doctrine-correct page plan names what the page
  needs and the site lacks — a layout, a card that repeats, a saved form — and a job
  that sent the member away to make them by hand and describe the page again had not
  finished. So the generation step builds them first, one a pass, through the site
  scaffold's unit machinery (`aiPageJobUnits`: the layout, then forms, then
  components). Each is handed to the step registered for its kind under a job derived
  from this one, `<jobId>-c<index>` by its place in the plan, so a pass run again finds
  its own draft; each lands as the draft that step writes, unpublished and placed
  nowhere; and where the job stands is read from its outputs. Once every creation is
  built, the page's passes run on the plan with each `new:<name>` resolved to the
  record that was built, which the site's inventory now lists, so the page places the
  new component and binds the new form by id and renders inside the new layout. A
  creation that stops for a person stops the job; one that reports nothing, or whose
  kind no step builds here, fails it. `AI_JOB_PAGE_MAX_PASSES` bounds a job at every
  creation and section the plan limits admit, and the last pass. The proposal lists
  every creation and the whole job's estimate (`aiJobPlanCreditEstimate`: one pass a
  section, one for the page's last pass, one a creation), and confirming holds the job
  at that estimate.
- **Sections.** `src/lib/jobs/ai-job-page-sections.ts` holds what a pass asks
  for and how its answer is checked. `runValidatedGeneration('page-section',
  …)` sends the section tool (`submit_section`), the page instructions with
  the screen palette catalog as the last cached block, no extended thinking,
  and an answer ceiling from `aiJobPageSectionMaxTokens`. The request names
  the page, its type, the brief, the confirmed plan as references, the section
  to build with the inventory ids it places, the names of the sections built
  above it, never their content, and the most elements the section may carry
  (`aiJobPageSectionMaxElements`, [in real tokens](#the-time-budget)). A section
  cut off at its ceiling is re-asked for a smaller one — fewer elements, shorter
  copy, a repeated item placed as an instance, or written once where the
  workspace keeps no reusable components — and one cut off twice stops as
  too large to build in one pass
  ([An answer cut off at its ceiling](#an-answer-cut-off-at-its-ceiling)). The
  check draws a repeated item written once into its copies
  ([below](#a-repeated-item-written-once)), then runs the palette validator
  on the section, then `validateAiDoctrineTree(page, 'page')` on the page
  built so far with the section added, then the plan line: every component the
  section's `uses` names placed as an instance and every form bound by id
  (rule 7). Violations name the section's own nodes by the ids the model
  wrote, so a re-ask quotes that section alone. A section's root id comes from
  the job and its plan index, so a pass that runs again finds it and writes
  nothing twice.
- **A Grid of columns (AGL-3055).** A section's cards, a footer's columns and a
  component's rows are laid out as a Grid container of sized Grid items, each full width
  on a phone and stepping up; [A Grid of columns](#a-grid-of-columns) has the rule and
  its refusals.
- **A repeated item written once (AGL-3053).** On a workspace that keeps no reusable
  components a repeated item is drawn where it repeats, and written out card by card
  every copy repeats its whole subtree inside the escaped JSON of the tool call: a
  live Free About page's four practice areas were cut off at the 1,050-token ceiling
  on their answer and on their re-ask. So there the answer writes the item once.
  [A repeated item written once](#a-repeated-item-written-once) has the shape, the
  refusals and what it saves.
- **The last pass.** The whole page against the doctrine (a `doctrine` review,
  spending nothing, when a rule no longer holds); the search title and
  description from `generateSeoFields` on `job.seo`, written from the page's
  own text, the site's name and the other screens' names; and the screen
  output with its `load`, a `note` listing the facts in square brackets the page
  and its placed components' defaults show
  ([What a draft asks the member to fill](#what-a-draft-asks-the-member-to-fill)),
  and, when the plan sets `nav`, a `proposal.navigation` label and slug, which AI
  jobs shows as a line for the member to act on once the page is live. No menu is written. When the SEO
  model's worst case does not fit the pass, the plan's listing is written
  instead, held to the SEO editor's lengths (`SCREEN_SEO_TEXT_GUIDANCE`). A
  listing a member typed is never replaced.
- **The draft.** `ai-job-drafts.ts` gains the `screen` kind: the resources
  route's `RESOURCES.screen` allow-list (the drafts spec reads the route in
  both directions), the route's stamps and `nameLower`, `billableScreenIds`
  over the screens and the host's routing map read inside the transaction, a
  one-segment slug no live screen or routed path holds, and a first version
  with `screenId`, `hostId`, `displayName`, `nodes` and the plan's
  `layoutId`. It never writes the host document, its routing map,
  `publishedAt` or a publish schedule, so the screen serves nothing until a
  member publishes it (`publishScreenRoute`), and an unrouted draft still
  counts against `screensPerHost`. `updateAiDraftNodes` adds a section to the
  stored version with a fresh `updatedAt`, which the besigner's save guard
  compares; `writeAiDraftScreenSeo` fills only empty listing fields.
- **Admission.** `registerAiJobAdmission('page')`: a known `inputs.pageType`
  when one is given, a site of the job's own org, and room under
  `screensPerHost`. The resume door hands the check the plan being confirmed
  (`AiJobAdmissionContext.plan`), and a page job refuses, before any
  generation spend, a plan that is not one screen with sections, that creates
  what a page job does not build — a template, a theme change, a dataset or an
  email design, named with where to create it (`aiPagePlanRefusal` in
  `src/lib/model/ai-page-job.ts`) — that creates a kind no registered step
  builds, or that creates what the workspace may no longer make on the site
  (`aiPageCreationRefusal`, read with `readAiPlanCapabilities`). The plan step is
  told what a page job may create, re-asks a plan that creates anything else,
  and asks the same admission of the plan before it is kept, so such a plan is
  refused before a member is shown a Confirm (AGL-3030).

### A repeated item written once

A workspace that keeps no reusable components draws a repeated item where it repeats
(AGL-3030). Written out card by card, every copy repeats its Card, its body, its
heading and its text, each node's JSON escaped inside the `submit_section` call, and a
live Free About page's four practice areas were cut off at the balanced tier's
1,050-token ceiling on their answer and on their re-ask. The ceiling holds the Free
wall and does not move, so the answer writes the item once (AGL-3053):

```json
"cell":  { "componentId": "muiGrid", "props": { "size": "xs:12 sm:6 md:3" }, "nodes": ["card"],
           "repeat": [["Estate planning", "Wills and trusts…"], ["Real estate", "Closings…"]] },
"card":  { "componentId": "muiCard", "nodes": ["body"] },
"title": { "componentId": "muiTypography", "props": { "variant": "h3", "children": "{{1}}" } },
"text":  { "componentId": "muiTypography", "props": { "variant": "body2", "children": "{{2}}" } }
```

- **The shape.** `repeat` on the item's outermost node holds one list of values a
  copy, and `{{n}}` stands for a copy's n-th value anywhere in the item's props or
  styles. Positional values are the smallest list a copy can be: a value costs its
  quotes and a comma, where a named value repeats its name on every copy and a list
  of columns keeps a copy's values apart. Numbered placeholders are the one token no
  binding can be: a site variable's `{{name}}` starts with a letter, and
  `{{prop.name}}`, `{{entry.field}}` and `{{fn:…}}` carry a dot or a colon
  (`binding-tokens.ts`), so copy that binds a variable keeps its token and nothing a
  placeholder leaves behind can bind.
- **Asked only where it applies.** Every request on such a workspace carries
  `AI_PAGE_SECTION_INLINE_LINE` ("write a repeated item once"), and a section whose
  plan line shows items also carries `AI_PAGE_SECTION_REPEAT_LINE`, which spells the
  shape with an example. The page instructions every workspace caches say only that a
  repeated item is written once, so a workspace that places components is never shown
  how, and a section with nothing to repeat pays nothing for it. A section cut off at
  its ceiling there is re-asked with the shape spelled out (`aiPageSectionSmaller`),
  since its first request may not have carried it.
- **Drawn before any check.** `expandAiRepeatedItems`
  (`src/lib/runtime/ai-repeated-items.ts`) clones the item once a copy, in order, in
  its place under its parent: the first copy keeps the ids the model wrote, and copy
  `n` takes `<id>~<n>` on every node of the subtree. A whole-string placeholder keeps
  its value's type. `aiPageSectionCheck` then runs the palette validator, the page
  check and the plan line on the drawn section exactly as on one written out, and the
  page stores the drawn section: no draft, besigner or tenant render ever sees
  `repeat` or a placeholder. A finding on the copies names the node the model wrote,
  once.
- **Refused, with a re-ask that names the model's nodes.** On a workspace that keeps
  reusable components, `repeat-not-inline` (rule 1: place the component as instances).
  Everywhere else, as an answer that could not be used: `repeat-on-section` (on the
  document wrapper or the Section), `repeat-nested`, `repeat-shape` (not one list of
  values a copy), `repeat-count` (under 2 copies, or over `AI_REPEAT_MAX_COPIES`, 7,
  the most rule 8 leaves a typed list), `repeat-placeholder-without-value` (a copy
  gives no value for a placeholder, `{{0}}`, or a placeholder in no repeated item),
  `repeat-value-without-placeholder` (a value past the last placeholder, a gap in the
  numbering, or values with no numbered placeholder at all, such as `{{title}}`), and
  `repeat-id-collision` (a copy's id the answer already gives another node).
- **What it saves.** `ai-job-page-evals.spec.ts` measures the goldens as it measures
  every section, in real tokens, each card in the Grid item of a responsive row
  ([A Grid of columns](#a-grid-of-columns)). The Free About golden's practice areas
  written once take 10 elements at 625 real tokens, where written out they take 25 at
  1,159. `AI_FREE_PRACTICE_AREAS_FIXTURE` gives a Free law firm's practice areas the copy
  a firm writes, 25 to 29 words a summary: its four practice areas written once take 10
  elements at 770 real tokens, and 25 at 1,304 written out; its six take 10 elements at
  932 real tokens, and 35 at 1,830 written out. Both fit the 1,050-token pass written
  once, and neither fits written out. The spec replays that page through the real page
  step on a Free org, and holds each drawn section equal to the one written out, node
  for node apart from ids, through the same checks and to the same stored page.
- **The Free wall does not move.** The inline line is 9 characters shorter than the one
  it replaced, and so are the cached page instructions, so the Free page's first pass —
  its hero, with nothing to repeat — is cheaper than before, and the arithmetic's
  figures stay where they were ([Evals](#evals)). The 201-character repeat line rides
  only the user turn of the pass that builds the practice areas, which stays inside the
  credits it came to before.
- **The eval harness reads the same shape.** A `page` answer is drawn the same way
  before it is scored (`checkTree` in `src/lib/runtime/ai-eval.ts`), and refused the
  same way: the Free About case holds the page written once as a golden beside the page
  written out, and controls for a copy with a missing value and for named
  placeholders; a paid case holds an item written once as a control that fails.

### A Grid of columns

The palette's Grid (`muiGrid`) is one element in both of MUI's roles: a container
(`"container": true`) lays its direct Grid children out in columns, and an item takes a
`size`, a fraction of its container's columns stored as one string the Grid renderer
parses (`parseBreakpointSpan` in `@aglyn/shared-data-enums/breakpoint-span`): a bare span
such as `"6"`, or pairs such as `"xs:12 md:4"`. A live About page's practice areas were a
Grid with no container holding three items sized `"4"` (AGL-3055): sized against no
container, they stacked one under another at every width, and a size that holds at every
width would have kept a phone's columns a third of its width. The goldens drew their cards
the same way, in a Grid with a row direction and no container.

- **Told once, in the page instructions.** The palette catalog shows five of a Grid's
  props, and `container` and `spacing` are not among them, so the line that tells a
  section how to lay itself out names both and the size format: `a Grid ("container":
  true, "spacing": 3) of Grid items sized like "xs:12 md:4"`, 72 characters more of the
  page prefix.
- **Held by `detectUnresponsiveGrids`** (`runtime/ai-doctrine-validators.ts`, rule 12) on
  every page, template, layout and component tree, with each re-ask naming the Grid or
  its items by the model's own ids:
  - `grid-not-container`: a Grid that is not a container but holds sized Grid items, sets
    a prop only a container reads (`direction`, `wrap`, `spacing`, `rowSpacing`,
    `columnSpacing`, `columns`), or holds two or more elements without being an item of a
    container. The re-ask: set `"container": true`, and put each column in a Grid item
    sized like `"xs:12 md:4"`.
  - `grid-item-size`: a container's child that is not a Grid item whose size is full
    width on a phone (`xs` at the container's columns, or a bare full span), or a
    container of two or more whose items never step down to columns at a larger width.
    The re-ask gives the size for that many columns: `"xs:12 md:6"` for two,
    `"xs:12 md:4"` for three, `"xs:12 sm:6 md:3"` for four and `"xs:12 sm:6 md:4"` for more,
    written as one string, and says to wrap any other element in such an item.
  - `grid-gap`: a container spaced by an `sx` `gap` or `columnGap`. MUI sizes a container's
    items by its `spacing`, so a gap on top of it pushes the last column onto a row of its
    own. The re-ask: remove the sx gap and set `"spacing"` to its value.
- **The goldens are real rows.** `ai-page-briefs.ts` draws every row of cards as a Grid
  container (`"spacing": 3`) of items sized for the row (`span`): the ten briefs'
  component cards, the Free pages' inline cards written out and written once (the
  `repeat` now rides the Grid item), the creation page's quotes and the two-person page's
  roomier cells. The two-person introduction itself keeps its 15 elements with a Stack
  whose direction turns from a column into a row at md. The Free About eval case holds its
  page written out and written once the same way, with a failing control for each
  refusal: the goldens' old shape and the live page's shape (`grid-not-container`), items
  sized `"4"` at every width (`grid-item-size`) and a container spaced by an sx gap
  (`grid-gap`).
- **What it costs.** The page instructions grow by 72 characters (18 estimated tokens of
  the page-section ledger's prefix), and no credit figure the Free arithmetic quotes
  moves. A Grid item is an element, so a row of cards takes one more element a card:
  written once, one.

### A finished section

The first live Free About page (AGL-3072) passed every check with three defects a
reader sees at once: a hero subhead ending "…that matter most, with", a list of estate
planning services whose last item had no words, and a "Request a Consultation" button
that went nowhere. Validators in `runtime/ai-doctrine-validators.ts` refuse each on every
page, template, layout and component tree, and the line the palette validator cut short
wherever it cuts one (AGL-3076), in the loop every rule uses, with a re-ask that names the
model's own nodes and says what to write instead:

- **Rule 14, `dangling-word`** (`detectDanglingWords`, `aiDanglingWord`). A line a reader
  reads — a Typography's text in any style but a caption, an overline or a micro label,
  a List Item Text's primary and secondary text, a Card Header's title and subheader, an
  Accordion Summary, an email's text — with no closing punctuation is refused when it
  ends on an article (`a` in lowercase, `an`, `the`) or a joining conjunction (`and`,
  `or`, `but`, `nor`, `&`), or on a word that opens a phrase (a closed list of
  prepositions and subordinating conjunctions such as `with`, `for`, `from` and
  `because`) right after a comma, a semicolon or a dash. So "What we help with" is a
  title and "…matter most, with" is a sentence cut short. A button's or a link's label,
  a form field's label, a run of Inline Text, a bracketed fact and a binding are never
  held to how they end. The re-ask quotes the line's last words and says to finish the
  sentence or end it before that word.
- **Rule 16, `empty-item`** (`detectEmptyItems`). A List Item or a Card that holds
  elements, none of which shows a word, a picture or anything else, is an empty row or
  box. One that holds no element at all stays `empty-container`'s. The re-ask says to
  write the item's words or take it out.
- **Rule 10, `link-without-destination`** (`detectLinksWithoutDestination`). A Button
  and a Screen Link carry two destinations, a `screenId` and an `href`, and nothing
  else: the palette validator keeps a screen the site has and an `href` that is a path
  on the site, an `https:` address or a binding the caller admitted. A form is sent by
  the button the Form draws from its own `submitLabel`, the elements a page places carry
  no id an anchor could name (AGL-2867, so a bare `#fragment` is dropped), and a
  generated node sets no interaction. So a link with neither is refused; the re-ask names
  its words and both destinations, a screen that does what those words say, so the answer
  it asks for is not sent home for `link-unrelated-screen` to refuse next, and says to take
  it out when the site has no page for it, or, inside a Form, to set the form's
  `submitLabel` instead. An email's buttons
  stay the email door's (`email-button-link`).
- **Rule 14, `copy-cut-at-ceiling`** (`detectCutLines`, AGL-3076). The live subhead was
  not written that way: it is a Typography in the h5 style, and the palette validator
  holds a heading style's text to `AI_TEXT_LIMITS.headline`, 120 characters, and cut the
  sentence there — "…that matter most, with clear advice and steady support." stored
  as "…that matter most, with". The catalog shows a model `children=text≤2000`, the cut
  was only a line in the tree's `repairs`, and a cut falls inside a word as readily as
  after one, where no word list can see it. So a line (as above) or a Button's, Screen
  Link's or email button's label the validator cut at its ceiling is refused, read from
  the validator's repairs: in `validateAiDoctrineTree`, and in the page section check,
  whose page check reads the section as stored and so already cut. The re-ask quotes the
  line as the model wrote it and names the ceiling, and for a heading style says to write
  it within 120 characters or give a longer line a subtitle or body style. A line cut on
  a dangling word is named by both rules, the cut first.
- **The starter examples a template is shown** (`runtime/ai-template-examples.ts`) leave
  a Button or Screen Link with no destination out, as they leave out an inline form: the
  Portfolio starter's hero "Get in touch" points nowhere until a member picks where it
  goes. The template ledger's prefix moves from 4,987 to 4,956 estimated tokens.
- **Controls.** The validators spec refuses the live page's hero and estate planning
  sections, kept by hand as `AI_FREE_PAGE_BUILT_SECTIONS` in
  `jobs/fixtures/ai-free-page-recording.ts`, for exactly these three findings and
  nothing else; a section pass names each by the model's own id, and a cut line by the id
  of the item a copy was drawn from; and the Free About eval case holds a failing control
  for each of the four. The section eval case's call to action now links a path.
- **What it costs.** No prompt line: a rule costs nothing until an answer breaks it, and
  then one re-ask. No credit figure the Free arithmetic quotes moves.

### The time budget

The beat gives a step what is left of `AI_JOB_SWEEP_BUDGET_MS` (280 s) as its
abort signal, and a provider call that signal cuts off is still generated and
billed upstream while the meter records nothing. So a step says how long it
needs, and the machine does not start it with less.

- `registerAiJobStep(kind, runner, { minimumMs })` records the least time a
  kind's generation step needs, and `registerAiJobPlanStep(runner, { minimumMs })`
  the plan step's, which every planned kind shares (`aiJobStepMinimumMs`). A
  step whose runs need different times also registers `minimumMsFor(job)`, the
  time the job's next run needs, never read as less than `minimumMs`
  (`aiJobStepRunMinimumMs`, AGL-3035): a page job's pass that builds a layout
  needs a layout step's time, and a scaffold's pass the time of the step its
  unit is handed to. The sweep leaves a step whose next run needs more than its
  time left queued and untouched, so it keeps its place at the front of the
  next beat's queue. An inline door whose budget (`AI_JOB_INLINE_BUDGET_MS`,
  25 s) is less than that hands the reservation back and answers with the job
  `queued` for the beat. Once every due job has had its turn, a job whose timed
  step asked to continue runs again in the same sweep while the time it needs
  is left, for at most `AI_JOB_SWEEP_MAX_JOBS` further runs. A step with no
  minimum is never run again in the same sweep, since it could start with too
  little time left.
- `src/lib/jobs/ai-job-budget.ts` plans a generation's worst case: every
  model call it may make answered at its ceiling. **The rates are declared
  assumptions, not measurements**: 100, 60 and 40 output tokens a second on
  the fast, balanced and deep tiers, an unknown model at the slowest, and 3 s
  before a provider starts answering, with 3 s for the step's own reads and
  writes and 4 s for the queue read before a sweep's first step. No recorded
  run has measured them; a measured run replaces them.
- **Every model call, not only the answers (AGL-3036).** A generation offered
  the site inventory may spend `AI_INVENTORY_LOOKUP_MAX_ROUNDS` (2) model calls
  looking records up before it answers, each asked at the answer's ceiling.
  The doctrine's loop holds the whole generation — its lookup rounds, its
  answer and its re-ask — to one allowance of output, twice the ceiling, and
  asks each call for no more than is left of it
  ([The inventory, and "more on request"](#the-inventory-and-more-on-request)).
  So a generation's worst case is a first-token wait for every call, the whole
  allowance at the tier's rate, and the step's own reads and writes: (2 answers
  + 2 lookup rounds) × 3 s + 2 × the ceiling's answer + 3 s. A lookup round adds
  its wait, and the output it spends is output no answer can. A generation
  offered no inventory — a theme, a listing — makes no lookup, and a step that
  reads more before it generates counts that too. `ai-job-budget.spec.ts` drives
  the loop on a fake clock through both lookup rounds, an answer that breaks a
  rule and its re-ask, on every tier, and holds it to exactly that worst case;
  lookup rounds that spend the whole allowance stop the loop inside it.
- **The most a step may need.** `AI_JOB_STEP_MAX_MINIMUM_MS` is the beat's
  280 s less its 4 s queue read: the 276,000 ms a beat can give a step. A step
  that needed more could never start. So a generation whose worst case at its
  routing ceiling needs more asks the tier its step kind is served from for as
  much of that ceiling as fits, and registers what that takes
  (`aiJobStepBudget`); a slower tier asks less, so its worst case fits the same
  minimum. The beat's budget, the route's 300 s `maxDuration` and the 330 s
  lease stay where they were: steps are fitted to the budget rather than the
  budget to them, and the lease is sized from `maxDuration`, which counting
  lookups does not move.
- A plan needs `AI_JOB_PLAN_STEP_MINIMUM_MS` (AGL-3026, AGL-3036): its two
  lookup rounds, its answer and its re-ask on the tier the `job.plan` step is
  served from. At the routing table's 8,000 tokens on the balanced tier that is
  4 × 3 s + 2 × 133,334 ms + 3 s = 281,668 ms, past the 276,000 ms a beat can
  give a step, so the balanced tier asks for 7,830 tokens: 4 × 3 s + 2 ×
  130,500 ms + 3 s = 276,000 ms. That is still above the 3,954 output tokens
  the live Free plan measured, past an inline door's 25 s — so neither door
  ever starts a plan (live plans have run 23 to 42 s, and a cut-off one is
  billed and unmetered) — and inside the beat's `AI_JOB_SWEEP_BUDGET_MS`
  (280 s). The fast tier asks for 8,000 tokens and the deep tier for 5,220
  (`aiJobPlanMaxTokens`). `ai-job-plan-step.spec.ts` runs a plan on a fake
  clock on every tier through both lookup rounds, an answer that breaks a rule
  and its re-ask, and holds it inside the minimum, and the minimum between the
  two budgets.
- A page pass needs `AI_JOB_PAGE_STEP_MINIMUM_MS`: a section's two lookup
  rounds, its answer and its re-ask at `AI_JOB_PAGE_SECTION_TOKENS` (1,050
  tokens) on the balanced tier, 4 × 3 s + 2 × 17,500 ms + 3 s = 50,000 ms. Its
  answer ceiling is the largest whose worst case fits that on the model the job
  runs, and at most `AI_JOB_PAGE_SECTION_MAX_TOKENS` (2,000): 1,750 tokens on
  the fast tier, 1,050 on the balanced tier and 700 on the deep tier — the
  ceilings every golden section and the Free page's arithmetic are measured
  at. `ai-job-page-step.spec.ts` runs a pass on a fake clock on
  every tier through both lookup rounds, an answer that breaks a rule and its
  re-ask, and holds it inside the minimum, and the minimum inside what a beat
  can give a step and past an inline door's 25 s.
- **The element budget, in real tokens (AGL-3042).** The request asks a section
  to keep under the elements its ceiling holds, and the ceiling is counted in
  the provider's tokens. An element is `AI_JOB_PAGE_TOKENS_PER_ELEMENT` (45
  tokens) estimated at four characters a token, measured on the golden
  sections; real tokens run above that estimate by
  `AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED`, the 1.5427 the first live document run
  measured (the Free page's ratio below, on prompt text). So an element is
  `AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT` (70 real tokens an element, 45 × 1.5427
  rounded up), and `aiJobPageSectionMaxElements` asks for 25 elements on the
  fast tier, 15 on the balanced tier and 10 on the deep tier. Fifteen elements
  of the goldens' largest come to 1,042 real tokens of the 1,050; the 23 an
  estimate-counted budget allowed came to 1,597, and a live About page's
  section introducing two attorneys was cut off at the ceiling on its answer
  and its re-ask. The budget counts every element at the goldens' largest, so
  it errs dear for a section of many small ones: the Free page's four inline
  practice-area cards written out, each in its Grid item, take 25 elements at 1,159 real
  tokens: 46 real tokens an element, against the 70 the budget counts. Written once, as
  a workspace without reusable components answers them
  ([A repeated item written once](#a-repeated-item-written-once)), they take 10. The
  request's line is the same length either way, so no figure the Free page's
  arithmetic quotes moves.
- **The ceiling does not move to make a section fit.** The balanced tier's
  1,050 fits the Free page's wall with little to spare: past 1,060 tokens the
  first section pass costs 45 credits, and the Free page that builds its layout
  first leaves 45 of the 300 — no more than that pass, which is the room the
  arithmetic keeps for a re-asked section. A two-person introduction drawn
  roomier, in the 20 elements an estimate-counted budget allowed, needs 1,114
  real tokens, so no ceiling the wall holds fits it; drawn in 15, it needs 834.
  A plan rule that splits a section cannot see how long its items' copy runs,
  so the budget is what changes.
- A creation a page job builds runs inside a page pass (AGL-3031), handed to the
  step of its own kind, which keeps the ceiling it keeps as a job of that kind —
  far past a section's time. So that pass needs the time the creation's step
  registers (`aiPageJobRunMinimumMs`, AGL-3035): a layout's or a component's
  276,000 ms, a form's 215,000 ms. `ai-job-step-minimums.spec.ts` walks a page
  job through its creations and its sections, and a scaffold through its units,
  against the machine's own registry.

### Every step's least time

Every generation step the console registers declares the least time it needs
(AGL-3035), computed by `aiJobStepBudget` from the routing table's ceiling on the
tier its step kind is served from — never set by hand. The table is each step's
worst case on that tier and the ceiling it asks on each tier; a slower tier asks
less so its worst case fits the same minimum. `ai-job-step-minimums.spec.ts`
registers the plugin as the console does, walks every kind and every step in the
machine's own registry, fails on a step that registered no least time, and holds
this table to the figures the code computes.

| step | tier served | lookup rounds | ceiling asked: fast / balanced / deep | least time on the served tier |
| --- | --- | --- | --- | --- |
| `plan` | balanced | 2 | 8,000 / 7,830 / 5,220 | 4 × 3 s + 2 × 130,500 ms + 3 s = 276,000 ms |
| `component` | balanced | 2 | 8,000 / 7,830 / 5,220 | 4 × 3 s + 2 × 130,500 ms + 3 s = 276,000 ms |
| `layout` | balanced | 2 | 8,000 / 7,830 / 5,220 | 4 × 3 s + 2 × 130,500 ms + 3 s = 276,000 ms |
| `template` | balanced | 2 | 8,000 / 7,830 / 5,220 | 4 × 3 s + 2 × 130,500 ms + 3 s = 276,000 ms |
| `form` | balanced | 2 | 6,000 / 6,000 / 4,000 | 4 × 3 s + 2 × 100,000 ms + 3 s = 215,000 ms |
| `email` | balanced | 2 | 6,000 / 6,000 / 4,000 | 4 × 3 s + 2 × 100,000 ms + 3 s = 215,000 ms |
| `campaign` | balanced | 2 | 6,000 / 6,000 / 4,000 | 4 × 3 s + 2 × 100,000 ms + 3 s = 215,000 ms |
| `page`, a section pass | balanced | 2 | 1,750 / 1,050 / 700 | 4 × 3 s + 2 × 17,500 ms + 3 s = 50,000 ms |
| `theme` | balanced | 0 | 8,000 / 7,770 / 5,180 | 2 × 3 s + 2 × 129,500 ms + 3 s + 8 s = 276,000 ms |
| `seo`, a batch of fixes | fast | 0 | 4,000 / 2,400 / 1,600 | 2 × 3 s + 2 × 40,000 ms + 3 s + 10 s = 99,000 ms |
| `text` | balanced | 0 | 1,024 / 1,024 / 682 | 1 × 3 s + 1 × 17,067 ms + 3 s = 23,067 ms |

- **Only a `text` job and a `crm` job run at an inline door.** A `crm` step's
  answer and re-ask fit at its ceiling (see [The `crm` kind](#the-crm-kind)).
  A text job's one request — no re-ask, and
  no inventory to look anything up in — at its routing ceiling fits the door's
  25 s, as the helper computes it. Every other step needs more, so both doors
  leave it for the beat.
- **A theme reads the brand first.** Its 8 s is `AI_THEME_BRAND_BUDGET_MS`, the
  bound on reading the site logo's and a linked page's colors before it asks.
- **An SEO pass is timed by its largest generation.** A listing asks at most
  1,024 tokens and an audit's site-wide proposal 1,500, both whole on every tier
  inside the minimum; a batch of fixes asks 4,000 on the fast tier it is served
  from, and less on a slower one. Its 10 s is `AI_SEO_AUDIT_READS_MS`, the
  declared assumption for an audit's read of up to 150 published pages before
  its first pass asks.
- **A page or a scaffold pass needs its unit's time.** The table's `page` row is
  a section pass; a page job's pass that builds a creation needs the creation's
  row, and a scaffold's pass the row of the step its unit is handed to — a
  palette change the `theme` row, a page the `page` row. The theme, SEO and page
  times are declared in `ai-job-theme-budget.ts`, `ai-job-seo-budget.ts` and
  `ai-job-page-budget.ts`, so the machine and the scaffold read them without
  loading the steps.

### Evals

`src/lib/jobs/fixtures/ai-page-briefs.ts` holds ten briefs across the ICPs:
four agency client sites, three multi-brand businesses and three single small
businesses, over seven page types. Their answers are **golden**: written by
hand in the shape a section answer takes, never recorded from a provider.
`ai-job-page-evals.spec.ts` replays each through the real step, plan rules,
doctrine and draft writer. Every plan is one a page job builds; every page
keeps the doctrine, carries no main landmark of its own (the layout's slot is
the document's one main) and no raw binding token; and every section fits the
balanced tier's answer ceiling in real tokens, at the ratio measured live, under
the element budget its request asks for.

- **Credits per page: an estimate.** 48 credits per page: the median
  (the higher middle value) of the ten golden pages, each priced from the
  requests the step sent and the golden answers at four characters a token,
  at the catalog rates of the models the routing table picks, with the cached
  prefix written on a page's first pass and read on the others, no re-ask,
  and the listing exchange at the SEO step's nominal usage. It is not a
  measurement, and customer docs quote no figure: a job shows what it used in
  AI jobs. A recorded run through AGL-2937's harness replaces it.
- **A two-person introduction fits a pass (AGL-3042).** `AI_TWO_PERSON_PAGE_FIXTURE`
  is a law firm's About page on a paid workspace whose site keeps no card for a
  person: a hero, then its two attorneys, each with a photo, a name, a role and a
  short bio, drawn where they stand because two items are fewer than a component
  is required for. `ai-job-page-evals.spec.ts` replays it through the real page
  step: the introduction, a Card a person in 15 elements, side by side from md in a
  Stack whose direction turns from a column into a row (a Grid of two takes two more
  elements than the pass allows), is 540 estimated tokens and 834 real, inside the 15
  elements and the 1,050 tokens its pass asks for on the balanced tier. The same two
  people drawn roomier — a Grid item, a card body and styles a person, and an
  introduction — make a section the page's rules keep, in 20 elements, inside the 23
  an estimate-counted budget allows, at 1,114 real tokens, past the ceiling. On every
  tier the spec holds a section of the goldens' largest elements inside its ceiling
  at its element budget, and past it at one element more.
- **A plan with creations, built end to end.** `AI_PAGE_CREATION_FIXTURE` is a
  roofing page on a Starter site with no layout, card or form: its plan creates all
  three. `ai-job-page-evals.spec.ts` replays it through the real page step, handing
  each creation to the real layout, form and component steps on the goldens their
  own specs hold, with the site's inventory read as it grows, and holds the order
  (layout, form, component, then the page), each draft under its derived id, a page
  that renders inside the new layout and places the new card and form by id, every
  building rule on the page, each draft's note of the facts in square brackets it
  shows (the card's role, which no quote sets, named once for its three placements),
  and nothing published.
- **A Free page fits the taste.** `ai-job-free-page.spec.ts` replays
  `AI_FREE_PAGE_FIXTURE` — an about page with four practice areas, written once, and
  a consultation form, on a Free site that already has its one layout — through the
  real plan and page steps on a Free org, and holds the arithmetic: the page plan at
  the tokens measured live on a Free workspace (1,366 input, 4,059 cache read,
  4,059 cache write and 3,954 output on claude-sonnet-5, 80 credits), grown with the
  cached prefix and the capability lines as they stand now; every section pass at
  its answer ceiling, the first writing the cache; and the listing at the SEO step's
  nominal usage. Characters are read four to a token and scaled by what the live
  run measured against the ledger's estimate, the higher of the plan's and the
  layout's ratios. The four-section Free page comes to at most 190 credits of the
  300, and a Free page fits 9 sections at every pass's ceiling. On a Free site with
  no layout yet, the page job builds the one layout the Free plan includes first
  (AGL-3031), at the layout generation measured live (1,709 input, 6,649 cache read,
  6,649 cache write and 2,057 output), grown with the layout request's cached prefix:
  the same page that creates its layout first comes to at most 254 credits, and a
  Free page fits 6 sections with its layout. Those two counts are what the plan rules
  hold a Free plan to (AGL-3070): the spec computes them with the plan rules' own
  `aiFreePageSectionsWithin` and holds each exchange's figure to
  `AI_FREE_PAGE_WORST_CASE_CREDITS`, and replays the live plan of eight sections beside
  its layout through the real plan step to a re-ask that keeps six. The spec fails when
  a doctrine or plan change pushes the figure past the wall or out of step with this
  sentence. When a live run has recorded the Free brief
  (`AI_EVAL_LIVE=1 AI_EVAL_CASES=page-free-law-firm-about npm run eval:ai-live`), the
  spec also holds that recording to a built page and to the wall at the credits it
  metered: a recording that stopped, answered its plan alone or ran no page pass
  metered less than a page and proves nothing, so it is red (AGL-3040).
  Recordings are never committed; the first live one, which stopped at its plan, is
  kept by hand as `src/lib/jobs/fixtures/ai-free-page-recording.ts` for the specs to
  hold that check and the plan rules to.
- **Every device width, and an axe audit.** `tools/scripts/record-ai-page-axe.mts`
  (AGL-3020) assembles each golden page the page step builds from a site — the ten
  briefs, both Free pages and the two-person page — through the step's own section
  check, grafts a stand-in definition for each inventory component from its declared
  props, and renders it with the real MUI and Forms bundles and the node renderer
  inside the layout's one `main` at each device of the besigner's switcher: XS 390,
  SM 600, MD 900, LG 1200 and XL 1536, the widths `devicePreviewWidth`
  (`@aglyn/besigner`) gives each device on the site theme's breakpoints. The theme is
  the one the canvas builds (`createAglynSiteTheme`, from the golden inventory's
  colors and fonts), pinned to each width by `createDevicePinnedTheme` with every
  element's sx pinned by `resolveSxForDeviceWidth`, exactly as the canvas pins its
  artboard. Each render is loaded into a headless Chrome whose viewport is that
  width (found as the e2e tools find it, `E2E_CHROME_PATH` first), which measures
  what runs past the screen, the columns on the first line of every row a layout
  element of the palette draws, and axe-core 4.12.1 with every rule on,
  `color-contrast` included, since a browser paints the colors the theme gives. It
  writes what it measured to `fixtures/ai-page-axe.generated.json`, with a
  fingerprint of the goldens it rendered. `ai-job-page-widths.spec.ts` holds every
  page to the device audit's rule (`runtime/ai-device-audit.ts`): nothing past a
  screen, and no band — a row of two or more columns of content at LG, where a
  column drawn by a button, a link or an icon is a control rather than content —
  with as many columns at XS as at LG. It also holds every Grid container and band
  the goldens draw to one column at XS and more than one at MD and LG, and every
  page to zero serious or critical axe violations at every width, and it fails when
  a fingerprint no longer matches the goldens or a recorded width is not the one the
  switcher previews its device at — re-record with
  `node tools/scripts/record-ai-page-axe.mts`. Today no golden page runs past a
  screen, every golden row is one column at XS and two to four at MD, LG and XL, and
  no page has an axe violation of any impact. A recording, not a run: the spec
  starts no browser, and no network or hosted audit service is involved anywhere.

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
`review` when the doctrine gave up or the site had no room for the draft. It
must not write the job document, take a reservation, or publish anything.
Registering a runner for a planned kind is what turns on its plan step; a
generation runner reads the confirmed plan from `job.plan`. A kind that cannot
finish for some requests — no site, inputs it cannot read, no room for its
draft — also registers `registerAiJobAdmission(kind, check)`, which both doors
ask before anything is spent. Kinds with more than one step extend
`aiJobStepNames`. A runner that loads heavy modules registers a lazy wrapper,
as `theme` does, so the machine stays light to load.

**Register by a call, never by an import.** A kind's registrations — its
runner, its admission, its pass bound — go in one exported function in the
kind's own module (`registerAiPageJob`), and `registerAiJobKinds` in
`server.ts` calls it for the console surface, the only one that loads the
plugin's server entry. Never register at a module's top level
and import the module for that: the plugin's `package.json` declares only
`server.ts` effect-ful, so Turbopack deletes such an import in a built app while
jest still runs it. That is how every generative kind answered "not available
yet" in a built console with every project green (AGL-3025).
`registrations-survive-a-bundler.spec.ts` bundles the plugin with webpack
against that `package.json`, runs the bundle, and fails when a registration
does not survive it or when a `jobs/ai-job-*-step.ts` module's kind ends up
with no runner.

Two settings shape when a runner gets to run:

- `registerAiJobStep(kind, runner, { minimumMs })` says the least time one run
  of the step needs — its generation's worst case at the rates
  `ai-job-budget.ts` assumes, every model call it may make, plus its own reads
  and writes. Neither the beat nor an inline door starts it with less. Every
  generation step declares one: build it with `aiJobStepBudget` from the
  routing table's ceiling rather than by hand, ask each model for the ceiling
  that budget gives it, and add the step's row to
  [Every step's least time](#every-steps-least-time) —
  `ai-job-step-minimums.spec.ts` fails on a registered step with no least time,
  and on a table that disagrees with the code. A step whose runs differ adds
  `minimumMsFor(job)`.
- A runner returning `continue: true` asks for another pass on the same step
  (`AI_JOB_STEP_MAX_PASSES`), which is how a kind too large for one answer —
  a page, a section to a pass — stays inside its budget. Each pass records its
  own usage and cost, so the job's credits are the sum of what it really sent.
  A step that returns `review` waits on a person instead and never continues.

## Assist edits in the Besigner

Not a job, and deliberately so (AGL-2906): the chat door's edit rung proposes
changes to the canvas a person has open, and that person applies them in
their own editor. It keeps the jobs' rule that nothing generated is ever
published, and goes one step further — the server writes no document at all.

- **The rung.** `/api/assist/chat` opens it when the request carries a canvas
  outline from a versioned besigner route (screen, component or layout), the
  org has `aiGenerative`, `release_ai_generative` is on, the caller holds
  `ai.generate` and the `ai-generate` switch is unlocked — `assistEditRung` in
  `src/lib/server/assist-chat.ts`. Below it the request is answered as if no
  canvas had been sent, and the outline is never parsed. On it, a question
  that does not stand on its own is not answered from the docs, and no answer
  is cached.
- **The proposal.** The model is offered one strict tool,
  `propose_canvas_edit` (`src/lib/server/assist-edit.ts`), whose ops are
  `insertSubtree`, `updateProps`, `updateSx`, `move`, `remove`, `rename` and,
  on a screen, `setSeo` — its field list is `SCREEN_SEO_TEXT_FIELDS`, the one
  the Screen Properties form saves. The edit protocol and the doctrine's
  palette catalog for the document's surface (`aiDoctrineCatalog`) ride one
  cached block per document kind; the outline rides a volatile one. The reply
  streams, so the tool call is held to the doctrine as a streamed answer
  (`validateStreamedGeneration('edit', …)`): rule 13, and the edit's own
  check (`checkAssistEditAnswer`), which holds it to the elements the outline
  described and to the palette validators (`validateAiNodeTree`,
  `validateAiNodePatch`). It reaches the panel on `done` as `edit`
  (`src/lib/model/assist-edit.ts`).
- **The apply.** The card (`src/lib/components/assist-edit-card.component.tsx`)
  applies nothing until the author presses Apply. `applyAssistEdit`
  (`src/lib/components/assist-edit-canvas.ts`) re-checks every element against
  the live canvas, then runs the ops through the canvas's own mutators inside
  one `CanvasManager.batch` — one undo step, all or nothing — spreading the
  props an element already has. A version the live site serves is refused, and
  the card offers the editor's own new-version flow instead. The editor is
  reached through the core editor-session seam
  (`libs/aglyn/src/lib/plugin-manager/editor-sessions.ts`), which the screen,
  component and layout besigner pages register with `useEditorSession`.
- **The record.** After an apply the panel posts the op counts to
  `POST /api/assist/edit-applied` (`src/lib/server/assist-edit-applied.ts`). It
  writes one `ai.edit.applied` row to the site's activity log once it has
  found the proposal on an exchange the same member had about the same
  document — the signal's `editOps` count — and a second report for one
  exchange writes nothing.

## The copy assistant's own doors

`POST /api/ai/assist` is not a job — it serves the besigner's copy assistant
in three modes — but it shares the runtime, the meters and the rules above.

- **The prompts** are `src/lib/server/ai-assist-prompts.ts`, a pure module a
  spec can read without a Firestore, an ID token or a provider.
  `assistModeSystemBlocks(mode)` puts the acceptable-use rules ahead of the
  mode's own prompt, as one block with a breakpoint. None of the three modes
  reaches its model's minimum today; the ledger spec records that, so the
  marker is a statement about the block rather than a claimed saving.
- **A section answers through a strict tool** (`submit_section`,
  AGL-2937), not as parsed prose. It takes a FLAT list of nodes, each naming
  its id, component, parent and children, because a strict schema forbids
  additional properties and so cannot describe a map keyed by node id;
  `readAssistSection` rebuilds the `{ rootId, nodes }` map the besigner
  consumer reads and runs it through the same marketplace sanitizer an install
  passes. Values arrive as name/value pairs and are typed from the component's
  own props schema, with `children` always left as text. The bare-JSON parse
  stays behind the tool for a provider whose adapter has none.
- **`POST /api/assist/chat` keeps its last turns whole.** The last
  `HISTORY_VERBATIM_TURNS` share a 4,000-character budget spent newest-first;
  the turns behind them become one labelled digest under 1,200 characters of
  its own, built from each turn's opening with no second model call
  (`assistHistoryDigest`). The digest leads the conversation as a user turn,
  so the thread still opens user-side. `messages` never caches, so this is the
  route's uncached spend: about 5,200 characters at worst rather than 8,000.

## The workflow kind

`workflow` (AGL-2919) drafts an automation from a description, explains a saved
automation, or explains why one of its runs failed. It is one unplanned kind
with three modes, named by `inputs.mode`: `draft` (the default), `explain` and
`diagnose`. An explanation names its automation by `inputs.targetType`
(`action` or `workflow`) and `inputs.targetId`, and a run's explanation adds
`inputs.runId`, the run's entry in the site's activity log.

- **Code.** The runner, its budget, its instructions and its admission are
  `src/lib/jobs/ai-job-workflow-step.ts`, registered by `registerAiWorkflowJob`
  from `server.ts`; its reads are `ai-workflow-records.ts`. The modes, the
  vocabulary and what a person reads are `src/lib/model/ai-workflow-job.ts`;
  the two strict tools and their readers are `src/lib/tools/ai-workflow-tool.ts`;
  an answer is made into the stored automation by
  `src/lib/model/ai-automation-draft.ts`, and a saved automation and a run are
  outlined for an explanation by `src/lib/model/ai-automation-outline.ts`.
- **The vocabulary is the platform's.** A draft may start on any host event —
  the on-page events, which watch one element of one page, are left out — and
  take the server and flow steps: email, notify, enroll in a list, assign to a
  campaign, run a workflow, write to a dataset, post a webhook, show a site
  alert, wait, wait for an event, end the flow, and the five CRM steps. The
  cached instructions list them from `HOST_EVENT_TYPES`,
  `HOST_EVENT_PAYLOAD_KEYS` and `HOST_ACTION_STEP_LABELS`, so what the model is
  shown is what its answer is held to. A trigger or step that needs the CRM,
  webhooks or bookings is refused, with a re-ask, on a workspace whose plan
  lacks it — the entitlements the executor reads before it runs one.
- **What the model is shown to draft.** The doctrine's cached block, the
  drafting instructions (cached) and `submit_automation`, a strict tool whose
  every field a step does not use is `null`. The user turn carries whether the
  workspace has the CRM, webhooks and bookings, the site's forms with their
  field names, its datasets by name, and the brief. It carries no email list,
  campaign, workflow, webhook, pipeline, contact or form submission.
- **Words, then ids.** The answer names each list, campaign, workflow, webhook,
  dataset, form and deal stage in the description's words. After the answer,
  in code, each is looked up among the site's records — the Actions editor's
  picker windows, and the pipelines the site may see — and becomes that
  record's id when the words name exactly one. Words that name none, or more
  than one, are kept as a placeholder: the words in square brackets where the
  record belongs.
- **Placeholders** are the core's convention
  (`libs/aglyn/src/lib/app-utils/automation-placeholders.ts`): a value somebody
  still has to supply, in square brackets, read only in the fields a person
  types into. A bracketed list name matches no list, and a bracketed condition
  value matches no event, so a placeholder can never act on the wrong record.
  An email the description leaves a fact out of carries one too. The Actions
  list counts them on a row, the editor highlights each field and picker
  holding one, and switching such an automation on asks first, naming them.
  The draft's output note lists them.
- **The draft is written OFF, by its owner.** The workflows plugin registers
  the `automation` writer on the resource-drafts seam
  (`libs/plugins/workflows/src/lib/server-automation-drafts.ts`): the stored
  shape the editor saves, each step's own fields, `validateHostAction`, the
  site role, the `actions` entitlement and the live-action cap, inside one
  transaction. The write is keyed by the job's id, so a step run again reports
  its draft and spends nothing, and a refusal at the cap stops the job
  `needs_review` with `reason: 'limit'`.
- **What an explanation is shown.** An outline, never the stored document:
  what starts the automation, its conditions, and each step by the label the
  editor gives it, with whether each list, campaign, workflow, webhook or
  dataset it names still exists on the site, looked up in code. Every email
  address becomes `[email address]` and a teammate is "a named teammate"; an
  on-page step's selector, HTML or script is not shown. A run's explanation
  adds when the run happened, on what, what it did and the errors the run
  history recorded — never the event's payload, which holds what a visitor
  submitted. The answer arrives through `submit_explanation` (a summary, the
  points in order, what to check or change) and becomes a `text` output. It
  changes nothing.
- **Admission.** Every mode needs a site of the job's own org with the
  Automation plugin on for it and past its release flag. A draft also needs
  the writer registered and the owner's `refusal` for the member; an
  explanation needs the automation to exist, and a run's explanation a FAILED
  run of that automation.
- **Where a member starts one.** Three widgets the AI plugin registers in the
  zones the workflows plugin hosts on the Automation page
  (`src/lib/components/ai-describe-automation.component.tsx` and
  `ai-explain-automation.component.tsx`): Describe it beside Add action and
  Recipes (`hostAutomations`), whose dialog follows the job and opens the draft
  in the Actions editor; Explain it at the top of the editor of a saved action
  or workflow (`automationEditor`); and Why did this fail? on each failed run
  in a run history (`automationRun`). Each is gated by `aiGenerative` and
  `ai.generate`, asks the jobs route once per member and workspace before it
  shows anything (`use-ai-job-run.ts`), and sits in a site zone, so a site
  that switched AI off draws none. An explanation's question is a fixed
  sentence naming the automation. In AI jobs, a drafted automation opens the
  Automation page's Actions, where it is listed switched off.
- **Spend.** Each step is metered like any other. Running the drafted
  automation, once a member switches it on, counts against the site's action
  runs and never against AI credits.
- **Routing and time.** `job.workflow` runs on the balanced tier with adaptive
  thinking and a 4,000-token ceiling: the largest answer `submit_automation`
  accepts, `AI_AUTOMATION_ANSWER_MAX_CHARS` (6,000 characters written out), at
  three characters a token with as much again to think in. A longer answer is
  refused and re-asked shorter. It sends no site inventory block and so makes
  no lookup; its reads are the declared 4 s,
  `AI_WORKFLOW_RECORDS_READ_MS`. Its cached prefixes are 4,564 tokens drafting
  and 2,212 explaining, as the ledger spec measures them.

| step | tier served | lookup rounds | ceiling asked: fast / balanced / deep | least time on the served tier |
| --- | --- | --- | --- | --- |
| `workflow` | balanced | 0 | 4,000 / 4,000 / 2,666 | 2 × 3 s + 2 × 66,667 ms + 3 s + 4 s = 146,334 ms |

- **Evals.** `tools/ai-eval/cases/workflow` holds a drafted automation — the
  description from the issue, with a placeholder where the welcome email lacks
  a phone number — and an explanation, each with controls that fail: a trigger
  that is not a host event, a step the plan lacks, a request to switch the
  automation on, eleven steps, an explanation with no summary, and one that
  names an address.
- **The published disclosure.** Drafting sends the brief and the names and
  field names of the site's forms and datasets, which the published Anthropic
  row names for a generation job. Explaining sends an automation's settings
  and a run's recorded errors, which the Anthropic row and the Privacy Policy
  name since September 17, 2026 (legal v8, AGL-3069). Both doors stay behind
  `release_ai_generative`; `assist-anthropic-subprocessor-gate.spec.ts`
  records both.

## The insight kind

`insight` (AGL-2915) answers a question about a site's or a workspace's own figures, and makes
the weekly insights a member asked for. It is read-only: the model never runs a query and never
sees a record, and every insight a person reads is traced to the numbers it cites.

- **Readers, on a seam.** A figure is read by a READER registered on
  `libs/aglyn/src/lib/plugin-manager/plugin-figures.ts` by the plugin that owns its records: the
  commerce plugin's `commerce.sales` and `commerce.products` (`server/order-figures.ts`, on the
  Analytics tab card's own arithmetic in `model/order-figures.ts`), the bookings plugin's
  `bookings.services`, the marketing plugin's `marketing.campaigns` and `marketing.experiments`.
  This plugin registers the readers for records the platform keeps
  (`src/lib/insights/ai-figure-readers.ts`): `traffic.summary`, `traffic.pages`,
  `traffic.sources`, `traffic.daily`, `forms.performance`, `datasets.summary` and
  `datasets.breakdown`. A reader answers one compact table — counts, sums and rates with a
  `source` label and the console page they come from — held to the contract by
  `normalizePluginFigureTable`: at most 25 rows and 8 typed columns, every text cell stripped of
  email addresses and phone numbers. A dataset breakdown reads at most 2,000 records, refuses a
  field with more than 60 different values, and folds every group of fewer than three records
  into one row.
- **Who may read what.** `aiInsightReaders` (`src/lib/insights/ai-insight-readers.ts`) offers a
  reader only when the surface asks about its kind of figures, the plan includes the feature it is
  sold under (`commerceAnalytics`, `bookings`, `abTesting`, `dataStore`), and its plugin is past
  its release flag and on for the site. A dataset reader reads what the asking member may see, and
  on a site only what is shared with it.
- **Runner.** `src/lib/jobs/ai-job-insight-step.ts`. Two calls through `runAiRequest`, sharing one
  allowance of twice the routing ceiling: `read_figures` chooses among the offered readers (never
  a collection or a field path; an unreadable choice falls back to the digest's readers), then
  `submit_insights` answers over the tables. `checkAiInsightAnswer`
  (`src/lib/runtime/ai-insight-check.ts`) keeps each insight whose every number is in a row it
  cites, as the table has it or rounded to the decimals written, and leaves out the rest: a
  computed total, a rise the change does not show, an unknown table or row, a person named. An
  answer that is not a call, or keeps nothing, is asked for once more with the reasons. The system
  block is the insight rules and the acceptable-use block, under the balanced tier's cacheable
  minimum, so the ledger records it as not caching.
- **The answer is kept apart.** The step writes `orgs/{orgId}/aiInsights/{jobId}` under the job's
  own expiry, which no rule lets a client read, and the job's output names it with a count and no
  figure: a job document is readable by every member of the workspace, and a collaborator on one
  site may not see another's revenue. `GET /api/ai/insights/{jobId}` (`server/ai-insight-answer.ts`)
  serves it through the jobs read gate to the member who asked, or for a digest to any member who
  reaches its site, while they still reach it.
- **Admission.** An ask names a surface a person asks from (`analytics`, `datasets`,
  `crm-reports`), a site of the job's own org where the surface needs one, and at least one reader
  the workspace may read; a `digest` job is refused at the door.
- **The surface.** The Assist panel's AI jobs offer **Ask about your numbers** on a site's
  Analytics, Data and CRM Reports pages and the workspace's Data page
  (`components/ai-insight-dialog.component.tsx`): the question and a window, the answer with each
  insight's cited rows and a link to the page they come from, and the member's weekly-insights
  switch. A job row with an insight output offers **View answer**.
- **The weekly insights.** `POST /api/admin/ai-insights-digest`
  (`server/ai-insight-digest-route.ts`, `insights/ai-insight-digest.ts`), at 06:00 and 14:00 UTC
  through `consoleAiInsightsDigest` in `cloud/functions`. A member opts in per workspace
  (`users/{uid}.insightDigests.{orgId}`, turned off again in Notifications). Monday's first run
  checks `aiGenerative`, `release_ai_generative`, the workspace's AI pause and each site's AI
  switch again, then makes one `digest` job per site for up to five of the busiest sites the
  subscribers reach, created by the first of them who holds `ai.generate` there. The jobs run on
  the beat and are metered like any job. Every run delivers what is written — a
  `content.insightsDigest` notification and a platform email to each subscriber who reaches the
  site, stamped per person until the site settles — and skips, without a message, a job that
  failed or kept nothing, canceling one parked for credits.

| step | tier served | lookup rounds | ceiling asked: fast / balanced / deep | least time on the served tier |
| --- | --- | --- | --- | --- |
| `insight` | balanced | 1 | 1,500 / 1,500 / 1,000 | 3 × 3 s + 2 × 25,000 ms + 3 s + 8 s = 70,000 ms |

The lookup round is the read call, spent from the same allowance as the answer; the 8 s is
`AI_INSIGHT_READS_MS`, the declared assumption for the readers between the two calls.

## The `products` kind

Commerce by AI (AGL-2916): a `products` job writes product copy and proposes
a store's first products, its categories and a first set of discounts. The
step is `src/lib/jobs/ai-job-products-step.ts`; what it is asked and what it
proposes is `src/lib/model/ai-products.ts`, one shape the step, the console
cards and the eval harness read.

- **Four targets.** `inputs.target` is `product` (one product's copy, from
  what its editor holds, saved or not), `bulk` (the copy of up to 50 saved
  products, one product a pass), `catalog` (six to twelve proposed products
  from the brief) or `categories` (categories and up to five discounts from
  the brief). The create door's admission refuses a site of another org, a
  plan without Commerce and a site where Commerce is off, before anything is
  reserved.
- **It writes nothing.** Every output is a `product` proposal. The commerce
  plugin's own surfaces write what a person accepts: the product editor's
  Save, the products card's apply, and the create paths the catalog and
  discount cards already use. A proposed product is created as a draft with
  its price left empty, and a proposed discount is created switched off.
- **What the model is shown.** The product's name, type, text, tags, options
  and current search listing, the names of the site's categories and the
  store's name; a catalog or categories request carries the brief, and the
  second the store's existing category names. No price, stock, order,
  customer or other product is read. For a model that reads pictures, the
  product's FIRST photo: read only as an asset of the site's own media library
  or its org's, the way the media CDN would serve it, and sent as a new JPEG
  at most 768 px on its longer edge at quality 80, which carries none of the
  original's metadata (`src/lib/jobs/ai-product-image.ts`). No other asset,
  file name or alt text is read, and nothing is fetched from a URL. The
  provider contract carries the picture as an image part of a user turn, and
  the runtime refuses one for a model whose catalog row does not say `vision`.
- **Held in code.** Each answer runs through its tool's check
  (`src/lib/tools/ai-products-tool.ts`) inside the doctrine loop's one re-ask:
  lengths and counts, a category the request did not list, markup, and the
  storefront rules in `src/lib/model/ai-storefront-claims.ts` — no health,
  financial or legal claim, no certification, award or endorsement the
  merchant's own words do not state, and no price the merchant did not give.
  A fact the copy cannot know is left in square brackets for a person, and
  the proposal lists those gaps.
- **A bulk job resumes.** A pass writes one product's copy and continues while
  products remain, so each product is its own reservation, exchange and meter
  row, and a job paused for credits resumes at the product it stopped at. The
  next product is read from the job's own outputs. A product that is gone, or
  whose copy the rules could not hold, is reported and passed over.
- **Routing and the ceiling.** `job.products` is served from the balanced
  tier with thinking off. Its routing ceiling, 8,000, is the largest catalog
  the tool accepts, and the balanced tier asks as much of it as a beat can
  start; one product's copy asks 1,500 and categories with discounts 2,000
  (`ai-job-products-step.spec.ts` measures all three). Each pass meters as
  the `products` kind.
- **Evals.** Golden briefs under `tools/ai-eval/cases/product`, `catalog` and
  `categories`, each with controls that must fail the check they name: copy
  with a health claim and an unstated certification, an invented price and an
  unlisted category, an overlong search title or no description; a catalog
  with a price the brief never gives, an overlong description or two products
  under one name; categories the store already has, a discount that takes
  nearly everything off, a reason that promises a financial result, or
  nothing proposed at all. The routing row's pass rate and mean score are
  recomputed from them.
- **Gates.** `release_ai_generative`, the `aiGenerative` entitlement, the
  `ai-generate` lockdown key, the member's `ai.generate` permission and the
  site's AI switch, as every generation job.

The step's least time is its copy pass, and a catalog or categories pass
asks for its own (`aiProductsRunMinimumMs`):

| step | tier served | lookup rounds | ceiling asked: fast / balanced / deep | least time on the served tier |
| -- | -- | -- | -- | -- |
| `products`, a product’s copy | balanced | 0 | 1,500 / 1,500 / 1,000 | 2 × 3 s + 2 × 25,000 ms + 3 s + 6 s = 65,000 ms |

## The `crm` kind

CRM by AI (AGL-2917): `src/lib/jobs/ai-job-crm-step.ts`, its strict tools and
answer checks in `src/lib/tools/ai-crm-tool.ts`, the request, reference and
answer shapes the step, the answer door and the console widgets share in
`src/lib/model/ai-crm.ts`, and the access check the admission and the door
share in `src/lib/jobs/ai-crm-access.ts`.
`inputs.task` names the question:

- `record` (`record`, `recordId`): a contact, company, deal or lead. A summary
  of at most two sentences, of when the record was last in touch and what is
  still open; for a contact, a company or a deal, the next step as a task (a
  title, a kind, a priority, the days until it is due and a reason), or none
  when an open task covers it; for a deal, an open stage the timeline shows it
  moved to; for a lead, why it stands where it does. The CRM keeps no lead
  score, and the step invents none.
- `email` (`record`, `recordId`, with the member's request as the brief): a
  subject and a plain-text message for the CRM composer, greeted and signed
  with the merge fields the record can fill, and never an address.
- `mapping` (`collection`, `columns`): which of a file's columns fill which
  fields of a contacts, companies, deals or leads import. `columns` is JSON:
  each header and the shape of its values (`email`, `phone`, `number`,
  `date`, `yes-no`, `url`, `text` or `empty`), read from the cells in the
  browser. No cell leaves the browser.

Every output is `resource: 'crm'`, and its `proposal` names only the question:
the record's kind and id, or the import's collection. The answer is kept apart
from the job, and the step writes no CRM record.

- **The CRM decides what is read.** The step never reads a CRM document. It
  asks the CRM's readers on the core's record-facts seam
  (`libs/aglyn/src/lib/plugin-manager/plugin-record-facts.ts`) for
  `crm.contact`, `crm.company`, `crm.deal`, `crm.lead` and `crm.import`, which
  the CRM's console API surface registers
  (`libs/plugins/crm/src/lib/server/record-facts.ts`). A reader applies the
  CRM's own rules to the job's creator: the site is the org's; the member is
  org-wide at the organization level, or reaches the site under it; the member
  holds `data.manage`; the plan carries the CRM; and the record, with every
  activity, task and deal hanging off it, is visible to the site. It reports
  the facts its builders list (`libs/plugins/crm/src/lib/model/record-facts.ts`),
  which never include an email address, a phone number, a postal address,
  consent, a custom field value, a team member or a record id. Text a person
  wrote into the record (a name, a job title, a tag, notes, a logged activity,
  a capture's summary, a task's or a deal's title, a reason) goes as written,
  except that an email address or a phone number inside it is replaced by a
  placeholder first (`crmFactProse`); a postal address typed into a note is
  not recognized. The step writes into a prompt only the facts it names,
  whatever else a reader reports.
- **Why a seam, and not a contract in either plugin.** The package map forbids
  the AI plugin to import the CRM and the CRM to import the AI plugin, and keeps
  CRM shapes out of the core. `plugin-resource-drafts` is the seam a plugin
  writes another plugin's resource through; `plugin-record-facts` is its
  reading twin, generic and keyed by resource name, with every rule the
  owner's.
- **Admission.** An in-process read skips the plugin API dispatcher's gates,
  so `aiCrmAdmissionRefusal` re-establishes them before the job exists, through
  `aiCrmAccessRefusal`: the inputs name a record or an import; a named site is
  the job's org's; the CRM
  is past `release_crm`, switched on where the job runs (the site, or the
  workspace at the organization level) and has registered its reader in this
  process; and the reader admits the member, in the CRM's own words. The step
  asks the reader again, as the creator, before it spends.
- **The answer is kept apart from the job.** Every member of a workspace may
  read its jobs, and not every member may read every record, so the answer is
  written to `orgs/{orgId}/aiCrmAnswers/{jobId}` (`AiCrmAnswerRecord`), which
  no rule lets a client read, with a 14-day `expiresAt` (the TTL policy is
  declared in `cloud/firebase-firestore.indexes.json`; enabling it is owed).
  `GET /api/ai/crm/{jobId}?orgId=` (`src/lib/server/ai-crm-answer.ts`) is the
  one way to it: it climbs `aiJobsGate`, serves a record's summary to any
  member, and an email draft or an import's matches only to the member who
  asked (or staff), and in every case asks `aiCrmAccessRefusal` again as the
  reader. Any refusal is a 404. A keep that fails fails the step as spent. A
  person erasure does not sweep the collection; the door stops serving an
  erased person's answer at once, and the two weeks bound the copy.
- **A summary is asked once per timeline.** A record answer's `key` hashes the
  record, the site, the model, the rules, the tool and the prompt, which is the
  facts. The step looks up kept answers with the same key (one equality, so no
  composite index) and reuses the newest on the same site at no cost, keeping
  it again under the new job with `reusedFrom`. An answer is reusable for as
  long as it is kept.
- **Where a member asks.** Three console widgets, each held by the shell to
  `aiGenerative` and `ai.generate` and by the jobs route's verdict, sharing
  `src/lib/components/use-ai-crm-answer.ts`:
  `ai-crm-record-card.component.tsx` in the CRM's `recordInsights` zone on a
  contact's, company's, deal's or lead's page; `ai-crm-email-draft.component.tsx`
  in `recordEmail`, in the one-to-one composer; and
  `ai-crm-import-mapping.component.tsx` in `importMapping`, in the four import
  drawers. A record card recalls the newest summary any member asked for on
  the same site; a draft and a matching are asked afresh. A brief names no
  record (`Summarize this contact`), except a draft's, which is the member's
  request. Each hands its proposal to the zone's own door — `proposeTask`,
  `proposeStage`, `proposeDraft`, `proposeMapping` — and none writes. The
  customer page is `apps/docs/docs/ai/crm-by-ai.md` (`aiCrm`).
- **Routing and time.** `job.crm` runs on the fast tier with no thinking and a
  700-token ceiling: sixty columns matched to fields by number, or an email
  draft at its limits, at three characters a token with room. It sends no site
  inventory and so makes no lookup; its own round trips — the facts read, a
  record's reuse lookup and the answer's write — are the declared 1.5 s,
  `AI_CRM_FACTS_READS_MS`. Its worst case fits the 25 s inline budget, so the
  create door answers with the proposal. Its three generation kinds are
  scoped to the doctrine's field rules (`AI_DOCTRINE_KIND_SCOPE`), which send
  rule 13 and the acceptable-use block rather than the building rules; the
  prompts come to 650 to 913 tokens, under the fast tier's minimum, and the
  ledger records them as not caching.

| step | tier served | lookup rounds | ceiling asked: fast / balanced / deep | least time on the served tier |
| --- | --- | --- | --- | --- |
| `crm` | fast | 0 | 700 / 420 / 280 | 2 × 3 s + 2 × 7,000 ms + 3 s + 1.5 s = 24,500 ms |

- **Evals.** `tools/ai-eval/cases/crm` holds a contact's summary and next step,
  a deal's stage after a call, a lead's standing, a follow-up email and a
  contacts import, with controls that fail: a summary past its length, a next
  step due in 90 days, a deal marked won, a next step an open task covers, a
  stage the pipeline lacks, filler, a merge field no contact fills, a phone
  number, a long subject, an email column matched to a name, one field matched
  twice and a column the file lacks.
- **The published disclosure.** A CRM record's facts, a member's email request
  and an import's headers are named by the Anthropic row and the Privacy Policy
  since September 17, 2026 (legal v8, AGL-3069). The doors stay behind
  `release_ai_generative`. `assist-anthropic-subprocessor-gate.spec.ts`
  records the flow.
