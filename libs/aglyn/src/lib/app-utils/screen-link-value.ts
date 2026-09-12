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
 * What a stored link VALUE means, with no React attached (AGL-703).
 *
 * Split out of `screen-link-context.ts`, which calls `createContext` at module
 * scope and is therefore excluded from the `@aglyn/aglyn/server` barrel by
 * design (AGL-405). The parsing is not client-only, though, and the where-used
 * scan runs on the server: without this split the API route would have had to
 * re-spell `'screen:'` and its own trimming rules, which is exactly how two
 * readers start disagreeing about what a link points at.
 *
 * `screen-link-context.ts` re-exports every name here, so existing importers —
 * all of which reach these through the `@aglyn/aglyn` barrel — are unaffected.
 *
 * RESOLUTION lives here for the same reason parsing does (AGL-2740). The
 * Markdown representation of a page is built in a route handler, from the
 * server barrel that excludes `screen-link-context.ts` — so with the resolver
 * on the far side of that boundary it grew a second, shorter one, which read
 * only the `screenId` slot and emitted a `screen:<id>` value verbatim when it
 * arrived in the `href` slot. One resolver, reachable from both barrels, is
 * what stops a non-HTML representation from disagreeing with the page.
 */

import type { ScreenRouteMap } from './screen-link-context-value'

/**
 * Prefix marking a stored link value as a screen REFERENCE rather than a
 * literal href (AGL-1335).
 *
 * A `Link`-typed component prop stores its value in the same string slot
 * whichever way it was authored, and every value written before the picker
 * existed is a raw path (`/pricing`). A bare screen id is indistinguishable
 * from a relative path that happens to have no slash, so the id-carrying
 * shape is the one that gets the marker: a legacy string keeps meaning
 * exactly what it always meant, and only newly picked values indirect
 * through the routing map.
 */
export const SCREEN_LINK_VALUE_PREFIX = 'screen:'

/**
 * Prefix marking a stored link value as a content collection's LISTING page
 * (AGL-2799): `collection:<collectionId>` is the page at `/{collectionSlug}`.
 *
 * The listing is addressed by the collection's id and never by its slug, for
 * the reason a screen is: `/blog` is where the listing happens to be today,
 * and the id is the part a rename cannot move.
 *
 * The value is ALSO the listing's key in the linkable routing map
 * (`linkableScreenRoutes`), so every reader that resolves a screen id against
 * that map — `resolveScreenHref`, the broken-link verdict, the Tabs strip, the
 * Markdown representation of a page — resolves a listing through the same
 * lookup, with no second path to fall out of step. Generated ids contain no
 * colon, so the key cannot collide with a screen id in the same map.
 *
 * Unlike {@link SCREEN_LINK_VALUE_PREFIX}, this marker is written in every
 * slot the value can occupy, the screen slot included: a bare collection id
 * there would be read as a screen id.
 */
export const COLLECTION_LINK_VALUE_PREFIX = 'collection:'

/** Wraps a collection id as a stored listing link — see {@link COLLECTION_LINK_VALUE_PREFIX}. */
export function formatCollectionLinkValue(collectionId: string): string {
  return `${COLLECTION_LINK_VALUE_PREFIX}${collectionId.trim()}`
}

/**
 * The collection id a stored listing link names, or `undefined` for any value
 * that is not a listing link.
 */
export function parseCollectionLinkValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith(COLLECTION_LINK_VALUE_PREFIX)) return undefined
  const id = trimmed.slice(COLLECTION_LINK_VALUE_PREFIX.length).trim()
  return id || undefined
}

/**
 * Wraps a link target as a stored value — see {@link SCREEN_LINK_VALUE_PREFIX}.
 *
 * Takes what a picker option carries: a screen id, which gains the marker, or
 * a collection listing's key, which is already its own stored form and comes
 * back unchanged.
 */
export function formatScreenLinkValue(screenId: string): string {
  const collectionId = parseCollectionLinkValue(screenId)
  return collectionId
    ? formatCollectionLinkValue(collectionId)
    : `${SCREEN_LINK_VALUE_PREFIX}${screenId}`
}

/**
 * The routing-map key a stored link value references — a screen id, or a
 * collection listing's `collection:<id>` — or `undefined` when the value is a
 * literal href (legacy raw string, external URL, or unset).
 */
export function parseScreenLinkValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const collectionId = parseCollectionLinkValue(trimmed)
  if (collectionId) return formatCollectionLinkValue(collectionId)
  if (!trimmed.startsWith(SCREEN_LINK_VALUE_PREFIX)) return undefined
  const id = trimmed.slice(SCREEN_LINK_VALUE_PREFIX.length).trim()
  return id || undefined
}

/**
 * Whether a routing map can say anything about this link target (AGL-1893,
 * AGL-2799).
 *
 * The map holds two kinds of key read from two different places — screens
 * from the host document, collection listings from the host's collections —
 * and either half can be empty while the other is not: a console that has
 * received one subscription and not yet the other, or a site with a blog and
 * no published screen. A map with no key of the target's OWN kind has not
 * heard of that kind at all, so it is no evidence the target is gone.
 *
 * Compared per kind rather than as "the map is non-empty" because the loading
 * beat is exactly where the difference shows: the first collection to arrive
 * would otherwise condemn every screen link on the canvas until the host
 * document caught up, and the host document would condemn every listing link
 * until the collections did.
 */
