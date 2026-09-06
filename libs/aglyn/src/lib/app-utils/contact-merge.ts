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
 * MERGING TWO CONTACT DOCUMENTS INTO ONE (AGL-2625) — the pure half.
 *
 * Contacts are keyed by email, so exact duplicates cannot exist; one human
 * with `jane@acme.com` and `jane@gmail.com` is two documents, with tags,
 * deals, tasks and a timeline split between them. A merge folds the second
 * into the first: the SURVIVOR keeps its address as the identity, the MERGED
 * record's address becomes an alternate on it, and every field is combined
 * by one rule the dialog can show before the write happens.
 *
 * ## The rule
 *
 *  - A scalar — a name, a phone, a title, a stage, an owner — is the
 *    survivor's where the survivor has one, and fills from the merged record
 *    where the survivor is empty. Nothing the survivor holds is overwritten.
 *  - A list — tags, campaign filings, the timeline, the sites that captured
 *    the person, the forms, the companies — is the UNION, deduplicated and
 *    bounded where the write paths bound it.
 *  - A figure that counts something — orders, lifetime value, refunds — is
 *    the SUM: two records of one person's purchases are one person's
 *    purchases. A "first" is the earlier, a "last" is the later.
 *  - Notes are appended, survivor first: a note is a list of sentences, and
 *    dropping the merged record's would be the one silent loss in a merge
 *    that is otherwise lossless.
 *  - A recorded REFUSAL of marketing mail on either record stands on the
 *    survivor. The merge asserts the two are one person, and that person
 *    said no.
 *
 * Applied per holder: each group's facet on the merged record is folded
 * into the same group's facet on the survivor, and a group only the merged
 * record had comes across whole. No holder's records reach another holder's
 * facet, which is the guarantee the facet shape exists for.
 *
 * ## Why this is a plan and not a write
 *
 * The console shows the two records side by side and says which value wins
 * before anything is committed; the server performs the write. Both read
 * this function, so the preview cannot show one outcome and the write land
 * another. The plan is plain values — no sentinels — so it can be rendered,
 * and it is shaped for a merge-`set`, which deep-merges the facet map one
 * holder at a time and replaces an array whole: exactly the two behaviors
 * the rule above needs.
 */

import {
  CONTACT_ALTERNATE_EMAILS_CAP,
  CONTACT_ALTERNATE_EMAILS_FIELD,
  CONTACT_FACETS_FIELD,
  CONTACT_FORM_IDS_CAP,
  CONTACT_FORM_IDS_FIELD,
  CONTACT_INTERACTIONS_CAP,
  type ContactFacet,
  type ContactInteraction,
  contactDisplayName,
  contactEmails,
  normalizeContactEmail,
  readContactFacet,
} from './contacts'
import { CONTACT_COMPANY_IDS_FIELD, CONTACT_LIFECYCLE_STAGE_LABELS } from './crm'
import { MARKETING_CONSENT_BY_HOST_FIELD } from './marketing-consent'
import { nameSearchFields } from './name-search'

/** The tags cap every writer applies, so a union cannot exceed it. */
const TAGS_CAP = 20
/** The notes cap the record page applies to its About box. */
const NOTES_CAP = 5000

/** Facet figures that add up: two records of one buyer are one buyer. */
const SUM_FIELDS = [
  'ltvCents',
  'ordersCount',
  'refundedCents',
  'refundedOrdersCount',
] as const
/** Facet instants where the later one is the truth. */
const LATEST_FIELDS = [
  'lastPurchaseAtMs',
  'lastRefundAtMs',
  'lastEmailEngagementAtMs',
] as const
/** Facet instants where the earlier one is the truth. */
const EARLIEST_FIELDS = ['firstPurchaseAtMs'] as const

export interface ContactMergePlan {
  /**
   * What the survivor becomes, as a merge-`set` payload: every derived
   * field with its full value, and only the groups the merged record held
   * under `facets`. Plain values throughout — the writer adds its own
   * `updatedAt`.
   */
  survivor: Record<string, unknown>
  /** Every address the survivor answers to afterwards, primary first. */
  emails: string[]
  /** The merged record's addresses — what its leads and index entries are keyed by. */
  mergedEmails: string[]
  /**
   * The companies that lose a contact: those BOTH records were filed under,
   * which counted two people and now count one. A company only one record
   * named keeps its count — the survivor still names it.
   */
  companyCounts: Array<{ companyId: string; delta: -1 }>
  /** The union of both records' scope tokens — who may read the survivor. */
  visibleTo: string[]
}

type Doc = Record<string, unknown>

