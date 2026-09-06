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
 * Companies (AGL-2597): the rules every surface that writes a company, or
 * links a contact to one, has to agree on.
 *
 * The console has three writers of the same association — the company page
 * linking a person, the contact page choosing a company, and the delete that
 * takes a company away from everybody — and they touch two fields that must
 * stay in step. Each rule lives here once, as a function of the document and
 * nothing else, so the three writers cannot drift and a spec can pin the rule
 * without mounting a card.
 */

import {
  type AglynPostalAddress,
  CONTACT_FACETS_FIELD,
  type CrmCompany,
  companyDomainForEmail,
  contactFacetPath,
  isBlankAddress,
  nameSearchFields,
  normalizeAddress,
  normalizeCompanyDomain,
  normalizePhone,
  readContactFacet,
} from '@aglyn/aglyn'
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  serverTimestamp,
} from 'firebase/firestore'

/**
 * The top-level field on a CONTACT naming every company it is linked to.
 *
 * The association proper is `facets.{groupId}.companyId` — one company per
 * holder, inside that holder's facet like the notes and the tags, and for the
 * same reason: which account a person belongs to is one business's knowledge
 * of them. But a facet path is per group, and Firestore cannot answer "every
 * contact whose facet, whichever group's, names company X" — a `where` needs
 * one field path, and the group id is part of the path.
 *
 * So the facet is MIRRORED into this array, which `array-contains` can query
 * and the `(companyIds CONTAINS, updatedAt DESC)` index serves. It carries the
 * union of every holder's link, so removing an id from it is only correct when
 * no other holder's facet still names that id — which is the rule
 * {@link contactCompanyLinkUpdate} enforces, and the reason nothing writes this
 * field without going through it.
 *
 * The facet is the truth and this is its index: a reader answering "which
 * company is this person at" reads the facet; only a QUERY reads this.
 */
export const CONTACT_COMPANY_IDS_FIELD = 'companyIds'

/**
 * How many contacts one delete pass detaches.
 *
 * A Firestore batch holds 500 writes, and the detach is one update per
 * contact. A company past this many links is detached in passes rather than
 * silently left with dangling references, and the surface says how many are
 * left rather than pretending the delete finished.
 */
export const COMPANY_DETACH_LIMIT = 500

/** One company as a picker or a suggestion needs it. */
export interface CompanyOption {
  id: string
  name: string
  domain?: string | null
}

/**
 * The company a contact's email address implies, from a list the caller
 * already holds, or `null`.
 *
 * `companyDomainForEmail` already refuses the public mailbox providers, so
 * `jane@gmail.com` suggests nothing rather than whichever company somebody
 * once filed under "gmail.com". The match is on the normalized domain both
 * sides store, so `www.acme.com` on the company and `jane@ACME.com` on the
 * contact still meet.
 */
export function suggestCompanyForEmail(
  email: unknown,
  companies: readonly CompanyOption[],
): CompanyOption | null {
  const domain = companyDomainForEmail(email)
  if (!domain) return null
  return companies.find((company) => company.domain === domain) ?? null
}

/** What the form holds — every field as text, the address as its parts. */
export interface CompanyDraft {
  name: string
  domain: string
  website: string
  phone: string
  industry: string
  ownerUid: string
  address: AglynPostalAddress
  notes: string
}

export const EMPTY_COMPANY_DRAFT: CompanyDraft = {
  name: '',
  domain: '',
  website: '',
  phone: '',
  industry: '',
  ownerUid: '',
  address: {},
  notes: '',
}

/** A stored company, as the form should start from it. */
export function companyDraftFrom(
  company: Partial<CrmCompany> | null | undefined,
): CompanyDraft {
  return {
    name: String(company?.name ?? ''),
    domain: String(company?.domain ?? ''),
    website: String(company?.website ?? ''),
    phone: String(company?.phone ?? ''),
    industry: String(company?.industry ?? ''),
    ownerUid: String(company?.ownerUid ?? ''),
    address: { ...(company?.address ?? {}) },
    notes: String(company?.notes ?? ''),
  }
}

export type CompanyDraftResult =
  | {
      ok: true
      /** Fields with a value, ready to `setDoc` or `updateDoc`. */
      set: Record<string, unknown>
      /**
       * Optional fields the draft left blank. A create omits them; an edit
       * has to DELETE them, or clearing the domain would leave the old one
       * stored and still matching contacts by email.
       */
      cleared: string[]
    }
  | { ok: false; error: string }

const INDUSTRY_MAX = 80
const NOTES_MAX = 4000
const WEBSITE_MAX = 500

/**
 * The typed website, as a URL, or `null` when it cannot be one.
 *
 * People type `acme.com` where a URL is asked for, and refusing that is
 * pedantry — it becomes `https://acme.com`. What IS refused is anything the
 * URL parser cannot read or a scheme other than http(s): a `javascript:` link
 * on a record that renders as an anchor is not a website.
 */
function normalizeWebsite(input: string): string | null {
  const raw = input.trim()
  if (!raw) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href.length > WEBSITE_MAX ? null : url.href
  } catch {
    return null
  }
}

/**
 * The document a draft becomes — normalized, keyed for search, and refused
 * as a whole when one field cannot be stored honestly.
 *
 * Refused rather than silently dropped: a domain typed as `acme` is not a
 * domain, and storing nothing while the form said something is how a company
 * comes to match no contact by email with no indication why. The name is
 * the one required field, and it is spread through `nameSearchFields` so the
 * list's name filter — a range over `nameLower` — can find the record; a
 * company written without those keys still lists and cannot be searched.
 */
