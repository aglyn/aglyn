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
 * Contacts CRM v1 (AGL-197): one contact per normalized email per host,
 * fed by the four existing capture silos (forms, members, orders,
 * bookings). Pure data module — the admin-SDK upsert lives in
 * `@aglyn/tenant-data-admin` (`upsertHostContact`) and the console reads
 * client-side under the host-admin rules.
 */

import type { AglynPostalAddress } from '../foundation'
import { consentGroupForHost } from './consent-groups'
import type { ContactCustomValue, ContactLifecycleStage } from './crm'
import {
  CAPTURED_BY_HOST_FIELD,
  MARKETING_CONSENT_BY_HOST_FIELD,
  MARKETING_CONSENT_FIELD,
  readMarketingBasis,
  type MarketingBasis,
} from './marketing-consent'

export type ContactSource =
  | 'form'
  | 'member'
  | 'order'
  | 'booking'
  | 'newsletter'
  // AGL-2276: `POST /v1/contacts`. A first-class source rather than a blank
  // one, because "where did this person come from" is the question the
  // console's source filter exists to answer, and an integration importing a
  // CRM is a different answer from a visitor filling in a form. Adding it to
  // the union is what makes `SOURCE_LABELS` and the filter cover it — a raw
  // string written past the type would render as `api` and match no filter.
  | 'api'
  // CRM v2 (AGL-2595): the two doors that are not a capture at all. A person
  // typed into the console by a member of the team, and a person who arrived
  // in a file. Both are first-class for the reason `api` is — a merchant
  // asking "who did we add ourselves" and "who came from the spreadsheet" is
  // asking the source filter, and a source the union does not name is one it
  // cannot answer for.
  | 'manual'
  | 'import'

/**
 * How a capture source reads on screen.
 *
 * Typed `Record<ContactSource, string>` so a source added to the union cannot
 * ship without a label, and kept beside the union rather than in the console
 * that first needed it: the contacts filter, the campaign audience and the
 * dynamic-list rule editor all name the same six sources, and three copies of
 * this map is three places for `order` to stop reading as "Customer".
 */
export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  form: 'Form',
  member: 'Member',
  order: 'Customer',
  booking: 'Booking',
  newsletter: 'Newsletter',
  api: 'API',
  manual: 'Added by hand',
  import: 'Import',
}

export interface ContactInteraction {
  type: ContactSource
  /** Source doc id (formSubmissions/siteMembers/orders/bookings). */
  refId?: string
  /** Epoch millis — Timestamps don't serialize into arrays cleanly. */
  atMs: number
  summary?: string
  /**
   * WHICH SITE this interaction happened on.
   *
   * A contact document is shared by every site in the org — one human who
   * touched two sites is one person, and splitting them into two rows would
   * bill the org twice for the same address and lose the dedupe that makes a
   * multi-brand account worth having. But the HISTORY on that shared row is
   * not shared: a booking made on one client's site is that client's, and a
   * timeline that cannot be split by site shows an agency's client the other
   * clients' activity.
   *
   * Optional because a row written before this field existed carries none,
   * and an interaction whose site is unknown must read as unattributed rather
   * than be assigned to whoever is looking. Nothing may infer it from the
   * contact's own capture attribution: `capturedByHostIds` says which sites
   * met this person, not which of them produced any particular visit.
   */
  hostId?: string
  /**
   * THE ENTRY POINT: the form this capture came in through.
   *
   * `sources` answers "what KIND of surface met this person" and is what the
   * console's capture filter reads; it cannot answer "which form", because
   * every form on the site sets the same `form` flag. The id rather than the
   * name, for the reason the submission carries the id: a form's caption is
   * editable and a stored name splits the moment somebody renames it.
   *
   * Beside {@link refId} rather than derived from it. The submission the
   * interaction names does carry the form, but reading it back would be a
   * document read per row of a timeline the console renders straight out of
   * the contact.
   */
  formId?: string
  /**
   * THE ENTRY POINT: the page the person was on when this happened.
   *
   * The same `path` the submission stores. It belongs on the interaction and
   * not on the contact, because a person who came in through the pricing page
   * and returned through a blog post has two entry points and one row —
   * a single field at the top would keep whichever capture wrote last.
   */
  path?: string
}

