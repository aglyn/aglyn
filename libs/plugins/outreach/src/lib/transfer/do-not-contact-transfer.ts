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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { isPublicMailboxDomain } from '@aglyn/aglyn/app-utils/crm'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  buildTransferPlan,
  matchLookupKey,
  planTransferUndo,
  TRANSFER_ID_FIELD,
  transferIdField,
  withTransferResourceFindings,
  type BuildTransferPlanInput,
  type MatchLookupRequest,
  type PlannedTransferRow,
  type RowMatchOutcome,
  type TransferCatalogInput,
  type TransferField,
  type TransferLockedRule,
  type TransferPlan,
  type TransferPolicy,
  type TransferResourceFinding,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type {
  PluginTransferResource,
  TransferReadOptions,
  TransferRecordsHooks,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  LIST_QUERY_ID_PATH,
  planListQuery,
  type ListQueryPlan,
  type ListQueryRequest,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'
import { FieldPath } from 'firebase-admin/firestore'
import { OUTREACH_DNC_MATCH_KEYS } from '../constants/transfer-resources'
import { outreachDoNotContactKey } from '../engine/do-not-contact'
import { normalizeOutreachDomain, outreachEmailDomain } from '../engine/do-not-contact-domain'
import {
  outreachEntitlementRefusal,
  outreachMembershipRefusal,
  type OutreachMembership,
} from '../engine/outreach-access'
import { OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY } from '../model/do-not-contact-domain-list-query'
import {
  OUTREACH_DO_NOT_CONTACT_REASON_LABELS,
  OUTREACH_DO_NOT_CONTACT_SOURCE_LABELS,
  type OutreachDoNotContactEntry,
} from '../model/outreach.types'
import {
  addOutreachDoNotContact,
  addOutreachDoNotContactDomain,
  lookupOutreachDoNotContactDomains,
  outreachDoNotContactCollection,
  outreachDoNotContactDomainCollection,
  readOutreachDoNotContactDomainEntry,
  readOutreachDoNotContactEntry,
  removeOutreachDoNotContactDomain,
  removeOutreachDoNotContactEntry,
} from '../storage/do-not-contact-store'

/**
 * THE DO-NOT-CONTACT LIST AS A FILE: `outreach.do-not-contact`, an
 * organization's addresses and domains that no sequence emails.
 *
 * ## One file, two collections
 *
 * A row is one entry, and its Entry cell says which kind: an email address
 * goes to `orgs/{orgId}/outreachDoNotContact/{key}`, anything else that reads
 * as a domain to `orgs/{orgId}/outreachDoNotContactDomains/{domain}`. The
 * Aglyn ID names the kind too — `domain:<domain>` or `address:<key>` — so a
 * re-imported export finds its entries by id.
 *
 * ## Only ever added to
 *
 * Every entry is written once and never edited (the store's `create()`), and
 * the first reason an entry was added is the record of why it is there. An
 * import keeps that: a row that finds an entry already on the list is
 * skipped whatever the wizard's policy says (`plan` forces it), and only the
 * entries an import ADDED are taken off again by its undo.
 *
 * ## Addresses go in and never come out
 *
 * An address entry stores the address's fingerprint, never the address, so
 * the list keeps a promise not to email someone without holding who they
 * are. An export therefore reads domains only: an address cannot be read
 * back out of its fingerprint.
 *
 * ## The same door as the Compliance page
 *
 * Every hook asks what the route gate asks — a member of this organization
 * with reach over all of it, holding Use Sequences, in a workspace whose plan
 * includes Sequences — through the same verdicts (`engine/outreach-access.ts`).
 * A plan refuses every row for a member who would be refused, `apply` asks
 * again before it writes, a read answers nothing, and undo stops. Writes go
 * through the store's own adders, as a member's would: reason `manual`,
 * source `member`, the member as `addedByUid`. Each written chunk files one
 * line in the organization's activity log, as the page's add does per entry.
 */

/** The fields' ids. */
export const OUTREACH_DNC_FIELDS = {
  entry: 'entry',
  kind: 'kind',
  note: 'note',
  reason: 'reason',
  source: 'source',
  addedByUid: 'addedByUid',
  addedAt: 'addedAt',
  sequenceId: 'sequenceId',
} as const

const DOMAIN_ID = 'domain:'
const ADDRESS_ID = 'address:'

/** Why a file never changes an entry already on the list. */
export const OUTREACH_DNC_ADD_ONLY_REASON =
  'The do-not-contact list only grows from a file: an entry already on it is left as it is.'

/** The activity lines an import and its undo file, one per chunk written or reverted. */
export const OUTREACH_DO_NOT_CONTACT_IMPORT_ACTIVITY = {
  add: (counts: EntryCounts) => `Imported ${countWords(counts)} to the Sequences do-not-contact list`,
  undo: (counts: EntryCounts) =>
    `Undid an import: removed ${countWords(counts)} from the Sequences do-not-contact list`,
} as const

/** How many of each kind a chunk wrote or removed. */
export interface EntryCounts {
  domains: number
  addresses: number
}

function countWords(counts: EntryCounts): string {
  const parts: string[] = []
  if (counts.domains) parts.push(`${counts.domains} ${counts.domains === 1 ? 'domain' : 'domains'}`)
  if (counts.addresses) parts.push(`${counts.addresses} ${counts.addresses === 1 ? 'address' : 'addresses'}`)
  return parts.join(' and ')
}

/** `getAll` takes this many references at most per call. */
const GET_ALL_CHUNK = 300

/** The most rows one export page reads. */
const PAGE_MAX = 1000
const PAGE_DEFAULT = 500

/** A row is not started with less than this left of the chunk's budget. */
const ROW_BUDGET_MS = 2_000

/*==========================================
 * WHAT AN ENTRY CELL NAMES
 *=========================================*/

/** The entry a cell or an id names: an address, by its key, or a domain. */
export type OutreachDoNotContactTarget =
  | { kind: 'address'; id: string; key: string; email: string | null }
  | { kind: 'domain'; id: string; domain: string }

/**
 * The entry a cell names, or `null` for a value that is neither an address
 * nor a domain. An address-looking value that is not a usable address is
 * refused rather than read as its domain: a typo in one address must not
 * block a whole company.
 */
export function outreachDoNotContactTarget(value: unknown): OutreachDoNotContactTarget | null {
  let text = String(value ?? '').trim()
  // `Casey Morgan <casey@example.com>`, as a mail client copies it.
  const bracketed = /<([^<>]+)>\s*$/.exec(text)
  if (bracketed) text = bracketed[1].trim()
  text = text.replace(/^mailto:/i, '')
  if (!text) return null
  const email = normalizeContactEmail(text)
  if (email) {
    const key = outreachDoNotContactKey(email)
    return key ? { kind: 'address', id: `${ADDRESS_ID}${key}`, key, email } : null
  }
  if (text.includes('@') && !text.startsWith('@')) return null
  const domain = normalizeOutreachDomain(text)
  return domain ? { kind: 'domain', id: `${DOMAIN_ID}${domain}`, domain } : null
}

/** The entry an Aglyn ID names, or `null`. */
export function outreachDoNotContactTargetFromId(id: unknown): OutreachDoNotContactTarget | null {
  const text = String(id ?? '').trim()
  if (text.startsWith(DOMAIN_ID)) {
    const domain = normalizeOutreachDomain(text.slice(DOMAIN_ID.length))
    return domain ? { kind: 'domain', id: `${DOMAIN_ID}${domain}`, domain } : null
  }
  if (text.startsWith(ADDRESS_ID)) {
    const key = text.slice(ADDRESS_ID.length).toLowerCase()
    return /^[0-9a-f]{64}$/.test(key) ? { kind: 'address', id: `${ADDRESS_ID}${key}`, key, email: null } : null
  }
  return null
}

/*==========================================
 * THE CATALOG
 *=========================================*/

const ENTRY_GROUP = { id: 'entry', label: 'Entry' }

const STANDARD_FIELDS: TransferField[] = [
  {
    id: OUTREACH_DNC_FIELDS.entry,
    label: 'Entry',
    group: ENTRY_GROUP.id,
    type: 'text',
    required: true,
    matchKey: true,
    maxLength: 320,
    aliases: ['email', 'email address', 'address', 'domain', 'website', 'do not contact', 'do-not-contact'],
    description:
      'An email address or a domain. A domain blocks every address at it. An address is kept as a fingerprint, so it is never exported.',
  },
  {
    id: OUTREACH_DNC_FIELDS.note,
    label: 'Note',
    group: ENTRY_GROUP.id,
    type: 'longText',
    maxLength: 500,
    aliases: ['detail', 'details', 'notes', 'comment', 'why'],
    description: 'Why it is on the list. Written when the entry is added; an entry already on the list keeps its own.',
  },
]

const DERIVED_FIELDS: TransferField[] = [
  {
    id: OUTREACH_DNC_FIELDS.kind,
    label: 'Kind',
    group: ENTRY_GROUP.id,
    type: 'text',
    description: 'Domain or Address, from the entry.',
  },
]

const SYSTEM_FIELDS: TransferField[] = [
  {
    ...transferIdField(),
    description: '"domain:" and the domain, or "address:" and the address’s fingerprint.',
  },
  {
    id: OUTREACH_DNC_FIELDS.reason,
    label: 'Why',
    type: 'text',
    readOnly: true,
    description: 'Why it was added: by a member, a reply asking not to be emailed, an unsubscribe, a bounce, or a mail gateway that blocked the sender.',
  },
  {
    id: OUTREACH_DNC_FIELDS.source,
    label: 'Added by',
    type: 'text',
    readOnly: true,
    description: 'A member, or Sequences on its own when a reply, an unsubscribe or a bounce called for it.',
  },
  {
    id: OUTREACH_DNC_FIELDS.addedByUid,
    label: 'Added by member (user ID)',
    type: 'text',
    readOnly: true,
  },
  { id: OUTREACH_DNC_FIELDS.addedAt, label: 'Added', type: 'datetime', readOnly: true },
  {
    id: OUTREACH_DNC_FIELDS.sequenceId,
    label: 'Sequence ID',
    type: 'text',
    readOnly: true,
    description: 'The sequence whose email led to the entry, when one did.',
  },
]

/** The resource's catalog, the same for every organization. */
export function outreachDoNotContactCatalog(): TransferCatalogInput {
  return { standard: STANDARD_FIELDS, derived: DERIVED_FIELDS, system: SYSTEM_FIELDS, groups: [ENTRY_GROUP] }
}

/** Note is written with a new entry and never onto one already on the list. */
export const OUTREACH_DNC_LOCKED_RULES: readonly TransferLockedRule[] = [
  { fieldId: OUTREACH_DNC_FIELDS.note, reason: OUTREACH_DNC_ADD_ONLY_REASON, forced: { mode: 'keepExisting', blank: 'leave' } },
]

/*==========================================
 * THE RESOURCE
 *=========================================*/

export interface OutreachDoNotContactTransferDeps {
  firestore: FirebaseFirestore.Firestore
  now?: () => number
  /** The member's standing in the organization, as the route gate resolves it. */
  resolveOrgPermissions(uid: string, context: { orgId: string }): Promise<OutreachMembership>
  /** The organization document, or `null` when there is none. */
  readOrg(orgId: string): Promise<Record<string, unknown> | null>
  logOrgActivity(
    orgId: string,
    actor: { uid: string | null; email?: string | null },
    action: string,
    target: { type: 'org'; id: string },
  ): Promise<void>
}

/** An entry's values by field id, as an export writes them and a plan compares them. */
function entryValues(
  target: OutreachDoNotContactTarget,
  entry: Omit<OutreachDoNotContactEntry, 'key'>,
): Record<string, unknown> {
  return {
    [TRANSFER_ID_FIELD]: target.id,
    [OUTREACH_DNC_FIELDS.entry]: target.kind === 'domain' ? target.domain : target.email,
    [OUTREACH_DNC_FIELDS.kind]: target.kind === 'domain' ? 'Domain' : 'Address',
    [OUTREACH_DNC_FIELDS.note]: entry.detail,
    [OUTREACH_DNC_FIELDS.reason]: OUTREACH_DO_NOT_CONTACT_REASON_LABELS[entry.reason] ?? entry.reason,
    [OUTREACH_DNC_FIELDS.source]: OUTREACH_DO_NOT_CONTACT_SOURCE_LABELS[entry.source] ?? entry.source,
    [OUTREACH_DNC_FIELDS.addedByUid]: entry.addedByUid,
    [OUTREACH_DNC_FIELDS.addedAt]: entry.addedAtMs ? new Date(entry.addedAtMs).toISOString() : null,
    [OUTREACH_DNC_FIELDS.sequenceId]: entry.sequenceId,
  }
}

/**
 * What an undo compares an added entry with: everything that says who added
 * it and when. An entry taken off and added again since — by a member, or by
 * the sending runtime for a reply or a bounce — no longer matches, and is
 * not the import's to remove.
 */
const UNDO_FIELDS = [
  OUTREACH_DNC_FIELDS.note,
  OUTREACH_DNC_FIELDS.reason,
  OUTREACH_DNC_FIELDS.source,
  OUTREACH_DNC_FIELDS.addedByUid,
  OUTREACH_DNC_FIELDS.addedAt,
] as const

function undoWritten(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(UNDO_FIELDS.map((fieldId) => [fieldId, values[fieldId] ?? null]))
}

/** Rows keyed by field id, holding only the fields asked for. */
function pick(values: Record<string, unknown>, fieldIds: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, values[fieldId] ?? null]))
}

