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
 * WHO MAY BE EMAILED (AGL-2979).
 *
 * One pure decision, run twice: when a rep enrolls a person, so the dialog
 * can say everything that stands in the way at once, and again before every
 * send, because a person enrolled on Monday can unsubscribe, become a
 * customer or join the team by Thursday. It reads a contact as stored and
 * the RESULTS of the lookups the runtime makes; it makes none itself.
 *
 * ## Every block, not the first
 *
 * The result lists each gate that refuses, in the order below, with a
 * sentence a rep can act on. A dialog that revealed one problem per attempt
 * would be a dialog people learn to fight.
 *
 * ## Cold
 *
 * A contact is COLD when no inbound door ever brought them to the sending
 * site's business — no form, sign-up, order or booking recorded on that
 * site's facet of the contact, and no email they wrote to the workspace.
 * Cold contacts carry the heavier rules: a business address rather than a
 * personal mailbox, a United States address, a personal line from the rep,
 * and the three attestations only the rep can make. The facet is read, never
 * the whole document, because a form filled in on another client's site is
 * that client's relationship and not this one's.
 *
 * ## Lookups fail closed
 *
 * A lookup the runtime could not complete is passed as `null`, and `null`
 * refuses — with a sentence that says the check could not be made rather
 * than one that accuses the address of something. A person who asked not to
 * be emailed must not be emailed because a read timed out.
 *==========================================*/

import {
  type ContactSource,
  contactEmails,
  normalizeContactEmail,
  readContactFacet,
} from '@aglyn/aglyn/app-utils/contacts'
import { isPublicMailboxDomain } from '@aglyn/aglyn/app-utils/crm'
import type { TopicSubscriptionState } from '@aglyn/aglyn/app-utils/email-topics'
import {
  findMemberByEmailAddress,
  type MemberAddresses,
} from '@aglyn/aglyn/app-utils/member-email-aliases'
import {
  OUTREACH_ATTESTATION_KINDS,
  OUTREACH_PERSONAL_LINE_MAX,
  type OutreachAttestationKind,
  type OutreachAttestations,
  type OutreachEnrollmentStatus,
  type OutreachSequenceSettings,
} from '../model/outreach.types'
import {
  type OutreachRecipientCountry,
  outreachCountryName,
  resolveOutreachRecipientCountry,
} from './recipient-country'
import { readOutreachSequenceSettings } from './sequence-validation'

/**
 * The capture doors that mean a person came to the business: a form, a
 * sign-up to the site or its newsletter, an order, a booking. `api`,
 * `import` and `manual` are how a business adds people it found, which is
 * exactly what cold means.
 */
export const OUTREACH_INBOUND_CONTACT_SOURCES: readonly ContactSource[] = [
  'form',
  'member',
  'newsletter',
  'order',
  'booking',
]

/** The enrollment statuses that hold a person: one sequence at a time. */
export const OUTREACH_OPEN_ENROLLMENT_STATUSES: readonly OutreachEnrollmentStatus[] = [
  'active',
  'paused',
]

/**
 * What the runtime looked up about the address before asking. Every field is
 * `null` when its read failed, and a `null` refuses.
 */
