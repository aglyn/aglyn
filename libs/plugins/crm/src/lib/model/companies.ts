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
  CRM_COMPANY_EMPLOYEES_MAX,
  CRM_COMPANY_PICKLIST_FIELDS,
  type CrmCompany,
  type CrmCompanyPicklistField,
  type CrmPicklist,
  type CrmPicklistId,
  companyDomainForEmail,
  isBlankAddress,
  judgeCrmCompanyPicklists,
  nameSearchFields,
  normalizeAddress,
  normalizeCompanyDomain,
  normalizeCompanyWebsite,
  normalizePhone,
  readCrmCompanyAccountFields,
} from '@aglyn/aglyn'
import { amountInputValue, DEFAULT_DEAL_CURRENCY, parseAmountInput } from './deal-board-model'

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

/** What the form holds — every field as text, the addresses as their parts. */
export interface CompanyDraft {
  name: string
  domain: string
  website: string
  phone: string
  /** Each company picklist's label (AGL-3514), `''` for none. */
  type: string
  industry: string
  rating: string
  ownership: string
  accountSource: string
  ownerUid: string
  /** The billing address. */
  address: AglynPostalAddress
  shippingAddress: AglynPostalAddress
  /** As typed, in the currency's major unit — `parseAmountInput` reads it. */
  annualRevenue: string
  /** Lowercase ISO 4217. */
  currency: string
  numberOfEmployees: string
  fax: string
  accountNumber: string
  site: string
  tickerSymbol: string
  sicCode: string
  /** The parent company's id, `''` for none. */
  parentCompanyId: string
  /** Comma-separated as typed; stored as the list `companyDraftFields` reads. */
  tags: string
  notes: string
}

export const EMPTY_COMPANY_DRAFT: CompanyDraft = {
  name: '',
  domain: '',
  website: '',
  phone: '',
  type: '',
  industry: '',
  rating: '',
  ownership: '',
  accountSource: '',
  ownerUid: '',
  address: {},
  shippingAddress: {},
  annualRevenue: '',
  currency: DEFAULT_DEAL_CURRENCY,
  numberOfEmployees: '',
  fax: '',
  accountNumber: '',
  site: '',
  tickerSymbol: '',
  sicCode: '',
  parentCompanyId: '',
  tags: '',
  notes: '',
}

/** How each account field is named in a refusal the drawer shows. */
const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  annualRevenueCents: 'Annual revenue',
  currency: 'The currency',
  numberOfEmployees: 'Employees',
  fax: 'The fax number',
  accountNumber: 'The account number',
  site: 'The account site',
  tickerSymbol: 'The ticker symbol',
  sicCode: 'The SIC code',
  shippingAddress: 'The shipping address',
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
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value))
  return {
    name: text(company?.name),
    domain: text(company?.domain),
    website: text(company?.website),
    phone: text(company?.phone),
    type: text(company?.type),
    industry: text(company?.industry),
    rating: text(company?.rating),
    ownership: text(company?.ownership),
    accountSource: text(company?.accountSource),
    ownerUid: text(company?.ownerUid),
    address: { ...(company?.address ?? {}) },
    shippingAddress: { ...(company?.shippingAddress ?? {}) },
    annualRevenue: amountInputValue(company?.annualRevenueCents),
    currency: text(company?.currency).toLowerCase() || DEFAULT_DEAL_CURRENCY,
    numberOfEmployees:
      typeof company?.numberOfEmployees === 'number' ? String(company.numberOfEmployees) : '',
    fax: text(company?.fax),
    accountNumber: text(company?.accountNumber),
    site: text(company?.site),
    tickerSymbol: text(company?.tickerSymbol),
    sicCode: text(company?.sicCode),
    parentCompanyId: text(company?.parentCompanyId),
    tags: (company?.tags ?? []).join(', '),
    notes: text(company?.notes),
  }
}

/**
 * What a draft's picklist fields are judged against (AGL-3514): the org's
 * lists the form read, and the company as stored — whose own values are
 * kept even when a list no longer offers them. Absent, each field is
 * judged against its standard values alone.
 */
export interface CompanyDraftPicklists {
  lists: Readonly<Partial<Record<CrmPicklistId, CrmPicklist>>>
  current?: Partial<CrmCompany> | null
}