/** `orgs/{orgId}/contacts/{contactId}` doc shape. */
export interface HostContact {
  /** Normalized (trimmed, lowercased) email — the dedupe key. */
  email: string
  name?: string
  sources: Partial<Record<ContactSource, true>>
  /** Newest-first, capped — the profile timeline. */
  interactions: ContactInteraction[]
  tags?: string[]
  notes?: string
  /**
   * Every site that has captured this person, in no order.
   *
   * An ARRAY and a top-level field, because this is the one attribution that
   * has to survive being a QUERY: "everyone captured on A, B or C" is an
   * audience, and `array-contains-any` is what answers it. The per-interaction
   * host says which visit belonged to whom; this says which sites have a
   * relationship at all, and only the second shape can be filtered on in
   * Firestore.
   *
   * Grows by `arrayUnion` on every capture, including the ones that merge
   * onto an existing row — which is exactly what the create-only `hostId`
   * beside it could never do.
   */
  capturedByHostIds?: string[]
}

/** Timeline cap: keeps the doc small; older interactions age out. */
export const CONTACT_INTERACTIONS_CAP = 50

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Normalized dedupe key, or null when the input isn't a usable email. */
export function normalizeContactEmail(input: unknown): string | null {
  const email = String(input ?? '')
    .trim()
    .toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null
}

/**
 * First usable email in a free-form form-submission fields map — forms
 * don't guarantee a canonical email field, so prefer keys that look like
 * email fields before falling back to any email-shaped value.
 */
export function extractEmailFromFields(
  fields: Record<string, unknown> | null | undefined,
): string | null {
  const entries = Object.entries(fields ?? {})
  const preferred = entries.find(([key]) => /email/i.test(key))
  const fromPreferred = normalizeContactEmail(preferred?.[1])
  if (fromPreferred) return fromPreferred
  for (const [, value] of entries) {
    const email = normalizeContactEmail(value)
    if (email) return email
  }
  return null
}

/**
 * Merges a new interaction into a contact: source flag set, interaction
 * prepended, timeline capped. Pure — the caller persists the result.
 */
export function mergeContactInteraction(
  existing: Pick<HostContact, 'sources' | 'interactions'> & {
    name?: string
  },
  update: { source: ContactSource; interaction: ContactInteraction; name?: string },
): Pick<HostContact, 'sources' | 'interactions'> & { name?: string } {
  return {
    // Existing names win — a later anonymous form shouldn't blank a name.
    name: existing.name || update.name,
    sources: { ...existing.sources, [update.source]: true as const },
    interactions: [update.interaction, ...(existing.interactions ?? [])].slice(
      0,
      CONTACT_INTERACTIONS_CAP,
    ),
  }
}

/**
 * THE PER-HOLDER FACET on a shared contact document.
 *
 * ## What is shared and what is not
 *
 * One human who touched two sites is ONE document. That is not a compromise:
 * it is the dedupe the shared address book exists for, it is what keeps a
 * bounce and a suppression describing one person, and it is what makes a
 * multi-brand account bill once for one human instead of once per site. A
 * document per host would push an agency toward twelve separate accounts and
 * throw the whole advantage away.
 *
 * But almost nothing ON that document is legitimately shared.
 *
 *  - **SHARED IDENTITY** — `email`, and the canonical `name`. One human, one
 *    identity. This is the only part two unrelated businesses may both see,
 *    and it is the minimum that makes them one row.
 *  - **PER-HOLDER FACET** — everything in this interface. A note, a tag, a
 *    call log and a lifetime value are the HOLDER's own business records.
 *    Host A's note about a customer is Host A's; a competitor sharing the
 *    platform must not read it, and while these lived at the top of the
 *    document every site in the org could.
 *  - **CONSENT AND VISIBILITY** — per declared group, decided by
 *    `marketing-consent.ts` and by `visibleTo`.
 *
 * ## Keyed by GROUP, not by host
 *
 * A business that declared three sites to be one sender is one CRM: a note
 * written on the shop belongs beside the booking made on the booking page,
 * because one team keeps both. Across groups, never — and an undeclared site
 * is a group of one, so the agency case is isolated with nothing configured.
 *
 * ## Commercial figures are per-facet, and that is not a billing change
 *
 * `ltvCents` and `ordersCount` answer "what is this person worth to ME". Two
 * unrelated merchants who both sell to one person have two different answers
 * and neither is entitled to the other's. Billing counts DOCUMENTS, and there
 * is still one document, so a person held by two hosts stays one billable
 * contact.
 */
