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
 * COMPANIES ON THE TRANSFER FRAMEWORK (AGL-3527) — the server half of
 * `crm.companies`.
 *
 * Every field a company holds, its custom fields and its parent company,
 * read for an export and written by an import through the same rules the
 * companies import route kept: the scope stamp of the site that imports, the
 * records band, the org's picklists judging each label, the list's search
 * and filter keys, and a parent that is never the company itself or one
 * under it (`crmCompanyParentRefusal`).
 *
 * A row finds its company by Aglyn ID, then by domain, then by name — each
 * only among the companies the site reads, so two clients of one agency who
 * each hold an "Acme" each import into their own.
 *=========================================*/

import {
  CRM_COLLECTIONS,
  CRM_COMPANY_PICKLIST_FIELDS,
  type ContactFieldDefinition,
  type CrmPicklist,
  type CrmPicklistId,
  crmCompanyListFields,
  crmCompanyParentId,
  crmCompanyParentRefusal,
  crmNewRecordListFields,
  judgeCrmCompanyPicklists,
  nameSearchFields,
  normalizeCompanyDomain,
  normalizeCompanyText,
  normalizeCompanyWebsite,
} from '@aglyn/aglyn/server'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import {
  planTransferUndo,
  TRANSFER_ID_FIELD,
  transferLookupNewName,
  buildTransferPlan,
  rankTransferLookupSuggestions,
  type CurrencyAmount,
  type PlannedTransferRow,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type { TransferRecordsHooks } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { restampCrmListFieldsOf } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { deleteCrmCompany } from '../server/company-delete'
import { COMPANY_ALIASES } from './aliases'
import {
  addCrmPicklistValues,
  addressFromValues,
  addressValues,
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
  nameKey,
  pickValues,
  plannedValues,
  readCrmExportPage,
  requireCrmRecords,
  requireCrmSuite,
  requireSite,
  textOf,
  TransferEngineError,
  visibleIn,
} from './common'
import {
  COMPANY_TRANSFER_DERIVED,
  COMPANY_TRANSFER_FIELDS,
  COMPANY_TRANSFER_GROUPS,
  CRM_MEMBERS_TARGET,
  CRM_TIMESTAMP_FIELDS,
  crmCustomTransferFields,
} from './fields'

const companiesOf = (env: CrmTransferEnv) => env.orgRef.collection(CRM_COLLECTIONS.companies)

/** The text fields stored as typed, each capped. */
const TEXT_FIELDS = ['accountNumber', 'site', 'tickerSymbol', 'sicCode'] as const

/** A stored revenue as the file reads it: its amount and its currency. */
function revenueOf(company: Record<string, unknown>): CurrencyAmount | null {
  const cents = company['annualRevenueCents']
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null
  return { amountMinor: cents, currency: String(company['currency'] || 'usd').toUpperCase() }
}

/**
 * One company as values by field id. `ids` is how a lookup and an undo
 * read it — a parent and an owner by id, so the plan compares what is
 * stored; an export writes their names instead (`names`).
 */
export function companyTransferValues(
  id: string,
  company: Record<string, unknown>,
  definitions: readonly ContactFieldDefinition[],
  names?: { owner: (uid: string) => string | undefined; parent: (id: string) => string | undefined },
): Record<string, unknown> {
  const ownerUid = textOf(company['ownerUid']) || null
  const parentId = crmCompanyParentId(company['parentCompanyId'])
  const revenue = revenueOf(company)
  return {
    name: textOf(company['name']) || null,
    domain: textOf(company['domain']) || null,
    website: textOf(company['website']) || null,
    phone: textOf(company['phone']) || null,
    fax: textOf(company['fax']) || null,
    parentCompany: parentId ? (names ? (names.parent(parentId) ?? parentId) : parentId) : null,
    ...Object.fromEntries(
      CRM_COMPANY_PICKLIST_FIELDS.map(({ field }) => [field, textOf(company[field]) || null]),
    ),
    ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, textOf(company[field]) || null])),
    numberOfEmployees: typeof company['numberOfEmployees'] === 'number' ? company['numberOfEmployees'] : null,
    annualRevenue: revenue
      ? names
        ? `${(revenue.amountMinor / 100).toFixed(2)} ${revenue.currency}`
        : revenue
      : null,
    ...addressValues('billing', company['address']),
    ...addressValues('shipping', company['shippingAddress']),
    owner: ownerUid ? (names ? (names.owner(ownerUid) ?? ownerUid) : ownerUid) : null,
    tags: Array.isArray(company['tags']) ? (company['tags'] as string[]) : [],
    notes: textOf(company['notes']) || null,
    contactsCount: typeof company['contactsCount'] === 'number' ? company['contactsCount'] : 0,
    createdAt: isoOf(company['createdAt']),
    updatedAt: isoOf(company['updatedAt']),
    ...customTransferValues(definitions, company['custom']),
    [TRANSFER_ID_FIELD]: id,
  }
}

