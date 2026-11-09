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
 * KEEPING "ALL SITES EXCEPT…" TRUE AS SITES COME AND GO (AGL-4047).
 *
 * A document shared this way names its included sites in `visibleTo`, the one
 * field readers enforce. A new site therefore has to be added to it, and a
 * site that left has to come off it. {@link sweepScopeSharingAfterSiteChange}
 * does that after every change to `orgs/{orgId}.hosts`: a site created, moved
 * in or out, or erased.
 *
 * ## What it costs when nothing is marked
 *
 * One query per declared collection, each answering nothing, and not one
 * write. Every workspace pays that on a site change and nothing more, which
 * is why a sweep document is only written once a marked document turns up.
 *
 * ## Each document in its own transaction, reading the org document
 *
 * The transaction reads `orgs/{orgId}` as well as the document, so what it
 * writes is computed from the sites that are true at commit. A site claimed
 * while the sweep runs either serializes before it (and the sweep sees the
 * site) or after it (and the sweep that claim starts sees the document).
 *
 * ## Inline for a few seconds, then the job
 *
 * The caller is a person creating or deleting a site, so a trigger works for
 * {@link INLINE_BUDGET_MS} and leaves the rest to the job, from a cursor in
 * `orgs/{orgId}/scopeSweeps/{sweepId}`. That document exists only while work
 * is left, so the job's query answers nothing on a quiet beat. No rule opens
 * the path: only this server code reads or writes it.
 *
 * Every step is idempotent. A second sweep, or a resumed one going over a
 * document again, reads `current` and writes nothing.
 */

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  reconcileAllExcept,
  SCOPE_MODE_ALL_EXCEPT,
  type ScopeSharingFields,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import { runPluginDeclarationsRepair } from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
import {
  listScopeSharingCollections,
  listScopeSharingSiteChangeHooks,
  type ResolvedScopeSharingCollection,
  scopeSharingPatchFor,
} from '@aglyn/aglyn/plugin-manager/plugin-scope-sharing'
import {
  type CollectionReference,
  type DocumentReference,
  FieldPath,
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

/** Where a sweep with work left records its cursor. */
export const SCOPE_SWEEPS_COLLECTION = 'scopeSweeps'
/** Marked documents read at a time in one collection. */
const PAGE_SIZE = 100
/** Transactions running at once. */
const CONCURRENCY = 8
/** How long a person's site change waits for the sweep. */
export const INLINE_BUDGET_MS = 3_000
/** How long one job beat spends, across every sweep it takes. */
export const JOB_BUDGET_MS = 20_000
/** Sweeps one beat reads. */
const SWEEPS_PER_BEAT = 10
/** Beats a failing sweep gets. The weekly drift report still counts its documents. */
export const MAX_SWEEP_ATTEMPTS = 5

export type ScopeSweepReason = 'site-added' | 'site-removed' | 'drift-repair'

export interface ScopeSweepCounts {
  /** Marked documents read. */
  marked: number
  /** Written because they had fallen behind. */
  changed: number
  /** Past their collection's limit, and so no longer widening. */
  capped: number
  /** A marker the helper cannot act on: left alone, and reported. */
  invalid: number
  /** A transaction or patch that threw. */
  failed: number
}

export interface ScopeSweepResult extends ScopeSweepCounts {
  /** Every declared collection was walked to its end. */
  complete: boolean
  /** Where to carry on from, when `complete` is false. */
  cursor: ScopeSweepCursor | null
}

/** A position in {@link listScopeSharingCollections}. */
export interface ScopeSweepCursor {
  collection: string
  afterId: string | null
}

const emptyCounts = (): ScopeSweepCounts => ({
  marked: 0,
  changed: 0,
  capped: 0,
  invalid: 0,
  failed: 0,
})

const platformFirestore = () => firebaseAdmin.app().firestore() as unknown as Firestore

/** The sites `orgs/{orgId}.hosts` names. */
export function orgHostIdsFromDoc(org: Readonly<Record<string, unknown>> | undefined): string[] {
  const hosts = org?.['hosts']
  if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) return []
  return Object.entries(hosts as Record<string, unknown>)
    .filter(([, on]) => Boolean(on))
    .map(([hostId]) => hostId)
}

