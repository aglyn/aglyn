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
 * suggests one for a contact, has to agree on.
 *
 * A contact's link to a company is the server's to write (AGL-2804): the
 * link lives in a holder's facet, `crm/contact-update` plans it with
 * `planContactCompanyLink`, and `crm/company-delete` unlinks a company being
 * deleted. What stays here is the company's own document — the draft a form
 * holds, what it is stored as, and the company an address suggests — each
 * rule once, as a function of the document and nothing else, so a spec can
 * pin it without mounting a card.
 */

import {
  type AglynPostalAddress,
  CONTACT_COMPANY_IDS_FIELD,
  type CrmCompany,
  companyDomainForEmail,
  isBlankAddress,
  nameSearchFields,
  normalizeAddress,
  normalizeCompanyDomain,
  normalizeCompanyWebsite,
  normalizePhone,
} from '@aglyn/aglyn'

/*
 * The mirror field lives with the planner in `@aglyn/aglyn` now, because the
 * server doors that link on capture read it too; it is re-exported here so
 * the surfaces that always imported it from this module keep one name.
 */
export { CONTACT_COMPANY_IDS_FIELD }

/*
 * The delete pass's bound lives with `crm/company-delete`'s contract, which
 * the route and the console both import; re-exported here for the surfaces
 * that say it.
 */
export { COMPANY_DETACH_LIMIT } from './company-delete-route'

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
  /** Comma-separated as typed; stored as the list `companyDraftFields` reads. */
  tags: string
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
  tags: '',
  notes: '',
}

/** The drawer's cap on a company's tags — a contact's, so the two agree. */
export const COMPANY_TAGS_MAX = 20

/**
 * A typed tag list as the document stores one: split on `,` or `|`,
 * lowercased and trimmed, deduplicated, capped — the same shape a contact's
 * tags take, so the bulk bar's "Add tag" over companies and the drawer's
 * field write one kind of value.
 */
export function normalizeCompanyTags(input: string): string[] {
  return [
    ...new Set(
      String(input ?? '')
        .split(/[|,]/)
        .map((tag) => tag.trim().toLowerCase().slice(0, 60))
        .filter(Boolean),
    ),
  ].slice(0, COMPANY_TAGS_MAX)
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
    tags: (company?.tags ?? []).join(', '),
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

  const website = normalizeCompanyWebsite(draft.website)
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

  const tags = normalizeCompanyTags(draft.tags)
  if (tags.length) set['tags'] = tags
  else cleared.push('tags')

  const notes = draft.notes.trim().slice(0, NOTES_MAX)
  if (notes) set['notes'] = notes
  else cleared.push('notes')

  return { ok: true, set, cleared }
}
