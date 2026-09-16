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
`src/lib/jobs/ai-job-layout-step.ts`, `ai-job-template-step.ts` and
`ai-job-component-step.ts` (the generation steps, below),
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
| `kind` | `AiJobKind` — what the job produces. `text`, `theme`, `layout`, `template`, `form` and `component` have runners; every other kind fails fast with "not available yet" until its own issue lands. |
| `status` | `queued` → `running` → `done` / `failed` / `canceled`, with `needs_input` and `needs_review` as the two parked states (below). |
| `brief`, `inputs` | The customer's brief verbatim and the kind-specific scalars a runner reads. |
| `steps[]` | The step plan: `name`, `status`, `startedAt`/`endedAt`, `creditsSpent`, `attempts`, a customer-safe `error`. |
| `outputs[]` | What the job wrote, addressed by `resource` + `id` (+ `versionId`, `hostId`, `hostSubdomain`) so the console can build an "open draft" link without knowing what the runner did. A console URL names a site by its subdomain, so a link is built from `hostSubdomain` and an output without one gets none. A page's document carries its estimated first-visit `load`. An output may carry a customer-safe `note`: what the person decides next about it. |
| `plan` | The plan a planned kind builds from: `reuse`, `create`, `screens`, the inventory `labels` it references, and `status` `proposed` → `confirmed` with who confirmed it and when. |
| `review` | While the job is `needs_review`: the `reason` (`plan`, `doctrine` or `limit`), the customer-safe `message`, and the rules the last answer broke. |
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
A step that stops for a person before the provider, such as one whose site has
no room for its draft, hands its message back the same way.

A step runner writes drafts and returns. It does not touch the job document,
the meter or the lease.

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
- **On the org month.** `assistUsage/{month}.kinds.{kind}` holds `requests`,
  `estCostUsd` and `tokens.{input,cached,cacheWrite,output}` for every metered
  model request, keyed by its `AiUsageKind` — a job step by its job's kind.
  A docs answer is not a request. `estCostUsd` there is the measured provider
  spend, a declined Free turn included, where the month's top-level
  `estCostUsd` is the credited spend; the month's `inputTokens` …
  `cacheWriteTokens` stay its totals.
- **On the person's month.** `aiUsageByUser/{uid}/months/{month}.tokens`, the
  same four counts beside `estCostUsd`, written on the org rollup's batch.
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

## The eval harness

A token lever ships only when the eval holds (AGL-2937): each output kind has
golden briefs, and every answer to them is scored the way the doctrine holds a
live answer.

- **Where the cases live.** `tools/ai-eval/cases/<kind>/<id>.json`, one file
  per golden brief, filed under its kind: `page`, `template`, `component`,
  `layout`, `form`, `email`, `section` (a section rewrite), `seo`, `theme`,
  `element`, `blog`, `text` and `chat`. A generator adds its briefs there.
- **What a case holds.** The brief and its framing; the site `inventory` it is
  built for, in the shape `readSiteInventory` returns, and the media `assets`
  its images are measured against; for a planned kind, the plan shape a good
  answer has (`expected.plan`: how many screens, what it must reuse, its
  layout, what it may create); `candidates`, each an answer with its plan, its
  rubric grade, and whether it was `authored` by hand or `recorded` from a
  live run; and `controls`, answers that must fail, each naming the checks it
  fails.
- **The checks** (`src/lib/runtime/ai-eval.ts`). *Readable*: the tree
  validator admits it, or the copy, the fields or the theme call are there.
  *Rules*: no doctrine rule is broken, nor the kind's own (a link the chat
  answer was not given, a title line on a blog body). *Budget*: rule 17 for a
  document, the length ceiling for copy. *Plan*: the plan rules and the
  expected shape. *Rubric*: a grade from 1 to 5 for structure, copy fit and
  reuse, passing at a mean of 3.5 with nothing under 3. An answer's score is
  those checks and the rubric averaged, from 0 to 1.
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
  request. A planned kind records its plan alone until its generator lands
  (a `plan`-scope answer, counted toward the plan step rather than the kind's
  floor); a kind whose door is a request route (the copy assistant's modes,
  the chat door) has no recorder yet, and a door that gains one registers it
  with `registerAiEvalRecorder`.

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
  tool, no extended thinking and an 8,000-token answer ceiling, so the step
  and its one re-ask fit the beat's budget for one step. The door's checks
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
  each brought up to rules 3, 5 and 11 the same way, shown only when the
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
  extended thinking and the doctrine's answer ceiling for a form, through
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
  cannot collect, such as a photo upload.
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
  `ctx.modelFor?.('job.component')` with no extended thinking and an
  8,000-token answer ceiling, as the layout step does. The model answers
  through `submit_component` (`src/lib/tools/ai-component-tool.ts`): the
  doctrine's tree, and `props[]` beside it.
- **The kinds are the Properties dialog's.** The tool offers
  `REUSABLE_PROP_KINDS` less the kinds `AI_COMPONENT_PROP_KINDS_NOT_OFFERED`
  names, each with its reason, which leaves Text, Long text, Image, Link,
  Number, Yes / no and Choice. A spec holds the two tables in both directions,
  and a kind added to the dialog does not compile until it is offered or
  excused. `readAiComponentProps` stores each property as the dialog's cleaner
  does: trimmed, a default in its kind's own type, only the fields the kind
  uses.
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
  a Link only as an address. A Choice's answers must be values the dropdown
  lists (`unofferedChoiceValues`, in core so the designer and the check read
  one rule).
- **The step's check,** through `extend`: every token names a declared
  property and every declared property is bound; each sits on a field its
  kind fits; an optional part is hidden by a Yes / no labeled `Hide …` whose
  default is false, bound to `hideIf` on that part and never on the whole
  component; a default fits the field it fills and reads in the site's voice
  (rule 14); an Image default is empty or a library picture (rule 9); the
  confirmed plan's reused components are placed and the properties it lists
  are declared (rule 7). A property handed on to a placed component fits the
  kind that component declares.
- **Drafts.** `writeAiDraft` writes the component as the host resources
  route's `reusableComponent` entry does: that entry's allow-list
  (`displayName`, `description`, `rootId`, `nodes`, `props`), msgpack nodes
  and the route's stamps, admitted by the plan's `reusableComponents` feature
  with the route's own refusal, and counted against no allowance. No version
  is written: the component's page mints the first when a member opens it,
  as it does for a component Use template creates. Nothing places the
  component until a member does.
- **Output.** `{ resource: 'reusableComponent', id, versionId: null, hostId,
  hostSubdomain, label, load }`, which the drawer links to the component's
  page. A plan that starts from a copy gets the copy through
  `duplicateResource('component', …)` and generates nothing.
- **Fit.** The step's spec measures the cached prefix and the golden answer
  (`src/lib/jobs/goldens/`), holds `AI_STEP_NOMINAL_USAGE['job.component']`
  within a quarter of both, and holds an answer and its one re-ask inside the
  beat's 45 s at the serving rate it states.

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
  so the two entry points cannot disagree.
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