/** The list query the Compliance page's search and filters make, from an export's `filter`. */
function domainListRequest(filter: Readonly<Record<string, unknown>> | undefined): ListQueryRequest {
  const clauses = (Array.isArray(filter?.['clauses']) ? (filter?.['clauses'] as unknown[]) : [])
    .filter(
      (clause): clause is { field: string; op: string; value: string } =>
        !!clause &&
        typeof (clause as Record<string, unknown>)['field'] === 'string' &&
        typeof (clause as Record<string, unknown>)['op'] === 'string' &&
        typeof (clause as Record<string, unknown>)['value'] === 'string',
    )
    .map(({ field, op, value }) => ({ field, op, value }))
  const search = (Array.isArray(filter?.['search']) ? (filter?.['search'] as unknown[]) : []).filter(
    (word): word is string => typeof word === 'string',
  )
  return { clauses, search }
}

/** The export cursor: the last row's order value and id. */
interface PageCursor {
  value?: unknown
  id: string
}

function encodeCursor(cursor: PageCursor): string {
  return JSON.stringify(cursor)
}

function decodeCursor(cursor: string | null): PageCursor | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(cursor) as PageCursor
    return parsed && typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** The import's record policy: a row that finds an entry is skipped, and no row picks a record to update. */
function addOnlyPolicy(policy: TransferPolicy): TransferPolicy {
  const rows: Record<number, TransferPolicy['rows'][number]> = {}
  for (const [index, override] of Object.entries(policy.rows)) {
    rows[Number(index)] = override.action === 'skip' ? { action: 'skip' } : {}
  }
  return {
    ...policy,
    record: { ...policy.record, onMatch: 'skip', onAmbiguous: 'skip' },
    rows,
  }
}

