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
 * THE FREE-WORKSPACE CEILING (AGL-2265).
 *
 * Every free cap in the product is enforced PER ORG, and nothing bounded how
 * many orgs one account could hold — so the free allowance multiplied by
 * workspaces: N orgs = N sites, N × 250 MB media, N × 5 GB bandwidth, N × 10
 * Assist messages a day. `/api/orgs/create` is rate limited per uid and per IP
 * (AGL-1534), which bounds the RATE and not the TOTAL.
 *
 * the decision, 2026-08-19: **three, with a control in the staff console.**
 * Three is the number; the number living in a Firestore document rather than a
 * constant is the other half of the decision, because the population this
 * refuses (a script minting workspaces) and the population it must not refuse
 * (an agency, a consultant, a customer support raises) are told apart by a
 * human, and a human must not need a deploy to say yes.
 *
 * ## What counts
 *
 * A FREE workspace ATTRIBUTED to the account. Three properties, each of which
 * is a bug if it is wrong:
 *
 *  - **Paid workspaces do not count.** An agency's workspaces are paid, and
 *    the abuse this closes is free-allowance multiplication. `plan` is read
 *    through `resolveEffectivePlan`, so a workspace whose subscription died
 *    counts again — correctly: it is free again.
 *  - **Being INVITED to someone else's workspace never counts.** The count
 *    comes off `orgs`, keyed by ownership and creation. It never reads
 *    `users/{uid}/orgs`, which is a membership index — a contractor added to
 *    ten client workspaces owns none of them.
 *  - **Handing a workspace away does not free a slot.** See below; this is
 *    the whole difficulty.
 *
 * ## Why the count is not launderable
 *
 * A create-time quota computed from a number the applicant can lower is not a
 * quota. The cheap laundering sequence here is not deletion — deleting a
 * workspace really does give up the workspace — it is **ownership transfer**,
 * which is free, instant and reversible:
 *
 *     hold 3 → transfer #3 to an alt account → count reads 2 → create a 4th
 *     → transfer #3 back → hold 4, having never been refused.
 *
 * So the count is the UNION of two sets: workspaces the account owns NOW
 * (`ownerUid`) and workspaces the account CREATED (`createdByUid`).
 * `createdByUid` is stamped once, inside the creating transaction, and no code
 * path anywhere mutates it — `transferOrgOwnership` moves `ownerUid` and does
 * not touch it. Transferring away therefore changes nothing about the count,
 * and the sequence above is refused at the fourth workspace exactly as it
 * would have been without the detour. Erasing a workspace removes the org
 * document from both sets, which is the one decrement that is honest: the
 * allowance it was multiplying went with it.
 *
 * (Orgs created before this shipped carry no `createdByUid`. They are counted
 * by `ownerUid` like always, so the union is never smaller than the old
 * behaviour; it only stops shrinking under a transfer.)
 *
 * ## Why the decision is atomic
 *
 * The count is read INSIDE the org-creation transaction, and the transaction
 * also reads-and-writes a per-owner marker document. Without that marker, two
 * `/api/orgs/create` requests in flight together would both observe three,
 * both find headroom and both commit a fourth and a fifth: the new org
 * documents are not in either transaction's read set, so nothing would make
 * them contend. The marker is a document they DO both read and both write, so
 * the second commit aborts, the callback re-runs, its queries re-read at the
 * new read time, they now see the org the first request committed, and it is
 * refused. That is the AGL-2267 lesson — a read-then-write quota must contend
 * on something.
 *
 * ## Storage, and why it needs no rules or index deploy
 *
 * The ceiling lives at `rateLimits/freeWorkspaceCapConfig` and the per-owner
 * marker at `rateLimits/freeWorkspaces_{uid}`, the same collection AGL-794's
 * counters and AGL-2409's send-rate ramp already use, and for the same
 * reason: it inherits the deny-all security rule and the `expiresAt` TTL
 * policy that already exist. Deny-all matters here — no client, staff
 * included, may write the ceiling; the audited console route is the only
 * writer.
 *
 * The config document **must never carry `expiresAt`**, or the TTL policy that
 * serves the counters would delete the ceiling and the platform would silently
 * revert to the compiled-in default. The marker document carries one on
 * purpose: it is disposable, its only job is contention, and a swept marker
 * costs nothing because the queries are the authority for the number.
 *
 * ## Failure posture: the DEFAULT, which is neither open nor closed
 *
 * An unreadable configuration resolves to the compiled-in 3 and reports
 * `ready: false`. Not zero — a Firestore blip must not refuse every signup on
 * the platform. Not unlimited — a Firestore blip must not be the way through
 * the control. `checkQuota(undefined)` resolving to the free tier is a bug
 * this codebase has already had; `freeWorkspaceCapVerdict` therefore takes
 * `ready` as an explicit input and a not-yet-loaded limit is never read as a
 * number.
 */

