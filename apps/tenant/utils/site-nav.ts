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
  isScreenIndexable,
  SCREEN_ROOT_PATH,
  screenRoutePathToUrl,
} from '@aglyn/aglyn/server'

/**
 * The navigation an error screen can honestly offer (AGL-2187).
 *
 * ## Why this exists at all, when the site already has a nav
 *
 * It does not, in any form a boundary can render. A site's real navigation is
 * besigner content — `muiNavMenu`/`muiMegaMenu` nodes take their items as
 * CHILD NODES inside each screen's composed tree — so there is no host-level
 * menu document to read, and the screen whose nodes hold the nav is precisely
 * the screen that was not found. The complete answer to "put the site's nav on
 * the 404" is to assign a designed error screen (`host.errorScreens`, AGL-131),
 * which renders the real thing. This is the floor beneath that: what a visitor
 * gets on the sites — measured 2026-08-18: 6 of 6 in production — that have
 * assigned nothing.
 *
 * ## The rule, and the one line of it that is a security boundary
 *
 * Links come from the host's routing map (`host.screens`: screen id → path),
 * which is already in memory in `[host]/layout.tsx`. That map is every
 * PUBLISHED screen, which is NOT the same as every public one — it includes
 * unlisted, members-only and password-protected pages. `/api/sitemap` learned
 * this the hard way (AGL-1263) and excludes them with `isScreenIndexable`;
 * this file uses the same predicate for the same reason. A nav is a worse
 * place to leak them than a sitemap: it publishes the existence AND the
 * address of a gated page to every visitor who mistypes a URL.
 *
 * So `isScreenIndexable` here is not an SEO nicety inherited by analogy. If
 * you are tempted to relax it because "an unlisted page is still public", read
 * the enum first: `UNLISTED` is `PUBLIC | 4`, and `PASSWORD`, `AUTHENTICATED`
 * and `AUTHORIZED` all carry `PRIVATE`. The predicate is an equality check
 * against `PUBLIC` exactly, and it has to stay one.
 *
 * The rest is presentation:
 *
 *  - **Top level only.** A path containing `/` is a child page; six top-level
 *    destinations read as a nav, forty nested ones read as a sitemap dump.
 *  - **Not the home page.** `SCREEN_ROOT_PATH` is excluded because the site's
 *    mark already links there and the screen renders an explicit home action.
 *  - **Not a template.** A collection list/entry or commerce PDP template sits
 *    in the routing map but 404s at its own slug (AGL-1267/1270), so a nav
 *    item pointing at one would lead from a 404 to another 404.
 *
 * Pure and Firestore-free on purpose — see `get-site-nav.ts` for the read.
 */
export interface SiteNavLink {
  /** Site-relative href, e.g. `/about`. */
  href: string
  label: string
}

/** The fields of a screen document this rule reads. */
export interface SiteNavScreen {
  id: string
  /** The console-authored page name; the nav label when it has one. */
  displayName?: string
  /** {@link HostScreenVisibility}; anything but `PUBLIC` is excluded. */
  visibility?: number
  /** Position among siblings, mirroring the console's screens list order. */
  order?: number
}

/**
 * How many links the nav shows. Six is the point past which a wrapped row of
 * text links stops reading as navigation, and the cap also bounds what a site
 * with 200 top-level pages does to an error page's layout.
 */
export const SITE_NAV_MAX_LINKS = 6

/**
 * Longest label rendered, ellipsis included. Truncation is done HERE rather
 * than with `text-overflow` because these links wrap into a row: a CSS
 * ellipsis needs a width to overflow, and giving each item one turns a short
 * label's box into padding. A page named with a full marketing sentence —
 * which the console permits — otherwise takes the whole row on a phone.
 */
export const SITE_NAV_MAX_LABEL_LENGTH = 28

/**
 * A readable label for a screen that has no `displayName`: the last path
 * segment, de-slugged. `our-team` → `Our Team`. Never returns the raw slug
 * with its hyphens, and returns `''` for a path that is all separators so the
 * caller can drop the link rather than render an empty target.
 */
export function siteNavLabelFromPath(path: string): string {
  const segment = path.split('/').filter(Boolean).pop() ?? ''
  return segment
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Truncates to {@link SITE_NAV_MAX_LABEL_LENGTH}, ellipsis included. */
export function siteNavLabel(raw: string): string {
  const label = raw.trim().replace(/\s+/g, ' ')
  if (label.length <= SITE_NAV_MAX_LABEL_LENGTH) return label
  return `${label.slice(0, SITE_NAV_MAX_LABEL_LENGTH - 1).trimEnd()}…`
}

/**
 * The site's public, top-level pages as nav links — see the module docstring
 * for every exclusion and why the visibility one is load-bearing.
 *
 * `screens` is the screen COLLECTION (what a projection read returns), and the
 * routing map decides membership: a screen the map does not name is not
 * reachable at a path of its own, whatever its document says.
 */
export function buildSiteNavLinks(options: {
  /** `host.screens` — screen id → routing path. */
  routing?: Record<string, string> | null
  screens?: readonly SiteNavScreen[] | null
  /** From `getTemplateScreenIds`; see the module docstring. */
  templateScreenIds?: ReadonlySet<string> | null
  limit?: number
}): SiteNavLink[] {
  const routing = options.routing ?? {}
  const limit = options.limit ?? SITE_NAV_MAX_LINKS
  if (limit <= 0) return []

  const seenHrefs = new Set<string>()
  const candidates: Array<{ order: number; link: SiteNavLink }> = []

  for (const screen of options.screens ?? []) {
    if (!screen?.id) continue
    const path = routing[screen.id]
    if (typeof path !== 'string' || !path) continue
    if (path === SCREEN_ROOT_PATH) continue
    if (path.includes('/')) continue
    if (options.templateScreenIds?.has(screen.id)) continue
    // THE security line — see the module docstring before touching it.
    if (!isScreenIndexable(screen)) continue

    const href = screenRoutePathToUrl(path)
    if (seenHrefs.has(href)) continue
    const label = siteNavLabel(
      (screen.displayName ?? '').trim() || siteNavLabelFromPath(path),
    )
    if (!label) continue
    seenHrefs.add(href)
    candidates.push({
      // A screen with no `order` sorts after every screen that has one, then
      // alphabetically — rather than colliding at 0 and taking the head of the
      // nav from the pages the author actually arranged.
      order:
        typeof screen.order === 'number' && Number.isFinite(screen.order)
          ? screen.order
          : Number.MAX_SAFE_INTEGER,
      link: { href, label },
    })
  }

  candidates.sort(
    (a, b) => a.order - b.order || a.link.label.localeCompare(b.link.label),
  )
  return candidates.slice(0, limit).map((candidate) => candidate.link)
}