export interface ContactFacet {
  /**
   * This holder's display name for the person, overriding the canonical one.
   *
   * The canonical `name` is shared and mutable, so without this a rename on
   * one site changes what an unrelated business sees in its own CRM — two
   * companies that do not know each other exist editing each other's records.
   * The override is written by whoever edits the name from their own console;
   * the canonical field stays as the identity of last resort, for a holder
   * that has never set one.
   */
  name?: string
  /** Which capture surfaces THIS holder saw the person through. */
  sources: Partial<Record<ContactSource, true>>
  /** THIS holder's timeline, newest-first and capped. */
  interactions: ContactInteraction[]
  /** THIS holder's tags. */
  tags?: string[]
  /** THIS holder's notes. */
  notes?: string
  /**
   * The campaigns THIS holder has filed the person under.
   *
   * A label on the CRM record, not an audience: who a campaign's mail reaches
   * is decided by the campaign's lists and by each send's own picker, and
   * nothing in the send path reads this. It answers "who did we put in the
   * spring push", which is a question about the holder's own working set.
   *
   * Per-holder for the reason the notes are: two unrelated businesses sharing
   * one row must not read each other's segmentation of a person they both
   * know. See `campaign-membership.ts` for the field and the path.
   */
  campaignIds?: string[]
  /** Gross of fees and refunds — see `upsertHostContact`. */
  ltvCents?: number
  ordersCount?: number
  lastPurchaseAtMs?: number
  firstPurchaseAtMs?: number
  refundedCents?: number
  refundedOrdersCount?: number
  lastRefundAtMs?: number
  /*
   * CRM v2 (AGL-2595): the profile a sales team keeps on a person.
   *
   * Per-holder like everything above them, and for the same reason: a phone
   * number, a job title, an owner and a lifecycle stage are one business's
   * knowledge of a person, and two unrelated businesses sharing the row must
   * not read each other's. `companyId` points at a company document in the
   * same scope, never at the org's whole company list. `custom` is keyed by
   * `ContactFieldDefinition.key`, so a holder's field definitions and a
   * holder's values live under the same group and cannot be joined across
   * one.
   *
   * ⛔ None of these reach the org view. `ORG_CONTACT_FIELDS` is an
   * allow-list, and the org-view spec seeds every one of these with a
   * sentinel and proves it never surfaces.
   */
  /** E.164 — `normalizePhone` before writing. */
  phone?: string
  jobTitle?: string
  /** `orgs/{orgId}/companies/{companyId}`, in this holder's scope. */
  companyId?: string
  address?: AglynPostalAddress | null
  /** The team member responsible for the relationship. */
  ownerUid?: string
  lifecycleStage?: ContactLifecycleStage
  /** Custom field values, keyed by `ContactFieldDefinition.key`. */
  custom?: Record<string, ContactCustomValue>
}

/** The map field holding the facets: `{ [groupId]: ContactFacet }`. */
export const CONTACT_FACETS_FIELD = 'facets'

/**
 * The facet one group holds, or an empty one.
 *
 * `map[groupId]` — a lookup, not a search, for the reason the consent map is
 * shaped the same way: there is no expression of this form that returns
 * another holder's notes.
 *
 * An absent facet reads EMPTY rather than falling back to the top-level
 * fields. A fallback would hand every holder in the org the fields the
 * pre-facet document carried at its top, which is the disclosure this shape
 * exists to end; the migration moves them into the capturing group's facet
 * instead.
 */
export function readContactFacet(
  contact: Record<string, unknown> | null | undefined,
  groupId: string,
): ContactFacet {
  const facets = (contact ?? {})[CONTACT_FACETS_FIELD]
  const facet =
    facets && typeof facets === 'object' && !Array.isArray(facets)
      ? (facets as Record<string, unknown>)[groupId]
      : undefined
  if (!facet || typeof facet !== 'object' || Array.isArray(facet)) {
    return { sources: {}, interactions: [] }
  }
  const value = facet as Record<string, unknown>
  return {
    ...(value as unknown as ContactFacet),
    sources: (value['sources'] ?? {}) as ContactFacet['sources'],
    interactions: Array.isArray(value['interactions'])
      ? (value['interactions'] as ContactInteraction[])
      : [],
  }
}

