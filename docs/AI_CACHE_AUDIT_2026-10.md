# AI prompt cache audit, October 2026 (AGL-3809)

Round three of the cost work in AGL-3781: where Aglyn's AI requests still pay
for cache writes nobody reads, or re-send input the cache could have served.
Done offline. No model was called; every figure below comes from recorded
usage or from building requests in a spec.

**Short answer.** The cached prefixes are byte-stable and the hit rate inside
a development run is 73–77%. What is left is structural, not a bug. Each
route writes its own prefix once per job, a generation's continuations re-send
their first turn uncached, and production traffic is too sparse for one job to
read another's entry. At October's volume every cache lever is worth cents a
week in production, because output is over half of a paid job's cost and
development evals are most of the bill. One free win is implemented: a plan
caches its own conversation. The rest are proposals for the owner below.

## Method

- **Development replay stores** (`.cache/ai-replay/`, `runtime/ai-dev-replay.ts`).
  A recording keeps `model`, `recordedAt` and the result: its tool call and its
  `usage` (`inputTokens`, `cacheReadTokens`, `cacheWriteTokens`,
  `outputTokens`). It does **not** keep the request, so request bytes were
  rebuilt from the door code in specs rather than read from disk. The tool a
  result answered through names its route. Two stores were read: the golden
  A/B sweep for AGL-3781 (292 requests, October 14) and the site-plan eval on
  Free / Claude Haiku 5.5, batched (24 requests). Both ran on the hour-long
  development cache.
- **Production, read-only.** Every org's `assistUsage/2026-10` (October 1–14,
  per kind) and every `aiJobs` document created since October 1 that still
  exists: 48 jobs, `steps[].tokens`. A job past its `expiresAt` is gone, so the
  month aggregate is the complete figure and the job sample is the per-step
  shape. The guided start `orgs/jWmGooWE3L/aiJobs/eg4maZMGtN` (five-page
  Spanish restaurant, beta.253) is the reference paid job.
- **Byte checks.** The cache ledger (`runtime/ai-prompt-cache.spec.ts`)
  already builds every door's request and holds its cached span to one value
  across briefs and sites. This round reads each door's real call site for
  what the ledger cannot see: per-request values in instructions, tool lists
  that vary, model, thinking or effort that vary inside a job, fan-out, and
  how a continuation rebuilds its request.
- **Prices** are the provider's list in `providers/catalog.ts`. Claude Sonnet 5.5
  is $2 in, $10 out, $0.10 a cache read (0.05×) and $2.50 a five-minute write
  (1.25×). Claude Haiku 5.5 is a twentieth of that, except its read is 0.1×.
  Opus 5 is $5 in and $25 out. An hour-long write is 2× ($4 on Sonnet 5.5).
  Until AGL-3830 the meter priced every write at 1.25×, so a development
  run's ledger read its hour-long writes low by 0.75× input; it now adds the
  difference (`aiCacheWriteHourSurchargeUsd`).

## Per route

### Development (golden sweep, eval-3781 store; 1h cache)

| route (tool) | model | requests | avg cached prefix | avg uncached | read / write / uncached tokens | hit rate |
| -- | -- | --: | --: | --: | -- | --: |
| page, layout language (`submit_page`) | Sonnet 5.5 | 80 | 2,750 | 736 | 217k / 2.8k / 59k | 77.9% |
| plan (`submit_build_plan`) | Sonnet 5.5 | 42 | 4,267 / 4,781 | 881 | 187k / 4.3k / 37k | 81.9% |
| plan lookup round (`look_up_site_inventory`) | Sonnet 5.5 | 27 | 4,267 / 4,781 | 861 | 110k / 13k / 23k | 75.0% |
| section (`submit_section`) | Sonnet 5.5 | 29 | 6,931 | 842 | 187k / 14k / 24k | 83.0% |
| frame, header and footer (`submit_frame`) | Sonnet 5.5 | 28 | 3,349 | 582 | 90k / 3.3k / 16k | 82.2% |
| grader (`grade_output`) | Opus 5 | 34 | 2,836 | 1,506 | 88k / 8.5k / 51k | 59.6% |
| site plan, Free (`submit_build_plan`) | Haiku 5.5 | 16 + 22 | 4,450 | 1,279–1,345 | 165k / 4.5k / 50k | 72.8–76.8% |
| site look (`submit_site_look`) | Haiku 5.5 | 13 | 2,047 | 593 | 25k / 2.0k / 7.7k | 71.6% |
| search listing (`propose_search_listing`) | Haiku 5.5 | 5 | 1,105 | 709 | 4.4k / 1.1k / 3.5k | 48.7% |
| theme, catalog, categories, product copy, automation, explanation | Sonnet 5.5 | 2–4 each | 3,066–7,480 | 155–841 | 6.7k / 52k / 5.4k | 0–43% |

