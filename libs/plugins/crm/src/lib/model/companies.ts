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
  COMPANY_CONTACTS_COUNT_FIELD,
  CONTACT_COMPANY_IDS_FIELD,
  CONTACT_FACETS_FIELD,
  type ContactCompanyLinkPlan,
  type ContactCompanyLinkState,
  type CrmCompany,
  companyDomainForEmail,
  contactFacetPath,
  isBlankAddress,
  nameSearchFields,
  normalizeAddress,
  normalizeCompanyDomain,
  normalizePhone,
  planContactCompanyLink,
  readContactCompanyLink,
} from '@aglyn/aglyn'
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  increment,
  serverTimestamp,
} from 'firebase/firestore'

/*
 * The mirror field lives with the planner in `@aglyn/aglyn` now, because the
 * server doors that link on capture read it too; it is re-exported here so
 * the surfaces that always imported it from this module keep one name.
 */
export { CONTACT_COMPANY_IDS_FIELD }

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

/**
 * A link plan as the client SDK writes it: the contact's facet by dotted
 * path, the mirror by the sentinel the plan chose, and — when the caller
 * hands one in — the company name echoed where the row and the global search
 * read it, so a person linked to Acme reads "Acme" in the list column whether
 * the link was made here or the name typed before a company existed.
 *
 * Dotted paths into the facet, never a nested object — a nested write would
 * replace the whole facet map and take every other holder's records with it.
 */
function contactLinkPatch(
  plan: ContactCompanyLinkPlan,
  groupId: string,
  companyName: string | null | undefined,
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    [contactFacetPath(groupId, 'companyId')]: plan.companyId ?? deleteField(),
    updatedAt: serverTimestamp(),
  }
  if (plan.mirror?.op === 'union') {
    update[CONTACT_COMPANY_IDS_FIELD] = arrayUnion(plan.mirror.companyId)
  } else if (plan.mirror?.op === 'remove') {
    update[CONTACT_COMPANY_IDS_FIELD] = arrayRemove(plan.mirror.companyId)
  } else if (plan.mirror?.op === 'set') {
    update[CONTACT_COMPANY_IDS_FIELD] = plan.mirror.companyIds
  }
  if (companyName !== undefined) {
    const stored = plan.companyId ? String(companyName ?? '').trim().slice(0, 120) : ''
    update[contactFacetPath(groupId, 'companyName')] = stored || deleteField()
    // The search echo — see `HostContact.companyName`.
    update['companyName'] = stored || deleteField()
  }
  return update
}

/**
 * The update that links a contact to a company FOR ONE HOLDER — or unlinks
 * them, with `null` — keeping the facet and its mirror in step. `null` when
 * the document already says what was asked.
 *
 * The decision is {@link planContactCompanyLink}'s; this applies it with the
 * client SDK's sentinels. The company's contacts count is NOT in this
 * update, because it lives on another document: a caller that can batch
 * takes {@link contactCompanyLinkWrites} instead, and this stays for the
 * caller that only has the contact in hand.
 */
export function contactCompanyLinkUpdate(
  contact: Record<string, unknown> | null | undefined,
  groupId: string,
  companyId: string | null,
): Record<string, unknown> | null {
  const plan = planContactCompanyLink(
    readContactCompanyLink(contact, groupId),
    companyId,
  )
  return plan ? contactLinkPatch(plan, groupId, undefined) : null
}

/** Everything one link change writes: the contact, and each company it moves the count of. */
export interface ContactCompanyLinkWrites {
  /** The contact document's update, by dotted path. */
  contact: Record<string, unknown>
  /** One update per company whose contacts count moves, `increment`ed. */
  companies: Array<{ id: string; update: Record<string, unknown> }>
  /** The same moves as bare numbers, for a caller that sums them across rows. */
  counts: ContactCompanyLinkPlan['counts']
}

/**
 * The link change as a SET of writes, for a caller that commits a batch: the
 * contact's patch and the `increment` on each company whose count moves.
 *
 * Takes the link STATE rather than the document, because the surfaces that
 * link — the properties card, the bulk bar — hold the projected row, which
 * carries `companyLink` for exactly this; a caller with the raw document
 * reads the state off it with `readContactCompanyLink`.
 *
 * `companyName` is the picked company's name, or `null` to clear the label
 * on an unlink; a caller that does not know the name leaves it `undefined`
 * and the stored label is left alone. In one batch because the count is a
 * derived figure of the mirror, and a mirror that changed while the count
 * did not is a company page that says "3 contacts" over a list of four.
 */
export function contactCompanyLinkWrites(
  link: ContactCompanyLinkState,
  groupId: string,
  companyId: string | null,
  companyName?: string | null,
): ContactCompanyLinkWrites | null {
  const plan = planContactCompanyLink(link, companyId)
  if (!plan) return null
  return {
    contact: contactLinkPatch(plan, groupId, companyName),
    companies: plan.counts.map((count) => ({
      id: count.companyId,
      update: { [COMPANY_CONTACTS_COUNT_FIELD]: increment(count.delta) },
    })),
    counts: plan.counts,
  }
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
