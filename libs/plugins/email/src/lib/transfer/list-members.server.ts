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
 * ONE LIST'S MEMBERS, IMPORTED AND EXPORTED (AGL-3529) — the server half of
 * `email.list-members` on the platform's transfer framework.
 *
 * The framework reads the file, maps its columns, finds the rows that repeat
 * an address, plans every row before anything is written, applies the plan
 * a chunk at a time through a ledger that never writes a row twice, resumes
 * where a closed tab stopped, and keeps an undo for seven days. What it
 * cannot know is a list's rules, and every one of them the importer this
 * replaces kept is kept here:
 *
 * - EVERY ADDRESS GOES THROUGH THE CHECKS A TYPED ONE DOES — the same
 *   functions, not similar ones. `resolveAddresses` is the resolution the
 *   audience card's add runs, `assignmentBasis` is the policy it applies,
 *   and `enrollListMember` is the one writer of the membership collection.
 *   Suppressed people and people who said no are refused at the write, with
 *   the reason, whatever the file or the operator says.
 * - THE STATEMENT OF PERMISSION is the plugin's own wizard step. Its answer
 *   reaches the dry run in `extras`; the dry run records WHO made it on the
 *   list's import ledger (`orgs/{orgId}/lists/{listId}/imports/{jobId}`),
 *   and every write reads the attester from there — never from whoever
 *   pressed Resume, and never from the browser. Without it only people with
 *   an opt-in on record are added. Neither the statement nor anything in a
 *   file can make a refusal an opt-in (`CONSENT_FROM_FILE_REASON`).
 * - THE SCREENING — role accounts and column names that read as a bought or
 *   appended list — and a consent check of a bounded sample are a warning on
 *   the dry run that has to be acknowledged before anything is written, and
 *   the sample is shown again on the permission step.
 * - SOMEBODY ALREADY ON THE LIST is unchanged: their membership is never
 *   re-enrolled or rewritten. Their contact details change only when the
 *   operator says so on the "People already on this list" step.
 * - A FILE'S CONTACT COLUMNS go to the contact record through the platform's
 *   contact-capture door (`capturePluginContact`), the record system's own
 *   write path — never written here. Each is planned against what the record
 *   holds, under the person's field choices; a blank cell never empties one.
 * - 50,000 rows a file (`limits.maxRows`), refused at the upload before
 *   anything is staged; repeats of an address are skipped as repeats; a line
 *   that is not an address fails its row, by name, rather than vanishing.
 *
 * ## Who may
 *
 * The transfer gate admits a member who may manage the SITE's data. A list
 * is the organization's, and every site in it can mail one, so changing who
 * is on it — or reading their consent through the matching — needs an
 * org-wide owner, admin or editor (`isOrgWideListWriter`), the rule the
 * list routes apply. An export reads through `scopeTokens`: a collaborator
 * scoped to some sites reads no member at all, which is what the rules
 * would answer them.
 */

