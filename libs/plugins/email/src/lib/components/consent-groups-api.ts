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

/**
 * The console's client of `POST /api/orgs/consent-groups` — the one door
 * through which a consent group is declared, edited or dissolved (AGL-3320).
 *
 * ## Why the editor never writes Firestore
 *
 * `consentGroups` decides whose opt-outs hold a send and who a grant covers,
 * so the rules deny it to every client. A change is also not one write: the
 * route carries every refusal the change would otherwise lose onto the sites
 * that stop reading each other, flips the declaration, and then re-homes the
 * CRM records keyed by the old group — a job of several invocations with its
 * own lock. The console only asks: `preview` what a change would do, `apply`
 * it, and drive it with `continue` while somebody is watching. Everything
 * else is the server's.
 *
 * ## The wire shapes are declared here, field for field
 *
 * The route and its planner live in core, and this plugin keeps its own copy
 * of the request and response shapes rather than importing the planner's
 * module, so a browser bundle never carries server planning code. The shapes
 * are the route's contract; a field renamed there must be renamed here.
 *
 * Nothing the server says is trusted to be well formed: every reader below
 * accepts a missing or mistyped field and answers the narrow value, because a
 * progress banner that throws on a field it did not expect would hide the
 * one change an org cannot afford to lose track of.
 */

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import { MAX_CONSENT_GROUP_HOSTS } from '@aglyn/aglyn/app-utils/consent-groups'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/** The route every call below posts to. */
export const CONSENT_GROUPS_ROUTE = '/api/orgs/consent-groups'

/** The org field holding the in-flight change's marker. */
export const CONSENT_GROUPS_CHANGE_FIELD = 'consentGroupsChange'

/** `orgs/{orgId}/{this}/{changeId}` — one change's job document. */
export const CONSENT_GROUP_CHANGES_COLLECTION = 'consentGroupChanges'

/** The longest name a group may carry — the route refuses a longer one. */
export const CONSENT_GROUP_NAME_MAX = 80

/**
 * How long after the flip the final sweep waits: the window in which a send
 * that resolved the old declaration can still be writing.
 */
export const CONSENT_GROUP_SWEEP_DELAY_MS = 6 * 60_000

/** The fewest sites a group may name; one site is already its own sender. */
export const CONSENT_GROUP_MIN_HOSTS = 2

/** The most, re-exported so the editor reads one ceiling. */
export { MAX_CONSENT_GROUP_HOSTS }

/*==========================================
 * REQUESTS
 *=========================================*/

/** One group of the complete next declaration. */
export interface ConsentGroupDeclarationEntry {
  /** Absent for a new group: the server mints its id. */
  id?: string
  name: string
  hostIds: string[]
}

/**
 * `preview` or `apply` a declaration.
 *
 * `groups` is the WHOLE next declaration, not a patch: a group left out is a
 * group dissolved. `expected` is the raw `org.consentGroups` the editor was
 * opened against, or `null` when the org had none, so a change made by
 * somebody else in the meantime is refused rather than overwritten.
 */
export interface ConsentGroupsDeclareRequest {
  orgId: string
  action: 'preview' | 'apply'
  expected: Record<string, unknown> | null
  groups: ConsentGroupDeclarationEntry[]
}

/** Drive, stop or read one change that is already running. */
export interface ConsentGroupsChangeRequest {
  orgId: string
  action: 'continue' | 'cancel' | 'status'
  changeId: string
}

export type ConsentGroupsRequest =
  | ConsentGroupsDeclareRequest
  | ConsentGroupsChangeRequest

/*==========================================
 * THE CHANGE WHILE IT RUNS
 *=========================================*/

/**
 * Where a running change is.
 *
 * - `carry` — refusals are being copied; the old declaration still holds.
 * - `rehome` — the new declaration is in force; CRM records are moving.
 * - `sweep` — a last pass for anything written while it changed.
 */