/** The sites a document keeps whatever it excludes, per its declaration. */
function keptHostIds(
  declared: ResolvedScopeSharingCollection,
  doc: Readonly<Record<string, unknown>>,
): string[] {
  const kept: string[] = []
  for (const field of declared.keepSiteFields ?? []) {
    const value = doc[field]
    if (typeof value === 'string' && value) kept.push(value)
    if (Array.isArray(value)) {
      for (const id of value) if (typeof id === 'string' && id) kept.push(id)
    }
  }
  return kept
}

/** The marked documents of one collection, in the order a cursor can resume. */
function markedPage(collectionRef: CollectionReference, afterId: string | null): Promise<QuerySnapshot> {
  const ordered = collectionRef
    .where('scopeMode', '==', SCOPE_MODE_ALL_EXCEPT)
    .orderBy(FieldPath.documentId())
  return (afterId ? ordered.startAfter(afterId) : ordered).limit(PAGE_SIZE).get()
}

/** Runs `work` over `items`, at most {@link CONCURRENCY} at a time. */
async function eachConcurrently<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next]
        next += 1
        await work(item)
      }
    }),
  )
}

/** A write's data: a `null` marker field is deleted, never stored. */
export function fieldsToWrite(fields: ScopeSharingFields): Record<string, unknown> {
  return {
    visibleTo: fields.visibleTo,
    scopeMode: fields.scopeMode ?? FieldValue.delete(),
    scopeExcept: fields.scopeExcept ?? FieldValue.delete(),
  }
}

/** The document as it will read after the write, for a patch to work from. */
function asStored(
  data: Readonly<Record<string, unknown>>,
  fields: ScopeSharingFields,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data, visibleTo: fields.visibleTo }
  if (fields.scopeMode) {
    next['scopeMode'] = fields.scopeMode
    next['scopeExcept'] = fields.scopeExcept
  } else {
    delete next['scopeMode']
    delete next['scopeExcept']
  }
  return next
}

/** Brings one marked document level, in its own transaction. */
async function reconcileDocument(
  db: Firestore,
  orgRef: DocumentReference,
  declared: ResolvedScopeSharingCollection,
  docRef: DocumentReference,
  counts: ScopeSweepCounts,
): Promise<void> {
  const status = await db.runTransaction(async (tx) => {
    const [org, doc] = await tx.getAll(orgRef, docRef)
    // The workspace went while this ran, and the document with it.
    if (!org.exists || !doc.exists) return 'current'
    const data = doc.data() as Record<string, unknown>
    const answer = reconcileAllExcept(data, orgHostIdsFromDoc(org.data()), {
      maxIncluded: declared.maxIncluded ?? null,
      keepHostIds: keptHostIds(declared, data),
    })
    if (answer.fields) {
      const patch = declared.patch
        ? await requiredPatch(declared.name)(declared.name, asStored(data, answer.fields))
        : {}
      // Not an edit, so `updatedAt` stays: a list ordered by it must not
      // reshuffle because a site was added somewhere in the workspace.
      tx.update(docRef, { ...fieldsToWrite(answer.fields), ...patch })
    }
    return answer.status
  })
  if (status === 'changed') counts.changed += 1
  if (status === 'capped') counts.capped += 1
  if (status === 'invalid') counts.invalid += 1
}

function requiredPatch(collection: string) {
  const patch = scopeSharingPatchFor(collection)
  if (!patch) throw new Error(`no scope-sharing patch is registered for ${collection}`)
  return patch
}

/**
 * A declared patch is missing where the boot step has not run. Runs it once,
 * and only when a marked document needs one, so a sweep that finds nothing
 * never pays for it.
 */
async function ensurePatches(
  collections: readonly ResolvedScopeSharingCollection[],
): Promise<void> {
  if (collections.every((row) => !row.patch || scopeSharingPatchFor(row.name))) return
  await runPluginDeclarationsRepair().catch((error: unknown) => {
    console.error('[scope-sweep] the declarations repair failed', error)
  })
}

export interface RunScopeSharingSweepInput {
  orgId: string
  /** Stops starting new work past this; omit to walk to the end. */
  budgetMs?: number
  /** Resume from here. */
  from?: ScopeSweepCursor | null
  /**
   * Called the first time a marked document turns up, so a sweep that finds
   * nothing writes nothing. A trigger records its sweep document here.
   */
  onFirstMarked?: () => Promise<void>
  firestore?: Firestore
}

/**
 * Walks every declared collection's marked documents and brings each level.
 * Throws only on a failed query; one document failing is counted and the walk
 * goes on, and an incomplete walk answers where it stopped.
 */
