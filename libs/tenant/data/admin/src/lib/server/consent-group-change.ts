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
 * RUNNING A CONSENT GROUP CHANGE (AGL-3320) — the executor.
 *
 * `consent-group-change.ts` in `app-utils` decides WHAT a change requires;
 * this carries it out, across as many invocations as it takes, without ever
 * leaving a refusal unhonored in between.
 *
 * ## The order is the safety argument
 *
 *  1. START — one transaction on the org document: the stored declaration is
 *     the one the editor rendered, and no other change is in flight. It sets
 *     the marker `consentGroupsChange` and creates the job document.
 *  2. CARRY — every carry of the plan through the three platform stores
 *     (`consent-group-carry.ts`), then every participant's carry phase.
 *  3. CATCH UP — everything filed since the carry began, again.
 *  4. DECLARE — one transaction: the marker still names this change in its
 *     carry phase and the stored declaration is still the one the job
 *     started from. Only then is the new declaration written.
 *  5. CATCH UP — once more, for whatever raced the flip.
 *  6. RE-HOME — every participant's holder records.
 *  7. SWEEP — once the sweep delay has passed, the whole carry and every
 *     participant's sweep, idempotently.
 *  8. DONE — the marker is cleared.
 *
 * The flip cannot happen before every carry and both catch-up passes are
 * done, because the steps run strictly in order and `declare` is only ever
 * reached from a finished `catch-up-pre`. Until the flip the declaration in
 * force is the old one, so a change that stalls or is canceled before it
 * has changed nothing anybody can observe — except refusals honored on more
 * sites, which is the safe direction. A rename moves nothing, and runs the
 * declare and finish alone.
 *
 * ## One invocation at a time, and any invocation may finish it
 *
 * The console's progress panel calls `continue` while it is open, and the
 * cron backstop calls every fifteen minutes. Each claims a LEASE on the job
 * by transaction and renews it on every unit it saves; a lease that lapses
 * (a process that died) is simply claimed by the next caller. A unit is one
 * page of one store, or one participant call, and every unit is idempotent,
 * so a unit re-run after a crash writes nothing it already wrote.
 *
 * ## A failure is retried, and five in a row are shown
 *
 * A unit that throws releases the lease and counts a failure against the job;
 * the next invocation retries it from its cursor. Five consecutive failures
 * mark the job STALLED — the activity log says so once, and the panel shows
 * the error with a retry — and the cron keeps trying. A participant's throw
 * is one of these: the change never flips past a participant that could not
 * carry its refusals (see `plugin-consent-group-change.ts`).
 */

import {
  CONSENT_GROUP_CHANGE_STEPS,
  CONSENT_GROUP_CHANGES_COLLECTION,
  CONSENT_GROUP_RENAME_STEPS,
  CONSENT_GROUP_SWEEP_DELAY_MS,
  CONSENT_GROUPS_CHANGE_FIELD,
  type ConsentGroupChangeCounts,
  type ConsentGroupChangeLine,
  type ConsentGroupChangePlan,
  type ConsentGroupChangePreview,
  type ConsentGroupChangeStatus,
  type ConsentGroupChangeStep,
  type ConsentGroupChangeProgress,
  type ConsentGroupDeclaration,
  type ConsentGroupsApiInFlight,
  type ConsentGroupsApiRefusal,
  type ConsentGroupsApiStale,
  type ConsentGroupsChangeMarker,
  type ConsentGroupsChangePhase,
  consentGroupChangePhaseOf,
  consentGroupDisclosureChanges,
  consentGroupsFingerprint,
  describeConsentGroupChangeLine,
  discardedConsentGroupIds,
  estimateConsentGroupChange,
  orgSiteIds,
  planConsentGroupChange,
  readConsentGroupsChange,
  validateConsentGroupDeclaration,
} from '@aglyn/aglyn/app-utils/consent-group-change'
import {
  CONSENT_GROUPS_FIELD,
  consentGroupsAwaitConfirmation,
  readConsentGroups,
} from '@aglyn/aglyn/app-utils/consent-groups'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  DEFAULT_EMAIL_TOPICS,
  TOPIC_OPT_OUTS_SUBCOLLECTION,
} from '@aglyn/aglyn/app-utils/email-topics'
import { resolveMarketingConsentPolicy } from '@aglyn/aglyn/app-utils/marketing-consent'
import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import {
  type ConsentGroupChangeParticipant,
  type ConsentGroupChangeParticipantPhase,
  listPluginConsentGroupParticipants,
  previewPluginConsentGroupChange,
} from '@aglyn/aglyn/plugin-manager/plugin-consent-group-change'
import { FieldValue } from 'firebase-admin/firestore'
import {
  CONSENT_GROUP_CARRY_STORES,
  CONSENT_GROUP_CARRY_SUBCOLLECTIONS,
  type ConsentGroupCarryStore,
  carryConsentGroupRefusals,
} from './consent-group-carry'
import firebaseAdmin from './firebase-admin'
import { getLockdownVerdict } from './lockdown'
import { logOrgActivity } from './organizations'

/** How long a claimed job stays claimed without a renewal. */
export const CONSENT_GROUP_CHANGE_LEASE_MS = 90_000

/** Consecutive failed units before a job is shown as stalled. */
export const CONSENT_GROUP_CHANGE_STALL_AFTER = 5

/**
 * How far before the carry began a catch-up reads. A refusal filed in the
 * seconds the carry's first page was being read, with a clock a little
 * behind, is inside it.
 */
const CATCH_UP_OVERLAP_MS = 5 * 60_000

/** Left before a deadline for the last save. */
const DEADLINE_SAFETY_MS = 5_000

/** The phases the cron looks for a change in. */
const RUNNING_PHASES: readonly ConsentGroupsChangePhase[] = ['carry', 'rehome', 'sweep']

