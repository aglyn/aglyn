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
 * Prefix marking a stored link value as a content collection ENTRY (AGL-3118):
 * `entry:<collectionId>/<entryId>` is the page at `/{collectionSlug}/{entrySlug}`.
 *
 * Both halves are ids, for the reason a listing is addressed by its
 * collection's id: an entry's slug and its collection's slug can each be
 * renamed, and the id pair is the part neither rename moves. A link written
 * once follows both.
 *
 * Like the listing form, the value is the stored form in every slot AND the
 * entry's key in the linkable routing map, so `resolveScreenHref` resolves an
 * entry through the same lookup as a screen. Generated ids contain neither a
 * colon nor a slash, so the key cannot collide with a screen id or a listing.
 * Entry keys are not in every map: a page carries the ones it references.
 */
export const ENTRY_LINK_VALUE_PREFIX = 'entry:'

/** Wraps an entry's ids as a stored entry link — see {@link ENTRY_LINK_VALUE_PREFIX}. */
export function formatEntryLinkValue(collectionId: string, entryId: string): string {
  return `${ENTRY_LINK_VALUE_PREFIX}${collectionId.trim()}/${entryId.trim()}`
}

/**
 * The collection and entry ids a stored entry link names, or `undefined` for
 * any value that is not exactly one well-formed entry link.
 */
export function parseEntryLinkValue(
  value: unknown,
): { collectionId: string; entryId: string } | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith(ENTRY_LINK_VALUE_PREFIX)) return undefined
  const parts = trimmed
    .slice(ENTRY_LINK_VALUE_PREFIX.length)
    .split('/')
    .map((part) => part.trim())
  if (parts.length !== 2) return undefined
  const [collectionId, entryId] = parts
  if (!collectionId || !entryId) return undefined
  return { collectionId, entryId }
}

/**
 * Prefix marking a stored link value as a content collection's RSS FEED
 * (AGL-3118): `feed:<collectionId>` is `/{collectionSlug}/rss.xml`.
 *
 * Addressed by the collection's id for the listing's reason, and keyed in the
 * linkable routing map beside the listing it belongs to, so a feed link
 * follows a renamed collection exactly as its listing link does.
 */
export const FEED_LINK_VALUE_PREFIX = 'feed:'

/** Wraps a collection id as a stored feed link — see {@link FEED_LINK_VALUE_PREFIX}. */
export function formatFeedLinkValue(collectionId: string): string {
  return `${FEED_LINK_VALUE_PREFIX}${collectionId.trim()}`
}

/**
 * The collection id a stored feed link names, or `undefined` for any value
 * that is not a feed link.
 */
export function parseFeedLinkValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith(FEED_LINK_VALUE_PREFIX)) return undefined
  const id = trimmed.slice(FEED_LINK_VALUE_PREFIX.length).trim()
  return id || undefined
}

/** What a link target key names: a screen, or one of a collection's pages. */
export type LinkTargetKind = 'screen' | 'collection' | 'entry' | 'feed'

/**
 * The kind of a routing-map key or stored link value. Anything that is not a
 * listing, entry or feed reference is a screen, which is what a bare id in
 * the map always was.
 */
export function linkTargetKind(key: string): LinkTargetKind {
  if (parseCollectionLinkValue(key) !== undefined) return 'collection'
  if (parseEntryLinkValue(key) !== undefined) return 'entry'
  if (parseFeedLinkValue(key) !== undefined) return 'feed'
  return 'screen'
}

/**
 * Wraps a link target as a stored value — see {@link SCREEN_LINK_VALUE_PREFIX}.
 *
 * Takes what a picker option carries: a screen id, which gains the marker, or
 * a listing, entry or feed key, which is already its own stored form and comes
 * back unchanged.
 */
