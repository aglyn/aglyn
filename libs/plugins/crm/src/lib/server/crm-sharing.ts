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
 * The server half of CRM sharing (AGL-3336) — see `model/crm-sharing.ts`
 * for the model.
 *
 * Three writers, one transaction shape. A record's sharing is RECOMPUTED,
 * never patched: the transaction reads the record, keeps its hand shares
 * (changed by the caller when the act is a share or an unshare), matches
 * every active rule against it as it stands, and writes `visibleTo`,
 * `writeTo`, `sharing` and the list fields derived from `visibleTo` only
 * when any of them moves. So the same function serves
 *
 * - a manager's share or unshare (`crm/sharing`, `share`/`unshare`);
 * - a write to the record anywhere on the server, through the core's
 *   record-written seam (`crmSharingRecordWritten`), and a client-direct
 *   write's follow-up (`evaluate`);
 * - a rule's recompute over existing records (`rule-save`, `rule-continue`),
 *   and its removal (`rule-delete`), in budgeted passes with the progress on
 *   the rule.
 */

import {
  CRM_COLLECTIONS,
  crmActivityLogHasRoom,
  type CrmActivityLink,
  crmListFieldsPatch,
} from '@aglyn/aglyn/app-utils/crm'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { hostIdsFromScope } from '@aglyn/aglyn/app-utils/scope-tokens'
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost, logOrgActivity } from '@aglyn/tenant-data-admin'
import { countCrmActivitiesForRecord } from '@aglyn/tenant-data-admin/server/crm-records'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  activeSharingRules,
  CRM_SHARING_CRITERIA_FOR,
  CRM_SHARING_CRITERIA_KEYS,
  CRM_SHARING_FIELD,
  CRM_SHARING_IDS_MAX,
  CRM_SHARING_OBJECT_LABELS,
  CRM_SHARING_RULE_IDS_PATH,
  CRM_SHARING_RULES_MAX,
  CRM_WRITE_SCOPE_FIELD,
  type CrmShareAccess,
  type CrmShareGrant,
  type CrmSharingContext,
  type CrmSharingCriteria,
  type CrmSharingObject,
  type CrmSharingResponse,
  type CrmSharingRule,
  type CrmSharingRuleRun,
  type CrmSharingSite,
  describeShareTargets,
  evaluateRecordGrants,
  isCrmShareAccess,
  isCrmSharingObject,
  planRecordSharing,
  readCrmSharingRule,
  readCrmSharingRules,
  recordHeldScope,
  sharingPlanChanges,
  shareTargetsFrom,
  sharingRulesAskLeadSourceDirection,
  withManualShares,
  withoutManualShares,
} from '../model/crm-sharing'
import { readLeadSourcePicklist } from './lead-source-picklist'
import { authorizeOrgCaller, orgHostIds, readCrmRouteScope } from './org-caller'
import { crmSuiteRefusal } from './suite-gate'
import { authorizeCrmWriter } from './task-routes'

type Firestore = FirebaseFirestore.Firestore

/*==========================================
 * THE RULES, READ OFF THE ORG DOCUMENT.
 *=========================================*/

/**
 * A few seconds of memory per process: every CRM write asks, and an org
 * with no rules should cost it nothing past the first read. A cached list
 * is never the reason a grant is TAKEN away — see `recomputeRecordSharing`.
 */
const RULES_TTL_MS = 10_000
const rulesCache = new Map<string, { atMs: number; rules: CrmSharingRule[] }>()

/** Test seam, and what a rule write calls so its own process reads it fresh. */
export function forgetCrmSharingRules(orgId?: string): void {
  if (orgId) rulesCache.delete(orgId)
  else rulesCache.clear()
}