export type ConsentGroupChangePhase = 'carry' | 'rehome' | 'sweep'

/** `org.consentGroupsChange`, present exactly while a change runs. */
export interface ConsentGroupChangeMarker {
  changeId: string
  phase: ConsentGroupChangePhase
  /** Every site the change touches. */
  hostIds: string[]
  startedAtMs: number
  /** When the new declaration took effect; absent until it has. */
  declaredAtMs?: number
}

/** What `continue` and `status` report beside the phase. */
export interface ConsentGroupChangeProgressReport {
  /** Five consecutive failures: the change waits for a retry. */
  stalled?: boolean
  /** The last failure, already stripped of anything private. */
  lastError?: string | null
  failures?: number
  /** Running totals by step, e.g. opt-outs copied so far. */
  counts?: Record<string, number>
}

/*==========================================
 * THE PREVIEW
 *=========================================*/

/** A declared group as the planner reads it: usable, named, sorted. */
export interface ConsentGroupPreviewGroup {
  name: string
  hostIds: string[]
}

/** One line of what the change does to the declaration. */
export interface ConsentGroupChangeLine {
  kind: 'created' | 'renamed' | 'added' | 'removed' | 'moved' | 'dissolved'
  groupId?: string
  name?: string
  hostId?: string
  hostIds?: string[]
  /** The sentence the activity log records for this line. */
  text?: string
  [field: string]: unknown
}

/** What signup forms said before, and will say after, for one group. */
export interface ConsentGroupDisclosureChange {
  groupId: string
  hostIds: string[]
  before: string | null
  after: string | null
}

/** Refusals one site will copy from another, counted before anything moves. */
export interface ConsentGroupCarryCount {
  toHostId: string
  fromHostId: string
  siteSuppressions: number
  topicOptOuts: number
  paces: number
}

/** Refusals a site starts honoring by reading its new siblings. */
export interface ConsentGroupInheritedCount {
  hostId: string
  refusals: number
}

/** Confirmations that stop holding a sibling's mail once sites separate. */
export interface ConsentGroupPendingHold {
  hostId: string
  topicId: string
  count: number
  releasedHostIds: string[]
}

/**
 * A plugin's own account of what the change does to its data, in its words.
 * The editor prints these as given; `count` is `null` when it was not
 * counted.
 */
export interface ConsentGroupParticipantLine {
  id: string
  text: string
  count: number | null
  severity: 'info' | 'warning' | string
}

export interface ConsentGroupParticipantPreview {
  pluginId: string
  /** `null` when the plugin could not answer in time. */
  lines: ConsentGroupParticipantLine[] | null
}

/**
 * A site joining a group under the org's `forward` consent policy, which
 * would let it mail people its new siblings captured before a cutoff.
 */
export interface ConsentGroupForwardPolicyWarning {
  hostIds: string[]
  capturedBeforeMs: number | null
}

/** How long the change is expected to take, from the volumes it counted. */
export type ConsentGroupChangeEstimate =
  | 'instant'
  | 'under-a-minute'
  | 'minutes'
  | 'long'

export interface ConsentGroupChangePreview {
  before: Record<string, ConsentGroupPreviewGroup>
  after: Record<string, ConsentGroupPreviewGroup>
  /** Stored entries nothing honors today, which the write removes. */
  discarded: Array<{ id?: string; name?: string | null } | string>
  lines: ConsentGroupChangeLine[]
  disclosures: ConsentGroupDisclosureChange[]
  carries: ConsentGroupCarryCount[]
  inherited: ConsentGroupInheritedCount[]
  /** Only when the org's sites wait for each other's confirmation. */
  pendingHolds: ConsentGroupPendingHold[]
  partialAccessMembers: number
  forwardPolicyWarning: ConsentGroupForwardPolicyWarning | string | null
  participants: ConsentGroupParticipantPreview[]
  /** The capture surfaces that show a group's name today, e.g. `form`. */
  capturesDisclosing: string[]
  estimate: ConsentGroupChangeEstimate
}

