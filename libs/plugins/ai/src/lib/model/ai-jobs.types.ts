/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type { AiEffort } from '../providers/contract'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import type { AiBuildPlan } from './ai-build-plan'

/**
 * AI generation jobs (AGL-2904).
 *
 * A job is one customer brief carried through one or more model steps by a
 * Firestore state machine, so that work longer than a request can survive
 * the request: the console route runs what it can inline, and the platform
 * job beat resumes whatever is left. The document is the whole state — no
 * process holds anything the next beat cannot read back.
 *
 * ── Outputs are drafts, never a publish ──────────────────────────────────
 *
 * Every output a job produces is a NEW draft or a new unpublished version of
 * an existing resource. A job never flips a version pointer, never registers
 * a route and never sends anything; a person opens the draft the job names
 * and publishes it through the door that already exists for that resource.
 * That is what lets a job run with no visitor, no session and no confirm
 * gate — the thing it writes cannot be seen by anyone but the workspace
 * until a member chooses otherwise.
 *
 * ── The lease ────────────────────────────────────────────────────────────
 *
 * A step runs under a lease: an owner id and an `until` instant. Two beats
 * fire a minute apart against a 120 s function timeout, and a console route
 * may still be running the first step when the first beat looks, so the
 * lease is what stops the same step being run — and metered — twice. A
 * claim is a transaction that refuses while another owner's lease is live;
 * an expired lease is simply claimable, which is also how a step abandoned
 * by a frozen process is recovered.
 */

/**
 * What a job produces. `text` and `theme` have runners; every other kind is
 * registered and refuses with "not available yet" until its own issue lands,
 * so a kind's presence in the union says the job model accepts it, not that
 * a runner exists.
 */
export type AiJobKind =
  | 'page'
  | 'component'
  | 'layout'
  | 'template'
  | 'edit'
  | 'seo'
  | 'site'
  | 'email'
  | 'campaign'
  | 'form'
  | 'experiment'
  | 'insight'
  | 'products'
  | 'crm'
  | 'onboarding'
  | 'workflow'
  | 'text'
  | 'theme'
  | 'build'

/** The union as a value, so a route can validate a body against it. */
export const AI_JOB_KINDS: readonly AiJobKind[] = [
  'page',
  'component',
  'layout',
  'template',
  'edit',
  'seo',
  'site',
  'email',
  'campaign',
  'form',
  'experiment',
  'insight',
  'products',
  'crm',
  'onboarding',
  'workflow',
  'text',
  'theme',
  'build',
]

/**
 * `queued` — waiting for a runner; `running` — a step holds the lease;
 * `needs_input` — the job stopped for something only the workspace can
 * change (credits, a cap, a switch), and the beat tries it again once that
 * may have changed; `needs_review` — the job stopped for a person's decision
 * (AGL-2935): its plan is ready to confirm, or an answer broke a building
 * rule on its re-ask. No timer can make that decision, so neither the beat
 * nor anything but that person resumes it. The last three are terminal.
 */
export type AiJobStatus =
  | 'queued'
  | 'running'
  | 'needs_input'
  | 'needs_review'
  | 'done'
  | 'failed'
  | 'canceled'

export const AI_JOB_TERMINAL_STATUSES: readonly AiJobStatus[] = [
  'done',
  'failed',
  'canceled',
]

export type AiJobStepStatus = 'pending' | 'running' | 'done' | 'failed'

/** The step a planned kind runs first (AGL-2935): its plan, before anything is built. */
export const AI_JOB_PLAN_STEP = 'plan'

export interface AiJobStep {
  /** Stable within the job (`plan`, `draft`, `generate`), unique per job. */
  name: string
  status: AiJobStepStatus
  startedAt?: ITimestamp | null
  endedAt?: ITimestamp | null
  /** Credits this step has actually cost, at the plan's credit rate. */
  creditsSpent: number
  /** Customer-safe only; provider detail goes to the server log. */
  error?: string | null
  /**
   * How many times a runner has been handed this step. A retryable provider
   * failure hands the step back as `pending`; the count is what stops a
   * provider outage re-running a step forever.
   */
  attempts?: number
  /**
   * Passes of a step that works through a list (AGL-2910): each one a
   * recorded, metered exchange that asked to continue. Attempts count again
   * from zero after a pass; this count is what bounds the step.
   */
  passes?: number
  /**
   * What the step's model calls cost in tokens and time (AGL-2937), summed
   * over every run that reached the provider. Absent on a step none has.
   */
  tokens?: AiJobStepTokens
  /**
   * The ids the step writes its drafts under, by draft (AGL-3079): minted
   * when the job is created, so every run of the step names the same drafts.
   * Absent on a step that writes none; a step that records none names its
   * drafts by the job's own id.
   */
  draftIds?: Partial<Record<AiJobDraftSlot, string>>
}

