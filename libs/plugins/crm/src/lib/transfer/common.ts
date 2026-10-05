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

/*==========================================
 * WHAT EVERY CRM TRANSFER RESOURCE SHARES (AGL-3527) — the server half.
 *
 * The CRM's records live under the organization, each stamped with the
 * site that captured it and the `visibleTo` tokens that say who reads it.
 * A transfer is opened from the CRM under a site, or at the organization
 * level; the job engine hands every hook the workspace and that site
 * (`ctx.hostId`), and this module turns the pair into what the CRM's own
 * routes compute from a request: the org document, the site's consent
 * group, the tokens a record must carry to be seen from the site, and the
 * stamp a record created by the import carries.
 *
 * ## Refusals are the routes' refusals
 *
 * The transfer routes check `data.manage`; what is particular to the CRM —
 * its suite on the plan, a site to file new records under — is checked here
 * and thrown as the engine's own `TransferEngineError`, so the wizard shows
 * the sentence a CRM route would have answered.
 *=========================================*/

import {
  checkCrmRecordsQuota,
  checkEntitlement,
  consentGroupForHost,
  type ConsentGroup,
  type ContactCustomValue,
  type ContactFieldDefinition,
  CRM_COLLECTIONS,
  type CrmFieldObject,
  crmPicklistDefinition,
  crmReadTokens,
  crmScopeTokens,
  effectiveCrmPicklist,
  fieldDefinitionsForObject,
  isCrmPicklistId,
  newResourceScopeFields,
  normalizeCrmPicklist,
  ORG_SCOPE_TOKEN,
  planLabelGrantingFeature,
  readCrmCustomInput,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
} from '@aglyn/aglyn/app-utils/crm'
import type { PicklistValue } from '@aglyn/aglyn/app-utils/picklists'
import type { AglynPostalAddress } from '@aglyn/aglyn/foundation/definitions/contact.types'
import { normalizeAddress } from '@aglyn/aglyn/foundation/definitions/contact.types'
import {
  matchLookupKey,
  rankTransferLookupSuggestions,
  transferLookupKey,
  type MatchLookupRequest,
  type PlannedTransferRow,
  type TransferPlan,
  type TransferWarning,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferLookupResult,
  TransferLookupTargetHooks,
  TransferPicklistList,
  TransferReadOptions,
  TransferReadPage,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { crmRecordsQuotaForOrg, firebaseAdmin, listOrgMembers } from '@aglyn/tenant-data-admin'
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'
import { TransferEngineError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { crmSuiteRefusal } from '../server/suite-gate'
import {
  CRM_ADDRESS_PART_KEYS,
  CRM_ADDRESS_PARTS,
  CRM_LIFECYCLE_STAGE_PICKLIST,
  crmCustomPicklistKey,
} from './fields'

/** The most values one Firestore `in` filter takes. */
export const IN_LIMIT = 30

/** Documents read per page of an export. */
export const EXPORT_PAGE = 500

/** Rows written at once by an apply. */
export const APPLY_CONCURRENCY = 8

/** A row is started only while this much of the chunk's budget is left. */
export const APPLY_ROW_BUDGET_MS = 3_000

/** Who is moving CRM records, resolved. */
export interface CrmTransferEnv {
  firestore: FirebaseFirestore.Firestore
  orgRef: FirebaseFirestore.DocumentReference
  org: Record<string, unknown>
  orgId: string
  /** The site the transfer was opened under, or `null` at the organization level. */
  hostId: string | null
  /** That site's consent group — whose facet a contact is read and written through. */
  group: ConsentGroup | null
  /** What a record must carry to be seen from the site; `null` at the organization level. */
  siteTokens: string[] | null
}

/** The org, the site and its tokens, for one hook call. */
export async function crmTransferEnv(ctx: TransferResourceContext): Promise<CrmTransferEnv> {
  const firestore = firebaseAdmin.app().firestore()
  const orgRef = firestore.collection('orgs').doc(ctx.orgId)
  const snapshot = await orgRef.get()
  if (!snapshot.exists) throw new TransferEngineError('notFound', 404, 'No such workspace.')
  const org = (snapshot.data() ?? {}) as Record<string, unknown>
  const group = ctx.hostId ? consentGroupForHost(org, ctx.hostId) : null
  return {
    firestore,
    orgRef,
    org,
    orgId: ctx.orgId,
    hostId: ctx.hostId,
    group,
    siteTokens: group ? crmReadTokens(group) : null,
  }
}

/** Refuses an act the organization's plan does not include — the CRM routes' own sentence. */
export function requireCrmSuite(env: CrmTransferEnv, act: string): void {
  const refusal = crmSuiteRefusal(env.org, act)
  if (refusal) throw new TransferEngineError('forbidden', 403, refusal.body.error, { reason: refusal.body.reason })
}

/**
 * Refuses reading the CRM's own records (not the people files) on a plan
 * without the CRM: the export route's rule since AGL-2839.
 */
export function requireCrmRecords(env: CrmTransferEnv, what: string): void {
  if (checkEntitlement(env.org as never, 'crm')) return
  const plan = planLabelGrantingFeature('crm')
  throw new TransferEngineError(
    'forbidden',
    403,
    `Exporting ${what} is part of the CRM, which is not included in your current plan.` +
      (plan ? ` Included from ${plan}.` : ''),
    { reason: 'plan_required' },
  )
}

/**
 * The site new records are filed under, or the refusal: every CRM record is
 * a fact some site met, so an import opened at the organization level must
 * name one first.
 */
export function requireSite(env: CrmTransferEnv, what: string): { hostId: string; group: ConsentGroup } {
  if (!env.hostId || !env.group) {
    throw new TransferEngineError('invalid', 400, `Choose the site these ${what} are imported into.`)
  }
  return { hostId: env.hostId, group: env.group }
}

/** The stamp a record the import creates carries: the site, and who reads it. */
export function creationScope(env: CrmTransferEnv, actorUid: string | null): Record<string, unknown> {
  const { hostId, group } = requireSite(env, 'records')
  return {
    hostId,
    visibleTo: crmScopeTokens(env.org, group),
    ...(actorUid ? { createdByUid: actorUid } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

/** Whether a stored record may be read in this transfer: the site's view, and a scoped reader's own tokens. */
export function visibleIn(
  env: CrmTransferEnv,
  visibleTo: unknown,
  scopeTokens?: readonly string[],
): boolean {
  const tokens = Array.isArray(visibleTo) ? (visibleTo as string[]) : []
  if (env.siteTokens && !visibleToTokens(tokens, env.siteTokens)) return false
  if (scopeTokens?.length && !visibleToTokens(tokens, scopeTokens)) return false
  return true
}

/*==========================================
 * CUSTOM FIELDS AND PICKLISTS
 *=========================================*/

/** The organization's live custom field definitions for one kind of record, as the site reads them. */
export async function crmCustomDefinitions(
  env: CrmTransferEnv,
  object: CrmFieldObject,
): Promise<ContactFieldDefinition[]> {
  const snapshot = await env.orgRef.collection(CRM_COLLECTIONS.contactFields).limit(200).get()
  return fieldDefinitionsForObject(
    snapshot.docs.map((doc) => doc.data() as ContactFieldDefinition),
    object,
  ).filter(
    (field) =>
      Boolean(field.key) &&
      !field.retiredAt &&
      (!env.siteTokens || visibleToTokens(field.visibleTo, env.siteTokens)),
  )
}

/** The lifecycle stages as a fixed list: matched onto, never added to. */
const LIFECYCLE_LIST: TransferPicklistList = {
  spec: {
    restricted: true,
    standardValues: CONTACT_LIFECYCLE_STAGES.map((id) => ({ id, label: CONTACT_LIFECYCLE_STAGE_LABELS[id] })),
  },
  set: {
    values: CONTACT_LIFECYCLE_STAGES.map((id) => ({ id, label: CONTACT_LIFECYCLE_STAGE_LABELS[id], active: true })),
    defaultValueId: null,
  },
}

/**
 * The lists behind the picklist fields a catalog names: the CRM's own
 * (`crmPicklists`), the lifecycle stages, and each custom `select` field's
 * options — a select is a fixed list the import maps onto.
 */
export async function crmPicklistLists(
  env: CrmTransferEnv,
  picklistIds: readonly string[],
  customDefinitions: readonly ContactFieldDefinition[],
): Promise<Record<string, TransferPicklistList>> {
  const lists: Record<string, TransferPicklistList> = {}
  const crmIds = picklistIds.filter(isCrmPicklistId)
  const snapshots = crmIds.length
    ? await env.firestore.getAll(...crmIds.map((id) => env.orgRef.collection(CRM_COLLECTIONS.picklists).doc(id)))
    : []
  crmIds.forEach((id, at) => {
    const definition = crmPicklistDefinition(id)
    if (!definition) return
    lists[id] = { spec: definition, set: effectiveCrmPicklist(id, snapshots[at]?.data()) }
  })
  for (const id of picklistIds) {
    if (id === CRM_LIFECYCLE_STAGE_PICKLIST) {
      lists[id] = LIFECYCLE_LIST
      continue
    }
    const custom = crmCustomPicklistKey(id)
    if (!custom) continue
    const definition = customDefinitions.find((entry) => entry.key === custom.key)
    if (!definition) continue
    const options = (definition.options ?? []).map((option) => String(option)).filter(Boolean)
    lists[id] = {
      spec: { restricted: true, standardValues: options.map((label, index) => ({ id: `o${index}`, label })) },
      set: { values: options.map((label, index) => ({ id: `o${index}`, label, active: true })), defaultValueId: null },
    }
  }
  return lists
}

/**
 * Adds the values the person chose to add to one of the CRM's picklists —
 * in a transaction, so an admin editing the list at the same moment loses
 * nothing — skipping an id or a label the list already holds, so a retried
 * apply adds nothing twice. A value whose meaning only the platform sets
 * (a lead Qualified by conversion) is never added. Fixed lists (the stages,
 * a select's options) take nothing.
 */
export async function addCrmPicklistValues(
  env: CrmTransferEnv,
  picklistId: string,
  values: readonly PicklistValue[],
): Promise<void> {
  if (!isCrmPicklistId(picklistId)) return
  const definition = crmPicklistDefinition(picklistId)
  if (!definition) return
  const ref = env.orgRef.collection(CRM_COLLECTIONS.picklists).doc(picklistId)
  await env.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const current = effectiveCrmPicklist(picklistId, snapshot.data())
    const held = new Set(current.values.map((value) => value.id))
    const labels = new Set(current.values.map((value) => value.label.toLowerCase()))
    const added = values.filter(
      (value) =>
        !held.has(value.id) &&
        !labels.has(value.label.toLowerCase()) &&
        !(value.meaning && definition.reservedMeanings?.includes(value.meaning)),
    )
    if (!added.length) return
    const created = normalizeCrmPicklist(snapshot.data()) === null
    transaction.set(
      ref,
      {
        values: [...current.values, ...added.map((value) => ({ ...value, active: true }))],
        defaultValueId: current.defaultValueId,
        updatedAt: FieldValue.serverTimestamp(),
        ...(created
          ? {
              hostId: env.hostId,
              createdAt: FieldValue.serverTimestamp(),
              ...newResourceScopeFields([ORG_SCOPE_TOKEN]),
            }
          : {}),
      },
      { merge: true },
    )
  })
}

/*==========================================
 * THE WORKSPACE'S MEMBERS — the owner columns' target
 *=========================================*/

/** A member as an owner column may name them. */
interface MemberEntry {
  id: string
  email: string
  name: string
}

async function memberEntries(orgId: string): Promise<MemberEntry[]> {
  return (await listOrgMembers(orgId))
    .filter((member) => member.$id && member.orgSuspended !== true)
    .map((member) => ({
      id: String(member.$id),
      email: String(member.email ?? '').trim().toLowerCase(),
      name: String(member.displayName ?? '').trim(),
    }))
}

/**
 * The workspace's members as a lookup target: by id, email or display name,
 * with names like an unresolved one offered — so a Salesforce report's
 * "Contact Owner" (a full name) resolves as well as an address does.
 */
export function crmMembersTarget(): TransferLookupTargetHooks {
  return {
    matchKeys: [
      { fieldId: 'email', normalizer: 'email' },
      { fieldId: 'name', normalizer: 'caseless' },
    ],
    async lookup(ctx, requests) {
      const members = await memberEntries(ctx.orgId)
      const lookup = new Map<string, string[]>()
      const records = new Map<string, Readonly<Record<string, unknown>>>()
      for (const request of requests) {
        for (const value of request.values) {
          const found = members.filter((member) =>
            request.fieldId === 'id'
              ? member.id === value
              : request.fieldId === 'email'
                ? member.email === value.toLowerCase()
                : member.name.toLowerCase() === value.toLowerCase(),
          )
          if (!found.length) continue
          lookup.set(matchLookupKey(request.fieldId, value), found.map((member) => member.id))
          for (const member of found) records.set(member.id, { name: member.name || member.email, email: member.email })
        }
      }
      return { lookup, records }
    },
    async suggest(ctx, request) {
      const members = await memberEntries(ctx.orgId)
      const candidates = members.flatMap((member) => [
        { recordId: member.id, label: member.email },
        ...(member.name ? [{ recordId: member.id, label: member.name }] : []),
      ])
      return Object.fromEntries(
        request.values.map((value) => [value, rankTransferLookupSuggestions(value, candidates)]),
      )
    },
  }
}

/** Member uid → email, for the owner columns of an export. */
export async function crmMemberEmails(orgId: string): Promise<Map<string, string>> {
  return new Map((await memberEntries(orgId)).map((member) => [member.id, member.email]))
}

/*==========================================
 * READING RECORDS
 *=========================================*/

/** A list's filter, as the export dialog carries it: the plan the list's own query was built from. */
export interface CrmExportFilter {
  filters: Array<{ path: string; op: FirebaseFirestore.WhereFilterOp; value: unknown }>
  orderBy: { path: string; direction: 'asc' | 'desc' }
}

const FILTER_OPS = new Set(['<', '<=', '==', '!=', '>=', '>', 'array-contains', 'in', 'not-in', 'array-contains-any'])

/** A filter value as the list sent it: a date travels as `{ $date }`. */
function filterValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { $date?: unknown }).$date === 'string') {
    return Timestamp.fromDate(new Date((value as { $date: string }).$date))
  }
  return Array.isArray(value) ? value.map(filterValue) : value
}

