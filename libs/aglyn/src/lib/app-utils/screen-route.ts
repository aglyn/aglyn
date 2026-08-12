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

import type { ScreenUid } from '../foundation'

/**
 * Route path of a host's root screen. The tenant matcher joins the catch-all
 * segments (`(params.slug || ['/']).join('/')`), so the root is `'/'` and
 * every other path is slash-joined segments WITHOUT a leading slash
 * (`about`, later `company/about`).
 */
export const SCREEN_ROOT_PATH = '/'

/**
 * Normalizes user slug input into the routing-map path format described on
 * {@link SCREEN_ROOT_PATH}. Empty input and `/` normalize to the root path;
 * anything else becomes a single lowercase url-safe segment. Returns
 * `undefined` when nothing survives sanitization (e.g. `'###'`), which
 * callers should treat as invalid rather than silently publishing.
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

/** Minimal screen shape the hierarchy helpers need. */
export interface ScreenRouteNode {
  slug?: string
  parentId?: ScreenUid
}

/** Defensive cap: parent chains deeper than this are treated as invalid. */
const MAX_SCREEN_DEPTH = 32

/**
 * Composes a screen's routing-map path from its own slug plus its ancestor
 * chain: parent `company` + own `about` → `company/about`. Root (`'/'`)
 * segments contribute nothing, so children of the home screen sit at the
 * top level. Returns `undefined` when the screen (or any ancestor) has no
 * slug, when the screen's own slug is `'/'` while it has a parent, or when
 * the chain has a cycle / exceeds {@link MAX_SCREEN_DEPTH}.
 */
export function composeScreenRoutePath(
  screenId: ScreenUid,
  screensById: Record<ScreenUid, ScreenRouteNode | undefined>,
): string | undefined {
  const segments: string[] = []
  const visited = new Set<ScreenUid>()
  let currentId: ScreenUid | undefined = screenId

  while (currentId) {
    if (visited.has(currentId) || visited.size >= MAX_SCREEN_DEPTH) {
      return undefined
    }
    visited.add(currentId)
    const screen = screensById[currentId]
    if (!screen?.slug) return undefined
    if (screen.slug === SCREEN_ROOT_PATH) {
      // The home screen's segment is empty (children of home sit at the top
      // level), but a screen can't itself be the home page AND have a parent.
      if (currentId === screenId && screen.parentId) return undefined
    } else {
      segments.unshift(screen.slug)
    }
    currentId = screen.parentId
  }

  if (!segments.length) {
    return screensById[screenId]?.slug === SCREEN_ROOT_PATH
      ? SCREEN_ROOT_PATH
      : undefined
  }
  return segments.join('/')
}

/**
 * All screens whose parent chain passes through `screenId` (children,
 * grandchildren, …). Used to cascade routing-map rewrites when a screen's
 * slug or parent changes.
 */
export function collectScreenDescendantIds(
  screenId: ScreenUid,
  screensById: Record<ScreenUid, ScreenRouteNode | undefined>,
): ScreenUid[] {
  const childrenByParent = new Map<ScreenUid, ScreenUid[]>()
  for (const [id, screen] of Object.entries(screensById)) {
    if (!screen?.parentId) continue
    const siblings = childrenByParent.get(screen.parentId) ?? []
    siblings.push(id)
    childrenByParent.set(screen.parentId, siblings)
  }
  const result: ScreenUid[] = []
  const queue = [...(childrenByParent.get(screenId) ?? [])]
  while (queue.length) {
    const id = queue.shift() as ScreenUid
    if (result.includes(id)) continue
    result.push(id)
    queue.push(...(childrenByParent.get(id) ?? []))
  }
  return result
}

/**
 * True when making `nextParentId` the parent of `screenId` would create a
 * loop — i.e. the candidate parent is the screen itself or one of its own
 * descendants.
 */
export function wouldCreateScreenCycle(
  screenId: ScreenUid,
  nextParentId: ScreenUid | undefined,
  screensById: Record<ScreenUid, ScreenRouteNode | undefined>,
): boolean {
  if (!nextParentId) return false
  if (nextParentId === screenId) return true
  return collectScreenDescendantIds(screenId, screensById).includes(
    nextParentId,
  )
}

/**
 * Routing-map entries for a screen plus all its descendants under a
 * candidate screens map: a composed path sets the entry, `null` marks an
 * existing entry whose chain no longer resolves for removal. Callers apply
 * the result in one write so slug/parent changes cascade atomically.
 */
export function buildScreenRouteEntries(
  screenId: ScreenUid,
  screensById: Record<ScreenUid, ScreenRouteNode | undefined>,
  routingMap: Record<ScreenUid, string> | null | undefined,
): Record<ScreenUid, string | null> {
  const entries: Record<ScreenUid, string | null> = {}
  const ids = [screenId, ...collectScreenDescendantIds(screenId, screensById)]
  for (const id of ids) {
    const path = composeScreenRoutePath(id, screensById)
    if (path) entries[id] = path
    else if (routingMap?.[id] !== undefined) entries[id] = null
  }
  return entries
}

/**
 * Looks up which screen currently owns a routing path, for sibling-slug
 * uniqueness checks before publishing.
 */
export function findScreenIdByRoutePath(
  screens: Record<ScreenUid, string> | null | undefined,
  path: string,
): ScreenUid | undefined {
  if (!screens) return undefined
  const entry = Object.entries(screens).find(([, value]) => value === path)
  return entry?.[0]
}

/** Human-facing URL for a routing-map path (`'/'` stays `/`, `about` → `/about`). */
export function screenRoutePathToUrl(path: string): string {
  return path === SCREEN_ROOT_PATH ? SCREEN_ROOT_PATH : `/${path}`
}

