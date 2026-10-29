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

import { siteProfileUrls, type HostSeoEntity } from './content-authors'
import { normalizeAreaServed } from './local-business'
import { PLATFORM_BRAND_NAME } from './platform-brand'
import {
  BUSINESS_PROFILE_FIELDS,
  BUSINESS_PROFILE_MAX_CHARS,
  BUSINESS_TONES,
  businessProfileSourceOf,
  fieldValue,
  isEmpty,
  text,
  type BusinessProfileDoc,
  type BusinessProfileField,
  type BusinessProfileOrigin,
  type BusinessProfileSource,
  type BusinessProfileValues,
  type BusinessTone,
} from './business-profile-values'

export {
  BUSINESS_PROFILE_FIELDS,
  BUSINESS_PROFILE_MAX_CHARS,
  BUSINESS_PROFILE_MAX_SERVICES,
  BUSINESS_PROFILE_SITE_DOC,
  BUSINESS_PROFILE_SUBCOLLECTION,
  BUSINESS_PROFILE_WORKSPACE_DOC,
  BUSINESS_TONE_LABELS,
  BUSINESS_TONES,
  businessProfileFoundedProblem,
  businessProfileOwnerWrite,
  businessProfileSourceOf,
  mergeBusinessProfilePrefill,
  sanitizeBusinessProfileValues,
} from './business-profile-values'
export type {
  BusinessProfileDoc,
  BusinessProfileField,
  BusinessProfileOrigin,
  BusinessProfileSource,
  BusinessProfileValues,
  BusinessTone,
} from './business-profile-values'

/** The tones as a plain list, in the order the owner picks them, for the native apps' pickers. */
export const BUSINESS_TONE_ORDER: readonly string[] = BUSINESS_TONES

/** The stored fields as a plain list, for the native apps' writers. */
export const BUSINESS_PROFILE_FIELD_ORDER: readonly string[] = BUSINESS_PROFILE_FIELDS

/**
 * A site's BUSINESS PROFILE (AGL-3661): what the business is, as everything
 * that writes about it needs to know — the site's own pages, the structured
 * data, and any generator a plugin brings.
 *
 * ── Most of it is already stored, so this stores only the rest ─────────────
 *
 * The site's name, its one-line description, its contact details, its hours,
 * the areas it serves and its social profiles all have a home on the host
 * document already: `seo.entity` (the publisher entity the JSON-LD is built
 * from, edited in Setup → SEO) and `business` (the contact card the `host.*`
 * tokens and the footer read, edited in Setup → Basic details). Copying them
 * here would make two places to keep in step, and the copy would drift.
 *
 * So the profile document holds only what has no home yet — the services, the
 * audience, the tone of voice, the year it was founded — plus a line about the
 * business and the area it serves for a site whose SEO entity does not say. {@link resolveBusinessProfile}
 * reads the two together into one picture, field by field, and says where
 * each value came from.
 *
 * ── Where it is stored ────────────────────────────────────────────────────
 *
 * `hosts/{hostId}/businessProfile/profile` for a site and
 * `orgs/{orgId}/businessProfile/defaults` for the workspace, whose values a
 * site inherits where it has none of its own. A subcollection document rather
 * than a key on the host: the host document's `business` map is replaced
 * whole by the contact card's save, and a key beside it would be one more
 * thing a partial write could blank.
 *
 * ── Whose words win ───────────────────────────────────────────────────────
 *
 * Every stored value carries its source. What the owner typed is never
 * replaced by anything else; what the guided start was told replaces only
 * what a generator guessed; and a generator's guess fills only what is empty.
 * {@link mergeBusinessProfilePrefill} is the one place that rule is applied.
 */


/** The host fields the profile reads. A closed surface, as the host tokens' is. */
export interface BusinessProfileHost {
  displayName?: string
  logoUrl?: string
  seo?: { description?: string; entity?: HostSeoEntity | null } | null
  business?: {
    supportEmail?: string
    address?: string
    socialLinks?: Array<{ label?: string; url?: string } | null> | null
  } | null
}

export interface ResolvedBusinessField<T> {
  value: T
  origin: BusinessProfileOrigin
}