/** The list's filter, read from an untrusted body, or the refusal. */
export function readExportFilter(raw: Readonly<Record<string, unknown>> | undefined): CrmExportFilter | null {
  if (!raw) return null
  const filters = Array.isArray(raw['filters']) ? (raw['filters'] as unknown[]) : null
  const orderBy = raw['orderBy'] as CrmExportFilter['orderBy'] | undefined
  if (!filters || !orderBy || typeof orderBy.path !== 'string') {
    throw new TransferEngineError('invalid', 400, 'The list’s filter could not be read; export everything or a selection.')
  }
  return {
    filters: filters.map((entry) => {
      const filter = entry as { path?: unknown; op?: unknown; value?: unknown }
      if (typeof filter.path !== 'string' || !FILTER_OPS.has(String(filter.op))) {
        throw new TransferEngineError('invalid', 400, 'The list’s filter could not be read; export everything or a selection.')
      }
      return { path: filter.path, op: filter.op as FirebaseFirestore.WhereFilterOp, value: filterValue(filter.value) }
    }),
    orderBy: { path: orderBy.path, direction: orderBy.direction === 'desc' ? 'desc' : 'asc' },
  }
}

/**
 * The query an export reads: the list's filter, or every record the site
 * (or the scoped reader) sees, in document order. A list filter already
 * carries the reader's `visibleTo` clause when they are scoped, as the
 * rules require of the list; a filter that lacks it gets one, when it has
 * no other array clause, and is refused otherwise — so the count is exact
 * and no record outside the reader's scope is ever read.
 */
