// The one-record migration's decisions (AGL-3235): which contacts are
// duplicates of a lead, what each hands to its lead, and what follows the
// person from one record to the other. Pure — the script in
// `backfill-crm-salesforce-model.mjs` reads and writes; this decides — and
// pinned by `crm-salesforce-backfill.test.mjs`.
//
// ## The rule
//
// Under the Salesforce model a person is ONE record: a lead until somebody
// qualifies them, a contact after (AGL-3232). Before it, a lead-routed form
// or a booking wrote a lead AND a contact at stage Lead, and the CRM's own
// imports filed unqualified people as contacts. So the corpus holds two
// kinds of contact at stage Lead:
//
//  - a DUPLICATE OF A LEAD: nothing about the contact but the capture that
//    made it — no member account, no order, no newsletter opt-in, no deal,
//    no stage past Lead on any facet. The person is a lead; the contact is
//    folded onto the lead (created where the site holds none) and deleted.
//    Its enrollments, activities and tasks follow it to the lead.
//  - a RELATIONSHIP: a member, a buyer, a subscriber, somebody with a deal
//    or a stage past Lead. The contact stands; an open lead the site holds
//    for the address is closed as converted onto it, and the lead's
//    enrollments, activities and tasks follow to the contact.
//
// ## What is never lost
//
// A fold copies before it deletes: a value the lead already holds wins,
// a value it lacks is taken from the contact, tags are the union, and the
// marketing basis is carried forward — never invented, never dropped. The
// deleted contact is written whole to `crmBackfillArchive` first, so the
// delete is reversible by hand. Consent, ownership and every id are the
// person's, not the record's.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The stages a contact may hold, in funnel order — `CONTACT_LIFECYCLE_STAGES`, restated. */
export const CONTACT_LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'marketing-qualified',
  'sales-qualified',
  'opportunity',
  'customer',
  'evangelist',
  'other',
]

/** The capture sources that make a person a RELATIONSHIP rather than a lead. */
export const RELATIONSHIP_SOURCES = ['member', 'order', 'newsletter']

/** The capture sources a lead is filed from, and the word each spells on the lead. */
export const LEAD_SOURCE_WORDS = { form: 'form', booking: 'booking', import: 'import', manual: 'manual', api: 'api' }

/** The field names this script reads and writes, as the tree spells them. */
export const FIELDS = {
  facets: 'facets',
  capturedByHostIds: 'capturedByHostIds',
  formIds: 'formIds',
  companyIds: 'companyIds',
  marketingConsent: 'marketingConsent',
  marketingConsentByHost: 'marketingConsentByHost',
  emailIndex: 'emailIndex',
  archive: 'crmBackfillArchive',
}

/** The marker a caller turns into `FieldValue.delete()` on the write. */
export const DELETE_FIELD = Symbol('delete')

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** `normalizeContactEmail`, restated: trimmed, lowercased, or `null`. */
export function normalizeEmail(input) {
  const email = String(input ?? '')
    .trim()
    .toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null
}

/** `personKey`, restated: the full sha256 of the normalized address. */
export function personKey(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  return createHash('sha256').update(normalized).digest('hex')
}

const text = (value, max = 120) =>
  typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Every facet on a contact, by group id. */
export function facetsOf(contact) {
  const facets = contact?.[FIELDS.facets]
  return isObject(facets) ? Object.entries(facets).filter(([, facet]) => isObject(facet)) : []
}

/** `crmLeadStatus`, restated: an absent or unknown status is `new`. */
export function leadStatus(lead) {
  const status = lead?.status
  return ['new', 'working', 'qualified', 'unqualified'].includes(status) ? status : 'new'
}

/** An open lead: neither converted nor closed. */
export function leadIsOpen(lead) {
  return Boolean(lead) && !lead.convertedContactId && ['new', 'working'].includes(leadStatus(lead))
}

/**
 * Why a contact stands on its own — the reasons that make the person a
 * relationship. Empty for a contact that is a lead in a contact's clothes.
 */
export function contactOwnReasons(contact, { hasDeals = false } = {}) {
  const reasons = new Set()
  if (hasDeals) reasons.add('deal')
  for (const [, facet] of facetsOf(contact)) {
    for (const source of RELATIONSHIP_SOURCES) {
      if (facet.sources?.[source] === true) reasons.add(source)
    }
    if (Number(facet.ordersCount) > 0 || Number(facet.ltvCents) > 0) reasons.add('order')
    const stage = facet.lifecycleStage
    if (CONTACT_LIFECYCLE_STAGES.includes(stage) && stage !== 'lead') {
      // A subscriber is a relationship (an opt-in); every stage past Lead
      // is somebody's verdict; `other` is a stage a person chose.
      reasons.add(`stage:${stage}`)
    }
    for (const interaction of facet.interactions ?? []) {
      if (RELATIONSHIP_SOURCES.includes(interaction?.type)) reasons.add(interaction.type)
    }
  }
  return [...reasons].sort()
}

