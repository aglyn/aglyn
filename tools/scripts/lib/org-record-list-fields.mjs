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
 * THE SCRIPT-SIDE TWIN OF THE CRM LIST FIELDS (AGL-3321).
 *
 * A CRM list queries fields derived from the record — the search tokens and
 * their scoped twins, a lead's status, lead source key and verdict key, a
 * contact's facet keys (`crmListFields` in
 * `libs/aglyn/src/lib/app-utils/crm.ts`). A plain Node script cannot import
 * that module, so the backfill and the seeds build the same fields here.
 * Both halves answer `org-record-list-fields.fixtures.json`: the library's
 * `crm-list-fields.spec.ts` asserts it against `crmListFields`, and
 * `org-record-list-fields.test.mjs` asserts it against this file — so a spelling
 * the writers, the queries and the backfill disagree on fails one of them.
 *
 * The word-prefix and scoped-token builders are imported, not copied: they are
 * `name-search-tokens.mjs`, the platform's one script-side twin.
 */
import {
  NAME_TOKEN_MAX_PREFIX,
  nameSearchKey,
  nameSearchTokens,
  sameSearchTokens,
  scopedSearchTokens,
} from './name-search-tokens.mjs'

/** `CRM_SEARCH_TOKENS_MAX`: the most search tokens one record keeps. */
export const CRM_SEARCH_TOKENS_MAX = 200
/** `CRM_FACET_KEYS_MAX`: the most facet keys one contact keeps. */
export const CRM_FACET_KEYS_MAX = 600
/** `CRM_FACET_KEY_ANY_GROUP`: the group a key names at the organization level. */
export const CRM_FACET_KEY_ANY_GROUP = '*'
/** `CRM_EMAIL_STATUS_NONE`: the verdict key of a record nothing is known about. */
export const CRM_EMAIL_STATUS_NONE = 'none'
/** `CRM_LEAD_TEXT_MAX`: a picklist label's cap. */
const CRM_LEAD_TEXT_MAX = 120

const EMAIL_STATE_STATUSES = ['ok', 'undeliverable', 'bounced', 'blocked', 'unsubscribed', 'complained', 'do_not_contact']
const CRM_LEAD_STATUSES = ['new', 'nurturing', 'working', 'qualified', 'unqualified']
const CONTACT_LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'marketing-qualified',
  'sales-qualified',
  'opportunity',
  'customer',
  'evangelist',
  'other',
]

/** `crmSearchTokens`: every word prefix of every value, and an address's parts. */
export function crmSearchTokens(values) {
  const tokens = new Set()
  const addWord = (word) => {
    const capped = word.slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      if (tokens.size >= CRM_SEARCH_TOKENS_MAX) return
      tokens.add(capped.slice(0, end))
    }
  }
  const addText = (text) => {
    const key = nameSearchKey(text)
    if (!key) return
    for (const word of key.split(' ')) {
      if (!word) continue
      addWord(word)
      if (/[@.+_-]/.test(word)) {
        for (const part of word.split(/[@.+_-]+/)) if (part) addWord(part)
      }
    }
  }
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === 'string') addText(entry)
    } else if (typeof value === 'string') {
      addText(value)
    }
  }
  return [...tokens]
}

/** `crmPhoneSearchWords`: the digits whole, without a country code, and the last seven and four. */
export function crmPhoneSearchWords(phone) {
  const digits = typeof phone === 'string' ? phone.replace(/\D/g, '') : ''
  if (digits.length < 4) return []
  const words = new Set([digits])
  for (let strip = 1; strip <= 3; strip += 1) {
    if (digits.length - strip >= 7) words.add(digits.slice(strip))
  }
  if (digits.length > 7) words.add(digits.slice(-7))
  words.add(digits.slice(-4))
  return [...words]
}

function searchFields(visibleTo, values) {
  const searchTokens = crmSearchTokens(values)
  return { searchTokens, scopedSearchTokens: scopedSearchTokens(visibleTo, searchTokens) }
}