/**
 * `kind` of a besigner email document (AGL-395): a screen authored on the
 * Emails page and sent by a campaign, never served at a URL.
 */
export const SCREEN_KIND_EMAIL = 'email'

/**
 * `kind` of a collection ENTRY template (AGL-1400): a screen that composes
 * `/{collection}/{entry}` for every entry and has no address of its own.
 *
 * The value exists so that "is this screen a page?" stops being a JOIN.
 * Four issues (AGL-1173, AGL-1383, AGL-1387, AGL-1390) were the same sentence
 * at different depths because the answer was derived from a mutable field on a
 * DIFFERENT document — a collection's `entryScreenId` — and every new way to
 * edit that pointer was a new bypass of `screensPerHost`. Here the fact is a
 * property of the screen, server-stamped by /api/hosts/screens and frozen in
 * the rules exactly as `kind: 'email'` has been since AGL-1383.
 *
 * NOT a collection's LIST template. `/{collectionSlug}` renders that exact
 * screen with its entries, so it is a designed reachable page and AGL-1387
 * made it count; converting one would take the page off the site.
 */
export const SCREEN_KIND_TEMPLATE = 'template'

/** The two self-describing fields {@link screenClaimsToBeAPage} reads. */
export interface ScreenPageClaim {
  kind?: string
  deletedAt?: unknown
}

/**
 * Whether a screen document claims to be a page of the site at all (AGL-1383).
 *
 * Three things say it is not: `deletedAt` (soft-deleted — delete stamps the
 * field rather than removing the doc), `kind: 'email'` (an Emails-page
 * document, which has no URL and is rendered only by the campaign sender,
 * straight off the doc) and `kind: 'template'` (a collection entry template,
 * which composes `/{collection}/{entry}` and has no address of its own —
 * AGL-1400). All three are also the exclusions `countBillableScreens`
 * subtracts before enforcing `screensPerHost`, and since AGL-1400 they are the
 * WHOLE of that subtraction: the count reads no other collection.
 *
 * That is exactly why this is ONE function with TWO callers rather than two
 * matching filters. Both fields are ordinary client-writable fields on
 * `hosts/{hostId}/screens/{screenId}`, and until AGL-1383 only the count read
 * them: an editor on a Free site could `updateDoc(screenRef, {kind: 'email'})`
 * and the screen stopped counting against the plan while the routing map still
 * pointed at it and the runtime still served it — a live page, for free. An
 * exclusion is only sound if an excluded screen genuinely is not a page, so the
 * serve path asks this question too, and flipping either field now costs the
 * page instead of the plan.
 *
 * A CLAIM, not the answer, for the two fields a client can still reach: the
 * routing map decides reachability, and `countBillableScreens` trusts
 * `deletedAt` / `kind: 'email'` only for screens the map does not route.
 * `kind: 'template'` is the exception, and the reason it can be one is that no
 * client writes it — /api/hosts/screens stamps it, demotion lowers the count
 * and promotion is checked exactly like a create, so there is no toggle to
 * launder. A template is ROUTED on purpose (publishing is how the compose
 * pipeline picks it up), which is why the map cannot be the arbiter for it.
 */
export function screenClaimsToBeAPage(
  screen: ScreenPageClaim | null | undefined,
): boolean {
  if (!screen) return false
  return (
    screen.deletedAt == null &&
    screen.kind !== SCREEN_KIND_EMAIL &&
    screen.kind !== SCREEN_KIND_TEMPLATE
  )
}

/**
 * How many LIVE screen documents a host may hold that are NOT billable pages —
 * email documents, entry templates, and whatever non-page `kind` comes next
 * (AGL-1399, AGL-1439).
 *
 * ## Why a flat number and not a plan dimension
 *
 * Every exclusion `screenClaimsToBeAPage` names is declared by the party being
 * metered: `kind: 'email'` is on the create allow-list because the email
 * composer must send it, and AGL-1400 gave `kind: 'template'` the same
 * billing-excluding meaning. So `POST /api/hosts/resources` with
 * `kind: 'email'` created a document that no cap counted, without limit, on a
 * free plan — unbounded Firestore documents rather than a bypass of anything we
 * sell. AGL-1439 is the same sentence one value over, and a cap enumerating the
 * two values would leave the hole open for the third.
 *
 * The shape is `WEBHOOK_MAX_PER_HOST`'s (AGL-1360): no `OrgEntitlements` key, no
 * variation by plan, counted from a server read at the create path. An
 * `emailDocumentsPerHost` would have been a **pricing** decision — a number the
 * price list has to explain and support has to defend — for a limit whose only
 * job is to bound infrastructure. This is not the charge AGL-1173 removed and it
 * does not reinstate it: nothing here is billable, and `screensPerHost` counts
 * exactly what it counted yesterday.
 *
 * ## Why 5,000
 *
 * Sized to the heaviest library anybody could plausibly author, not to what
 * exists: production's busiest host holds FOUR non-page screens (one email,
 * three entry templates) across five hosts, so any bar sized to today's data
 * would be meaningless. The real quantity is campaigns, which accumulate and are
 * never deleted — a DAILY newsletter reaches 5,000 after thirteen years, and a
 * thrice-weekly one after thirty-two. Entry templates contribute one per
 * collection, so tens at the outside. Nothing a real customer does approaches
 * this, which is the property that matters: the failure mode of a too-low flat
 * cap is blocking legitimate work with an error the price list cannot explain.
 *
 * A cheaper bound is not worth much either. What the number defends against is a
 * script in a loop, and a loop stopped at 5,000 documents is stopped. It also
 * bounds the cost of the count itself — `countBillableScreens` scans the screens
 * collection on every create at one billed read per document (AGL-1440), and
 * before this cap that scan had no ceiling at all.
 */
export const NON_PAGE_SCREEN_MAX_PER_HOST = 5000
