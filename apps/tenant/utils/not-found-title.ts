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

// The resolver by file path rather than the `@aglyn/aglyn` barrel: this
// module is read by the not-found boundary's CLIENT half, and the barrel's
// singleton is constructed at import time — see `catch-all-client.tsx`.
import { resolveSeoTitle } from '@aglyn/aglyn/app-utils/seo-title'

/**
 * The 404's `<title>`, composed ONCE for its two writers (AGL-2648).
 *
 * The head of a 404 is written twice, by two different halves of the same
 * boundary:
 *
 *  - on a full document load, by the SERVER — `[host]/[scheme]/not-found.tsx` exports
 *    `generateMetadata`, which Next resolves through the `not-found`
 *    convention when a page throws `notFound()`, so the served `<head>`
 *    carries the title before any script runs;
 *  - on a client-side navigation to a missing URL, by the CLIENT — no
 *    document is loaded, the router carries the previous page's head across,
 *    and `SiteNotFound` writes `document.title` once its fetch settles.
 *
 * Both compose here. Two copies of the rule would drift, and a drift here is
 * visible: the tab would show one title on arrival and another a moment
 * after hydration, on the one page a visitor reaches by getting lost.
 *
 * The rule is `buildMetadata`'s (AGL-1341), verbatim: an authored SEO title —
 * the designed 404 screen's — wins on its own, otherwise the page's NAME joins
 * the site's title through the host's separator. Nothing here names the
 * platform, for the white-label reason `site-status-screen.component.tsx`
 * spells out: the fallback for a site that named itself nothing is the page
 * name alone.
 */
export const NOT_FOUND_PAGE_NAME = 'Page not found'

export interface NotFoundTitleOptions {
  /** The designed 404 screen's authored `seo.title`, when a host has one. */
  designedTitle?: string | null
  /** The host's `seo.title`, else its `displayName` — see {@link hostSeoTitleParts}. */
  siteTitle?: string | null
  /** The host's `seo.separator`; padded and defaulted by the resolver. */
  separator?: string | null
}

export function resolveNotFoundTitle(options: NotFoundTitleOptions): string {
  return resolveSeoTitle({
    title: options.designedTitle,
    name: NOT_FOUND_PAGE_NAME,
    siteTitle: options.siteTitle,
    separator: options.separator,
    fallback: NOT_FOUND_PAGE_NAME,
  })
}

/** The two host fields a title joins, read the way `buildMetadata` reads them. */
export function hostSeoTitleParts(
  host:
    | { displayName?: string; seo?: { title?: string; separator?: string } }
    | null
    | undefined,
): Pick<NotFoundTitleOptions, 'siteTitle' | 'separator'> {
  return {
    siteTitle: host?.seo?.title ?? host?.displayName,
    separator: host?.seo?.separator,
  }
}