/** The picture every reader works from: each field's value and where it came from. */
export interface ResolvedBusinessProfile {
  name: ResolvedBusinessField<string> | null
  whatYouDo: ResolvedBusinessField<string> | null
  services: ResolvedBusinessField<string[]> | null
  serviceArea: ResolvedBusinessField<string> | null
  audience: ResolvedBusinessField<string> | null
  tone: ResolvedBusinessField<BusinessTone> | null
  toneNotes: ResolvedBusinessField<string> | null
  /** The year the business started (AGL-4092). */
  founded: ResolvedBusinessField<string> | null
  /** The schema.org business type the SEO entity names, e.g. `Plumber`. */
  businessType: string | null
  /** Real contact details, each only where the owner entered it in the site's settings. */
  contact: {
    email: string | null
    phone: string | null
    address: string | null
    hours: string | null
  }
  /** The site's social and other profiles, https only. */
  profiles: string[]
  logo: string | null
}


/** The postal address as one line: the SEO entity's parts, else the contact card's block. */
function addressLine(host: BusinessProfileHost | null | undefined): string {
  const parts = host?.seo?.entity?.address
  const line = [
    parts?.streetAddress,
    parts?.addressLocality,
    parts?.addressRegion,
    parts?.postalCode,
    parts?.addressCountry,
  ]
    .map((part) => text(part, 200))
    .filter(Boolean)
    .join(', ')
  return line || text(host?.business?.address, 400)
}

/**
 * The profile as every reader sees it, field by field (AGL-3661):
 *
 * 1. what the OWNER typed into the site's profile;
 * 2. what the site's own settings say (the SEO entity, the contact card, the
 *    display name), which the owner typed too, elsewhere;
 * 3. what the guided start or a generator stored on the site's profile;
 * 4. the workspace defaults.
 *
 * Contact details, the logo and the profiles come from the site's settings
 * only: nothing but the owner's own entry may say how to reach the business.
 */
export function resolveBusinessProfile(input: {
  host: BusinessProfileHost | null | undefined
  site?: BusinessProfileDoc | null
  workspace?: BusinessProfileDoc | null
}): ResolvedBusinessProfile {
  const { host, site, workspace } = input
  const entity = host?.seo?.entity ?? null
  const fromSite: Partial<Record<BusinessProfileField, unknown>> = {
    whatYouDo: text(entity?.description, BUSINESS_PROFILE_MAX_CHARS.whatYouDo),
    serviceArea: normalizeAreaServed(entity?.areaServed).join(', ').slice(0, BUSINESS_PROFILE_MAX_CHARS.serviceArea),
  }

  const resolve = <T>(field: BusinessProfileField): ResolvedBusinessField<T> | null => {
    const stored = businessProfileSourceOf(site, field)
    if (stored === 'owner') return { value: fieldValue(site, field) as T, origin: 'owner' }
    const own = fromSite[field]
    if (own !== undefined && !isEmpty(own)) return { value: own as T, origin: 'site' }
    if (stored) return { value: fieldValue(site, field) as T, origin: stored }
    if (businessProfileSourceOf(workspace, field)) {
      return { value: fieldValue(workspace, field) as T, origin: 'workspace' }
    }
    return null
  }

  const name = text(entity?.name, 200) || text(host?.displayName, 200)
  return {
    name: name ? { value: name, origin: 'site' } : null,
    whatYouDo: resolve<string>('whatYouDo'),
    services: resolve<string[]>('services'),
    serviceArea: resolve<string>('serviceArea'),
    audience: resolve<string>('audience'),
    tone: resolve<BusinessTone>('tone'),
    toneNotes: resolve<string>('toneNotes'),
    founded: resolve<string>('founded'),
    businessType: text(entity?.businessType, 80) || null,
    contact: {
      email: text(entity?.email, 320) || text(host?.business?.supportEmail, 320) || null,
      phone: text(entity?.telephone, 64) || null,
      address: addressLine(host) || null,
      hours: text(entity?.openingHours, 400) || null,
    },
    profiles: siteProfileUrls(host as Parameters<typeof siteProfileUrls>[0]),
    logo: text(host?.logoUrl, 800) || text(entity?.logo, 800) || null,
  }
}

/** Each origin as the profile screen labels it. */
export const BUSINESS_PROFILE_ORIGIN_LABELS: Readonly<Record<BusinessProfileOrigin, string>> = {
  owner: 'You',
  site: 'Site settings',
  start: 'Your answers when the site was started',
  ai: `Suggested by ${PLATFORM_BRAND_NAME} AI`,
  workspace: 'Workspace default',
}