export function crmExportQuery(
  env: CrmTransferEnv,
  collection: FirebaseFirestore.CollectionReference,
  options: TransferReadOptions | undefined,
): FirebaseFirestore.Query {
  const filter = readExportFilter(options?.filter)
  const tokens = options?.scopeTokens?.length ? [...options.scopeTokens] : env.siteTokens
  if (filter) {
    const scoped = filter.filters.some((entry) => entry.path === 'visibleTo')
    const array = filter.filters.some((entry) => entry.op === 'array-contains' || entry.op === 'array-contains-any')
    if (tokens && !scoped) {
      if (array) {
        throw new TransferEngineError('invalid', 400, 'This filter cannot be exported from here; export everything or a selection.')
      }
      return applyListQuery(collection.where('visibleTo', 'array-contains-any', tokens), filter)
    }
    return applyListQuery(collection, filter)
  }
  const base = tokens ? collection.where('visibleTo', 'array-contains-any', tokens) : collection
  return base.orderBy(FieldPath.documentId())
}

/** How many records an export with these options reads. */
export async function countCrmExport(
  env: CrmTransferEnv,
  collection: FirebaseFirestore.CollectionReference,
  options: TransferReadOptions,
  visible: (data: Record<string, unknown>) => boolean,
): Promise<number> {
  if (options.ids) {
    let count = 0
    for (let at = 0; at < options.ids.length; at += EXPORT_PAGE) {
      const refs = options.ids.slice(at, at + EXPORT_PAGE).filter((id) => id && !id.includes('/')).map((id) => collection.doc(id))
      if (!refs.length) continue
      for (const snapshot of await env.firestore.getAll(...refs)) {
        if (snapshot.exists && visible(snapshot.data() ?? {})) count += 1
      }
    }
    return count
  }
  return Number((await crmExportQuery(env, collection, options).count().get()).data().count ?? 0)
}