/**
 * A draft a job's kind always writes (AGL-3079): a screen, layout, template,
 * form or component; an email design; a campaign; an automation.
 */
export type AiJobDraftSlot =
  | 'screen'
  | 'layout'
  | 'template'
  | 'form'
  | 'component'
  | 'email'
  | 'campaign'
  | 'workflow'

/**
 * A step's measure (AGL-2937): the four token counts the meter prices, the
 * time spent in the runner, and the model and thinking effort of the last
 * run. The machine writes it beside `creditsSpent`, so what a kind of step
 * costs in tokens is read off the job rather than inferred from the month.
 */
export interface AiJobStepTokens {
  /** Prompt tokens sent uncached. */
  input: number
  /** Prompt tokens read from the prompt cache. */
  cachedRead: number
  /** Prompt tokens written to the prompt cache. */
  cacheWrite: number
  /** Tokens generated, thinking included. */
  output: number
  /** The model the last run was served by. */
  model: string | null
  /** The thinking effort the last run asked for; `null` when it named none. */
  effort: AiEffort | null
  /** Milliseconds spent in the runner, summed over runs. */
  latencyMs: number
  /** Runs that reached the provider. */
  runs: number
  /**
   * Why the step's latest runs stopped (AGL-3042), oldest first and the last
   * run last: each run's stop reason and the tokens it generated, so a pass
   * cut off at its ceiling reads off the job rather than out of the sums. At
   * most `AI_JOB_STEP_LAST_RUNS` are kept; absent on a step measured before.
   */
  lastRuns?: AiJobStepRunStop[]
}

/** One run of a step, by why it stopped (AGL-3042). */
export interface AiJobStepRunStop {
  /**
   * The stop reason of the run's last model call — `tool_use` or `end_turn`
   * for an answer, `max_tokens` for one cut off at its ceiling, `refusal` —
   * and `null` when the provider named none.
   */
  stopReason: string | null
  /** Tokens the run generated, over every model call it made. */
  output: number
}

export type AiJobOutputResource =
  | 'screen'
  | 'reusableComponent'
  | 'layout'
  | 'template'
  | 'form'
  | 'emailScreen'
  | 'campaign'
  | 'product'
  | 'experiment'
  | 'workflow'
  | 'text'
  | 'theme'
  | 'seo'
  | 'insight'
  | 'crm'
  /** A draft another plugin wrote for a build (AGL-3616), named by `draftResource`. */
  | 'draft'

/**
 * One thing a job wrote. Addressed by resource and id so the console can
 * build the "open draft" link without knowing what the runner did; `text`
 * has no document of its own, so its body rides on the output itself.
 *
 * A `theme` output is a proposal rather than a document (AGL-2938). A site's
 * theme is fields on its host document, and writing those fields is the save
 * the Theme section's editor performs, which a job never does. So the change
 * set rides on the output as `proposal`, and a person puts it in the editor
 * and saves it there, or does not.
 *
 * An `seo` output is a proposal rather than a document (AGL-2910): search
 * listing values for a page or a product, or a site audit's findings and
 * fixes. A screen's listing is served from the screen document itself, so a
 * job never writes it; the values ride on the output as `proposal`, a person
 * puts them in the editor and saves them there, and an audit's content fixes
 * become new versions only when a person applies them.
 *
 * A `crm` output is a proposal too (AGL-2917): a record's summary and next
 * step, an email draft, or an import's column matches. The CRM's own task
 * form, stage route, composer and import drawer are the writes, and a person
 * makes each of them, or does not.
 */
