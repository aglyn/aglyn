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
 * THE CRM DEFAULT "ALL SITES EXCEPT…" ON THE SERVER (AGL-4047).
 *
 * Two jobs, and neither changes a record the default did not stamp unless a
 * person asked:
 *
 * 1. A NEW record stamped by the default (`crmScopeTokens`) carries the sites
 *    it reaches today. The marker that lets a site added later join it can
 *    only be written by the server. A server writer creating a lead, a
 *    company, a deal, a task or an activity stamps it as it writes
 *    (`crmScopeFields`, or `crmDefaultMarkerOf` for one that stamped its sites
 *    another way); every other server write of a lead, a contact, a company
 *    or a deal, and a console write's `evaluate` follow-up — a logged
 *    activity's included — ask {@link markRecordUnderDefault}: a record
 *    created since the default was chosen, whose sites are exactly what the
 *    default stamps, gets the marker. Its sites do not move.
 *
 * 2. EXISTING records change only through "Apply to existing records", a run
 *    a member holding "Change CRM settings" starts: every contact, lead,
 *    company, deal, task and logged activity is shared with every site but the
 *    ones left out, the sites that captured the person kept. By a cursor in
 *    budgeted passes, resumable, its progress mirrored on the org document
 *    (`crm.defaultApplyRun`) and its cursor in `orgs/{orgId}/crmSharingRuns`,
 *    which the CRM job carries on.
 */

import {
  crmDefaultExceptOf,
  crmDefaultMarkerOf,
  crmListFieldsPatch,
  type CrmListCollection,
  CRM_DEFAULT_MAX_INCLUDED,
} from '@aglyn/aglyn/app-utils/crm'
import {
  heldScopeTokens,
  hostScopeToken,
  ORG_SCOPE_TOKEN,
  SCOPE_MODE_ALL_EXCEPT,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import {
  CRM_DEFAULT_APPLY_COLLECTIONS,
  CRM_SHARING_FIELD,
  CRM_WRITE_SCOPE_FIELD,
  type CrmDefaultApplyCollection,
  type CrmDefaultApplyRun,
  type CrmSharingContext,
  type CrmSharingRule,
  crmOrgHostIds,
  evaluateRecordGrants,
  isCrmDefaultApplyCollection,
  isCrmSharingObject,
  planRecordSharing,
  recordHolderHostIds,
  sharingPlanChanges,
} from '../model/crm-sharing'
import { crmSharingContextFor, crmSharingRulesOf } from './crm-sharing'

type Firestore = FirebaseFirestore.Firestore

/** The run's documents under `orgs/{orgId}`: the same collection the grant refresh leaves work in. */
export const CRM_SHARING_RUNS_COLLECTION = 'crmSharingRuns'
/** A run document's kind for "Apply to existing records". */
export const CRM_DEFAULT_APPLY_KIND = 'apply-default'
/** Records read at a time. */
const PAGE_SIZE = 100
/** Transactions at once. */
const CONCURRENCY = 8
/** How long a pass holds the run against a second pass starting beside it. */
const LEASE_GRACE_MS = 10_000

const LIST_COLLECTIONS = new Set<string>(['contacts', 'leads', 'companies', 'deals', 'crmTasks'])

const sameSet = (a: readonly unknown[], b: readonly unknown[]) => {
  const left = new Set(a)
  return left.size === new Set(b).size && b.every((entry) => left.has(entry))
}

/** When a record was created, in ms, from `createdAt` or `createdAtMs`; null when it does not say. */
function createdAtMsOf(record: Readonly<Record<string, unknown>>): number | null {
  const at = record['createdAt'] as { toMillis?: () => number } | number | null | undefined
  if (typeof at === 'number' && Number.isFinite(at)) return at
  if (at && typeof at === 'object' && typeof at.toMillis === 'function') return at.toMillis()
  const ms = record['createdAtMs']
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null
}

/**
 * The marker a record stamped by the CRM default should carry, or null.
 *
 * Only a record created since the default was set to all sites except some
 * (`crm.defaultRecordExceptAt`), carrying no marker, created on a site, and
 * whose own sites are exactly what the default stamps for that site: so a
 * record somebody shared by hand, narrowed or widened, or one that predates
 * the choice, is never marked here. That is the run's to do, when asked.
 */
export function defaultMarkerFor(
  org: Readonly<Record<string, unknown>> | null | undefined,
  record: Readonly<Record<string, unknown>>,
): { scopeMode: typeof SCOPE_MODE_ALL_EXCEPT; scopeExcept: string[] } | null {
  if (!crmDefaultExceptOf(org as Record<string, unknown>)) return null
  if (record['scopeMode'] !== undefined && record['scopeMode'] !== null) return null
  const crm = (org?.['crm'] ?? {}) as Record<string, unknown>
  const sinceMs = createdAtMsOf({ createdAt: crm['defaultRecordExceptAt'] })
  const createdMs = createdAtMsOf(record)
  if (sinceMs == null || createdMs == null || createdMs < sinceMs) return null
  // The one test a writer stamping a new record asks as well: its own sites
  // are exactly what the default stamps for the site it came in on.
  const marker = crmDefaultMarkerOf(org as Record<string, unknown>, {
    hostId: record['hostId'],
    visibleTo: heldScopeTokens(record),
  })
  return marker.scopeMode && marker.scopeExcept
    ? { scopeMode: marker.scopeMode, scopeExcept: marker.scopeExcept }
    : null
}

/**
 * Marks one record stamped by the default (see {@link defaultMarkerFor}), in
 * a transaction. Its sites do not move. Answers whether it wrote.
 */
export async function markRecordUnderDefault(
  firestore: Firestore,
  orgId: string,
  collection: string,
  id: string,
  org: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  if (!crmDefaultExceptOf(org as Record<string, unknown>)) return false
  const ref = firestore.collection('orgs').doc(orgId).collection(collection).doc(id)
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) return false
    const marker = defaultMarkerFor(org, (snapshot.data() ?? {}) as Record<string, unknown>)
    if (!marker) return false
    tx.update(ref, marker)
    return true
  })
}

