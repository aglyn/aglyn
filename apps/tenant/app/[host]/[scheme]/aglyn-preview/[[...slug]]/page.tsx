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
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import {
  isHostInPreview,
  PAGE_PREVIEW_BANNER_TEXT,
  previewScreenIds,
  SITE_PREVIEW_BANNER_TEXT,
} from '@aglyn/aglyn/app-utils/site-preview'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import CatchAllClient from '../../[[...slug]]/catch-all-client'
import {
  loadPageData,
  SITE_PREVIEW_TEAM_VIEW,
  type SiteOverride,
} from '../../[[...slug]]/load-page-data'
import PageBodyBoundary from '../../[[...slug]]/page-body-boundary'
import { resolveScreenRoutes } from '../../[[...slug]]/resolve-screen-routes'
import type { LoadResult, Props } from '../../[[...slug]]/types'
import getHost from '../../../../../utils/get-host'
import getOrgBilling from '../../../../../utils/get-org-billing'
import { sitePreviewViewer } from '../../../../../utils/site-preview-viewer'
import PreviewBanner from '../preview-banner'

/**
 * The uncached render: an unpublished collection entry (AGL-3205), and a site
 * or page in preview as its team sees it (AGL-4086).
 *
 * ## Why this is a route of its own and not a branch of the catch-all
 *
 * The address a reader sees is the real one — the post's, or the page's — and
 * the middleware rewrites the request here. It does NOT hand it to
 * `[[...slug]]`, and the whole design turns on why it cannot:
 *
 *  - `[[...slug]]` is ISR-cached at `revalidate = 3600` and Next keys that
 *    cache on the PATHNAME. A preview rendered under the public key would be
 *    served to the next anonymous visitor for an hour — unpublished content
 *    published, by a cache.
 *  - Reading `searchParams` or `cookies()` there to tell the two apart is not
 *    an escape: a dynamic API opts the ENTIRE tenant render out of static
 *    generation, for every page of every customer site, which is the
 *    AGL-1152 regression that route is written around.
 *
 * So the preview gets a route whose only cache setting is `force-dynamic`.
 * Nothing it renders can reach a shared cache entry, because it never writes
 * one: `dynamic = 'force-dynamic'` and `revalidate = 0` together mean no ISR
 * entry, no Full Route Cache, and `no-store` on the response — which the
 * middleware also sets explicitly on the rewrite, so the answer does not
 * depend on a framework default.
 *
 * Optional catch-all (`[[...slug]]`) since AGL-4086, so a site's home page —
 * the first address a team member opens — reaches it too.
 *
 * ## The two ways in
 *
 * - `?aglyn_preview=` — a two-hour, one-entry token the console minted. The
 *   loader verifies it inside the collection branch.
 * - A team cookie, while the site or the page at this address is in preview.
 *   The middleware checked only that one was PRESENT; `sitePreviewViewer`
 *   verifies it here, and only a verified viewer is rendered the team's view.
 *
 * ## What it does NOT do
 *
 * - It does not fire `SiteAnalytics`. A preview is not a page view.
 * - It emits no JSON-LD and no canonical, and is `noindex, nofollow`.
 * - It writes nothing. `getCollectionContent` skips `flipDueEntry` under a
 *   grant, so a preview can neither publish a due schedule nor burn one.
 *
 * ## Unauthorized is the public answer
 *
 * A forged or expired token, one for another host, collection or entry: the
 * entry stays withheld and this page 404s. A forged, expired or foreign team
 * cookie, or an account with no role on the site: the loader is asked as the
 * public is, and the 503 page or the "Coming soon" notice renders — uncached,
 * because this route caches nothing, but the same bytes a stranger is served.
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

/** Where the console is, for the banner's link. The same default as the rest. */
function consoleOrigin(): string {
  return (process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim() || 'https://app.aglyn.com'
}

interface ResolvedPreview {
  result: LoadResult
  /** The team's view of a site or page in preview, verified. */
  team: boolean
  /** Which kind of preview the team is looking at, for the banner. */
  scope: 'site' | 'page' | null
  host: Record<string, unknown> | null
}

/**
 * Who is asking, and what they get — once per request, for the head and the
 * body alike. The viewer check runs only for a host that has something in
 * preview: an entry preview on a public site costs no extra read.
 */
const resolvePreview = cache(
  async (
    hostParam: string,
    slugKey: string,
    token: string,
  ): Promise<ResolvedPreview> => {
    const slug = JSON.parse(slugKey) as string[]
    const hostRes = await getHost({ host: hostParam })
    const host = (hostRes.host ?? null) as Record<string, unknown> | null
    const hostId = String(host?.['$id'] ?? '')
    const sitePreview = isHostInPreview(host as never)
    const anyPreview = sitePreview || previewScreenIds(host as never).length > 0
    const viewer = hostId && anyPreview ? await sitePreviewViewer(hostId) : null
    const override: SiteOverride = viewer?.admitted ? SITE_PREVIEW_TEAM_VIEW : ''
    const result = await loadPageData(hostParam, slug, token, override)
    return {
      result,
      team: override === SITE_PREVIEW_TEAM_VIEW,
      scope: !viewer?.admitted ? null : sitePreview ? 'site' : 'page',
      host,
    }
  },
)

/**
 * `noindex, nofollow`, and a title that says so.
 *
 * Deliberately NOT the catch-all's metadata: that builder emits a canonical
 * URL, Open Graph and Twitter cards for a page meant to be shared. None of
 * that belongs on an address that answers only to a signature or a team
 * cookie, and a card scraped from here would advertise what is not out.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PreviewPageProps): Promise<Metadata> {
  const { host, slug } = await params
  const { result, team } = await resolvePreview(
    host,
    JSON.stringify(slug ?? []),
    presentedToken(await searchParams),
  )
  const props = 'props' in result ? result.props : null
  // Not the team: the public's answer, under the public's title.
  if (props?.sitePreview && !team) {
    return {
      title: 'Coming soon',
      robots: { index: false, follow: false, nocache: true },
    }
  }
  const screen = props?.data?.screen?.data as
    | { displayName?: string; seo?: { title?: string } }
    | undefined
  const title =
    props?.content?.entry?.title ||
    screen?.seo?.title ||
    screen?.displayName ||
    'Preview'
  return {
    title: `[Preview] ${title}`,
    robots: { index: false, follow: false, nocache: true },
  }
}

export default async function PreviewPage({
  params,
  searchParams,
}: PreviewPageProps) {
  const { host, slug } = await params
  const token = presentedToken(await searchParams)
  const { result, team, scope, host: hostDoc } = await resolvePreview(
    host,
    JSON.stringify(slug ?? []),
    token,
  )

  /**
   * The team's view of a site or page in preview (AGL-4086): the whole site,
   * redirects and all, under the bar that says only the team can see it.
   * A site's own redirect rule is followed, as the public path follows it;
   * the redirect lands back on the middleware, which routes the team here
   * again.
   */
  if (!token) {
    if ('redirect' in result && result.redirect) {
      redirect(result.redirect.destination)
    }
    if (!('props' in result)) notFound()
    const screenRoutes = await resolveScreenRoutes(result.props)
    const clientProps: Props = screenRoutes
      ? { ...result.props, screenRoutes }
      : result.props
    return (
      <>
        {team ? (
          <PreviewBanner
            sentence={scope === 'page' ? PAGE_PREVIEW_BANNER_TEXT : SITE_PREVIEW_BANNER_TEXT}
            link={await consoleLink(hostDoc, scope)}
          />
        ) : null}
        <PageBodyBoundary>
          <CatchAllClient {...clientProps} />
        </PageBodyBoundary>
      </>
    )
  }

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

/**
 * Where the bar sends the team to end the preview: Admin → Error pages for a
 * site, the Pages list for a page. The console names a site by its workspace
 * and its subdomain; without both, the console's front door.
 */
async function consoleLink(
  host: Record<string, unknown> | null,
  scope: 'site' | 'page' | null,
): Promise<{ href: string; label: string }> {
  const origin = consoleOrigin()
  const subdomain = String(host?.['subdomain'] ?? '')
  const hostId = String(host?.['$id'] ?? '')
  let orgSlug = ''
  if (hostId) {
    const orgRes = await getOrgBilling({ hostId }).catch(() => null)
    orgSlug = String((orgRes?.org as { slug?: unknown } | null | undefined)?.slug ?? '')
  }
  if (!orgSlug || !subdomain) return { href: origin, label: 'Open the console' }
  const path =
    scope === 'page'
      ? buildRoute(Route.HOST_SCREENS, { orgSlug, host: subdomain })
      : buildRoute(Route.HOST_ADMIN_ERROR_PAGES, { orgSlug, host: subdomain })
  return {
    href: `${origin}${path}`,
    label: scope === 'page' ? 'Open Pages' : 'Open Error pages',
  }
}