export interface AiJobOutput {
  resource: AiJobOutputResource
  id: string
  /** The unpublished version the job created, where the resource has versions. */
  versionId?: string | null
  /** `null` for an output that belongs to the org rather than one site. */
  hostId: string | null
  /**
   * The site's subdomain, which is what a console URL names a site by: the
   * `[host]` segment resolves by subdomain, so a link built from `hostId`
   * names no site the console can open.
   */
  hostSubdomain?: string | null
  label: string
  /** The body of a `text` output. Absent on every other resource. */
  text?: string
  /**
   * The change set of an output a person applies rather than opens — a
   * `theme` or `seo` proposal — in the shape its job kind's runner defines.
   */
  proposal?: Record<string, unknown>
  /**
   * What the person decides next about this output, in customer-safe words:
   * a routing the draft could not store, or part of the brief it could not
   * build. Absent when there is nothing to decide.
   */
  note?: string | null
  /**
   * What a first visit is estimated to transfer, as the doctrine measured
   * the generated document (AGL-2935) — the weight the proposal shows before
   * anything is applied. Absent where the output is not a page's document.
   */
  load?: AiLoadEstimate | null
  /**
   * For a `draft` output (AGL-3616): the resource whose owner wrote it, as
   * its writer is registered on the resource-draft seam.
   */
  draftResource?: string
}

export interface AiJobLease {
  /** The process that holds the step: a route request id or a beat id. */
  owner: string
  until: ITimestamp
}

/** Why a job stopped for a person (AGL-2935). */
export type AiJobReviewReason =
  /** The plan step proposed a plan; generation waits for it to be confirmed. */
  | 'plan'
  /** An answer broke a building rule, and so did the answer to the re-ask. */
  | 'doctrine'
  /**
   * The site is at an allowance its plan sets for what the step writes, such
   * as its shared layouts or its templates (AGL-2909). Freeing one, or a plan
   * that holds more, is the member's decision; trying again runs the step
   * again.
   */
  | 'limit'

/**
 * A building rule an answer broke, as the job keeps it: the number, the code,
 * the sentence, and where in the answer it was broken (AGL-3078).
 */
export interface AiJobRuleFinding {
  rule: number | null
  code: string
  /** Customer-safe. */
  message: string
  /** The nodes the finding names, by the ids the refused answer gave them. Absent when it names none. */
  nodeIds?: string[]
  /** The plan entries or answer fields it names, as `screens[0].sections[2]`. Absent when it names none. */
  paths?: string[]
}

/**
 * One node of the parts of a refused answer its findings name (AGL-3078), as
 * the review keeps it: the node's place, its element and the names of what it
 * sets, and never its copy. A Grid keeps the values of its layout props as
 * they were written, so a review can tell a shape the rules refuse from one
 * the model was asked to mend and did not.
 */
export interface AiJobReviewOutlineNode {
  /** The node's id, as the refused answer wrote it. */
  id: string
  /** How far below a node a finding names it sits: 0 for that node. */
  depth: number
  componentId: string
  /** The props it sets, by name only. */
  props: string[]
  /** The `sx` keys it sets, by name only; absent when it sets none. */
  sx?: string[]
  /** A Grid's layout props, `container`, `size`, `direction`, `spacing` and the rest, as written. */
  grid?: Record<string, string | number | boolean | null>
  /** Its children's element ids, in order. */
  children: string[]
}

export interface AiJobReview {
  reason: AiJobReviewReason
  /** Customer-safe: what the person is asked to decide. */
  message: string
  /** The rules the last answer broke; empty for a plan. */
  findings: AiJobRuleFinding[]
  /**
   * The parts of the refused answer its findings name, each node with the
   * nodes below it (AGL-3078); absent when they name none. Kept with the job
   * for diagnosis, and shown to staff.
   */
  outline?: AiJobReviewOutlineNode[]
  /**
   * The checks' own sentence, where `message` was written for the member
   * instead (AGL-3594): rule numbers and all, for staff. Its presence is what
   * tells the drawer the findings are staff reading too.
   */
  detail?: string
  /**
   * Why trying again cannot work yet (AGL-3594) — the Free allowance left is
   * less than the step can cost — or absent when it can. The button is drawn
   * disabled with this beside it.
   */
  retryRefusal?: string
}

export type AiJobPlanStatus = 'proposed' | 'confirmed'

