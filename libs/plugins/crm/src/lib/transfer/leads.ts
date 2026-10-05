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
 * LEADS ON THE TRANSFER FRAMEWORK (AGL-3528) — the server half of
 * `crm.leads`.
 *
 * A lead is one person an organization's sites captured and nobody has
 * qualified yet: one document per person (`personKey(email)`), seen by the
 * sites that captured them. Every field a lead holds — its own profile of
 * the person and their company as text, its status, owner, lead source,
 * campaigns, notes and custom fields — is read for an export, and an import
 * writes through the door every capture uses (`addHostLead`: the person
 * keyed by address, the lead ceiling, the capturing site's scope), then the
 * working state the old leads import wrote beside it.
 *
 * A lead is QUALIFIED only by converting it, which makes the contact, the
 * company and the deal; a file may set any other status. Do not call is
 * turned on by a file and never off, and the name follows the first and
 * last names once either is set — the rules the lead page keeps.
 *=========================================*/

import {
  checkVisitorRecordCeiling,
  CONTACT_EXTRA_PHONE_FIELDS,
  type ContactFieldDefinition,
  CRM_LEAD_STATUS_PICKLIST,
  CRM_LEAD_STATUSES,
  type CrmLeadStatus,
  type CrmPicklist,
  crmLeadComposedName,
  crmLeadStatusLabel,
  LEADS_MAX_PER_HOST,
  normalizeCompanyWebsite,
  normalizeCrmLeadTags,
  normalizePhone,
  personKey,
  resolveCrmLeadStatusWrite,
} from '@aglyn/aglyn/server'
import {
  buildTransferPlan,
  matchLookupKey,
  planTransferUndo,
  TRANSFER_ID_FIELD,
  type CurrencyAmount,
  type PlannedTransferRow,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type { TransferRecordsHooks } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { addHostLeadOutcome, restampCrmListFieldsAt } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { csvLeadSourceLabel, csvLeadSources } from '../model/crm-csv'
import { judgeLeadPicklistPatch, readLeadPicklists } from '../server/lead-picklists'
import { readLeadSourcePicklist, resolveLeadSourceWrite } from '../server/lead-source-picklist'
import { readCrmPicklist } from '../server/read-picklist'
import { LEAD_ALIASES } from './aliases'
import {
  addCrmPicklistValues,
  addressFromValues,
  addressValues,
  campaignDirectory,
  countCrmExport,
  crmCustomDefinitions,
  crmMemberEmails,
  crmMembersTarget,
  crmPicklistLists,
  crmTransferEnv,
  type CrmTransferEnv,
  customTransferValues,
  customWriteValues,
  eachWithinBudget,
  failureMessage,
  holdBackChanges,
  isoOf,
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
import {
  CRM_MEMBERS_TARGET,
  CRM_TIMESTAMP_FIELDS,
  crmCustomTransferFields,
  LEAD_TRANSFER_DERIVED,
  LEAD_TRANSFER_FIELDS,
  LEAD_TRANSFER_GROUPS,
} from './fields'

const SUITE_ACT = 'Importing leads'

/** How an import names itself as a lead's source — the capture surface `import`. */
const LEAD_IMPORT_SOURCE = 'import'

/** The statuses a file may set: every one but Qualified, which a conversion alone sets. */
const FILE_STATUSES: readonly CrmLeadStatus[] = CRM_LEAD_STATUSES.filter((status) => status !== 'qualified')

const leadsOf = (env: CrmTransferEnv) => env.orgRef.collection('leads')

/** Names written in place of ids, and the org's status list. */
interface LeadNames {
  owner?: (uid: string) => string | undefined
  campaign?: (id: string) => string | undefined
  /** Amounts as `1250.00 USD`. */
  display?: boolean
}

/** One lead as values by field id. */
export function leadTransferValues(
  id: string,
  lead: Record<string, unknown>,
  statuses: CrmPicklist,
  definitions: readonly ContactFieldDefinition[],
  names: LeadNames = {},
): Record<string, unknown> {
  const text = (value: unknown) => textOf(value) || null
  const revenue = typeof lead['annualRevenueCents'] === 'number' ? (lead['annualRevenueCents'] as number) : null
  const currency = String(lead['currency'] || 'usd').toUpperCase()
  const ownerUid = text(lead['ownerUid'])
  const campaignIds = Array.isArray(lead['campaignIds']) ? (lead['campaignIds'] as unknown[]).map(String) : []
  const captures = Number(lead['submissionCount'] ?? 0)
  return {
    // The name first: a record's label is the first text it holds.
    name: text(lead['name']),
    email: text(lead['email']),
    salutation: text(lead['salutation']),
    firstName: text(lead['firstName']),
    lastName: text(lead['lastName']),
    company: text(lead['company']),
    jobTitle: text(lead['jobTitle']),
    phone: text(lead['phone']),
    mobilePhone: text(lead['mobilePhone']),
    fax: text(lead['fax']),
    doNotCall: lead['doNotCall'] === true,
    website: text(lead['website']),
    ...addressValues('address', lead['address']),
    status: crmLeadStatusLabel(lead, statuses) || null,
    owner: ownerUid ? (names.owner?.(ownerUid) ?? ownerUid) : null,
    leadSource: text(lead['leadSource']),
    industry: text(lead['industry']),
    rating: text(lead['rating']),
    numberOfEmployees: typeof lead['numberOfEmployees'] === 'number' ? lead['numberOfEmployees'] : null,
    annualRevenue:
      revenue === null ? null : names.display ? `${(revenue / 100).toFixed(2)} ${currency}` : { amountMinor: revenue, currency },
    tags: Array.isArray(lead['tags']) ? (lead['tags'] as string[]) : [],
    campaigns: campaignIds.map((campaign) => names.campaign?.(campaign) ?? campaign),
    notes: text(lead['notes']),
    unqualifiedReason: text(lead['unqualifiedReason']),
    sources: csvLeadSources(lead).map(csvLeadSourceLabel),
    firstSeenAt: isoOf(lead['firstSeenAtMs'] ?? lead['createdAt']),
    lastSeenAt: isoOf(lead['lastSeenAtMs'] ?? lead['createdAt']),
    captures: Number.isFinite(captures) && captures > 0 ? captures : 0,
    convertedAt: isoOf(lead['convertedAtMs']),
    createdAt: isoOf(lead['createdAt']),
    updatedAt: isoOf(lead['updatedAt']),
    ...customTransferValues(definitions, lead['custom']),
    [TRANSFER_ID_FIELD]: id,
  }
}

/** Everything one apply call shares. */
interface ApplyRun {
  env: CrmTransferEnv
  hostId: string
  statuses: CrmPicklist
  leadSources: CrmPicklist
  picklists: Awaited<ReturnType<typeof readLeadPicklists>>
  definitions: ContactFieldDefinition[]
  campaigns: Awaited<ReturnType<typeof campaignDirectory>>
}

/** The leads these ids name, as values (campaigns by name, so the plan compares what a file carries). */
async function readLeads(run: Pick<ApplyRun, 'env' | 'statuses' | 'definitions' | 'campaigns'>, ids: readonly string[]) {
  const out = new Map<string, Record<string, unknown>>()
  const wanted = ids.filter((id) => id && !id.includes('/'))
  for (let at = 0; at < wanted.length; at += 500) {
    for (const snapshot of await run.env.firestore.getAll(...wanted.slice(at, at + 500).map((id) => leadsOf(run.env).doc(id)))) {
      const data = snapshot.data()
      if (snapshot.exists && data && visibleIn(run.env, data['visibleTo'])) {
        out.set(snapshot.id, leadTransferValues(snapshot.id, data, run.statuses, run.definitions, { campaign: (id) => run.campaigns.names.get(id) }))
      }
    }
  }
  return out
}

/**
 * The fields a row's values write to a lead, over the lead as it stands;
 * `null` clears. Each value is held to the shape the lead page stores it in.
 */
function leadFields(
  run: ApplyRun,
  values: Readonly<Record<string, unknown>>,
  current: Record<string, unknown> | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  const text = (key: string, max = 120) => textOf(values[key]).slice(0, max) || null
  for (const key of ['company', 'jobTitle', 'salutation', 'industry', 'rating', 'unqualifiedReason'] as const) {
    if (key in values) fields[key] = text(key)
  }
  for (const key of ['firstName', 'lastName'] as const) if (key in values) fields[key] = text(key)
  if ('notes' in values) fields['notes'] = text('notes', 4000)
  for (const key of ['phone', ...CONTACT_EXTRA_PHONE_FIELDS.filter((field) => field === 'mobilePhone' || field === 'fax')] as const) {
    if (!(key in values)) continue
    const typed = textOf(values[key])
    const phone = typed ? normalizePhone(typed) : null
    if (typed && !phone) throw new TransferEngineError('invalid', 422, `“${typed}” is not a phone number.`)
    fields[key] = phone
  }
  if ('website' in values) {
    const typed = textOf(values['website'])
    const website = typed ? normalizeCompanyWebsite(typed) : null
    if (typed && !website) throw new TransferEngineError('invalid', 422, `“${typed}” is not a web address.`)
    fields['website'] = website
  }
  if ('doNotCall' in values) fields['doNotCall'] = values['doNotCall'] === true ? true : null
  if ('numberOfEmployees' in values) fields['numberOfEmployees'] = values['numberOfEmployees'] ?? null
  if ('annualRevenue' in values) {
    const revenue = values['annualRevenue'] as CurrencyAmount | null
    fields['annualRevenueCents'] = revenue && typeof revenue === 'object' ? revenue.amountMinor : null
    fields['currency'] = revenue && typeof revenue === 'object' ? String(revenue.currency).toLowerCase() : null
  }
  const address = addressFromValues('address', values, current?.['address'])
  if (address !== undefined) fields['address'] = address
  if ('tags' in values) fields['tags'] = normalizeCrmLeadTags(values['tags'])
  if ('owner' in values) fields['ownerUid'] = text('owner', 128)
  if ('status' in values) {
    const label = textOf(values['status'])
    if (label) {
      const write = resolveCrmLeadStatusWrite(run.statuses, label, {
        allowed: FILE_STATUSES,
        current: current as never,
      })
      if (write.ok === false) throw new TransferEngineError('invalid', 422, write.error)
      fields['status'] = write.status
      fields['statusLabel'] = write.statusLabel
    }
  }
  // A reason is what an unqualified lead was closed for: on any other lead it is not written.
  if ('unqualifiedReason' in fields && (fields['status'] ?? current?.['status']) !== 'unqualified') {
    delete fields['unqualifiedReason']
  }
  if ('campaigns' in values) {
    const named = Array.isArray(values['campaigns']) ? (values['campaigns'] as unknown[]).map((name) => textOf(name)).filter(Boolean) : []
    const ids = named.map((name) => run.campaigns.byName.get(name.toLowerCase()) ?? '')
    const unknown = named.find((_name, at) => !ids[at])
    if (unknown) throw new TransferEngineError('invalid', 422, `No campaign is called “${unknown}”.`)
    fields['campaignIds'] = [...new Set(ids)]
  }
  return fields
}

/** Fields as an update writes them: a cleared field is deleted. */
const asUpdate = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === null ? FieldValue.delete() : value]))