import {
  ASSIGNMENT_REFUSAL_MESSAGES,
  assignmentBasis,
  MARKETING_CONSENT_BASIS_FIELD,
  MARKETING_CONSENT_BY_HOST_FIELD,
  normalizeContactEmail,
  readMarketingBasis,
  type AssignmentRefusal,
  type ConsentGroup,
} from '@aglyn/aglyn/server'
import {
  composeContactName,
  readContactFacet,
} from '@aglyn/aglyn/app-utils/contacts'
import {
  TRANSFER_FILE_SAMPLE_ROW,
  TRANSFER_ID_FIELD,
  TRANSFER_WARNING_CLASSES,
  buildTransferPlan,
  matchLookupKey,
  normalizeMatchValue,
  planTransferUndo,
  type BuildTransferPlanInput,
  type MatchLookupRequest,
  type PlannedTransferRow,
  type RowMatchOutcome,
  type TransferPlan,
  type TransferPolicy,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
  type TransferWarning,
  type TransferWarningSample,
} from '@aglyn/aglyn/data-transfer'
import { capturePluginContact } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import type {
  TransferApplyResult,
  TransferLookupResult,
  TransferReadOptions,
  TransferReadPage,
  TransferRecordsHooks,
  TransferResourceContext,
  TransferRevertResult,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  consentGroupForSite,
  enrollListMember,
  firebaseAdmin,
  orgDataCollectionForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { TransferEngineError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { FieldValue } from 'firebase-admin/firestore'
import {
  importedBasisReason,
  isRoleAccount,
  purchaseTellColumns,
} from '../list-import'
import {
  isOrgWideListWriter,
  LIST_MEMBER_BATCH_MAX,
  resolveAddresses,
} from '../server-list-gate'
import {
  LIST_MEMBER_ALIASES,
  LIST_MEMBER_CONTACT_FIELD_IDS,
  LIST_MEMBER_LOCKED_RULES,
  LIST_MEMBER_MATCH_KEYS,
  contactFieldKey,
  listIdOfResourceKey,
  listMemberCatalog,
  type ListImportScreeningReport,
  readListConsentAnswer,
  readListExistingAnswer,
} from './email-transfer-catalog'
import { countExisting, slices } from './transfer-reads.server'

/** `source` stamped on every membership an import writes. */
export const CONSOLE_IMPORT_SOURCE = 'console:list-import'

/** A list's import ledger: `orgs/{orgId}/lists/{listId}/imports/{jobId}`. */
export const LIST_IMPORTS_SUBCOLLECTION = 'imports'

/** Role accounts kept verbatim on the ledger, so the step names some of them. */
const ROLE_ACCOUNT_SAMPLE_MAX = 25

/** How many addresses one `in` query may carry. */
const IN_QUERY_MAX = 30

/** Reads running at once. */
const READ_CONCURRENCY = 8

/** Below this much of a chunk's budget, a write stops at a row boundary. */
const APPLY_RESERVE_MS = 3_000

/** Why a contact detail stays as the record holds it. */
export const CONTACTS_KEPT_REASON =
  'You chose to leave the contact details of people the workspace already holds as they are.'

/*==========================================
 * THE LIST, AND WHO IS ASKING
 *=========================================*/

/** The list an import or export is of, proved to exist. */
export interface ListTarget {
  hostId: string
  listRef: FirebaseFirestore.DocumentReference
  listName: string
}

/**
 * The list a request names, after proving the asker may change who is on
 * it. `write: false` is an export read: the route has already scoped it.
 */
export async function listTargetFor(
  ctx: TransferResourceContext,
  options: { write: boolean },
): Promise<ListTarget> {
  const hostId = ctx.hostId ?? ''
  const listId = listIdOfResourceKey(ctx.resource) ?? ''
  if (!hostId || !listId) {
    throw new TransferEngineError('invalid', 400, 'Open this from the list it belongs to.')
  }
  if (options.write) {
    const membership = ctx.actorUid
      ? await resolveOrgMembership(ctx.actorUid, ctx.orgId).catch(() => null)
      : null
    if (!isOrgWideListWriter(membership?.member)) {
      throw new TransferEngineError(
        'forbidden',
        403,
        'Lists belong to the whole organization, so changing who is on one needs organization-wide access rather than access to this site.',
      )
    }
  }
  const listRef = firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(ctx.orgId)
    .collection('lists')
    .doc(listId)
  const list = await listRef.get()
  // A stale id must not CREATE a list: a campaign's audience would then
  // read a list nobody set up.
  if (!list.exists) throw new TransferEngineError('notFound', 404, 'This list no longer exists.')
  return { hostId, listRef, listName: String(list.get('name') ?? listId) }
}

/*==========================================
 * READING MEMBERS AND THEIR CONTACT RECORDS
 *=========================================*/

/** Runs `fn` over `items`, `limit` at a time, answers in order. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const at = next
      next += 1
      out[at] = await fn(items[at] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** A stored time as ISO text, or `null`. */
function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : null
  const stamp = value as { toDate?: () => Date }
  if (typeof stamp.toDate === 'function') return stamp.toDate().toISOString()
  return null
}

/**
 * One member as the framework reads it: the membership by field id, and the
 * consent as the site the list is worked as reads it.
 */
export function memberValues(
  id: string,
  data: Record<string, unknown>,
  group: ConsentGroup,
): Record<string, unknown> {
  const record = readMarketingBasis(data, group)
  const byHost = data[MARKETING_CONSENT_BY_HOST_FIELD] as
    | Record<string, Record<string, unknown>>
    | undefined
  const entry = byHost?.[group.hostId] ?? data
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  return {
    [TRANSFER_ID_FIELD]: id,
    email: text(data['email']),
    name: text(data['name']),
    addedAt: isoOf(data['addedAt']),
    source: text(data['source']),
    via: text(data['via']) ?? 'manual',
    consent: record.basis,
    consentBasis: text(entry?.[MARKETING_CONSENT_BASIS_FIELD]),
    consentAt: isoOf(record.basisAtMs),
    consentReason: text(entry?.['marketingConsentReason']),
  }
}

/**
 * The contact record's values for these addresses, as this site's holder
 * keeps them, by `contact:<field>` — and only for addresses a record exists
 * for, so "no record" and "a record with nothing in it" stay apart.
 */
export async function readContactValues(
  hostId: string,
  group: ConsentGroup,
  emails: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>()
  const addresses = [...new Set(emails.filter(Boolean))]
  if (!addresses.length) return found
  const contacts = await orgDataCollectionForHost(hostId, 'contacts')
  const snapshots = await mapLimited(slices(addresses, IN_QUERY_MAX), READ_CONCURRENCY, (chunk) =>
    contacts.where('email', 'in', chunk).get(),
  )
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const email = normalizeContactEmail(doc.get('email'))
      if (!email || found.has(email)) continue
      const facet = readContactFacet(doc.data() as Record<string, unknown>, group.groupId) as unknown as Record<
        string,
        unknown
      >
      found.set(
        email,
        Object.fromEntries(
          LIST_MEMBER_CONTACT_FIELD_IDS.map((fieldId) => {
            const value = facet[contactFieldKey(fieldId) as string]
            return [fieldId, typeof value === 'string' && value ? value : null]
          }),
        ),
      )
    }
  }
  return found
}

