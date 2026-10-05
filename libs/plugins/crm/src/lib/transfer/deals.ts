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
 * DEALS ON THE TRANSFER FRAMEWORK (AGL-3528) — the server half of
 * `crm.deals`.
 *
 * Every field a deal holds, its custom fields and its contact roles, read
 * for an export and written by an import the way the deals import route
 * wrote them — the pipeline and the stage by name, the scope stamp of the
 * importing site, the records band, the org's lists judging each label, the
 * list's search and filter keys — and now FOUND again: a row matches its
 * deal by Aglyn ID or by the external id another CRM gave it, so a file
 * imported twice updates rather than duplicating every deal.
 *
 * The contact, the company and every contact role name records, resolved
 * as lookups (a contact by email, a company by domain or name).
 *
 * A matched deal's pipeline and stage are locked: a stage moves on the
 * board, where the move tells automations and makes a won deal's contact a
 * customer, never as a side effect of a file.
 *=========================================*/

import {
  checkCrmRecordsQuota,
  CRM_COLLECTIONS,
  CRM_FORECAST_CATEGORIES,
  CRM_FORECAST_CATEGORY_LABELS,
  type ContactFieldDefinition,
  type CrmDealContactRole,
  type CrmDealStage,
  type CrmPipeline,
  crmListFields,
  crmPicklistDefaultLabel,
  crmNewRecordListFields,
  dealContactRoleFields,
  dealContactRolesOf,
  dealContactRolesWithPrimary,
  dealStageForecastCategory,
  isCrmForecastCategory,
  isPipelineArchived,
  judgeDealContactRoles,
  nameSearchKey,
} from '@aglyn/aglyn/server'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  buildTransferPlan,
  planTransferUndo,
  rankTransferLookupSuggestions,
  TRANSFER_ID_FIELD,
  transferLookupNewName,
  type CurrencyAmount,
  type PlannedTransferRow,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type { TransferRecordsHooks } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { crmRecordsQuotaForOrg, restampCrmListFieldsOf } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { DEAL_ALIASES } from './aliases'
import {
  addCrmPicklistValues,
  campaignDirectory,
  countCrmExport,
  creationScope,
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
  IN_LIMIT,
  isoOf,
  lookupByField,
  lookupById,
  lookupResult,
  pickValues,
  plannedValues,
  readCrmExportPage,
  requireCrmRecords,
  requireCrmSuite,
  requireSite,
  storedMs,
  textOf,
  TransferEngineError,
  visibleIn,
} from './common'
import { companyForName } from './companies'
import {
  CRM_MEMBERS_TARGET,
  CRM_TIMESTAMP_FIELDS,
  crmCustomTransferFields,
  DEAL_TRANSFER_DERIVED,
  DEAL_TRANSFER_FIELDS,
  DEAL_TRANSFER_GROUPS,
} from './fields'

const SUITE_ACT = 'Importing deals'

/** The currency a deal carries when the file names none — the deal form's own. */
const DEFAULT_CURRENCY = 'usd'

/** How a deal's status reads in a file. */
const STATUS_LABELS: Readonly<Record<string, string>> = { open: 'Open', won: 'Won', lost: 'Lost' }

const dealsOf = (env: CrmTransferEnv) => env.orgRef.collection(CRM_COLLECTIONS.deals)
const contactsOf = (env: CrmTransferEnv) => env.orgRef.collection('contacts')

/** A pipeline the site may file into, with its stages in order. */
interface PipelineChoice {
  id: string
  pipeline: CrmPipeline
  stages: CrmDealStage[]
}

/** Every pipeline the site sees, archived ones included (an export names them), in read order. */
async function readPipelines(env: CrmTransferEnv): Promise<PipelineChoice[]> {
  const snapshot = await env.orgRef.collection(CRM_COLLECTIONS.pipelines).get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, pipeline: doc.data() as CrmPipeline }))
    .filter((entry) => visibleIn(env, entry.pipeline.visibleTo))
    .map((entry) => ({ ...entry, stages: [...(entry.pipeline.stages ?? [])].sort((a, b) => a.order - b.order) }))
}