/** A typed head count, as the whole number stored, `null` for blank, `undefined` for unreadable. */
function parseEmployees(input: string): number | null | undefined {
  const cleaned = input.replace(/[\s,]/g, '')
  if (!cleaned) return null
  if (!/^\d+$/.test(cleaned)) return undefined
  const value = Number(cleaned)
  return value <= CRM_COMPANY_EMPLOYEES_MAX ? value : undefined
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
export function companyDraftFields(
  draft: CompanyDraft,
  picklists: CompanyDraftPicklists = { lists: {} },
): CompanyDraftResult {
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

  /*
   * THE PICKLISTS (AGL-3514): each a label of the org's list, or the value
   * the company already holds — an industry typed before Industry was a
   * picklist stays until it is changed.
   */
  const judged = judgeCrmCompanyPicklists(
    picklists.lists,
    Object.fromEntries(
      CRM_COMPANY_PICKLIST_FIELDS.map(({ field }) => [field, draft[field]]),
    ),
    { current: picklists.current ?? {} },
  )
  const picklistError = Object.values(judged.errors)[0]
  if (picklistError) return { ok: false, error: picklistError }
  for (const { field } of CRM_COMPANY_PICKLIST_FIELDS) {
    const value = judged.values[field as CrmCompanyPicklistField]
    if (value) set[field] = value
    else cleared.push(field)
  }

  const ownerUid = draft.ownerUid.trim()
  if (ownerUid) set['ownerUid'] = ownerUid
  else cleared.push('ownerUid')

  // Nullable rather than absent, so "no address" has one stored shape and
  // an edit that clears it does not need a delete: `normalizeAddress`
  // already answers `null` for a form with nothing in it.
  set['address'] = isBlankAddress(draft.address)
    ? null
    : normalizeAddress(draft.address)

  /*
   * THE ACCOUNT FIELDS (AGL-3514), through the reader every door uses. The
   * revenue is typed in the currency's major unit and stored in its minor
   * one, with the currency beside it; without a revenue there is nothing
   * for a currency to describe.
   */
  const revenueText = draft.annualRevenue.trim()
  const revenue = revenueText ? parseAmountInput(revenueText) : null
  if (revenueText && revenue === null) {
    return { ok: false, error: 'The annual revenue is not an amount.' }
  }
  const employees = parseEmployees(draft.numberOfEmployees)
  if (employees === undefined) {
    return {
      ok: false,
      error: `Employees must be a whole number from 0 to ${CRM_COMPANY_EMPLOYEES_MAX.toLocaleString()}.`,
    }
  }
  const account = readCrmCompanyAccountFields({
    annualRevenueCents: revenue,
    currency: revenue === null ? null : draft.currency,
    numberOfEmployees: employees,
    fax: draft.fax,
    accountNumber: draft.accountNumber,
    site: draft.site,
    tickerSymbol: draft.tickerSymbol,
    sicCode: draft.sicCode,
    shippingAddress: isBlankAddress(draft.shippingAddress) ? null : draft.shippingAddress,
  })
  const [failed] = Object.entries(account.errors)
  if (failed) {
    const [field, message] = failed
    return {
      ok: false,
      error: `${ACCOUNT_FIELD_LABELS[field] ?? field} ${message.charAt(0).toLowerCase()}${message.slice(1)}.`,
    }
  }
  for (const [field, value] of Object.entries(account.values)) {
    // The shipping address is nullable like the billing one; the rest are
    // absent when blank, so an edit deletes them.
    if (field === 'shippingAddress') set[field] = value ?? null
    else if (value === null || value === undefined) cleared.push(field)
    else set[field] = value
  }

  const parentCompanyId = draft.parentCompanyId.trim()
  if (parentCompanyId) set['parentCompanyId'] = parentCompanyId
  else cleared.push('parentCompanyId')

  const tags = normalizeCompanyTags(draft.tags)
  if (tags.length) set['tags'] = tags
  else cleared.push('tags')

  const notes = draft.notes.trim().slice(0, NOTES_MAX)
  if (notes) set['notes'] = notes
  else cleared.push('notes')

  return { ok: true, set, cleared }
}