/**
 * Rows the core matched as new that name one entry between them — `Acme.com`
 * and `www.acme.com`, an address in two spellings — are duplicates of the
 * first: the match key compares the cells, and the entry is what they name.
 */
function withEntryDuplicates(input: BuildTransferPlanInput): RowMatchOutcome[] {
  const firstRowOf = new Map<string, number>()
  return input.rows.map((row, position) => {
    const match = input.matches[position] ?? { kind: 'new' }
    const target = outreachDoNotContactTarget(row.values[OUTREACH_DNC_FIELDS.entry])
    if (!target) return match
    const first = firstRowOf.get(target.id)
    if (first === undefined) {
      firstRowOf.set(target.id, row.index)
      return match
    }
    return match.kind === 'new'
      ? { kind: 'duplicateInFile', firstRow: first, via: { fieldId: OUTREACH_DNC_FIELDS.entry, value: target.kind === 'domain' ? target.domain : String(target.email) } }
      : match
  })
}

function summaryOf(rows: readonly PlannedTransferRow[]): TransferPlan['summary'] {
  const summary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  return summary
}

/** The value a planned create writes to a field. */
function plannedValue(row: PlannedTransferRow, fieldId: string): unknown {
  return row.diff.find((change) => change.fieldId === fieldId)?.after ?? null
}