/** The dotted Firestore path to one field of one holder's facet. */
export function contactFacetPath(groupId: string, field: string): string {
  if (!groupId) throw new Error('a contact facet must name a holder')
  return `${CONTACT_FACETS_FIELD}.${groupId}.${field}`
}

/**
 * The name a given holder should SEE for this person.
 *
 * Their own override first, the canonical identity second. Nothing falls
 * through to another holder's override: that would be one business's edit
 * showing up in another's CRM, which is the thing the override exists to
 * prevent.
 */
export function contactDisplayName(
  contact: Record<string, unknown> | null | undefined,
  groupId: string,
): string {
  const facet = readContactFacet(contact, groupId)
  if (facet.name) return facet.name
  const canonical = (contact ?? {})['name']
  return typeof canonical === 'string' ? canonical : ''
}

/**
 * Every group that holds this contact — the reference count behind a detach.
 *
 * Read from `visibleTo` rather than from the facet map, because `visibleTo`
 * is what both enforcement layers actually evaluate: a holder that can still
 * READ the row is still holding it whether or not they ever wrote a note. A
 * count taken from the facets would drop a holder who has one and no facet
 * and leave them able to see a document nothing believes they hold.
 */
export function contactHolderTokens(
  contact: Record<string, unknown> | null | undefined,
): string[] {
  const visibleTo = (contact ?? {})['visibleTo']
  return Array.isArray(visibleTo)
    ? visibleTo.filter((token): token is string => typeof token === 'string')
    : []
}

/** What a holder letting go of a contact should do to the document. */
export type ContactDetach =
  | {
      /** Nobody else holds it. Delete the document. */
      action: 'delete'
    }
  | {
      /** Other holders remain. Drop this one's half. */
      action: 'detach'
      /**
       * Field-level removals, as a patch. Dotted paths so the OTHER holders'
       * facets and consent entries are untouched — a nested write would
       * replace the whole map and take every other holder's records with it.
       */
      remove: string[]
      /** Scope tokens to pull out of `visibleTo`. */
      removeTokens: string[]
      /** Host ids to pull out of the capture attribution. */
      removeHostIds: string[]
    }

/**
 * DELETE IS A DETACH.
 *
 * One holder removing a contact from their own CRM must not destroy another
 * holder's relationship with that person: they have their own notes, their
 * own order history and their own consent, none of which the deleting holder
 * ever had a claim on. So a delete drops the deleting group's facet, its
 * consent entries, its capture attribution and its scope tokens — and the
 * DOCUMENT dies only when the last holder lets go.
 *
 * ⛔ This is NOT the erasure path. A privacy erasure removes the person
 * everywhere regardless of how many holders remain, and routing it through
 * reference counting would turn a lawful erasure into a partial one — the same
 * absent-versus-invisible defect this area keeps hitting, in the one place
 * where getting it wrong is a legal failure rather than a bug. Erasure calls
 * the document delete directly and must never consult this function.
 *
 * @param group the holder letting go, with every site it covers.
 */
export function planContactDetach(
  contact: Record<string, unknown> | null | undefined,
  group: { groupId: string; hostIds: readonly string[] },
): ContactDetach {
  const held = contactHolderTokens(contact)
  const leaving = new Set(group.hostIds.map((id) => `host:${id}`))
  /*
   * A remaining holder is a token naming somebody else. `'org'` counts as one
   * and blocks the delete on purpose: an org-wide row is held by every site
   * in the account, so one site letting go leaves it held. Narrowing it would
   * be a scope decision, and a delete button is not where that belongs.
   */
  const remaining = held.filter((token) => !leaving.has(token))
  if (!remaining.length) return { action: 'delete' }
  return {
    action: 'detach',
    remove: [
      `${CONTACT_FACETS_FIELD}.${group.groupId}`,
      ...group.hostIds.map((id) => `marketingConsentByHost.${id}`),
    ],
    removeTokens: [...leaving],
    removeHostIds: [...group.hostIds],
  }
}

/**
 * The interactions one group of sites may see on a shared contact.
 *
 * An interaction with NO host is shown to everyone: it predates the
 * attribution, so hiding it would empty every existing timeline, and it is
 * already visible to anyone who can read the row. An interaction that names a
 * site is shown only to that site's own group — the agency case, where one
 * client must not read another client's bookings off a person they both know.
 */