/**
 * The stored fields a row's values make, over the company as it stands:
 * each field normalized the way the company drawer and the old import
 * stored it; `null` for a field the row clears.
 */
function storedFieldsFor(
  values: Readonly<Record<string, unknown>>,
  current: Record<string, unknown>,
): { fields: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {}
  const set = (field: string, value: unknown) => {
    fields[field] = value === null || value === undefined || value === '' ? null : value
  }
  if ('name' in values) {
    const name = normalizeCompanyText(values['name']).slice(0, 120)
    if (!name) return { fields, error: 'A company needs a name.' }
    Object.assign(fields, nameSearchFields(name))
  }
  if ('domain' in values) {
    const text = textOf(values['domain'])
    const domain = text ? normalizeCompanyDomain(text) : null
    if (text && !domain) return { fields, error: `“${text}” is not a domain.` }
    set('domain', domain)
  }
  if ('website' in values) {
    const text = textOf(values['website'])
    const website = text ? normalizeCompanyWebsite(text) : null
    if (text && !website) return { fields, error: `“${text}” is not a web address.` }
    set('website', website)
  }
  for (const field of ['phone', 'fax'] as const) if (field in values) set(field, textOf(values[field]) || null)
  for (const field of TEXT_FIELDS) {
    if (field in values) set(field, normalizeCompanyText(values[field]) || null)
  }
  if ('numberOfEmployees' in values) set('numberOfEmployees', values['numberOfEmployees'] ?? null)
  if ('annualRevenue' in values) {
    const revenue = values['annualRevenue'] as CurrencyAmount | null
    if (revenue && typeof revenue === 'object') {
      fields['annualRevenueCents'] = revenue.amountMinor
      fields['currency'] = String(revenue.currency || 'usd').toLowerCase()
    } else {
      fields['annualRevenueCents'] = null
    }
  }
  const billing = addressFromValues('billing', values, current['address'])
  if (billing !== undefined) set('address', billing)
  const shipping = addressFromValues('shipping', values, current['shippingAddress'])
  if (shipping !== undefined) set('shippingAddress', shipping)
  if ('owner' in values) set('ownerUid', textOf(values['owner']) || null)
  if ('tags' in values) fields['tags'] = Array.isArray(values['tags']) ? values['tags'] : []
  if ('notes' in values) set('notes', textOf(values['notes']).slice(0, 4000) || null)
  return { fields }
}

/** Fields as an update writes them: a cleared field is deleted. */
function asUpdate(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value === null ? FieldValue.delete() : value]),
  )
}

/** Fields as a create writes them: a cleared field is simply absent. */
function asCreate(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined))
}