export async function crmSharingRulesOf(
  firestore: Firestore,
  orgId: string,
  options: { fresh?: boolean; nowMs?: number } = {},
): Promise<{ rules: CrmSharingRule[]; fresh: boolean }> {
  const nowMs = options.nowMs ?? Date.now()
  const cached = rulesCache.get(orgId)
  if (!options.fresh && cached && nowMs - cached.atMs < RULES_TTL_MS) {
    return { rules: cached.rules, fresh: false }
  }
  const snapshot = await firestore.collection('orgs').doc(orgId).get()
  const rules = readCrmSharingRules(snapshot.data() ?? null)
  rulesCache.set(orgId, { atMs: nowMs, rules })
  return { rules, fresh: true }
}

/**
 * What the rules for `object` are evaluated against beyond the record: the
 * org's Lead source list, read only when an active rule asks a lead source
 * direction (AGL-3511) — an org whose rules never do pays no read for it.
 */
export async function crmSharingContextFor(
  firestore: Firestore,
  orgId: string,
  rules: readonly CrmSharingRule[],
  object: CrmSharingObject,
): Promise<CrmSharingContext> {
  if (!sharingRulesAskLeadSourceDirection(rules, object)) return {}
  return { leadSources: await readLeadSourcePicklist(firestore, orgId) }
}

/*==========================================
 * ONE RECORD, RECOMPUTED.
 *=========================================*/

export interface RecomputeRecordSharingInput {
  firestore: Firestore
  orgId: string
  object: CrmSharingObject
  id: string
  /** Every rule the org has, in any state. */
  rules: readonly CrmSharingRule[]
  /** Whether `rules` was read just now; a stale list is re-read before it takes a grant away. */
  fresh: boolean
  /** The hand shares' change, for a share or an unshare. */
  manual?: (grants: Record<string, CrmShareGrant>) => Record<string, CrmShareGrant>
  /** What the rules are evaluated against beyond the record — see {@link crmSharingContextFor}. */
  context?: CrmSharingContext
  atMs: number
}

export type RecomputeOutcome = 'changed' | 'unchanged' | 'missing'

export async function recomputeRecordSharing(
  input: RecomputeRecordSharingInput,
): Promise<RecomputeOutcome> {
  const { firestore, orgId, object, id, atMs } = input
  const ref = firestore.collection('orgs').doc(orgId).collection(object).doc(id)
  return await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) return 'missing' as const
    const record = (snapshot.data() ?? {}) as Record<string, unknown>
    let rules = input.rules
    /*
     * A GRANT IS NEVER TAKEN AWAY ON A STALE ANSWER. A rule grant whose rule
     * the cached list does not name is dropped only once a fresh read of the
     * org agrees: another process may have saved that rule seconds ago and
     * applied it to this very record.
     */
    if (!input.fresh) {
      const known = new Set(rules.map((rule) => rule.id))
      const stored = record[CRM_SHARING_FIELD] as { ruleIds?: unknown } | undefined
      const ruleIds = Array.isArray(stored?.ruleIds) ? (stored.ruleIds as unknown[]) : []
      if (ruleIds.some((ruleId) => !known.has(String(ruleId)))) {
        const org = await tx.get(firestore.collection('orgs').doc(orgId))
        rules = readCrmSharingRules(org.data() ?? null)
      }
    }
    // A rule read afresh above may ask a direction the caller's context was not read for.
    const context =
      input.context?.leadSources || rules === input.rules
        ? input.context
        : await crmSharingContextFor(firestore, orgId, rules, object)
    let grants = evaluateRecordGrants(object, record, rules, atMs, context)
    if (input.manual) grants = input.manual(grants)
    const plan = planRecordSharing(record, grants)
    if (!sharingPlanChanges(record, plan)) return 'unchanged' as const
    const next = {
      ...record,
      visibleTo: plan.visibleTo,
      [CRM_WRITE_SCOPE_FIELD]: plan.writeTo ?? undefined,
      [CRM_SHARING_FIELD]: plan.sharing ?? undefined,
    }
    tx.update(ref, {
      visibleTo: plan.visibleTo,
      [CRM_WRITE_SCOPE_FIELD]: plan.writeTo ?? FieldValue.delete(),
      [CRM_SHARING_FIELD]: plan.sharing ?? FieldValue.delete(),
      // The scoped list fields are derived from `visibleTo` (AGL-3321), so a
      // target site's folded search finds the record the moment it can see it.
      ...crmListFieldsPatch(object, next),
    })
    return 'changed' as const
  })
}