/** The members holding these addresses or ids, by member id. */
async function readMembers(
  members: FirebaseFirestore.CollectionReference,
  requests: readonly MatchLookupRequest[],
): Promise<{ docs: Map<string, Record<string, unknown>>; lookup: Map<string, string[]> }> {
  const docs = new Map<string, Record<string, unknown>>()
  const lookup = new Map<string, string[]>()
  const note = (fieldId: string, value: string, id: string) => {
    const key = matchLookupKey(fieldId, value)
    const ids = lookup.get(key) ?? []
    if (!ids.includes(id)) ids.push(id)
    lookup.set(key, ids)
  }
  for (const request of requests) {
    if (request.fieldId === 'email') {
      const snapshots = await mapLimited(slices(request.values, IN_QUERY_MAX), READ_CONCURRENCY, (chunk) =>
        members.where('email', 'in', chunk).get(),
      )
      for (const snapshot of snapshots) {
        for (const doc of snapshot.docs) {
          const value = normalizeMatchValue('email', doc.get('email'))
          if (!value) continue
          docs.set(doc.id, doc.data() as Record<string, unknown>)
          note('email', value, doc.id)
        }
      }
    } else if (request.fieldId === TRANSFER_ID_FIELD) {
      const ids = request.values.filter((id) => id && !id.includes('/'))
      for (const chunk of slices(ids, 300)) {
        if (!chunk.length) continue
        const snapshots = await members.firestore.getAll(...chunk.map((id) => members.doc(id)))
        for (const snapshot of snapshots) {
          if (!snapshot.exists) continue
          docs.set(snapshot.id, snapshot.data() as Record<string, unknown>)
          note(TRANSFER_ID_FIELD, snapshot.id, snapshot.id)
        }
      }
    }
  }
  return { docs, lookup }
}

/*==========================================
 * THE PLAN
 *=========================================*/

/** The warnings of several plans as one list, class by class. */
export function mergeTransferWarnings(lists: ReadonlyArray<readonly TransferWarning[]>): TransferWarning[] {
  const byClass = new Map<string, TransferWarning>()
  for (const list of lists) {
    for (const warning of list) {
      const held = byClass.get(warning.class)
      byClass.set(
        warning.class,
        held
          ? {
              ...held,
              count: held.count + warning.count,
              rows: held.rows + warning.rows,
              fieldIds: [...new Set([...held.fieldIds, ...warning.fieldIds])],
              samples: [...held.samples, ...warning.samples].slice(0, Math.max(5, held.samples.length)),
              requiresAcknowledgement: held.requiresAcknowledgement || warning.requiresAcknowledgement,
            }
          : { ...warning },
      )
    }
  }
  return TRANSFER_WARNING_CLASSES.filter((entry) => byClass.has(entry)).map(
    (entry) => byClass.get(entry) as TransferWarning,
  )
}

/** A row's values without the keys `keep` refuses. */
function pick(values: Readonly<Record<string, unknown>>, keep: (fieldId: string) => boolean): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([fieldId]) => keep(fieldId)))
}

/**
 * The dry run (see the module note): the membership planned by the core,
 * the contact columns planned against the contact records, the two joined
 * row by row, and the screening added as one warning to acknowledge.
 * Records who stated permission on the list's import ledger; writes no
 * member and no contact.
 */
