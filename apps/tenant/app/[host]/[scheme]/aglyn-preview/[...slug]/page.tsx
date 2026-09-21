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

import { ENTRY_PREVIEW_PARAM } from '@aglyn/aglyn/app-utils/entry-preview-link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import CatchAllClient from '../../[[...slug]]/catch-all-client'
import { loadPageData } from '../../[[...slug]]/load-page-data'
import PageBodyBoundary from '../../[[...slug]]/page-body-boundary'
import { resolveScreenRoutes } from '../../[[...slug]]/resolve-screen-routes'
import type { Props } from '../../[[...slug]]/types'
import PreviewBanner from '../preview-banner'

/**
 * The live-site preview of a not-yet-published collection entry (AGL-3205).
 *
 * ## Why this is a route of its own and not a branch of the catch-all
 *
 * The address a reader sees is the post's real one —
 * `https://{site}/blog/{entry}?aglyn_preview={token}` — and the middleware
 * rewrites a request carrying that parameter here. It does NOT hand it to
 * `[[...slug]]`, and the whole design turns on why it cannot:
 *
 *  - `[[...slug]]` is ISR-cached at `revalidate = 3600` and Next keys that
 *    cache on the PATHNAME. A preview rendered under the public key would be
 *    served to the next anonymous visitor for an hour — unpublished content
 *    published, by a cache.
 *  - Reading `searchParams` there to tell the two apart is not an escape: a
 *    dynamic API opts the ENTIRE tenant render out of static generation, for
 *    every page of every customer site, which is the AGL-1152 regression that
 *    route is written around. The same is true of `headers()` and `cookies()`,
 *    which is why the token rides the URL rather than a cookie.
 *
 * So the preview gets a route whose only cache setting is `force-dynamic`.
 * Nothing it renders can reach a shared cache entry, because it never writes
 * one: `dynamic = 'force-dynamic'` and `revalidate = 0` together mean no ISR
 * entry, no Full Route Cache, and `no-store` on the response — which the
 * middleware also sets explicitly on the rewrite, so the answer does not
 * depend on a framework default.
 *
 * ## What it does NOT do
 *
 * - It does not fire `SiteAnalytics`. A preview is not a page view, and
 *   counting it would put an unpublished post in the site's own numbers.
 * - It emits no JSON-LD and no canonical, and is `noindex, nofollow`. Nothing
 *   here should be discoverable, and structured data describing a post that is
 *   not live is a mismatch reported against the site that publishes it.
 * - It writes nothing. `getCollectionContent` skips `flipDueEntry` under a
 *   grant, so a preview can neither publish a due schedule nor burn one.
 *
 * ## Unauthorized is the public answer
 *
 * No token, a forged or expired one, one minted for another host, another
 * collection or another entry: the loader's grant check fails, the entry stays
 * withheld exactly as it is on the public path, and this page 404s. The public
 * URL — the one with no parameter at all — never reaches this file.
 */
export const dynamic = 'force-dynamic'

/** Belt and braces beside `force-dynamic`: never hold this render anywhere. */
export const revalidate = 0

/**
 * The same ceiling the catch-all sets. A preview composes the same document
 * through the same loader, so it has the same cold-render budget — and it is
 * ALWAYS a cold render, because nothing about it is cached.
 */
export const maxDuration = 60

type PreviewPageProps = {
  params: Promise<{ host: string; slug?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** The token as presented, or `''` — a repeated parameter is not a token. */
function presentedToken(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const raw = searchParams[ENTRY_PREVIEW_PARAM]
  return typeof raw === 'string' ? raw : ''
}

/**
 * `noindex, nofollow`, and a title that says so.
 *
 * Deliberately NOT the catch-all's metadata: that builder emits a canonical
 * URL, Open Graph and Twitter cards for a page meant to be shared. None of
 * that belongs on an address that answers only to a two-hour signature, and a
 * card scraped from here would advertise a post that is not out.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PreviewPageProps): Promise<Metadata> {
  const { host, slug } = await params
  const result = await loadPageData(
    host,
    slug ?? [],
    presentedToken(await searchParams),
  )
  const title =
    ('props' in result && result.props.content?.entry?.title) || 'Preview'
  return {
    title: `[Preview] ${title}`,
    robots: { index: false, follow: false, nocache: true },
  }
}

export default async function EntryPreviewPage({
  params,
  searchParams,
}: PreviewPageProps) {
  const { host, slug } = await params
  const result = await loadPageData(
    host,
    slug ?? [],
    presentedToken(await searchParams),
  )
  // Every refusal the loader can answer is a 404 here, redirects included.
  // Following one would drop the token and land on the withheld page, and a
  // correctly minted link cannot hit one anyway: the console builds it on the
  // host's own public origin, which is the address the canonical-domain
  // redirect sends everything else TO.
  if (!('props' in result)) notFound()
  const preview = result.props.content?.entryPreview
  /**
   * Nothing was withheld, so there is nothing to preview.
   *
   * Two ways to arrive: the token named an entry that has since published, or
   * somebody appended the parameter to an ordinary page. Both answers are the
   * same and both are better than a render — send the visitor to the PUBLIC
   * address, without the parameter, where the page they asked for is already
   * cached. It is also what makes a junk token harmless: the request ends up
   * on the same bytes the public URL serves, rather than on an uncacheable
   * second copy of a page the site already publishes.
   */
  if (!preview) {
    redirect(`/${(slug ?? []).map(encodeURIComponent).join('/')}`)
  }

  const screenRoutes = await resolveScreenRoutes(result.props)
  const clientProps: Props = screenRoutes
    ? { ...result.props, screenRoutes }
    : result.props
  return (
    <>
      <PreviewBanner
        status={preview.status}
        publishAtSeconds={preview.publishAtSeconds}
      />
      <PageBodyBoundary>
        <CatchAllClient {...clientProps} />
      </PageBodyBoundary>
    </>
  )
}
