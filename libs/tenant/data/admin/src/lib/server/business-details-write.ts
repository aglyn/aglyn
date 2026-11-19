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

import {
  BUSINESS_DETAILS_CLEARABLE_PATHS,
  BUSINESS_EMAIL_PATTERN,
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_PHONE_MAX_LENGTH,
  BUSINESS_SOCIAL_LINKS_MAX,
  type BusinessDetailsHost,
  businessDetailsSeed,
  businessDetailsWrite,
  SITE_SLOGAN_MAX_LENGTH,
} from '@aglyn/aglyn/app-utils/business-details'
import type { Firestore } from 'firebase-admin/firestore'
import {
  sameSiteSetting,
  siteSettingAt,
  siteSettingStored,
  type SiteSettingsChange,
  type SiteSettingsWrite,
  writeSiteSettings,
} from './site-settings-write'

/**
 * A SITE'S BUSINESS DETAILS SAVED ON THE SERVER (AGL-4235).
 *
 * The same save Setup → Business profile's Business details card makes from
 * the browser, on the same fields and by the same functions:
 *
 * 1. What the card is seeded with, `businessDetailsSeed(stored)`, with the
 *    request's members laid over it — the card submits every field it holds,
 *    so a member the request leaves out keeps the value it has.
 * 2. `businessDetailsWrite(fields, stored)`: every value trimmed, the email
 *    mirrored into `business.supportEmail` and the address, formatted, into
 *    `business.address` — the two copies the native apps still read — and
 *    the social links cleaned.
 * 3. The card's clear-on-empty for `BUSINESS_DETAILS_CLEARABLE_PATHS`: a
 *    field emptied is DELETED where the site holds a value, never stored
 *    blank, mirrors included.
 *
 * Only what differs from the stored document is written, through the shared
 * site-settings writer, so the save carries the site-wide outbox entry and
 * the cache drop every settings save owes.
 */

/** The API's members for the address, and the stored part each one is. */
export const BUSINESS_ADDRESS_PARTS = {
  street: 'streetAddress',
  city: 'addressLocality',
  region: 'addressRegion',
  postalCode: 'postalCode',
  country: 'addressCountry',
} as const

export type BusinessAddressMember = keyof typeof BUSINESS_ADDRESS_PARTS

/** The API's text members, and the `seo.entity` field each one is. */
export const BUSINESS_TEXT_MEMBERS = {
  name: 'name',
  slogan: 'slogan',
  phone: 'telephone',
  email: 'email',
} as const

export type BusinessTextMember = keyof typeof BUSINESS_TEXT_MEMBERS

/** Every member a business details write may carry. */
export const BUSINESS_DETAILS_WRITABLE = ['name', 'slogan', 'phone', 'email', 'address', 'socialLinks'] as const

/**
 * Bounds the API holds the members to where the card itself has none — the
 * address parts, an email's length, a social link's label and address — so a
 * request cannot store an unbounded string on the site's document. Every
 * member the card bounds is held to the card's own limit.
 */
export const BUSINESS_API_BOUNDS = {
  addressPart: 200,
  email: 254,
  socialLinkLabel: 100,
  socialLinkUrl: 2048,
} as const

/** The longest each text member may be, from the card where it has a limit. */
export const BUSINESS_TEXT_LIMITS: Readonly<Record<BusinessTextMember, number>> = {
  name: BUSINESS_NAME_MAX_LENGTH,
  slogan: SITE_SLOGAN_MAX_LENGTH,
  phone: BUSINESS_PHONE_MAX_LENGTH,
  email: BUSINESS_API_BOUNDS.email,
}

const EMAIL = new RegExp(BUSINESS_EMAIL_PATTERN)

/** A request's members, read. `''` means the member is emptied. */
export interface BusinessDetailsPatch {
  name?: string
  slogan?: string
  phone?: string
  email?: string
  /** `null` empties every part; a part left out keeps its value. */
  address?: Partial<Record<BusinessAddressMember, string>> | null
  /** Replaces the whole list; `[]` or `null` empties it. */
  socialLinks?: Array<{ label: string; url: string }>
}