/**
 * The pipeline and stage a new deal is filed in: by name (case and spacing
 * aside) among the active pipelines, or the default pipeline and its first
 * open stage when the row names none. `null` names what could not be found.
 */
export function placeDeal(
  choices: readonly PipelineChoice[],
  pipelineName: string,
  stageName: string,
): { pipeline: PipelineChoice; stage: CrmDealStage } | { error: string } {
  const active = choices.filter((choice) => !isPipelineArchived(choice.pipeline))
  const pipeline = pipelineName
    ? active.find((choice) => nameSearchKey(choice.pipeline.name ?? '') === nameSearchKey(pipelineName))
    : (active.find((choice) => choice.pipeline.isDefault) ?? (active.length === 1 ? active[0] : undefined))
  if (!pipeline) {
    return { error: pipelineName ? `No pipeline is called “${pipelineName}”.` : 'Name the pipeline: this workspace has several.' }
  }
  const stage = stageName
    ? pipeline.stages.find((candidate) => nameSearchKey(candidate.name ?? '') === nameSearchKey(stageName))
    : (pipeline.stages.find((candidate) => candidate.kind === 'open') ?? pipeline.stages[0])
  if (!stage) return { error: `“${pipeline.pipeline.name}” has no stage called “${stageName}”.` }
  return { pipeline, stage }
}

/** A stored day (epoch ms at local noon) as the file reads it, `YYYY-MM-DD`. */
function dayOf(ms: unknown): string | null {
  const value = storedMs(ms)
  return value === null ? null : new Date(value).toISOString().slice(0, 10)
}

/** A day the file names as the stored epoch: noon UTC, so the calendar day survives every zone. */
function storedDay(value: unknown): number | null {
  const text = textOf(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return Date.parse(`${text}T12:00:00.000Z`)
}

/**
 * The words written in place of stored ids. An export names every link; a
 * lookup names only what a file can only name in words — the pipeline, the
 * stage, the people in the contact roles — and keeps the links a lookup
 * column resolves to ids as ids, so the plan compares like with like.
 */
interface DealNames {
  /** Amounts as `1250.00 USD` rather than an amount and a currency. */
  display?: boolean
  owner?: (uid: string) => string | undefined
  contact?: (id: string) => string | undefined
  company?: (id: string) => string | undefined
  campaign?: (id: string) => string | undefined
  pipeline?: (id: string) => string | undefined
  stage?: (pipelineId: string, stageId: string) => string | undefined
  /** Who a contact role names: an email. */
  roleContact?: (id: string) => string | undefined
}

/** A deal's contact roles as one cell: `email (Role)`, the Primary first, `; ` between. */
function rolesCell(roles: readonly CrmDealContactRole[], contact: (id: string) => string | undefined): string | null {
  const ordered = [...roles].sort((a, b) => Number(b.primary) - Number(a.primary))
  const cell = ordered
    .map((row) => {
      const who = contact(row.contactId) ?? row.contactId
      return row.role ? `${who} (${row.role})` : who
    })
    .join('; ')
  return cell || null
}

/** A contact roles cell read back: each person and the role in parentheses after them. */
export function parseRolesCell(value: unknown): Array<{ who: string; role: string }> {
  return textOf(value)
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(part)
      return match ? { who: (match[1] as string).trim(), role: (match[2] as string).trim() } : { who: part, role: '' }
    })
}

/**
 * One deal as values by field id. A lookup and an undo read links by id
 * so the plan compares what is stored; an export writes names.
 */