import { resolveEffectivePlan } from '@aglyn/aglyn/server'
import { firebaseAdmin } from './firebase-admin'
import { RATE_LIMIT_COLLECTION } from './rate-limit-store'

/** the number, 2026-08-19. The floor the console can move off. */
export const DEFAULT_FREE_WORKSPACE_CAP = 3

/** Document id of the live ceiling. NEVER written with `expiresAt`. */
export const FREE_WORKSPACE_CAP_CONFIG_DOC = 'freeWorkspaceCapConfig'

/** Id prefix for the per-owner contention markers. */
export const FREE_WORKSPACE_MARKER_PREFIX = 'freeWorkspaces_'

/** Bounds the console will accept. One is a real answer; zero is not. */
export const FREE_WORKSPACE_CAP_MIN = 1
export const FREE_WORKSPACE_CAP_MAX = 500

/** Longest audited note the console may attach to a change. */
export const FREE_WORKSPACE_CAP_NOTE_MAX = 280

/**
 * How many of an owner's org documents the count will read.
 *
 * The count filters by plan in memory (`plan` is not a queryable predicate
 * that survives `resolveEffectivePlan`'s subscription check), so the query
 * cannot be bounded at the ceiling. An account holding more orgs than this is
 * far past any ceiling staff would set and is a support conversation, not a
 * create-time decision.
 */
export const FREE_WORKSPACE_SCAN_LIMIT = 250

/** How long a contention marker survives. Disposable — see the notes above. */
export const FREE_WORKSPACE_MARKER_TTL_MS = 24 * 60 * 60 * 1000

export interface FreeWorkspaceCapConfig {
  /** Free workspaces one account may hold. */
  limit: number
  /** False turns the ceiling OFF entirely (staff kill switch). */
  enabled: boolean
  /** Why it is where it is — shown on the card, written to the audit row. */
  note: string
  updatedAtMs: number | null
  updatedByEmail: string | null
  /**
   * Whether this is a value that was actually READ, or the compiled-in
   * default standing in for one that could not be.
   *
   * Exposed rather than swallowed because a loading default answering a
   * question as though it were a real value is a bug shape this codebase has
   * shipped before. Callers that must not act on a guess check this; the
   * verdict function below treats it as the difference between "the operator
   * chose unlimited" and "we do not know yet", and the second is never
   * unlimited.
   */
  ready: boolean
}

/** The marker document id for one owner. */
export function freeWorkspaceMarkerDocId(uid: string): string {
  return `${FREE_WORKSPACE_MARKER_PREFIX}${uid}`
}

/**
 * Coerces whatever is stored (or nothing) into a usable ceiling.
 *
 * A missing, non-numeric, zero, negative or absurd `limit` becomes the
 * compiled-in default rather than zero. Storing a broken number must not be a
 * way to refuse every signup, and it must not be a way to admit everyone
 * either — both are the same mistake with opposite signs.
 */