/** Several records at once, a few in flight. */
async function recomputeMany(
  input: Omit<RecomputeRecordSharingInput, 'id'>,
  ids: readonly string[],
): Promise<{ changed: string[]; missing: number }> {
  const queue = [...new Set(ids)]
  const changed: string[] = []
  let missing = 0
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const outcome = await recomputeRecordSharing({ ...input, id })
      if (outcome === 'changed') changed.push(id)
      if (outcome === 'missing') missing += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker))
  return { changed, missing }
}

/**
 * Re-evaluates the org's rules for these records — the one thing a write
 * anywhere owes the sharing. An org with no active rule for the object
 * costs one cached read and nothing else; grants of a rule switched off
 * are taken away by that rule's own removal pass, not here.
 */
export async function evaluateCrmSharing(
  firestore: Firestore,
  orgId: string,
  object: CrmSharingObject,
  ids: readonly string[],
): Promise<{ changed: number; missing: number }> {
  const { rules, fresh } = await crmSharingRulesOf(firestore, orgId)
  if (!activeSharingRules(rules, object).length) return { changed: 0, missing: 0 }
  const context = await crmSharingContextFor(firestore, orgId, rules, object)
  const outcome = await recomputeMany(
    { firestore, orgId, object, rules, fresh, context, atMs: Date.now() },
    ids,
  )
  return { changed: outcome.changed.length, missing: outcome.missing }
}

/**
 * The core's record-written seam (AGL-3336): every server writer of a lead,
 * a contact, a company or a deal restamps it, and the restamp tells this.
 * Never throws — the write it is told about already landed.
 */
export async function crmSharingRecordWritten(event: {
  path: string
  collection: string
}): Promise<void> {
  if (!isCrmSharingObject(event.collection)) return
  const segments = event.path.split('/')
  if (segments.length !== 4 || segments[0] !== 'orgs' || segments[2] !== event.collection) return
  try {
    await evaluateCrmSharing(
      firebaseAdmin.app().firestore(),
      segments[1],
      event.collection,
      [segments[3]],
    )
  } catch (error) {
    console.error(`[crm] sharing rules could not be evaluated for ${event.path}`, error)
  }
}

/*==========================================
 * THE AUDIT: a line on the record, a line in the org's feed.
 *=========================================*/

const LINK_FIELD: Readonly<Record<CrmSharingObject, keyof CrmActivityLink>> = {
  leads: 'leadId',
  contacts: 'contactId',
  companies: 'companyId',
  deals: 'dealId',
}

const ORG_TARGET: Readonly<Record<CrmSharingObject, 'lead' | 'contact' | 'company' | 'deal'>> = {
  leads: 'lead',
  contacts: 'contact',
  companies: 'company',
  deals: 'deal',
}

/**
 * The entry on the record's Activity: who shared it with which sites, or
 * took a share away. Visible to the sites that hold the record and to the
 * sites it names, so both sides of a share read how it came about.
 */
