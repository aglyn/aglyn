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
]

/**
 * `queued` — waiting for a runner; `running` — a step holds the lease;
 * `needs_input` — the job stopped for something only the workspace can
 * change (credits, a cap, a switch) and resumes when it does; the last
 * three are terminal.
 */
export type AiJobStatus =
  | 'queued'
  | 'running'
  | 'needs_input'
  | 'done'
  | 'failed'
  | 'canceled'

export const AI_JOB_TERMINAL_STATUSES: readonly AiJobStatus[] = [
  'done',
  'failed',
  'canceled',
]

export type AiJobStepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface AiJobStep {
  /** Stable within the job (`draft`, `generate`), unique per job. */
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
   * `theme` proposal — in the shape its job kind's runner defines.
   */
  proposal?: Record<string, unknown>
}

export interface AiJobLease {
  /** The process that holds the step: a route request id or a beat id. */
  owner: string
  until: ITimestamp
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
  createdBy: string
  createdAt: ITimestamp
  updatedAt: ITimestamp
  /** TTL — the brief is verbatim customer text and expires like an exchange. */
  expiresAt: ITimestamp
  /** Customer-safe only. */
  error?: string | null
  lease?: AiJobLease | null
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
  createdBy: string
  createdAt: string
  updatedAt: string
  error: string | null
  running: boolean
}