/**
 * Writes a lead's working state and profile over what it holds, as the lead
 * page writes it: the lead source and the picklists judged against the
 * org's lists, the name composed from its parts, custom values by their
 * definitions, and the list's search and filter keys restamped.
 */
async function writeLead(
  run: ApplyRun,
  ref: FirebaseFirestore.DocumentReference,
  values: Readonly<Record<string, unknown>>,
  options: { created: boolean },
): Promise<void> {
  const stored = (await ref.get()).data() ?? {}
  const fields = leadFields(run, values, stored)
  if ('leadSource' in values || options.created) {
    const source = resolveLeadSourceWrite(run.leadSources, textOf(values['leadSource']) || undefined, {
      current: stored['leadSource'],
      created: options.created,
    })
    if (source.ok === false) throw new TransferEngineError('invalid', 422, source.error)
    if (source.write !== undefined) fields['leadSource'] = source.write
    else if ('leadSource' in values && !textOf(values['leadSource'])) fields['leadSource'] = null
  }
  const patch: Record<string, unknown> = { ...fields }
  const refused = judgeLeadPicklistPatch(run.picklists, patch as never, { current: stored, created: options.created })
  const first = Object.entries(refused)[0]
  if (first) throw new TransferEngineError('invalid', 422, String(first[1]))
  const composed = crmLeadComposedName(stored, {
    ...('firstName' in fields ? { firstName: fields['firstName'] as string | null } : {}),
    ...('lastName' in fields ? { lastName: fields['lastName'] as string | null } : {}),
  } as never)
  if (composed) patch['name'] = composed
  else if ('name' in values && !textOf(stored['firstName']) && !textOf(stored['lastName'])) {
    patch['name'] = textOf(values['name']).slice(0, 120) || null
  }
  const custom = customWriteValues(values, run.definitions, 'lead')
  if ('error' in custom) throw new TransferEngineError('invalid', 422, custom.error)
  for (const [key, value] of Object.entries(custom.values)) patch[`custom.${key}`] = value
  if (!Object.keys(patch).length) return
  await ref.update({ ...asUpdate(patch), updatedAt: FieldValue.serverTimestamp() })
  // What the Leads list searches and filters by (AGL-3321).
  await restampCrmListFieldsAt(ref, 'leads')
}