/** Who asked, as the activity log records it. */
export interface ConsentGroupChangeActor {
  uid: string | null
  email?: string | null
}

/** Everything the executor reaches outside itself, injectable for the specs. */
export interface ConsentGroupChangeContext {
  firestore?: FirebaseFirestore.Firestore
  log?: typeof logOrgActivity
  now?: () => number
  /** Whether a lockdown refuses the cron acting for this org and actor. */
  lockedOut?: (org: Record<string, unknown>, uid: string | null) => Promise<boolean>
}

interface Context {
  firestore: FirebaseFirestore.Firestore
  log: typeof logOrgActivity
  now: () => number
  lockedOut: (org: Record<string, unknown>, uid: string | null) => Promise<boolean>
}

function contextOf(input: ConsentGroupChangeContext): Context {
  return {
    firestore: input.firestore ?? firebaseAdmin.app().firestore(),
    log: input.log ?? logOrgActivity,
    now: input.now ?? Date.now,
    lockedOut:
      input.lockedOut ??
      (async (org, uid) =>
        (await getLockdownVerdict({ org: org as never, uid, intent: 'write' })) !== null),
  }
}

/** Where a unit of the current step stands. */
interface UnitState {
  cursor: string | null
  done: boolean
}

/** The job document, `orgs/{orgId}/consentGroupChanges/{changeId}`. */
export interface ConsentGroupChangeJob {
  changeId: string
  orgId: string
  status: ConsentGroupChangeStatus
  step: ConsentGroupChangeStep
  /** The marker's phase while running; `done` or `canceled` after. */
  phase: ConsentGroupsChangePhase | 'done' | 'canceled'
  /** The steps this change runs, in order. */
  steps: ConsentGroupChangeStep[]
  /** The stored declaration it started from: what the flip re-checks. */
  beforeFingerprint: string
  before: ConsentGroupDeclaration
  after: ConsentGroupDeclaration
  plan: Omit<ConsentGroupChangePlan, 'before' | 'after'>
  /** The plan's lines as the activity log writes them. */
  lines: string[]
  siteNames: Record<string, string>
  /** The participants registered when it started — every one of them runs. */
  participants: string[]
  /** The current step's units, by key. */
  units: Record<string, UnitState>
  counts: ConsentGroupChangeCounts
  sitesReceiving: string[]
  plugins: Record<string, Record<string, number>>
  lease: { owner: string; untilMs: number } | null
  failures: number
  stalled: boolean
  lastError: string | null
  actor: { uid: string | null; email: string | null }
  startedAtMs: number
  carryStartedAtMs: number
  declaredAtMs: number | null
  finishedAtMs: number | null
  canceledAtMs: number | null
}

/** What the route answers for a job. */
export interface ConsentGroupChangeStatusBody {
  changeId: string
  phase: ConsentGroupsChangePhase | 'done' | 'canceled'
  done: boolean
  progress: ConsentGroupChangeProgress
}

/** A refusal the route turns into its status code and body. */
export type ConsentGroupChangeRefusal =
  | { ok: false; status: 400; body: ConsentGroupsApiRefusal }
  | { ok: false; status: 404; body: { error: string } }
  | { ok: false; status: 409; body: ConsentGroupsApiStale | ConsentGroupsApiInFlight }

const NOT_FOUND = { ok: false as const, status: 404 as const, body: { error: 'No such consent group change' } }

/** A caller whose lease was taken, or whose job was canceled, under it. */
class LeaseLost extends Error {}

const orgDoc = (ctx: Context, orgId: string) => ctx.firestore.collection('orgs').doc(orgId)
const jobDoc = (ctx: Context, orgId: string, changeId: string) =>
  orgDoc(ctx, orgId).collection(CONSENT_GROUP_CHANGES_COLLECTION).doc(changeId)

/** The job as the plan the participants and the carries read. */
function planOf(job: ConsentGroupChangeJob): ConsentGroupChangePlan {
  return { ...job.plan, before: job.before, after: job.after }
}

/** An error as the job records it: bounded, and with no address in it. */
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  return message.replace(/[^\s@]+@[^\s@]+/g, '[address]').slice(0, 300) || 'Unknown error'
}

export function consentGroupChangeStatus(
  job: ConsentGroupChangeJob,
  nowMs: number = Date.now(),
): ConsentGroupChangeStatusBody {
  const declaredAtMs = job.declaredAtMs ?? null
  const index = job.steps.indexOf(job.step)
  return {
    changeId: job.changeId,
    phase: job.phase,
    done: job.status !== 'running',
    progress: {
      status: job.status,
      step: job.step,
      stepIndex: index >= 0 ? index + 1 : job.steps.length,
      stepCount: job.steps.length,
      declaredAtMs,
      sweepAtMs:
        declaredAtMs !== null && !job.plan.renameOnly
          ? declaredAtMs + CONSENT_GROUP_SWEEP_DELAY_MS
          : null,
      stalled: job.stalled === true,
      failures: job.failures ?? 0,
      lastError: job.lastError ?? null,
      leaseUntilMs: job.lease && job.lease.untilMs > nowMs ? job.lease.untilMs : null,
      counts: { ...job.counts },
      sitesReceiving: job.sitesReceiving?.length ?? 0,
      plugins: job.plugins ?? {},
    },
  }
}

/*==========================================
 * VALIDATING AND PLANNING — shared by the preview and the start
 *=========================================*/

interface Prepared {
  org: Record<string, unknown>
  before: ConsentGroupDeclaration
  after: ConsentGroupDeclaration
  plan: ConsentGroupChangePlan
  siteIds: string[]
}

