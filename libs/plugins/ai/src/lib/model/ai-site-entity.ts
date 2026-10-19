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

import type { LocalBusinessType } from '@aglyn/aglyn/app-utils/local-business'
import { HostEntityType } from '@aglyn/aglyn/foundation/definitions/platform.types'
import { aiSiteAddressLine, aiSiteDetailsOf, aiSiteHoursSentence, aiSiteServiceAreas } from './ai-site-details'
import { aiSiteKindOfInputs } from './ai-site-kinds'
import { aiSiteSeoProposalForInputs, AI_SITE_SEO_FORM_FIELDS } from './ai-site-start-seo'

/**
 * Who publishes a site a guided start built, as its structured data and its
 * `/llms.txt` say (AGL-3979).
 *
 * Every tenant page publishes a top-level Organization (or Person) node, and
 * `/llms.txt` carries the site's agent guidance, both read off the host's
 * Setup → SEO → Entity and AI agents fields (`siteEntityJsonLd`,
 * `buildLlmsTxt`). Before this, a guided start wrote none of those fields:
 * every AI-built site published a node holding its name and nothing else — no
 * contact point, no address, no business type — and the guidance was the
 * platform's own default. The answers the person gave are the facts those
 * fields ask for, so the publish writes them.
 *
 * ── Derived, never generated ─────────────────────────────────────────────
 *
 * Each value is the person's own words or arithmetic on them: the schema
 * type from the kind of site they picked (and, for a few kinds, the words
 * they used), the description from the same composition as the site's
 * search listing, the guidance from what they said and gave. No model is
 * asked, and nothing is invented: a field the answers say nothing about is
 * left alone.
 *
 * ── Never over the owner ─────────────────────────────────────────────────
 *
 * {@link aiSiteEntityUpdates} writes only fields that are empty, so a site
 * whose owner already filled its Entity keeps every word of it, and a second
 * publish (Try again) writes nothing it wrote before.
 *
 * Pure: no Firestore and no React.
 */

/** How a kind of site publishes: as a person, or as a business of a `schema.org` LocalBusiness type. */
interface KindSchema {
  person?: true
  businessType?: LocalBusinessType
  /** A narrower type the person's words name, first match wins. */
  refine?: ReadonlyArray<readonly [RegExp, LocalBusinessType]>
}

/**
 * Each `AI_SITE_KINDS` entry's `schema.org` type (`ai-site-entity.spec.ts`
 * holds every kind to an entry). A kind with no business type publishes as an
 * Organization — a blog, a band, an event, a course — unless the person gave
 * a street address or opening hours, which make it a place a visitor goes:
 * a LocalBusiness. Only types on the platform's `LOCAL_BUSINESS_TYPES` list
 * are used, since only those publish.
 */
export const AI_SITE_KIND_SCHEMA: Readonly<Record<string, KindSchema>> = {
  business: {
    businessType: 'LocalBusiness',
    refine: [
      [/\b(?:marketing|consult\w*|agency|freelanc\w*|staffing|bookkeep\w*|design(?:er)?s?)\b/i, 'ProfessionalService'],
      [/\b(?:car wash|detailing|auto repair|mechanic|tire|tyre)\b/i, 'AutomotiveBusiness'],
    ],
  },
  trades: {
    businessType: 'HomeAndConstructionBusiness',
    refine: [
      [/\bplumb\w*/i, 'Plumber'],
      [/\belectric\w*/i, 'Electrician'],
      [/\b(?:hvac|heating|air condition\w*|furnace)\b/i, 'HVACBusiness'],
      [/\broof\w*/i, 'RoofingContractor'],
      [/\bpaint\w*/i, 'HousePainter'],
      [/\blocksmith\w*/i, 'Locksmith'],
      [/\bmov(?:ing|ers?)\b/i, 'MovingCompany'],
      [/\b(?:contractor|remodel\w*|renovat\w*|builders?|construction)\b/i, 'GeneralContractor'],
    ],
  },
  professional: {
    businessType: 'ProfessionalService',
    refine: [
      [/\b(?:law|lawyers?|attorneys?|legal|solicitors?)\b/i, 'LegalService'],
      [/\b(?:accounting|accountants?|bookkeep\w*|tax|cpa)\b/i, 'AccountingService'],
    ],
  },
  wellness: {
    businessType: 'HealthAndBeautyBusiness',
    refine: [
      [/\b(?:dentist\w*|dental|orthodont\w*)\b/i, 'Dentist'],
      [/\b(?:clinic|doctors?|physicians?|medical|therap\w*|chiropract\w*|physio\w*|counsel\w*)\b/i, 'MedicalBusiness'],
    ],
  },
  restaurant: {
    businessType: 'Restaurant',
    refine: [[/\b(?:caf[eé]s?|coffee|bakery|bakeries|bars?|brewery|food truck|deli)\b/i, 'FoodEstablishment']],
  },
  store: { businessType: 'Store' },
  portfolio: {},
  studio: { businessType: 'ProfessionalService' },
  photography: { businessType: 'ProfessionalService' },
  blog: {},
  events: {},
  fitness: { businessType: 'SportsActivityLocation' },
  yoga: { businessType: 'SportsActivityLocation' },
  beauty: { businessType: 'HealthAndBeautyBusiness' },
  realestate: { businessType: 'RealEstateAgent' },
  education: { refine: [[/\b(?:day ?care|child ?care|preschool|nursery)\b/i, 'ChildCare']] },
  nonprofit: { refine: [[/\b(?:animal (?:shelter|rescue)|pet rescue)\b/i, 'AnimalShelter']] },
  music: {},
  personal: { person: true },
  landing: {},
  'coming-soon': {},
}