/** Whether a value counts as "nothing here" for the fill rule. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : []
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The union of two string lists, first list's order first, deduplicated. */
function union(a: unknown, b: unknown, cap = Number.POSITIVE_INFINITY): string[] {
  return [...new Set([...strings(a), ...strings(b)])].slice(0, cap)
}

/** Survivor's value where it has one, the merged record's otherwise. */
function fill<T>(survivor: T, merged: T): T {
  return isEmpty(survivor) ? merged : survivor
}

/** Notes appended, survivor first, one blank line between, bounded. */
function joinNotes(survivor: unknown, merged: unknown): string {
  const a = text(survivor).trim()
  const b = text(merged).trim()
  if (!b || a === b) return a
  if (!a) return b
  return `${a}\n\n${b}`.slice(0, NOTES_CAP)
}

/** What makes two timeline entries the same event. */
function interactionKey(entry: ContactInteraction): string {
  return [entry.type, entry.refId ?? '', entry.atMs, entry.hostId ?? ''].join('|')
}

/**
 * Both timelines as one: deduplicated by event, newest first, and capped
 * the way every capture caps it — so a merge of two full timelines keeps
 * the fifty most recent visits rather than growing the document past what
 * a capture may write.
 */
export function mergeInteractions(
  survivor: readonly ContactInteraction[] | undefined,
  merged: readonly ContactInteraction[] | undefined,
): ContactInteraction[] {
  const seen = new Set<string>()
  const out: ContactInteraction[] = []
  for (const entry of [...(survivor ?? []), ...(merged ?? [])]) {
    if (!entry || typeof entry !== 'object') continue
    const key = interactionKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
    .sort((a, b) => (number(b.atMs) ?? 0) - (number(a.atMs) ?? 0))
    .slice(0, CONTACT_INTERACTIONS_CAP)
}

/** The custom values per key: the survivor's where set, the merged record's otherwise. */
function mergeCustom(survivor: unknown, merged: unknown): Record<string, unknown> {
  const a = (survivor && typeof survivor === 'object' ? survivor : {}) as Doc
  const b = (merged && typeof merged === 'object' ? merged : {}) as Doc
  const out: Doc = { ...b }
  for (const [key, value] of Object.entries(a)) {
    if (!isEmpty(value) || !(key in b)) out[key] = value
  }
  return out
}

/**
 * One holder's facet after the merge.
 *
 * `survivor` is that holder's facet on the surviving record — possibly
 * absent, when only the merged record was held by this group — and `merged`
 * the same holder's facet on the record being folded in.
 */
export function mergeContactFacet(
  survivor: Doc | undefined,
  merged: Doc | undefined,
): Doc {
  if (!merged) return { ...(survivor ?? {}) }
  if (!survivor) return { ...merged }
  const out: Doc = { ...merged }
  // Every scalar the survivor holds stands; every one it lacks fills.
  for (const [key, value] of Object.entries(survivor)) {
    out[key] = fill(value, merged[key])
  }
  const a = survivor as unknown as ContactFacet
  const b = merged as unknown as ContactFacet
  out['sources'] = { ...(b.sources ?? {}), ...(a.sources ?? {}) }
  out['interactions'] = mergeInteractions(a.interactions, b.interactions)
  const tags = union(a.tags, b.tags, TAGS_CAP)
  if (tags.length) out['tags'] = tags
  const campaignIds = union(a.campaignIds, b.campaignIds)
  if (campaignIds.length) out['campaignIds'] = campaignIds
  const notes = joinNotes(a.notes, b.notes)
  if (notes) out['notes'] = notes
  if (!isEmpty(a.custom) || !isEmpty(b.custom)) {
    out['custom'] = mergeCustom(a.custom, b.custom)
  }
  for (const field of SUM_FIELDS) {
    const left = number(a[field])
    const right = number(b[field])
    if (left !== null || right !== null) out[field] = (left ?? 0) + (right ?? 0)
  }
  for (const field of LATEST_FIELDS) {
    const left = number(a[field])
    const right = number(b[field])
    if (left !== null || right !== null) {
      out[field] = Math.max(left ?? 0, right ?? 0)
    }
  }
  for (const field of EARLIEST_FIELDS) {
    const left = number(a[field])
    const right = number(b[field])
    if (left !== null && right !== null) out[field] = Math.min(left, right)
    else if (left !== null || right !== null) out[field] = left ?? right
  }
  return out
}

function facetsOf(doc: Doc): Record<string, Doc> {
  const facets = doc[CONTACT_FACETS_FIELD]
  return facets && typeof facets === 'object' && !Array.isArray(facets)
    ? (facets as Record<string, Doc>)
    : {}
}

function mapOf(value: unknown): Doc {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Doc)
    : {}
}