export function dealTransferValues(
  id: string,
  deal: Record<string, unknown>,
  definitions: readonly ContactFieldDefinition[],
  names?: DealNames,
): Record<string, unknown> {
  const text = (value: unknown) => textOf(value) || null
  const pipelineId = textOf(deal['pipelineId'])
  const stageId = textOf(deal['stageId'])
  const amount = typeof deal['amountCents'] === 'number' ? (deal['amountCents'] as number) : null
  const currency = String(deal['currency'] || DEFAULT_CURRENCY).toUpperCase()
  const ownerUid = text(deal['ownerUid'])
  const contactId = text(deal['contactId'])
  const companyId = text(deal['companyId'])
  const campaignId = text(deal['campaignId'])
  const roles = dealContactRolesOf(deal)
  const forecast = isCrmForecastCategory(deal['forecastCategory'])
    ? CRM_FORECAST_CATEGORY_LABELS[deal['forecastCategory']]
    : null
  const named = <T extends unknown[]>(resolve: ((...args: T) => string | undefined) | undefined, fallback: string, ...args: T) =>
    resolve?.(...args) || fallback
  return {
    title: text(deal['title']),
    externalId: text(deal['externalId']),
    pipeline: pipelineId ? named(names?.pipeline, pipelineId, pipelineId) : null,
    stage: stageId ? named(names?.stage, stageId, pipelineId, stageId) : null,
    status: STATUS_LABELS[textOf(deal['status'])] ?? null,
    amount: amount === null ? null : names?.display ? `${(amount / 100).toFixed(2)} ${currency}` : { amountMinor: amount, currency },
    expectedClose: dayOf(deal['expectedCloseAtMs']),
    closedAt: isoOf(deal['closedAtMs']),
    owner: ownerUid ? named(names?.owner, ownerUid, ownerUid) : null,
    contact: contactId ? named(names?.contact, names?.contact ? (text(deal['contactName']) ?? contactId) : contactId, contactId) : null,
    company: companyId ? named(names?.company, names?.company ? (text(deal['companyName']) ?? companyId) : companyId, companyId) : null,
    contactRoles: rolesCell(roles, (contact) => names?.roleContact?.(contact)),
    type: text(deal['type']),
    leadSource: text(deal['leadSource']),
    nextStep: text(deal['nextStep']),
    probability: typeof deal['probability'] === 'number' ? deal['probability'] : null,
    forecastCategory: forecast,
    lostReason: text(deal['lostReason']),
    campaign: campaignId ? named(names?.campaign, campaignId, campaignId) : null,
    notes: text(deal['notes']),
    createdAt: isoOf(deal['createdAt']),
    updatedAt: isoOf(deal['updatedAt']),
    ...customTransferValues(definitions, deal['custom']),
    [TRANSFER_ID_FIELD]: id,
  }
}

/** What a lookup and an undo name in words: the pipeline, the stage and the role contacts. */
async function wordNames(env: CrmTransferEnv, deals: ReadonlyArray<Record<string, unknown>>): Promise<DealNames> {
  const pipelines = deals.length ? await readPipelines(env) : []
  const ids = [...new Set(deals.flatMap((deal) => dealContactRolesOf(deal).map((row) => row.contactId)))].filter(
    (id) => !id.includes('/'),
  )
  const emails = new Map<string, string>()
  for (let at = 0; at < ids.length; at += 500) {
    for (const snapshot of await env.firestore.getAll(...ids.slice(at, at + 500).map((id) => contactsOf(env).doc(id)))) {
      if (snapshot.exists) emails.set(snapshot.id, textOf(snapshot.get('email')))
    }
  }
  const campaigns = deals.some((deal) => textOf(deal['campaignId'])) ? await campaignDirectory(env) : null
  return {
    pipeline: (id) => pipelines.find((choice) => choice.id === id)?.pipeline.name,
    stage: (pipelineId, stageId) =>
      pipelines.find((choice) => choice.id === pipelineId)?.stages.find((stage) => stage.id === stageId)?.name,
    roleContact: (id) => emails.get(id) || undefined,
    campaign: (id) => campaigns?.names.get(id),
  }
}