export function normalizeFreeWorkspaceCapConfig(
  data: Partial<FreeWorkspaceCapConfig> | null | undefined,
  options?: { ready?: boolean },
): FreeWorkspaceCapConfig {
  const rawLimit = Number(data?.limit)
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= FREE_WORKSPACE_CAP_MIN
      ? Math.min(FREE_WORKSPACE_CAP_MAX, Math.floor(rawLimit))
      : DEFAULT_FREE_WORKSPACE_CAP
  const updatedAtMs = Number(data?.updatedAtMs)
  return {
    limit,
    // Only an explicit `false` turns it off — an absent field is ON, so a
    // half-written document cannot silently disable the ceiling.
    enabled: data?.enabled !== false,
    note: typeof data?.note === 'string' ? data.note.slice(0, FREE_WORKSPACE_CAP_NOTE_MAX) : '',
    updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : null,
    updatedByEmail:
      typeof data?.updatedByEmail === 'string' && data.updatedByEmail
        ? data.updatedByEmail
        : null,
    ready: options?.ready !== false,
  }
}

export interface FreeWorkspaceCapVerdict {
  allowed: boolean
  /** The ceiling the decision was actually made against. */
  limit: number
  held: number
  remaining: number
  /** False when the ceiling was a stand-in rather than a value we read. */
  ready: boolean
  /** True when the ceiling is switched off and this granted for that reason. */
  disabled: boolean
}

/**
 * The whole decision, pure.
 *
 * The `ready` input is the point of the signature. A config that has not
 * loaded arrives here as `{ ready: false }` and is answered against the
 * compiled-in default — never as `limit: 0` (which would refuse every signup
 * on the platform during a blip) and never as "no limit known, therefore no
 * limit" (which would make an outage the way through the control).
 */
export function freeWorkspaceCapVerdict(input: {
  held: number
  limit?: number | null
  enabled?: boolean
  ready?: boolean
}): FreeWorkspaceCapVerdict {
  const ready = input.ready !== false
  const rawHeld = Number(input.held)
  const held = Number.isFinite(rawHeld) && rawHeld > 0 ? Math.floor(rawHeld) : 0
  const rawLimit = Number(input.limit)
  // An unready config does not get to contribute a number at all, even if one
  // happens to be sitting in the field.
  const limit =
    ready && Number.isFinite(rawLimit) && rawLimit >= FREE_WORKSPACE_CAP_MIN
      ? Math.min(FREE_WORKSPACE_CAP_MAX, Math.floor(rawLimit))
      : DEFAULT_FREE_WORKSPACE_CAP
  const disabled = input.enabled === false
  return {
    allowed: disabled || held < limit,
    limit,
    held,
    remaining: Math.max(0, limit - held),
    ready,
    disabled,
  }
}

/**
 * Whether an org document is on the free plan for the purposes of this count.
 *
 * `resolveEffectivePlan` and not `data.plan`: a workspace whose subscription
 * is canceled or unpaid resolves back to free, which is right — it is
 * consuming the free allowance again, so it counts again.
 */
export function isFreeOrgDoc(data: unknown): boolean {
  return resolveEffectivePlan((data ?? {}) as never) === 'free'
}

/**
 * The two queries whose UNION is the attributed set. Exported so the spec can
 * assert the second one exists — the union IS the anti-laundering property,
 * and a future edit that drops `createdByUid` for being redundant would put
 * the transfer sequence back without changing any behaviour a happy-path test
 * observes.
 */
export function freeWorkspaceOwnerQueries(firestore: any, uid: string): any[] {
  const orgs = firestore.collection('orgs')
  return [
    orgs.where('ownerUid', '==', uid).limit(FREE_WORKSPACE_SCAN_LIMIT),
    orgs.where('createdByUid', '==', uid).limit(FREE_WORKSPACE_SCAN_LIMIT),
  ]
}

export interface FreeWorkspaceCount {
  held: number
  orgIds: string[]
}

/**
 * How many free workspaces are attributed to `uid`.
 *
 * `readQuery` is how the caller runs each query, and it is the whole
 * difference between the two callers: outside a transaction a query runs
 * itself (`query.get()`), inside one it must run through the transaction
 * (`tx.get(query)`) or the count is not in the read set and the retry that
 * makes this atomic never happens. Passing a Firestore instance and calling
 * `firestore.get(query)` would silently be neither — that method does not
 * exist, and the count would come back as zero, admitting everyone.
 */
