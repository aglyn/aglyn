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

import * as Aglyn from '@aglyn/aglyn/server'
import { deferLazyPanelNodes } from '@aglyn/tenant-runtime/defer-lazy-panels'
import type { Metadata } from 'next'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { Suspense } from 'react'
import CatchAllClient from './catch-all-client'
import { loadPageData } from './load-page-data'
import type { Props } from './types'

// ISR: the old getStaticPaths used `fallback: 'blocking'` with per-page
// revalidate 60s. generateStaticParams returns nothing (nothing prebuilt);
// every path server-renders on demand and caches for `revalidate` seconds.
export const revalidate = 60
export const dynamicParams = true

/**
 * Headroom for a cold render (AGL-1152). The platform default is 10 s, and the
 * first request against a fresh instance was exceeding it — Vercel then serves
 * `502 BAD_GATEWAY` ("Task timed out after 10 seconds", confirmed in runtime
 * errors on this route), so the visitor got a broken page rather than a slow
 * one.
 *
 * This is the safety net, NOT the fix: the render is now roughly half the work
 * it was (see `loadPageDataCached`), which is what should keep a cold render
 * well inside the limit. Raising the ceiling only changes the failure mode from
 * an error page to a slow page that then caches for `revalidate` seconds — a
 * strictly better way to lose.
 */
export const maxDuration = 60

export function generateStaticParams() {
  return []
}

type CatchAllPageProps = {
  params: Promise<{ host: string; slug?: string[] }>
}

/**
 * Metadata replaces the Pages Router `<Head>` blocks (no-ops in the App
 * Router). Derived server-side from the same composed props — screen SEO
 * with host-level defaults, noindex for the gated/soft-404 surfaces.
 */