/** The plan a job builds from, as the job keeps it once its plan step proposed it. */
export interface AiJobPlan extends AiBuildPlan {
  status: AiJobPlanStatus
  /** Names for the inventory ids the plan references, read when it was made. */
  labels: Record<string, string>
  proposedAt: ITimestamp
  confirmedAt: ITimestamp | null
  /** The member who confirmed it. */
  confirmedBy: string | null
  /**
   * A digest of the whole request that produced this plan (AGL-2937): the
   * job's kind, site, brief and scalar inputs, the model that answered, and
   * the prompt as it was rendered — the site inventory included. A later job
   * whose request hashes the same reuses this plan rather than paying for the
   * same answer again. A hash of the request, never of the answer, and no
   * part of the brief is recoverable from it.
   */
  key?: string
  /** The job this plan was reused from, when it was not asked for again. */
  reusedFrom?: string
}

/**
 * Where one item of a `build` job stands (AGL-3616). A build settles item by
 * item: a failed item gives back its own spend and the rest of the plan still
 * runs, so the job keeps one row per item, written only by the machine's
 * `recordStep` — in the same transaction as the spend it accounts for — and
 * by the resume door's retry.
 */
export type AiJobItemStatus = 'pending' | 'running' | 'succeeded' | 'degraded' | 'failed' | 'skipped'

/** Why an item failed: a give-back reason when it was ours, else the model's refusal or a review. */
export type AiJobItemFailureReason =
  | 'plan-refused'
  | 'doctrine-refused'
  | 'provider'
  | 'timeout'
  | 'step-failure'
  | 'unavailable'
  | 'refused'
  | 'review'

export interface AiJobItemFailure {
  /** Whether the failure was on our side: only then is the item's spend given back. */
  ours: boolean
  reason: AiJobItemFailureReason
  /** Customer-safe. */
  message: string
}

export interface AiJobItemLedger {
  /** The unit's slot within the plan: `c0` a creation, `p0` a page, `i0` an item. */
  slot: string
  /** The capability operation that builds it: `page`, `form`, or an owner's op. */
  op: string
  /** What a person reads: the page's title, the creation's or item's name. */
  label: string
  status: AiJobItemStatus
  /** Bumped by Try again; the refund key names it, so each attempt gives back once. */
  attempt: number
  /** What this item's passes cost, every attempt. */
  creditsSpent: number
  /** What this attempt's passes cost so far: what a failure of this attempt gives back. */
  attemptCredits?: number
  /** What was given back for this item's failures. */
  creditsRefunded: number
  /** The key the latest give-back for this item was made under. */
  refundKey?: string
  failure?: AiJobItemFailure | null
  /** The ids of the outputs this item produced. */
  outputs: string[]
  /** The slots whose failure changed how this item was built. */
  degradedBy?: string[]
  /** Customer-safe: what the person should know about this item. */
  note?: string | null
}

/** Whether a build's own planning was charged or given back (AGL-3616). */
export interface AiJobOrchestration {
  /** What the plan step spent. */
  creditsSpent: number
  /** `charged` once anything was delivered; `refunded` when nothing was. */
  settled: 'pending' | 'charged' | 'refunded'
}

export interface AiJob {
  $id: string
  orgId: string
  hostId?: string | null
  kind: AiJobKind
  status: AiJobStatus
  /** The customer's brief, verbatim. Expires with the document. */
  brief: string
  /** Kind-specific inputs the runner reads (a screen id to edit, a tone). */
  inputs: Record<string, unknown>
  /**
   * The model the creator picked for the job's steps (AGL-2942), or `null`
   * for Auto. Each step honors it only where the plan and the allotment
   * allowlists allow it, and runs on the routing table otherwise.
   */
  model?: string | null
  steps: AiJobStep[]
  outputs: AiJobOutput[]
  /**
   * The nominal credit figure held against the job while steps are
   * outstanding. The meter's real bound is the per-step message reservation
   * and the org's monthly ceiling; this is the number the console shows so
   * a running job is not read as free.
   */
  creditsReserved: number
  creditsSpent: number
  /**
   * Credits the job gave back because it failed on our side (AGL-3594),
   * summed over its give-backs; absent when it gave none. `creditsSpent`
   * stays what ran, so what the job cost is the one less the other.
   */
  refundedCredits?: number
  /** Why the latest give-back was made (`AiJobRefundReason`). */
  refundReason?: string
  /** How many give-backs the job has had: the next one's key. */
  refunds?: number
  createdBy: string
  createdAt: ITimestamp
  updatedAt: ITimestamp
  /** TTL — the brief is verbatim customer text and expires like an exchange. */
  expiresAt: ITimestamp
  /** Customer-safe only. */
  error?: string | null
  lease?: AiJobLease | null
  /** The plan the job builds from, once its plan step proposed one. */
  plan?: AiJobPlan | null
  /** What the person is asked to decide while the job is `needs_review`. */
  review?: AiJobReview | null
  /**
   * What a person applied from the job's outputs (AGL-2910). Written by the
   * door that applied them, never by a step runner, and absent until then.
   */
  applied?: AiJobApplied | null
  /**
   * What a guided site start put live when it finished (AGL-3596): written
   * once by the site step's last pass, never by a person. Absent on every
   * other job, which leaves its pages as drafts.
   */
  sitePublish?: AiJobSitePublish | null
  /** A `build` job's items, one row each (AGL-3616); absent on every other kind. */
  items?: AiJobItemLedger[] | null
  /** A `build` job's planning spend and how it settled (AGL-3616). */
  orchestration?: AiJobOrchestration | null
}