/**
 * One page of an export: the selection by id (in the order given), or the
 * query's next page after the cursor. Every document is checked against the
 * site's and the reader's tokens before it becomes a row.
 */
export async function readCrmExportPage(
  env: CrmTransferEnv,
  collection: FirebaseFirestore.CollectionReference,
  cursor: string | null,
  options: TransferReadOptions | undefined,
  visible: (data: Record<string, unknown>) => boolean,
  toRows: (docs: Array<{ id: string; data: Record<string, unknown> }>) => Promise<Array<Record<string, unknown>>>,
): Promise<TransferReadPage> {
  const size = Math.min(options?.pageSize ?? EXPORT_PAGE, EXPORT_PAGE)
  if (options?.ids) {
    const start = cursor ? Number(cursor) || 0 : 0
    const ids = options.ids.slice(start, start + size).filter((id) => id && !id.includes('/'))
    const snapshots = ids.length ? await env.firestore.getAll(...ids.map((id) => collection.doc(id))) : []
    const docs = snapshots
      .filter((snapshot) => snapshot.exists && visible(snapshot.data() ?? {}))
      .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() ?? {} }))
    const next = start + size < options.ids.length ? String(start + size) : null
    return { rows: await toRows(docs), next }
  }
  let query = crmExportQuery(env, collection, options).limit(size)
  if (cursor) {
    const after = await collection.doc(cursor).get()
    if (after.exists) query = query.startAfter(after)
  }
  const snapshot = await query.get()
  const docs = snapshot.docs
    .filter((doc) => visible(doc.data() ?? {}))
    .map((doc) => ({ id: doc.id, data: doc.data() ?? {} }))
  const last = snapshot.docs[snapshot.docs.length - 1]
  return { rows: await toRows(docs), next: snapshot.docs.length === size && last ? last.id : null }
}

