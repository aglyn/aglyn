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

/**
 * Preview: a site, or one page of it, that only its team can see (AGL-4086).
 *
 * The public gets the site's 503 page, or a "Coming soon" notice, at every
 * address of a site in preview, and the site's 404 at a page in preview. The
 * site's team, and Aglyn staff, get the whole site. Flipping the switch makes
 * it public to everyone.
 *
 * DEPENDENCY-FREE ON PURPOSE. The tenant middleware runs on the edge and reads
 * the cookie name and the enter path from here; it deep-imports its helpers so
 * the edge bundle does not drag a barrel, and this module imports nothing, as
 * `entry-preview-link.ts` does not.
 *
 * ## The two fields
 *
 * - `host.preview: true` puts the WHOLE SITE in preview. Absent is public: a
 *   missing field must never read as "hide this site", or a schema slip would
 *   take every customer off the air.
 * - `host.previewScreens: { [screenId]: true }` puts ONE PAGE in preview, on a
 *   site that is otherwise public. It lives on the host document rather than
 *   on the screen for one reason: the tenant middleware has to know, before
 *   any cached HTML answers, which addresses a team member must be routed
 *   around the cache for, and the verdict route it asks holds the host
 *   document and nothing else.
 *
 * `host.publicSinceMs` records that the site has been public at least once,
 * so the switch that makes it public reports `site_published` only for a site
 * that never was.
 */

/** A host document, as far as preview reads it. */
export interface SitePreviewHost {
  preview?: boolean | null
  previewScreens?: Record<string, unknown> | null
  publicSinceMs?: number | null
  /** The routing map: screen id → routing-map path (`about`, `/`). */
  screens?: Record<string, unknown> | null
}

/**
 * The cookie a console-minted enter link plants on the site's own host. It
 * holds a signed token bound to one site, verified on every request by the
 * tenant; the edge only checks that it is present.
 */
export const SITE_PREVIEW_COOKIE = 'aglyn_site_preview'

/**
 * The console sign-in's hint cookie on the tenant apex (`Domain=.aglyn.app`),
 * planted by `/api/edit-hint/set`. Named here as well so the edge reads one
 * dependency-free module; the server side keeps its own constant beside the
 * signer.
 */
export const SITE_PREVIEW_EDIT_HINT_COOKIE = 'aglyn_edit_hint'

/** The tenant route a console-minted enter link lands on. */
export const SITE_PREVIEW_ENTER_PATH = '/api/site-preview/enter'

/** How long a planted preview cookie lasts: 12 hours. */
export const SITE_PREVIEW_COOKIE_TTL_MS = 12 * 60 * 60 * 1000

/**
 * How long an enter link's blob lasts: two minutes. It rides a URL, which is
 * logged and can be shared, so it lives only as long as one click takes.
 */
export const SITE_PREVIEW_ENTER_TTL_MS = 2 * 60 * 1000

/** Whether the whole site is in preview. Only an explicit `true` is. */
export function isHostInPreview(
  host: Pick<SitePreviewHost, 'preview'> | null | undefined,
): boolean {
  return host?.preview === true
}

/** Whether one page of the site is in preview. */
export function isScreenInPreview(
  host: Pick<SitePreviewHost, 'previewScreens'> | null | undefined,
  screenId: string | null | undefined,
): boolean {
  if (!screenId) return false
  const map = host?.previewScreens
  if (!map || typeof map !== 'object') return false
  return (map as Record<string, unknown>)[screenId] === true
}

/** The ids of the pages in preview, in a stable order. */
export function previewScreenIds(
  host: Pick<SitePreviewHost, 'previewScreens'> | null | undefined,
): string[] {
  const map = host?.previewScreens
  if (!map || typeof map !== 'object') return []
  return Object.keys(map)
    .filter((id) => (map as Record<string, unknown>)[id] === true)
    .sort()
}

/** A routing-map path (`about`, `services/roofing`, `/`) as a request path. */
function routingPathToRequestPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : '/'
}

/**
 * The request paths of the published pages in preview, for the middleware.
 * A page in preview that is not published has no address, so it has none.
 */
export function sitePreviewPaths(
  host: Pick<SitePreviewHost, 'previewScreens' | 'screens'> | null | undefined,
): string[] {
  const routing = host?.screens
  if (!routing || typeof routing !== 'object') return []
  const paths = new Set<string>()
  for (const screenId of previewScreenIds(host)) {
    const path = (routing as Record<string, unknown>)[screenId]
    if (typeof path === 'string') paths.add(routingPathToRequestPath(path))
  }
  return [...paths].sort()
}