/** The deals these ids name, as values. */
async function readDeals(
  env: CrmTransferEnv,
  ids: readonly string[],
  definitions: readonly ContactFieldDefinition[],
): Promise<Map<string, Record<string, unknown>>> {
  const docs = new Map<string, Record<string, unknown>>()
  const wanted = ids.filter((id) => id && !id.includes('/'))
  for (let at = 0; at < wanted.length; at += 500) {
    for (const snapshot of await env.firestore.getAll(...wanted.slice(at, at + 500).map((id) => dealsOf(env).doc(id)))) {
      const data = snapshot.data()
      if (snapshot.exists && data && visibleIn(env, data['visibleTo'])) docs.set(snapshot.id, data)
    }
  }
  const names = await wordNames(env, [...docs.values()])
  return new Map([...docs].map(([id, data]) => [id, dealTransferValues(id, data, definitions, names)]))
}

/** Everything one apply call shares across its rows. */
interface ApplyRun {
  env: CrmTransferEnv
  actorUid: string | null
  definitions: ContactFieldDefinition[]
  pipelines: PipelineChoice[]
  lists: Awaited<ReturnType<typeof crmPicklistLists>>
  campaigns: Awaited<ReturnType<typeof campaignDirectory>>
  companies: Map<string, Promise<{ id: string; name: string } | null>>
  admit: () => Promise<boolean>
}

/** A contact the import may link: one the site sees, by id or by email. */
async function contactFor(run: ApplyRun, value: string): Promise<{ id: string; name: string } | null> {
  const byId = !value.includes('@') && !value.includes('/') ? await contactsOf(run.env).doc(value).get() : null
  const snapshot = byId?.exists
    ? byId
    : (await contactsOf(run.env).where('email', '==', value.trim().toLowerCase()).limit(IN_LIMIT).get()).docs.find((doc) =>
        visibleIn(run.env, doc.get('visibleTo')),
      )
  if (!snapshot || !snapshot.exists || !visibleIn(run.env, snapshot.get('visibleTo'))) return null
  return { id: snapshot.id, name: textOf(snapshot.get('name')) || textOf(snapshot.get('email')) }
}

/**
 * The fields a row's values write to a deal, over the deal as it stands
 * (`current`, empty for a new one): each label judged against the org's
 * lists, a link resolved, a blank clearing (`null`).
 */