/** The values of a chunk's companies as `companyTransferValues` reads them, by id. */
async function readCompanies(
  env: CrmTransferEnv,
  ids: readonly string[],
  definitions: readonly ContactFieldDefinition[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>()
  for (let at = 0; at < ids.length; at += 500) {
    const page = ids.slice(at, at + 500)
    if (!page.length) continue
    for (const snapshot of await env.firestore.getAll(...page.map((id) => companiesOf(env).doc(id)))) {
      if (snapshot.exists) out.set(snapshot.id, companyTransferValues(snapshot.id, snapshot.data() ?? {}, definitions))
    }
  }
  return out
}

/**
 * The company a name names in this site's view, or one created for it —
 * once per name per apply call, and found again (by `nameLower`) when a
 * retried chunk asks after a create that already landed. `null` when the
 * records band has no room.
 */
export async function companyForName(
  env: CrmTransferEnv,
  name: string,
  actorUid: string | null,
  cache: Map<string, Promise<{ id: string; name: string } | null>>,
  admit: () => Promise<boolean>,
): Promise<{ id: string; name: string } | null> {
  const key = nameKey(name)
  let pending = cache.get(key)
  if (!pending) {
    pending = (async () => {
      const fields = nameSearchFields(normalizeCompanyText(name).slice(0, 120))
      const found = await companiesOf(env).where('nameLower', '==', fields.nameLower).limit(10).get()
      const seen = found.docs.find((doc) => visibleIn(env, doc.get('visibleTo')))
      if (seen) return { id: seen.id, name: String(seen.get('name') ?? fields.name) }
      if (!(await admit())) return null
      const scope = creationScope(env, actorUid)
      const ref = companiesOf(env).doc(createResourceUid())
      await ref.set({
        ...fields,
        tags: [],
        ...scope,
        ...crmNewRecordListFields('companies', { ...fields, ...scope }),
      })
      return { id: ref.id, name: fields.name }
    })()
    cache.set(key, pending)
  }
  return pending
}

/** The parent a row names, as an id: a chosen record, or one the import creates by name. */
async function parentIdFor(
  env: CrmTransferEnv,
  value: unknown,
  actorUid: string | null,
  cache: Map<string, Promise<{ id: string; name: string } | null>>,
  admit: () => Promise<boolean>,
): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null
  const create = transferLookupNewName(value)
  if (create) {
    const company = await companyForName(env, create, actorUid, cache, admit)
    if (!company) throw new TransferEngineError('invalid', 422, 'The CRM records limit has no room for the parent company.')
    return company.id
  }
  return String(value)
}

/** Why a parent cannot sit over this company, read through the site's view. */
async function parentRefusal(env: CrmTransferEnv, companyId: string | null, parentId: string): Promise<string | null> {
  return crmCompanyParentRefusal(companyId, parentId, async (id) => {
    const snapshot = await companiesOf(env).doc(id).get()
    if (!snapshot.exists || !visibleIn(env, snapshot.get('visibleTo'))) return null
    return { parentCompanyId: crmCompanyParentId(snapshot.get('parentCompanyId')) }
  })
}

/** The org's list behind each company picklist field. */
async function companyPicklists(env: CrmTransferEnv): Promise<Partial<Record<CrmPicklistId, CrmPicklist>>> {
  const ids = [...new Set(CRM_COMPANY_PICKLIST_FIELDS.map((entry) => entry.picklistId))]
  const lists = await crmPicklistLists(env, ids, [])
  return Object.fromEntries(ids.map((id) => [id, lists[id]?.set])) as Partial<Record<CrmPicklistId, CrmPicklist>>
}