/**
 * What a contact is, under the one-record rule: a duplicate of a lead, a
 * relationship, or a row nothing can key.
 */
export function classifyContact(contact, { hasDeals = false } = {}) {
  const email = normalizeEmail(contact?.email)
  if (!email) return { kind: 'no-email', reasons: [] }
  const reasons = contactOwnReasons(contact, { hasDeals })
  return reasons.length ? { kind: 'relationship', reasons } : { kind: 'duplicate-lead', reasons: [] }
}

/**
 * The sites a duplicate contact's lead is filed under: every site that
 * captured the person, and every site a sequence enrolled them from — the
 * enrollment follows the person to the lead, and a sequence sends only to
 * a lead its own site holds.
 */
export function hostsForContact(contact, { orgHostIds, enrollmentHostIds = [] }) {
  const org = new Set(orgHostIds)
  const captured = Array.isArray(contact?.[FIELDS.capturedByHostIds]) ? contact[FIELDS.capturedByHostIds] : []
  const hosts = new Set([...captured, ...(contact?.hostId ? [contact.hostId] : []), ...enrollmentHostIds])
  return [...hosts].filter((hostId) => org.has(hostId)).sort()
}

/** The contact's grant for one host, when the record reads as granted and nothing refuses. */
export function grantedConsentEntry(contact, hostId) {
  if (contact?.[FIELDS.marketingConsent] === false) return null
  const byHost = contact?.[FIELDS.marketingConsentByHost]
  if (!isObject(byHost)) return null
  for (const entry of Object.values(byHost)) {
    if (isObject(entry) && entry[FIELDS.marketingConsent] === false) return null
  }
  const entry = byHost[hostId]
  if (!isObject(entry) || entry[FIELDS.marketingConsent] !== true) return null
  return { ...entry }
}

/**
 * The facet a host reads: the host's own group, else the first facet on
 * the row — an org that pooled its sites keeps one facet under the group
 * id, which every site of the group reads.
 */
export function facetForHost(contact, hostId, groupId = hostId) {
  const facets = facetsOf(contact)
  const own = facets.find(([id]) => id === groupId || id === hostId)
  return own?.[1] ?? facets[0]?.[1] ?? {}
}

/** The lead's `sources` words a contact's capture implies. */
export function leadSourcesFor(contact, facet) {
  const words = []
  const formIds = Array.isArray(contact?.[FIELDS.formIds]) ? contact[FIELDS.formIds].map(String) : []
  if (facet.sources?.form === true || formIds.length) {
    if (formIds.length) words.push(...formIds.map((id) => `form:${id}`))
    else words.push('form')
  }
  for (const source of ['booking', 'import', 'manual', 'api']) {
    if (facet.sources?.[source] === true) words.push(LEAD_SOURCE_WORDS[source])
  }
  return words.length ? words : ['import']
}

const timestampMs = (value) =>
  typeof value === 'number'
    ? value
    : value && typeof value.toMillis === 'function'
      ? value.toMillis()
      : value && typeof value.seconds === 'number'
        ? value.seconds * 1000
        : null

/**
 * The profile a contact hands to its lead: the fields a lead carries of its
 * own (AGL-3231), read off the facet in the shape the lead stores them.
 */
export function profileFromContact(contact, facet) {
  const tags = Array.isArray(facet.tags) ? [...new Set(facet.tags.map((tag) => text(tag, 40).toLowerCase()).filter(Boolean))] : []
  return {
    ...(text(contact?.name) ? { name: text(contact.name) } : {}),
    ...(text(facet.phone, 40) ? { phone: text(facet.phone, 40) } : {}),
    ...(text(facet.jobTitle) ? { jobTitle: text(facet.jobTitle) } : {}),
    ...(text(facet.companyName) ? { company: text(facet.companyName) } : {}),
    ...(isObject(facet.address) ? { address: { ...facet.address } } : {}),
    ...(tags.length ? { tags } : {}),
    ...(text(facet.notes, 4000) ? { notes: text(facet.notes, 4000) } : {}),
    ...(text(facet.ownerUid, 128) ? { ownerUid: text(facet.ownerUid, 128) } : {}),
  }
}