/**
 * Records by each requested value of one stored field, thirty to an `in`
 * query; `fold` turns a requested value into the stored one. The answer is
 * filed under the value AS REQUESTED, which is the key the engine asks by.
 */
export async function lookupByField(
  collection: FirebaseFirestore.CollectionReference,
  request: MatchLookupRequest,
  storedField: string,
  fold: (value: string) => string,
  visible: (data: Record<string, unknown>) => boolean,
  into: { lookup: Map<string, string[]>; docs: Map<string, Record<string, unknown>> },
): Promise<void> {
  const byStored = new Map<string, string[]>()
  for (const value of request.values) {
    const stored = fold(value)
    if (!stored) continue
    byStored.set(stored, [...(byStored.get(stored) ?? []), value])
  }
  const keys = [...byStored.keys()]
  for (let at = 0; at < keys.length; at += IN_LIMIT) {
    const page = keys.slice(at, at + IN_LIMIT)
    const snapshot = await collection.where(storedField, 'in', page).get()
    for (const doc of snapshot.docs) {
      const data = doc.data() ?? {}
      if (!visible(data)) continue
      into.docs.set(doc.id, data)
      for (const value of byStored.get(String(data[storedField] ?? '')) ?? []) {
        const key = matchLookupKey(request.fieldId, value)
        into.lookup.set(key, [...new Set([...(into.lookup.get(key) ?? []), doc.id])])
      }
    }
  }
}

