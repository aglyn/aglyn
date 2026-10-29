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

import { ENTRY_PREVIEW_ROUTE_SEGMENT } from './entry-preview-link'
import { LEAVING_NOTICE_ROUTE_SEGMENT } from './leaving-notice'
import { PLATFORM_BRAND_NAME } from './platform-brand'

/*
 * The address rules of a page's slug, in a leaf of their own so the native apps
 * (which cannot import the routing map's reach into the whole foundation) read
 * the same answers: `screen-route.ts` re-exports every name below, so no
 * importer changes. The routing map, tree walks and links stay there.
 */

/**
 * Route path of a host's root screen. The tenant matcher joins the catch-all
 * segments and collapses an empty one to this value (`load-page-data.ts`:
 * `slugSegments.length ? slugSegments.join('/') : SCREEN_ROOT_PATH`), so the
 * root is `'/'` and every other path is slash-joined segments WITHOUT a
 * leading slash (`about`, later `company/about`).
 */
export const SCREEN_ROOT_PATH = '/'

/**
 * Normalizes user slug input into the routing-map path format described on
 * {@link SCREEN_ROOT_PATH}. `'/'` normalizes to the root path; anything else
 * becomes a single lowercase url-safe segment.
 *
 * Returns `undefined` for EMPTY input and for anything that sanitizes away
 * (`'###'`) — the two cases are deliberately the same answer, and the caller
 * decides what it means. In the Screens page's slug field an empty string
 * means "no address typed"; in a starter template it meant "home". Two
 * meanings for one value is what made AGL-1575 possible, so this function
 * refuses to pick one: a caller that wants the root must say `'/'`.
 *
 * This docstring used to claim empty input normalized to the root, which the
 * code has never done (see the spec, which asserts the `undefined`). A fix
 * written against the docstring instead of the behaviour would have shipped
 * broken; if you are here to make the code match the comment, do not.
 */
export function normalizeScreenSlug(
  input: string | null | undefined,
): string | undefined {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return undefined
  if (trimmed === SCREEN_ROOT_PATH) return SCREEN_ROOT_PATH

  const segment = trimmed
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

  return segment || undefined
}

/**
 * Route segments the published site CANNOT serve, whatever the routing map
 * says (AGL-2076).
 *
 * Every entry was measured against production on 2026-08-19 with a fresh
 * `x-vercel-cache: MISS`, because a stale negative always passes. Two
 * mechanisms, both of which resolve ahead of `[host]/[scheme]/[[...slug]]`:
 *
 *  - `404`, `500` — Next emits `pages/404.html` and `pages/500.html` even for
 *    an app-router-only build, and the deployed filesystem answers them as
 *    static files (`content-disposition: inline; filename="404"`,
 *    `accept-ranges`, an `etag`, and no `x-nextjs-prerender`). The tenant
 *    middleware's own CSP headers are on those responses, so the middleware
 *    ran and its rewrite still lost. There is no rewrite this app can write
 *    that beats them, which is why the honest fix is to refuse the slug at
 *    authoring time rather than to keep promising an address that is dead.
 *  - `search`, `api`, `_next`, `_static` — routes and exclusions the tenant
 *    app owns. `/search` matches `app/[host]/[scheme]/search`; the other three are the
 *    middleware matcher's exclusions, so no host rewrite happens at all and
 *    the path is parsed as `[host]` with an empty slug.
 *  - `aglyn-preview` — the same mechanism as `search`, one route over
 *    (AGL-3205). The live-site preview of an unpublished collection entry is
 *    a rewrite to `app/[host]/[scheme]/aglyn-preview/[[...slug]]`, because it
 *    must be a DIFFERENT Next route from the ISR-cached catch-all; a static
 *    folder wins over the optional catch-all beside it, so `/aglyn-preview/x`
 *    would reach the preview page and 404 rather than render a screen. The
 *    bare `/aglyn-preview` reaches it too since the team's view of a site in
 *    preview (AGL-4086) made its catch-all optional, so a site's home page
 *    could be previewed; and a child's path is composed from its parent's
 *    slug, which this rule refuses.
 *  - `_aglyn` — the platform's own pages on every site, the leaving notice
 *    at `/_aglyn/leaving` first (AGL-3452). The middleware rewrites that path
 *    to an api route before the catch-all could see it.
 *
 * NOT reserved, and deliberately so, because measuring found them fine:
 * `401`, `403`, `503` (`/401` returns 200 through the catch-all — two of the
 * four designed error screens have always been viewable at their slugs, which
 * is what made the `404` case look like a Next.js defect), and `index`.
 *
 * `fonts` and `examples` USED to be dead for the third reason and are not
 * here: they were exclusions inherited from the Vercel platforms starter kit
 * for directories `apps/tenant/public` has never contained. They are given
 * back rather than reserved — see the matcher in `apps/tenant/middleware.ts`.
 */