export async function runScopeSharingSweep(
  input: RunScopeSharingSweepInput,
): Promise<ScopeSweepResult> {
  const db = input.firestore ?? platformFirestore()
  const orgRef = db.collection('orgs').doc(input.orgId)
  const collections = listScopeSharingCollections()
  const startAt = input.from
    ? Math.max(0, collections.findIndex((row) => row.name === input.from?.collection))
    : 0
  const remaining = collections.slice(startAt)
  const deadline = input.budgetMs == null ? null : Date.now() + input.budgetMs
  const counts = emptyCounts()

  // Every collection's first page at once, so the common answer of nothing
  // costs one round of queries rather than one after another.
  const pages = new Map<string, QueryDocumentSnapshot[]>()
  const firstAfter = (name: string) =>
    input.from && input.from.collection === name ? input.from.afterId : null
  await eachConcurrently(remaining, async (declared) => {
    const snapshot = await markedPage(orgRef.collection(declared.name), firstAfter(declared.name))
    pages.set(declared.name, snapshot.docs)
  })
  if ([...pages.values()].every((docs) => !docs.length)) {
    return { ...counts, complete: true, cursor: null }
  }
  await input.onFirstMarked?.()
  await ensurePatches(remaining)

  for (const declared of remaining) {
    let docs = pages.get(declared.name) ?? []
    let afterId = firstAfter(declared.name)
    while (docs.length) {
      if (deadline != null && Date.now() >= deadline) {
        return { ...counts, complete: false, cursor: { collection: declared.name, afterId } }
      }
      counts.marked += docs.length
      await eachConcurrently(docs, async (doc) => {
        try {
          await reconcileDocument(db, orgRef, declared, doc.ref, counts)
        } catch (error) {
          counts.failed += 1
          console.error(`[scope-sweep] ${declared.name}/${doc.id} in ${input.orgId} was not brought level`, error)
        }
      })
      afterId = docs[docs.length - 1].id
      if (docs.length < PAGE_SIZE) break
      docs = (await markedPage(orgRef.collection(declared.name), afterId)).docs
    }
  }
  return { ...counts, complete: true, cursor: null }
}

/**
 * What a change to a workspace's sites runs, once the change has committed.
 *
 * NEVER THROWS, because the site change is done and is what the person asked
 * for. Work it could not finish is left in a sweep document for the job, and
 * if even that write fails the weekly drift report finds what is behind.
 */
export async function sweepScopeSharingAfterSiteChange(input: {
  orgId: string
  reason: ScopeSweepReason
  hostId?: string
  firestore?: Firestore
}): Promise<void> {
  const { orgId, reason, hostId } = input
  let sweepRef: DocumentReference | null = null
  const leaveForTheJob = async (cursor: ScopeSweepCursor | null, attempts: number) => {
    const db = input.firestore ?? platformFirestore()
    sweepRef ??= db.collection('orgs').doc(orgId).collection(SCOPE_SWEEPS_COLLECTION).doc(createResourceUid())
    await sweepRef.set({
      reason,
      ...(hostId ? { hostId } : {}),
      cursor,
      attempts,
      createdAtMs: Date.now(),
    })
  }
  try {
    const result = await runScopeSharingSweep({
      orgId,
      budgetMs: INLINE_BUDGET_MS,
      ...(input.firestore ? { firestore: input.firestore } : {}),
      onFirstMarked: () => leaveForTheJob(null, 0),
    })
    if (!result.complete) {
      await leaveForTheJob(result.cursor, 0)
      return
    }
    if (result.failed) {
      await leaveForTheJob(null, 1)
      return
    }
    await sweepRef?.delete()
  } catch (error) {
    console.error(`[scope-sweep] the sweep of ${orgId} after ${reason} did not finish`, error)
    await leaveForTheJob(null, 1).catch((writeError: unknown) => {
      console.error(`[scope-sweep] could not leave ${orgId}'s sweep for the job`, writeError)
    })
  }
  await runSiteChangeHooks({ orgId, reason, ...(hostId ? { hostId } : {}) })
}

/**
 * The plugins' own share of a site change (`registerPluginScopeSharingSiteChange`):
 * sharing kept somewhere the sweep does not walk, such as the CRM's grants.
 * Each gets {@link INLINE_BUDGET_MS} and finishes the rest itself. Never throws.
 * A hook registers with its plugin's server declarations, at boot.
 */