export function formatScreenLinkValue(screenId: string): string {
  const collectionId = parseCollectionLinkValue(screenId)
  if (collectionId) return formatCollectionLinkValue(collectionId)
  const entry = parseEntryLinkValue(screenId)
  if (entry) return formatEntryLinkValue(entry.collectionId, entry.entryId)
  const feedCollectionId = parseFeedLinkValue(screenId)
  if (feedCollectionId) return formatFeedLinkValue(feedCollectionId)
  return `${SCREEN_LINK_VALUE_PREFIX}${screenId}`
}

/**
 * The routing-map key a stored link value references — a screen id, or a
 * listing's `collection:<id>`, an entry's `entry:<collectionId>/<entryId>` or
 * a feed's `feed:<id>` — or `undefined` when the value is a literal href
 * (legacy raw string, external URL, or unset).
 */
export function parseScreenLinkValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const collectionId = parseCollectionLinkValue(trimmed)
  if (collectionId) return formatCollectionLinkValue(collectionId)
  const entry = parseEntryLinkValue(trimmed)
  if (entry) return formatEntryLinkValue(entry.collectionId, entry.entryId)
  const feedCollectionId = parseFeedLinkValue(trimmed)
  if (feedCollectionId) return formatFeedLinkValue(feedCollectionId)
  if (!trimmed.startsWith(SCREEN_LINK_VALUE_PREFIX)) return undefined
  const id = trimmed.slice(SCREEN_LINK_VALUE_PREFIX.length).trim()
  return id || undefined
}

/**
 * Whether a routing map can say anything about this link target (AGL-1893,
 * AGL-2799, AGL-3118).
 *
 * The map holds several kinds of key read from different places — screens
 * from the host document, listings and feeds from the host's collections,
 * entries from whatever a page references — and any half can be empty while
 * another is not: a console that has received one subscription and not yet
 * the other, a site with a blog and no published screen, or a page that
 * references no entry at all. A map with no key of the target's OWN kind has
 * not heard of that kind, so it is no evidence the target is gone.
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
  const wanted = linkTargetKind(key)
  for (const candidate in screens) {
    if (linkTargetKind(candidate) === wanted) return true
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
 * The id a link value jumps to when a fragment is ALL it holds — `#watch`
 * gives `watch` — or `undefined` for any other value (AGL-2867).
 *
 * A link field takes paths, so it takes `#watch` too, and on the canvas the
 * element looks linked. On the published page the browser looks for an
 * element with that id, and the elements an author places carry no id they
 * can set, so the press goes nowhere. Two fragments are not that trap and are
 * left out: `#top` (any case), which a browser scrolls to the top of the page
 * with no element needed, and a value holding a `{{…}}` binding, whose text is
 * not known until the page renders. A lone `#` names no element either, and
 * means the top of the page.
 */
export function bareFragmentOfLinkValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith('#') || trimmed.includes('{{')) return undefined
  const fragment = trimmed.slice(1)
  if (!fragment || fragment.toLowerCase() === 'top') return undefined
  return fragment
}

/**
 * What a link field says while its value is a bare fragment, or `undefined`
 * (AGL-2867). It names the interaction that does what the fragment was
 * reaching for, because the author is looking at the field, not at the docs.
 */
export function bareFragmentLinkWarning(value: unknown): string | undefined {
  const fragment = bareFragmentOfLinkValue(value)
  if (fragment === undefined) return undefined
  return (
    `Elements you place carry no id, so #${fragment} goes nowhere on the ` +
    'published page. To take visitors to an element, clear this and add an ' +
    'interaction: When clicked → Scroll to element.'
  )
}

/**
 * {@link bareFragmentLinkWarning} as a form field's `resolveProps`, for a link
 * attribute in a component schema: the field's helper text carries the warning
 * while the value is a bare fragment, and the field's own description
 * otherwise. Computed from the live value, so it appears as the fragment is
 * typed and clears as it is removed.
 */
export function bareFragmentLinkFieldProps(
  _props: unknown,
  field: { input?: { value?: unknown } },
): { helperText?: string } {
  const warning = bareFragmentLinkWarning(field?.input?.value)
  return warning ? { helperText: warning } : {}
}

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