/**
 * What one duplicate contact writes onto one host's lead: a whole row when
 * the site holds none, or the fields the existing lead lacks. A value the
 * lead already holds wins — the lead is the record the rep has been
 * working — tags are the union, and the consent entry is carried only where
 * the lead has none. Never a clear.
 */
export function foldContactIntoLead({ contact, existingLead, hostId, groupId = hostId, nowMs }) {
  const email = normalizeEmail(contact?.email)
  const key = personKey(email)
  if (!email || !key) return null
  const facet = facetForHost(contact, hostId, groupId)
  const profile = profileFromContact(contact, facet)
  const consent = grantedConsentEntry(contact, groupId) ?? grantedConsentEntry(contact, hostId)
  if (!existingLead) {
    const seen = (facet.interactions ?? []).map((interaction) => Number(interaction?.atMs)).filter(Number.isFinite)
    const createdAtMs = timestampMs(contact?.createdAt)
    const firstSeenAtMs = seen.length ? Math.min(...seen) : (createdAtMs ?? nowMs)
    const lastSeenAtMs = seen.length ? Math.max(...seen) : Math.max(firstSeenAtMs, timestampMs(contact?.updatedAt) ?? firstSeenAtMs)
    return {
      key,
      kind: 'create',
      row: {
        email,
        ...profile,
        status: 'new',
        sources: leadSourcesFor(contact, facet),
        submissionCount: Math.max(1, (facet.interactions ?? []).length),
        firstSeenAtMs,
        lastSeenAtMs,
        [FIELDS.capturedByHostIds]: [hostId],
        ...(consent ? { [FIELDS.marketingConsentByHost]: { [hostId]: consent } } : {}),
        backfilledAtMs: nowMs,
      },
    }
  }
  const merge = {}
  for (const [field, value] of Object.entries(profile)) {
    if (field === 'tags') {
      const held = Array.isArray(existingLead.tags) ? existingLead.tags : []
      const union = [...new Set([...held, ...value])]
      if (union.length !== held.length) merge.tags = union
    } else if (existingLead[field] === undefined || existingLead[field] === null || existingLead[field] === '') {
      merge[field] = value
    }
  }
  const leadConsent = existingLead[FIELDS.marketingConsentByHost]?.[hostId]
  if (consent && !isObject(leadConsent)) {
    merge[`${FIELDS.marketingConsentByHost}.${hostId}`] = consent
  }
  return { key, kind: Object.keys(merge).length ? 'merge' : 'unchanged', merge }
}

/**
 * The records that follow a duplicate contact to its lead: the sequence
 * enrollments made on the contact now name the lead (target `lead`, the
 * contact id cleared); the activities and tasks filed on the contact gain
 * the lead and drop the contact, since the contact is about to go.
 */
export function repointContactToLead({ contactId, key, enrollments, activities, tasks }) {
  return {
    enrollments: enrollments
      .filter((row) => row.data?.contactId === contactId)
      .map((row) => ({ id: row.id, value: { target: 'lead', leadId: key, contactId: '' } })),
    activities: activities
      .filter((row) => row.data?.contactId === contactId)
      .map((row) => ({ id: row.id, value: { leadId: key, contactId: DELETE_FIELD } })),
    tasks: tasks
      .filter((row) => row.data?.contactId === contactId)
      .map((row) => ({ id: row.id, value: { leadId: key, contactId: DELETE_FIELD } })),
  }
}

/** The stamp that closes an open lead onto the contact the person already is. */
export function conversionStamp({ contactId, nowMs }) {
  return { status: 'qualified', convertedContactId: contactId, convertedAtMs: nowMs, convertedBy: 'backfill' }
}

/**
 * The records that follow a closed lead to the contact: the enrollments
 * made on the lead now name the contact (and keep the lead), the
 * activities and tasks filed on the lead gain the contact.
 */
export function repointLeadToContact({ key, contactId, enrollments, activities, tasks }) {
  return {
    enrollments: enrollments
      .filter((row) => row.data?.leadId === key && row.data?.target !== 'contact')
      .map((row) => ({ id: row.id, value: { target: 'contact', contactId } })),
    activities: activities
      .filter((row) => row.data?.leadId === key && row.data?.contactId !== contactId)
      .map((row) => ({ id: row.id, value: { contactId } })),
    tasks: tasks
      .filter((row) => row.data?.leadId === key && row.data?.contactId !== contactId)
      .map((row) => ({ id: row.id, value: { contactId } })),
  }
}