All 292: 990k read, 106k written, 251k uncached, 242k output. That is a 73.5%
hit rate. At list, with hour-long writes and before the batch discount, it is
$3.84: output $2.68 (70%), uncached input $0.59 (15%), writes $0.45 (12%) and
reads $0.13 (3%). The recorded figure, after the discount, is $2.54. The site-plan eval: 107k read, 0 written, 32k
uncached, a 77.1% hit rate.

### Production (October 1–14)

| kind | requests | uncached | read | written | output | hit rate | provider $ |
| -- | --: | --: | --: | --: | --: | --: | --: |
| site | 574 | 1,577,869 | 815,755 | 758,139 | 548,300 | 25.9% | 9.35 |
| page | 35 | 100,661 | 202,851 | 78,430 | 47,449 | 53.1% | 0.88 |
| build | 21 | 71,771 | 44,448 | 70,292 | 41,838 | 23.8% | 0.74 |
| assist (console chat) | 19 | 80,828 | 6,027 | 83,979 | 13,636 | 3.5% | 0.51 |
| template, insight, image, seo, crm | 9 | 21,599 | 20,035 | 20,227 | 9,624 | — | 0.25 |

The total is $11.72 for two weeks, $5.86 a week. One workspace,
`jWmGooWE3L`, is $6.27 of it: guided-start testing on production.

Priced at Sonnet 5.5, the site kind's spend splits into output 52%, uncached
input 30%, cache writes 18% and cache reads 1%. Production writes almost as
much as it reads (1.08 read tokens per written token on `site`), where a development
run reads nine.

The reference paid job, `eg4maZMGtN`, cost $0.259:

| step | calls | uncached | read | written | output |
| -- | --: | --: | --: | --: | --: |
| plan (Sonnet 5.5, effort medium) | 3 (one write, two reads of 4,967) | 7,675 | 9,934 | 4,967 | 4,457 |
| generate (14 passes: look, header and footer, pages, listings) | about 14 | 25,013 | 17,630 | 18,299 | 11,962 |

## Findings

### 1. A continuation re-sends its whole first turn uncached — fixed for the plan