export const RESERVED_SCREEN_ROUTE_SEGMENTS: readonly string[] = [
  '404',
  '500',
  'search',
  ENTRY_PREVIEW_ROUTE_SEGMENT,
  'api',
  '_next',
  '_static',
  LEAVING_NOTICE_ROUTE_SEGMENT,
]

/**
 * The reserved segment a routing-map path would collide with, or `undefined`
 * when the path is servable. The segment rather than a boolean, so a refusal
 * can name what it is refusing over.
 *
 * Reads the FIRST segment only. For `api`/`_next`/`_static` that is exactly
 * right — the middleware excludes the whole subtree, so `api/docs` is as dead
 * as `api`. For `404`/`500`/`search` it over-refuses in principle (`/404/why`
 * would serve), and that is deliberate: a child path is composed from its
 * PARENT's slug, the parent would have to hold `404`, and this same rule
 * refuses that slug wherever one is typed. A second list to express a case
 * that cannot arise would be a second list to keep correct.
 *
 * Takes a composed routing-map path (`about`, `company/about`, `'/'`), not a
 * raw slug field — `'/'` is the home screen and is never reserved.
 */
export function reservedScreenRouteSegment(
  path: string | null | undefined,
): string | undefined {
  if (!path || path === SCREEN_ROOT_PATH) return undefined
  const [first] = path.replace(/^\/+/, '').split('/')
  return RESERVED_SCREEN_ROUTE_SEGMENTS.includes(first) ? first : undefined
}

/**
 * The refusal an author reads when {@link reservedScreenRouteSegment} names a
 * segment. One sentence, in one place, because the Screens page, the version
 * view and the besigner all have to say the same thing — three surfaces
 * wording a platform constraint three ways is how AGL-2093's precheck drifted.
 */
export function reservedScreenRouteMessage(segment: string): string {
  return `"/${segment}" is a reserved address on every ${PLATFORM_BRAND_NAME} site — pick another slug`
}

/**
 * Does a raw slug value carry a path separator the one segment it describes
 * cannot hold (AGL-2572)?
 *
 * {@link normalizeScreenSlug} answers with a SINGLE segment, and it gets there
 * by deleting every character outside `[a-z0-9-_]` — an interior `/` included.
 * Whitespace becomes a `-`, but a `/` becomes nothing at all, so
 * `alternatives/webflow` normalizes to `alternativeswebflow` and the two words
 * are stored glued. Nothing about that is visible: the field accepts the
 * keystroke, the composed path reads plausibly, and the screen ends up
 * answering an address nobody typed. Two screens on `aglyn-marketing` carry a
 * slug of that shape.
 *
 * So the separator is a question a slug field asks BEFORE normalizing, and the
 * answer is a refusal rather than a silent repair — the caller cannot know
 * which segment the author meant, and guessing is how the glue happened.
 *
 * LEADING and TRAILING slashes are not separators here. `normalizeScreenSlug`
 * strips them deliberately (`/about/` → `about`), an author typing an address
 * writes them without meaning a hierarchy, and refusing them would reject a
 * value the normalizer has always handled correctly. `'/'` alone is the home
 * page and is never a separator.
 */
export function screenSlugHasPathSeparator(
  input: string | null | undefined,
): boolean {
  const trimmed = (input ?? '').trim()
  if (!trimmed || trimmed === SCREEN_ROOT_PATH) return false
  return trimmed.replace(/^\/+|\/+$/g, '').includes('/')
}

/**
 * The refusal an author reads when {@link screenSlugHasPathSeparator} answers
 * true. One sentence, in one place, for the same reason
 * {@link reservedScreenRouteMessage} is: the Screens page, the version view
 * and the besigner all take a slug, and a constraint worded three ways drifts
 * into three different constraints.
 *
 * It names the alternative, because a `/` in this field almost always means
 * "nest me" and the hierarchy is what actually composes the longer path.
 */
export const SCREEN_SLUG_PATH_SEPARATOR_MESSAGE =
  'A slug is one path segment — remove the "/" and nest the page under a ' +
  'parent page instead'
