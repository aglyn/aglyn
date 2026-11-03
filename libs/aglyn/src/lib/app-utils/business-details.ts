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

import { structuredAddressLine } from './business-profile'
import type { HostSeoEntity } from './content-authors'
import { siteContactEmail } from './host-tokens'

/**
 * A site's BUSINESS DETAILS, entered in one place (AGL-4136).
 *
 * The business name, slogan, phone, email, postal address and social links
 * are entered on Setup → Business profile and nowhere else, and everything that uses
 * them reads that one place. The storage did not move, so no site's data had
 * to: each fact has one canonical path, and the older path that used to hold
 * it is kept as a read fallback.
 *
 * | fact         | canonical                     | kept in step               |
 * | ------------ | ----------------------------- | -------------------------- |
 * | name         | `seo.entity.name`             | falls back to `displayName` |
 * | slogan       | `seo.entity.slogan`           |                            |
 * | phone        | `seo.entity.telephone`        |                            |
 * | email        | `seo.entity.email`            | mirrored to `business.supportEmail` |
 * | address      | `seo.entity.address.*`        | mirrored, formatted, to `business.address` |
 * | social links | `business.socialLinks`        | `seo.entity.sameAs` joins it when read |
 *
 * The two mirrors exist for the readers that have not moved yet: the native
 * apps read and write the `business` copies, so a save here keeps them
 * showing what the console shows until they follow.
 */

/** The longest slogan a site may set, as the field and the structured data hold it. */
export const SITE_SLOGAN_MAX_LENGTH = 120

/** The most social links a site keeps, as the editor allows them. */
export const BUSINESS_SOCIAL_LINKS_MAX = 8

/**
 * The paths a Setup → Business profile save may take back to EMPTY.
 *
 * The form drops a cleared input from what it submits, and the write merges,
 * so without this a cleared phone would save nothing and report "Saved!".
 * Both mirrors are here as well: an email or address cleared on the card has
 * to leave its copy too, or the fallback would bring it straight back.
 */
export const BUSINESS_DETAILS_CLEARABLE_PATHS = [
  'seo.entity.name',
  'seo.entity.slogan',
  'seo.entity.telephone',
  'seo.entity.email',
  'seo.entity.address.streetAddress',
  'seo.entity.address.addressLocality',
  'seo.entity.address.addressRegion',
  'seo.entity.address.postalCode',
  'seo.entity.address.addressCountry',
  'business.supportEmail',
  'business.address',
] as const

/** The host fields the business details read and write. */
export interface BusinessDetailsHost {
  displayName?: string
  seo?: {
    entity?: Pick<
      HostSeoEntity,
      'name' | 'slogan' | 'telephone' | 'email' | 'address'
    > | null
  } | null
  business?: {
    supportEmail?: unknown
    address?: unknown
    socialLinks?: Array<{ label?: unknown; url?: unknown } | null> | null
  } | null
}

const trimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * The host document as the Business details card is seeded with it: the
 * site's one email in the Email field, so a site whose email so far lived
 * only in the one-block copy shows it, and clearing the field clears it.
 * Everything else is the document as stored. A new object; `host` is not
 * changed.
 */
export function businessDetailsSeed<T extends BusinessDetailsHost>(
  host: T | null | undefined,
): T | null | undefined {
  if (!host) return host
  const email = siteContactEmail(host)
  if (!email || trimmed(host.seo?.entity?.email)) return host
  return {
    ...host,
    seo: { ...(host.seo ?? {}), entity: { ...(host.seo?.entity ?? {}), email } },
  }
}

/**
 * What a Setup → Business profile save writes, from what the card submitted and what
 * the document stores now (AGL-4136):
 *
 * - every text value trimmed;
 * - the email mirrored into `business.supportEmail`, `''` when it was cleared
 *   (a clearable path, so the save deletes it);
 * - the structured address mirrored, as the one line every reader prints,
 *   into `business.address` — but ONLY when the structured address changed.
 *   A site whose address so far lives only in the one block keeps that block
 *   through a save that never touched the address, rather than losing it to
 *   an empty structured one;
 * - social links without an address dropped, each label and address trimmed,
 *   up to {@link BUSINESS_SOCIAL_LINKS_MAX}.
 *
 * A new object: the form's values are not this function's to edit.
 */
export function businessDetailsWrite<T extends Record<string, unknown>>(
  fields: T,
  stored: BusinessDetailsHost | null | undefined,
): T {
  const seo = { ...((fields?.['seo'] as Record<string, unknown>) ?? {}) }
  const entity = { ...((seo['entity'] as Record<string, unknown>) ?? {}) }
  for (const key of ['name', 'slogan', 'telephone', 'email'] as const) {
    if (typeof entity[key] === 'string') entity[key] = trimmed(entity[key])
  }
  if (entity['address'] && typeof entity['address'] === 'object') {
    const address = { ...(entity['address'] as Record<string, unknown>) }
    for (const [key, value] of Object.entries(address)) {
      if (typeof value === 'string') address[key] = trimmed(value)
    }
    entity['address'] = address
  }
  seo['entity'] = entity

  const business = { ...((fields?.['business'] as Record<string, unknown>) ?? {}) }
  const email = trimmed(entity['email'])
  if (email) business['supportEmail'] = email
  else if (trimmed(stored?.business?.supportEmail)) business['supportEmail'] = ''
  else delete business['supportEmail']

  const before = structuredAddressLine(stored?.seo?.entity?.address)
  const after = structuredAddressLine(
    entity['address'] as HostSeoEntity['address'] | undefined,
  )
  if (after !== before) {
    if (after) business['address'] = after
    else if (trimmed(stored?.business?.address)) business['address'] = ''
    else delete business['address']
  }

  if (Array.isArray(business['socialLinks'])) {
    business['socialLinks'] = (business['socialLinks'] as unknown[])
      .map((link) => link as { label?: unknown; url?: unknown } | null)
      .filter((link) => trimmed(link?.url))
      .slice(0, BUSINESS_SOCIAL_LINKS_MAX)
      .map((link) => ({ label: trimmed(link?.label), url: trimmed(link?.url) }))
  }

  return { ...fields, seo, business }
}