async function countAttributedFreeWorkspaces(
  readQuery: (query: any) => Promise<any>,
  firestore: any,
  uid: string,
): Promise<FreeWorkspaceCount> {
  const seen = new Map<string, unknown>()
  for (const query of freeWorkspaceOwnerQueries(firestore, uid)) {
    const snapshot = await readQuery(query)
    for (const doc of snapshot?.docs ?? []) {
      // Deduplicated by id: the common case is one org in BOTH sets.
      if (!seen.has(doc.id)) seen.set(doc.id, doc.data())
    }
  }
  const orgIds = [...seen.entries()]
    .filter(([, data]) => isFreeOrgDoc(data))
    .map(([id]) => id)
  return { held: orgIds.length, orgIds }
}

/**
 * Read-only count, for the console and for anything that wants to explain a
 * refusal after the fact. The creation path does NOT use this — it counts
 * inside its own transaction.
 */
export async function countFreeWorkspacesForOwner(options: {
  uid: string
  firestore?: any
}): Promise<FreeWorkspaceCount> {
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  try {
    return await countAttributedFreeWorkspaces(
      (query) => query.get(),
      firestore,
      options.uid,
    )
  } catch (error) {
    console.error('[free-workspace-cap] count unavailable', error)
    return { held: 0, orgIds: [] }
  }
}

/**
 * Config cache TTL. 15s, the same number and reasoning as the lockdown doc
 * and the send-rate ramp: staff move this rarely and a warm process converges
 * within a quarter of a minute.
 */
const CONFIG_TTL_MS = 15_000

let configCache: { at: number; config: FreeWorkspaceCapConfig } | undefined
let configPending: Promise<FreeWorkspaceCapConfig> | undefined

/** Drop the in-process config cache — called by the console after a write. */
export function invalidateFreeWorkspaceCapConfigCache(): void {
  configCache = undefined
  configPending = undefined
}

/**
 * The live ceiling.
 *
 * An unreachable document returns the compiled-in default with
 * `ready: false`, which every caller must carry rather than flatten — see the
 * failure-posture note at the top of the file.
 */
export async function readFreeWorkspaceCapConfig(options?: {
  firestore?: any
  now?: number
}): Promise<FreeWorkspaceCapConfig> {
  const now = options?.now ?? Date.now()
  if (!options?.firestore && configCache && now - configCache.at < CONFIG_TTL_MS) {
    return configCache.config
  }
  const load = async (): Promise<FreeWorkspaceCapConfig> => {
    try {
      const firestore = options?.firestore ?? firebaseAdmin.app().firestore()
      const snapshot = await firestore
        .collection(RATE_LIMIT_COLLECTION)
        .doc(FREE_WORKSPACE_CAP_CONFIG_DOC)
        .get()
      // A document that does not exist is READY: nobody has changed the
      // number, and the compiled-in 3 is the answer, not a guess.
      return normalizeFreeWorkspaceCapConfig(
        snapshot?.exists
          ? (snapshot.data() as Partial<FreeWorkspaceCapConfig>)
          : null,
        { ready: true },
      )
    } catch {
      return normalizeFreeWorkspaceCapConfig(null, { ready: false })
    }
  }
  // An injected firestore is a test or a one-off read; never cached, so a
  // spec cannot poison the process cache for the next one.
  if (options?.firestore) return load()
  if (!configPending) {
    configPending = load()
      .then((config) => {
        // A degraded read is never cached — the next create should try again
        // rather than serve a stand-in for fifteen seconds.
        if (config.ready) configCache = { at: now, config }
        return config
      })
      .finally(() => {
        configPending = undefined
      })
  }
  return configPending
}

/**
 * The document the console writes when staff move the ceiling.
 *
 * Returned rather than written so the route owns the write (and the audit row
 * beside it), and so a spec can assert the SHAPE without a Firestore. The one
 * thing it must never contain is `expiresAt`.
 */