function buildMetadata(props: Props): Metadata {
  const host = props.data?.host as any
  const screen = props.data?.screen?.data as any
  const siteTitle: string | undefined = host?.seo?.title ?? host?.displayName
  const separator: string = host?.seo?.separator ?? ' – '
  // White-label (White-Label Phase 2): the generic title fallback reads the
  // org's resolved brand name rather than a hard-coded "Aglyn", so a
  // white-label site with no SEO/display title never leaks the Aglyn brand
  // into its <title>/OG. `branding` is Aglyn defaults for non-white-label
  // orgs and absent surfaces, resolved through the one shared resolver.
  const brandName = props.branding?.productName ?? 'Aglyn'
  const withSite = (title?: string) =>
    [title, siteTitle].filter(Boolean).join(separator) || `${brandName} site`

  // Site-wide "discourage search engines" (AGL-1263). Read up here, above the
  // early returns, because it has to reach the CONTENT branch too: collection
  // lists and blog entries emitted no robots directive at all, so a discouraged
  // site would have gone dark everywhere except the pages people actually link
  // to from elsewhere.
  const searchDiscouraged = Aglyn.isSearchDiscouraged(host)

  // Gated / fixed surfaces stay out of search (AGL-87/109/131).
  if (props.membershipPage) {
    return {
      title:
        props.membershipPage === 'signup'
          ? 'Sign up'
          : props.membershipPage === 'recover'
            ? 'Reset your password'
            : 'Sign in',
      robots: { index: false, follow: true },
    }
  }
  if (props.maintenanceFallback) {
    return { title: 'Temporarily unavailable', robots: { index: false } }
  }
  if (props.memberScreen) {
    return { title: 'Members only', robots: { index: false, follow: true } }
  }

  // Content collections (AGL-81/117): entry metadata drives the head.
  // Entry model v2 (AGL-582): per-entry SEO overrides with title/excerpt
  // fallbacks, and the cover image as the social card.
  if (props.content) {
    const content = props.content as any
    const entry = content.entry
    const title = entry
      ? entry.seoTitle || entry.title
      : content.collection?.displayName
    const description: string | undefined = entry
      ? entry.seoDescription || entry.excerpt || undefined
      : undefined
    const socialImage: string | undefined = entry?.coverImage || undefined
    const fullTitle = withSite(title)
    // Collection pages had NO canonical at all (AGL-1272). This branch returns
    // before the screen path builds one, so every `/blog` and `/blog/{entry}`
    // shipped without the tag — on a site reachable at two origins, that is
    // exactly the set of pages with the most duplicate URLs and the least to
    // say about which one counts. The redirect handles the platform-subdomain
    // twin; this handles the rest (a paginated list is its own page, and an
    // entry reachable through more than one route still resolves to one URL).
    //
    // Derived, not passed: entry routing is `/{collection}/{entry}` and lists
    // are `/{collection}` (`/{collection}/page/{n}` beyond page 1), the same
    // derivation `buildJsonLd` already makes from this payload.
    const collectionBase = Aglyn.hostPublicOrigin(host)
    const collectionSlug: string | undefined = content.collection?.slug
    const listPage = Number(content.pagination?.page) || 1
    const contentCanonical =
      collectionBase && collectionSlug
        ? entry?.slug
          ? `${collectionBase}/${collectionSlug}/${entry.slug}`
          : listPage > 1
            ? `${collectionBase}/${collectionSlug}/page/${listPage}`
            : `${collectionBase}/${collectionSlug}`
        : undefined
    return {
      title: fullTitle,
      ...(description ? { description } : {}),
      ...(searchDiscouraged ? { robots: { index: false, follow: true } } : {}),
      ...(contentCanonical
        ? { alternates: { canonical: contentCanonical } }
        : {}),
      openGraph: {
        title: fullTitle,
        ...(description ? { description } : {}),
        type: entry ? 'article' : 'website',
        ...(contentCanonical ? { url: contentCanonical } : {}),
        ...(socialImage ? { images: [socialImage] } : {}),
        ...(siteTitle ? { siteName: siteTitle } : {}),
      },
      twitter: {
        card: socialImage ? 'summary_large_image' : 'summary',
        ...(socialImage ? { images: [socialImage] } : {}),
      },
    }
  }

  // Screen render (SEO Toolkit): screen fields with host-level fallbacks.
  const pageTitle: string | undefined = screen?.seo?.title || screen?.displayName
  const fullTitle = withSite(pageTitle)
  const description: string | undefined =
    screen?.seo?.description || screen?.description || host?.seo?.description
  const socialImage: string | undefined =
    screen?.seo?.image || host?.seo?.image || undefined
  // One policy, four surfaces (AGL-1263): this, the client twin in
  // `catch-all-client.tsx`, `robots.txt` and `sitemap.xml` all ask
  // `isPageIndexable` rather than each keeping their own copy of the rule.
  const noindex =
    !Aglyn.isPageIndexable({ host, screen }) ||
    props.notFoundFallback ||
    props.protectedScreen
  // Shared with the client twin and the email renderer (AGL-1224) — three
  // copies of "which name does this site answer to" would drift.
  const canonicalBase = Aglyn.hostPublicOrigin(host)
  const screenPath = screen?.$id ? host?.screens?.[screen.$id] : undefined
  const canonical =
    canonicalBase && screenPath != null
      ? `${canonicalBase}${Aglyn.screenRoutePathToUrl(screenPath)}`
      : undefined

  // hreflang alternates (AGL-164): the Pages Router emitted `<link
  // rel="alternate" hreflang>` from the inert <Head>; the App Router routes
  // them through `alternates.languages`. Variants resolve through the
  // routing map so slug renames stay correct; the current screen registers
  // under its own locale (or x-default).
  const localeVariants = screen?.localeVariants as
    | Record<string, string>
    | undefined
  const languages: Record<string, string> = {}
  if (canonicalBase && localeVariants) {
    for (const [locale, variantId] of Object.entries(localeVariants)) {
      const variantPath = host?.screens?.[variantId]
      if (variantPath != null) {
        languages[locale] = `${canonicalBase}${Aglyn.screenRoutePathToUrl(variantPath)}`
      }
    }
    if (canonical) languages[screen?.locale || 'x-default'] = canonical
  }
  const hasLanguages = Object.keys(languages).length > 0
  const alternates = {
    ...(canonical ? { canonical } : {}),
    ...(hasLanguages ? { languages } : {}),
  }

  return {
    title: fullTitle,
    ...(description ? { description } : {}),
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    ...(canonical || hasLanguages ? { alternates } : {}),
    openGraph: {
      title: fullTitle,
      ...(description ? { description } : {}),
      type: 'website',
      ...(canonical ? { url: canonical } : {}),
      ...(socialImage ? { images: [socialImage] } : {}),
      ...(siteTitle ? { siteName: siteTitle } : {}),
    },
    twitter: {
      card: socialImage ? 'summary_large_image' : 'summary',
      ...(socialImage ? { images: [socialImage] } : {}),
    },
  }
}