/** The hooks this resource answers, every one present. */
export type OutreachDoNotContactTransferResource = PluginTransferResource &
  Required<
    Pick<TransferRecordsHooks, 'fields' | 'count' | 'readPage' | 'lookup' | 'plan' | 'lockedRules' | 'apply' | 'revert'>
  >

/**
 * The do-not-contact list's server half. Specs pass an in-memory Firestore;
 * the console's declarations pass the Admin SDK's and the platform's
 * membership, organization and activity readers.
 */
export function createOutreachDoNotContactTransferResource(
  deps: OutreachDoNotContactTransferDeps,
): OutreachDoNotContactTransferResource {
  const { firestore } = deps
  const now = deps.now ?? Date.now

  /** The sentence a member is refused with, or `null` when they may work the list. */
  async function accessRefusal(ctx: TransferResourceContext): Promise<string | null> {
    if (!ctx.actorUid) return 'Only a signed-in member can change the do-not-contact list.'
    const membership = await deps.resolveOrgPermissions(ctx.actorUid, { orgId: ctx.orgId })
    const refused = outreachMembershipRefusal(membership, ctx.orgId)
    if (refused) return refused.message
    return outreachEntitlementRefusal(await deps.readOrg(ctx.orgId))?.message ?? null
  }

  /** The entries the targets name, by Aglyn ID; absent for one not on the list. */
  async function readEntries(
    orgId: string,
    targets: readonly OutreachDoNotContactTarget[],
  ): Promise<Map<string, Omit<OutreachDoNotContactEntry, 'key'>>> {
    const found = new Map<string, Omit<OutreachDoNotContactEntry, 'key'>>()
    const unique = [...new Map(targets.map((target) => [target.id, target])).values()]
    const addresses = outreachDoNotContactCollection(firestore, orgId)
    const domains = outreachDoNotContactDomainCollection(firestore, orgId)
    for (let start = 0; start < unique.length; start += GET_ALL_CHUNK) {
      const chunk = unique.slice(start, start + GET_ALL_CHUNK)
      const snapshots = await firestore.getAll(
        ...chunk.map((target) => (target.kind === 'domain' ? domains.doc(target.domain) : addresses.doc(target.key))),
      )
      chunk.forEach((target, index) => {
        const snapshot = snapshots[index]
        if (!snapshot?.exists) return
        const data = snapshot.data()
        const entry =
          target.kind === 'domain'
            ? readOutreachDoNotContactDomainEntry(target.domain, data)
            : readOutreachDoNotContactEntry(target.key, data)
        if (!entry) return
        const { reason, source, addedByUid, addedAtMs, enrollmentId, sequenceId, detail } = entry
        found.set(target.id, { reason, source, addedByUid, addedAtMs, enrollmentId, sequenceId, detail })
      })
    }
    return found
  }

  /** The Compliance page's domains query, as one Admin query in its own order. */
  function domainQuery(orgId: string, plan: ListQueryPlan): FirebaseFirestore.Query {
    const query = applyListQuery(outreachDoNotContactDomainCollection(firestore, orgId), plan)
    // A date filter orders by when an entry was added; the id breaks ties so
    // a page boundary never splits or repeats a moment.
    return plan.orderBy.path === LIST_QUERY_ID_PATH
      ? query
      : query.orderBy(FieldPath.documentId(), plan.orderBy.direction)
  }

  /** Whether an export may read: org-wide members who may work the list. */
  async function mayRead(ctx: TransferResourceContext, options: TransferReadOptions | undefined): Promise<boolean> {
    // The list covers the whole organization; a reader scoped to some sites
    // is refused by the route gate, and here reads nothing.
    if (options?.scopeTokens) return false
    return (await accessRefusal(ctx)) === null
  }

  /** The selected domains, in id order; an address id names nothing an export can read. */
  function selectedDomains(ids: readonly string[]): Array<Extract<OutreachDoNotContactTarget, { kind: 'domain' }>> {
    const targets = ids
      .map(outreachDoNotContactTargetFromId)
      .filter((target): target is Extract<OutreachDoNotContactTarget, { kind: 'domain' }> => target?.kind === 'domain')
    return [...new Map(targets.map((target) => [target.id, target])).values()].sort((a, b) => a.domain.localeCompare(b.domain))
  }

  return {
    fields: () => outreachDoNotContactCatalog(),
    matchKeys: OUTREACH_DNC_MATCH_KEYS,
    lockedRules: () => OUTREACH_DNC_LOCKED_RULES,

    async count(ctx, options) {
      if (!(await mayRead(ctx, options))) return 0
      if (options.ids) {
        return (await readEntries(ctx.orgId, selectedDomains(options.ids))).size
      }
      const plan = planListQuery(OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY, domainListRequest(options.filter), nameSearchNormalizers)
      const counted = await applyListQuery(outreachDoNotContactDomainCollection(firestore, ctx.orgId), plan).count().get()
      return counted.data().count
    },

    async readPage(ctx, cursor, fieldIds, options) {
      if (!(await mayRead(ctx, options))) return { rows: [], next: null }
      const size = Math.min(PAGE_MAX, Math.max(1, Math.floor(options?.pageSize ?? PAGE_DEFAULT)))

      if (options?.ids) {
        const domains = selectedDomains(options.ids)
        const start = Math.max(0, Number(cursor ?? 0) || 0)
        const slice = domains.slice(start, start + size)
        const found = await readEntries(ctx.orgId, slice)
        const rows = slice.flatMap((target) => {
          const entry = found.get(target.id)
          return entry ? [pick(entryValues(target, entry), fieldIds)] : []
        })
        return { rows, next: start + size < domains.length ? String(start + size) : null }
      }

      const plan = planListQuery(OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY, domainListRequest(options?.filter), nameSearchNormalizers)
      let query = domainQuery(ctx.orgId, plan)
      const after = decodeCursor(cursor)
      if (after) {
        query =
          plan.orderBy.path === LIST_QUERY_ID_PATH
            ? query.startAfter(after.id)
            : query.startAfter(after.value ?? null, after.id)
      }
      const snapshot = await query.limit(size + 1).get()
      const docs = snapshot.docs.slice(0, size)
      const rows = docs.flatMap((doc) => {
        const entry = readOutreachDoNotContactDomainEntry(doc.id, doc.data())
        if (!entry) return []
        const { domain, ...rest } = entry
        return [pick(entryValues({ kind: 'domain', id: `${DOMAIN_ID}${doc.id}`, domain }, rest), fieldIds)]
      })
      const last = docs[docs.length - 1]
      const next =
        snapshot.docs.length > size && last
          ? encodeCursor({
              id: last.id,
              ...(plan.orderBy.path === LIST_QUERY_ID_PATH ? {} : { value: last.get(plan.orderBy.path) ?? null }),
            })
          : null
      return { rows, next }
    },

    async lookup(ctx, requests: readonly MatchLookupRequest[]) {
      const lookup = new Map<string, string[]>()
      const records = new Map<string, Readonly<Record<string, unknown>>>()
      // A member who may not work the list learns nothing about what is on it.
      if (await accessRefusal(ctx)) return { lookup, records }
      const asked: Array<{ at: string; target: OutreachDoNotContactTarget }> = []
      for (const request of requests) {
        for (const value of request.values) {
          const target =
            request.fieldId === TRANSFER_ID_FIELD
              ? outreachDoNotContactTargetFromId(value)
              : request.fieldId === OUTREACH_DNC_FIELDS.entry
                ? outreachDoNotContactTarget(value)
                : null
          if (target) asked.push({ at: matchLookupKey(request.fieldId, value), target })
        }
      }
      const found = await readEntries(ctx.orgId, asked.map((entry) => entry.target))
      for (const { at, target } of asked) {
        const entry = found.get(target.id)
        if (!entry) continue
        lookup.set(at, [target.id])
        // An address read by its id has no address to show; one asked for
        // by its address does.
        const known = records.get(target.id)
        if (!known || (known[OUTREACH_DNC_FIELDS.entry] == null && target.kind === 'address' && target.email)) {
          records.set(target.id, entryValues(target, entry))
        }
      }
      return { lookup, records }
    },

    async plan(ctx, input) {
      const policy = addOnlyPolicy(input.policy)
      const built = buildTransferPlan({ ...input, policy, matches: withEntryDuplicates(input) })
      // Defensive: whatever the policy said, nothing on the list is rewritten.
      const rows = built.rows.map((row): PlannedTransferRow =>
        row.verdict === 'update' ? { ...row, verdict: 'skip', reason: 'matchedSkipped', diff: [] } : row,
      )
      const plan: TransferPlan = { ...built, rows, summary: summaryOf(rows) }

      const refusal = await accessRefusal(ctx)
      if (refusal) {
        return withTransferResourceFindings(
          plan,
          plan.rows.map((row) => ({ row: row.index, detail: refusal, refuse: true })),
        )
      }

      const findings: TransferResourceFinding[] = []
      const creating: Array<{ row: PlannedTransferRow; target: OutreachDoNotContactTarget }> = []
      for (const row of plan.rows) {
        if (row.verdict !== 'create') continue
        const value = plannedValue(row, OUTREACH_DNC_FIELDS.entry)
        const target = outreachDoNotContactTarget(value)
        if (!target) {
          findings.push({
            row: row.index,
            fieldId: OUTREACH_DNC_FIELDS.entry,
            value: String(value ?? ''),
            detail: `"${String(value ?? '')}" is neither an email address nor a domain.`,
            refuse: true,
          })
          continue
        }
        creating.push({ row, target })
        if (target.kind === 'domain' && isPublicMailboxDomain(target.domain)) {
          findings.push({
            row: row.index,
            fieldId: OUTREACH_DNC_FIELDS.entry,
            value: target.domain,
            detail: `${target.domain} is a public mailbox provider: adding it blocks every address at ${target.domain}, not one person.`,
          })
        }
      }

      // An address whose domain is listed, or is added by this file, is covered already.
      const fileDomains = new Map<string, number>()
      for (const { row, target } of creating) {
        if (target.kind === 'domain' && !fileDomains.has(target.domain)) fileDomains.set(target.domain, row.index)
      }
      const addresses = creating.filter(
        (entry): entry is { row: PlannedTransferRow; target: Extract<OutreachDoNotContactTarget, { kind: 'address' }> } =>
          entry.target.kind === 'address',
      )
      const listed = addresses.length
        ? await lookupOutreachDoNotContactDomains(
            firestore,
            ctx.orgId,
            addresses.map((entry) => String(entry.target.email)),
          )
        : new Map<string, boolean | null>()
      for (const { row, target } of addresses) {
        const domain = outreachEmailDomain(target.email)
        if (!domain) continue
        const inFile = fileDomains.get(domain)
        if (inFile !== undefined) {
          findings.push({
            row: row.index,
            fieldId: OUTREACH_DNC_FIELDS.entry,
            value: String(target.email),
            detail: `Its domain, ${domain}, is added by row ${inFile + 1} of this file, which already covers this address.`,
          })
        } else if (listed.get(String(target.email)) === true) {
          findings.push({
            row: row.index,
            fieldId: OUTREACH_DNC_FIELDS.entry,
            value: String(target.email),
            detail: `Its domain, ${domain}, is already on the list, which already covers this address.`,
          })
        }
      }
      return withTransferResourceFindings(plan, findings)
    },

    async apply(ctx, chunk, writer) {
      const results: TransferRowResult[] = []
      const undo: TransferUndoEntry[] = []
      const added: EntryCounts = { domains: 0, addresses: 0 }
      const refusal = await accessRefusal(ctx)
      for (const row of chunk.rows) {
        const before = await writer.alreadyApplied(row.index)
        if (before) {
          results.push(before)
          continue
        }
        if (writer.timeLeftMs() < ROW_BUDGET_MS) break
        let result: TransferRowResult
        let entry: TransferUndoEntry | undefined
        const target = outreachDoNotContactTarget(plannedValue(row, OUTREACH_DNC_FIELDS.entry))
        if (row.verdict !== 'create') {
          // Only a create is planned to write; nothing on the list is rewritten.
          result = { row: row.index, outcome: 'skipped', ...(row.recordId ? { recordId: row.recordId } : {}), reason: 'matchedSkipped' }
        } else if (refusal) {
          result = { row: row.index, outcome: 'failed', reason: 'resourceRule', message: refusal }
        } else if (!target) {
          result = { row: row.index, outcome: 'failed', reason: 'resourceRule', message: 'Neither an email address nor a domain.' }
        } else {
          const note = plannedValue(row, OUTREACH_DNC_FIELDS.note)
          const common = {
            orgId: ctx.orgId,
            reason: 'manual' as const,
            source: 'member' as const,
            addedByUid: ctx.actorUid,
            nowMs: now(),
            detail: typeof note === 'string' ? note : null,
          }
          const written =
            target.kind === 'domain'
              ? await addOutreachDoNotContactDomain(firestore, { ...common, domain: target.domain })
              : await addOutreachDoNotContact(firestore, { ...common, email: String(target.email) })
          if (written.created) {
            result = { row: row.index, outcome: 'created', recordId: target.id }
            entry = {
              row: row.index,
              recordId: target.id,
              action: 'created',
              written: undoWritten(entryValues(target, written.entry)),
            }
            added[target.kind === 'domain' ? 'domains' : 'addresses'] += 1
          } else {
            // Added since the plan was made: the entry already there stands.
            result = { row: row.index, outcome: 'unchanged', recordId: target.id, reason: 'matchedSkipped' }
          }
        }
        await writer.markApplied(result, entry)
        results.push(result)
        if (entry) undo.push(entry)
      }
      if (added.domains || added.addresses) {
        await deps.logOrgActivity(ctx.orgId, { uid: ctx.actorUid }, OUTREACH_DO_NOT_CONTACT_IMPORT_ACTIVITY.add(added), {
          type: 'org',
          id: ctx.orgId,
        })
      }
      return { results, undo }
    },

    async revert(ctx, snapshot, decisions) {
      const refusal = await accessRefusal(ctx)
      if (refusal) throw new Error(refusal)
      const targets = snapshot.entries
        .map((entry) => outreachDoNotContactTargetFromId(entry.recordId))
        .filter((target): target is OutreachDoNotContactTarget => target !== null)
      const found = await readEntries(ctx.orgId, targets)
      const done: TransferUndoStep[] = []
      const conflicts: TransferUndoStep[] = []
      const removed: EntryCounts = { domains: 0, addresses: 0 }
      for (const entry of snapshot.entries) {
        const target = outreachDoNotContactTargetFromId(entry.recordId)
        const stored = target ? found.get(target.id) : undefined
        if (!target || !stored) {
          done.push({ action: 'nothing', recordId: entry.recordId, why: 'gone' })
          continue
        }
        const step = planTransferUndo(entry, entryValues(target, stored))
        if (step.action === 'conflict') {
          // Taken off and added again since. The person may still choose to
          // remove a member's re-add; an entry Sequences added on its own —
          // someone replied, unsubscribed or bounced — is never the import's.
          if (decisions?.[entry.recordId] !== 'revert' || stored.source === 'runtime') {
            conflicts.push(step)
            continue
          }
        } else if (step.action !== 'delete') {
          done.push(step)
          continue
        }
        const gone =
          target.kind === 'domain'
            ? await removeOutreachDoNotContactDomain(firestore, ctx.orgId, target.domain)
            : await removeOutreachDoNotContactEntry(firestore, ctx.orgId, target.key)
        if (gone) removed[target.kind === 'domain' ? 'domains' : 'addresses'] += 1
        done.push({ action: 'delete', recordId: entry.recordId })
      }
      if (removed.domains || removed.addresses) {
        await deps.logOrgActivity(ctx.orgId, { uid: ctx.actorUid }, OUTREACH_DO_NOT_CONTACT_IMPORT_ACTIVITY.undo(removed), {
          type: 'org',
          id: ctx.orgId,
        })
      }
      return { done, conflicts }
    },
  }
}
