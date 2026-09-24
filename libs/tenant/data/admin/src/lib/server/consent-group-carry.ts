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
 * CARRYING A SITE'S REFUSALS ONTO A SITE THAT IS ABOUT TO STOP READING THEM
 * (AGL-3320).
 *
 * Three per-site stores are read across the CURRENT consent group by every
 * send path (`email-suppression.ts`, `email-marketing-gate.ts`), so a site
 * leaving a group stops seeing its former siblings' — and they stop seeing
 * its. Before the declaration flips, each carry `(to ← from)` of the plan
 * copies `from`'s refusals onto `to`:
 *
 *  - **C1, the suppression list** (`hosts/{h}/suppressions/{key}`). A row
 *    `to` does not have is CREATED with `from`'s fields and provenance; a row
 *    `to` has is never touched. `reason` is kept, so only an unsubscribe stays
 *    liftable by the preference page's resubscribe, and a group-wide
 *    resubscribe lifts a carried row like an original.
 *  - **C2, the topic opt-outs** (`hosts/{h}/topicOptOuts/{key}`). Every
 *    stream `from` has LEFT, and `to` has not, becomes an opt-out on `to`
 *    dated when the person left `from`. `to`'s other entries — its own
 *    confirmations, its own opt-outs — are kept as they are.
 *  - **C3, the pace** (`hosts/{h}/emailFrequency/{key}`). The choice made
 *    most recently wins, as `groupPace` reads it within a group, and a site
 *    keeping a slower pace learns when `from` last mailed the person, so the
 *    separation cannot loosen the pace they asked for. The send counters are
 *    never touched.
 *
 * ## One page per call, and every page idempotent
 *
 * The executor calls this until it answers `done`, handing back the cursor.
 * A page reads `from`'s documents in id order and `to`'s matching documents
 * in one `getAll`, and writes only what `to` lacks — so a page re-run after a
 * crash, a catch-up pass and the sweep all write nothing that was already
 * carried. A write that raced another writer (a `lastUpdateTime` precondition
 * or a create that found the document) is re-read and decided again once;
 * failing twice throws, and the executor retries the page.
 *
 * `sinceMs` narrows a page to what changed since then — the catch-up, which
 * reads by `suppressedAt`, `updatedAt` and `cadenceSetAtMs`. A row written
 * without one of those is left to the sweep's full pass.
 */

import {
  readTopicSubscriptionState,
  TOPIC_OPT_OUTS_SUBCOLLECTION,
  type TopicSubscriptionEntry,
} from '@aglyn/aglyn/app-utils/email-topics'
import type { ConsentGroupCarry } from '@aglyn/aglyn/app-utils/consent-group-change'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { EMAIL_FREQUENCY_SUBCOLLECTION } from './email-marketing-gate'
import { HOST_SUPPRESSIONS_SUBCOLLECTION } from './email-suppression'

/** The three stores a carry copies, as the job counts them. */
export type ConsentGroupCarryStore = 'siteSuppressions' | 'topicOptOuts' | 'paces'

export const CONSENT_GROUP_CARRY_STORES: readonly ConsentGroupCarryStore[] = [
  'siteSuppressions',
  'topicOptOuts',
  'paces',
]

/** Each store's subcollection under `hosts/{hostId}`. */
export const CONSENT_GROUP_CARRY_SUBCOLLECTIONS: Readonly<Record<ConsentGroupCarryStore, string>> = {
  siteSuppressions: HOST_SUPPRESSIONS_SUBCOLLECTION,
  topicOptOuts: TOPIC_OPT_OUTS_SUBCOLLECTION,
  paces: EMAIL_FREQUENCY_SUBCOLLECTION,
}