/*==========================================
 * RESPONSES
 *=========================================*/

export interface ConsentGroupsPreviewResponse {
  ok: true
  preview: ConsentGroupChangePreview
}

export interface ConsentGroupsProgressResponse {
  ok: true
  changeId: string
  phase: ConsentGroupChangePhase | 'done' | string
  done: boolean
  progress?: ConsentGroupChangeProgressReport | null
}

/** One refusal from the route's validation, pointing at what it refused. */
export interface ConsentGroupValidationIssue {
  code: string
  /** Index into the `groups` that were posted. */
  groupIndex?: number
  hostId?: string
}

/** Why a call did not succeed, sorted into what the editor does about it. */
export type ConsentGroupsFailure =
  | {
      /** 400: the declaration itself; `errors` point at what to fix. */
      kind: 'invalid'
      message: string
      errors: ConsentGroupValidationIssue[]
    }
  | {
      /** 409: somebody else changed the declaration first. */
      kind: 'stale'
      message: string
      /** The raw declaration as it now stands. */
      current: Record<string, unknown> | null
    }
  | {
      /** 409: another change is still running, sweep included. */
      kind: 'in-flight'
      message: string
      changeId: string | null
    }
  | {
      /** 409 on `cancel`: the declaration already flipped. */
      kind: 'took-effect'
      message: string
    }
  | { kind: 'locked'; message: string }
  | { kind: 'refused'; status: number; message: string }

/**
 * A call's outcome. Each branch names the other's field as absent, so a
 * caller can read `failure` after testing `ok` — this workspace compiles
 * without `strictNullChecks`, under which a boolean discriminant alone does
 * not narrow.
 */
export type ConsentGroupsCallResult<T> =
  | { ok: true; body: T; failure?: undefined }
  | { ok: false; body?: undefined; failure: ConsentGroupsFailure }

/*==========================================
 * VALIDATION CODES
 *=========================================*/

/**
 * Every refusal the route's validation can name, and what to tell the admin.
 *
 * The route is authoritative — the editor checks only what it can check
 * without asking (a name, a site count) and shows the rest when the route
 * answers. A code this table does not know is shown as the route's own
 * sentence rather than dropped.
 */
export const CONSENT_GROUP_ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  'name-empty':
    'Give the group a name. Signup forms show it, so it can’t be blank.',
  'name-too-long': `Keep the name to ${CONSENT_GROUP_NAME_MAX} characters or fewer.`,
  'name-duplicate': 'Another consent group already has this name.',
  'too-few-sites': 'A consent group needs at least two sites.',
  'too-many-sites': `A consent group can include at most ${MAX_CONSENT_GROUP_HOSTS} sites.`,
  'unknown-site': 'One of these sites is no longer part of your organization.',
  'site-in-two-groups': 'A site can be in only one consent group.',
  'unknown-group':
    'This consent group no longer exists. Close this and start again.',
  'group-replaced':
    'Every site in this group would be replaced. Create a new group for these sites instead.',
  'no-change': 'Nothing has changed yet.',
}

/**
 * Other spellings of the same refusals, folded onto the table's keys so one
 * message answers each refusal however it is spelled on the wire.
 */
const ISSUE_ALIASES: Readonly<Record<string, string>> = {
  'name-required': 'name-empty',
  'name-missing': 'name-empty',
  'name-taken': 'name-duplicate',
  'duplicate-name': 'name-duplicate',
  'too-few-hosts': 'too-few-sites',
  'too-many-hosts': 'too-many-sites',
  'unknown-host': 'unknown-site',
  'host-not-in-org': 'unknown-site',
  'site-not-in-org': 'unknown-site',
  'host-in-two-groups': 'site-in-two-groups',
  'site-claimed-twice': 'site-in-two-groups',
  unchanged: 'no-change',
}