export function interactionsForGroup(
  interactions: readonly ContactInteraction[] | undefined,
  hostIds: readonly string[],
): ContactInteraction[] {
  const reach = new Set(hostIds)
  return (interactions ?? []).filter(
    (interaction) => !interaction.hostId || reach.has(interaction.hostId),
  )
}

/** `orgs/{orgId}/contactSegments/{id}` — a saved audience filter. */
export interface ContactSegment {
  name: string
  /** Match contacts sharing at least one tag (empty = any). */
  tags?: string[]
  /** Match contacts with at least one of these sources (empty = any). */
  sources?: ContactSource[]
}

/** Segment matching (AGL-199): AND across filter kinds, OR within one. */
export function contactMatchesSegment(
  contact: Pick<HostContact, 'tags' | 'sources'>,
  segment: Pick<ContactSegment, 'tags' | 'sources'>,
): boolean {
  if (segment.tags?.length) {
    const contactTags = new Set(
      (contact.tags ?? []).map((tag) => tag.toLowerCase()),
    )
    if (!segment.tags.some((tag) => contactTags.has(tag.toLowerCase()))) {
      return false
    }
  }
  if (segment.sources?.length) {
    if (!segment.sources.some((source) => contact.sources?.[source])) {
      return false
    }
  }
  return true
}

/*==========================================
 * THE ORG-LEVEL VIEW: the complement of the facet reader above.
 *
 * {@link readContactFacet} answers "what does THIS holder know about this
 * person". Everything below answers the question no host page can:
 *
 *   who does this ORGANIZATION know, and which of its sites know them.
 *
 * That question is the entire justification for one shared document. Dedupe,
 * suppression and honest billing all rest on one human being one row, and
 * with no surface that shows the deduped person the model's benefit is
 * invisible and the billing unit — unique people per org — looks arbitrary.
 *
 * ## The org view crosses the host boundary, so it carries LESS, not more
 *
 * It is the one place in the product designed to read across holders, which
 * makes it the one place where a careless field re-creates the disclosure the
 * facets exist to end. So the projection is an ALLOW-LIST
 * ({@link ORG_CONTACT_FIELDS}) rather than an omission: identity, capture
 * attribution and consent state. Notes, tags, timelines, call logs and
 * commercial figures are the holder's own business records and are not read
 * here at all — not summarized, not counted, not indicated by their absence.
 *
 * An allow-list rather than a `delete facets` is the load-bearing choice. A
 * subtraction is correct only for as long as somebody remembers to extend it,
 * and a field added to {@link ContactFacet} tomorrow would ride out through a
 * subtraction and be caught by an allow-list.
 *
 * ## The NAME is the canonical one, never a holder's override
 *
 * {@link contactDisplayName} prefers the viewing group's own override, which
 * is right on a host page and wrong here: an override is a name ONE business
 * chose, and rendering it at org level shows an agency the label its client
 * picked. The shared identity is what every holder already sees, so it is the
 * only name that belongs to the org.
 *=========================================*/

/**
 * Every field of a contact document the org view may read.
 *
 * Stated as a value so it can be asserted against — see the org-view spec,
 * which seeds each facet field with a sentinel and proves none of them
 * reaches a row.
 */
export const ORG_CONTACT_FIELDS = [
  'email',
  'name',
  CAPTURED_BY_HOST_FIELD,
  MARKETING_CONSENT_BY_HOST_FIELD,
  MARKETING_CONSENT_FIELD,
] as const

/**
 * What one site's relationship with one person amounts to, at org level.
 *
 * Consent is per (contact, host-or-group) and there is no expression that
 * returns another controller's grant, so a row cannot carry one consent
 * verdict. It carries one PER CAPTURING SITE, each naming the controller it
 * was read for — a bare "consented" with nobody attached would be exactly the
 * confusion the per-brand model was built to prevent.
 */
export interface OrgContactHostConsent {
  /** The site this verdict answers about, and no other. */
  hostId: string
  /** The controller the basis runs to — the declared group, or the site. */
  groupId: string
  /**
   * The group's disclosed name, or `null` for a site that pools with nobody.
   *
   * `null` is not "unknown": it is the group of one, where the site's own
   * name is the disclosure and inventing a second would put a label in front
   * of a reader that nothing else uses.
   */
  groupName: string | null
  /** Whether the controller is a DECLARED group rather than the site alone. */
  declared: boolean
  /** `granted` | `declined` | `unrecorded` — never collapsed to a boolean. */
  basis: MarketingBasis
}