export type BusinessDetailsRead = { patch: BusinessDetailsPatch } | { errors: Record<string, string> }

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * A text member: a string, or `null` to empty it. The limit is checked on the
 * trimmed value, which is what the save stores.
 */
function readText(
  value: unknown,
  key: string,
  limit: number,
  errors: Record<string, string>,
): string | undefined {
  if (value === undefined) return undefined
  if (value === null) return ''
  if (typeof value !== 'string') {
    errors[key] = 'Must be a string, or null to clear it'
    return undefined
  }
  const text = value.trim()
  if (text.length > limit) {
    errors[key] = `Must be ${limit} characters or fewer`
    return undefined
  }
  return text
}

/** Reads and checks a business details write body. Unknown members are named. */
export function readBusinessDetailsPatch(body: unknown): BusinessDetailsRead {
  if (!isObject(body)) return { errors: { body: 'Must be a JSON object' } }
  const errors: Record<string, string> = {}
  const patch: BusinessDetailsPatch = {}
  for (const key of Object.keys(body)) {
    if (!(BUSINESS_DETAILS_WRITABLE as readonly string[]).includes(key)) {
      errors[key] = 'Not writable on business details'
    }
  }
  for (const member of Object.keys(BUSINESS_TEXT_MEMBERS) as BusinessTextMember[]) {
    const text = readText(body[member], member, BUSINESS_TEXT_LIMITS[member], errors)
    if (text !== undefined) patch[member] = text
  }
  if (patch.email && !EMAIL.test(patch.email)) {
    errors['email'] = 'Must be an email address, like you@example.com'
    delete patch.email
  }

  if (body['address'] === null) patch.address = null
  else if (body['address'] !== undefined) {
    if (!isObject(body['address'])) errors['address'] = 'Must be an object, or null to clear it'
    else {
      const address: Partial<Record<BusinessAddressMember, string>> = {}
      for (const key of Object.keys(body['address'])) {
        if (!(key in BUSINESS_ADDRESS_PARTS)) errors[`address.${key}`] = 'Not a part of the address'
      }
      for (const member of Object.keys(BUSINESS_ADDRESS_PARTS) as BusinessAddressMember[]) {
        const text = readText(body['address'][member], `address.${member}`, BUSINESS_API_BOUNDS.addressPart, errors)
        if (text !== undefined) address[member] = text
      }
      patch.address = address
    }
  }

  const links = body['socialLinks']
  if (links === null) patch.socialLinks = []
  else if (links !== undefined) {
    if (!Array.isArray(links)) errors['socialLinks'] = 'Must be a list of links, or null to clear it'
    else if (links.length > BUSINESS_SOCIAL_LINKS_MAX) {
      errors['socialLinks'] = `Must hold ${BUSINESS_SOCIAL_LINKS_MAX} links or fewer`
    } else {
      const read: Array<{ label: string; url: string }> = []
      links.forEach((link, index) => {
        const at = `socialLinks[${index}]`
        if (!isObject(link)) {
          errors[at] = 'Must be an object with a `url`'
          return
        }
        for (const key of Object.keys(link)) {
          if (key !== 'label' && key !== 'url') errors[`${at}.${key}`] = 'Not a member of a social link'
        }
        const label = readText(link['label'], `${at}.label`, BUSINESS_API_BOUNDS.socialLinkLabel, errors) ?? ''
        const url = readText(link['url'], `${at}.url`, BUSINESS_API_BOUNDS.socialLinkUrl, errors)
        if (url === undefined || url === '') {
          errors[`${at}.url`] ??= 'Required'
          return
        }
        read.push({ label, url })
      })
      patch.socialLinks = read
    }
  }

  return Object.keys(errors).length ? { errors } : { patch }
}