/** `crmEmailStatusKey`: the verdict's status, or `none`. */
export function crmEmailStatusKey(record) {
  const raw = record?.emailState
  const status = raw && typeof raw === 'object' ? raw.status : undefined
  return EMAIL_STATE_STATUSES.includes(status) ? status : CRM_EMAIL_STATUS_NONE
}

/** `crmLeadSourceKey`: the label as the picklist compares it, `null` for none. */
export function crmLeadSourceKey(value) {
  const label = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, CRM_LEAD_TEXT_MAX)
  return nameSearchKey(label) || null
}

/** `crmFacetKeyValue`: a facet value as its key spells it, or `null`. */
export function crmFacetKeyValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  return nameSearchKey(value).slice(0, 120) || null
}

/** `crmFacetKey`. */
export function crmFacetKey(group, field, value) {
  return value === undefined ? `${group}:${field}` : `${group}:${field}=${value}`
}

function facetKeysOf(group, facet, into) {
  const add = (field, raw) => {
    const value = crmFacetKeyValue(raw)
    if (value === null) return
    into.add(crmFacetKey(group, field))
    into.add(crmFacetKey(group, field, value))
  }
  add('owner', facet.ownerUid)
  if (CONTACT_LIFECYCLE_STAGES.includes(facet.lifecycleStage)) add('stage', facet.lifecycleStage)
  add('company', facet.companyId)
  const sources = facet.sources
  if (sources && typeof sources === 'object' && !Array.isArray(sources)) {
    for (const [source, on] of Object.entries(sources)) if (on) add('source', source)
  }
  if (Array.isArray(facet.tags)) for (const tag of facet.tags) add('tag', tag)
  if (typeof facet.ordersCount === 'number' && facet.ordersCount > 0) {
    into.add(crmFacetKey(group, 'orders'))
  }
  if (typeof facet.ltvCents === 'number' && facet.ltvCents > 0) into.add(crmFacetKey(group, 'ltv'))
  const custom = facet.custom
  if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
    for (const [key, value] of Object.entries(custom)) {
      if (/^[A-Za-z0-9_-]{1,64}$/.test(key)) add(`custom.${key}`, value)
    }
  }
  add('leadSource', facet.leadSource)
}

/** `crmContactFacetKeys`: every holder's keys, and any holder's under `*`. */
export function crmContactFacetKeys(record) {
  const facets = record?.facets
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return []
  const groups = new Set()
  const any = new Set()
  for (const [groupId, facet] of Object.entries(facets)) {
    if (!groupId || !facet || typeof facet !== 'object' || Array.isArray(facet)) continue
    facetKeysOf(groupId, facet, groups)
    facetKeysOf(CRM_FACET_KEY_ANY_GROUP, facet, any)
  }
  return [...any, ...groups].slice(0, CRM_FACET_KEYS_MAX)
}

/** `crmListFields`: every list field of one record, from the record as stored. */
export function crmListFields(collection, record) {
  const doc = record ?? {}
  switch (collection) {
    case 'leads':
      return {
        ...searchFields(
          doc.visibleTo,
          ['name', 'email', 'company', 'jobTitle', 'tags'].map((field) => doc[field]),
        ),
        scopedCampaignIds: scopedSearchTokens(
          doc.visibleTo,
          Array.isArray(doc.campaignIds)
            ? doc.campaignIds.filter((entry) => typeof entry === 'string' && entry.length > 0)
            : [],
        ),
        status: CRM_LEAD_STATUSES.includes(doc.status) ? doc.status : 'new',
        leadSourceKey: crmLeadSourceKey(doc.leadSource),
        emailStatus: crmEmailStatusKey(doc),
      }
    case 'contacts':
      return {
        ...searchFields(doc.visibleTo, [
          ...['name', 'email', 'alternateEmails', 'companyName'].map((field) => doc[field]),
          crmPhoneSearchWords(doc.phone),
        ]),
        facetKeys: crmContactFacetKeys(doc),
        emailStatus: crmEmailStatusKey(doc),
      }
    case 'companies':
      return {
        ...searchFields(doc.visibleTo, [doc.name, doc.domain]),
        // The picklist keys the Companies list filters by (AGL-3514).
        typeKey: crmLeadSourceKey(doc.type),
        industryKey: crmLeadSourceKey(doc.industry),
        ratingKey: crmLeadSourceKey(doc.rating),
        accountSourceKey: crmLeadSourceKey(doc.accountSource),
      }
    case 'deals':
      return {
        ...searchFields(doc.visibleTo, [doc.title]),
        titleLower: nameSearchKey(typeof doc.title === 'string' ? doc.title : ''),
      }
    case 'crmTasks':
      return searchFields(doc.visibleTo, [doc.title])
    default:
      throw new Error(`crmListFields: unknown collection ${collection}`)
  }
}