/*==========================================
 * "APPLY TO EXISTING RECORDS".
 *=========================================*/

export type ApplyOutcome = 'changed' | 'unchanged' | 'capped' | 'missing'

/** The default changed away from all sites except some while the run was going. */
export class DefaultChangedError extends Error {
  constructor() {
    super('The default sharing changed while this ran.')
  }
}

/**
 * What one record stores of its sites under the default, given the
 * workspace's sites: every site but the ones left out, plus the sites that
 * captured the person; `['org']` once no site left out is still there; null
 * past {@link CRM_DEFAULT_MAX_INCLUDED} sites.
 */
export function defaultSitesFor(
  org: Readonly<Record<string, unknown>>,
  record: Readonly<Record<string, unknown>>,
): { visibleTo: string[]; scopeMode: typeof SCOPE_MODE_ALL_EXCEPT | null; scopeExcept: string[] | null } | null {
  const except = crmDefaultExceptOf(org as Record<string, unknown>)
  if (!except) throw new DefaultChangedError()
  const orgHostIds = crmOrgHostIds(org)
  const left = except.filter((id) => orgHostIds.includes(id)).sort()
  if (!left.length) return { visibleTo: [ORG_SCOPE_TOKEN], scopeMode: null, scopeExcept: null }
  const out = new Set(left)
  const kept = recordHolderHostIds(record)
  const included = [...new Set([...orgHostIds.filter((id) => !out.has(id)), ...kept])].sort()
  if (included.length > CRM_DEFAULT_MAX_INCLUDED) return null
  return {
    visibleTo: included.map(hostScopeToken),
    scopeMode: SCOPE_MODE_ALL_EXCEPT,
    scopeExcept: left.map(hostScopeToken),
  }
}