/** Every path a business details save may change: the clearable ones and the links. */
const BUSINESS_DETAILS_PATHS: readonly string[] = [...BUSINESS_DETAILS_CLEARABLE_PATHS, 'business.socialLinks']

/**
 * The changes a write asks of the stored host: the card's save, made from the
 * card's seed with the request laid over it. Only paths that differ.
 */
export function businessDetailsChanges(
  stored: Record<string, unknown>,
  patch: BusinessDetailsPatch,
): SiteSettingsChange[] {
  const host = stored as BusinessDetailsHost
  const seeded = (businessDetailsSeed(host) ?? {}) as BusinessDetailsHost
  const entity: Record<string, unknown> = { ...(seeded.seo?.entity ?? {}) }
  const address: Record<string, unknown> = isObject(entity['address']) ? { ...entity['address'] } : {}
  for (const member of Object.keys(BUSINESS_TEXT_MEMBERS) as BusinessTextMember[]) {
    if (patch[member] !== undefined) entity[BUSINESS_TEXT_MEMBERS[member]] = patch[member]
  }
  if (patch.address === null) {
    for (const part of Object.values(BUSINESS_ADDRESS_PARTS)) address[part] = ''
  } else if (patch.address) {
    for (const [member, value] of Object.entries(patch.address)) {
      address[BUSINESS_ADDRESS_PARTS[member as BusinessAddressMember]] = value
    }
  }
  if (Object.keys(address).length) entity['address'] = address
  const business: Record<string, unknown> = { ...(seeded.business ?? {}) }
  if (patch.socialLinks !== undefined) business['socialLinks'] = patch.socialLinks

  const written = businessDetailsWrite({ seo: { entity }, business }, host)
  const changes: SiteSettingsChange[] = []
  const clearable = BUSINESS_DETAILS_CLEARABLE_PATHS as readonly string[]
  for (const path of BUSINESS_DETAILS_PATHS) {
    const next = siteSettingAt(written, path)
    const before = siteSettingAt(stored, path)
    if (clearable.includes(path) && !siteSettingStored(next)) {
      // Emptied: deleted where the site holds a value, never stored blank.
      if (siteSettingStored(before)) changes.push({ path, remove: true })
      continue
    }
    if (next === undefined) continue
    if (!sameSiteSetting(next, before)) changes.push({ path, value: next })
  }
  return changes
}

/** A site's business details as the API publishes them: what the card shows. */
export function businessDetailsView(hostId: string, stored: Record<string, unknown> | null | undefined) {
  const seeded = (businessDetailsSeed((stored ?? {}) as BusinessDetailsHost) ?? {}) as BusinessDetailsHost
  const entity = (seeded.seo?.entity ?? {}) as Record<string, unknown>
  const address = isObject(entity['address']) ? entity['address'] : {}
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null
  const links = Array.isArray(seeded.business?.socialLinks) ? seeded.business.socialLinks : []
  return {
    object: 'business_details' as const,
    site: hostId,
    name: text(entity['name']),
    slogan: text(entity['slogan']),
    phone: text(entity['telephone']),
    email: text(entity['email']),
    address: Object.fromEntries(
      (Object.entries(BUSINESS_ADDRESS_PARTS) as Array<[BusinessAddressMember, string]>).map(([member, part]) => [
        member,
        text(address[part]),
      ]),
    ) as Record<BusinessAddressMember, string | null>,
    socialLinks: links
      .filter((link) => typeof link?.url === 'string' && link.url.trim())
      .map((link) => ({ label: typeof link?.label === 'string' ? link.label : '', url: String(link?.url) })),
  }
}

/** Saves a site's business details through the shared site-settings writer. */
export function writeBusinessDetails(
  firestore: Firestore,
  input: { hostId: string; patch: BusinessDetailsPatch; now: Date },
): Promise<SiteSettingsWrite<never>> {
  return writeSiteSettings<never>(firestore, {
    hostId: input.hostId,
    now: input.now,
    plan: (host) => ({ changes: businessDetailsChanges(host, input.patch) }),
  })
}