function prepare(
  org: Record<string, unknown>,
  expected: unknown,
  groups: unknown,
): Prepared | ConsentGroupChangeRefusal {
  const marker = readConsentGroupsChange(org)
  if (marker) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'A consent group change is still finishing',
        changeId: marker.changeId,
        phase: marker.phase,
      },
    }
  }
  const raw = org[CONSENT_GROUPS_FIELD]
  if (consentGroupsFingerprint(raw) !== consentGroupsFingerprint(expected)) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'Someone else changed consent groups while you were editing',
        current:
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null,
      },
    }
  }
  const before = readConsentGroups(org)
  const siteIds = orgSiteIds(org)
  const validation = validateConsentGroupDeclaration({
    groups,
    before,
    siteIds,
    reserved:
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.keys(raw as Record<string, unknown>)
        : [],
  })
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Those consent groups cannot be saved',
        errors: (validation as { errors: ConsentGroupsApiRefusal['errors'] }).errors,
      },
    }
  }
  const after = (validation as { after: ConsentGroupDeclaration }).after
  return {
    org,
    before,
    after,
    plan: planConsentGroupChange(before, after, { siteIds }),
    siteIds,
  }
}

const isRefusal = (value: unknown): value is ConsentGroupChangeRefusal =>
  Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false)

/** Every site a plan names, for the names its lines are written with. */
function plannedSites(plan: ConsentGroupChangePlan): string[] {
  return [
    ...new Set([
      ...plan.hostIds,
      ...Object.values(plan.before).flatMap((group) => group.hostIds),
      ...Object.values(plan.after).flatMap((group) => group.hostIds),
    ]),
  ]
}

/** What the console calls each site: its name, its subdomain, or its id. */
async function siteNamesFor(ctx: Context, hostIds: readonly string[]): Promise<Record<string, string>> {
  if (!hostIds.length) return {}
  const hosts = ctx.firestore.collection('hosts')
  const snapshots = await ctx.firestore.getAll(...hostIds.map((id) => hosts.doc(id)))
  const names: Record<string, string> = {}
  snapshots.forEach((snapshot, index) => {
    const id = hostIds[index]
    names[id] = String(snapshot.get('name') || snapshot.get('subdomain') || id)
  })
  return names
}

const describeLines = (lines: readonly ConsentGroupChangeLine[], names: Record<string, string>) =>
  lines.map((line) => describeConsentGroupChangeLine(line, (hostId) => names[hostId] ?? hostId))

/*==========================================
 * THE PREVIEW
 *=========================================*/

async function countOf(query: FirebaseFirestore.Query): Promise<number> {
  const snapshot = await query.count().get()
  return Number(snapshot.data().count) || 0
}

/**
 * What a change would do, counted and worded, writing nothing.
 *
 * Refused exactly as `apply` would be — a change in flight, a stale
 * `expected`, an invalid declaration — so the review step never shows a
 * change the next click cannot make.
 */
