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
 * CONTACTS ON THE TRANSFER FRAMEWORK (AGL-3527) — the server half of
 * `crm.contacts`.
 *
 * A contact is one person shared by every site of the workspace, and each
 * site's consent group keeps its own profile of them — its facet. So a
 * transfer reads and writes the facet of the site it was opened under: an
 * export at the organization level reads each person's primary holder, as
 * the org-level list does; an import always names a site, because a
 * contact is a person some site met.
 *
 * ## The writes are the CRM's own
 *
 * A new person goes through `captureHostContact`, the door every capture
 * goes through — the records band, the erasure check, the consent group's
 * facet, `contactCreated` for the automations, the company by the email's
 * domain and the owner by the assignment rules when the row names neither.
 * A matched person is changed through the contact profile route's own
 * patch (`contactPatch`): the composed name, the company link and its
 * contact counts, the list's filter keys. A stage that moves raises
 * `contactStageChanged`, as the stage route does.
 *
 * ## What a file may not do
 *
 * The locked rules: an existing contact's email is who they are; consent is
 * never taken from a file; a stage moves forward only; Do not call is
 * turned on by a file and never off; the full name follows the first and
 * last names once either is set. The plan holds each one back by row and
 * names it, so the person acknowledges it before anything is written.
 *=========================================*/