export async function planListMembers(
  ctx: TransferResourceContext,
  input: BuildTransferPlanInput,
): Promise<TransferPlan> {
  const list = await listTargetFor(ctx, { write: true })
  const group = await consentGroupForSite(list.hostId)
  const existingAnswer = readListExistingAnswer(ctx.extras)
  const consentAnswer = readListConsentAnswer(ctx.extras)
  const isContact = (fieldId: string) => contactFieldKey(fieldId) !== null

  // A person is on a list once: "create a duplicate" is an update here.
  const policy: TransferPolicy = {
    ...input.policy,
    record: {
      ...input.policy.record,
      onMatch: input.policy.record.onMatch === 'duplicate' ? 'update' : input.policy.record.onMatch,
    },
  }

  // 1. The membership, against the members the lookup found.
  const membership = buildTransferPlan({
    ...input,
    policy,
    fields: input.fields.filter((field) => !isContact(field.id)),
    rows: input.rows.map((row) => ({ ...row, values: pick(row.values, (fieldId) => !isContact(fieldId)) })),
  })

  const emailOf = new Map<number, string>()
  for (const row of input.rows) {
    const email = normalizeContactEmail(row.values['email'])
    if (email) emailOf.set(row.index, email)
  }

  // 2. The contact columns, against the contact records, for every row that
  // adds somebody — and for somebody already on the list only when the
  // operator chose to update the people the workspace holds.
  const carriesContacts = input.rows.some((row) =>
    Object.keys(row.values).some((fieldId) => isContact(fieldId)),
  )
  const contactPlanned = new Map<number, PlannedTransferRow>()
  let contactWarnings: TransferWarning[] = []
  if (carriesContacts) {
    const eligible = membership.rows.filter(
      (row) =>
        (row.verdict === 'create' ||
          (existingAnswer.updateContacts && (row.verdict === 'unchanged' || row.verdict === 'update') && row.recordId)) &&
        emailOf.has(row.index),
    )
    const records = await readContactValues(
      list.hostId,
      group,
      eligible.map((row) => emailOf.get(row.index) as string),
    )
    const byIndex = new Map(input.rows.map((row) => [row.index, row]))
    const contactRows = eligible.map((row) => ({
      index: row.index,
      values: pick(byIndex.get(row.index)?.values ?? {}, isContact),
    }))
    const matches: RowMatchOutcome[] = eligible.map((row) => {
      const email = emailOf.get(row.index) as string
      return records.has(email)
        ? { kind: 'matched', recordId: email, via: { fieldId: 'email', value: email } }
        : { kind: 'new' }
    })
    const contactPolicy: TransferPolicy = {
      ...policy,
      record: { onMatch: 'update', onNew: 'create', onAmbiguous: 'skip' },
      rows: Object.fromEntries(
        Object.entries(policy.rows).map(([row, override]) => [row, override.fields ? { fields: override.fields } : {}]),
      ),
      locked: existingAnswer.updateContacts
        ? policy.locked
        : [
            ...policy.locked.filter((rule) => !isContact(rule.fieldId)),
            ...LIST_MEMBER_CONTACT_FIELD_IDS.map((fieldId) => ({
              fieldId,
              forced: { mode: 'keepExisting' as const, blank: 'leave' as const },
              reason: CONTACTS_KEPT_REASON,
            })),
          ],
    }
    const contacts = buildTransferPlan({
      fields: input.fields.filter((field) => isContact(field.id)),
      rows: contactRows,
      matches,
      existing: records,
      policy: contactPolicy,
    })
    for (const row of contacts.rows) contactPlanned.set(row.index, row)
    contactWarnings = contacts.warnings
  }

  // 3. The two, joined: a new member carries both; somebody already on the
  // list changes only when their contact record does.
  const rows = membership.rows.map((row): PlannedTransferRow => {
    const contact = contactPlanned.get(row.index)
    if (!contact) return row
    const diff = contact.verdict === 'create' || contact.verdict === 'update' ? contact.diff : []
    const joined = {
      ...row,
      heldBack: [...row.heldBack, ...contact.heldBack],
      warnings: [...new Set([...row.warnings, ...contact.warnings])],
    }
    if (row.verdict === 'create') return { ...joined, diff: [...row.diff, ...diff] }
    return diff.length ? { ...joined, verdict: 'update', diff } : joined
  })

  // 4. The screening, over the people the import would add.
  const adding = rows
    .filter((row) => row.verdict === 'create' && emailOf.has(row.index))
    .map((row) => ({ index: row.index, email: emailOf.get(row.index) as string }))
  const roles = adding.filter((entry) => isRoleAccount(entry.email))
  const tells = purchaseTellColumns(ctx.headers ?? [])
  const sampled = adding.slice(0, LIST_MEMBER_BATCH_MAX).map((entry) => entry.email)
  const resolution = sampled.length
    ? await resolveAddresses({ hostId: list.hostId, inputs: sampled })
    : { optedIn: 0, needAttestation: 0, refused: 0 }
  const attested = consentAnswer?.attest === true
  const declaresBasis = input.rows.some(
    (row) => !!String(row.values['declaredSource'] ?? '').trim() || !!String(row.values['declaredAt'] ?? '').trim(),
  )
  const report: ListImportScreeningReport = {
    roleAccounts: roles.length,
    roleAccountSamples: roles.slice(0, ROLE_ACCOUNT_SAMPLE_MAX).map((entry) => entry.email),
    purchaseTellColumns: tells,
    declaresBasis,
    sample: {
      size: sampled.length,
      of: adding.length,
      optedIn: resolution.optedIn,
      needAttestation: resolution.needAttestation,
      refused: resolution.refused,
    },
  }
  const screening = screeningWarning(report, roles, attested)
  const warnings = mergeTransferWarnings([membership.warnings, contactWarnings, screening ? [screening] : []])

  await list.listRef
    .collection(LIST_IMPORTS_SUBCOLLECTION)
    .doc(String(ctx.jobId ?? 'unknown'))
    .set(
      {
        jobId: ctx.jobId ?? null,
        listName: list.listName,
        hostId: list.hostId,
        status: 'planned',
        total: adding.length,
        screening: report,
        updateContacts: existingAnswer.updateContacts,
        /*
         * WHO stated permission, stored beside WHETHER — from the session
         * that made this dry run, never from the browser's answer. Every
         * write reads the attester from here.
         */
        attested,
        attestedByUid: attested ? ctx.actorUid : null,
        attestedAtMs: attested ? Date.now() : null,
        plannedByUid: ctx.actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

  const summary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  return {
    rows,
    summary,
    warnings,
    acknowledgementsRequired: warnings.filter((entry) => entry.requiresAcknowledgement).map((entry) => entry.class),
  }
}

/**
 * The screening as one warning, or `null` when it found nothing worth a
 * word: the purchase tells first, then what the consent sample says will
 * happen, then the role accounts.
 */
export function screeningWarning(
  report: ListImportScreeningReport,
  roles: ReadonlyArray<{ index: number; email: string }>,
  attested: boolean,
): TransferWarning | null {
  const samples: TransferWarningSample[] = report.purchaseTellColumns.map((column) => ({
    row: TRANSFER_FILE_SAMPLE_ROW,
    value: column,
    detail:
      'A column named like a bought, rented or appended list. Those lists are not allowed: importing one puts every site sending through this domain at risk. If the name is a coincidence, carry on.',
  }))
  const { sample } = report
  const unlisted = !attested && sample.needAttestation > 0
  if (sample.refused > 0 || unlisted) {
    samples.push({
      row: TRANSFER_FILE_SAMPLE_ROW,
      detail:
        `${sample.size < sample.of ? `Of the first ${sample.size} of ${sample.of} new addresses` : `Of the ${sample.size} new addresses`}, ` +
        `${sample.optedIn} have an opt-in on record, ${sample.needAttestation} have none, and ${sample.refused} can never be added ` +
        '(they unsubscribed, bounced, complained or said no). ' +
        (unlisted
          ? 'You have not stated you have permission, so addresses with no opt-in on record will not be added. '
          : '') +
        'Every address is checked again as it is added.',
    })
  }
  for (const role of roles.slice(0, 5)) {
    samples.push({
      row: role.index,
      fieldId: 'email',
      value: role.email,
      detail: 'A shared mailbox — common in lists collected rather than signed up to. It is added if you go ahead.',
    })
  }
  const count = report.purchaseTellColumns.length + roles.length + (sample.refused > 0 || unlisted ? 1 : 0)
  if (!count) return null
  return {
    class: 'screening',
    count,
    rows: roles.length,
    fieldIds: roles.length ? ['email'] : [],
    samples,
    requiresAcknowledgement: true,
  }
}

/*==========================================
 * APPLY
 *=========================================*/

/** A field's planned value in a row's diff, or `undefined` when it does not change. */
function after(row: PlannedTransferRow, fieldId: string): unknown {
  return row.diff.find((change) => change.fieldId === fieldId)?.after
}

/** The contact columns a row changes, by the record's own field names, blanks left out. */
function contactProfile(row: PlannedTransferRow): Record<string, string> {
  const profile: Record<string, string> = {}
  for (const change of row.diff) {
    const key = contactFieldKey(change.fieldId)
    if (key && typeof change.after === 'string' && change.after.trim()) profile[key] = change.after.trim()
  }
  return profile
}

/** Hands a row's contact columns to the record system; `null` when it said why not. */
async function captureContact(
  ctx: TransferResourceContext,
  list: ListTarget,
  email: string,
  name: string | undefined,
  profile: Record<string, string>,
): Promise<string | null> {
  if (!Object.keys(profile).length) return null
  const captured = await capturePluginContact({
    orgId: ctx.orgId,
    hostId: list.hostId,
    ...(ctx.actorUid ? { actor: { kind: 'member' as const, uid: ctx.actorUid } } : {}),
    identity: { email, ...(name ? { name } : {}) },
    interaction: { source: 'import', summary: `Imported onto the list “${list.listName}”` },
    surface: 'touch',
    profile,
  })
  return captured && captured.ok === false ? captured.error : null
}

/** One chunk's writes (see the module note). */
export async function applyListMembers(
  ctx: TransferResourceContext,
  chunk: { rows: PlannedTransferRow[] },
  writer: Parameters<TransferRecordsHooks['apply']>[2],
): Promise<TransferApplyResult> {
  const list = await listTargetFor(ctx, { write: true })
  const results: TransferRowResult[] = []
  const undo: TransferUndoEntry[] = []

  /*
   * The ATTESTER's account, read from the ledger the dry run wrote — not
   * the caller's, and never the browser's. A colleague who resumes somebody
   * else's import has asserted nothing, and a consent record naming them
   * would be a claim nobody made. Both halves must agree: the plan this
   * apply runs was made with the statement, and the ledger says who made it.
   */
  const ledger = await list.listRef.collection(LIST_IMPORTS_SUBCOLLECTION).doc(String(ctx.jobId ?? 'unknown')).get()
  const attestingUid = String(ledger.get('attestedByUid') ?? '')
  const attested =
    readListConsentAnswer(ctx.extras)?.attest === true && ledger.get('attested') === true && !!attestingUid

  const pending: PlannedTransferRow[] = []
  for (const row of chunk.rows) {
    const done = await writer.alreadyApplied(row.index)
    if (done) results.push(done)
    else pending.push(row)
  }

  for (const batch of slices(pending, LIST_MEMBER_BATCH_MAX)) {
    if (writer.timeLeftMs() < APPLY_RESERVE_MS) break
    const creates = batch.filter((row) => row.verdict === 'create')
    const emails = creates.map((row) => normalizeContactEmail(after(row, 'email')) ?? '')
    const resolution = await resolveAddresses({ hostId: list.hostId, inputs: emails.filter(Boolean) })
    const verdicts = new Map(resolution.verdicts.filter((verdict) => verdict.email).map((verdict) => [verdict.email as string, verdict]))
    const nowMs = Date.now()

    for (const row of batch) {
      if (writer.timeLeftMs() < APPLY_RESERVE_MS) break
      const result: { result: TransferRowResult; undo?: TransferUndoEntry } =
        row.verdict === 'create'
          ? await addMember(ctx, list, row, { resolution, verdicts, attested, attestingUid, nowMs })
          : await updateMemberContact(ctx, list, row)
      await writer.markApplied(result.result, result.undo)
      results.push(result.result)
      if (result.undo) undo.push(result.undo)
    }
  }
  return { results, undo }
}

/** A refusal at the write, as a row result. */
function refused(row: PlannedTransferRow, reason: AssignmentRefusal): TransferRowResult {
  return { row: row.index, outcome: 'failed', reason, message: ASSIGNMENT_REFUSAL_MESSAGES[reason] }
}

/** One new member, through the same gate and writer a typed address goes through. */
async function addMember(
  ctx: TransferResourceContext,
  list: ListTarget,
  row: PlannedTransferRow,
  batch: {
    resolution: Awaited<ReturnType<typeof resolveAddresses>>
    verdicts: Map<string, Awaited<ReturnType<typeof resolveAddresses>>['verdicts'][number]>
    attested: boolean
    attestingUid: string
    nowMs: number
  },
): Promise<{ result: TransferRowResult; undo?: TransferUndoEntry }> {
  const email = normalizeContactEmail(after(row, 'email'))
  if (!email) return { result: refused(row, 'unroutable-address') }
  const verdict = batch.verdicts.get(email)
  if (!verdict || verdict.refusal) return { result: refused(row, verdict?.refusal ?? 'unroutable-address') }
  const decision = assignmentBasis({
    stored: batch.resolution.stored.get(email) ?? readMarketingBasis(null, batch.resolution.group),
    attested: batch.attested,
    actingUid: batch.attestingUid,
    nowMs: batch.nowMs,
  })
  if ('refusal' in decision) return { result: refused(row, decision.refusal) }

  const text = (fieldId: string) => {
    const value = after(row, fieldId)
    return typeof value === 'string' ? value.trim() : ''
  }
  const profile = contactProfile(row)
  // The list shows a name: the file's, else the one its first and last names make.
  const name = text('name') || composeContactName(profile['firstName'] ?? '', profile['lastName'] ?? '')
  const enrollment = await enrollListMember({
    listRef: list.listRef,
    group: batch.resolution.group,
    email,
    ...(name ? { name } : {}),
    source: CONSOLE_IMPORT_SOURCE,
    // Never `'rule'`: the dynamic-list materializer reconciles its own rows
    // away when somebody stops matching, and a file a merchant uploaded is
    // not a rule match that can lapse.
    via: 'manual',
    // A pass-through carries the person's grants as their record holds them
    // (AGL-3320); an attestation carries none and is this site's.
    ...(decision.basis === 'contact-opt-in' ? { grantEntries: batch.resolution.grants.get(email) ?? {} } : {}),
    consent: {
      ...decision,
      /*
       * The file's own declaration, carried onto the row it was made about —
       * but only for the basis it is evidence FOR. A pass-through carries the
       * person's own opt-in, and attaching a spreadsheet column's claim to
       * that would be dressing the person's act in the merchant's words.
       */
      ...(decision.basis === 'operator-attested'
        ? { reason: importedBasisReason({ declaredSource: text('declaredSource'), declaredAt: text('declaredAt') }) }
        : {}),
    },
  })
  if (enrollment.enrolled === false) {
    return { result: refused(row, enrollment.refusal === 'declined' ? 'declined' : 'unroutable-address') }
  }
  const contactError = await captureContact(ctx, list, email, name || undefined, profile)
  return {
    result: {
      row: row.index,
      outcome: enrollment.created ? 'created' : 'updated',
      recordId: enrollment.memberId,
      ...(contactError ? { message: `Added to the list. ${contactError}` } : {}),
    },
    /*
     * Undo takes back what the import ADDED and nothing else: a member it
     * created, while their membership still says what the import wrote. A
     * member who was already there when the write landed is not the
     * import's to remove, and the contact record is the record system's.
     */
    ...(enrollment.created
      ? {
          undo: {
            row: row.index,
            recordId: enrollment.memberId,
            action: 'created' as const,
            written: { email, ...(name ? { name } : {}), consent: 'granted' },
          },
        }
      : {}),
  }
}

/** Somebody already on the list whose contact record the operator chose to update. */
async function updateMemberContact(
  ctx: TransferResourceContext,
  list: ListTarget,
  row: PlannedTransferRow,
): Promise<{ result: TransferRowResult }> {
  const member = row.recordId ? await list.listRef.collection('members').doc(row.recordId).get() : null
  const email = normalizeContactEmail(member?.get('email'))
  if (!member?.exists || !email) {
    return { result: { row: row.index, outcome: 'failed', reason: 'matchedRecordMissing' } }
  }
  const contactError = await captureContact(ctx, list, email, undefined, contactProfile(row))
  return {
    result: contactError
      ? { row: row.index, outcome: 'failed', recordId: member.id, message: contactError }
      : { row: row.index, outcome: 'updated', recordId: member.id },
  }
}

/*==========================================
 * UNDO
 *=========================================*/

/**
 * Takes the import's new members off the list again. A membership that now
 * records a REFUSAL is never deleted, whatever the person decided: deleting
 * it would delete the record that the person said no.
 */
export async function revertListMembers(
  ctx: TransferResourceContext,
  snapshot: { entries: TransferUndoEntry[] },
  decisions?: Readonly<Record<string, 'revert' | 'keep'>>,
): Promise<TransferRevertResult> {
  const list = await listTargetFor(ctx, { write: true })
  const group = await consentGroupForSite(list.hostId)
  const members = list.listRef.collection('members')
  const done: TransferUndoStep[] = []
  const conflicts: TransferUndoStep[] = []
  for (const entry of snapshot.entries) {
    const doc = await members.doc(entry.recordId).get()
    const current = doc.exists ? memberValues(doc.id, doc.data() as Record<string, unknown>, group) : null
    const step = planTransferUndo(entry, current)
    if (current?.['consent'] === 'declined') {
      done.push({ action: 'nothing', recordId: entry.recordId, why: 'alreadyReverted' })
      continue
    }
    if (step.action === 'delete' || (step.action === 'conflict' && decisions?.[entry.recordId] === 'revert')) {
      await doc.ref.delete()
      done.push({ action: 'delete', recordId: entry.recordId })
    } else if (step.action === 'conflict') {
      conflicts.push(step)
    } else {
      done.push(step)
    }
  }
  return { done, conflicts }
}

/*==========================================
 * EXPORT
 *=========================================*/

/** The member-table predicates an export may carry: the table's own, nothing else. */
const FILTERABLE: Readonly<Record<string, readonly string[]>> = {
  email: ['=='],
  via: ['=='],
  searchTokens: ['array-contains'],
}

/**
 * The list table's filter as the export reads it — `{ filters }`, each a
 * predicate the table put on its own query — checked clause by clause:
 * only the table's fields and operators, so a request cannot ask the Admin
 * SDK a question the table never could.
 */
export function readMemberFilter(
  filter: Readonly<Record<string, unknown>> | undefined,
): Array<{ path: string; op: '==' | 'array-contains'; value: string }> {
  const clauses = Array.isArray(filter?.['filters']) ? (filter?.['filters'] as unknown[]) : []
  return clauses.map((clause) => {
    const { path, op, value } = (clause ?? {}) as { path?: unknown; op?: unknown; value?: unknown }
    if (
      typeof path !== 'string' ||
      typeof op !== 'string' ||
      typeof value !== 'string' ||
      !FILTERABLE[path]?.includes(op)
    ) {
      throw new TransferEngineError('invalid', 400, 'The filter could not be read.')
    }
    return { path, op: op as '==' | 'array-contains', value }
  })
}

/** The members query for an export's filter. */
function memberQuery(
  members: FirebaseFirestore.CollectionReference,
  options: TransferReadOptions | undefined,
): FirebaseFirestore.Query {
  let query: FirebaseFirestore.Query = members
  for (const clause of readMemberFilter(options?.filter)) query = query.where(clause.path, clause.op, clause.value)
  return query
}

/** One page of members, holding only the chosen fields. */
export async function readListMemberPage(
  ctx: TransferResourceContext,
  cursor: string | null,
  fieldIds: readonly string[],
  options?: TransferReadOptions,
): Promise<TransferReadPage> {
  // A collaborator scoped to some sites reads no member: the rules give the
  // organization's lists to org-wide members only.
  if (options?.scopeTokens) return { rows: [], next: null }
  const list = await listTargetFor(ctx, { write: false })
  const group = await consentGroupForSite(list.hostId)
  const members = list.listRef.collection('members')
  const size = Math.min(Math.max(options?.pageSize ?? 500, 1), 500)

  let docs: Array<{ id: string; data: Record<string, unknown> }>
  let next: string | null
  if (options?.ids) {
    const start = cursor ? Number(cursor) : 0
    const ids = options.ids.slice(start, start + size).filter((id) => id && !id.includes('/'))
    const snapshots = ids.length ? await members.firestore.getAll(...ids.map((id) => members.doc(id))) : []
    docs = snapshots.filter((one) => one.exists).map((one) => ({ id: one.id, data: one.data() as Record<string, unknown> }))
    next = start + size < options.ids.length ? String(start + size) : null
  } else {
    let query = memberQuery(members, options).orderBy('__name__').limit(size)
    if (cursor) query = query.startAfter(cursor)
    const snapshot = await query.get()
    docs = snapshot.docs.map((one) => ({ id: one.id, data: one.data() as Record<string, unknown> }))
    next = snapshot.docs.length === size ? (snapshot.docs[snapshot.docs.length - 1]?.id ?? null) : null
  }

  const wantsContacts = fieldIds.some((fieldId) => contactFieldKey(fieldId) !== null)
  const contacts = wantsContacts
    ? await readContactValues(
        list.hostId,
        group,
        docs.map((doc) => normalizeContactEmail(doc.data['email']) ?? ''),
      )
    : new Map<string, Record<string, unknown>>()
  const rows = docs.map((doc) => {
    const values: Record<string, unknown> = {
      ...memberValues(doc.id, doc.data, group),
      ...(contacts.get(normalizeContactEmail(doc.data['email']) ?? '') ?? {}),
    }
    return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, values[fieldId] ?? null]))
  })
  return { rows, next }
}