async function runSiteChangeHooks(input: {
  orgId: string
  reason: ScopeSweepReason
  hostId?: string
}): Promise<void> {
  for (const { pluginId, hook } of listScopeSharingSiteChangeHooks()) {
    try {
      await hook({ ...input, budgetMs: INLINE_BUDGET_MS })
    } catch (error) {
      console.error(`[scope-sweep] ${pluginId}'s site-change hook failed for ${input.orgId}`, error)
    }
  }
}

/**
 * Carries on every unfinished sweep: the job's handler. A sweep document exists
 * only while work is left, so the unfiltered query needs no index and answers
 * nothing on a quiet beat, for one read.
 */
export async function resumeScopeSweeps(
  options: { budgetMs?: number; firestore?: Firestore } = {},
): Promise<{ resumed: number; finished: number; droppedAfterFailing: number }> {
  const db = options.firestore ?? platformFirestore()
  const pending = await db.collectionGroup(SCOPE_SWEEPS_COLLECTION).limit(SWEEPS_PER_BEAT).get()
  const tally = { resumed: 0, finished: 0, droppedAfterFailing: 0 }
  const deadline = Date.now() + (options.budgetMs ?? JOB_BUDGET_MS)
  for (const sweep of pending.docs) {
    const budgetMs = deadline - Date.now()
    if (budgetMs <= 0) break
    tally.resumed += 1
    const orgRef = sweep.ref.parent.parent
    const attempts = Number(sweep.get('attempts') ?? 0)
    try {
      const org = orgRef ? await orgRef.get() : null
      // The workspace was erased after this was left. Nothing to bring level.
      if (!org?.exists) {
        await sweep.ref.delete()
        tally.finished += 1
        continue
      }
      const result = await runScopeSharingSweep({
        orgId: org.id,
        budgetMs,
        from: (sweep.get('cursor') as ScopeSweepCursor | null | undefined) ?? null,
        firestore: db,
      })
      if (!result.complete) {
        await sweep.ref.update({ cursor: result.cursor })
        continue
      }
      if (!result.failed) {
        await sweep.ref.delete()
        tally.finished += 1
        continue
      }
      throw new Error(`${result.failed} document(s) failed`)
    } catch (error) {
      console.error(`[scope-sweep] ${sweep.ref.path} failed on attempt ${attempts + 1}`, error)
      if (attempts + 1 >= MAX_SWEEP_ATTEMPTS) {
        // Stops holding a place in the beat. What it left behind is what the
        // weekly drift report counts, and that report goes to staff.
        await sweep.ref.delete().catch(() => undefined)
        tally.droppedAfterFailing += 1
      } else {
        await sweep.ref.update({ attempts: attempts + 1, cursor: null }).catch(() => undefined)
      }
    }
  }
  return tally
}

/** What the weekly report asks of one workspace. Reads only. */
export interface ScopeSharingDrift {
  /** Marked documents read. */
  marked: number
  /** Should read differently from how they read: what a sweep would write. */
  stale: number
  /** Past their collection's limit. A known state, reported and not alarmed. */
  capped: number
  /** A marker that cannot be acted on. */
  invalid: number
}

export function emptyScopeSharingDrift(): ScopeSharingDrift {
  return { marked: 0, stale: 0, capped: 0, invalid: 0 }
}

/**
 * How far one workspace's marked documents are from what a sweep would write,
 * with the same helper the sweep uses. One query per declared collection when
 * nothing is marked.
 */
export async function scopeSharingDriftForOrg(
  orgRef: DocumentReference,
  orgData: Readonly<Record<string, unknown>> | undefined,
): Promise<ScopeSharingDrift> {
  const drift = emptyScopeSharingDrift()
  const hostIds = orgHostIdsFromDoc(orgData)
  await eachConcurrently(listScopeSharingCollections(), async (declared) => {
    let afterId: string | null = null
    for (;;) {
      const page: QuerySnapshot = await markedPage(orgRef.collection(declared.name), afterId)
      for (const doc of page.docs) {
        const data = doc.data() as Record<string, unknown>
        const answer = reconcileAllExcept(data, hostIds, {
          maxIncluded: declared.maxIncluded ?? null,
          keepHostIds: keptHostIds(declared, data),
        })
        drift.marked += 1
        if (answer.status === 'invalid') drift.invalid += 1
        if (answer.status === 'capped') drift.capped += 1
        if (answer.fields) drift.stale += 1
      }
      if (page.docs.length < PAGE_SIZE) return
      afterId = page.docs[page.docs.length - 1].id
    }
  })
  return drift
}