/**
 * Whether a request path is one the team must be routed around the public
 * cache for: every path while the site is in preview, or the address of a
 * page in preview. Trailing slashes are ignored, as Next ignores them.
 */
export function isSitePreviewRequest(
  verdict: { preview?: boolean; previewPaths?: readonly string[] } | null | undefined,
  pathname: string,
): boolean {
  if (!verdict) return false
  if (verdict.preview === true) return true
  const paths = verdict.previewPaths
  if (!paths || !paths.length) return false
  const normalized = routingPathToRequestPath(pathname)
  return paths.includes(normalized)
}

/**
 * Where a create flow starts by default: in preview for a site brought in
 * from somewhere else, public for everything else. A site that already exists
 * elsewhere should not be public before its owner has looked at it; a new
 * site is the launch its owner asked for.
 */
export type SitePreviewStart = 'import' | 'ai' | 'starter' | 'blank'

export function sitePreviewStartsOn(start: string | null | undefined): boolean {
  return start === 'import'
}

/**
 * What a create request asks for: an explicit `preview` boolean wins, and
 * without one the start decides ({@link sitePreviewStartsOn}).
 */
export function sitePreviewForCreate(body: {
  preview?: unknown
  start?: unknown
} | null | undefined): boolean {
  if (typeof body?.preview === 'boolean') return body.preview
  return sitePreviewStartsOn(typeof body?.start === 'string' ? body.start : null)
}

/**
 * What flipping the site's switch writes, and whether it is the site's first
 * time in public.
 *
 * - Turning preview ON for a site that is public now stamps `publicSinceMs`
 *   when it is absent: the site WAS public, and the stamp is what keeps a
 *   later "make it public" from reporting a first publish it is not.
 * - Turning it OFF clears `preview`, and stamps `publicSinceMs` when the site
 *   has never been public. That is the moment `site_published` is reported,
 *   once, for a site that has pages to show.
 */
export interface SitePreviewSwitchPlan {
  /** `preview` after the write: true, or the field removed. */
  preview: boolean
  /** Stamp `publicSinceMs` with the write's time. */
  stampPublicSince: boolean
  /** Report `site_published` (first publish) for this flip. */
  firstPublic: boolean
  /** Nothing would change; the caller writes nothing. */
  unchanged: boolean
}

export function sitePreviewSwitchPlan(
  host: SitePreviewHost | null | undefined,
  enabled: boolean,
): SitePreviewSwitchPlan {
  const inPreview = isHostInPreview(host)
  const everPublic = typeof host?.publicSinceMs === 'number'
  if (enabled) {
    return {
      preview: true,
      stampPublicSince: !inPreview && !everPublic,
      firstPublic: false,
      unchanged: inPreview,
    }
  }
  const hasPages = Object.keys(host?.screens ?? {}).length > 0
  return {
    preview: false,
    stampPublicSince: inPreview && !everPublic,
    firstPublic: inPreview && !everPublic && hasPages,
    unchanged: !inPreview,
  }
}

/**
 * A return path an enter link may send the browser to: a path on the site's
 * own origin, and nothing else. Anything that could leave the origin — a
 * scheme, `//host`, a backslash the browser would read as a slash, a control
 * character — answers `/`.
 */
export function sitePreviewReturnPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || !raw) return '/'
  if (raw.length > 2048) return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return '/'
  return raw
}

/**
 * What the public sees at a site in preview when no 503 page is assigned:
 * the holding page's words, because to a visitor the two are the same thing,
 * a site on its way.
 */
export function sitePreviewNotice(siteName: string | null | undefined): {
  title: string
  body: string
} {
  const name = String(siteName ?? '').trim()
  return name
    ? { title: name, body: 'This site is coming soon. Check back shortly.' }
    : { title: 'Coming soon', body: 'This site is on its way. Check back shortly.' }
}

/** The fixed line the team reads on every page of a site in preview. */
export const SITE_PREVIEW_BANNER_TEXT =
  'Preview — only your team can see this site. Make it public in Admin → Error pages.'

/** The same line for one page in preview on a public site. */
export const PAGE_PREVIEW_BANNER_TEXT =
  'Preview — only your team can see this page. Make it public in its Page Access card.'
