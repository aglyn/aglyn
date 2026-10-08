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
 * their scoped twins, a lead's status, lead source key, lead source
 * direction (from the org's list too) and verdict key, a contact's facet keys (`crmListFields` in
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

/*
 * A LEAD'S LEAD SOURCE DIRECTION (AGL-3577) — `crmLeadSourceDirection`.
 *
 * The group of the org's Lead source picklist the lead's value sits in, read
 * off the org's list (`orgs/{orgId}/crmPicklists/leadSource`) as
 * `effectiveCrmLeadSourcePicklist` reads it: the stored values, each with its
 * stored group (or a standard value's own when the entry names none), and
 * every standard value the list lacks. The standard values are restated here
 * and held to the library's by the fixtures' `leadSourceStandardValues`.
 */

/** `LEAD_SOURCE_DEFINITION.standardValues` in `crm.ts`, as the fixtures pin it. */
export const LEAD_SOURCE_STANDARD_VALUES = [
  { id: 'web', label: 'Web', group: 'inbound' },
  { id: 'phone-inquiry', label: 'Phone inquiry', group: 'inbound' },
  { id: 'email-inquiry', label: 'Email inquiry', group: 'inbound' },
  { id: 'partner-referral', label: 'Partner referral', group: 'inbound' },
  { id: 'employee-referral', label: 'Employee referral', group: 'inbound' },
  { id: 'external-referral', label: 'External referral', group: 'inbound' },
  { id: 'advertisement', label: 'Advertisement', group: 'inbound' },
  { id: 'trade-show', label: 'Trade show', group: 'inbound' },
  { id: 'webinar', label: 'Webinar', group: 'inbound' },
  { id: 'word-of-mouth', label: 'Word of mouth', group: 'inbound' },
  { id: 'website-form', label: 'Website form', group: 'inbound' },
  { id: 'booking', label: 'Booking', group: 'inbound' },
  { id: 'newsletter-sign-up', label: 'Newsletter sign-up', group: 'inbound' },
  { id: 'site-member-sign-up', label: 'Site member sign-up', group: 'inbound' },
  { id: 'online-purchase', label: 'Online purchase', group: 'inbound' },
  { id: 'account-sign-up', label: 'Account sign-up', group: 'inbound' },
  { id: 'purchased-list', label: 'Purchased list', group: 'outbound' },
  { id: 'sequence', label: 'Sequence', group: 'outbound' },
  { id: 'email-campaign', label: 'Email campaign', group: 'outbound' },
  { id: 'other', label: 'Other' },
]

/** `CRM_LEAD_SOURCE_DIRECTIONS`: the Lead source picklist's groups. */
export const CRM_LEAD_SOURCE_DIRECTIONS = ['inbound', 'outbound']
/** `PICKLIST_VALUES_MAX` and `PICKLIST_LABEL_MAX` in `picklists.ts`. */
const PICKLIST_VALUES_MAX = 200
const PICKLIST_LABEL_MAX = 120

const picklistLabel = (value) =>
  String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, PICKLIST_LABEL_MAX)
const picklistLabelKey = (value) => picklistLabel(value).toLowerCase()
const knownDirection = (value) => (CRM_LEAD_SOURCE_DIRECTIONS.includes(value) ? value : null)
const standardById = (id) => LEAD_SOURCE_STANDARD_VALUES.find((value) => value.id === id) ?? null

/**
 * `effectiveCrmLeadSourcePicklist(raw)`, as far as a direction needs it:
 * each label with its group. `raw` is the stored document, or nothing.
 */
export function crmLeadSourcePicklist(raw) {
  const values = []
  const stored = raw && typeof raw === 'object' && Array.isArray(raw.values) ? raw.values : []
  const labels = new Set()
  const ids = new Set()
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue
    const label = picklistLabel(entry.label)
    if (!label || labels.has(picklistLabelKey(label))) continue
    let id = String(entry.id ?? '').trim().slice(0, 64)
    // The library mints a fresh id here, never a standard one.
    if (!id || id.includes('/') || ids.has(id)) id = `\u0000minted-${ids.size}`
    labels.add(picklistLabelKey(label))
    ids.add(id)
    const group = 'group' in entry ? knownDirection(entry.group) : knownDirection(standardById(id)?.group)
    values.push({ id, label, group })
    if (values.length >= PICKLIST_VALUES_MAX) break
  }
  for (const standard of LEAD_SOURCE_STANDARD_VALUES) {
    if (values.some((value) => value.id === standard.id)) continue
    const holder = values.find((value) => picklistLabelKey(value.label) === picklistLabelKey(standard.label))
    if (holder) {
      // An added value spelled as a standard one becomes it, keeping its group.
      if (!standardById(holder.id)) holder.id = standard.id
      continue
    }
    values.push({ id: standard.id, label: picklistLabel(standard.label), group: knownDirection(standard.group) })
  }
  return { values }
}