export function freeWorkspaceCapConfigWrite(input: {
  limit: number
  enabled: boolean
  actorEmail?: string | null
  note?: string
  now?: number
}): Partial<FreeWorkspaceCapConfig> {
  const normalized = normalizeFreeWorkspaceCapConfig({
    limit: input.limit,
    enabled: input.enabled,
    note: input.note,
    updatedAtMs: input.now ?? Date.now(),
    updatedByEmail: input.actorEmail ?? null,
  })
  return {
    limit: normalized.limit,
    enabled: normalized.enabled,
    note: normalized.note,
    updatedAtMs: normalized.updatedAtMs,
    updatedByEmail: normalized.updatedByEmail,
  }
}

/**
 * Thrown by `createOrganization` when the ceiling refuses. Carries the numbers
 * so the API route can say which ceiling and how many, rather than "no".
 */
export class FreeWorkspaceCapError extends Error {
  readonly limit: number
  readonly held: number
  constructor(verdict: { limit: number; held: number }) {
    super(
      `Free workspace ceiling reached: ${verdict.held} of ${verdict.limit}`,
    )
    this.name = 'FreeWorkspaceCapError'
    this.limit = verdict.limit
    this.held = verdict.held
  }
}

/**
 * The create-time gate, run INSIDE the creating transaction.
 *
 * Reads the attributed count through `tx` (so it is part of the read set and
 * re-runs against fresh data on a retry) and reads-then-writes the per-owner
 * marker (so two concurrent creates by one account contend, and the loser
 * re-runs and sees the winner's org).
 *
 * Throws `FreeWorkspaceCapError` when it refuses. Firestore does not retry a
 * callback that threw, which is what we want: a refusal is a decision, not
 * contention.
 *
 * Call it AFTER the caller's other reads and BEFORE the caller's writes — it
 * both reads and writes, and Firestore requires all reads first.
 */
export async function enforceFreeWorkspaceCapInTransaction(options: {
  tx: any
  firestore: any
  uid: string
  config: FreeWorkspaceCapConfig
  now?: number
}): Promise<FreeWorkspaceCapVerdict> {
  const { tx, firestore, uid, config } = options
  const now = options.now ?? Date.now()
  const markerRef = firestore
    .collection(RATE_LIMIT_COLLECTION)
    .doc(freeWorkspaceMarkerDocId(uid))

  const [count, marker] = await Promise.all([
    countAttributedFreeWorkspaces((query) => tx.get(query), firestore, uid),
    tx.get(markerRef),
  ])

  const verdict = freeWorkspaceCapVerdict({
    held: count.held,
    limit: config.limit,
    enabled: config.enabled,
    ready: config.ready,
  })
  if (!verdict.allowed) throw new FreeWorkspaceCapError(verdict)

  const priorCreates = Number(
    (marker?.exists ? marker.get('creates') : 0) ?? 0,
  )
  // An ABSOLUTE value derived from the read, not `FieldValue.increment`: the
  // read is what has to contend, and an increment is atomic on the number and
  // useless for the decision (AGL-2267).
  tx.set(
    markerRef,
    {
      creates: (Number.isFinite(priorCreates) ? priorCreates : 0) + 1,
      heldAtLastCreate: count.held,
      lastCreateAtMs: now,
      // Disposable. NOT on the config document — see the storage note.
      expiresAt: new Date(now + FREE_WORKSPACE_MARKER_TTL_MS),
    },
    { merge: true },
  )
  return verdict
}

/**
 * Turn a ceiling refusal into the 403 the creating routes return, or null when
 * the error is something else and must keep propagating to the 500.
 *
 * Lives here beside the policy, and mirrors `collaboratorSeatRefusalResponse`,
 * so a route's catch block is one line and cannot accidentally mask a real
 * fault. The copy names the number and the way out, because the person reading
 * it is far more often a consultant with three real workspaces than the script
 * this exists to stop.
 */
export function freeWorkspaceCapRefusalResponse(error: unknown): Response | null {
  if (!(error instanceof FreeWorkspaceCapError)) return null
  return Response.json(
    {
      error:
        `You already have ${error.held} free workspaces, which is the limit ` +
        `of ${error.limit}. Upgrade one of them, delete one you no longer ` +
        'need, or contact support and we can raise the limit for your account.',
      code: 'free_workspace_limit',
      limit: error.limit,
      held: error.held,
    },
    { status: 403 },
  )
}
