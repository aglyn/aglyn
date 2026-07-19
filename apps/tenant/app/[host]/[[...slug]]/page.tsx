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
  const withSite = (title?: string) =>
    [title, siteTitle].filter(Boolean).join(separator) || 'Aglyn site'

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
  if (props.content) {
    const content = props.content as any
    const entry = content.entry
    const title = entry ? entry.title : content.collection?.displayName
    const description: string | undefined = entry?.excerpt || undefined
    const fullTitle = withSite(title)
    return {
      title: fullTitle,
      ...(description ? { description } : {}),
      openGraph: {
        title: fullTitle,
        ...(description ? { description } : {}),
        type: entry ? 'article' : 'website',
        ...(siteTitle ? { siteName: siteTitle } : {}),
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
  const unlisted = screen?.visibility === Aglyn.HostScreenVisibility.UNLISTED
  const noindex = unlisted || props.notFoundFallback || props.protectedScreen
  const canonicalBase = host?.cname
    ? `https://${host.cname}`
    : host?.subdomain
      ? `https://${host.subdomain}.aglyn.app`
      : undefined
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

  // Content entry → Article.
  if (props.content) {
    const entry = (props.content as any).entry
    if (!entry) return []
    return [
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: entry.title,
        ...(entry.excerpt && { description: entry.excerpt }),
        ...(entry.coverImage && { image: [entry.coverImage] }),
        ...(entry.publishedAt?.seconds && {
          datePublished: new Date(
            entry.publishedAt.seconds * 1000,
          ).toISOString(),
        }),
        ...(entry.updatedAt?.seconds && {
          dateModified: new Date(entry.updatedAt.seconds * 1000).toISOString(),
        }),
        ...(publisher && { author: publisher }),
      }),
    ]
  }

  // Screen render → WebSite (+ BreadcrumbList for nested paths).
  const ld: string[] = []
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
 * `cache`d `loadPageData` call per request.
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
        <CatchAllClient {...result.props} />
      </Suspense>
    </>
  )
}