/**
 * Structured data (AGL-143). The Metadata API has no JSON-LD slot, so the
 * Pages Router `<Head>` `<script type="application/ld+json">` blocks (inert
 * under the App Router) are rebuilt here and rendered server-side in the page
 * body: an `Article` for content entries, otherwise a `WebSite` for the host
 * plus a `BreadcrumbList` for nested screen paths. Gated surfaces (membership,
 * maintenance, members-only) emit nothing, matching the old markup.
 */
function buildJsonLd(props: Props): string[] {
  if (props.membershipPage || props.maintenanceFallback || props.memberScreen) {
    return []
  }
  const host = props.data?.host as any
  const canonicalBase = host?.cname
    ? `https://${host.cname}`
    : host?.subdomain
      ? `https://${host.subdomain}.aglyn.app`
      : undefined
  const publisher = host?.seo?.entity?.name
    ? {
        '@type':
          host.seo.entity.type === Aglyn.HostEntityType.PERSON
            ? 'Person'
            : 'Organization',
        name: host.seo.entity.name,
      }
    : undefined

  // Content entry → Article; collection list → ItemList (AGL-660).
  if (props.content) {
    const content = props.content as any
    const entry = content.entry
    const collectionSlug: string | undefined = content.collection?.slug
    // Entry routing is /{collectionSlug}/{entrySlug} (list is
    // /{collectionSlug}), so entry URLs are derivable rather than guessed.
    const entryUrl = (slug?: string) =>
      canonicalBase && collectionSlug && slug
        ? `${canonicalBase}/${collectionSlug}/${slug}`
        : undefined

    // A list page carries `entries` but no `entry`, and used to emit nothing
    // at all — so /blog had no structured data whatsoever.
    if (!entry) {
      const entries: any[] = Array.isArray(content.entries)
        ? content.entries
        : []
      if (!canonicalBase || !collectionSlug || entries.length === 0) return []
      return [
        Aglyn.safeJsonLd({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: content.collection?.displayName ?? collectionSlug,
          url: `${canonicalBase}/${collectionSlug}`,
          numberOfItems: entries.length,
          itemListElement: entries.map((item, index) => ({
            '@type': 'ListItem',
            // Position is 1-based and must reflect the page the reader is
            // on, or paginated lists all claim positions 1..n.
            position:
              ((Number(content.pagination?.page) || 1) - 1) *
                (Number(content.pagination?.perPage) || entries.length) +
              index +
              1,
            ...(entryUrl(item.slug) && { url: entryUrl(item.slug) }),
            name: item.title,
          })),
        }),
      ]
    }
    // Category name resolves against the collection taxonomy (AGL-582):
    // stable categoryId lookup first, legacy free-typed string fallback.
    const categoryName = Aglyn.resolveEntryCategoryName(
      entry,
      content.collection?.categories,
    )
    const articleUrl = entryUrl(entry.slug)
    return [
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: entry.title,
        ...(entry.excerpt && { description: entry.excerpt }),
        ...(entry.coverImage && { image: [entry.coverImage] }),
        // Entry model v2 (AGL-582): taxonomy enriches rich results.
        ...(categoryName && { articleSection: categoryName }),
        ...(Array.isArray(entry.tags) &&
          entry.tags.length && { keywords: entry.tags.join(', ') }),
        ...(entry.publishedAt?.seconds && {
          datePublished: new Date(
            entry.publishedAt.seconds * 1000,
          ).toISOString(),
        }),
        ...(entry.updatedAt?.seconds && {
          dateModified: new Date(entry.updatedAt.seconds * 1000).toISOString(),
        }),
        // Byline (AGL-686): the entry's own author when the editor set one,
        // otherwise the site. Every post used to attribute to the same
        // entity, which is not what Article.author means.
        ...(entry.authorName
          ? { author: { '@type': 'Person', name: entry.authorName } }
          : publisher
            ? { author: publisher }
            : {}),
        // The site remains the PUBLISHER regardless — that is the org that
        // put the piece out, distinct from who wrote it.
        ...(publisher && {
          publisher: {
            ...publisher,
            ...(host?.seo?.entity?.logo && { logo: host.seo.entity.logo }),
          },
        }),
        // Google wants an article to say which page it IS — without these it
        // is a floating description with no canonical anchor.
        ...(articleUrl && {
          url: articleUrl,
          mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
        }),
      }),
    ]
  }

  // Screen render → WebSite (+ BreadcrumbList for nested paths).
  const ld: string[] = []

  // Product detail → Product/Offer (AGL-660). Emitted HERE, on the server,
  // from the payload the commerce resolver already resolved (AGL-659). The
  // PDP block used to build this from client state, so it never reached the
  // HTML a crawler reads — which is the whole point of product structured
  // data (rich results, Merchant listings).
  const seededCommerce = (
    props.pageData as
      | {
          commerce?: {
            product?: {
              name: string
              slug: string
              description?: string
              mediaUrls?: string[]
              variants?: Array<{
                priceUsd: number
                soldOut?: boolean
                sku?: string
              }>
            }
            reviews?: { aggregate?: { count: number; average: number } }
          }
        }
      | undefined
  )?.commerce
  const seededProduct = seededCommerce?.product
  if (seededProduct && canonicalBase) {
    const prices = (seededProduct.variants ?? [])
      .map((variant) => Number(variant.priceUsd))
      .filter((price) => Number.isFinite(price))
    const low = prices.length ? Math.min(...prices) : undefined
    const high = prices.length ? Math.max(...prices) : undefined
    // Out of stock only when EVERY variant is — one available size still
    // makes the product purchasable.
    const inStock = (seededProduct.variants ?? []).some(
      (variant) => !variant.soldOut,
    )
    const availability = `https://schema.org/${
      inStock ? 'InStock' : 'OutOfStock'
    }`
    const variants = seededProduct.variants ?? []
    const skus = variants
      .map((variant) => variant.sku)
      .filter((value): value is string => Boolean(value))
    // One variant, one SKU — anything else is ambiguous (see below).
    const sku = variants.length === 1 && skus.length === 1 ? skus[0] : undefined
    const ratingAggregate = seededCommerce?.reviews?.aggregate
    ld.push(
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: seededProduct.name,
        ...(seededProduct.description && {
          description: seededProduct.description,
        }),
        ...(seededProduct.mediaUrls?.length && {
          image: seededProduct.mediaUrls,
        }),
        url: `${canonicalBase}/products/${seededProduct.slug}`,
        ...(publisher && { brand: publisher }),
        // `sku` only when it is unambiguous (AGL-686). Schema.org Product.sku
        // is a single value, but a SKU belongs to a VARIANT — emitting the
        // first of several would advertise one variant's code for the whole
        // product, which is worse than omitting it. Multi-variant products
        // want a ProductGroup, which is a larger modelling change.
        ...(sku && { sku }),
        // Rating nested as a PROPERTY of the product (AGL-686). The reviews
        // block used to emit a free-standing AggregateRating node, which is
        // orphaned and ignored. Only emitted when reviews exist — Google
        // rejects a rating with no reviews behind it.
        ...(ratingAggregate?.count
          ? {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: ratingAggregate.average,
                reviewCount: ratingAggregate.count,
              },
            }
          : {}),
        // Currency isn't modelled on the product yet, so USD is assumed —
        // the same assumption the client block made. Revisit with
        // multi-currency.
        ...(low != null && {
          offers:
            low === high
              ? {
                  '@type': 'Offer',
                  price: low,
                  priceCurrency: 'USD',
                  availability,
                  url: `${canonicalBase}/products/${seededProduct.slug}`,
                }
              : {
                  '@type': 'AggregateOffer',
                  lowPrice: low,
                  highPrice: high,
                  priceCurrency: 'USD',
                  offerCount: prices.length,
                  availability,
                },
        }),
      }),
    )
  }

  const screen = props.data?.screen?.data as any
  const siteTitle: string | undefined = host?.seo?.title ?? host?.displayName
  if (canonicalBase) {
    ld.push(
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteTitle ?? host?.displayName ?? 'Site',
        url: canonicalBase,
        ...(host?.seo?.entity?.name && {
          publisher: {
            ...publisher,
            ...(host.seo.entity.logo && { logo: host.seo.entity.logo }),
          },
        }),
      }),
    )
  }
  const screenPath = screen?.$id ? host?.screens?.[screen.$id] : undefined
  const segments =
    typeof screenPath === 'string' ? screenPath.split('/').filter(Boolean) : []
  if (canonicalBase && segments.length > 1) {
    ld.push(
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: segments.map((segment, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: segment,
          item: `${canonicalBase}/${segments.slice(0, index + 1).join('/')}`,
        })),
      }),
    )
  }
  return ld
}