/** Brings one record to the default, in its own transaction that reads the org document. */
export async function applyDefaultToRecord(
  firestore: Firestore,
  orgId: string,
  collection: CrmDefaultApplyCollection,
  id: string,
  rules: readonly CrmSharingRule[],
  context: CrmSharingContext = {},
): Promise<ApplyOutcome> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const ref = orgRef.collection(collection).doc(id)
  return firestore.runTransaction(async (tx) => {
    const [orgSnap, snapshot] = await tx.getAll(orgRef, ref)
    if (!snapshot.exists) return 'missing' as const
    const org = (orgSnap.data() ?? {}) as Record<string, unknown>
    const record = (snapshot.data() ?? {}) as Record<string, unknown>
    const sites = defaultSitesFor(org, record)
    if (!sites) return 'capped' as const
    const markerMoves =
      (record['scopeMode'] ?? null) !== sites.scopeMode ||
      !sameSet((record['scopeExcept'] as unknown[] | undefined) ?? [], sites.scopeExcept ?? [])
    const update: Record<string, unknown> = {
      scopeMode: sites.scopeMode ?? FieldValue.delete(),
      scopeExcept: sites.scopeExcept ?? FieldValue.delete(),
    }
    let next: Record<string, unknown>
    if (isCrmSharingObject(collection)) {
      // The record as the default leaves it, its grants planned on top: what
      // they added stays added, an edit grant still writes.
      const base: Record<string, unknown> = { ...record, visibleTo: sites.visibleTo }
      delete base[CRM_SHARING_FIELD]
      delete base[CRM_WRITE_SCOPE_FIELD]
      const grants = evaluateRecordGrants(collection, record, rules, Date.now(), {
        ...context,
        orgHostIds: crmOrgHostIds(org),
      })
      const plan = planRecordSharing(base, grants)
      if (!markerMoves && !sharingPlanChanges(record, plan)) return 'unchanged' as const
      update['visibleTo'] = plan.visibleTo
      update[CRM_WRITE_SCOPE_FIELD] = plan.writeTo ?? FieldValue.delete()
      update[CRM_SHARING_FIELD] = plan.sharing ?? FieldValue.delete()
      next = { ...record, visibleTo: plan.visibleTo }
    } else {
      if (!markerMoves && sameSet((record['visibleTo'] as unknown[] | undefined) ?? [], sites.visibleTo)) {
        return 'unchanged' as const
      }
      update['visibleTo'] = sites.visibleTo
      next = { ...record, visibleTo: sites.visibleTo }
    }
    // The scoped list fields follow `visibleTo` (AGL-3321), so a site's search
    // finds the record the moment it can see it, and stops the moment it can't.
    const patch = LIST_COLLECTIONS.has(collection)
      ? crmListFieldsPatch(collection as CrmListCollection, next)
      : {}
    tx.update(ref, { ...patch, ...update })
    return 'changed' as const
  })
}

/** Runs `work` over `items`, at most {@link CONCURRENCY} at a time. */
async function eachConcurrently<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
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

function readRun(raw: unknown, nowMs: number): CrmDefaultApplyRun {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cursor = value['cursor'] as Record<string, unknown> | null | undefined
  return {
    status: 'running',
    processed: Number(value['processed']) || 0,
    changed: Number(value['changed']) || 0,
    capped: Number(value['capped']) || 0,
    cursor:
      cursor && isCrmDefaultApplyCollection(cursor['collection'])
        ? {
            collection: cursor['collection'],
            afterId: typeof cursor['afterId'] === 'string' ? cursor['afterId'] : null,
          }
        : null,
    startedAtMs: Number(value['startedAtMs']) || nowMs,
  }
}

/** The run as the org document stores it — no `undefined` anywhere. */
function storedRun(run: CrmDefaultApplyRun): Record<string, unknown> {
  return JSON.parse(JSON.stringify(run)) as Record<string, unknown>
}

async function mirrorRun(firestore: Firestore, orgId: string, run: CrmDefaultApplyRun): Promise<void> {
  await firestore
    .collection('orgs')
    .doc(orgId)
    .update(new FieldPath('crm', 'defaultApplyRun'), storedRun(run))
}

/**
 * Starts "Apply to existing records", or finds the one already going: one per
 * workspace. Refused unless the default is all sites except some.
 */
export async function startDefaultApply(
  firestore: Firestore,
  orgId: string,
  by: { uid: string },
): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const runs = orgRef.collection(CRM_SHARING_RUNS_COLLECTION)
  return firestore.runTransaction(async (tx) => {
    const org = await tx.get(orgRef)
    if (!crmDefaultExceptOf((org.data() ?? {}) as Record<string, unknown>)) {
      return {
        ok: false as const,
        error: 'Choose All sites except… for new records and save it first.',
      }
    }
    const going = await tx.get(runs.where('kind', '==', CRM_DEFAULT_APPLY_KIND).limit(1))
    if (!going.empty) return { ok: true as const, runId: going.docs[0].id }
    const nowMs = Date.now()
    const run: CrmDefaultApplyRun = {
      status: 'running',
      processed: 0,
      changed: 0,
      capped: 0,
      cursor: null,
      startedAtMs: nowMs,
    }
    const ref = runs.doc(createResourceUid())
    tx.set(ref, { kind: CRM_DEFAULT_APPLY_KIND, run: storedRun(run), attempts: 0, startedByUid: by.uid, createdAtMs: nowMs })
    tx.update(orgRef, new FieldPath('crm', 'defaultApplyRun'), storedRun(run))
    return { ok: true as const, runId: ref.id }
  })
}