/** Records by id, the ones the transfer may read. */
export async function lookupById(
  env: CrmTransferEnv,
  collection: FirebaseFirestore.CollectionReference,
  request: MatchLookupRequest,
  visible: (data: Record<string, unknown>) => boolean,
  into: { lookup: Map<string, string[]>; docs: Map<string, Record<string, unknown>> },
): Promise<void> {
  const ids = request.values.filter((id) => id && !id.includes('/'))
  for (let at = 0; at < ids.length; at += EXPORT_PAGE) {
    const page = ids.slice(at, at + EXPORT_PAGE)
    const snapshots = await env.firestore.getAll(...page.map((id) => collection.doc(id)))
    for (const snapshot of snapshots) {
      const data = snapshot.data()
      if (!snapshot.exists || !data || !visible(data)) continue
      into.docs.set(snapshot.id, data)
      into.lookup.set(matchLookupKey(request.fieldId, snapshot.id), [snapshot.id])
    }
  }
}

/** A lookup answer from the documents found, each read into values by `read`. */
export function lookupResult(
  found: { lookup: Map<string, string[]>; docs: Map<string, Record<string, unknown>> },
  read: (id: string, data: Record<string, unknown>) => Record<string, unknown>,
): TransferLookupResult {
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  for (const [id, data] of found.docs) records.set(id, read(id, data))
  return { lookup: found.lookup, records }
}

/*==========================================
 * VALUES
 *=========================================*/

/** Epoch milliseconds from a stored timestamp (a Firestore `Timestamp`, a `Date` or a number), or `null`. */
export function storedMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  const date = (value as { toDate?: () => Date } | null | undefined)?.toDate?.()
  return date ? date.getTime() : null
}

/** An instant as the export writes it (ISO), or `null`. */
export function isoOf(value: unknown): string | null {
  const ms = storedMs(value)
  return ms === null ? null : new Date(ms).toISOString()
}

/** A postal address as the six values `<prefix>Street` … `<prefix>Country`. */
export function addressValues(prefix: string, address: unknown): Record<string, string | null> {
  const stored = (address && typeof address === 'object' ? address : {}) as Record<string, unknown>
  return Object.fromEntries(
    CRM_ADDRESS_PARTS.map((part) => {
      const value = stored[CRM_ADDRESS_PART_KEYS[part]]
      return [`${prefix}${part}`, typeof value === 'string' && value ? value : null]
    }),
  )
}

/**
 * The address a row's parts make, over the one the record holds: a part
 * the row names (blank clears it) replaces the stored part. `undefined`
 * when the row names no part; `null` when nothing of the address is left.
 */