async function dealFields(
  run: ApplyRun,
  values: Readonly<Record<string, unknown>>,
  current: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {}
  const set = (field: string, value: unknown) => {
    fields[field] = value === undefined || value === '' ? null : value
  }
  if ('title' in values) {
    const title = textOf(values['title']).slice(0, 200)
    if (!title) throw new TransferEngineError('invalid', 422, 'A deal needs a title.')
    fields['title'] = title
    fields['titleLower'] = nameSearchKey(title)
  }
  if ('externalId' in values) set('externalId', textOf(values['externalId']).slice(0, 200) || null)
  if ('amount' in values) {
    const amount = values['amount'] as CurrencyAmount | null
    if (amount && typeof amount === 'object') {
      fields['amountCents'] = amount.amountMinor
      fields['currency'] = String(amount.currency || DEFAULT_CURRENCY).toLowerCase()
    } else fields['amountCents'] = null
  }
  if ('expectedClose' in values) set('expectedCloseAtMs', storedDay(values['expectedClose']))
  if ('owner' in values) set('ownerUid', textOf(values['owner']) || null)
  if ('nextStep' in values) set('nextStep', textOf(values['nextStep']).slice(0, 255) || null)
  if ('probability' in values) {
    const probability = values['probability']
    if (probability !== null && (typeof probability !== 'number' || probability < 0 || probability > 100)) {
      throw new TransferEngineError('invalid', 422, 'A probability is a percent from 0 to 100.')
    }
    set('probability', probability === null ? null : Math.round(probability as number))
  }
  if ('forecastCategory' in values) {
    const label = textOf(values['forecastCategory']).toLowerCase()
    const category = CRM_FORECAST_CATEGORIES.find((entry) => CRM_FORECAST_CATEGORY_LABELS[entry].toLowerCase() === label)
    set('forecastCategory', category ?? null)
  }
  if ('lostReason' in values) set('lostReason', textOf(values['lostReason']).slice(0, 500) || null)
  if ('notes' in values) set('notes', textOf(values['notes']).slice(0, 4000) || null)
  for (const field of ['type', 'leadSource'] as const) {
    if (field in values) set(field, textOf(values[field]) || null)
  }
  if ('campaign' in values) {
    const name = textOf(values['campaign'])
    const id = name ? (run.campaigns.byName.get(name.toLowerCase()) ?? null) : null
    if (name && !id) throw new TransferEngineError('invalid', 422, `No campaign is called “${name}”.`)
    set('campaignId', id)
  }
  if ('company' in values) {
    const value = values['company']
    if (value === null || value === undefined || value === '') {
      fields['companyId'] = null
      fields['companyName'] = null
    } else {
      const create = transferLookupNewName(value)
      const company = create
        ? await companyForName(run.env, create, run.actorUid, run.companies, run.admit)
        : await (async () => {
            const snapshot = await run.env.orgRef.collection(CRM_COLLECTIONS.companies).doc(String(value)).get()
            return snapshot.exists && visibleIn(run.env, snapshot.get('visibleTo'))
              ? { id: snapshot.id, name: textOf(snapshot.get('name')) }
              : null
          })()
      if (!company) throw new TransferEngineError('invalid', 422, 'The company this row names could not be found or created.')
      fields['companyId'] = company.id
      fields['companyName'] = company.name
    }
  }

  // The contact and the roles: the Primary is `contactId`, written together.
  let roles = dealContactRolesOf(current)
  const rolesNamed = 'contactRoles' in values
  if (rolesNamed) {
    const next: CrmDealContactRole[] = []
    for (const { who, role } of parseRolesCell(values['contactRoles'])) {
      const contact = await contactFor(run, who)
      if (!contact) throw new TransferEngineError('invalid', 422, `No contact this site sees is “${who}”.`)
      if (!next.some((row) => row.contactId === contact.id)) {
        next.push({ contactId: contact.id, ...(role ? { role } : {}), primary: next.length === 0 })
      }
    }
    const list = run.lists['opportunityContactRole']?.set
    const judged = list ? judgeDealContactRoles(list, next, roles) : { ok: true as const, roles: next }
    if (judged.ok === false) throw new TransferEngineError('invalid', 422, judged.error)
    roles = judged.roles
  }
  if ('contact' in values) {
    const contactId = textOf(values['contact']) || null
    roles = dealContactRolesWithPrimary(roles, contactId)
    if (!contactId) roles = roles.map((row) => ({ ...row, primary: false }))
  }
  if (rolesNamed || 'contact' in values) {
    const { contactRoles, contactId } = dealContactRoleFields(roles)
    fields['contactRoles'] = contactRoles
    fields['contactId'] = contactId
    fields['contactName'] = contactId ? ((await contactFor(run, contactId))?.name ?? null) : null
  }
  return fields
}

/** Fields as an update writes them: a cleared field is deleted. */
const asUpdate = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === null ? FieldValue.delete() : value]))

/** Fields as a create writes them: a cleared field is simply absent. */
const asCreate = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined))