export async function previewConsentGroupChange(
  input: {
    orgId: string
    expected: unknown
    groups: unknown
    /** The org document, when the caller already read it. */
    org?: Record<string, unknown> | null
  } & ConsentGroupChangeContext,
): Promise<{ ok: true; preview: ConsentGroupChangePreview } | ConsentGroupChangeRefusal> {
  const ctx = contextOf(input)
  const org =
    input.org ?? ((await orgDoc(ctx, input.orgId).get()).data() as Record<string, unknown> | undefined)
  if (!org) return { ok: false, status: 404, body: { error: 'No such workspace' } }
  const prepared = prepare(org, input.expected, input.groups)
  if (isRefusal(prepared)) return prepared
  const { plan, before, after } = prepared as Prepared

  const db = ctx.firestore
  const cache = new Map<string, Promise<number>>()
  const cached = (key: string, query: () => FirebaseFirestore.Query) => {
    let pending = cache.get(key)
    if (!pending) {
      pending = countOf(query())
      cache.set(key, pending)
    }
    return pending
  }
  const store = (hostId: string, name: ConsentGroupCarryStore) =>
    db.collection('hosts').doc(hostId).collection(CONSENT_GROUP_CARRY_SUBCOLLECTIONS[name])
  const suppressions = (hostId: string) => cached(`s:${hostId}`, () => store(hostId, 'siteSuppressions'))
  const optOuts = (hostId: string) => cached(`t:${hostId}`, () => store(hostId, 'topicOptOuts'))
  const paces = (hostId: string) =>
    cached(`p:${hostId}`, () => store(hostId, 'paces').where('cadence', '!=', null))

  const carries = await Promise.all(
    plan.carries.map(async (carry) => ({
      toHostId: carry.toHostId,
      fromHostId: carry.fromHostId,
      siteSuppressions: await suppressions(carry.fromHostId),
      topicOptOuts: await optOuts(carry.fromHostId),
      paces: await paces(carry.fromHostId),
    })),
  )

  const membersIn = (declaration: ConsentGroupDeclaration, hostId: string) =>
    Object.values(declaration).find((group) => group.hostIds.includes(hostId))?.hostIds ?? [hostId]
  const joining: Array<{ hostId: string; siblings: string[] }> = []
  for (const hostId of [...new Set(Object.values(after).flatMap((group) => group.hostIds))].sort()) {
    const had = new Set(membersIn(before, hostId))
    const siblings = membersIn(after, hostId).filter((id) => id !== hostId && !had.has(id))
    if (siblings.length) joining.push({ hostId, siblings })
  }
  const inherited = await Promise.all(
    joining.map(async ({ hostId, siblings }) => {
      let refusals = 0
      for (const sibling of siblings) {
        refusals += (await suppressions(sibling)) + (await optOuts(sibling))
      }
      return { hostId, refusals }
    }),
  )

  /*
   * A pending confirmation holds a sibling's mail only with the switch on,
   * so only then does a separation release anything. Counted over the
   * built-in streams: the catalog of an organization's own streams belongs to
   * the Email plugin, and a stream it added is not counted here.
   */
  const pendingHolds: ConsentGroupChangePreview['pendingHolds'] = []
  if (consentGroupsAwaitConfirmation(org)) {
    const released = new Map<string, string[]>()
    for (const carry of plan.carries) {
      released.set(carry.toHostId, [...(released.get(carry.toHostId) ?? []), carry.fromHostId])
    }
    for (const [hostId, releasedHostIds] of [...released.entries()].sort()) {
      for (const topic of DEFAULT_EMAIL_TOPICS) {
        const count = await countOf(
          db
            .collection('hosts')
            .doc(hostId)
            .collection(TOPIC_OPT_OUTS_SUBCOLLECTION)
            .where(`topics.${topic.id}.confirmedAt`, '==', null),
        )
        if (count > 0) pendingHolds.push({ hostId, topicId: topic.id, count, releasedHostIds })
      }
    }
  }

  const changedGroups = Object.entries(after)
    .filter(([id, group]) => {
      const was = before[id]
      return !was || was.hostIds.join('\n') !== group.hostIds.join('\n')
    })
    .map(([, group]) => group.hostIds)
  let partialAccessMembers = 0
  if (changedGroups.length) {
    const members = await orgDoc(ctx, input.orgId).collection('members').get()
    for (const member of members.docs) {
      const data = member.data() as Record<string, unknown>
      if (isOrgWideMember(data)) continue
      const reach = new Set(Object.keys((data['hostAccess'] ?? {}) as Record<string, unknown>))
      if (
        changedGroups.some(
          (hostIds) =>
            hostIds.some((id) => reach.has(id)) && !hostIds.every((id) => reach.has(id)),
        )
      ) {
        partialAccessMembers += 1
      }
    }
  }

  const policy = resolveMarketingConsentPolicy(org['marketingConsentPolicy'])
  const forwardPolicyWarning =
    policy.mode === 'forward' && joining.length
      ? { hostIds: joining.map((entry) => entry.hostId), enforceFromMs: policy.enforceFromMs }
      : null

  const participants = await previewPluginConsentGroupChange({ orgId: input.orgId, plan })
  const names = await siteNamesFor(ctx, plannedSites(plan))
  const texts = describeLines(plan.lines, names)
  const documents =
    carries.reduce((total, carry) => total + carry.siteSuppressions + carry.topicOptOuts + carry.paces, 0) +
    participants.reduce(
      (total, entry) =>
        total + (entry.lines ?? []).reduce((sum, line) => sum + (line.count ?? 0), 0),
      0,
    )

  return {
    ok: true,
    preview: {
      before,
      after,
      discarded: discardedConsentGroupIds(org),
      lines: plan.lines.map((line, index) => ({ ...line, text: texts[index] })),
      disclosures: consentGroupDisclosureChanges(before, after),
      carries,
      inherited,
      pendingHolds,
      partialAccessMembers,
      forwardPolicyWarning,
      participants,
      capturesDisclosing: ['form'],
      estimate: estimateConsentGroupChange(plan, documents),
    },
  }
}

/*==========================================
 * STARTING
 *=========================================*/

/**
 * Starts a change: the org marker and the job, in one transaction that
 * refuses a change in flight, a stale `expected` and an invalid declaration.
 * Writes nothing else — the caller advances it.
 */