export function addressFromValues(
  prefix: string,
  values: Readonly<Record<string, unknown>>,
  stored: unknown,
): AglynPostalAddress | null | undefined {
  const named = CRM_ADDRESS_PARTS.filter((part) => `${prefix}${part}` in values)
  if (!named.length) return undefined
  const base = (stored && typeof stored === 'object' ? { ...(stored as Record<string, unknown>) } : {}) as Record<string, unknown>
  for (const part of named) {
    const value = values[`${prefix}${part}`]
    base[CRM_ADDRESS_PART_KEYS[part]] = typeof value === 'string' ? value.trim() : ''
  }
  const country = String(base['country'] ?? '').trim()
  return normalizeAddress({
    line1: String(base['line1'] ?? ''),
    line2: String(base['line2'] ?? ''),
    city: String(base['city'] ?? ''),
    state: String(base['state'] ?? ''),
    postalCode: String(base['postalCode'] ?? ''),
    country: country.length === 2 ? country.toUpperCase() : country,
  } as AglynPostalAddress)
}

/** A planned row's values: each changed field's new value. */
export function plannedValues(row: PlannedTransferRow): Record<string, unknown> {
  return Object.fromEntries(row.diff.map((change) => [change.fieldId, change.after]))
}

/** Only `keys` of `values`, each present (a missing one as `null`). */
export function pickValues(values: Readonly<Record<string, unknown>>, keys: Iterable<string>): Record<string, unknown> {
  return Object.fromEntries([...keys].map((key) => [key, values[key] ?? null]))
}

/** A text value, trimmed, or `''`. */
export function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

/** A lookup cell's display key, for caching records a chunk creates by name. */
export function nameKey(value: string): string {
  return transferLookupKey(value)
}

/*------------------------------------------
 * Custom values
 *-----------------------------------------*/

/** The custom key a `custom:<key>` field id names, or `null`. */
export function customKeyOf(fieldId: string): string | null {
  return fieldId.startsWith('custom:') ? fieldId.slice('custom:'.length) : null
}

/**
 * A stored custom value as the file reads it: a date (stored as epoch
 * milliseconds) as its day, `YYYY-MM-DD`; anything else as stored.
 */
export function customTransferValue(
  definition: Pick<ContactFieldDefinition, 'type'> | undefined,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return null
  if (definition?.type === 'date') {
    const ms = storedMs(value)
    return ms === null ? null : new Date(ms).toISOString().slice(0, 10)
  }
  return value
}

/** Every custom field a record holds, as `custom:<key>` values. */
export function customTransferValues(
  definitions: readonly ContactFieldDefinition[],
  stored: unknown,
): Record<string, unknown> {
  const custom = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  return Object.fromEntries(
    definitions.map((definition) => [`custom:${definition.key}`, customTransferValue(definition, custom[definition.key])]),
  )
}

/**
 * The custom values a row writes, judged by the CRM's own reader
 * (`readCrmCustomInput`): a blank clears (`null`), a date is read from its
 * day. Answers the values, or the first refusal.
 */
export function customWriteValues(
  values: Readonly<Record<string, unknown>>,
  definitions: readonly ContactFieldDefinition[],
  object: CrmFieldObject,
): { values: Record<string, ContactCustomValue> } | { error: string } {
  const raw: Record<string, unknown> = {}
  for (const [fieldId, value] of Object.entries(values)) {
    const key = customKeyOf(fieldId)
    if (key) raw[key] = value === undefined || value === '' ? null : value
  }
  if (!Object.keys(raw).length) return { values: {} }
  const judged = readCrmCustomInput(raw, definitions as ContactFieldDefinition[], object)
  if ('errors' in judged) return { error: Object.values(judged.errors)[0] ?? 'A custom value could not be saved.' }
  return { values: judged.values }
}

/*==========================================
 * PLANS — values a plugin rule holds back
 *=========================================*/