/** The table key a wire code names, or the code itself when unknown. */
export function consentGroupIssueCode(code: string): string {
  return ISSUE_ALIASES[code] ?? code
}

/** The sentence for one validation refusal, naming the site when it can. */
export function consentGroupIssueMessage(
  issue: ConsentGroupValidationIssue,
  siteName?: (hostId: string) => string,
): string {
  const code = consentGroupIssueCode(issue.code)
  const site = issue.hostId && siteName ? siteName(issue.hostId) : ''
  if (site && code === 'unknown-site') {
    return `${site} is no longer part of your organization.`
  }
  if (site && code === 'site-in-two-groups') {
    return `${site} can be in only one consent group.`
  }
  return (
    CONSENT_GROUP_ISSUE_MESSAGES[code] ??
    'This change can’t be made as it stands. Check the name and sites and try again.'
  )
}

/*==========================================
 * CALLING THE ROUTE
 *=========================================*/

/** A token source `authorizedFetch` accepts: the signed-in user. */
type ConsentGroupsCaller = Parameters<typeof authorizedFetch>[0]

const STALE_MESSAGE =
  'Someone else changed consent groups while you were editing.'
const IN_FLIGHT_MESSAGE =
  'Finishing the last change. You can make another once it’s done.'
const TOOK_EFFECT_MESSAGE =
  'This change already took effect, so it can’t be stopped now. It will finish on its own.'

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * Sorts a refused answer into what the editor does next.
 *
 * Exported for the specs, which assert that each status the route documents
 * lands in the branch the dialog handles.
 */
export function classifyConsentGroupsFailure(
  status: number,
  payload: unknown,
  action: ConsentGroupsRequest['action'],
): ConsentGroupsFailure {
  const body = asRecord(payload)
  const said = typeof body['error'] === 'string' ? body['error'] : ''
  if (status === 400) {
    const errors = Array.isArray(body['errors'])
      ? (body['errors'] as unknown[])
          .map(asRecord)
          .filter((issue) => typeof issue['code'] === 'string')
          .map((issue) => ({
            code: String(issue['code']),
            ...(typeof issue['groupIndex'] === 'number'
              ? { groupIndex: issue['groupIndex'] as number }
              : {}),
            ...(typeof issue['hostId'] === 'string'
              ? { hostId: issue['hostId'] as string }
              : {}),
          }))
      : []
    return {
      kind: 'invalid',
      message: errors.length
        ? consentGroupIssueMessage(errors[0])
        : said || 'This change can’t be made as it stands.',
      errors,
    }
  }
  if (status === 409) {
    if (action === 'cancel') {
      return { kind: 'took-effect', message: TOOK_EFFECT_MESSAGE }
    }
    if ('current' in body) {
      const current = body['current']
      return {
        kind: 'stale',
        message: STALE_MESSAGE,
        current:
          current && typeof current === 'object' && !Array.isArray(current)
            ? (current as Record<string, unknown>)
            : null,
      }
    }
    return {
      kind: 'in-flight',
      message: IN_FLIGHT_MESSAGE,
      changeId: typeof body['changeId'] === 'string' ? body['changeId'] : null,
    }
  }
  if (status === 423) {
    const locked = parseLockdownRefusal(status, payload)
    return {
      kind: 'locked',
      message: locked
        ? lockdownRefusalText(locked)
        : 'Changes are paused right now. Try again later.',
    }
  }
  if (status === 401) {
    return {
      kind: 'refused',
      status,
      message: 'Your session has ended. Sign in again to change consent groups.',
    }
  }
  if (status === 403) {
    return {
      kind: 'refused',
      status,
      message:
        body['reason'] === 'email-unverified'
          ? 'Verify your email address to change consent groups.'
          : said || 'You don’t have permission to change consent groups.',
    }
  }
  if (status === 404) {
    return {
      kind: 'refused',
      status,
      message: said || 'This organization could not be found.',
    }
  }
  return {
    kind: 'refused',
    status,
    message: said || 'Something went wrong. Try again in a moment.',
  }
}