/**
 * The whole plan for one contact against one org: what it is, which hosts
 * hold or get its lead, what each lead write is, what follows it, and
 * whether the contact is deleted.
 *
 * @param {object} input
 * @param {string} input.contactId
 * @param {object} input.contact
 * @param {string[]} input.orgHostIds
 * @param {(hostId: string) => string} input.groupFor  the consent group a host's facet is filed under
 * @param {Map<string, Map<string, object>>} input.leadsByHost  hostId → (leadId → lead)
 * @param {Array<{id, data}>} input.enrollments  every enrollment in the org
 * @param {Array<{id, data}>} input.activities  the activities that name this contact or its key
 * @param {Array<{id, data}>} input.tasks  the tasks that name this contact or its key
 * @param {boolean} input.hasDeals
 * @param {number} input.nowMs
 */
export function planContact(input) {
  const { contactId, contact, orgHostIds, groupFor, leadsByHost, enrollments, activities, tasks, hasDeals, nowMs } = input
  const classified = classifyContact(contact, { hasDeals })
  const email = normalizeEmail(contact?.email)
  const key = personKey(email)
  const own = enrollments.filter((row) => row.data?.contactId === contactId)
  if (classified.kind === 'no-email') return { contactId, email: String(contact?.email ?? ''), kind: 'no-email', reasons: [], hosts: [] }

  if (classified.kind === 'relationship') {
    // The contact stands; every open lead for the address closes onto it.
    const hosts = []
    for (const hostId of orgHostIds) {
      const lead = leadsByHost.get(hostId)?.get(key)
      if (!leadIsOpen(lead)) continue
      hosts.push({
        hostId,
        key,
        stamp: conversionStamp({ contactId, nowMs }),
        follows: repointLeadToContact({ key, contactId, enrollments, activities, tasks }),
      })
    }
    return { contactId, email, key, kind: 'relationship', reasons: classified.reasons, hosts }
  }

  const hosts = hostsForContact(contact, {
    orgHostIds,
    enrollmentHostIds: own.map((row) => String(row.data?.hostId ?? '')).filter(Boolean),
  })
  const leadWrites = hosts.map((hostId) => {
    const existing = leadsByHost.get(hostId)?.get(key) ?? null
    // A lead already converted onto ANOTHER contact names its person; this
    // contact is then the duplicate of that one, and folds nowhere.
    if (existing?.convertedContactId && existing.convertedContactId !== contactId) {
      return { hostId, key, kind: 'converted-elsewhere', convertedContactId: existing.convertedContactId }
    }
    const fold = foldContactIntoLead({ contact, existingLead: existing, hostId, groupId: groupFor(hostId), nowMs })
    return { hostId, ...fold }
  })
  const blocked = leadWrites.find((write) => write.kind === 'converted-elsewhere')
  if (blocked) return { contactId, email, key, kind: 'converted-elsewhere', reasons: [], hosts: leadWrites }
  if (!hosts.length) return { contactId, email, key, kind: 'no-host', reasons: [], hosts: [] }
  return {
    contactId,
    email,
    key,
    kind: 'duplicate-lead',
    reasons: [],
    hosts: leadWrites,
    follows: repointContactToLead({ contactId, key, enrollments, activities, tasks }),
    deleteContact: true,
  }
}

/**
 * The tree must already run the one-record model before the corpus is
 * moved to it: a capture writer that still made a contact beside every
 * lead would rebuild the duplicates as fast as this removes them, and a
 * sequence runtime that knew only contacts would stop every re-pointed
 * enrollment. Read off the checkout the script runs from.
 */
export function preconditionsForTree(repoRoot) {
  const checks = [
    {
      file: 'libs/plugins/crm/src/lib/server/capture-contact.ts',
      needle: "surface === 'lead'",
      why: 'the capture writer decides which record a capture lands on (AGL-3232)',
    },
    {
      file: 'libs/plugins/outreach/src/lib/model/outreach.types.ts',
      needle: 'OUTREACH_ENROLLMENT_TARGETS',
      why: 'an enrollment names the record it targets (AGL-3234)',
    },
    {
      file: 'libs/tenant/runtime/src/lib/hand-off-lead.ts',
      needle: 'runPluginLeadConversionListeners',
      why: 'a conversion hands the lead’s records to the contact (AGL-3233)',
    },
  ]
  const failures = []
  for (const check of checks) {
    const path = join(repoRoot, check.file)
    if (!existsSync(path) || !readFileSync(path, 'utf8').includes(check.needle)) {
      failures.push(`${check.file} — ${check.why}`)
    }
  }
  return failures.length
    ? { ok: false, why: `the tree does not run the one-record model: ${failures.join('; ')}` }
    : { ok: true, why: 'the capture writer, the enrollment model and the conversion hand-off are in the tree' }
}