/** The `crm.leads` hooks. */
export function leadsTransferResource(): TransferRecordsHooks {
  const run = async (ctx: Parameters<NonNullable<TransferRecordsHooks['readPage']>>[0]): Promise<ApplyRun & { hostId: string | null }> => {
    const env = await crmTransferEnv(ctx)
    const [statuses, leadSources, picklists, definitions, campaigns] = await Promise.all([
      readCrmPicklist(env.firestore, env.orgId, CRM_LEAD_STATUS_PICKLIST),
      readLeadSourcePicklist(env.firestore, env.orgId),
      readLeadPicklists(env.firestore, env.orgId),
      crmCustomDefinitions(env, 'lead'),
      campaignDirectory(env),
    ])
    return { env, hostId: env.hostId ?? '', statuses, leadSources, picklists, definitions, campaigns }
  }
  return {
    async fields(ctx) {
      const env = await crmTransferEnv(ctx)
      return {
        standard: LEAD_TRANSFER_FIELDS,
        derived: LEAD_TRANSFER_DERIVED,
        system: CRM_TIMESTAMP_FIELDS,
        custom: crmCustomTransferFields(await crmCustomDefinitions(env, 'lead'), 'lead'),
        groups: LEAD_TRANSFER_GROUPS,
      }
    },
    matchKeys: [
      { fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' },
      { fieldId: 'email', normalizer: 'email' },
    ],
    aliases: LEAD_ALIASES,
    lookupTargets: { [CRM_MEMBERS_TARGET]: crmMembersTarget() },

    // The people a workspace holds are its own on every plan (AGL-2839).
    async count(ctx, options) {
      const env = await crmTransferEnv(ctx)
      return countCrmExport(env, leadsOf(env), options, (data) => visibleIn(env, data['visibleTo'], options.scopeTokens))
    },

    async readPage(ctx, cursor, fieldIds, options) {
      const context = await run(ctx)
      const emails = fieldIds.includes('owner') ? await crmMemberEmails(context.env.orgId) : new Map<string, string>()
      return readCrmExportPage(
        context.env,
        leadsOf(context.env),
        cursor,
        options,
        (data) => visibleIn(context.env, data['visibleTo'], options?.scopeTokens),
        async (docs) =>
          docs.map((doc) =>
            pickValues(
              leadTransferValues(doc.id, doc.data, context.statuses, context.definitions, {
                owner: (uid) => emails.get(uid),
                campaign: (id) => context.campaigns.names.get(id),
                display: true,
              }),
              fieldIds,
            ),
          ),
      )
    },

    async lookup(ctx, requests) {
      const context = await run(ctx)
      const visible = (data: Record<string, unknown>) => visibleIn(context.env, data['visibleTo'])
      const found = { lookup: new Map<string, string[]>(), docs: new Map<string, Record<string, unknown>>() }
      for (const request of requests) {
        if (request.fieldId === TRANSFER_ID_FIELD) await lookupById(context.env, leadsOf(context.env), request, visible, found)
        else if (request.fieldId === 'email') {
          // A lead's id IS its person key: one document per person.
          const byKey = new Map<string, string>()
          for (const value of request.values) {
            const key = personKey(value)
            if (key) byKey.set(key, value)
          }
          const keys = [...byKey.keys()]
          for (let at = 0; at < keys.length; at += 500) {
            const page = keys.slice(at, at + 500)
            for (const snapshot of await context.env.firestore.getAll(...page.map((key) => leadsOf(context.env).doc(key)))) {
              const data = snapshot.data()
              if (!snapshot.exists || !data || !visible(data)) continue
              found.docs.set(snapshot.id, data)
              found.lookup.set(matchLookupKey(request.fieldId, byKey.get(snapshot.id) as string), [snapshot.id])
            }
          }
        }
      }
      return lookupResult(found, (id, data) =>
        leadTransferValues(id, data, context.statuses, context.definitions, { campaign: (campaign) => context.campaigns.names.get(campaign) }),
      )
    },

    async picklists(ctx, ids) {
      const env = await crmTransferEnv(ctx)
      return crmPicklistLists(env, ids, await crmCustomDefinitions(env, 'lead'))
    },

    async addPicklistValues(ctx, picklistId, values) {
      await addCrmPicklistValues(await crmTransferEnv(ctx), picklistId, values)
    },

    lockedRules: () => [
      { fieldId: 'email', reason: 'A lead is the person at this address; a different address is a different lead.', forced: { mode: 'keepExisting' } },
      { fieldId: 'status', reason: 'A lead becomes Qualified only by converting it, which makes its contact, company and deal.' },
      { fieldId: 'doNotCall', reason: 'A file can say a person asked not to be called, never that they took it back.', forced: { mode: 'overwrite' } },
      { fieldId: 'name', reason: 'The name is built from the first and last names once either is set.' },
    ],

    async plan(ctx, input) {
      const context = await run(ctx)
      requireCrmSuite(context.env, SUITE_ACT)
      requireSite(context.env, 'leads')
      const plan = buildTransferPlan(input)
      return holdBackChanges(plan, (row, change) => {
        const before = row.recordId ? input.existing.get(row.recordId) : undefined
        if (change.fieldId === 'status' && textOf(change.after)) {
          const write = resolveCrmLeadStatusWrite(context.statuses, change.after, { current: null })
          if (write.ok && write.status === 'qualified') return 'Qualified only by converting the lead.'
        }
        if (change.fieldId === 'doNotCall' && before?.['doNotCall'] === true && change.after !== true) {
          return 'Do not call is turned off on the lead’s page, never by a file.'
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
      const context = await run(ctx)
      requireCrmSuite(context.env, SUITE_ACT)
      const { hostId } = requireSite(context.env, 'leads')
      const applyRun: ApplyRun = { ...context, hostId }
      const hostRef = context.env.firestore.collection('hosts').doc(hostId)
      let counted: number | null = null
      let createdHere = 0
      const results: TransferRowResult[] = []
      const undo: TransferUndoEntry[] = []
      await eachWithinBudget(chunk.rows as PlannedTransferRow[], () => writer.timeLeftMs(), async (row) => {
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
            const before = (await readLeads(applyRun, [row.recordId])).get(row.recordId)
            if (!before) throw new TransferEngineError('notFound', 404, 'That lead no longer exists.')
            const ref = leadsOf(context.env).doc(row.recordId)
            await writeLead(applyRun, ref, values, { created: false })
            const after = (await readLeads(applyRun, [ref.id])).get(ref.id) ?? {}
            result = { row: row.index, outcome: 'updated', recordId: ref.id }
            entry = { row: row.index, recordId: ref.id, action: 'updated', previous: pickValues(before, changed), written: pickValues(after, changed) }
          } else {
            const email = textOf(values['email'])
            const key = personKey(email)
            if (!key) throw new TransferEngineError('invalid', 422, 'Not a valid email address.')
            // Every value read before the door is knocked on, so a row the
            // lead page would refuse files nobody.
            leadFields(applyRun, values, null)
            const custom = customWriteValues(values, context.definitions, 'lead')
            if ('error' in custom) throw new TransferEngineError('invalid', 422, custom.error)
            if (counted === null) counted = Number((await leadsOf(context.env).count().get()).data().count ?? 0)
            if (checkVisitorRecordCeiling(counted + createdHere, LEADS_MAX_PER_HOST).exceeded) {
              throw new TransferEngineError('invalid', 422, 'This site holds as many leads as it can.')
            }
            // The door every capture goes through: the person keyed by address,
            // the ceiling judged again in its own transaction, the site's scope.
            const outcome = await addHostLeadOutcome({
              hostRef,
              hostId,
              lead: { email, ...(textOf(values['name']) ? { name: textOf(values['name']) } : {}), source: LEAD_IMPORT_SOURCE },
            })
            if (!outcome.stored) throw new TransferEngineError('invalid', 422, 'The lead could not be saved; this site may hold as many leads as it can.')
            if (outcome.created) createdHere += 1
            const ref = leadsOf(context.env).doc(key)
            await writeLead(applyRun, ref, values, { created: outcome.created })
            const after = (await readLeads(applyRun, [ref.id])).get(ref.id) ?? {}
            result = {
              row: row.index,
              outcome: outcome.created ? 'created' : 'updated',
              recordId: ref.id,
              ...(outcome.created ? {} : { message: 'Merged into the lead already holding this address.' }),
            }
            entry = outcome.created
              ? { row: row.index, recordId: ref.id, action: 'created', written: pickValues(after, changed) }
              : undefined
          }
        } catch (error) {
          result = { row: row.index, outcome: 'failed', ...(row.recordId ? { recordId: row.recordId } : {}), message: failureMessage(error) }
          entry = undefined
        }
        await writer.markApplied(result, entry)
        results.push(result)
        if (entry) undo.push(entry)
      })
      return { results, undo }
    },

    async revert(ctx, snapshot, decisions) {
      const context = await run(ctx)
      const { hostId } = requireSite(context.env, 'leads')
      const applyRun: ApplyRun = { ...context, hostId }
      const current = await readLeads(applyRun, snapshot.entries.map((entry) => entry.recordId))
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
        const ref = leadsOf(context.env).doc(entry.recordId)
        if (entry.action === 'created') {
          await ref.delete()
          done.push({ action: 'delete', recordId: entry.recordId })
          continue
        }
        await writeLead(applyRun, ref, step.action === 'restore' || step.action === 'conflict' ? step.values : {}, { created: false })
        done.push(step)
      }
      return { done, conflicts }
    },
  }
}