/** How many members an export reads. */
export async function countListMembers(
  ctx: TransferResourceContext,
  options: TransferReadOptions,
): Promise<number> {
  if (options.scopeTokens) return 0
  const list = await listTargetFor(ctx, { write: false })
  if (options.ids) return countExisting(list.listRef.collection('members'), options.ids)
  const counted = await memberQuery(list.listRef.collection('members'), options).count().get()
  return Number(counted.data().count ?? 0)
}

/*==========================================
 * LOOKUP, AND THE WHOLE RESOURCE
 *=========================================*/

/**
 * The members holding each requested address or id, and what each holds now
 * — the membership, and their contact record's columns, so the conflicts
 * step can show what an update would replace.
 */
export async function lookupListMembers(
  ctx: TransferResourceContext,
  requests: readonly MatchLookupRequest[],
): Promise<TransferLookupResult> {
  const list = await listTargetFor(ctx, { write: true })
  const group = await consentGroupForSite(list.hostId)
  const { docs, lookup } = await readMembers(list.listRef.collection('members'), requests)
  const contacts = await readContactValues(
    list.hostId,
    group,
    [...docs.values()].map((data) => normalizeContactEmail(data['email']) ?? ''),
  )
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  for (const [id, data] of docs) {
    records.set(id, {
      ...memberValues(id, data, group),
      ...(contacts.get(normalizeContactEmail(data['email']) ?? '') ?? {}),
    })
  }
  return { lookup, records }
}

/** `email.list-members`, as the framework asks it. */
export const listMembersTransferResource: TransferRecordsHooks = {
  fields: () => listMemberCatalog(),
  matchKeys: LIST_MEMBER_MATCH_KEYS,
  aliases: LIST_MEMBER_ALIASES,
  lockedRules: () => LIST_MEMBER_LOCKED_RULES,
  count: countListMembers,
  readPage: readListMemberPage,
  lookup: lookupListMembers,
  plan: planListMembers,
  apply: applyListMembers,
  revert: revertListMembers,
}