/** `crmLeadSourceDirection`: the group `label` has in the list — `null` for none. */
export function crmLeadSourceDirection(leadSources, label) {
  const key = picklistLabelKey(label)
  if (!key) return null
  const value = leadSources.values.find((entry) => picklistLabelKey(entry.label) === key)
  return knownDirection(value?.group)
}

/**
 * A lead's direction field: `null` for no lead source, its group when the
 * org's list is known (`context.leadSources`), else absent — never guessed.
 */
function leadSourceDirectionField(doc, context) {
  if (!crmLeadSourceKey(doc.leadSource)) return { leadSourceDirection: null }
  return context?.leadSources
    ? { leadSourceDirection: crmLeadSourceDirection(context.leadSources, doc.leadSource) }
    : {}
}

/*
 * THE HEADER SORT KEYS (AGL-3680) — `crmSortKey`, `crmSortNumber`,
 * `crmPersonSortKey`, `crmTaskPriorityRank`: what a CRM table's text,
 * optional-number and priority headers sort by on the query, stored on every
 * record (`null` for none) because an `orderBy` leaves out a document
 * without its field.
 */

/** `crmSortKey`: a text value's key, `null` for none. */
export function crmSortKey(value) {
  return (typeof value === 'string' && nameSearchKey(value)) || null
}

/** `crmSortNumber`: a finite number, `null` for none. */
export function crmSortNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** `crmPersonSortKey`: the name's key, or the address's when there is no name. */
export function crmPersonSortKey(doc) {
  return crmSortKey(doc.name) ?? crmSortKey(doc.email)
}

/** `CRM_TASK_PRIORITY_RANK`: a task's priorities, lowest first. */
const CRM_TASK_PRIORITY_RANK = ['low', 'normal', 'high']