/** The `crm.companies` hooks. */
export function companiesTransferResource(): TransferRecordsHooks {
  return {
    async fields(ctx) {
      const env = await crmTransferEnv(ctx)
      return {
        standard: COMPANY_TRANSFER_FIELDS,
        derived: COMPANY_TRANSFER_DERIVED,
        system: CRM_TIMESTAMP_FIELDS,
        custom: crmCustomTransferFields(await crmCustomDefinitions(env, 'company'), 'company'),
        groups: COMPANY_TRANSFER_GROUPS,
      }
    },
    matchKeys: [
      { fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' },
      { fieldId: 'domain', normalizer: 'domain' },
      { fieldId: 'name', normalizer: 'caseless' },
    ],
    aliases: COMPANY_ALIASES,
    lookupTargets: { [CRM_MEMBERS_TARGET]: crmMembersTarget() },

    async count(ctx, options) {
      const env = await crmTransferEnv(ctx)
      requireCrmRecords(env, 'companies')
      return countCrmExport(env, companiesOf(env), options, (data) => visibleIn(env, data['visibleTo'], options.scopeTokens))
    },

    async readPage(ctx, cursor, fieldIds, options) {
      const env = await crmTransferEnv(ctx)
      requireCrmRecords(env, 'companies')
      const definitions = await crmCustomDefinitions(env, 'company')
      const emails = fieldIds.includes('owner') ? await crmMemberEmails(env.orgId) : new Map<string, string>()
      return readCrmExportPage(
        env,
        companiesOf(env),
        cursor,
        options,
        (data) => visibleIn(env, data['visibleTo'], options?.scopeTokens),
        async (docs) => {
          const parentIds = fieldIds.includes('parentCompany')
            ? [...new Set(docs.map((doc) => crmCompanyParentId(doc.data['parentCompanyId'])).filter((id): id is string => Boolean(id)))]
            : []
          const parents = new Map<string, string>()
          if (parentIds.length) {
            for (const snapshot of await env.firestore.getAll(...parentIds.map((id) => companiesOf(env).doc(id)))) {
              if (snapshot.exists) parents.set(snapshot.id, String(snapshot.get('name') ?? snapshot.id))
            }
          }
          return docs.map((doc) =>
            pickValues(
              companyTransferValues(doc.id, doc.data, definitions, {
                owner: (uid) => emails.get(uid),
                parent: (id) => parents.get(id),
              }),
              fieldIds,
            ),
          )
        },
      )
    },

    async lookup(ctx, requests) {
      const env = await crmTransferEnv(ctx)
      const definitions = await crmCustomDefinitions(env, 'company')
      const visible = (data: Record<string, unknown>) => visibleIn(env, data['visibleTo'])
      const found = { lookup: new Map<string, string[]>(), docs: new Map<string, Record<string, unknown>>() }
      for (const request of requests) {
        if (request.fieldId === TRANSFER_ID_FIELD) await lookupById(env, companiesOf(env), request, visible, found)
        else if (request.fieldId === 'domain') {
          await lookupByField(companiesOf(env), request, 'domain', (value) => normalizeCompanyDomain(value) ?? '', visible, found)
        } else if (request.fieldId === 'name') {
          await lookupByField(companiesOf(env), request, 'nameLower', (value) => nameSearchKey(value), visible, found)
        }
      }
      return lookupResult(found, (id, data) => companyTransferValues(id, data, definitions))
    },

    async suggest(ctx, request) {
      const env = await crmTransferEnv(ctx)
      const answer: Record<string, ReturnType<typeof rankTransferLookupSuggestions>> = {}
      for (const value of request.values) {
        // Companies whose name starts with the value's first word: a prefix
        // range on `nameLower`, the field the list's own search reads.
        const first = nameSearchKey(value).split(' ')[0] ?? ''
        if (first.length < 2) {
          answer[value] = []
          continue
        }
        const snapshot = await companiesOf(env)
          .where('nameLower', '>=', first)
          .where('nameLower', '<', `${first}`)
          .limit(IN_LIMIT)
          .get()
        const candidates = snapshot.docs
          .filter((doc) => visibleIn(env, doc.get('visibleTo')))
          .map((doc) => ({ recordId: doc.id, label: String(doc.get('name') ?? doc.id) }))
        answer[value] = rankTransferLookupSuggestions(value, candidates)
      }
      return answer
    },

    async picklists(ctx, ids) {
      const env = await crmTransferEnv(ctx)
      return crmPicklistLists(env, ids, await crmCustomDefinitions(env, 'company'))
    },

    async addPicklistValues(ctx, picklistId, values) {
      await addCrmPicklistValues(await crmTransferEnv(ctx), picklistId, values)
    },

    lockedRules: () => [
      {
        fieldId: 'parentCompany',
        reason: 'A company can never sit under itself or a company under it; such a parent is refused for that row.',
      },
    ],

    async plan(ctx, input) {
      const env = await crmTransferEnv(ctx)
      requireCrmSuite(env, 'Importing companies')
      requireSite(env, 'companies')
      return buildTransferPlan(input)
    },

    async apply(ctx, chunk, writer) {
      const env = await crmTransferEnv(ctx)
      requireCrmSuite(env, 'Importing companies')
      requireSite(env, 'companies')
      const definitions = await crmCustomDefinitions(env, 'company')
      const picklists = await companyPicklists(env)
      const admit = crmRecordsRoom(env)
      const created = new Map<string, Promise<{ id: string; name: string } | null>>()
      const results: TransferRowResult[] = []
      const undo: TransferUndoEntry[] = []
      const rows = chunk.rows as PlannedTransferRow[]

      await eachWithinBudget(rows, () => writer.timeLeftMs(), async (row) => {
        const earlier = await writer.alreadyApplied(row.index)
        if (earlier) {
          results.push(earlier)
          return
        }
        let result: TransferRowResult
        let entry: TransferUndoEntry | undefined
        try {
          const values = plannedValues(row)
          const ref = row.verdict === 'update' && row.recordId ? companiesOf(env).doc(row.recordId) : null
          const current = ref ? ((await ref.get()).data() ?? null) : {}
          if (!current) throw new TransferEngineError('notFound', 404, 'That company no longer exists.')
          const before = ref ? companyTransferValues(ref.id, current, definitions) : null
          const { fields, error } = storedFieldsFor(values, current)
          if (error) throw new TransferEngineError('invalid', 422, error)
          const requested = Object.fromEntries(
            CRM_COMPANY_PICKLIST_FIELDS.filter(({ field }) => field in values).map(({ field }) => [field, values[field] ?? null]),
          )
          const judged = judgeCrmCompanyPicklists(picklists, requested, { current, created: !ref })
          const refused = Object.entries(judged.errors)[0]
          if (refused) throw new TransferEngineError('invalid', 422, refused[1])
          for (const [field, value] of Object.entries(judged.values)) fields[field] = value ?? null
          const custom = customWriteValues(values, definitions, 'company')
          if ('error' in custom) throw new TransferEngineError('invalid', 422, custom.error)
          if ('parentCompany' in values) {
            const parentId = await parentIdFor(env, values['parentCompany'], ctx.actorUid, created, admit)
            if (parentId) {
              const refusal = await parentRefusal(env, ref?.id ?? null, parentId)
              if (refusal) throw new TransferEngineError('invalid', 422, refusal)
            }
            fields['parentCompanyId'] = parentId ?? null
          }

          if (ref) {
            const next = { ...current, ...fields }
            await ref.update({
              ...asUpdate(fields),
              ...Object.fromEntries(Object.entries(custom.values).map(([key, value]) => [`custom.${key}`, value])),
              ...crmCompanyListFields(next),
              updatedAt: FieldValue.serverTimestamp(),
            })
            const after = (await readCompanies(env, [ref.id], definitions)).get(ref.id) ?? {}
            const changed = row.diff.map((change) => change.fieldId)
            result = { row: row.index, outcome: 'updated', recordId: ref.id }
            entry = {
              row: row.index,
              recordId: ref.id,
              action: 'updated',
              previous: pickValues(before ?? {}, changed),
              written: pickValues(after, changed),
            }
          } else {
            if (!(await admit())) throw new TransferEngineError('invalid', 422, 'The CRM records limit is reached.')
            const scope = creationScope(env, ctx.actorUid)
            const stored = asCreate(fields)
            const createdRef = companiesOf(env).doc(createResourceUid())
            await createdRef.set({
              ...stored,
              tags: Array.isArray(stored['tags']) ? stored['tags'] : [],
              ...(Object.keys(custom.values).length ? { custom: custom.values } : {}),
              ...scope,
              ...crmNewRecordListFields('companies', { ...stored, ...scope }),
            })
            const after = (await readCompanies(env, [createdRef.id], definitions)).get(createdRef.id) ?? {}
            result = { row: row.index, outcome: 'created', recordId: createdRef.id }
            entry = {
              row: row.index,
              recordId: createdRef.id,
              action: 'created',
              written: pickValues(after, row.diff.map((change) => change.fieldId)),
            }
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
      const definitions = await crmCustomDefinitions(env, 'company')
      const done: TransferUndoStep[] = []
      const conflicts: TransferUndoStep[] = []
      const current = await readCompanies(env, snapshot.entries.map((entry) => entry.recordId), definitions)
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
        if (entry.action === 'created') {
          await deleteCrmCompany(env.firestore, env.orgRef, entry.recordId)
          done.push({ action: 'delete', recordId: entry.recordId })
          continue
        }
        const values = step.action === 'restore' || step.action === 'conflict' ? step.values : {}
        const ref = companiesOf(env).doc(entry.recordId)
        const stored = (await ref.get()).data() ?? {}
        const { fields } = storedFieldsFor(values, stored)
        for (const { field } of CRM_COMPANY_PICKLIST_FIELDS) {
          if (field in values) fields[field] = (values[field] as string | null) ?? null
        }
        if ('parentCompany' in values) fields['parentCompanyId'] = (values['parentCompany'] as string | null) ?? null
        for (const [fieldId, value] of Object.entries(values)) {
          if (fieldId.startsWith('custom:')) {
            const key = fieldId.slice('custom:'.length)
            const definition = definitions.find((one) => one.key === key)
            fields[`custom.${key}`] =
              definition?.type === 'date' && typeof value === 'string' ? Date.parse(value) : (value ?? null)
          }
        }
        await ref.update({
          ...asUpdate(fields),
          ...crmCompanyListFields({ ...stored, ...fields }),
          updatedAt: FieldValue.serverTimestamp(),
        })
        touched.push(ref)
        done.push(step)
      }
      if (touched.length) await restampCrmListFieldsOf(touched, 'companies').catch(() => undefined)
      return { done, conflicts }
    },
  }
}