/** `CRM_LIST_NULLABLE_FIELD`: the field a record carries as `null` rather than absent. */
export const CRM_LIST_NULLABLE_FIELD = {
  leads: null,
  contacts: 'nextTaskAtMs',
  companies: 'nextTaskAtMs',
  deals: 'nextTaskAtMs',
  crmTasks: 'dueAtMs',
}

/** `crmNewRecordListFields`: the list fields, and the nullable field as `null` when unset. */
export function crmNewRecordListFields(collection, record) {
  const fields = crmListFields(collection, record)
  const nullable = CRM_LIST_NULLABLE_FIELD[collection]
  if (!nullable || record?.[nullable] !== undefined) return fields
  return { ...fields, [nullable]: null }
}

const sameValue = (a, b) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((entry, at) => entry === b[at])
    : a === b

/**
 * What a stored record carries WRONGLY — `crmListFieldsPatch` — plus the
 * nullable field as `null` when it is absent. `{}` when the record is level.
 */
export function crmListFieldsBackfillPatch(collection, record) {
  const patch = {}
  for (const [field, value] of Object.entries(crmListFields(collection, record))) {
    if (!sameValue(record?.[field], value)) patch[field] = value
  }
  const nullable = CRM_LIST_NULLABLE_FIELD[collection]
  if (nullable && record?.[nullable] === undefined) patch[nullable] = null
  return patch
}

const LIST_COLLECTIONS = new Set(['leads', 'contacts', 'companies', 'deals', 'crmTasks'])

/**
 * A seed's document with the list fields a writer would stamp, when `ref`
 * is a record of one of the CRM lists (`orgs/{orgId}/{collection}/{id}`);
 * any other document unchanged. For WHOLE documents only — a seed's create
 * or rewrite — since the fields are computed from `data` alone.
 */
export function withCrmListFields(ref, data) {
  const collection = ref?.parent?.id
  const root = ref?.parent?.parent?.parent?.id
  if (root !== 'orgs' || !LIST_COLLECTIONS.has(collection)) return data
  return { ...data, ...crmNewRecordListFields(collection, data) }
}

/** `CRM_FIELD_OBJECTS`: the records a custom field may describe. */
const CRM_FIELD_OBJECTS = ['contact', 'company', 'deal', 'lead']

/**
 * `crmFieldListFields`: what the CRM › Fields table's query reads on a field
 * definition (AGL-3335) — its tab, stored even for a contact's; `required`
 * as a boolean; and the word prefixes of its name and its key.
 */
export function crmFieldListFields(definition) {
  const label = typeof definition?.label === 'string' ? definition.label : ''
  const key = typeof definition?.key === 'string' ? definition.key : ''
  return {
    object: CRM_FIELD_OBJECTS.includes(definition?.object) ? definition.object : 'contact',
    required: definition?.required === true,
    searchTokens: nameSearchTokens([label, key, key.replace(/[_.-]+/g, ' ')].join(' ')),
  }
}

/** What a stored definition is missing or carries wrongly of those fields; `{}` when level. */
export function crmFieldListFieldsBackfillPatch(definition) {
  const fields = crmFieldListFields(definition)
  const patch = {}
  if (definition?.object !== fields.object) patch.object = fields.object
  if (definition?.required !== fields.required) patch.required = fields.required
  if (!sameSearchTokens(definition?.searchTokens, fields.searchTokens)) {
    patch.searchTokens = fields.searchTokens
  }
  return patch
}