/**
 * Removes the changes `decide` refuses from a plan, as a locked rule's: the
 * field is listed in the row's `heldBack`, the row gains a `lockedRule`
 * warning (acknowledged before Apply), and an update left with nothing to
 * write becomes `unchanged`. For a rule no field policy can say — a stage
 * that only moves forward, a flag a file may set and never clear.
 */
export function holdBackChanges(
  plan: TransferPlan,
  decide: (row: PlannedTransferRow, change: PlannedTransferRow['diff'][number]) => string | null,
): TransferPlan {
  const warnings = new Map<string, TransferWarning>(plan.warnings.map((warning) => [warning.class, { ...warning }]))
  const rows = plan.rows.map((row): PlannedTransferRow => {
    if (row.verdict !== 'update' && row.verdict !== 'create') return row
    const held: Array<{ fieldId: string; reason: string; value: unknown }> = []
    const diff = row.diff.filter((change) => {
      const reason = decide(row, change)
      if (!reason) return true
      held.push({ fieldId: change.fieldId, reason, value: change.after })
      return false
    })
    if (!held.length) return row
    const warning = warnings.get('lockedRule') ?? {
      class: 'lockedRule' as const,
      count: 0,
      rows: 0,
      fieldIds: [],
      samples: [],
      requiresAcknowledgement: true,
    }
    warning.rows += 1
    for (const entry of held) {
      warning.count += 1
      if (!warning.fieldIds.includes(entry.fieldId)) warning.fieldIds = [...warning.fieldIds, entry.fieldId]
      if (warning.samples.length < 5) {
        warning.samples = [
          ...warning.samples,
          { row: row.index, fieldId: entry.fieldId, value: textOf(entry.value), detail: entry.reason },
        ]
      }
    }
    warnings.set('lockedRule', warning)
    const verdict: PlannedTransferRow['verdict'] = row.verdict === 'update' && !diff.length ? 'unchanged' : row.verdict
    return {
      ...row,
      verdict,
      diff,
      heldBack: [...new Set([...row.heldBack, ...held.map((entry) => entry.fieldId)])],
      warnings: [...new Set([...row.warnings, 'lockedRule' as const])],
    }
  })
  const summary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  const list = plan.warnings.map((warning) => warnings.get(warning.class) ?? warning)
  const locked = warnings.get('lockedRule')
  if (locked && !plan.warnings.some((warning) => warning.class === 'lockedRule')) list.push(locked)
  return {
    rows,
    summary,
    warnings: list,
    acknowledgementsRequired: [...new Set([...plan.acknowledgementsRequired, ...(locked ? ['lockedRule' as const] : [])])],
  }
}

/*==========================================
 * WRITING
 *=========================================*/

/**
 * `write` over `items`, {@link APPLY_CONCURRENCY} at a time, starting an
 * item only while the chunk's budget lasts — the engine resumes the chunk
 * at the next call for whatever is left.
 */
export async function eachWithinBudget<T>(
  items: readonly T[],
  timeLeftMs: () => number,
  write: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      if (timeLeftMs() < APPLY_ROW_BUDGET_MS) return
      const item = items[next] as T
      next += 1
      await write(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(APPLY_CONCURRENCY, items.length) }, worker))
}

/**
 * The CRM records band for the records one apply call creates beside the
 * rows' own (a company a contact's company column names): counted once,
 * then each create admitted from that tally. A plan with an overage rate
 * always admits.
 */
export function crmRecordsRoom(env: CrmTransferEnv): () => Promise<boolean> {
  let counted: Promise<{ crmRecordsCount: number }> | null = null
  let created = 0
  return async () => {
    counted ??= crmRecordsQuotaForOrg(env.org as never, env.orgRef)
    const { crmRecordsCount } = await counted
    if (!checkCrmRecordsQuota(env.org as never, crmRecordsCount + created).allowed) return false
    created += 1
    return true
  }
}

/** A thrown write as the sentence a row's result carries. */
export function failureMessage(error: unknown): string {
  if (error instanceof TransferEngineError) return error.message
  return 'The record could not be saved.'
}

export { TransferEngineError }
