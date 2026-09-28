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
  type ContentAuthorImageContext,
  type HostSeoEntity,
  type SiteEntityHost,
  AUTHOR_NAME_MAX_LENGTH,
  SITE_ENTITY_FRAGMENT,
  contentAuthorSchemaType,
  hostSeoEntityImageJsonLd,
  siteProfileUrls,
} from './content-authors'
import {
  type LocalBusinessType,
  PAYMENT_ACCEPTED_MAX_LENGTH,
  PRICE_RANGE_MAX_LENGTH,
  localBusinessType,
  normalizeAreaServed,
  parseOpeningHours,
} from './local-business'

/*
 * The SITE entity's JSON-LD: the nested `publisher` and the standalone node.
 *
 * ⛔ Kept apart from `content-authors`, which the compose pipeline reads and
 * therefore ships whole in the site runtime a published page downloads
 * (`check:tenant-wire-weight`). Only the tenant page's server render calls
 * these, and the LocalBusiness allow-list and hours parser they carry
 * (AGL-3383) have no business in a visitor's bundle. Reached through
 * `@aglyn/aglyn/server` only.
 */

/** `content-authors`' trim-and-cap, for the fields this module reads. */
const text = (value: unknown, max = AUTHOR_NAME_MAX_LENGTH): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * The `@type` the SITE entity publishes under — {@link contentAuthorSchemaType}
 * with one refinement (AGL-3383): an entity that is not a Person and names a
 * business type on the allow-list publishes as that type.
 *
 * Person wins over a business type, because `schema.org` gives a Person none
 * of the properties a business type exists to carry. The stored `type` stays
 * Organization or Person either way; every LocalBusiness subtype IS an
 * Organization, so a consumer reading this as one is still right.
 *
 * Shared by the standalone node and the nested `publisher`, which carry the
 * same `@id` and must therefore not disagree about what they are.
 */
export function siteEntitySchemaType(
  entity: HostSeoEntity | null | undefined,
): 'Person' | 'Organization' | LocalBusinessType {
  const base = contentAuthorSchemaType(entity?.type)
  if (base === 'Person') return base
  return localBusinessType(entity?.businessType) ?? base
}

/**
 * `schema.org` JSON-LD for the SITE entity (`host.seo.entity`) — the value
 * `Article.publisher` and `WebSite.publisher` are built from.
 *
 * Lives beside {@link contentAuthorJsonLd} on purpose (AGL-2486): a site
 * entity and a post author answer the same question about two different
 * subjects, and the reason the Person branch was broken for two years is that
 * the answer was written inline at its one call site where nothing could
 * test it. One module, two entry points, one `Person`/`Organization`
 * decision — {@link contentAuthorSchemaType}.
 *
 * `logo` is emitted verbatim on BOTH branches, unchanged from what the tenant
 * has always published. It is `host.seo.entity.logo`, a plain URL field on
 * the Setup form rather than a media-picker target, and re-keying it to
 * `image` for a Person would change the publisher block on every page of
 * every site that set one — a separate decision from this one.
 */
export function hostSeoEntityJsonLd(
  entity: HostSeoEntity | null | undefined,
): Record<string, unknown> | undefined {
  const name = text(entity?.name, 400)
  if (!name) return undefined
  return {
    '@type': siteEntitySchemaType(entity),
    name,
  }
}

/**
 * The site's publisher as a STANDALONE, fully populated `schema.org` node
 * (AGL-2716).
 *
 * ## Why this exists next to {@link hostSeoEntityJsonLd}
 *
 * That function builds the value `publisher` takes: a `@type` and a `name`,
 * nested inside a `WebSite` or an `Article`, gated on the author having filled
 * in the Entity form. It is deliberately narrow, and every call site nests it.
 *
 * A consumer asking "who runs this site, and how do I reach them" — an AI
 * assistant answering a contact question, a readiness audit checking whether a
 * business is identifiable — looks for a TOP-LEVEL node of type `Organization`
 * carrying `name`, `description`, `contactPoint` and `address`. A publisher
 * nested two levels inside a `WebSite` answers a different question, and a
 * publisher that is absent because nobody filled in a form answers none.
 *
 * So this one:
 *
 * - is emitted as its own `<script type="application/ld+json">`, at the top
 *   level, where it can be found without walking into another node;
 * - FALLS BACK to the site's own identity when the Entity form is empty, so
 *   every site on the platform publishes a complete entity rather than only
 *   the sites whose author found the form;
 * - carries the contact and address fields, which are what turn "a name" into
 *   "a business a consumer can verify".
 *
 * ## Why the fallback is safe
 *
 * It changes nothing that already exists: `hostSeoEntityJsonLd` still gates on
 * `entity.name`, so `publisher` appears exactly where it appeared before. The
 * fallback only decides what THIS node says, and a site's display name is its
 * publisher's name on the overwhelming majority of sites — the two differ when
 * a company's trading name differs from its site's, which is precisely the case
 * the Entity form exists to express.
 *
 * ## `@id`
 *
 * Both this node and the nested `publisher` carry the same `@id` when an
 * origin is known, so a consumer merges them into one entity instead of
 * reading a site that names its publisher twice with different detail.
 *
 * Returns `undefined` only when there is no name to be had from anywhere —
 * a host document with no entity, no display name and no SEO title.
 */