/** The run going in a workspace, if any. */
export async function findDefaultApply(firestore: Firestore, orgId: string): Promise<string | null> {
  const going = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_SHARING_RUNS_COLLECTION)
    .where('kind', '==', CRM_DEFAULT_APPLY_KIND)
    .limit(1)
    .get()
  return going.empty ? null : going.docs[0].id
}

/**
 * One budgeted pass of the run, from its cursor. Writes its progress after
 * every page, on the run document and the org document, so a reopened card
 * shows where it stands and the next pass, the console's or the job's,
 * carries on. A pass that finds another holding the run answers `more` and
 * does nothing. Throws only when the run document cannot be read.
 */
export async function advanceDefaultApply(
  firestore: Firestore,
  orgId: string,
  runId: string,
  deadlineMs: number,
): Promise<{ run: CrmDefaultApplyRun | null; more: boolean }> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const runRef = orgRef.collection(CRM_SHARING_RUNS_COLLECTION).doc(runId)
  const claimed = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(runRef)
    if (!snapshot.exists) return null
    if (Number(snapshot.get('leaseUntilMs') ?? 0) > Date.now()) return 'busy' as const
    tx.update(runRef, { leaseUntilMs: deadlineMs + LEASE_GRACE_MS })
    return readRun(snapshot.get('run'), Date.now())
  })
  if (claimed === null) return { run: null, more: false }
  if (claimed === 'busy') return { run: null, more: true }
  let run = claimed
  const save = async () => {
    await runRef.update({ run: storedRun(run) })
    await mirrorRun(firestore, orgId, run)
  }
  try {
    const { rules } = await crmSharingRulesOf(firestore, orgId, { fresh: true })
    const startAt = run.cursor ? CRM_DEFAULT_APPLY_COLLECTIONS.indexOf(run.cursor.collection) : 0
    for (const collection of CRM_DEFAULT_APPLY_COLLECTIONS.slice(Math.max(0, startAt))) {
      let afterId = run.cursor?.collection === collection ? run.cursor.afterId : null
      for (;;) {
        if (Date.now() >= deadlineMs) {
          run = { ...run, cursor: { collection, afterId } }
          await save()
          await runRef.update({ leaseUntilMs: 0 })
          return { run, more: true }
        }
        let query = orgRef.collection(collection).orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
        if (afterId) query = query.startAfter(afterId)
        const page = await query.get()
        if (page.empty) break
        // What a rule asking a lead source direction reads, once a page.
        const context = isCrmSharingObject(collection)
          ? await crmSharingContextFor(firestore, orgId, rules, collection)
          : {}
        const counts = { changed: 0, capped: 0 }
        await eachConcurrently(page.docs, async (doc) => {
          const outcome = await applyDefaultToRecord(firestore, orgId, collection, doc.id, rules, context)
          if (outcome === 'changed') counts.changed += 1
          if (outcome === 'capped') counts.capped += 1
        })
        afterId = page.docs[page.docs.length - 1].id
        run = {
          ...run,
          processed: run.processed + page.size,
          changed: run.changed + counts.changed,
          capped: run.capped + counts.capped,
          cursor: { collection, afterId },
        }
        await save()
        if (page.size < PAGE_SIZE) break
      }
    }
    run = { ...run, status: 'done', cursor: null, finishedAtMs: Date.now() }
    await mirrorRun(firestore, orgId, run)
    await runRef.delete()
    return { run, more: false }
  } catch (error) {
    const changed = error instanceof DefaultChangedError
    if (!changed) console.error('[crm] applying the default sharing stopped', orgId, error)
    run = {
      ...run,
      status: 'failed',
      finishedAtMs: Date.now(),
      error: changed
        ? 'The default sharing changed while this ran. Start it again to apply the one saved now.'
        : 'Applying stopped. Resume it to carry on from where it stopped.',
    }
    await mirrorRun(firestore, orgId, run).catch(() => undefined)
    if (changed) await runRef.delete().catch(() => undefined)
    else await runRef.update({ run: storedRun({ ...run, status: 'running' }), leaseUntilMs: 0 }).catch(() => undefined)
    return { run, more: false }
  }
}