/** The schema a site's answers publish under: a Person, or an Organization with a business type or none. */
export interface AiSiteSchema {
  person: boolean
  businessType: LocalBusinessType | null
}

/** What a job's inputs say the site publishes as. */
export function aiSiteSchemaOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiSiteSchema {
  const kind = aiSiteKindOfInputs(inputs)
  const entry = (kind && AI_SITE_KIND_SCHEMA[kind.id]) || {}
  if (entry.person) return { person: true, businessType: null }
  const words = [inputs?.['businessType'], inputs?.['audience']].filter((value) => typeof value === 'string').join(' ')
  const refined = entry.refine?.find(([pattern]) => pattern.test(words))?.[1]
  const details = aiSiteDetailsOf(inputs)
  const place = Boolean(details.street || details.hours)
  return { person: false, businessType: refined ?? entry.businessType ?? (place ? 'LocalBusiness' : null) }
}

/** The Entity and AI-agent values a job's answers give; a field they say nothing about is `''` or `[]`. */
export interface AiSiteEntityValues {
  person: boolean
  name: string
  description: string
  email: string
  telephone: string
  address: {
    streetAddress: string
    addressLocality: string
    addressRegion: string
    postalCode: string
    addressCountry: string
  }
  businessType: string
  areaServed: string[]
  openingHours: string
  priceRange: string
  sameAs: string[]
  whenToUse: string
  howToUse: string
}

const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/** "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * The site's agent guidance from its answers (AGL-3979): when an agent should
 * use the site — what the business is, then what the site answers — and,
 * where the person gave a way to reach it, how to reach a person. Written in
 * English, as the rest of `/llms.txt` is.
 */