/**
 * The plan for folding `merged` into `survivor`.
 *
 * Both are the stored documents as read. The survivor's `email` is the
 * identity that stands; the merged record's becomes an alternate.
 */
export function planContactMerge(survivor: Doc, merged: Doc): ContactMergePlan {
  const survivorEmail = normalizeContactEmail(survivor['email']) ?? ''
  const mergedEmails = contactEmails(merged)
  const alternates = [
    ...new Set([
      ...strings(survivor[CONTACT_ALTERNATE_EMAILS_FIELD]),
      ...mergedEmails,
    ]),
  ]
    .filter((email) => email !== survivorEmail)
    .slice(0, CONTACT_ALTERNATE_EMAILS_CAP)

  const out: Doc = {
    [CONTACT_ALTERNATE_EMAILS_FIELD]: alternates,
  }
  // The canonical name, with its search keys, only when the survivor had none.
  const survivorName = text(survivor['name']).trim()
  const mergedName = text(merged['name']).trim()
  if (!survivorName && mergedName) Object.assign(out, nameSearchFields(mergedName))
  // The search echoes, on the same fill rule.
  for (const key of ['phone', 'companyName'] as const) {
    if (isEmpty(survivor[key]) && !isEmpty(merged[key])) out[key] = merged[key]
  }
  // The shared lists: who may read the row, who captured it, which forms and
  // companies it is filed under.
  const visibleTo = union(survivor['visibleTo'], merged['visibleTo'])
  out['visibleTo'] = visibleTo
  const capturedBy = union(survivor['capturedByHostIds'], merged['capturedByHostIds'])
  if (capturedBy.length) out['capturedByHostIds'] = capturedBy
  const formIds = union(
    survivor[CONTACT_FORM_IDS_FIELD],
    merged[CONTACT_FORM_IDS_FIELD],
    CONTACT_FORM_IDS_CAP,
  )
  if (formIds.length) out[CONTACT_FORM_IDS_FIELD] = formIds
  const survivorCompanies = strings(survivor[CONTACT_COMPANY_IDS_FIELD])
  const mergedCompanies = strings(merged[CONTACT_COMPANY_IDS_FIELD])
  const companyIds = [...new Set([...survivorCompanies, ...mergedCompanies])]
  if (companyIds.length) out[CONTACT_COMPANY_IDS_FIELD] = companyIds
  const companyCounts = survivorCompanies
    .filter((id) => mergedCompanies.includes(id))
    .map((companyId) => ({ companyId, delta: -1 as const }))
  // The organization-level fields the REST API reads and writes.
  const tags = union(survivor['tags'], merged['tags'])
  if (tags.length) out['tags'] = tags
  const notes = joinNotes(survivor['notes'], merged['notes'])
  if (notes) out['notes'] = notes
  if (!isEmpty(survivor['custom']) || !isEmpty(merged['custom'])) {
    out['custom'] = mergeCustom(survivor['custom'], merged['custom'])
  }
  // Consent: a grant fills where the survivor has none for that site; a
  // refusal on either record stands.
  const consentByHost = {
    ...mapOf(merged[MARKETING_CONSENT_BY_HOST_FIELD]),
    ...mapOf(survivor[MARKETING_CONSENT_BY_HOST_FIELD]),
  }
  if (Object.keys(consentByHost).length) {
    out[MARKETING_CONSENT_BY_HOST_FIELD] = consentByHost
  }
  if (survivor['marketingConsent'] === false || merged['marketingConsent'] === false) {
    out['marketingConsent'] = false
  } else if (survivor['marketingConsent'] === true || merged['marketingConsent'] === true) {
    out['marketingConsent'] = true
  }
  // Each holder's facet — only the groups the merged record held need a write.
  const survivorFacets = facetsOf(survivor)
  const mergedFacets = facetsOf(merged)
  const facets: Record<string, Doc> = {}
  for (const [groupId, facet] of Object.entries(mergedFacets)) {
    facets[groupId] = mergeContactFacet(survivorFacets[groupId], facet)
  }
  if (Object.keys(facets).length) out[CONTACT_FACETS_FIELD] = facets

  return {
    survivor: out,
    emails: [survivorEmail, ...alternates].filter(Boolean),
    mergedEmails,
    companyCounts,
    visibleTo,
  }
}

/** Where a previewed value comes from. */
export type ContactMergeSource = 'survivor' | 'merged' | 'both' | 'none'

/** One line of the side-by-side the dialog shows. */
export interface ContactMergePreviewRow {
  key: string
  label: string
  /** The surviving record's value, as text. */
  survivor: string
  /** The merged record's value, as text. */
  merged: string
  /** What the survivor carries afterwards. */
  result: string
  from: ContactMergeSource
}