export interface OutreachGateLookups {
  /**
   * `emailSuppressions/{key}` holds a record in force — a hard bounce or a
   * spam complaint anywhere on the platform (`isEmailSuppressed`).
   */
  platformSuppressed: boolean | null
  /** `hosts/{hostId}/suppressions/{key}` exists for the sequence's site. */
  hostSuppressed: boolean | null
  /**
   * The address's standing on the site's `sales` topic —
   * `readTopicSubscriptionState` of the `sales` entry in
   * `hosts/{hostId}/topicOptOuts/{key}`. Only `opted-out` refuses: a pending
   * confirmation is about a subscription, and a sales email does not rest on
   * one.
   */
  salesTopicState: TopicSubscriptionState | null
  /** The address is on the organization's Outreach do-not-contact list. */
  doNotContact: boolean | null
  /**
   * The organization's roster: each member's sign-in address and confirmed
   * aliases, as `crmInboundRoster` builds it.
   */
  workspaceMembers: readonly MemberAddresses[] | null
  /**
   * The person's enrollments that are `active` or `paused`, found by contact
   * id or by address. Other statuses are ignored, so passing every
   * enrollment is safe too.
   */
  openEnrollments: ReadonlyArray<{
    id: string
    sequenceId: string
    status: OutreachEnrollmentStatus
  }> | null
  /**
   * An email the person wrote (`direction: 'inbound'`) is filed on the
   * contact. `null` reads as `false`, which only makes the contact cold and
   * the rules stricter.
   */
  hasInboundEmail: boolean | null
}

export interface OutreachGateInput {
  /** The address the steps go to. */
  email: string
  /** The contact document as stored (`orgs/{orgId}/contacts/{id}`), or `null` when it is gone. */
  contact: Record<string, unknown> | null | undefined
  /** The consent group of the sequence's site: whose facet holds stage, sources and address. */
  contactGroupId: string
  /** The company document the contact is filed under, when there is one. */
  company?: Record<string, unknown> | null
  /** The sequence's settings as stored; a missing field reads as its default. */
  settings: Partial<OutreachSequenceSettings> | null | undefined
  /** The rep's signal sentence. */
  personalLine: string | null | undefined
  attestations: OutreachAttestations | null | undefined
  /** The enrollment being re-checked before a send, so it does not count as another. */
  enrollmentId?: string | null
  lookups: OutreachGateLookups
}

export type OutreachGateCode =
  | 'contact_missing'
  | 'invalid_email'
  | 'email_not_on_contact'
  | 'free_mail'
  | 'country_not_allowed'
  | 'country_unknown'
  | 'platform_suppressed'
  | 'host_suppressed'
  | 'sales_opted_out'
  | 'do_not_contact'
  | 'workspace_member'
  | 'customer'
  | 'already_enrolled'
  | 'attestations_missing'
  | 'personal_line_missing'
  | 'personal_line_too_long'

export interface OutreachGateBlock {
  code: OutreachGateCode
  /** A sentence a rep can act on. */
  reason: string
}

export interface OutreachGateResult {
  allowed: boolean
  /** The address, normalized, or `null` when it is not one. */
  email: string | null
  cold: boolean
  country: OutreachRecipientCountry
  /** Every gate that refuses, in gate order. */
  blocks: OutreachGateBlock[]
  /** The attestations a cold contact still needs, in the order they are asked. */
  missingAttestations: OutreachAttestationKind[]
}

/** Local parts that answer no person: nobody reads a reply sent there. */
const MACHINE_LOCAL_PART = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)(\+.*)?$/

/**
 * Whether a contact came to the sending site's business through no inbound
 * door — see the module note.
 */
export function isColdOutreachContact(
  contact: Record<string, unknown> | null | undefined,
  contactGroupId: string,
  hasInboundEmail: boolean,
): boolean {
  if (hasInboundEmail) return false
  const { sources } = readContactFacet(contact, contactGroupId)
  return !OUTREACH_INBOUND_CONTACT_SOURCES.some((source) => sources?.[source] === true)
}

/**
 * Whether the sending site's business counts the contact as a customer: a
 * `customer` stage, the `evangelist` stage past it, or an order on record.
 */
export function isOutreachCustomer(
  contact: Record<string, unknown> | null | undefined,
  contactGroupId: string,
): boolean {
  const facet = readContactFacet(contact, contactGroupId)
  return (
    facet.lifecycleStage === 'customer' ||
    facet.lifecycleStage === 'evangelist' ||
    facet.sources?.order === true ||
    Number(facet.ordersCount) > 0
  )
}