export function siteEntityJsonLd(
  host: SiteEntityHost | null | undefined,
  context?: ContentAuthorImageContext,
): Record<string, unknown> | undefined {
  const entity = host?.seo?.entity ?? undefined
  const name =
    text(entity?.name, 400) ||
    text(host?.displayName, 400) ||
    text(host?.seo?.title, 400)
  if (!name) return undefined

  const origin = context?.origin?.replace(/\/+$/, '') ?? ''
  const description =
    text(entity?.description, 800) || text(host?.seo?.description, 800)
  const url = text(entity?.url, 800) || origin

  /*
    `sameAs` is de-duplicated and https-only, matching the author serializer:
    a profile URL that is not fetchable teaches a consumer nothing, and the
    same profile listed twice reads as two identities.

    Through `siteProfileUrls` (AGL-3148) so the site's rendered social links
    count as profiles it claims, rather than only the SEO field that no host
    on the platform had filled in.
  */
  const sameAs = siteProfileUrls(host)

  /*
    A contactPoint needs something to contact. `contactType` alone is a label
    on nothing, so the point is emitted only when an address or a number is
    present — `schema.org` requires neither, and a consumer that finds a
    ContactPoint with no channel has been told less than it would learn from
    its absence.
  */
  const email = text(entity?.email, 320)
  const telephone = text(entity?.telephone, 64)
  const contactType = text(entity?.contactType, 120) || 'customer support'
  const contactPoint =
    email || telephone
      ? {
          '@type': 'ContactPoint',
          contactType,
          ...(email ? { email } : {}),
          ...(telephone ? { telephone } : {}),
        }
      : undefined

  const addressFields = {
    streetAddress: text(entity?.address?.streetAddress, 200),
    addressLocality: text(entity?.address?.addressLocality, 120),
    addressRegion: text(entity?.address?.addressRegion, 120),
    postalCode: text(entity?.address?.postalCode, 40),
    addressCountry: text(entity?.address?.addressCountry, 120),
  }
  const address = Object.entries(addressFields).filter(([, value]) => value)
  const schemaType = siteEntitySchemaType(entity)
  const business =
    schemaType !== 'Person' && schemaType !== 'Organization'
      ? localBusinessJsonLd(entity, telephone)
      : {}

  return {
    '@context': 'https://schema.org',
    '@type': schemaType,
    ...(origin ? { '@id': `${origin}/${SITE_ENTITY_FRAGMENT}` } : {}),
    name,
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
    // `logo` for an Organization, `image` for a Person — the one field whose
    // KEY the branch changes. Shared with the nested publisher so the two
    // nodes cannot describe the same entity with different pictures.
    ...hostSeoEntityImageJsonLd(entity, context),
    ...(sameAs.length ? { sameAs } : {}),
    ...(contactPoint ? { contactPoint } : {}),
    ...(address.length
      ? { address: { '@type': 'PostalAddress', ...Object.fromEntries(address) } }
      : {}),
    ...business,
  }
}

/**
 * The properties only a LocalBusiness carries (AGL-3383), spread after
 * everything an Organization publishes so an Organization's output is
 * unchanged key for key.
 *
 * - `telephone` on the node itself as well as on its `contactPoint`: a
 *   LocalBusiness has the property directly, and it is where a local result
 *   reads the number from.
 * - `areaServed` as named `City` places. A service-area business commonly has
 *   no street address to publish, and this is what says where it works.
 * - `openingHoursSpecification` from the hours text, invalid lines dropped.
 *
 * Every one of them is omitted when empty, never published as `[]` or `''`.
 */
function localBusinessJsonLd(
  entity: HostSeoEntity | null | undefined,
  telephone: string,
): Record<string, unknown> {
  const areaServed = normalizeAreaServed(entity?.areaServed)
  const hours = parseOpeningHours(entity?.openingHours)
  const priceRange = text(entity?.priceRange, PRICE_RANGE_MAX_LENGTH)
  const paymentAccepted = text(
    entity?.paymentAccepted,
    PAYMENT_ACCEPTED_MAX_LENGTH,
  )
  return {
    ...(telephone ? { telephone } : {}),
    ...(areaServed.length
      ? { areaServed: areaServed.map((name) => ({ '@type': 'City', name })) }
      : {}),
    ...(hours.length
      ? {
          openingHoursSpecification: hours.map((row) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: row.days,
            opens: row.opens,
            closes: row.closes,
          })),
        }
      : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(paymentAccepted ? { paymentAccepted } : {}),
  }
}