/** The field a catch-up reads each store by, and whether it is a timestamp. */
const CATCH_UP_FIELDS: Readonly<Record<ConsentGroupCarryStore, { field: string; timestamp: boolean }>> = {
  siteSuppressions: { field: 'suppressedAt', timestamp: true },
  topicOptOuts: { field: 'updatedAt', timestamp: true },
  paces: { field: 'cadenceSetAtMs', timestamp: false },
}

/**
 * The suppression row's fields a carry copies. Everything else a row could
 * carry is either the carry's own provenance or not a fact about the refusal.
 */
const SUPPRESSION_ROW_FIELDS = [
  'reason',
  'email',
  'createdAt',
  'suppressedAt',
  'note',
  'suppressedByUid',
  'campaignId',
  'topicId',
] as const

/** Documents one page reads from the source site. */
export const CONSENT_GROUP_CARRY_PAGE = 300

export interface ConsentGroupCarryPage {
  /** The source site has nothing after the cursor. */
  done: boolean
  /** Where the next page starts, or `null` once `done`. */
  cursor: string | null
  /** Source documents read. */
  read: number
  /** Documents written on the receiving site (counted, not written, on a dry run). */
  written: number
}

export interface CarryConsentGroupRefusalsOptions {
  firestore: FirebaseFirestore.Firestore
  store: ConsentGroupCarryStore
  carry: ConsentGroupCarry
  changeId: string
  cursor: string | null
  /** Only documents changed at or after this instant — the catch-up. */
  sinceMs?: number | null
  pageSize?: number
  dryRun?: boolean
}

interface Cursor {
  id: string
  /** The catch-up field's value on the last document read. */
  at?: { seconds: number; nanoseconds: number } | number
}

function readCursor(raw: string | null): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Cursor
    return typeof parsed?.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** The error codes that mean "somebody wrote this document since I read it". */
const RACED = new Set([5, 6, 9])
const codeOf = (error: unknown): number | undefined => (error as { code?: number } | null)?.code

/** Milliseconds from a stored number or timestamp, or `null`. */
function storedMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const toMillis = (value as { toMillis?: () => number } | null)?.toMillis
  return typeof toMillis === 'function' ? toMillis.call(value) : null
}

/**
 * When the site last mailed the person, as the gate reads it: the stored
 * instant, or the newest entry of a window written before it existed.
 */
function lastSentMs(data: Record<string, unknown> | undefined): number | null {
  if (!data) return null
  const stored = Number(data['lastSentAtMs'])
  if (Number.isFinite(stored) && stored > 0) return stored
  const window = Array.isArray(data['sentAtMs'])
    ? (data['sentAtMs'] as unknown[]).map(Number).filter(Number.isFinite)
    : []
  return window.length ? Math.max(...window) : null
}

/**
 * What `to` must become for one source document, or `null` when it already
 * honors everything `from` does. `create` says the document is new.
 */
type Decision = { create: boolean; data: Record<string, unknown> } | null

function decideSuppression(
  source: FirebaseFirestore.DocumentSnapshot,
  target: FirebaseFirestore.DocumentSnapshot,
  carry: ConsentGroupCarry,
  changeId: string,
): Decision {
  if (target.exists) return null
  const row = source.data() ?? {}
  const data: Record<string, unknown> = {}
  for (const field of SUPPRESSION_ROW_FIELDS) {
    if (field in row) data[field] = row[field]
  }
  data['carriedFromHostId'] = carry.fromHostId
  data['carriedByChangeId'] = changeId
  data['carriedAt'] = FieldValue.serverTimestamp()
  return { create: true, data }
}