/** `crmTaskPriorityRank`: the priority's rank, `normal`'s for none. */
export function crmTaskPriorityRank(priority) {
  const at = CRM_TASK_PRIORITY_RANK.indexOf(priority)
  return at === -1 ? CRM_TASK_PRIORITY_RANK.indexOf('normal') : at
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
/** `DEAL_CONTACT_ROLES_MAX`: the most contacts one deal names. */
const DEAL_CONTACT_ROLES_MAX = 50

/**
 * `dealContactRolesOf`: a deal's stored roles, read defensively, with the
 * contact `contactId` names as the one Primary — added, with no role, when
 * the list does not name them (a deal written before roles).
 */
export function dealContactRolesOf(doc) {
  const roles = []
  const seen = new Set()
  for (const entry of Array.isArray(doc.contactRoles) ? doc.contactRoles : []) {
    if (!entry || typeof entry !== 'object') continue
    const contactId = typeof entry.contactId === 'string' ? entry.contactId.trim() : ''
    if (!contactId || contactId.length > 200 || contactId.includes('/') || seen.has(contactId)) continue
    seen.add(contactId)
    const role =
      typeof entry.role === 'string' ? entry.role.trim().replace(/\s+/g, ' ').slice(0, CRM_LEAD_TEXT_MAX) : ''
    roles.push({ contactId, ...(role ? { role } : {}) })
    if (roles.length >= DEAL_CONTACT_ROLES_MAX) break
  }
  const primary = typeof doc.contactId === 'string' ? doc.contactId.trim() : ''
  if (primary && !roles.some((row) => row.contactId === primary)) roles.unshift({ contactId: primary })
  return roles.slice(0, DEAL_CONTACT_ROLES_MAX)
}

/** `crmDealContactRoleListFields`: the arrays a deal's contact roles are found by. */
export function crmDealContactRoleListFields(doc) {
  const roles = dealContactRolesOf(doc)
  const contactRoleContactIds = roles.map((row) => row.contactId)
  const keys = new Set()
  for (const row of roles) {
    const key = crmLeadSourceKey(row.role)
    if (key) keys.add(key)
  }
  return {
    contactRoleContactIds,
    scopedContactRoleContactIds: scopedSearchTokens(doc.visibleTo, contactRoleContactIds),
    contactRoleKeys: [...keys],
  }
}

/**
 * `crmListFields`. `context.leadSources` is the org's Lead source list
 * (`crmLeadSourcePicklist`), which a lead's direction is read off.
 */
export function crmListFields(collection, record, context = {}) {
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
        // Its group in the org's list (AGL-3577).
        ...leadSourceDirectionField(doc, context),
        emailStatus: crmEmailStatusKey(doc),
        // The Industry and Rating the Leads list filters by (AGL-3513).
        industryKey: crmLeadSourceKey(doc.industry),
        ratingKey: crmLeadSourceKey(doc.rating),
        // The Lead, Company and Title headers' sort keys (AGL-3680).
        nameSortKey: crmPersonSortKey(doc),
        companyLower: crmSortKey(doc.company),
        jobTitleLower: crmSortKey(doc.jobTitle),
      }
    case 'contacts':
      return {
        ...searchFields(doc.visibleTo, [
          ...['name', 'email', 'alternateEmails', 'companyName'].map((field) => doc[field]),
          crmPhoneSearchWords(doc.phone),
        ]),
        facetKeys: crmContactFacetKeys(doc),
        emailStatus: crmEmailStatusKey(doc),
        // The Contact header's sort key (AGL-3680).
        nameSortKey: crmPersonSortKey(doc),
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
        // The Deals list's Type and Lead source keys (AGL-3516).
        typeKey: crmLeadSourceKey(doc.type),
        leadSourceKey: crmLeadSourceKey(doc.leadSource),
        // The deal's contact roles (AGL-3521).
        ...crmDealContactRoleListFields(doc),
        // The Amount and Expected close headers' sort keys (AGL-3680).
        amountSortCents: crmSortNumber(doc.amountCents),
        expectedCloseSortAtMs: crmSortNumber(doc.expectedCloseAtMs),
      }
    case 'crmTasks':
      return {
        ...searchFields(doc.visibleTo, [doc.title]),
        // The Task and Priority headers' sort keys (AGL-3680).
        titleLower: crmSortKey(doc.title),
        priorityRank: crmTaskPriorityRank(doc.priority),
      }
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
export function crmNewRecordListFields(collection, record, context = {}) {
  const fields = crmListFields(collection, record, context)
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
export function crmListFieldsBackfillPatch(collection, record, context = {}) {
  const patch = {}
  for (const [field, value] of Object.entries(crmListFields(collection, record, context))) {
    if (!sameValue(record?.[field], value)) patch[field] = value
  }
  const nullable = CRM_LIST_NULLABLE_FIELD[collection]
  if (nullable && record?.[nullable] === undefined) patch[nullable] = null
  // The Leads list's default order (AGL-3680): see `leadLastSeenAtMs`.
  if (collection === 'leads' && typeof record?.lastSeenAtMs !== 'number') {
    patch.lastSeenAtMs = leadLastSeenAtMs(record)
  }
  return patch
}

/** An instant as epoch milliseconds — a number, a Timestamp, a Date or its JSON forms — or null. */
function millisOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  const seconds = value.seconds ?? value._seconds
  if (typeof seconds === 'number') {
    return seconds * 1000 + Math.floor((value.nanoseconds ?? value._nanoseconds ?? 0) / 1e6)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/**
 * A lead's `lastSeenAtMs` where it has none (AGL-3680). The Leads list
 * orders by it, and an `orderBy` leaves a document without the field out of
 * the answer — so a lead carried over before the lead door stamped it was
 * on no page of the list at all. Every capture through the door stamps it
 * (`addHostLead`); a lead without it was last seen when it was first seen:
 * `firstSeenAtMs`, else its `createdAt`, else 0 (the end of the list).
 */
export function leadLastSeenAtMs(record) {
  return millisOf(record?.firstSeenAtMs) ?? millisOf(record?.createdAt) ?? 0
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
  // No seed writes an org's own Lead source list, so its standard groups are the org's (AGL-3577).
  return { ...data, ...crmNewRecordListFields(collection, data, { leadSources: STANDARD_LEAD_SOURCES }) }
}

/** The standard values alone: the Lead source list of an org that never stored its own. */
const STANDARD_LEAD_SOURCES = crmLeadSourcePicklist(null)

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