export async function generateMetadata({
  params,
}: CatchAllPageProps): Promise<Metadata> {
  const { host, slug } = await params
  const result = await loadPageData(host, slug ?? [])
  return 'props' in result ? buildMetadata(result.props) : {}
}

/**
 * Catch-all tenant site render (AGL-398), migrated from the Pages Router
 * `[[...slug]]` + getStaticProps. The server loader composes the page and
 * this route maps its result to `notFound()` / `redirect()` / the client
 * renderer. Metadata comes from `generateMetadata`; the two share one
 * `cache`d `loadPageData` call per request — which only holds because the
 * loader keys its cache on a primitive. Passing the slug ARRAY straight through
 * silently defeats that and doubles every render (AGL-1152).
 */
export default async function CatchAllPage({ params }: CatchAllPageProps) {
  const { host, slug } = await params
  const result = await loadPageData(host, slug ?? [])
  if ('notFound' in result) notFound()
  if ('redirect' in result) {
    const { destination, statusCode } = result.redirect
    if (statusCode === 301 || statusCode === 308) permanentRedirect(destination)
    redirect(destination)
  }
  const jsonLd = buildJsonLd(result.props)
  // Withhold the subtrees of lazy tab panels that will not mount (AGL-1285).
  //
  // Applied HERE rather than inside the loader, and the distinction is the
  // whole design. `loadPageData` is what `/api/screen/nodes` calls to serve
  // the full document back, and `generateMetadata` shares its cache entry —
  // pruning inside it would leave nothing to fetch and no way to un-prune.
  // This is the one place the nodes become a CLIENT prop, which is exactly
  // where the payload cost is incurred: what never crosses into
  // `CatchAllClient` is never serialized into the flight payload.
  //
  // A new props object, never a mutated one: `result.props` belongs to the
  // cached loader.
  const deferred = result.props.nodes
    ? deferLazyPanelNodes(result.props.nodes)
    : null
  const clientProps: Props = deferred?.deferredPanelIds.length
    ? {
        ...result.props,
        nodes: deferred.nodes,
        deferral: { host, slug: slug ?? [] },
      }
    : result.props
  return (
    <>
      {jsonLd.map((json, index) => (
        <script
          key={index}
          type="application/ld+json"
          // Server-rendered structured data. Built from editor-authored
          // host/screen fields, so it MUST use safeJsonLd (not JSON.stringify)
          // — the latter leaves `</script>` intact and breaks out (AGL-496).
          dangerouslySetInnerHTML={{ __html: json }}
        />
      ))}
      {/* The client suspends until the org-enabled site plugins register
          (AGL-417) — streaming SSR awaits the dynamic imports, so published
          screens keep their full HTML. */}
      <Suspense fallback={null}>
        <CatchAllClient {...clientProps} />
      </Suspense>
    </>
  )
}