import {
  composeContactName,
  type ConsentGroup,
  contactDisplayName,
  contactFacetPath,
  type ContactFieldDefinition,
  CRM_COLLECTIONS,
  interactionsForGroup,
  isContactLifecycleStage,
  normalizeContactBirthdate,
  normalizePhone,
  planContactDetach,
  readContactFacet,
  readMarketingBasis,
} from '@aglyn/aglyn/server'
import { CONTACT_LIFECYCLE_STAGE_LABELS } from '@aglyn/aglyn/app-utils/crm'
import { CONTACT_EXTRA_PHONE_FIELDS as PHONE_FIELDS } from '@aglyn/aglyn/app-utils/contacts'
import {
  buildTransferPlan,
  planTransferUndo,
  rankTransferLookupSuggestions,
  TRANSFER_ID_FIELD,
  transferLookupNewName,
  type PlannedTransferRow,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type { TransferRecordsHooks } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  prepareContactCaptureBatch,
  removeContactKeepingRefusals,
  restampCrmListFieldsOf,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'
import { contactPrimaryGroup } from '../model/contact-holder'
import type { ContactUpdateFields } from '../model/contact-update'
import { captureHostContact } from '../server/capture-host-contact'
import { CONTACT_NOTES_MAX } from '../server/contact-profile'
import {
  cachedContactReader,
  clearReportsToOf,
  CONTACT_REPORTS_TO_LOOP_REFUSAL,
  CONTACT_REPORTS_TO_SELF_REFUSAL,
  contactFacetHolders,
  contactReportsToLoops,
} from '../server/contact-reports-to'
import { contactPatch, settleCompanyCounts } from '../server/contact-update'
import { sweepDealContactRoles } from '../server/deal-contact-roles'
import { CONTACT_ALIASES } from './aliases'
import {
  addCrmPicklistValues,
  addressFromValues,
  addressValues,
  countCrmExport,
  crmCustomDefinitions,
  crmMemberEmails,
  crmMembersTarget,
  crmPicklistLists,
  crmRecordsRoom,
  crmTransferEnv,
  type CrmTransferEnv,
  customTransferValues,
  customWriteValues,
  eachWithinBudget,
  failureMessage,
  holdBackChanges,
  IN_LIMIT,
  isoOf,
  lookupByField,
  lookupById,
  lookupResult,
  pickValues,
  plannedValues,
  readCrmExportPage,
  requireCrmSuite,
  requireSite,
  textOf,
  TransferEngineError,
  visibleIn,
} from './common'
import { companyForName } from './companies'
import {
  CONTACT_TRANSFER_DERIVED,
  CONTACT_TRANSFER_FIELDS,
  CONTACT_TRANSFER_GROUPS,
  CRM_MEMBERS_TARGET,
  CRM_TIMESTAMP_FIELDS,
  crmCustomTransferFields,
  crmLifecycleStageOf,
  crmLifecycleStageRank,
} from './fields'

/** The sentence an imported person's timeline opens with. */
export const CONTACT_TRANSFER_INTERACTION_SUMMARY = 'Imported from a file'

const SUITE_ACT = 'Importing contacts'

const contactsOf = (env: CrmTransferEnv) => env.orgRef.collection('contacts')

/** The holder a contact is read through: the site's group, else the person's primary holder. */
function holderOf(env: CrmTransferEnv, contact: Record<string, unknown>): ConsentGroup {
  return env.group ?? contactPrimaryGroup(contact, env.org)
}

/** Why a capture refused a person, in the result's words. */
const CAPTURE_REFUSALS: Readonly<Record<string, string>> = {
  band: 'The contact limit is reached.',
  'invalid-email': 'Not a valid email address.',
  erased: 'Erased from this workspace at their request.',
  error: 'The contact could not be saved.',
}

/**
 * One contact as values by field id, read through one holder's facet. A
 * lookup and an undo read links by id (`ids`), so the plan compares what is
 * stored; an export writes names a file can carry back (`names`).
 */
export function contactTransferValues(
  id: string,
  contact: Record<string, unknown>,
  group: ConsentGroup,
  definitions: readonly ContactFieldDefinition[],
  names?: { owner: (uid: string) => string | undefined; manager: (id: string) => string | undefined },
): Record<string, unknown> {
  const facet = readContactFacet(contact, group.groupId)
  const text = (value: unknown) => textOf(value) || null
  const stage = isContactLifecycleStage(facet.lifecycleStage) ? CONTACT_LIFECYCLE_STAGE_LABELS[facet.lifecycleStage] : null
  const basis = group.groupId ? readMarketingBasis(contact, group).basis : 'unrecorded'
  const ownerUid = text(facet.ownerUid)
  const managerId = text(facet.reportsToContactId)
  return {
    // The name first: a record's label is the first text it holds.
    name: text(contactDisplayName(contact, group.groupId)),
    email: text(contact['email']),
    salutation: text(facet.salutation),
    firstName: text(facet.firstName),
    lastName: text(facet.lastName),
    birthdate: text(facet.birthdate),
    phone: text(facet.phone),
    mobilePhone: text(facet.mobilePhone),
    homePhone: text(facet.homePhone),
    otherPhone: text(facet.otherPhone),
    fax: text(facet.fax),
    doNotCall: facet.doNotCall === true,
    assistantName: text(facet.assistantName),
    assistantPhone: text(facet.assistantPhone),
    jobTitle: text(facet.jobTitle),
    department: text(facet.department),
    company: names ? text(facet.companyName) : text(facet.companyId),
    reportsTo: managerId ? (names ? (names.manager(managerId) ?? managerId) : managerId) : null,
    ...addressValues('mailing', facet.address),
    ...addressValues('other', facet.otherAddress),
    owner: ownerUid ? (names ? (names.owner(ownerUid) ?? ownerUid) : ownerUid) : null,
    lifecycleStage: stage,
    leadSource: text(facet.leadSource),
    tags: Array.isArray(facet.tags) ? facet.tags : [],
    notes: text(facet.notes),
    marketingConsent: basis === 'granted' ? true : basis === 'declined' ? false : null,
    sources: Object.keys(facet.sources ?? {}),
    lastInteractionAt: isoOf(interactionsForGroup(facet.interactions, group.hostIds)[0]?.atMs),
    lastEngagedAt: isoOf(facet.lastEmailEngagementAtMs),
    createdAt: isoOf(contact['createdAt']),
    updatedAt: isoOf(contact['updatedAt']),
    ...customTransferValues(definitions, facet.custom),
    [TRANSFER_ID_FIELD]: id,
  }
}

/** The contacts these ids name, as values through the site's facet. */
async function readContacts(
  env: CrmTransferEnv,
  ids: readonly string[],
  definitions: readonly ContactFieldDefinition[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>()
  for (let at = 0; at < ids.length; at += 500) {
    const page = ids.slice(at, at + 500).filter((id) => id && !id.includes('/'))
    if (!page.length) continue
    for (const snapshot of await env.firestore.getAll(...page.map((id) => contactsOf(env).doc(id)))) {
      const data = snapshot.data()
      if (snapshot.exists && data && visibleIn(env, data['visibleTo'])) {
        out.set(snapshot.id, contactTransferValues(snapshot.id, data, holderOf(env, data), definitions))
      }
    }
  }
  return out
}

/** A company link a row names: the company and its name, or `null` to unlink. */
interface CompanyLink {
  id: string | null
  name: string
}

/** Everything one apply call shares across its rows. */
interface ApplyRun {
  env: CrmTransferEnv
  hostId: string
  group: ConsentGroup
  actorUid: string | null
  definitions: ContactFieldDefinition[]
  companies: Map<string, Promise<{ id: string; name: string } | null>>
  admit: () => Promise<boolean>
  readContact: ReturnType<typeof cachedContactReader>
}

/** The company a row's company column names, resolved: an id the engine found, or one created by name. */
async function companyLinkFor(run: ApplyRun, value: unknown): Promise<CompanyLink> {
  if (value === null || value === undefined || value === '') return { id: null, name: '' }
  const create = transferLookupNewName(value)
  if (create) {
    const company = await companyForName(run.env, create, run.actorUid, run.companies, run.admit)
    if (!company) throw new TransferEngineError('invalid', 422, 'The CRM records limit has no room for the company.')
    return company
  }
  const snapshot = await run.env.orgRef.collection(CRM_COLLECTIONS.companies).doc(String(value)).get()
  if (!snapshot.exists || !visibleIn(run.env, snapshot.get('visibleTo'))) {
    throw new TransferEngineError('notFound', 404, 'The company this row names no longer exists.')
  }
  return { id: snapshot.id, name: textOf(snapshot.get('name')).slice(0, 120) }
}

/**
 * A row's values as the profile route's fields: each one normalized the way
 * that route reads it, a blank clearing it. Fields a value could not be
 * stored as are left out and named in `skipped`.
 */
function profileFields(
  values: Readonly<Record<string, unknown>>,
  stored: ReturnType<typeof readContactFacet>,
): { fields: ContactUpdateFields; skipped: string[] } {
  const fields: ContactUpdateFields = {}
  const skipped: string[] = []
  const text = (key: string, max = 120) => textOf(values[key]).slice(0, max)
  for (const key of ['jobTitle', 'department', 'assistantName', 'salutation', 'leadSource'] as const) {
    if (key in values) fields[key] = text(key)
  }
  if ('firstName' in values) fields.firstName = composeContactName(text('firstName'), '')
  if ('lastName' in values) fields.lastName = composeContactName('', text('lastName'))
  for (const key of ['phone', ...PHONE_FIELDS] as const) {
    if (!(key in values)) continue
    const typed = text(key, 40)
    const phone = typed ? normalizePhone(typed) : ''
    if (phone === null) skipped.push(key)
    else fields[key] = phone
  }
  if ('birthdate' in values) {
    const birthdate = normalizeContactBirthdate(text('birthdate', 20))
    if (birthdate === null) skipped.push('birthdate')
    else fields.birthdate = birthdate
  }
  if ('doNotCall' in values) fields.doNotCall = values['doNotCall'] === true
  if ('notes' in values) fields.notes = textOf(values['notes']).slice(0, CONTACT_NOTES_MAX)
  if ('tags' in values) fields.tags = Array.isArray(values['tags']) ? (values['tags'] as string[]).slice(0, 20) : []
  if ('owner' in values) fields.ownerUid = text('owner', 128)
  if ('reportsTo' in values) fields.reportsToContactId = text('reportsTo', 200) || null
  const mailing = addressFromValues('mailing', values, stored.address)
  if (mailing !== undefined) fields.address = mailing
  const other = addressFromValues('other', values, stored.otherAddress)
  if (other !== undefined) fields.otherAddress = other
  // The name follows the first and last names once either is set; only a
  // holder with neither keeps a name of its own.
  const composed = composeContactName(fields.firstName ?? stored.firstName, fields.lastName ?? stored.lastName)
  if ('name' in values && !composed) fields.name = text('name')
  return { fields, skipped }
}

/** The sentence a row's result carries for fields it could not store. */
function skippedMessage(skipped: readonly string[]): string | undefined {
  if (!skipped.length) return undefined
  const labels = skipped.map((id) => CONTACT_TRANSFER_FIELDS.find((field) => field.id === id)?.label ?? id)
  return `Not written, as the value could not be read: ${labels.join(', ')}.`
}

/**
 * Writes one existing contact's values through the profile route's patch,
 * and the stage beside it. Answers the stage it replaced when it moved one,
 * and the fields left out.
 */
async function writeContact(
  run: ApplyRun,
  contactId: string,
  values: Readonly<Record<string, unknown>>,
): Promise<{ skipped: string[] }> {
  const ref = contactsOf(run.env).doc(contactId)
  const snapshot = await ref.get()
  const contact = snapshot.data()
  if (!snapshot.exists || !contact || !visibleIn(run.env, contact['visibleTo'])) {
    throw new TransferEngineError('notFound', 404, 'That contact no longer exists.')
  }
  const groupId = run.group.groupId
  const stored = readContactFacet(contact, groupId)
  const { fields, skipped } = profileFields(values, stored)
  let linkedCompanyName = ''
  if ('company' in values) {
    const link = await companyLinkFor(run, values['company'])
    fields.companyId = link.id
    linkedCompanyName = link.name
  }
  if (fields.reportsToContactId) {
    const managerId = fields.reportsToContactId
    if (managerId === contactId) throw new TransferEngineError('invalid', 422, CONTACT_REPORTS_TO_SELF_REFUSAL)
    if (await contactReportsToLoops(run.readContact, contactId, managerId, groupId)) {
      throw new TransferEngineError('invalid', 422, CONTACT_REPORTS_TO_LOOP_REFUSAL)
    }
  }
  const custom = customWriteValues(values, run.definitions, 'contact')
  if ('error' in custom) throw new TransferEngineError('invalid', 422, custom.error)
  const patch = contactPatch(contact, groupId, fields, custom.values, linkedCompanyName)
  if ('refused' in patch) throw new TransferEngineError('invalid', 422, patch.refused)
  const update: Record<string, unknown> = { ...(patch.update ?? {}) }

  let movedFrom: string | null = null
  if ('lifecycleStage' in values) {
    const stage = crmLifecycleStageOf(values['lifecycleStage'])
    const previous = isContactLifecycleStage(stored.lifecycleStage) ? stored.lifecycleStage : ''
    if ((stage ?? '') !== previous) {
      update[contactFacetPath(groupId, 'lifecycleStage')] = stage ?? FieldValue.delete()
      if (stage) movedFrom = previous
    }
  }
  if (!Object.keys(update).length) return { skipped }
  update['updatedAt'] = FieldValue.serverTimestamp()
  await ref.update(update)
  await restampCrmListFieldsOf([ref], 'contacts')
  await settleCompanyCounts(run.env.orgRef.collection(CRM_COLLECTIONS.companies), [
    { contactId, ref, update, counts: patch.counts },
  ])
  if (movedFrom !== null) {
    await emitHostEvent(
      run.hostId,
      'contactStageChanged',
      {
        contactId,
        email: textOf(contact['email']),
        lifecycleStage: String(crmLifecycleStageOf(values['lifecycleStage'])),
        previousStage: movedFrom,
      },
      run.actorUid ? { actor: { kind: 'member', uid: run.actorUid, email: null } } : {},
    ).catch((error: unknown) => console.error('[crm] transfer stage event failed', contactId, error))
  }
  return { skipped }
}

/** Creates one person through the capture door, then what the door does not take. */
async function createContact(
  run: ApplyRun,
  values: Readonly<Record<string, unknown>>,
  batch: Awaited<ReturnType<typeof prepareContactCaptureBatch>> | undefined,
): Promise<{ contactId: string; created: boolean; skipped: string[] }> {
  const email = textOf(values['email'])
  const { fields, skipped } = profileFields(values, { sources: {}, interactions: [] })
  const link = 'company' in values ? await companyLinkFor(run, values['company']) : null
  const custom = customWriteValues(values, run.definitions, 'contact')
  if ('error' in custom) throw new TransferEngineError('invalid', 422, custom.error)
  const stage = crmLifecycleStageOf(values['lifecycleStage'])
  const verdict = await captureHostContact({
    hostId: run.hostId,
    email,
    ...(fields.name ? { name: fields.name } : {}),
    source: 'import',
    ...(run.actorUid ? { actor: { kind: 'member' as const, uid: run.actorUid, email: null } } : {}),
    interaction: { summary: CONTACT_TRANSFER_INTERACTION_SUMMARY },
    tags: fields.tags ?? [],
    facet: {
      ...(fields.phone ? { phone: fields.phone } : {}),
      ...(fields.jobTitle ? { jobTitle: fields.jobTitle } : {}),
      ...(fields.salutation ? { salutation: fields.salutation } : {}),
      ...(fields.firstName ? { firstName: fields.firstName } : {}),
      ...(fields.lastName ? { lastName: fields.lastName } : {}),
      ...(fields.department ? { department: fields.department } : {}),
      ...Object.fromEntries(PHONE_FIELDS.filter((key) => fields[key]).map((key) => [key, fields[key]])),
      ...(fields.birthdate ? { birthdate: fields.birthdate } : {}),
      ...(fields.assistantName ? { assistantName: fields.assistantName } : {}),
      ...(fields.leadSource ? { leadSource: fields.leadSource } : {}),
      ...(fields.doNotCall ? { doNotCall: true } : {}),
      ...(fields.address ? { address: fields.address } : {}),
      ...(fields.otherAddress ? { otherAddress: fields.otherAddress } : {}),
      // The link AND the name: the merge fields read the facet's name.
      ...(link?.id ? { companyId: link.id, companyName: link.name } : {}),
      ...(fields.ownerUid ? { ownerUid: fields.ownerUid } : {}),
      ...(stage ? { lifecycleStage: stage } : {}),
      ...(Object.keys(custom.values).length ? { custom: custom.values } : {}),
    },
    // An import files nobody under a campaign; the record's picker does.
    campaignIds: [],
    ...(batch ? { batch } : {}),
  })
  if ('refused' in verdict) {
    throw new TransferEngineError('invalid', 422, CAPTURE_REFUSALS[verdict.refused] ?? CAPTURE_REFUSALS['error'] as string)
  }
  // What the capture door does not write: who they report to, and the notes.
  const extra: Record<string, unknown> = {}
  if (fields.reportsToContactId) extra['reportsTo'] = fields.reportsToContactId
  if (fields.notes) extra['notes'] = fields.notes
  if (Object.keys(extra).length) await writeContact(run, verdict.contactId, extra)
  return { contactId: verdict.contactId, created: verdict.created, skipped }
}

/** The `crm.contacts` hooks. */
export function contactsTransferResource(): TransferRecordsHooks {
  return {
    async fields(ctx) {
      const env = await crmTransferEnv(ctx)
      return {
        standard: CONTACT_TRANSFER_FIELDS,
        derived: CONTACT_TRANSFER_DERIVED,
        system: CRM_TIMESTAMP_FIELDS,
        custom: crmCustomTransferFields(await crmCustomDefinitions(env, 'contact'), 'contact'),
        groups: CONTACT_TRANSFER_GROUPS,
      }
    },
    matchKeys: [
      { fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' },
      { fieldId: 'email', normalizer: 'email' },
    ],
    aliases: CONTACT_ALIASES,
    lookupTargets: { [CRM_MEMBERS_TARGET]: crmMembersTarget() },

    // The people a workspace holds are its own on every plan (AGL-2839):
    // exporting them asks nothing of the plan.
    async count(ctx, options) {
      const env = await crmTransferEnv(ctx)
      return countCrmExport(env, contactsOf(env), options, (data) => visibleIn(env, data['visibleTo'], options.scopeTokens))
    },

    async readPage(ctx, cursor, fieldIds, options) {
      const env = await crmTransferEnv(ctx)
      const definitions = await crmCustomDefinitions(env, 'contact')
      const emails = fieldIds.includes('owner') ? await crmMemberEmails(env.orgId) : new Map<string, string>()
      return readCrmExportPage(
        env,
        contactsOf(env),
        cursor,
        options,
        (data) => visibleIn(env, data['visibleTo'], options?.scopeTokens),
        async (docs) => {
          const managers = new Map<string, string>()
          if (fieldIds.includes('reportsTo')) {
            const ids = [
              ...new Set(
                docs
                  .map((doc) => textOf(readContactFacet(doc.data, holderOf(env, doc.data).groupId).reportsToContactId))
                  .filter((id) => id && !id.includes('/')),
              ),
            ]
            for (let at = 0; at < ids.length; at += 500) {
              const page = ids.slice(at, at + 500)
              for (const snapshot of await env.firestore.getAll(...page.map((id) => contactsOf(env).doc(id)))) {
                if (snapshot.exists) managers.set(snapshot.id, textOf(snapshot.get('email')))
              }
            }
          }
          return docs.map((doc) =>
            pickValues(
              contactTransferValues(doc.id, doc.data, holderOf(env, doc.data), definitions, {
                owner: (uid) => emails.get(uid),
                manager: (id) => managers.get(id),
              }),
              fieldIds,
            ),
          )
        },
      )
    },

    async lookup(ctx, requests) {
      const env = await crmTransferEnv(ctx)
      const definitions = await crmCustomDefinitions(env, 'contact')
      const visible = (data: Record<string, unknown>) => visibleIn(env, data['visibleTo'])
      const found = { lookup: new Map<string, string[]>(), docs: new Map<string, Record<string, unknown>>() }
      for (const request of requests) {
        if (request.fieldId === TRANSFER_ID_FIELD) await lookupById(env, contactsOf(env), request, visible, found)
        else if (request.fieldId === 'email') {
          await lookupByField(contactsOf(env), request, 'email', (value) => value.trim().toLowerCase(), visible, found)
        }
      }
      return lookupResult(found, (id, data) => contactTransferValues(id, data, holderOf(env, data), definitions))
    },

    async suggest(ctx, request) {
      const env = await crmTransferEnv(ctx)
      const answer: Record<string, ReturnType<typeof rankTransferLookupSuggestions>> = {}
      for (const value of request.values) {
        // People sharing the value's first word: the token the list's own
        // search reads, so a mistyped domain still finds the person.
        const word = value.trim().toLowerCase().split(/[\s@.+_-]+/)[0]?.slice(0, 12) ?? ''
        if (word.length < 2) {
          answer[value] = []
          continue
        }
        const snapshot = await contactsOf(env).where('searchTokens', 'array-contains', word).limit(IN_LIMIT).get()
        const candidates = snapshot.docs
          .filter((doc) => visibleIn(env, doc.get('visibleTo')))
          .flatMap((doc) => {
            const email = textOf(doc.get('email'))
            return email ? [{ recordId: doc.id, label: email }] : []
          })
        answer[value] = rankTransferLookupSuggestions(value, candidates)
      }
      return answer
    },

    async picklists(ctx, ids) {
      const env = await crmTransferEnv(ctx)
      return crmPicklistLists(env, ids, await crmCustomDefinitions(env, 'contact'))
    },

    async addPicklistValues(ctx, picklistId, values) {
      await addCrmPicklistValues(await crmTransferEnv(ctx), picklistId, values)
    },

    lockedRules: () => [
      {
        fieldId: 'email',
        reason: 'An existing contact’s email is who they are; change it on the contact’s page.',
        forced: { mode: 'keepExisting' },
      },
      {
        fieldId: 'marketingConsent',
        reason:
          'Consent is never taken from a file: a person gives it on a form, or a team member records how it was given on the contact’s page.',
        refuseValues: true,
      },
      {
        fieldId: 'lifecycleStage',
        reason: 'A stage moves forward only: a later stage in the file advances the contact, an earlier one is held back.',
        forced: { mode: 'overwrite' },
      },
      {
        fieldId: 'doNotCall',
        reason: 'A file can say a person asked not to be called, never that they took it back.',
        forced: { mode: 'overwrite' },
      },
      {
        fieldId: 'name',
        reason: 'The full name is built from the first and last names once either is set.',
      },
    ],

    async plan(ctx, input) {
      const env = await crmTransferEnv(ctx)
      requireCrmSuite(env, SUITE_ACT)
      requireSite(env, 'contacts')
      const plan = buildTransferPlan(input)
      return holdBackChanges(plan, (row, change) => {
        const before = row.recordId ? input.existing.get(row.recordId) : undefined
        if (change.fieldId === 'lifecycleStage' && before) {
          const from = crmLifecycleStageRank(before['lifecycleStage'])
          const to = crmLifecycleStageRank(change.after)
          if (from >= 0 && (to < from || to < 0)) return 'A stage moves forward only.'
        }
        if (change.fieldId === 'doNotCall' && before?.['doNotCall'] === true && change.after !== true) {
          return 'Do not call is turned off on the contact’s page, never by a file.'
        }
        if (change.fieldId === 'name') {
          const values = Object.fromEntries(row.diff.map((entry) => [entry.fieldId, entry.after]))
          const first = 'firstName' in values ? values['firstName'] : before?.['firstName']
          const last = 'lastName' in values ? values['lastName'] : before?.['lastName']
          if (textOf(first) || textOf(last)) return 'Built from the first and last names.'
        }
        return null
      })
    },

    async apply(ctx, chunk, writer) {
      const env = await crmTransferEnv(ctx)
      requireCrmSuite(env, SUITE_ACT)
      const { hostId, group } = requireSite(env, 'contacts')
      const run: ApplyRun = {
        env,
        hostId,
        group,
        actorUid: ctx.actorUid,
        definitions: await crmCustomDefinitions(env, 'contact'),
        companies: new Map(),
        admit: crmRecordsRoom(env),
        readContact: cachedContactReader(contactsOf(env)),
      }
      const rows = chunk.rows as PlannedTransferRow[]
      const creating: string[] = []
      for (const row of rows) {
        if (row.verdict === 'create' && !(await writer.alreadyApplied(row.index))) {
          const email = textOf(plannedValues(row)['email'])
          if (email) creating.push(email)
        }
      }
      // The capture door's lookups for every new person at once (AGL-3423).
      const batch = creating.length ? await prepareContactCaptureBatch(hostId, creating) : undefined
      const results: TransferRowResult[] = []
      const undo: TransferUndoEntry[] = []

      await eachWithinBudget(rows, () => writer.timeLeftMs(), async (row) => {
        const earlier = await writer.alreadyApplied(row.index)
        if (earlier) {
          results.push(earlier)
          return
        }
        const changed = row.diff.map((change) => change.fieldId)
        let result: TransferRowResult
        let entry: TransferUndoEntry | undefined
        try {
          const values = plannedValues(row)
          if (row.verdict === 'update' && row.recordId) {
            const before = (await readContacts(env, [row.recordId], run.definitions)).get(row.recordId)
            if (!before) throw new TransferEngineError('notFound', 404, 'That contact no longer exists.')
            const { skipped } = await writeContact(run, row.recordId, values)
            const after = (await readContacts(env, [row.recordId], run.definitions)).get(row.recordId) ?? {}
            const message = skippedMessage(skipped)
            result = { row: row.index, outcome: 'updated', recordId: row.recordId, ...(message ? { message } : {}) }
            entry = {
              row: row.index,
              recordId: row.recordId,
              action: 'updated',
              previous: pickValues(before, changed),
              written: pickValues(after, changed),
            }
          } else {
            const made = await createContact(run, values, batch)
            const after = (await readContacts(env, [made.contactId], run.definitions)).get(made.contactId) ?? {}
            const message = made.created
              ? skippedMessage(made.skipped)
              : 'Merged into the contact already holding this email.'
            result = {
              row: row.index,
              outcome: made.created ? 'created' : 'updated',
              recordId: made.contactId,
              ...(message ? { message } : {}),
            }
            // A merge into a person somebody else created meanwhile has no
            // "before" to put back, so undo leaves it alone.
            entry = made.created
              ? { row: row.index, recordId: made.contactId, action: 'created', written: pickValues(after, changed) }
              : undefined
          }
        } catch (error) {
          result = {
            row: row.index,
            outcome: 'failed',
            ...(row.recordId ? { recordId: row.recordId } : {}),
            message: failureMessage(error),
          }
          entry = undefined
        }
        await writer.markApplied(result, entry)
        results.push(result)
        if (entry) undo.push(entry)
      })
      return { results, undo }
    },

    async revert(ctx, snapshot, decisions) {
      const env = await crmTransferEnv(ctx)
      const { hostId, group } = requireSite(env, 'contacts')
      const run: ApplyRun = {
        env,
        hostId,
        group,
        actorUid: ctx.actorUid,
        definitions: await crmCustomDefinitions(env, 'contact'),
        companies: new Map(),
        admit: crmRecordsRoom(env),
        readContact: cachedContactReader(contactsOf(env)),
      }
      const current = await readContacts(env, snapshot.entries.map((entry) => entry.recordId), run.definitions)
      const done: TransferUndoStep[] = []
      const conflicts: TransferUndoStep[] = []
      for (const entry of snapshot.entries) {
        const step = planTransferUndo(entry, current.get(entry.recordId) ?? null)
        if (step.action === 'conflict' && decisions?.[entry.recordId] !== 'revert') {
          if (decisions?.[entry.recordId] === 'keep') done.push({ action: 'nothing', recordId: entry.recordId, why: 'alreadyReverted' })
          else conflicts.push(step)
          continue
        }
        if (step.action === 'nothing') {
          done.push(step)
          continue
        }
        if (entry.action === 'created') {
          // The site lets the person go, as "Remove from this site" does: a
          // person only this import's site held is deleted, keeping every
          // refusal they made; one another site holds too stays theirs.
          const contactRef = contactsOf(env).doc(entry.recordId)
          let holders: string[] = []
          const removal = await removeContactKeepingRefusals({
            contactRef,
            decide: (contact) => {
              holders = contactFacetHolders(contact)
              return planContactDetach(contact, group)
            },
            nowMs: Date.now(),
          })
          if (removal.outcome === 'deleted') {
            await clearReportsToOf(env.firestore, contactsOf(env), holders, entry.recordId)
            await sweepDealContactRoles(
              env.firestore,
              env.orgRef.collection(CRM_COLLECTIONS.deals),
              entry.recordId,
              null,
              '[crm] transfer undo',
            )
          } else if (removal.outcome === 'detached') {
            await clearReportsToOf(env.firestore, contactsOf(env), [group.groupId], entry.recordId)
            await restampCrmListFieldsOf([contactRef], 'contacts').catch(() => undefined)
          }
          done.push({ action: 'delete', recordId: entry.recordId })
          continue
        }
        const values = step.action === 'restore' || step.action === 'conflict' ? step.values : {}
        await writeContact(run, entry.recordId, values)
        done.push(step)
      }
      return { done, conflicts }
    },
  }
}