export function screenRoutesAnswerFor(
  screens: ScreenRouteMap | undefined,
  target: string | null | undefined,
): boolean {
  if (!screens || !target) return false
  const key = parseScreenLinkValue(target) ?? target.trim()
  const wantsListing = parseCollectionLinkValue(key) !== undefined
  for (const candidate in screens) {
    if ((parseCollectionLinkValue(candidate) !== undefined) === wantsListing) {
      return true
    }
  }
  return false
}

/**
 * Navigable protocols only. A stored `javascript:`/`data:` href would
 * execute in visitors' browsers, so the guard the linking components each
 * carried is here instead — one copy, one place to harden.
 */
export const SAFE_HREF_PATTERN = /^(https?:\/\/|mailto:|tel:|\/|#)/i

/** Of those, the ones that actually leave the site (new-tab decisions). */
export const EXTERNAL_HREF_PATTERN = /^(https?:\/\/|mailto:|tel:)/i

/**
 * Turns a screen id into its current href against a routing map, or
 * `undefined` when there is no id or the id has no entry (unpublished or
 * deleted). Pure and hook-free on purpose: an element that resolves ONE
 * target uses `useScreenLink`, but a row of them — the Tabs strip's per-tab
 * links (AGL-1312) — cannot call a hook per item, and the map-to-path
 * contract (root is `'/'`, everything else gains a leading slash) must have
 * exactly one implementation.
 */
export function resolveScreenHref(
  screens: ScreenRouteMap | undefined,
  screenId: string | null | undefined,
): string | undefined {
  if (!screenId) return undefined
  // A value that arrived through a `Link`-typed component prop (AGL-1335)
  // carries the prefix, because there it has to be distinguishable from the
  // raw path strings those props held before the picker existed. Stripping
  // it HERE rather than at each call site is the same "one resolver" rule
  // the doc comment above states: every surface that resolves a screen id
  // must accept both spellings, or a prop-fed tab strip would resolve where
  // a prop-fed button did not.
  const id = parseScreenLinkValue(screenId) ?? screenId
  const path = screens?.[id]
  if (path === undefined) return undefined
  return path === '/' ? '/' : `/${path}`
}

/**
 * Sorts an element's two link inputs into "a screen id" and "a literal
 * href", tolerating either value arriving in either slot (AGL-1335).
 *
 * Both slots are string props, and a component prop bound with
 * `{{prop.link}}` can be dropped into whichever one the author reached for
 * first. So the ROUTING is driven by the value's shape, not by which field
 * it sits in:
 *
 * - a `screen:`-prefixed value is a screen reference wherever it appears;
 * - an href-shaped value (`/x`, `https://…`, `#a`, `mailto:`) in the screen
 *   slot is a literal href — a real screen id never looks like that, and
 *   the alternative is a link that silently resolves to nothing;
 * - anything else in the screen slot is a bare screen id, exactly as before.
 *
 * A resolved screen id always wins: `screenId` has taken precedence over
 * `href` since AGL-139, and this must not change which of the two an
 * already-published page follows.
 */
export function splitLinkValue(
  screenId: string | null | undefined,
  href: string | null | undefined,
): { screenId?: string; href?: string } {
  const rawScreen = typeof screenId === 'string' ? screenId.trim() : ''
  const rawHref = typeof href === 'string' ? href.trim() : ''
  const fromScreenSlot = parseScreenLinkValue(rawScreen)
  if (fromScreenSlot) return { screenId: fromScreenSlot }
  if (rawScreen && !SAFE_HREF_PATTERN.test(rawScreen)) {
    return { screenId: rawScreen }
  }
  const fromHrefSlot = parseScreenLinkValue(rawHref)
  if (fromHrefSlot) return { screenId: fromHrefSlot }
  // An href-shaped value in the screen slot beats an empty href slot, and
  // loses to a real one — the screen slot was never meant to hold a path.
  const literal = rawHref || rawScreen
  return literal ? { href: literal } : {}
}

/**
 * Whether a stored node tree links to a given screen (AGL-703).
 *
 * DEEP, unlike {@link nodesReferenceComponent} which reads `props.refId` at
 * one known key. A screen id can sit almost anywhere in a prop bag: the
 * `screenId`/`href` pair every linking element declares, a `Link`-typed
 * component prop the author bound to either slot, and — the case a shallow
 * walk would miss entirely — the ITEM ARRAYS a nav strip, a tab set, or a
 * mega menu store their targets in. Those arrays are where a site's
 * navigation actually lives, so a scan that skipped them would report the
 * home page as linked from nowhere.
 *
 * Two accepted spellings, matching {@link splitLinkValue}'s own rules:
 *
 * - `screen:<id>` — the marked form every picked value has written since
 *   AGL-1335;
 * - a bare `<id>` — the legacy form, still live on anything authored before
 *   the picker.
 *
 * The bare form is the one that could over-match, and it is allowed to. A
 * screen id is a generated 10-character token, so a prop holding that exact
 * string for some unrelated reason is a theoretical case; and this answers
 * "what might I break", where naming one extra document costs a second look
 * and missing one costs a dead link on a live site.
 */
export function nodesReferenceScreen(
  nodes: Record<string, unknown> | null | undefined,
  screenId: string,
): boolean {
  if (!nodes || !screenId) return false
  const matches = (value: unknown): boolean => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return (
        trimmed === screenId ||
        parseScreenLinkValue(trimmed) === screenId
      )
    }
    if (Array.isArray(value)) return value.some(matches)
    if (value && typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).some(matches)
    }
    return false
  }
  for (const node of Object.values(nodes)) {
    const props = (node as { props?: unknown } | undefined)?.props
    if (props && matches(props)) return true
  }
  return false
}