async function fileSharingActivity(
  firestore: Firestore,
  input: {
    orgId: string
    object: CrmSharingObject
    id: string
    body: string
    targets: readonly string[]
    by: { uid: string; name: string }
    atMs: number
  },
): Promise<void> {
  try {
    const orgRef = firestore.collection('orgs').doc(input.orgId)
    const record = (await orgRef.collection(input.object).doc(input.id).get()).data() ?? {}
    const held = recordHeldScope(record)
    const visibleTo = [...new Set([...held, ...input.targets])]
    if (!visibleTo.length) return
    const link: CrmActivityLink = { [LINK_FIELD[input.object]]: input.id }
    if (!crmActivityLogHasRoom(await countCrmActivitiesForRecord(orgRef, link))) return
    const hostId =
      typeof record['hostId'] === 'string' && record['hostId']
        ? record['hostId']
        : (hostIdsFromScope(held)[0] ?? '')
    await orgRef
      .collection(CRM_COLLECTIONS.activities)
      .doc(createResourceUid())
      .create({
        kind: 'note',
        body: input.body,
        atMs: input.atMs,
        byUid: input.by.uid,
        ...(input.by.name ? { byName: input.by.name } : {}),
        ...link,
        hostId,
        visibleTo,
        sourcePluginId: BUNDLE_ID,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
  } catch (error) {
    console.error('[crm] the sharing entry could not be written on the record', input.id, error)
  }
}

/*==========================================
 * THE ORG'S SITES.
 *=========================================*/

export async function crmSharingSites(firestore: Firestore, orgId: string): Promise<CrmSharingSite[]> {
  const hosts = await firestore.collection('hosts').where('orgId', '==', orgId).get()
  return hosts.docs
    .map((doc) => {
      const displayName = String(doc.get('displayName') ?? '').trim()
      const subdomain = String(doc.get('subdomain') ?? '').trim()
      return { id: String(doc.id), name: displayName || subdomain || String(doc.id) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/*==========================================
 * A RULE, SAVED FROM A REQUEST.
 *=========================================*/

function listFrom(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return []
  return [
    ...new Set(
      raw.map((entry) => String(entry ?? '').trim().slice(0, 200)).filter(Boolean),
    ),
  ].slice(0, max)
}

/**
 * The rule a request describes, judged: an object, a name, sites that are
 * the org's own, targets that are the org's own or all sites. `null` with
 * the reason when it cannot be saved.
 */
export function ruleFromRequest(
  raw: unknown,
  context: { hostIds: readonly string[]; existing: CrmSharingRule | null; uid: string; nowMs: number },
): { rule: CrmSharingRule; error: null } | { rule: null; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { rule: null, error: 'Describe the rule.' }
  }
  const value = raw as Record<string, unknown>
  const object = value['object']
  if (!isCrmSharingObject(object)) {
    return { rule: null, error: 'Choose which records the rule shares.' }
  }
  const name = String(value['name'] ?? '').trim().slice(0, 120)
  if (!name) return { rule: null, error: 'Name the rule.' }
  const own = new Set(context.hostIds)
  const sourceHostIds = listFrom(value['sourceHostIds'], 30)
  if (sourceHostIds.some((id) => !own.has(id))) {
    return { rule: null, error: 'A site the rule names is not one of this organization’s.' }
  }
  const targets = shareTargetsFrom(value['targets'])
  if (!targets) return { rule: null, error: 'Choose the sites to share with, or All sites.' }
  if (hostIdsFromScope(targets).some((id) => !own.has(id))) {
    return { rule: null, error: 'A site the rule shares with is not one of this organization’s.' }
  }
  const access = value['access']
  if (access !== undefined && !isCrmShareAccess(access)) {
    return { rule: null, error: 'Access is read-only, or read and edit.' }
  }
  const rawCriteria = (value['criteria'] ?? {}) as Record<string, unknown>
  const criteria: CrmSharingCriteria = {}
  for (const key of CRM_SHARING_CRITERIA_KEYS) {
    if (!CRM_SHARING_CRITERIA_FOR[object].includes(key)) continue
    const list = listFrom(rawCriteria[key], 20)
    if (list.length) criteria[key] = list
  }
  const existing = context.existing
  const rule = readCrmSharingRule({
    id: existing?.id ?? createResourceUid(),
    name,
    object,
    enabled: value['enabled'] !== false,
    sourceHostIds,
    criteria,
    targets,
    access: (access as CrmShareAccess | undefined) ?? 'read',
    createdByUid: existing?.createdByUid ?? context.uid,
    createdAtMs: existing?.createdAtMs ?? context.nowMs,
    updatedAtMs: context.nowMs,
  })
  if (!rule) return { rule: null, error: 'The rule could not be read.' }
  return { rule, error: null }
}

/** A rule as the org document stores it — no `undefined` anywhere. */
function storedRule(rule: CrmSharingRule): Record<string, unknown> {
  return JSON.parse(JSON.stringify(rule)) as Record<string, unknown>
}

/**
 * Writes the org's rule list through `change`, in a transaction over the org
 * document, and answers the list as written.
 */
async function writeRules(
  firestore: Firestore,
  orgId: string,
  change: (rules: CrmSharingRule[]) => CrmSharingRule[] | { error: string },
): Promise<{ rules: CrmSharingRule[]; error: null } | { rules: null; error: string }> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const result = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(orgRef)
    const next = change(readCrmSharingRules(snapshot.data() ?? null))
    if ('error' in next) return { rules: null, error: next.error }
    tx.update(orgRef, new FieldPath('crm', 'sharingRules'), next.map(storedRule))
    return { rules: next, error: null }
  })
  forgetCrmSharingRules(orgId)
  return result as { rules: CrmSharingRule[]; error: null } | { rules: null; error: string }
}

/** Replaces one rule's run, leaving every other rule as it is. */
async function writeRun(
  firestore: Firestore,
  orgId: string,
  ruleId: string,
  run: CrmSharingRuleRun,
  options: { dropRule?: boolean } = {},
): Promise<CrmSharingRule | null> {
  const written = await writeRules(firestore, orgId, (rules) =>
    options.dropRule
      ? rules.filter((rule) => rule.id !== ruleId)
      : rules.map((rule) => (rule.id === ruleId ? { ...rule, run } : rule)),
  )
  return written.rules?.find((rule) => rule.id === ruleId) ?? null
}

/*==========================================
 * A RULE'S RUN: apply it everywhere, or take it away.
 *=========================================*/

const RUN_PAGE = 200

/**
 * One budgeted pass of a rule's run, with the progress written on the rule
 * after every page so a reopened settings page shows where it stands and
 * `rule-continue` picks up from the cursor.
 *
 * `apply` walks the object's whole collection by document id — a rule
 * matches on fields no index narrows to (a facet's tags, a site that
 * captured the person) — and writes only the records whose sharing moves.
 * `remove` asks for exactly the records the rule holds a grant on
 * (`sharing.ruleIds`), each of which the recompute then takes it off; a
 * page that makes no progress fails the run rather than looping.
 */
export async function advanceSharingRuleRun(
  firestore: Firestore,
  orgId: string,
  ruleId: string,
  deadlineMs: number,
): Promise<{ rule: CrmSharingRule | null; more: boolean }> {
  const read = await crmSharingRulesOf(firestore, orgId, { fresh: true })
  let rule = read.rules.find((entry) => entry.id === ruleId) ?? null
  if (!rule?.run || rule.run.status !== 'running') return { rule, more: false }
  const records = firestore.collection('orgs').doc(orgId).collection(rule.object)
  let run: CrmSharingRuleRun = { ...rule.run }
  const seen = new Set<string>()
  try {
    while (Date.now() < deadlineMs) {
      const { rules } = await crmSharingRulesOf(firestore, orgId, { fresh: true })
      const context = await crmSharingContextFor(firestore, orgId, rules, rule.object)
      let page: FirebaseFirestore.QuerySnapshot
      if (run.mode === 'apply') {
        let query = records.orderBy(FieldPath.documentId()).limit(RUN_PAGE)
        if (run.cursor) query = query.startAfter(run.cursor)
        page = await query.get()
      } else {
        page = await records.where(CRM_SHARING_RULE_IDS_PATH, 'array-contains', ruleId).limit(RUN_PAGE).get()
      }
      const atMs = Date.now()
      // Only the records whose sharing would move are written.
      const moving = page.docs
        .filter((doc) => {
          const record = (doc.data() ?? {}) as Record<string, unknown>
          const plan = planRecordSharing(
            record,
            evaluateRecordGrants(rule!.object, record, rules, atMs, context),
          )
          return sharingPlanChanges(record, plan)
        })
        .map((doc) => doc.id)
      if (run.mode === 'remove' && page.docs.length && page.docs.every((doc) => seen.has(doc.id))) {
        throw new Error('the rule’s grants did not come off these records')
      }
      for (const doc of page.docs) seen.add(doc.id)
      const outcome = await recomputeMany(
        { firestore, orgId, object: rule.object, rules, fresh: true, context, atMs },
        moving,
      )
      const done = run.mode === 'apply' ? page.size < RUN_PAGE : page.empty
      run = {
        ...run,
        processed: run.processed + page.size,
        changed: run.changed + outcome.changed.length,
        cursor: run.mode === 'apply' ? (page.docs[page.docs.length - 1]?.id ?? run.cursor ?? null) : null,
        ...(done ? { status: 'done' as const, finishedAtMs: Date.now() } : {}),
      }
      rule = await writeRun(firestore, orgId, ruleId, run, {
        dropRule: done && rule.deleting === true,
      })
      if (done || !rule) return { rule, more: false }
    }
    return { rule, more: true }
  } catch (error) {
    console.error('[crm] a sharing rule run failed', orgId, ruleId, error)
    rule = await writeRun(firestore, orgId, ruleId, {
      ...run,
      status: 'failed',
      finishedAtMs: Date.now(),
      error: 'The recompute stopped. Resume it to carry on from where it stopped.',
    })
    return { rule, more: false }
  }
}

/*==========================================
 * THE ROUTE.
 *=========================================*/

/** How long one request works on a rule before it answers and the page asks again. */
const RUN_BUDGET_MS = 20_000

const MANAGERS_ONLY =
  'Sharing records across sites is for the workspace’s owners and admins.'

function readIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const ids = [
    ...new Set(
      raw.map((entry) => String(entry ?? '').trim().slice(0, 256)).filter((id) => id && !id.includes('/')),
    ),
  ].slice(0, CRM_SHARING_IDS_MAX)
  return ids.length ? ids : null
}

/**
 * `POST /api/crm/sharing` — `{ action, hostId | orgId, … }`.
 *
 * Every action but `evaluate` is an org manager's: an OWNER or ADMIN of the
 * whole workspace (`authorizeOrgCaller(…, 'manage-org')`), under a site's
 * hub or the org's. `evaluate` is what a client-direct write owes the rules
 * and is open to whoever may write the CRM. The plan gate is the CRM's own
 * (`crmSuiteRefusal`): sharing is only meaningful across several sites, and
 * the number of sites a workspace may have is already the plan's.
 */
export const crmSharingHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const scope = readCrmRouteScope(body)
  if (!scope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const action = String(body['action'] ?? '')
  const firestore = firebaseAdmin.app().firestore()
  try {
    if (action === 'evaluate') {
      const object = body['object']
      const ids = readIds(body['ids'])
      if (!isCrmSharingObject(object) || !ids) {
        res.status(400).json({ error: 'Name the records.' })
        return
      }
      const writer = await authorizeCrmWriter(req, scope, { suiteAct: null })
      if (writer.ok === false) {
        res.status(writer.status).json(writer.body)
        return
      }
      const outcome = await evaluateCrmSharing(firestore, writer.orgId, object, ids)
      const answer: CrmSharingResponse = { ok: true, ...outcome }
      res.status(200).json(answer)
      return
    }

    const orgId =
      scope.level === 'org'
        ? scope.orgId
        : ((await getOrgForHost(scope.hostId).catch(() => null))?.orgId ?? '')
    if (!orgId) {
      res.status(404).json({ error: 'This site has no organization, so it has no CRM.' })
      return
    }
    const caller = await authorizeOrgCaller(req, orgId, {
      needs: 'manage-org',
      refusal: MANAGERS_ONLY,
    })
    if (caller.ok === false) {
      res.status(caller.status).json({ error: caller.error })
      return
    }
    const suite = crmSuiteRefusal(caller.org, 'Sharing records across sites')
    if (suite) {
      res.status(suite.status).json(suite.body)
      return
    }
    const actor = { uid: caller.uid, email: caller.email }
    const byName = caller.name || caller.email || ''
    const nowMs = Date.now()

    if (action === 'sites') {
      const answer: CrmSharingResponse = { ok: true, sites: await crmSharingSites(firestore, orgId) }
      res.status(200).json(answer)
      return
    }

    if (action === 'share' || action === 'unshare') {
      const object = body['object']
      const ids = readIds(body['ids'])
      if (!isCrmSharingObject(object) || !ids) {
        res.status(400).json({ error: 'Name the records to share.' })
        return
      }
      const targets = shareTargetsFrom(body['targets'])
      if (!targets) {
        res.status(400).json({ error: 'Choose the sites, or All sites.' })
        return
      }
      const sites = await crmSharingSites(firestore, orgId)
      const own = new Set(sites.map((site) => site.id))
      if (hostIdsFromScope(targets).some((id) => !own.has(id))) {
        res.status(400).json({ error: 'A site named is not one of this organization’s.' })
        return
      }
      const access: CrmShareAccess = body['access'] === 'edit' ? 'edit' : 'read'
      const { rules, fresh } = await crmSharingRulesOf(firestore, orgId)
      const context = await crmSharingContextFor(firestore, orgId, rules, object)
      const outcome = await recomputeMany(
        {
          firestore,
          orgId,
          object,
          rules,
          fresh,
          context,
          atMs: nowMs,
          manual: (grants) =>
            action === 'share'
              ? withManualShares(grants, targets, access, { uid: caller.uid, name: byName }, nowMs)
              : withoutManualShares(grants, targets),
        },
        ids,
      )
      const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? 'a site'
      const named = describeShareTargets(targets, siteName)
      const sentence =
        action === 'share'
          ? `Shared with ${named}${access === 'edit' ? ' (read and edit)' : ' (read-only)'}`
          : `Stopped sharing with ${named}`
      await Promise.all(
        outcome.changed.map((id) =>
          fileSharingActivity(firestore, {
            orgId,
            object,
            id,
            body: sentence,
            targets,
            by: { uid: caller.uid, name: byName },
            atMs: nowMs,
          }),
        ),
      )
      if (outcome.changed.length) {
        const label = CRM_SHARING_OBJECT_LABELS[object]
        await logOrgActivity(
          orgId,
          actor,
          outcome.changed.length === 1
            ? `${sentence}: one ${label.one}`
            : `${sentence}: ${outcome.changed.length} ${label.many.toLowerCase()}`,
          {
            type: ORG_TARGET[object],
            ...(outcome.changed.length === 1 ? { id: outcome.changed[0] } : {}),
          },
        ).catch(() => undefined)
      }
      const answer: CrmSharingResponse = {
        ok: true,
        changed: outcome.changed.length,
        missing: outcome.missing,
      }
      res.status(200).json(answer)
      return
    }

    if (action === 'rule-save') {
      const hostIds = await orgHostIds(firestore, orgId)
      const raw = body['rule']
      const ruleId = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>)['id'] ?? '') : ''
      let saved: CrmSharingRule | null = null
      let error: string | null = null
      const written = await writeRules(firestore, orgId, (rules) => {
        const existing = ruleId ? (rules.find((rule) => rule.id === ruleId) ?? null) : null
        if (ruleId && !existing) return { error: 'That rule no longer exists.' }
        if (existing?.deleting) return { error: 'That rule is being deleted.' }
        if (!existing && rules.length >= CRM_SHARING_RULES_MAX) {
          return { error: `A workspace keeps at most ${CRM_SHARING_RULES_MAX} sharing rules.` }
        }
        const judged = ruleFromRequest(raw, { hostIds, existing, uid: caller.uid, nowMs })
        if (!judged.rule) {
          error = judged.error
          return { error: judged.error }
        }
        /*
         * An enabled rule walks every record — it may now match some and not
         * others. A disabled one only has grants to take away, and asks for
         * exactly the records holding them.
         */
        saved = {
          ...judged.rule,
          run: {
            status: 'running',
            mode: judged.rule.enabled ? 'apply' : 'remove',
            processed: 0,
            changed: 0,
            cursor: null,
            startedAtMs: nowMs,
          },
        }
        return existing
          ? rules.map((rule) => (rule.id === existing.id ? saved! : rule))
          : [...rules, saved]
      })
      if (!written.rules || !saved) {
        res.status(400).json({ error: error ?? written.error ?? 'The rule could not be saved.' })
        return
      }
      const rule = saved as CrmSharingRule
      await logOrgActivity(
        orgId,
        actor,
        `${ruleId ? 'Changed' : 'Added'} the sharing rule “${rule.name}”`,
        { type: `${BUNDLE_ID}:sharingRule`, id: rule.id, name: rule.name },
      ).catch(() => undefined)
      const advanced = await advanceSharingRuleRun(firestore, orgId, rule.id, Date.now() + RUN_BUDGET_MS)
      const answer: CrmSharingResponse = { ok: true, rule: advanced.rule, more: advanced.more }
      res.status(200).json(answer)
      return
    }

    if (action === 'rule-delete' || action === 'rule-continue') {
      const ruleId = String(body['ruleId'] ?? '').trim()
      if (!ruleId) {
        res.status(400).json({ error: 'Name the rule.' })
        return
      }
      if (action === 'rule-delete') {
        let name = ''
        const written = await writeRules(firestore, orgId, (rules) => {
          const existing = rules.find((rule) => rule.id === ruleId)
          if (!existing) return { error: 'That rule no longer exists.' }
          name = existing.name
          return rules.map((rule) =>
            rule.id === ruleId
              ? {
                  ...rule,
                  enabled: false,
                  deleting: true,
                  updatedAtMs: nowMs,
                  run: {
                    status: 'running' as const,
                    mode: 'remove' as const,
                    processed: 0,
                    changed: 0,
                    cursor: null,
                    startedAtMs: nowMs,
                  },
                }
              : rule,
          )
        })
        if (!written.rules) {
          res.status(404).json({ error: written.error })
          return
        }
        await logOrgActivity(orgId, actor, `Deleted the sharing rule “${name}”`, {
          type: `${BUNDLE_ID}:sharingRule`,
          id: ruleId,
          name,
        }).catch(() => undefined)
      } else {
        // A failed run resumes from its cursor.
        await writeRules(firestore, orgId, (rules) =>
          rules.map((rule) =>
            rule.id === ruleId && rule.run?.status === 'failed'
              ? { ...rule, run: { ...rule.run, status: 'running' as const } }
              : rule,
          ),
        )
      }
      const advanced = await advanceSharingRuleRun(firestore, orgId, ruleId, Date.now() + RUN_BUDGET_MS)
      const answer: CrmSharingResponse = { ok: true, rule: advanced.rule, more: advanced.more }
      res.status(200).json(answer)
      return
    }

    res.status(400).json({ error: 'Unknown sharing action.' })
  } catch (error) {
    console.error('[crm] sharing failed', action, error)
    res.status(500).json({ error: 'The sharing could not be saved. Try again.' })
  }
}