export function companyDraftFields(draft: CompanyDraft): CompanyDraftResult {
  const name = draft.name.trim().replace(/\s+/g, ' ')
  if (!name) return { ok: false, error: 'A company needs a name.' }
  const set: Record<string, unknown> = { ...nameSearchFields(name) }
  const cleared: string[] = []

  const rawDomain = draft.domain.trim()
  if (rawDomain) {
    const domain = normalizeCompanyDomain(rawDomain)
    if (!domain) {
      return {
        ok: false,
        error:
          'The domain should be a bare hostname such as acme.com — a ' +
          'single word or an IP address is not one.',
      }
    }
    set['domain'] = domain
  } else {
    cleared.push('domain')
  }

  const website = normalizeWebsite(draft.website)
  if (website === null) {
    return { ok: false, error: 'The website is not a web address.' }
  }
  if (website) set['website'] = website
  else cleared.push('website')

  const rawPhone = draft.phone.trim()
  if (rawPhone) {
    const phone = normalizePhone(rawPhone)
    if (!phone) {
      return {
        ok: false,
        error:
          'The phone number could not be read. Include the country code, ' +
          'as in +1 512 555 0123.',
      }
    }
    set['phone'] = phone
  } else {
    cleared.push('phone')
  }

  const industry = draft.industry.trim().slice(0, INDUSTRY_MAX)
  if (industry) set['industry'] = industry
  else cleared.push('industry')

  const ownerUid = draft.ownerUid.trim()
  if (ownerUid) set['ownerUid'] = ownerUid
  else cleared.push('ownerUid')

  // Nullable rather than absent, so "no address" has one stored shape and
  // an edit that clears it does not need a delete: `normalizeAddress`
  // already answers `null` for a form with nothing in it.
  set['address'] = isBlankAddress(draft.address)
    ? null
    : normalizeAddress(draft.address)

  const notes = draft.notes.trim().slice(0, NOTES_MAX)
  if (notes) set['notes'] = notes
  else cleared.push('notes')

  return { ok: true, set, cleared }
}

/** Every group whose facet names this company, in no order. */
function groupsNaming(
  contact: Record<string, unknown> | null | undefined,
  companyId: string,
): string[] {
  const facets = (contact ?? {})[CONTACT_FACETS_FIELD]
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return []
  return Object.entries(facets as Record<string, unknown>)
    .filter(([, facet]) => {
      const value =
        facet && typeof facet === 'object' && !Array.isArray(facet)
          ? (facet as Record<string, unknown>)['companyId']
          : undefined
      return value === companyId
    })
    .map(([groupId]) => groupId)
}

/** The ids the mirror currently carries, whatever shape it arrived in. */
function currentCompanyIds(
  contact: Record<string, unknown> | null | undefined,
): string[] {
  const value = (contact ?? {})[CONTACT_COMPANY_IDS_FIELD]
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : []
}

/**
 * The update that links a contact to a company FOR ONE HOLDER — or unlinks
 * them, with `null` — keeping the facet and its mirror in step. `null` when
 * the document already says what was asked.
 *
 * Three cases, and the mirror is handled differently in each because it is
 * shared across holders while the facet is not:
 *
 *  - A first link writes the facet and `arrayUnion`s the mirror, which is
 *    safe against a concurrent writer adding another holder's id.
 *  - A MOVE from one company to another writes the facet and rewrites the
 *    mirror as a whole, because Firestore cannot `arrayRemove` and
 *    `arrayUnion` the same field in one update. The old id is dropped only
 *    if no other holder's facet still names it: another business filing the
 *    same person under the same account is their link, not this one's.
 *  - An unlink clears the facet and `arrayRemove`s the old id, on the same
 *    condition.
 *
 * Dotted paths into the facet, never a nested object — a nested write would
 * replace the whole facet map and take every other holder's records with it.
 */
export function contactCompanyLinkUpdate(
  contact: Record<string, unknown> | null | undefined,
  groupId: string,
  companyId: string | null,
): Record<string, unknown> | null {
  const previous = readContactFacet(contact, groupId).companyId ?? null
  if (previous === companyId) return null
  const heldElsewhere = (id: string) =>
    groupsNaming(contact, id).some((group) => group !== groupId)
  const update: Record<string, unknown> = {
    [contactFacetPath(groupId, 'companyId')]: companyId ?? deleteField(),
    updatedAt: serverTimestamp(),
  }
  if (companyId && !previous) {
    update[CONTACT_COMPANY_IDS_FIELD] = arrayUnion(companyId)
  } else if (companyId && previous) {
    const kept = currentCompanyIds(contact).filter(
      (id) => id !== previous || heldElsewhere(previous),
    )
    update[CONTACT_COMPANY_IDS_FIELD] = [...new Set([...kept, companyId])]
  } else if (previous && !heldElsewhere(previous)) {
    update[CONTACT_COMPANY_IDS_FIELD] = arrayRemove(previous)
  }
  return update
}

/**
 * The update that takes a company that is being DELETED off a contact, for
 * every holder at once.
 *
 * Unlike {@link contactCompanyLinkUpdate} this clears every facet naming
 * the id, not only the caller's. The record is about to stop existing, so a
 * facet still naming it is a link to nothing, and the holder it belongs to
 * has no surface on which they would ever learn that. Nothing else about
 * another holder's facet is read or written.
 */
export function companyDetachUpdate(
  contact: Record<string, unknown> | null | undefined,
  companyId: string,
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    [CONTACT_COMPANY_IDS_FIELD]: arrayRemove(companyId),
    updatedAt: serverTimestamp(),
  }
  for (const groupId of groupsNaming(contact, companyId)) {
    update[contactFacetPath(groupId, 'companyId')] = deleteField()
  }
  return update
}