export function aiSiteAgentGuidance(input: {
  name: string
  description: string
  areas: readonly string[]
  hours: boolean
  prices: boolean
  languages: string
  phone: string
  email: string
  address: string
}): { whenToUse: string; howToUse: string } {
  const who = input.name || 'this business'
  const answers = [
    `what ${who} offers`,
    ...(input.areas.length ? [`the areas it serves (${input.areas.slice(0, 6).join(', ')})`] : []),
    ...(input.hours ? ['its opening hours'] : []),
    ...(input.prices ? ['its prices'] : []),
    'how to get in touch',
  ]
  // A site the answers say nothing about gets no guidance: the platform's own
  // derived "When to use this site" says more than a sentence about nobody.
  const said = Boolean(input.name || input.description)
  const when = said
    ? [
        input.description,
        `Use this site for ${listed(answers)}.`,
        input.languages ? `It serves customers in ${input.languages.replace(/[.\s]+$/, '')}.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : ''
  const reach = [input.phone ? `call ${input.phone}` : '', input.email ? `email ${input.email}` : ''].filter(Boolean)
  const how = [
    reach.length ? `To reach a person at ${who}, ${reach.join(' or ')}.` : '',
    input.address ? `${input.name || 'The business'} is at ${input.address}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return { whenToUse: when, howToUse: how }
}

/** The Entity and AI-agent values a site job's inputs imply, in the language its plan writes the site in. */
export function aiSiteEntityValues(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
  options: { language?: string | null } = {},
): AiSiteEntityValues {
  const details = aiSiteDetailsOf(inputs)
  const schema = aiSiteSchemaOf(inputs)
  const name = text(inputs?.['businessName'])
  const city = text(inputs?.['city'])
  const listing = aiSiteSeoProposalForInputs(inputs, options.language ?? null)
  const description = listing?.values[AI_SITE_SEO_FORM_FIELDS.description] ?? ''
  const areas = aiSiteServiceAreas(details.serviceArea)
  // A business that names no other area serves the city it is in.
  const areaServed = schema.businessType ? (areas.length ? areas : city ? [city] : []) : []
  const sameAs = details.social ? details.social.split('\n').filter(Boolean) : []
  const address = details.street ? aiSiteAddressLine(details, city) : ''
  const guidance = aiSiteAgentGuidance({
    name,
    description,
    areas,
    hours: Boolean(aiSiteHoursSentence(details.hours)),
    prices: Boolean(details.priceRange),
    languages: details.languages,
    phone: details.phone,
    email: details.email,
    address,
  })
  return {
    person: schema.person,
    name,
    description,
    email: details.email,
    telephone: details.phone,
    address: {
      streetAddress: details.street,
      // The city is where the business is only where it gave a street to be on.
      addressLocality: details.street || details.postalCode ? city : '',
      addressRegion: details.region,
      postalCode: details.postalCode,
      addressCountry: details.country,
    },
    businessType: schema.businessType ?? '',
    areaServed,
    openingHours: details.hours,
    priceRange: details.priceRange,
    sameAs,
    ...guidance,
  }
}

const isBlank = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && !value.some((entry) => typeof entry === 'string' && entry.trim()))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The host updates that put a start's Entity and AI-agent values on its site,
 * as field paths (`seo.entity.telephone`), for the publish's own batch: only
 * fields that are empty on the site, so nothing the owner wrote is replaced.
 * The address is written whole or not at all — a start's street beside the
 * owner's own city would be an address of neither. `{}` when there is
 * nothing to write.
 */
export function aiSiteEntityUpdates(seo: unknown, values: AiSiteEntityValues): Record<string, unknown> {
  const current = isRecord(seo) ? seo : {}
  const entity = isRecord(current['entity']) ? current['entity'] : {}
  const agent = isRecord(current['agent']) ? current['agent'] : {}
  const updates: Record<string, unknown> = {}
  const fill = (path: string, now: unknown, next: string | string[]) => {
    if (!isBlank(next) && isBlank(now)) updates[path] = next
  }
  const person = values.person && isBlank(entity['type'])
  // As the Setup form's select stores it: the enum's value as text.
  if (person) updates['seo.entity.type'] = String(HostEntityType.PERSON)
  fill('seo.entity.name', entity['name'], values.name)
  fill('seo.entity.description', entity['description'], values.description)
  fill('seo.entity.email', entity['email'], values.email)
  fill('seo.entity.telephone', entity['telephone'], values.telephone)
  const address = isRecord(entity['address']) ? entity['address'] : {}
  if (Object.values(address).every(isBlank)) {
    for (const [field, value] of Object.entries(values.address)) {
      if (value) updates[`seo.entity.address.${field}`] = value
    }
  }
  // A Person carries none of a business's fields (`siteEntityJsonLd`).
  const isPerson = person || Number(entity['type']) === HostEntityType.PERSON
  if (!isPerson) {
    fill('seo.entity.businessType', entity['businessType'], values.businessType)
    fill('seo.entity.areaServed', entity['areaServed'], values.areaServed)
    fill('seo.entity.openingHours', entity['openingHours'], values.openingHours)
    fill('seo.entity.priceRange', entity['priceRange'], values.priceRange)
  }
  fill('seo.entity.sameAs', entity['sameAs'], values.sameAs)
  fill('seo.agent.whenToUse', agent['whenToUse'], values.whenToUse)
  fill('seo.agent.howToUse', agent['howToUse'], values.howToUse)
  return updates
}