`runValidatedGeneration` continues a turn rather than rebuilding it. A lookup
round appends the answer and asks again, and a re-ask appends the violations.
Tools and system blocks are byte-identical across the calls; the loop's spec
already holds that. But breakpoints sat only on system blocks. Each
continuation therefore paid full input for messages[0] (the brief, the
plan's inputs) and for the site's inventory, which rides as the last system
block, volatile.

- Evidence. The reference job's plan made three calls with 7,675 uncached
  tokens, about 2,560 a call. In the golden store, Sonnet 5.5 plans made 27
  lookup rounds to 42 answers. In production, about half of all Sonnet plan
  steps make two or three calls: read equals one or two times the write.
- Pages, frames and sections almost never continue: 0 lookups in 137
  requests, and their uncached input clusters within ±5% of the first call's.
  On those routes a conversation marker would be a pure surcharge.
- **Change.** `cacheConversation` on the request contract
  (`providers/contract.ts`). The Anthropic adapter sends every turn as content
  blocks and marks the last block of the last turn (`buildAnthropicRequestBody`).
  It was sent at the lifetime the system markers use; since AGL-4050 it keeps
  five minutes, because only its own job reads it. The runtime counts that marker
  against the four allowed (`aiConversationCacheFits`), and
  `runValidatedGeneration` drops it where the system blocks hold all four. The
  plan step turns it on. A replay key does not read the flag, so recorded
  answers still replay.
- Arithmetic, on Sonnet 5.5. A single-call plan pays 0.25× its tail more, and
  a two-call plan saves 0.35× of its uncached input. On October's 19 Sonnet
  plan generations still on record that nets −13.8k token-equivalents, 21% of the plan's uncached
  input. The reference job's plan saves 0.55 × 7,675 tokens, $0.0084, which is
  3.2% of the job.
- Held by `runtime/ai-prompt-cache.spec.ts`, section *a generation that
  continues reads its own conversation*. The spec checks that each call's
  marked bytes are the exact prefix of the next call's, that the four markers
  are not exceeded, that the conversation marker is dropped first, and that
  only doors on the measured list turn it on. `providers/anthropic-request-body.spec.ts`
  holds the wire shape.

### 2. Each route writes its own prefix once per job; most of those writes are never read

Tools render ahead of the system blocks, and every route has its own tool, so
two routes in one job share no cached byte, even where the doctrine block is
the same. A paid guided start writes the look, the header and footer, the
page, the listing and the welcome email once each. Only the page and the
listing are asked again inside the job. In the reference job, an estimated 12k of
the 18.3k written tokens sat on routes that ran once and were never read.

- No door was found with a per-request byte inside its cached span. The ledger
  holds that across briefs and sites for every door, and each call site passes
  constant instructions or ones keyed on shape alone: the listing fields, the
  CRM record type, the edit target's kind.
- The `seo-fields` instructions vary by shape (other titles, keywords, image).
  Inside a guided start every page has the same shape, because the starter
  home is always there to list, so there is no split within a job.
- The plan tool varies with the brief, through the video players offered when a
  brief asks for video. That splits the plan prefix between jobs, not within
  one.

### 3. Production has no fan-out; development batches do

No production door sends model calls side by side: every `Promise.all` in
`jobs/` is a Firestore read, and the beat runs one unit a pass. A development
run sends the first request over a prefix alone (`aiDevWarmPrefixFirst`), but
batch mode bypasses that rule. Entries on one cold prefix in the same Message
Batch all write. The golden store shows three Opus 5 grades writing 2,836
each at once, two sections writing 6,931 each, and two plan lookups writing
4,267 each. That is 16.9k duplicate hour-long writes in one sweep, about $0.05
at batch prices. The fix is in the levers below. No recording carries per-request
latency (only `recordedAt`), so the latency cost is taken from production
steps: about 9 s a generate pass and 30 s a plan.

### 4. No marked prefix is under its model's minimum where it matters

The ledger already flags `text` (128 tokens), `copy.element` (339) and
`copy.blog` (340) as under the 512-token minimum. Their markers write nothing,
so they cost nothing. Every other door clears 512 on Sonnet 5.5 and Haiku 5.5.

### 5. Effort and thinking do not split a route's prefix

Each route pins its thinking and effort per routing row or per door. The one
deliberate variation is the development effort A/B arm. In the golden store
the arm's page requests read the default arm's 2,716-token prefix, so an
effort change on Claude Sonnet 5.5 kept the system cache. The paid site plan's
`medium` effort is its own route's setting and never mixes with another plan
inside a job.

### 6. Re-asks rebuild the prefix identically and append

Covered by finding 1. `maxTokens` shrinks on each attempt, but it is not part
of the cache key. A step-level re-run, the machine's retry, re-reads the
inventory, which rides after the last system breakpoint. A page's
missing-sections follow-up asks a fresh single turn of `base + missing`. That
turn shares no marked boundary with the first ask, so it re-pays its tail.
Follow-ups are rare (no case in the golden store).

### 7. Writes never read: the surcharge

- **Production.** Never-read writes are about 60% of the generate step's
  writes: the single-use routes in finding 2, plus every console chat turn,
  since turns are hours apart (84k written, 6k read). At 0.25× that is about
  $0.11 a week at October's volume.
- **Development.** Hour-long writes on single-use routes are re-written when a
  sweep is re-run more than 60 minutes later. The October 14 sweeps at 16:24
  and 17:30 were 66 minutes apart, so seven custom kinds (34.7k tokens) were
  written twice at 2× and never read.

### 8. Input hygiene

The lookup tool rides in every document door's tools, about 195 tokens inside
the cached prefix. Pages, frames and sections never call it, but it is read
at 0.05× and keeps one shape for every site (AI_JOBS, *The inventory, and
"more on request"*), so it stays. Sonnet 5.5's 0.05× read makes any cached
byte nearly free. The money in input is the uncached tail: the inventory block
and the user turn, 30% of the site kind's spend. That tail is per-request by
nature, apart from the brief and the plan (lever 6).

## Levers, ranked

Dollar figures are a week at October 1–14's production profile ($5.86 a week
in all). The second figure is per 1,000 paid guided starts shaped like
`eg4maZMGtN` ($259 at today's prices), for when traffic grows. Assumptions:
Sonnet 5.5 list prices, a five-minute production cache, and about 60% of
generate writes on single-use routes.

| # | lever | $/week now | per 1,000 paid starts | quality risk | status |
| -- | -- | --: | --: | -- | -- |
| 1 | **The plan caches its conversation** (finding 1) | ~$0.01 | ~$8 (3.2%) | none: no prompt byte changes | **implemented** |
| 2 | **Share one prefix across a job's routes**: every generate route offered the same sorted tool list, with the route's own tool forced by `tool_choice` (which does not invalidate the tools or system cache). About five writes per job become one write and four reads. | ~$0.05 | ~$30 (12%) | the model sees tools it must not call; a forced `tool_choice` is refused with thinking on some models | **rejected 2026-10-15** (AGL-3830, #1637 closed): a forced `tool_choice` returns 400 on Sonnet 5.5 and Opus 5.5, so the route's tool can only be named in its instructions. Re-measured, only the tools (2,086 tokens) and the doctrine block are shared, about $0.0006 a job at best. The first live request on the fast tier was refused outright: "The compiled grammar is too large" for the combined strict tool list on Haiku 5.5. |
| 3 | **Drop system markers on single-use routes in a deployed runtime** (look, frame, theme, email, products, dataset, posts): no 0.25× write on a prefix nothing reads. Development keeps them. | ~$0.11 | ~$6 (2.3%) | none to answers; it costs more once jobs run within five minutes of each other, and a re-ask then pays full input | proposal: a traffic call for the owner |
| 4 | **Development batches warm a cold prefix first**: one `max_tokens: 0` request per cold prefix with three or more entries, then the batch | ~$0.3–0.5 of development | — | none; adds a few seconds per batch | proposal |
| 5 | **Development sweeps re-run within the hour, or `AGLYN_AI_CACHE_TTL=5m` for a one-off sweep** (finding 7) | ~$0.1–0.3 of development | — | none | operational note |
| 6 | **A per-job tail cache for pages**: the brief and the whole plan move ahead of the inventory and the screen in the page turn, with a breakpoint after them, so pages 2…n read them | ~$0.01 | ~$5 (2%) | prompt order changes, so it needs a live eval | proposal; about $1–2 for the page cases |
| 7 | **Production hour-long cache**: positive only once site jobs arrive more often than about one an hour, when each job would read the last one's route prefixes | $0 now (negative) | ~$44 (17%) at that traffic | none | **implemented 2026-10-15** (AGL-3830): every step a site job runs asks for `1h` through its routing row; the meter prices those writes at 2× |
| 8 | **Console chat caches its history**: the docs block moves from the system into the last user turn, and the last turn is marked | ~$0.02 | — | prompt order changes | proposal; needs the chat's live eval |

The cache is not where the money is. A paid start's output is 57% of its
cost, and development is most of the provider bill (AI_JOBS, *Verifying a
prompt change*). The next lever after this round is output, the effort A/B
already in flight, more than any further cache work.

### Lever 7, as implemented (AGL-3830)

Production now asks for the hour on every step a site job runs: the routing
rows for the plan, the look (`job.theme`), the header and footer
(`job.layout`), pages and sections (`job.page`), listings (`job.seo`), the
creations (`job.form`, `job.template`, `job.component`), posts (`copy.blog`),
products and datasets (`job.products`) and the welcome email (`job.email`).
Chat, CRM, insights, experiments, logic, edits, workflows, campaigns and
text keep five minutes. What it costs and saves, on the reference job:

- **Cost while jobs stay more than an hour apart.** Every write pays 0.75×
  input more. The reference job wrote 23.3k tokens (4,967 on the plan,
  18,299 on generate), so on Sonnet 5.5 it costs 23.3k × 0.75 × $2/MTok =
  **$0.035 a job**, 13% of its $0.259. At October 1–14's volume (48 jobs
  on record in two weeks, most of them guided-start testing) that is under
  $1 a week.
- **Saving once jobs arrive within the hour.** The next job reads, at 0.05×,
  the route prefixes the last one wrote at 2×: the look, the frame, the
  page, the listing and the email prefixes (about 12k tokens a job) and the
  plan's 4,967. Each read in place of a 1.25× write saves 1.2× input, about
  $0.04 a job on Sonnet 5.5, and each read restarts the hour. The two cross
  when about two jobs in five (0.75 / (0.75 + 1.2)) find the last one's
  entries still warm; past that, it is the "~$44 per 1,000 paid starts"
  above.
- **No prompt byte changed**, only `cache_control`'s `ttl`, which no replay
  key reads, so recorded answers still replay and no live eval was needed.
- **The hour is the shared prompt's alone (AGL-4050).** At first every
  marker of a request took the route's lifetime. A 10/24 re-read found the
  hour on a job's own blocks, read by that job alone, costing more than it
  saved: about $1.14 a month of write price against $0.21 saved on the Sonnet
  routes. A plan's conversation, about 3.1k tokens, and a site's block
  (`site`) now keep five minutes on every row, and the shared markers (the
  doctrine and each route's rules) keep the hour. `aiCacheMarkerTtls` in
  `providers/contract.ts` decides each marker, and it never sends an
  hour-long marker after a five-minute one, which the API refuses.

## What needs a live eval

- **Lever 1, implemented.** No prompt byte changes. The marker is not part of
  the replay key and changes no answer. Its saving shows in production usage:
  on a plan step with two or more calls, uncached input falls and the
  conversation's delta shows as a write. A single golden plan case live on
  Sonnet 5.5 would confirm it, at about $0.05.
- **Levers 2, 6 and 8** change what the model is shown and need the owner's
  go for a live sweep first.