/**
 * Posts one action and sorts the answer. Never throws: a network failure is
 * a refusal with a sentence, so every caller has exactly two branches.
 */
export async function postConsentGroups<T>(
  user: ConsentGroupsCaller,
  request: ConsentGroupsRequest,
): Promise<ConsentGroupsCallResult<T>> {
  let response: Response
  try {
    response = await authorizedFetch(user, CONSENT_GROUPS_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return {
      ok: false,
      failure: {
        kind: 'refused',
        status: 0,
        message:
          'The server couldn’t be reached. Check your connection and try again.',
      },
    }
  }
  const payload = await response.json().catch(() => null)
  if (response.ok && asRecord(payload)['ok'] === true) {
    return { ok: true, body: payload as T }
  }
  return {
    ok: false,
    failure: classifyConsentGroupsFailure(
      response.ok ? 500 : response.status,
      payload,
      request.action,
    ),
  }
}

/*==========================================
 * READING WHAT THE ORG DOCUMENT AND THE JOB SAY
 *=========================================*/

const PHASES: readonly ConsentGroupChangePhase[] = ['carry', 'rehome', 'sweep']

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * The org's in-flight change, or `null` when none runs.
 *
 * A marker without a change id is not a change anybody can drive or stop,
 * so it reads as absent; an unknown phase reads as `carry`, the phase in
 * which nothing has taken effect, because that is the claim a banner can
 * make without being wrong.
 */
export function readConsentGroupChangeMarker(
  org: Record<string, unknown> | null | undefined,
): ConsentGroupChangeMarker | null {
  const raw = asRecord(asRecord(org)[CONSENT_GROUPS_CHANGE_FIELD])
  const changeId = typeof raw['changeId'] === 'string' ? raw['changeId'] : ''
  if (!changeId) return null
  const phase = PHASES.includes(raw['phase'] as ConsentGroupChangePhase)
    ? (raw['phase'] as ConsentGroupChangePhase)
    : 'carry'
  const declaredAtMs = finiteNumber(raw['declaredAtMs'])
  return {
    changeId,
    phase,
    hostIds: Array.isArray(raw['hostIds'])
      ? (raw['hostIds'] as unknown[]).filter(
          (id): id is string => typeof id === 'string' && !!id,
        )
      : [],
    startedAtMs: finiteNumber(raw['startedAtMs']) ?? 0,
    ...(declaredAtMs != null ? { declaredAtMs } : {}),
  }
}

/** What the progress banner needs from a change's job document. */
export interface ConsentGroupChangeJobView {
  /** The job's own phase, when it records one. */
  phase: string | null
  /** When another runner's claim on the job lapses; `null` when unclaimed. */
  leaseUntilMs: number | null
  stalled: boolean
  lastError: string | null
  failures: number
  /** The change finished, or was stopped before it took effect. */
  finished: boolean
}

/** Reads a job document defensively. `undefined` reads as a fresh job. */
export function readConsentGroupChangeJob(
  data: Record<string, unknown> | null | undefined,
): ConsentGroupChangeJobView {
  const job = asRecord(data)
  const lease = asRecord(job['lease'])
  const lastError = job['lastError']
  const phase = typeof job['phase'] === 'string' ? job['phase'] : null
  return {
    phase,
    leaseUntilMs: finiteNumber(lease['untilMs']),
    stalled: job['stalled'] === true,
    lastError:
      typeof lastError === 'string'
        ? lastError
        : typeof asRecord(lastError)['message'] === 'string'
          ? String(asRecord(lastError)['message'])
          : null,
    failures: finiteNumber(job['failures']) ?? 0,
    finished:
      job['done'] === true ||
      finiteNumber(job['finishedAtMs']) != null ||
      finiteNumber(job['canceledAtMs']) != null ||
      phase === 'done' ||
      phase === 'canceled',
  }
}