/**
 * A guided site start's publish (AGL-3596): the pages that went live, with
 * the address each answers, and the pages that stayed drafts, each with the
 * plain sentence for why. A page that stayed a draft never fails the job.
 */
export interface AiJobSitePublish {
  /** The site's live address, `https://<subdomain>.aglyn.app/`; `null` when the site has no subdomain. */
  liveUrl: string | null
  published: Array<{ id: string; label: string; path: string }>
  drafts: Array<{ id: string; label: string; reason: string }>
}

/**
 * The record of an apply (AGL-2910): what became a new unpublished version,
 * and what waits in its editor for a person to save.
 */
export interface AiJobApplied {
  at: ITimestamp
  /** The member who applied. */
  by: string
  /** The new version opened for each resource, by resource id. */
  versions: Record<string, string>
  /** Resource ids whose proposed values wait in their editor, unsaved. */
  staged: string[]
}

/** The plan on the wire: every instant an ISO string. */
export interface AiJobPlanSummary extends AiBuildPlan {
  status: AiJobPlanStatus
  labels: Record<string, string>
  proposedAt: string | null
  confirmedAt: string | null
  confirmedBy: string | null
  key?: string
  reusedFrom?: string
}

/**
 * The wire form the console reads: every instant an ISO string, the lease
 * reduced to whether a runner holds the job. The brief and the outputs
 * travel as they are — the reader is a member of the org that wrote them.
 */
export interface AiJobSummary {
  id: string
  orgId: string
  hostId: string | null
  kind: AiJobKind
  status: AiJobStatus
  brief: string
  /**
   * The batch a door created this job as one of (AGL-2911), read off the
   * job's inputs; `null` for a job created on its own. The console groups a
   * run of jobs by it, which is the one thing it cannot do from a list whose
   * rows carry no inputs — and the only input the wire form carries, because
   * a batch id names nothing the member wrote.
   */
  batch: string | null
  steps: Array<{
    name: string
    status: AiJobStepStatus
    startedAt: string | null
    endedAt: string | null
    creditsSpent: number
    error: string | null
  }>
  outputs: AiJobOutput[]
  creditsReserved: number
  creditsSpent: number
  /** Credits given back for a failure on our side (AGL-3594); 0 when none. */
  refundedCredits?: number
  createdBy: string
  createdAt: string
  updatedAt: string
  error: string | null
  running: boolean
  plan: AiJobPlanSummary | null
  review: AiJobReview | null
  /** What a person applied from the outputs (AGL-2910); instants as ISO strings. */
  applied?: {
    at: string | null
    by: string
    versions: Record<string, string>
    staged: string[]
  } | null
  /** What a guided site start put live (AGL-3596); absent on every other job. */
  sitePublish?: AiJobSitePublish | null
  /**
   * A site job's answers (AGL-3596): the guided start's questions as the person
   * answered them, so a failed start's Try again reopens them filled in. The
   * scalar site inputs only, never anything else a job's inputs carry; absent
   * on every other kind.
   */
  siteInputs?: Record<string, unknown> | null
  /** A `build` job's items (AGL-3616); absent on every other job. */
  items?: AiJobItemLedger[]
  /**
   * Whether a build's request asked to publish (AGL-3616), so its plan card
   * offers the box that confirms it. Absent on every other job.
   */
  publishAsked?: boolean
  /** A `build` job's planning spend and how it settled (AGL-3616). */
  orchestration?: AiJobOrchestration
}