function decideTopics(
  source: FirebaseFirestore.DocumentSnapshot,
  target: FirebaseFirestore.DocumentSnapshot,
  carry: ConsentGroupCarry,
): Decision {
  const sourceTopics = (source.get('topics') ?? {}) as Record<string, TopicSubscriptionEntry>
  const targetTopics = ((target.exists ? target.get('topics') : null) ?? {}) as Record<
    string,
    TopicSubscriptionEntry & Record<string, unknown>
  >
  const next: Record<string, unknown> = { ...targetTopics }
  let changed = false
  for (const [topicId, entry] of Object.entries(sourceTopics)) {
    if (readTopicSubscriptionState(entry) !== 'opted-out') continue
    if (readTopicSubscriptionState(targetTopics[topicId]) === 'opted-out') continue
    next[topicId] = {
      ...(targetTopics[topicId] ?? {}),
      optedOutAt: entry.optedOutAt,
      resubscribedAt: null,
      carriedFromHostId: carry.fromHostId,
    }
    changed = true
  }
  if (!changed) return null
  const email = (target.exists ? target.get('email') : null) ?? source.get('email') ?? null
  return {
    create: !target.exists,
    data: {
      email,
      topics: next,
      updatedAt: FieldValue.serverTimestamp(),
      ...(target.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
  }
}

function decidePace(
  source: FirebaseFirestore.DocumentSnapshot,
  target: FirebaseFirestore.DocumentSnapshot,
  carry: ConsentGroupCarry,
): Decision {
  const from = source.data() ?? {}
  const to = target.exists ? (target.data() ?? {}) : undefined
  const patch: Record<string, unknown> = {}
  const sourceChoice = from['cadence']
  const targetChoice = to?.['cadence']
  const sourceSetAt = Number(from['cadenceSetAtMs'])
  const targetSetAt = Number(to?.['cadenceSetAtMs'])
  const carried =
    sourceChoice != null &&
    (targetChoice == null ||
      (Number.isFinite(targetSetAt) ? targetSetAt : 0) <
        (Number.isFinite(sourceSetAt) ? sourceSetAt : 0))
  if (carried) {
    patch['cadence'] = sourceChoice
    if (Number.isFinite(sourceSetAt)) patch['cadenceSetAtMs'] = sourceSetAt
    patch['cadenceCarriedFromHostId'] = carry.fromHostId
  }
  // The pace in force afterwards decides whether the last send matters: `all`
  // sends as they come and never asks when the last one went.
  const choice = carried ? sourceChoice : targetChoice
  if (choice != null && choice !== 'all') {
    const sourceLast = lastSentMs(from)
    const targetLast = lastSentMs(to)
    if (sourceLast !== null && (targetLast === null || sourceLast > targetLast)) {
      patch['lastSentAtMs'] = sourceLast
    }
  }
  if (!Object.keys(patch).length) return null
  return {
    create: !target.exists,
    data: target.exists ? patch : { email: from['email'] ?? null, ...patch },
  }
}

function decide(
  store: ConsentGroupCarryStore,
  source: FirebaseFirestore.DocumentSnapshot,
  target: FirebaseFirestore.DocumentSnapshot,
  carry: ConsentGroupCarry,
  changeId: string,
): Decision {
  if (store === 'siteSuppressions') return decideSuppression(source, target, carry, changeId)
  if (store === 'topicOptOuts') return decideTopics(source, target, carry)
  return decidePace(source, target, carry)
}

/**
 * One page of one store of one carry. See the module note for what each
 * store copies and why a re-run writes nothing.
 */
export async function carryConsentGroupRefusals(
  options: CarryConsentGroupRefusalsOptions,
): Promise<ConsentGroupCarryPage> {
  const { firestore, store, carry, changeId } = options
  const subcollection = CONSENT_GROUP_CARRY_SUBCOLLECTIONS[store]
  const sourceList = firestore.collection('hosts').doc(carry.fromHostId).collection(subcollection)
  const targetList = firestore.collection('hosts').doc(carry.toHostId).collection(subcollection)
  const limit = options.pageSize ?? CONSENT_GROUP_CARRY_PAGE
  const cursor = readCursor(options.cursor)
  const catchUp = CATCH_UP_FIELDS[store]
  const since = options.sinceMs ?? null

  let query: FirebaseFirestore.Query = sourceList
  if (since !== null) {
    query = query
      .where(catchUp.field, '>=', catchUp.timestamp ? Timestamp.fromMillis(since) : since)
      .orderBy(catchUp.field)
      .orderBy(FieldPath.documentId())
    if (cursor && cursor.at !== undefined) {
      const at =
        typeof cursor.at === 'number' ? cursor.at : new Timestamp(cursor.at.seconds, cursor.at.nanoseconds)
      query = query.startAfter(at, cursor.id)
    }
  } else {
    query = query.orderBy(FieldPath.documentId())
    if (cursor) query = query.startAfter(cursor.id)
  }
  const page = await query.limit(limit).get()
  if (page.empty) return { done: true, cursor: null, read: 0, written: 0 }

  const targets = await firestore.getAll(...page.docs.map((doc) => targetList.doc(doc.id)))
  const decisions = page.docs.map((source, index) => ({
    source,
    target: targets[index],
    decision: decide(store, source, targets[index], carry, changeId),
  }))
  const due = decisions.filter((entry) => entry.decision !== null)
  const written = options.dryRun
    ? due.length
    : await writeDecisions(firestore, targetList, store, carry, changeId, due)

  const last = page.docs[page.docs.length - 1]
  const next: Cursor = { id: last.id }
  if (since !== null) {
    const value = last.get(catchUp.field)
    next.at =
      value instanceof Timestamp
        ? { seconds: value.seconds, nanoseconds: value.nanoseconds }
        : (storedMs(value) ?? 0)
  }
  const done = page.size < limit
  return { done, cursor: done ? null : JSON.stringify(next), read: page.size, written }
}

/**
 * Writes one page's decisions through a `BulkWriter`, each guarded against
 * the document having moved since it was read, and decides the ones that
 * raced once more from a fresh read.
 */
async function writeDecisions(
  firestore: FirebaseFirestore.Firestore,
  targetList: FirebaseFirestore.CollectionReference,
  store: ConsentGroupCarryStore,
  carry: ConsentGroupCarry,
  changeId: string,
  due: Array<{
    source: FirebaseFirestore.DocumentSnapshot
    target: FirebaseFirestore.DocumentSnapshot
    decision: Decision
  }>,
): Promise<number> {
  let written = 0
  for (let round = 0; round < 2 && due.length; round += 1) {
    const writer = firestore.bulkWriter()
    const outcomes = due.map(({ source, target, decision }) => {
      const ref = targetList.doc(source.id)
      const write = (decision as NonNullable<Decision>).create
        ? writer.create(ref, (decision as NonNullable<Decision>).data)
        : writer.update(ref, (decision as NonNullable<Decision>).data, {
            lastUpdateTime: target.updateTime as FirebaseFirestore.Timestamp,
          })
      return write.then(
        () => ({ source, error: null as unknown }),
        (error: unknown) => ({ source, error: error ?? new Error('The write failed') }),
      )
    })
    await writer.close()
    const settled = await Promise.all(outcomes)
    const retry: FirebaseFirestore.DocumentSnapshot[] = []
    for (const { source, error } of settled) {
      if (error === null) {
        written += 1
        continue
      }
      const code = codeOf(error)
      if (code === undefined || !RACED.has(code)) throw error
      // The row a suppression carry would create exists now: `to` has its own.
      if (store === 'siteSuppressions' && code === 6) continue
      retry.push(source)
    }
    if (!retry.length) return written
    const fresh = await firestore.getAll(...retry.map((source) => targetList.doc(source.id)))
    due = retry
      .map((source, index) => ({
        source,
        target: fresh[index],
        decision: decide(store, source, fresh[index], carry, changeId),
      }))
      .filter((entry) => entry.decision !== null)
  }
  if (due.length) {
    throw new Error(
      `[consent-group-carry] ${due.length} document(s) on ${carry.toHostId} kept changing under the carry`,
    )
  }
  return written
}