export async function startConsentGroupChange(
  input: {
    orgId: string
    actor: ConsentGroupChangeActor
    expected: unknown
    groups: unknown
  } & ConsentGroupChangeContext,
): Promise<{ ok: true; changeId: string; job: ConsentGroupChangeJob } | ConsentGroupChangeRefusal> {
  const ctx = contextOf(input)
  const orgRef = orgDoc(ctx, input.orgId)
  const snapshot = await orgRef.get()
  if (!snapshot.exists) return { ok: false, status: 404, body: { error: 'No such workspace' } }
  const outside = prepare(snapshot.data() as Record<string, unknown>, input.expected, input.groups)
  if (isRefusal(outside)) return outside
  // Names are words for the log, read once and outside the transaction.
  const names = await siteNamesFor(ctx, plannedSites((outside as Prepared).plan))
  const participants = listPluginConsentGroupParticipants().map((entry) => entry.pluginId)
  const changeId = createResourceUid()
  const jobRef = jobDoc(ctx, input.orgId, changeId)
  const nowMs = ctx.now()

  const started = await ctx.firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(orgRef)
    if (!current.exists) {
      return { ok: false as const, status: 404 as const, body: { error: 'No such workspace' } }
    }
    const prepared = prepare(current.data() as Record<string, unknown>, input.expected, input.groups)
    if (isRefusal(prepared)) return prepared
    const { plan, before, after, org } = prepared as Prepared
    const steps = plan.renameOnly ? [...CONSENT_GROUP_RENAME_STEPS] : [...CONSENT_GROUP_CHANGE_STEPS]
    const job: ConsentGroupChangeJob = {
      changeId,
      orgId: input.orgId,
      status: 'running',
      step: steps[0],
      phase: 'carry',
      steps,
      beforeFingerprint: consentGroupsFingerprint(org[CONSENT_GROUPS_FIELD]),
      before,
      after,
      plan: {
        carries: plan.carries,
        flows: plan.flows,
        lines: plan.lines,
        hostIds: plan.hostIds,
        renameOnly: plan.renameOnly,
      },
      lines: describeLines(plan.lines, names),
      siteNames: names,
      participants: plan.renameOnly ? [] : participants,
      units: {},
      counts: { siteSuppressions: 0, topicOptOuts: 0, paces: 0 },
      sitesReceiving: [],
      plugins: {},
      lease: null,
      failures: 0,
      stalled: false,
      lastError: null,
      actor: { uid: input.actor.uid ?? null, email: input.actor.email ?? null },
      startedAtMs: nowMs,
      carryStartedAtMs: nowMs,
      declaredAtMs: null,
      finishedAtMs: null,
      canceledAtMs: null,
    }
    const marker: ConsentGroupsChangeMarker = {
      changeId,
      phase: 'carry',
      hostIds: plan.hostIds,
      startedAtMs: nowMs,
    }
    transaction.update(orgRef, {
      [CONSENT_GROUPS_CHANGE_FIELD]: marker,
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(jobRef, {
      ...job,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { ok: true as const, job }
  })
  if (isRefusal(started)) return started
  const { job } = started as { job: ConsentGroupChangeJob }
  await ctx.log(
    input.orgId,
    { uid: job.actor.uid, email: job.actor.email },
    `Started a consent group change: ${job.lines.join('; ')}`,
    { type: 'org', id: input.orgId },
  )
  return { ok: true, changeId, job }
}

/*==========================================
 * ADVANCING
 *=========================================*/

type Unit =
  | { kind: 'carry'; key: string; carryIndex: number; store: ConsentGroupCarryStore; sinceMs: number | null }
  | { kind: 'participant'; key: string; pluginId: string; phase: ConsentGroupChangeParticipantPhase }

/** The current step's units, in the order they run. */
function unitsOf(job: ConsentGroupChangeJob): Unit[] {
  const carries = (sinceMs: number | null): Unit[] =>
    job.plan.carries.flatMap((_carry, carryIndex) =>
      CONSENT_GROUP_CARRY_STORES.map((store) => ({
        kind: 'carry' as const,
        key: `c${carryIndex}:${store}`,
        carryIndex,
        store,
        sinceMs,
      })),
    )
  const participants = (phase: ConsentGroupChangeParticipantPhase): Unit[] =>
    job.participants.map((pluginId) => ({
      kind: 'participant' as const,
      key: `p:${pluginId}`,
      pluginId,
      phase,
    }))
  const since = job.carryStartedAtMs - CATCH_UP_OVERLAP_MS
  switch (job.step) {
    case 'carry':
      return [...carries(null), ...participants('carry')]
    case 'catch-up-pre':
    case 'catch-up-post':
      return [...carries(since), ...participants('carry')]
    case 'rehome':
      return participants('rehome')
    case 'sweep':
      return [...carries(null), ...participants('sweep')]
    default:
      return []
  }
}

function jobFrom(snapshot: FirebaseFirestore.DocumentSnapshot): ConsentGroupChangeJob | null {
  return snapshot.exists ? (snapshot.data() as ConsentGroupChangeJob) : null
}

/**
 * Saves a unit's result, renewing the lease — only while the job is still
 * running and still this caller's.
 */
async function save(
  ctx: Context,
  jobRef: FirebaseFirestore.DocumentReference,
  owner: string,
  fields: Partial<ConsentGroupChangeJob>,
  extra?: (transaction: FirebaseFirestore.Transaction, job: ConsentGroupChangeJob) => Promise<void>,
): Promise<ConsentGroupChangeJob> {
  return ctx.firestore.runTransaction(async (transaction) => {
    const job = jobFrom(await transaction.get(jobRef))
    if (!job || job.status !== 'running' || job.lease?.owner !== owner) throw new LeaseLost()
    if (extra) await extra(transaction, job)
    const next: Partial<ConsentGroupChangeJob> = {
      ...fields,
      lease: { owner, untilMs: ctx.now() + CONSENT_GROUP_CHANGE_LEASE_MS },
      failures: 0,
      stalled: false,
      lastError: null,
    }
    transaction.update(jobRef, { ...next, updatedAt: FieldValue.serverTimestamp() })
    return { ...job, ...next }
  })
}

function addCounts(
  base: Record<string, number> | undefined,
  more: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(more)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = (out[key] ?? 0) + value
  }
  return out
}

async function runUnit(
  ctx: Context,
  jobRef: FirebaseFirestore.DocumentReference,
  job: ConsentGroupChangeJob,
  owner: string,
  unit: Unit,
  deadlineMs: number,
): Promise<ConsentGroupChangeJob> {
  const state = job.units[unit.key] ?? { cursor: null, done: false }
  if (unit.kind === 'carry') {
    const carry = job.plan.carries[unit.carryIndex]
    const page = await carryConsentGroupRefusals({
      firestore: ctx.firestore,
      store: unit.store,
      carry,
      changeId: job.changeId,
      cursor: state.cursor,
      sinceMs: unit.sinceMs,
    })
    const counts = { ...job.counts, [unit.store]: (job.counts[unit.store] ?? 0) + page.written }
    const sitesReceiving =
      page.written > 0 && !job.sitesReceiving.includes(carry.toHostId)
        ? [...job.sitesReceiving, carry.toHostId]
        : job.sitesReceiving
    return save(ctx, jobRef, owner, {
      units: { ...job.units, [unit.key]: { cursor: page.cursor, done: page.done } },
      counts,
      sitesReceiving,
    })
  }
  const participant = participantFor(unit.pluginId)
  const result = await participant.run({
    orgId: job.orgId,
    changeId: job.changeId,
    plan: planOf(job),
    phase: unit.phase,
    cursor: state.cursor,
    deadlineMs: deadlineMs - DEADLINE_SAFETY_MS,
    dryRun: false,
  })
  return save(ctx, jobRef, owner, {
    units: { ...job.units, [unit.key]: { cursor: result.cursor ?? null, done: result.done === true } },
    plugins: { ...job.plugins, [unit.pluginId]: addCounts(job.plugins[unit.pluginId], result.counts ?? {}) },
  })
}

function participantFor(pluginId: string): ConsentGroupChangeParticipant {
  const entry = listPluginConsentGroupParticipants().find((candidate) => candidate.pluginId === pluginId)
  if (!entry) {
    // The change started with this participant; running on without it would
    // skip its share. Another process — one whose declarations registered it —
    // picks the job up.
    throw new Error(`The ${pluginId} plugin's part of this change is not available here`)
  }
  return entry.participant
}

/** Moves the job to the step after its current one. */
async function nextStep(
  ctx: Context,
  orgId: string,
  jobRef: FirebaseFirestore.DocumentReference,
  job: ConsentGroupChangeJob,
  owner: string,
): Promise<ConsentGroupChangeJob> {
  const next = job.steps[job.steps.indexOf(job.step) + 1] ?? 'finish'
  const phase = consentGroupChangePhaseOf(next)
  if (phase === job.phase) return save(ctx, jobRef, owner, { step: next, units: {} })
  // Entering the sweep: the marker says so, for the readers that hold off
  // while holder records may still be moving.
  const orgRef = orgDoc(ctx, orgId)
  return save(ctx, jobRef, owner, { step: next, units: {}, phase }, async (transaction) => {
    const marker = readConsentGroupsChange((await transaction.get(orgRef)).data())
    if (marker?.changeId === job.changeId) {
      transaction.update(orgRef, { [`${CONSENT_GROUPS_CHANGE_FIELD}.phase`]: phase })
    }
  })
}

/**
 * THE FLIP — the one write of `consentGroups` anywhere in the platform.
 *
 * The marker must still name this change in its carry phase and the stored
 * declaration must be the one the job started from; otherwise nothing is
 * written and the unit fails. `update`, not a merge, so a removed group's id
 * vanishes with it; an empty declaration deletes the field.
 */
async function declare(
  ctx: Context,
  jobRef: FirebaseFirestore.DocumentReference,
  job: ConsentGroupChangeJob,
  owner: string,
): Promise<ConsentGroupChangeJob> {
  const orgRef = orgDoc(ctx, job.orgId)
  const nowMs = ctx.now()
  const renameOnly = job.plan.renameOnly
  const declared = await save(
    ctx,
    jobRef,
    owner,
    renameOnly
      ? {
          step: 'finish',
          status: 'done',
          phase: 'done',
          declaredAtMs: nowMs,
          finishedAtMs: nowMs,
          units: {},
        }
      : { step: 'catch-up-post', phase: 'rehome', declaredAtMs: nowMs, units: {} },
    async (transaction) => {
      const org = (await transaction.get(orgRef)).data() as Record<string, unknown> | undefined
      const marker = readConsentGroupsChange(org)
      if (!org || marker?.changeId !== job.changeId || marker.phase !== 'carry') {
        throw new Error('The change no longer holds the organization, so the new groups were not saved')
      }
      if (consentGroupsFingerprint(org[CONSENT_GROUPS_FIELD]) !== job.beforeFingerprint) {
        throw new Error('The consent groups changed outside this change, so the new groups were not saved')
      }
      transaction.update(orgRef, {
        [CONSENT_GROUPS_FIELD]: Object.keys(job.after).length ? job.after : FieldValue.delete(),
        [CONSENT_GROUPS_CHANGE_FIELD]: renameOnly
          ? FieldValue.delete()
          : { ...marker, phase: 'rehome', declaredAtMs: nowMs },
        updatedAt: FieldValue.serverTimestamp(),
      })
    },
  )
  const finished = renameOnly ? { ...declared, lease: null } : declared
  if (renameOnly) await jobRef.update({ lease: null })
  for (const line of job.lines) {
    await ctx.log(job.orgId, job.actor, line, { type: 'org', id: job.orgId })
  }
  if (renameOnly) {
    await ctx.log(job.orgId, job.actor, 'Finished a consent group change', {
      type: 'org',
      id: job.orgId,
    })
  }
  return finished
}

/** The "Finished" line: the carries' totals, then each participant's clause. */
function finishedLine(job: ConsentGroupChangeJob): string {
  const copied = job.counts.siteSuppressions + job.counts.topicOptOuts + job.counts.paces
  const sites = job.sitesReceiving.length
  const clauses = [
    `${copied} ${copied === 1 ? 'opt-out' : 'opt-outs'} copied to ${sites} ${sites === 1 ? 'site' : 'sites'}`,
  ]
  for (const pluginId of job.participants) {
    const entry = listPluginConsentGroupParticipants().find((candidate) => candidate.pluginId === pluginId)
    const clause = entry?.participant.summarize?.(job.plugins[pluginId] ?? {})
    if (clause) clauses.push(clause)
  }
  return `Finished a consent group change: ${clauses.join('; ')}`
}

async function finish(
  ctx: Context,
  jobRef: FirebaseFirestore.DocumentReference,
  job: ConsentGroupChangeJob,
  owner: string,
): Promise<ConsentGroupChangeJob> {
  const orgRef = orgDoc(ctx, job.orgId)
  const nowMs = ctx.now()
  const done = await save(
    ctx,
    jobRef,
    owner,
    { status: 'done', phase: 'done', step: 'finish', finishedAtMs: nowMs, units: {} },
    async (transaction) => {
      const marker = readConsentGroupsChange((await transaction.get(orgRef)).data())
      if (marker?.changeId === job.changeId) {
        transaction.update(orgRef, {
          [CONSENT_GROUPS_CHANGE_FIELD]: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    },
  )
  await jobRef.update({ lease: null })
  await ctx.log(job.orgId, job.actor, finishedLine(done), { type: 'org', id: job.orgId })
  return { ...done, lease: null }
}

/**
 * One unit of work, or nothing when the job is waiting for its sweep.
 */
async function advanceOnce(
  ctx: Context,
  jobRef: FirebaseFirestore.DocumentReference,
  job: ConsentGroupChangeJob,
  owner: string,
  deadlineMs: number,
): Promise<{ job: ConsentGroupChangeJob; idle: boolean }> {
  if (job.step === 'declare') return { job: await declare(ctx, jobRef, job, owner), idle: false }
  if (job.step === 'finish') return { job: await finish(ctx, jobRef, job, owner), idle: false }
  if (job.step === 'sweep-wait') {
    if (ctx.now() < (job.declaredAtMs ?? 0) + CONSENT_GROUP_SWEEP_DELAY_MS) return { job, idle: true }
    return { job: await nextStep(ctx, job.orgId, jobRef, job, owner), idle: false }
  }
  const unit = unitsOf(job).find((candidate) => !job.units[candidate.key]?.done)
  if (!unit) return { job: await nextStep(ctx, job.orgId, jobRef, job, owner), idle: false }
  return { job: await runUnit(ctx, jobRef, job, owner, unit, deadlineMs), idle: false }
}

/** Claims the lease, or answers why not. `null` for a job that does not exist. */
async function claim(
  ctx: Context,
  jobRef: FirebaseFirestore.DocumentReference,
  owner: string,
): Promise<{ job: ConsentGroupChangeJob; mine: boolean } | null> {
  return ctx.firestore.runTransaction(async (transaction) => {
    const job = jobFrom(await transaction.get(jobRef))
    if (!job) return null
    const nowMs = ctx.now()
    if (job.status !== 'running') return { job, mine: false }
    if (job.lease && job.lease.untilMs > nowMs && job.lease.owner !== owner) return { job, mine: false }
    const lease = { owner, untilMs: nowMs + CONSENT_GROUP_CHANGE_LEASE_MS }
    transaction.update(jobRef, { lease })
    return { job: { ...job, lease }, mine: true }
  })
}

async function release(
  ctx: Context,
  jobRef: FirebaseFirestore.DocumentReference,
  owner: string,
): Promise<ConsentGroupChangeJob | null> {
  return ctx.firestore.runTransaction(async (transaction) => {
    const job = jobFrom(await transaction.get(jobRef))
    if (!job) return null
    if (job.lease?.owner !== owner) return job
    transaction.update(jobRef, { lease: null })
    return { ...job, lease: null }
  })
}

/** Counts a failed unit against the job, and says so once when it stalls. */
async function recordFailure(
  ctx: Context,
  jobRef: FirebaseFirestore.DocumentReference,
  owner: string,
  error: unknown,
): Promise<ConsentGroupChangeJob | null> {
  const lastError = sanitizeError(error)
  const outcome = await ctx.firestore.runTransaction(async (transaction) => {
    const job = jobFrom(await transaction.get(jobRef))
    if (!job) return null
    if (job.lease?.owner !== owner) return { job, newlyStalled: false }
    const failures = (job.failures ?? 0) + 1
    const stalled = failures >= CONSENT_GROUP_CHANGE_STALL_AFTER
    const fields = { failures, stalled, lastError, lease: null }
    transaction.update(jobRef, { ...fields, updatedAt: FieldValue.serverTimestamp() })
    return { job: { ...job, ...fields }, newlyStalled: stalled && !job.stalled }
  })
  if (!outcome) return null
  if (outcome.newlyStalled) {
    await ctx.log(
      outcome.job.orgId,
      outcome.job.actor,
      'A consent group change stopped with an error; it will try again',
      { type: 'org', id: outcome.job.orgId },
    )
  }
  console.error(`[consent-group-change] a unit of ${outcome.job.changeId} failed: ${lastError}`)
  return outcome.job
}

/**
 * Advances a change until it finishes, waits for its sweep, or reaches
 * `deadlineMs`. Answers the job's status either way — including when another
 * caller holds it, which is not a failure.
 */
export async function advanceConsentGroupChange(
  input: {
    orgId: string
    changeId: string
    deadlineMs: number
    /** Who holds the lease; one per invocation. */
    owner?: string
  } & ConsentGroupChangeContext,
): Promise<{ ok: true; status: ConsentGroupChangeStatusBody } | ConsentGroupChangeRefusal> {
  const ctx = contextOf(input)
  const jobRef = jobDoc(ctx, input.orgId, input.changeId)
  const owner = input.owner ?? `advance:${createResourceUid()}`
  const claimed = await claim(ctx, jobRef, owner)
  if (!claimed) return NOT_FOUND
  let job = claimed.job
  if (!claimed.mine) return { ok: true, status: consentGroupChangeStatus(job, ctx.now()) }
  try {
    while (job.status === 'running' && ctx.now() < input.deadlineMs - DEADLINE_SAFETY_MS) {
      const outcome = await advanceOnce(ctx, jobRef, job, owner, input.deadlineMs)
      job = outcome.job
      if (outcome.idle) break
    }
  } catch (error) {
    if (!(error instanceof LeaseLost)) {
      job = (await recordFailure(ctx, jobRef, owner, error)) ?? job
      return { ok: true, status: consentGroupChangeStatus(job, ctx.now()) }
    }
    job = jobFrom(await jobRef.get()) ?? job
    return { ok: true, status: consentGroupChangeStatus(job, ctx.now()) }
  }
  if (job.status === 'running') job = (await release(ctx, jobRef, owner)) ?? job
  return { ok: true, status: consentGroupChangeStatus(job, ctx.now()) }
}

/*==========================================
 * CANCELING AND READING
 *=========================================*/

/**
 * Stops a change before it takes effect: clears the marker and leaves every
 * refusal already carried, which only ever honors an opt-out on more sites.
 * Refused once the declaration has flipped — there is nothing left to stop
 * before, and the only way back is another change.
 */
export async function cancelConsentGroupChange(
  input: { orgId: string; changeId: string; actor: ConsentGroupChangeActor } & ConsentGroupChangeContext,
): Promise<{ ok: true; status: ConsentGroupChangeStatusBody } | ConsentGroupChangeRefusal> {
  const ctx = contextOf(input)
  const orgRef = orgDoc(ctx, input.orgId)
  const jobRef = jobDoc(ctx, input.orgId, input.changeId)
  const outcome = await ctx.firestore.runTransaction(async (transaction) => {
    const [orgSnapshot, jobSnapshot] = await Promise.all([transaction.get(orgRef), transaction.get(jobRef)])
    const job = jobFrom(jobSnapshot)
    if (!job) return NOT_FOUND
    if (job.status !== 'running' || job.declaredAtMs) {
      return {
        ok: false as const,
        status: 409 as const,
        body: {
          error:
            job.status === 'running' || job.status === 'done'
              ? 'This change has already taken effect'
              : 'This change is no longer running',
          changeId: job.changeId,
          phase: job.phase,
        },
      }
    }
    const marker = readConsentGroupsChange(orgSnapshot.data())
    if (marker?.changeId === job.changeId) {
      transaction.update(orgRef, {
        [CONSENT_GROUPS_CHANGE_FIELD]: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    const fields = {
      status: 'canceled' as const,
      phase: 'canceled' as const,
      canceledAtMs: ctx.now(),
      lease: null,
    }
    transaction.update(jobRef, { ...fields, updatedAt: FieldValue.serverTimestamp() })
    return { ok: true as const, job: { ...job, ...fields } }
  })
  if (isRefusal(outcome)) return outcome
  const { job } = outcome as { job: ConsentGroupChangeJob }
  await ctx.log(
    input.orgId,
    { uid: input.actor.uid ?? null, email: input.actor.email ?? null },
    'Canceled a consent group change before it took effect',
    { type: 'org', id: input.orgId },
  )
  return { ok: true, status: consentGroupChangeStatus(job, ctx.now()) }
}

/** A job's status, or `null` for a change the org never had. */
export async function readConsentGroupChangeStatus(
  input: { orgId: string; changeId: string } & ConsentGroupChangeContext,
): Promise<ConsentGroupChangeStatusBody | null> {
  const ctx = contextOf(input)
  const job = jobFrom(await jobDoc(ctx, input.orgId, input.changeId).get())
  return job ? consentGroupChangeStatus(job, ctx.now()) : null
}

/*==========================================
 * THE CRON BACKSTOP
 *=========================================*/

export interface DueConsentGroupChangeReport {
  orgId: string
  changeId: string
  phase: ConsentGroupsChangePhase
  /** What happened on this run. */
  outcome: 'advanced' | 'listed' | 'locked' | 'orphaned' | 'skipped'
  status?: ConsentGroupChangeStatusBody
  error?: string
}

/**
 * Advances every change in flight, oldest org id first, until `deadlineMs`.
 *
 * A change nobody is watching still finishes: the progress panel is a
 * convenience, and this is the guarantee. A lockdown on the org — or on the
 * member who started the change — pauses it, like every other write the
 * workspace makes. A marker whose job document is gone is a change nothing
 * can finish, and is cleared rather than blocking every change after it.
 */
export async function advanceDueConsentGroupChanges(
  input: { deadlineMs: number; dryRun?: boolean; limit?: number } & ConsentGroupChangeContext,
): Promise<DueConsentGroupChangeReport[]> {
  const ctx = contextOf(input)
  const snapshot = await ctx.firestore
    .collection('orgs')
    .where(`${CONSENT_GROUPS_CHANGE_FIELD}.phase`, 'in', [...RUNNING_PHASES])
    .limit(input.limit ?? 50)
    .get()
  const reports: DueConsentGroupChangeReport[] = []
  for (const org of snapshot.docs) {
    const data = org.data() as Record<string, unknown>
    const marker = readConsentGroupsChange(data)
    if (!marker) continue
    const base = { orgId: org.id, changeId: marker.changeId, phase: marker.phase }
    if (input.dryRun) {
      reports.push({ ...base, outcome: 'listed' })
      continue
    }
    if (ctx.now() >= input.deadlineMs - DEADLINE_SAFETY_MS) {
      reports.push({ ...base, outcome: 'skipped' })
      continue
    }
    try {
      const job = jobFrom(await jobDoc(ctx, org.id, marker.changeId).get())
      if (!job) {
        await orgDoc(ctx, org.id).update({ [CONSENT_GROUPS_CHANGE_FIELD]: FieldValue.delete() })
        console.error(`[consent-group-change] cleared a marker with no job in org ${org.id}`)
        reports.push({ ...base, outcome: 'orphaned' })
        continue
      }
      if (await ctx.lockedOut(data, job.actor?.uid ?? null)) {
        reports.push({ ...base, outcome: 'locked' })
        continue
      }
      const advanced = await advanceConsentGroupChange({
        orgId: org.id,
        changeId: marker.changeId,
        deadlineMs: input.deadlineMs,
        owner: `cron:${createResourceUid()}`,
        firestore: ctx.firestore,
        log: ctx.log,
        now: ctx.now,
      })
      reports.push({
        ...base,
        outcome: 'advanced',
        ...(advanced.ok ? { status: (advanced as { status: ConsentGroupChangeStatusBody }).status } : {}),
      })
    } catch (error) {
      reports.push({ ...base, outcome: 'advanced', error: sanitizeError(error) })
    }
  }
  return reports
}