/** A confirmation counts only when it says who confirmed it and when. */
export function outreachAttestationHolds(
  attestations: OutreachAttestations | null | undefined,
  kind: OutreachAttestationKind,
): boolean {
  const entry = attestations?.[kind]
  return (
    typeof entry?.uid === 'string' &&
    entry.uid.trim() !== '' &&
    typeof entry.atMs === 'number' &&
    Number.isFinite(entry.atMs) &&
    entry.atMs > 0
  )
}

/** The personal line as stored: one line, whitespace settled. */
export function normalizeOutreachPersonalLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** Each attestation as the sentence that asks for it reads it. */
const ATTESTATION_PHRASES: Record<OutreachAttestationKind, string> = {
  us_business_address: "it's a US business address",
  published_or_given: 'they or their company published it, or they gave it to you',
  verified_deliverable: 'it was verified as deliverable',
}

function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`
}

const COULD_NOT_CHECK = 'Try again in a moment.'

/** Every gate an address and a contact must pass — see the module note. */
export function evaluateOutreachGates(input: OutreachGateInput): OutreachGateResult {
  const lookups = input.lookups
  const settings = readOutreachSequenceSettings(input.settings)
  const email = normalizeContactEmail(input.email)
  const contact = input.contact ?? null
  const cold = isColdOutreachContact(
    contact,
    input.contactGroupId,
    lookups?.hasInboundEmail === true,
  )
  const blocks: OutreachGateBlock[] = []
  const block = (code: OutreachGateCode, reason: string) => blocks.push({ code, reason })
  // The gates below need both a record and an address to read.
  const refusedOutright = (): OutreachGateResult => ({
    allowed: false,
    email,
    cold,
    country: { country: null, source: null },
    blocks,
    missingAttestations: [],
  })

  if (!contact) {
    block('contact_missing', 'This contact no longer exists in the CRM.')
    return refusedOutright()
  }

  // 1. A valid address, one that belongs to this contact and to a person.
  if (!email) {
    block('invalid_email', `"${String(input.email ?? '').trim()}" isn't a valid email address.`)
    return refusedOutright()
  }
  if (MACHINE_LOCAL_PART.test(email.slice(0, email.lastIndexOf('@')))) {
    block('invalid_email', `${email} is an automated address that no person reads.`)
  }
  if (!contactEmails(contact).includes(email)) {
    block('email_not_on_contact', `${email} isn't an address on this contact's record.`)
  }

  // 2. A business address for a cold contact.
  if (cold && isPublicMailboxDomain(email)) {
    block(
      'free_mail',
      `${email} is a personal mailbox. Cold outreach goes only to business addresses.`,
    )
  }

  // 3. The country.
  const facet = readContactFacet(contact, input.contactGroupId)
  const companyAddress = input.company ? input.company['address'] : null
  const country = resolveOutreachRecipientCountry({
    email,
    contactAddress: facet.address,
    companyAddress,
  })
  const attestedUs = outreachAttestationHolds(input.attestations, 'us_business_address')
  if (country.country) {
    const name = outreachCountryName(country.country)
    const evidence =
      country.source === 'domain' ? `its domain places it in ${name}` : `it's in ${name}`
    if (!settings.allowedCountries.includes(country.country)) {
      block(
        'country_not_allowed',
        `${email} can't be emailed from this sequence: ${evidence}, which isn't one of its countries.`,
      )
    } else if (cold && country.country !== 'US') {
      block(
        'country_not_allowed',
        `Cold outreach goes only to US business addresses, and ${evidence}.`,
      )
    }
  } else if (!settings.allowedCountries.includes('US')) {
    block(
      'country_unknown',
      `We don't know which country ${email} is in. Add the country to the contact's address.`,
    )
  } else if (!attestedUs) {
    block(
      'country_unknown',
      `We don't know which country ${email} is in. Confirm it's a US business address, or add the country to the contact.`,
    )
  }

  // 4. Every list that says not to.
  if (lookups?.platformSuppressed === true) {
    block(
      'platform_suppressed',
      `${email} is on the platform's suppression list after a hard bounce or a spam complaint.`,
    )
  } else if (lookups?.platformSuppressed !== false) {
    block(
      'platform_suppressed',
      `We couldn't check the platform's suppression list for ${email}. ${COULD_NOT_CHECK}`,
    )
  }
  if (lookups?.hostSuppressed === true) {
    block('host_suppressed', `${email} unsubscribed from this site's email, or mail to it bounced.`)
  } else if (lookups?.hostSuppressed !== false) {
    block(
      'host_suppressed',
      `We couldn't check this site's suppression list for ${email}. ${COULD_NOT_CHECK}`,
    )
  }
  if (lookups?.salesTopicState === 'opted-out') {
    block('sales_opted_out', `${email} opted out of sales outreach from this site.`)
  } else if (lookups?.salesTopicState !== 'subscribed' && lookups?.salesTopicState !== 'pending') {
    block(
      'sales_opted_out',
      `We couldn't check whether ${email} opted out of sales outreach. ${COULD_NOT_CHECK}`,
    )
  }
  if (lookups?.doNotContact === true) {
    block('do_not_contact', `${email} is on your organization's do-not-contact list.`)
  } else if (lookups?.doNotContact !== false) {
    block(
      'do_not_contact',
      `We couldn't check your do-not-contact list for ${email}. ${COULD_NOT_CHECK}`,
    )
  }

  // 5. Not one of the workspace's own people.
  const members = lookups?.workspaceMembers
  if (!Array.isArray(members)) {
    block(
      'workspace_member',
      `We couldn't check whether ${email} belongs to a member of this workspace. ${COULD_NOT_CHECK}`,
    )
  } else if (findMemberByEmailAddress(members, email)) {
    block('workspace_member', `${email} belongs to a member of this workspace.`)
  }

  // 6. Not a customer, unless the sequence is written for them.
  if (!settings.allowCustomers && isOutreachCustomer(contact, input.contactGroupId)) {
    block('customer', "This contact is a customer, and this sequence doesn't include customers.")
  }

  // 7. One sequence at a time.
  const enrollments = lookups?.openEnrollments
  if (!Array.isArray(enrollments)) {
    block(
      'already_enrolled',
      `We couldn't check this contact's other sequences. ${COULD_NOT_CHECK}`,
    )
  } else if (
    enrollments.some(
      (enrollment) =>
        enrollment?.id !== input.enrollmentId &&
        OUTREACH_OPEN_ENROLLMENT_STATUSES.includes(enrollment?.status),
    )
  ) {
    block(
      'already_enrolled',
      'This contact is already in another sequence. Finish or stop that one first.',
    )
  }

  // 8. What only the rep can vouch for, on a cold contact.
  const personalLine = normalizeOutreachPersonalLine(input.personalLine)
  const missingAttestations = cold
    ? OUTREACH_ATTESTATION_KINDS.filter(
        (kind) => !outreachAttestationHolds(input.attestations, kind),
      )
    : []
  if (missingAttestations.length) {
    const phrases = missingAttestations.map((kind) => `that ${ATTESTATION_PHRASES[kind]}`)
    block(
      'attestations_missing',
      `Before emailing a cold contact, confirm ${listInWords(phrases)}.`,
    )
  }
  if (cold && !personalLine) {
    block(
      'personal_line_missing',
      'Write a personal line: one sentence on why you are writing to this person now.',
    )
  }
  if (personalLine.length > OUTREACH_PERSONAL_LINE_MAX) {
    block(
      'personal_line_too_long',
      `Keep the personal line to one sentence, under ${OUTREACH_PERSONAL_LINE_MAX} characters.`,
    )
  }

  return {
    allowed: blocks.length === 0,
    email,
    cold,
    country,
    blocks,
    missingAttestations,
  }
}