export interface ContactMergePreviewOptions {
  /** The owner's display name for a uid; the uid itself when absent. */
  memberName?: (uid: string) => string
}

function addressLine(value: unknown): string {
  const address = mapOf(value)
  return ['line1', 'line2', 'city', 'state', 'postalCode', 'country']
    .map((key) => text(address[key]).trim())
    .filter(Boolean)
    .join(', ')
}

function sourceOf(survivor: string, merged: string, result: string): ContactMergeSource {
  if (!result) return 'none'
  if (survivor && merged && survivor !== merged && result !== survivor && result !== merged) {
    return 'both'
  }
  if (result === survivor && survivor === merged) return 'both'
  return result === survivor ? 'survivor' : 'merged'
}

/**
 * The merge as the viewing group would see it, field by field.
 *
 * Reads through ONE group's facet, the way the record page does, so a
 * holder previewing a merge sees its own values and never another holder's.
 * Every row carries the survivor's value, the merged record's, and the
 * result the plan would write, so the dialog is a rendering and not a second
 * opinion.
 */
export function contactMergePreview(
  survivor: Doc,
  merged: Doc,
  groupId: string,
  options: ContactMergePreviewOptions = {},
): ContactMergePreviewRow[] {
  const plan = planContactMerge(survivor, merged)
  const after: Doc = {
    ...survivor,
    ...plan.survivor,
    [CONTACT_FACETS_FIELD]: {
      ...facetsOf(survivor),
      ...mapOf(plan.survivor[CONTACT_FACETS_FIELD]),
    },
  }
  const a = readContactFacet(survivor, groupId)
  const b = readContactFacet(merged, groupId)
  const c = readContactFacet(after, groupId)
  const memberName = options.memberName ?? ((uid: string) => uid)
  const stage = (value: unknown) =>
    typeof value === 'string' && value in CONTACT_LIFECYCLE_STAGE_LABELS
      ? CONTACT_LIFECYCLE_STAGE_LABELS[value as keyof typeof CONTACT_LIFECYCLE_STAGE_LABELS]
      : ''
  const owner = (value: unknown) => (text(value) ? memberName(text(value)) : '')
  const list = (value: unknown) => strings(value).join(', ')
  const money = (facet: ContactFacet) =>
    facet.ordersCount
      ? `${facet.ordersCount} · $${((facet.ltvCents ?? 0) / 100).toFixed(2)}`
      : ''
  const row = (
    key: string,
    label: string,
    left: string,
    right: string,
    result: string,
  ): ContactMergePreviewRow => ({
    key,
    label,
    survivor: left,
    merged: right,
    result,
    from: sourceOf(left, right, result),
  })
  const rows: ContactMergePreviewRow[] = [
    row(
      'name',
      'Name',
      contactDisplayName(survivor, groupId),
      contactDisplayName(merged, groupId),
      contactDisplayName(after, groupId),
    ),
    row(
      'email',
      'Email',
      contactEmails(survivor).join(', '),
      contactEmails(merged).join(', '),
      plan.emails.join(', '),
    ),
    row('phone', 'Phone', text(a.phone), text(b.phone), text(c.phone)),
    row('jobTitle', 'Job title', text(a.jobTitle), text(b.jobTitle), text(c.jobTitle)),
    row(
      'company',
      'Company',
      text(a.companyName),
      text(b.companyName),
      text(c.companyName),
    ),
    row(
      'lifecycleStage',
      'Stage',
      stage(a.lifecycleStage),
      stage(b.lifecycleStage),
      stage(c.lifecycleStage),
    ),
    row('owner', 'Owner', owner(a.ownerUid), owner(b.ownerUid), owner(c.ownerUid)),
    row('tags', 'Tags', list(a.tags), list(b.tags), list(c.tags)),
    row('notes', 'Notes', text(a.notes), text(b.notes), text(c.notes)),
    row(
      'address',
      'Address',
      addressLine(a.address),
      addressLine(b.address),
      addressLine(c.address),
    ),
    row('orders', 'Orders', money(a), money(b), money(c)),
    row(
      'timeline',
      'Timeline entries',
      a.interactions.length ? String(a.interactions.length) : '',
      b.interactions.length ? String(b.interactions.length) : '',
      c.interactions.length ? String(c.interactions.length) : '',
    ),
  ]
  const customKeys = [
    ...new Set([...Object.keys(mapOf(a.custom)), ...Object.keys(mapOf(b.custom))]),
  ].sort()
  for (const key of customKeys) {
    const show = (facet: ContactFacet) => {
      const value = mapOf(facet.custom)[key]
      return value === null || value === undefined ? '' : String(value)
    }
    rows.push(row(`custom.${key}`, key, show(a), show(b), show(c)))
  }
  return rows
}