/** One person, as the organization may see them across all of its sites. */
export interface OrgContactRow {
  $id: string
  /** The dedupe key, and the reason two captures are one row. */
  email: string
  /** The SHARED identity. Never a holder's own override. */
  name: string
  /** Every site that has captured this person, sorted for a stable render. */
  capturedByHostIds: string[]
  /** One verdict per capturing site, in the same order. */
  consent: OrgContactHostConsent[]
}

/**
 * Every site that has captured this person.
 *
 * Sorted, because the array is maintained by `arrayUnion` and therefore
 * carries capture order, which is not an order anything should render: two
 * readers of the same row would see the sites in different places on the
 * screen depending on which site met the person first.
 */
export function contactCaptureHostIds(
  contact: Record<string, unknown> | null | undefined,
): string[] {
  const raw = (contact ?? {})[CAPTURED_BY_HOST_FIELD]
  if (!Array.isArray(raw)) return []
  return [
    ...new Set(
      raw
        .map((id) => String(id ?? '').trim())
        .filter((id): id is string => id !== ''),
    ),
  ].sort()
}

/**
 * One contact document, projected to what an ORG may see.
 *
 * @param org - the org document — the only input that can resolve a declared
 *   consent group, and required for that reason. Without it every site reads
 *   as a group of one, which understates the disclosure a person was given
 *   and is the safe direction to be wrong in.
 */
export function orgContactRow(
  contact: Record<string, unknown> | null | undefined,
  contactId: string,
  org: Record<string, unknown> | null | undefined,
): OrgContactRow {
  const record = contact ?? {}
  const capturedByHostIds = contactCaptureHostIds(record)
  return {
    $id: contactId,
    email: typeof record['email'] === 'string' ? record['email'] : '',
    name: typeof record['name'] === 'string' ? record['name'] : '',
    capturedByHostIds,
    consent: capturedByHostIds.map((hostId) => {
      /*
       * READ FOR THE SITE, one call per site. `readMarketingBasis` requires
       * the group it is being read for and has no default, so this cannot
       * accidentally report a grant that belongs to somebody else — the
       * argument is the guarantee, and passing the whole row through one
       * call would have had to invent a controller to ask about.
       */
      const group = consentGroupForHost(org, hostId)
      const { basis } = readMarketingBasis(record, group)
      return {
        hostId,
        groupId: group.groupId,
        groupName: group.name,
        declared: group.declared,
        basis,
      }
    }),
  }
}

/**
 * How a basis reads on screen.
 *
 * Three labels because there are three states. "Opted in" and "No record" are
 * not opposites and must never collapse into one negative: absence is the
 * commonest case by far — a record captured before the checkbox existed — and
 * showing it as a refusal would tell a merchant they may not mail somebody
 * who never said so.
 */
export const MARKETING_BASIS_LABELS: Record<MarketingBasis, string> = {
  granted: 'Opted in',
  declined: 'Opted out',
  unrecorded: 'No record',
}

/**
 * One consent verdict, WITH THE CONTROLLER IT RUNS TO, as one string.
 *
 * ⛔ There is no function here that returns a basis on its own, and that is
 * the point. A basis is per (person, controller): the same person can be
 * opted in to one brand in an org and opted out of another, so "consented"
 * with nobody attached is not a shortened truth, it is a different and false
 * claim — precisely the confusion the per-brand model was built to prevent.
 * Joining the two into a single value is what stops a caller rendering half
 * of it.
 *
 * The controller is the DECLARED GROUP when there is one, because that is who
 * the person was told they would hear from, and the site otherwise. A group
 * of one is named by the site, which is what the capture surface already
 * showed them.
 *
 * @param siteName - how this site reads — the caller resolves it, since the
 *   contact document holds ids and not names. An empty one falls back to the
 *   id: a site whose name cannot be resolved must still be NAMED, because
 *   dropping it would understate which brands hold a relationship.
 */
export function orgContactConsentLabel(
  entry: OrgContactHostConsent,
  siteName?: string,
): string {
  const controller = entry.declared
    ? (entry.groupName ?? entry.groupId)
    : siteName || entry.hostId
  return `${controller} · ${MARKETING_BASIS_LABELS[entry.basis]}`
}