/** The `crm.deals` hooks. */
export function dealsTransferResource(): TransferRecordsHooks {
  return {
    async fields(ctx) {
      const env = await crmTransferEnv(ctx)
      return {
        standard: DEAL_TRANSFER_FIELDS,
        derived: DEAL_TRANSFER_DERIVED,
        system: CRM_TIMESTAMP_FIELDS,
        custom: crmCustomTransferFields(await crmCustomDefinitions(env, 'deal'), 'deal'),
        groups: DEAL_TRANSFER_GROUPS,
      }
    },
    matchKeys: [
      { fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' },
      { fieldId: 'externalId', normalizer: 'externalId' },
    ],
    aliases: DEAL_ALIASES,
    lookupTargets: { [CRM_MEMBERS_TARGET]: crmMembersTarget() },

    async count(ctx, options) {
      const env = await crmTransferEnv(ctx)
      requireCrmRecords(env, 'deals')
      return countCrmExport(env, dealsOf(env), options, (data) => visibleIn(env, data['visibleTo'], options.scopeTokens))
    },

    async readPage(ctx, cursor, fieldIds, options) {
      const env = await crmTransferEnv(ctx)
      requireCrmRecords(env, 'deals')
      const definitions = await crmCustomDefinitions(env, 'deal')
      const emails = fieldIds.includes('owner') ? await crmMemberEmails(env.orgId) : new Map<string, string>()
      const pipelines = fieldIds.some((id) => id === 'pipeline' || id === 'stage') ? await readPipelines(env) : []
      const campaigns = fieldIds.includes('campaign') ? await campaignDirectory(env) : null
      return readCrmExportPage(
        env,
        dealsOf(env),
        cursor,
        options,
        (data) => visibleIn(env, data['visibleTo'], options?.scopeTokens),
        async (docs) => {
          // People and companies by the words a file carries: a contact's email, a company's name.
          const contactIds = new Set<string>()
          const companyIds = new Set<string>()
          for (const doc of docs) {
            for (const row of dealContactRolesOf(doc.data)) contactIds.add(row.contactId)
            const companyId = textOf(doc.data['companyId'])
            if (companyId) companyIds.add(companyId)
          }
          const emailsOf = new Map<string, string>()
          const companyNames = new Map<string, string>()
          if (fieldIds.includes('contact') || fieldIds.includes('contactRoles')) {
            const ids = [...contactIds].filter((id) => !id.includes('/'))
            for (let at = 0; at < ids.length; at += 500) {
              for (const snapshot of await env.firestore.getAll(...ids.slice(at, at + 500).map((id) => contactsOf(env).doc(id)))) {
                if (snapshot.exists) emailsOf.set(snapshot.id, textOf(snapshot.get('email')))
              }
            }
          }
          if (fieldIds.includes('company')) {
            const ids = [...companyIds].filter((id) => !id.includes('/'))
            for (let at = 0; at < ids.length; at += 500) {
              const refs = ids.slice(at, at + 500).map((id) => env.orgRef.collection(CRM_COLLECTIONS.companies).doc(id))
              for (const snapshot of await env.firestore.getAll(...refs)) {
                if (snapshot.exists) companyNames.set(snapshot.id, textOf(snapshot.get('name')))
              }
            }
          }
          const names: DealNames = {
            display: true,
            owner: (uid) => emails.get(uid),
            contact: (id) => emailsOf.get(id) || undefined,
            roleContact: (id) => emailsOf.get(id) || undefined,
            company: (id) => companyNames.get(id) || undefined,
            campaign: (id) => campaigns?.names.get(id),
            pipeline: (id) => pipelines.find((choice) => choice.id === id)?.pipeline.name,
            stage: (pipelineId, stageId) =>
              pipelines.find((choice) => choice.id === pipelineId)?.stages.find((stage) => stage.id === stageId)?.name,
          }
          return docs.map((doc) => pickValues(dealTransferValues(doc.id, doc.data, definitions, names), fieldIds))
        },
      )
    },

    async lookup(ctx, requests) {
      const env = await crmTransferEnv(ctx)
      const definitions = await crmCustomDefinitions(env, 'deal')
      const visible = (data: Record<string, unknown>) => visibleIn(env, data['visibleTo'])
      const found = { lookup: new Map<string, string[]>(), docs: new Map<string, Record<string, unknown>>() }
      for (const request of requests) {
        if (request.fieldId === TRANSFER_ID_FIELD) await lookupById(env, dealsOf(env), request, visible, found)
        else if (request.fieldId === 'externalId') {
          await lookupByField(dealsOf(env), request, 'externalId', (value) => value.trim(), visible, found)
        } else if (request.fieldId === 'title') {
          await lookupByField(dealsOf(env), request, 'titleLower', (value) => nameSearchKey(value), visible, found)
        }
      }
      const names = await wordNames(env, [...found.docs.values()])
      return lookupResult(found, (id, data) => dealTransferValues(id, data, definitions, names))
    },

    async suggest(ctx, request) {
      const env = await crmTransferEnv(ctx)
      const answer: Record<string, ReturnType<typeof rankTransferLookupSuggestions>> = {}
      for (const value of request.values) {
        const first = nameSearchKey(value).split(' ')[0] ?? ''
        if (first.length < 2) {
          answer[value] = []
          continue
        }
        const snapshot = await dealsOf(env).where('titleLower', '>=', first).where('titleLower', '<', `${first}`).limit(IN_LIMIT).get()
        answer[value] = rankTransferLookupSuggestions(
          value,
          snapshot.docs
            .filter((doc) => visibleIn(env, doc.get('visibleTo')))
            .map((doc) => ({ recordId: doc.id, label: textOf(doc.get('title')) || doc.id })),
        )
      }
      return answer
    },

    async picklists(ctx, ids) {
      const env = await crmTransferEnv(ctx)
      return crmPicklistLists(env, ids, await crmCustomDefinitions(env, 'deal'))
    },

    async addPicklistValues(ctx, picklistId, values) {
      await addCrmPicklistValues(await crmTransferEnv(ctx), picklistId, values)
    },

    lockedRules: () => [
      {
        fieldId: 'pipeline',
        reason: 'A deal moves between pipelines and stages on the board, where the move tells your automations; an import sets them only on a new deal.',
        forced: { mode: 'keepExisting' },
      },
      {
        fieldId: 'stage',
        reason: 'A deal moves between stages on the board, where the move tells your automations; an import sets the stage only on a new deal.',
        forced: { mode: 'keepExisting' },
      },
    ],

    async plan(ctx, input) {
      const env = await crmTransferEnv(ctx)
      requireCrmSuite(env, SUITE_ACT)
      requireSite(env, 'deals')
      return buildTransferPlan(input)
    },

    async apply(ctx, chunk, writer) {
      const env = await crmTransferEnv(ctx)
      requireCrmSuite(env, SUITE_ACT)
      requireSite(env, 'deals')
      const run: ApplyRun = {
        env,
        actorUid: ctx.actorUid,
        definitions: await crmCustomDefinitions(env, 'deal'),
        pipelines: await readPipelines(env),
        lists: await crmPicklistLists(env, ['opportunityContactRole', 'opportunityType'], []),
        campaigns: await campaignDirectory(env),
        companies: new Map(),
        admit: crmRecordsRoom(env),
      }
      let counted: { crmRecordsCount: number } | null = null
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
            const ref = dealsOf(env).doc(row.recordId)
            const current = (await ref.get()).data()
            if (!current || !visibleIn(env, current['visibleTo'])) throw new TransferEngineError('notFound', 404, 'That deal no longer exists.')
            const before = dealTransferValues(ref.id, current, run.definitions)
            const fields = await dealFields(run, values, current)
            const custom = customWriteValues(values, run.definitions, 'deal')
            if ('error' in custom) throw new TransferEngineError('invalid', 422, custom.error)
            await ref.update({
              ...asUpdate(fields),
              ...Object.fromEntries(Object.entries(custom.values).map(([key, value]) => [`custom.${key}`, value])),
              ...crmListFields('deals', { ...current, ...fields }),
              updatedAt: FieldValue.serverTimestamp(),
            })
            const after = (await readDeals(env, [ref.id], run.definitions)).get(ref.id) ?? {}
            result = { row: row.index, outcome: 'updated', recordId: ref.id }
            entry = { row: row.index, recordId: ref.id, action: 'updated', previous: pickValues(before, changed), written: pickValues(after, changed) }
          } else {
            const placed = placeDeal(run.pipelines, textOf(values['pipeline']), textOf(values['stage']))
            if ('error' in placed) throw new TransferEngineError('invalid', 422, placed.error)
            counted ??= await crmRecordsQuotaForOrg(env.org as never, env.orgRef)
            if (!checkCrmRecordsQuota(env.org as never, counted.crmRecordsCount + createdHere).allowed) {
              throw new TransferEngineError('invalid', 422, 'The CRM records limit is reached.')
            }
            const fields = asCreate(await dealFields(run, values, {}))
            // A new deal with no Type starts on the list's default, as the deal form does.
            const typeDefault = run.lists['opportunityType'] ? crmPicklistDefaultLabel(run.lists['opportunityType'].set) : null
            if (!fields['type'] && typeDefault) fields['type'] = typeDefault
            const custom = customWriteValues(values, run.definitions, 'deal')
            if ('error' in custom) throw new TransferEngineError('invalid', 422, custom.error)
            const { stage } = placed
            const status = stage.kind === 'won' ? 'won' : stage.kind === 'lost' ? 'lost' : 'open'
            const nowMs = Date.now()
            const scope = creationScope(env, ctx.actorUid)
            const ref = dealsOf(env).doc(createResourceUid())
            const opportunity = {
              forecastCategory: (fields['forecastCategory'] as string | undefined) ?? dealStageForecastCategory(stage),
            }
            await ref.set({
              currency: DEFAULT_CURRENCY,
              ...fields,
              ...opportunity,
              pipelineId: placed.pipeline.id,
              stageId: stage.id,
              status,
              stageChangedAtMs: nowMs,
              closedAtMs: status === 'open' ? null : nowMs,
              ...(Object.keys(custom.values).length ? { custom: custom.values } : {}),
              ...scope,
              // What the Deals list searches and filters by (AGL-3321, AGL-3516).
              ...crmNewRecordListFields('deals', { ...fields, ...opportunity, ...scope }),
            })
            createdHere += 1
            const after = (await readDeals(env, [ref.id], run.definitions)).get(ref.id) ?? {}
            result = { row: row.index, outcome: 'created', recordId: ref.id }
            entry = { row: row.index, recordId: ref.id, action: 'created', written: pickValues(after, changed) }
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
      const env = await crmTransferEnv(ctx)
      const run: ApplyRun = {
        env,
        actorUid: ctx.actorUid,
        definitions: await crmCustomDefinitions(env, 'deal'),
        pipelines: [],
        lists: {},
        campaigns: await campaignDirectory(env),
        companies: new Map(),
        admit: crmRecordsRoom(env),
      }
      const current = await readDeals(env, snapshot.entries.map((entry) => entry.recordId), run.definitions)
      const done: TransferUndoStep[] = []
      const conflicts: TransferUndoStep[] = []
      const touched: FirebaseFirestore.DocumentReference[] = []
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
        const ref = dealsOf(env).doc(entry.recordId)
        if (entry.action === 'created') {
          await ref.delete()
          done.push({ action: 'delete', recordId: entry.recordId })
          continue
        }
        const values = step.action === 'restore' || step.action === 'conflict' ? step.values : {}
        const stored = (await ref.get()).data() ?? {}
        const fields = await dealFields(run, values, stored)
        await ref.update({ ...asUpdate(fields), ...crmListFields('deals', { ...stored, ...fields }), updatedAt: FieldValue.serverTimestamp() })
        touched.push(ref)
        done.push(step)
      }
      if (touched.length) await restampCrmListFieldsOf(touched, 'deals').catch(() => undefined)
      return { done, conflicts }
    },
  }
}

