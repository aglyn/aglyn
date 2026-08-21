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

import { HOST_ERROR_SCREEN_SLOTS, type ScreenUid } from '../foundation'
import { PLATFORM_BRAND_NAME } from './platform-brand'

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
 * mechanisms, both of which resolve ahead of `[host]/[[...slug]]`:
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
 *    app owns. `/search` matches `app/[host]/search`; the other three are the
 *    middleware matcher's exclusions, so no host rewrite happens at all and
 *    the path is parsed as `[host]` with an empty slug.
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
  'api',
  '_next',
  '_static',
]

/**
 * The reserved segment a routing-map path would collide with, or `undefined`
 * when the path is servable. The segment rather than a boolean, so a refusal
 * can name what it is refusing over.
 *
 * Reads the FIRST segment only. For `api`/`_next`/`_static` that is exactly
 * right — the middleware excludes the whole subtree, so `api/docs` is as dead
 * as `api`. For `404`/`500`/`search` it over-refuses in principle (`/404/why`
 * would serve), and that is deliberate: a child path only exists when its
 * PARENT screen is published, the parent would sit at `404`, and this same
 * rule refuses that. A second list to express a case that cannot arise would
 * be a second list to keep correct.
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

/** What a screen is ACTUALLY served at, where that is not its own slug. */
export interface LinkableScreenRouteSources {
  /**
   * screen id → the routing-map path the screen really answers on, for
   * screens routed by something other than their own slug. Today that is a
   * content collection's LIST template: `/{collectionSlug}` renders it
   * (`composeCollectionTemplatePage`), whatever slug it was published under.
   * Applied LAST, so it also un-drops a screen named in `unrouted`.
   */
  routedElsewhere?: Record<string, string> | null | undefined
  /**
   * Screen ids that serve NO address of their own — a collection ENTRY
   * template (AGL-1267), commerce's PDP/catalog templates (AGL-1270), a
   * screen that says `kind: 'template'` (AGL-1400). The tenant router drops
   * these before matching, so their routing-map path is a 404.
   */
  unrouted?: Iterable<string> | null | undefined
}

/**
 * The routing map as a LINK TARGET table (AGL-1998).
 *
 * The host's `screens` map is written by publishing, one entry per screen
 * under its own composed slug, and the tenant router then edits it at serve
 * time: template screens are dropped (see {@link LinkableScreenRouteSources})
 * and a collection's list template is reached at `/{collectionSlug}` instead.
 * Everything that RESOLVES a screen link — `resolveScreenHref` on the live
 * site, the besigner's screen picker, every `Link`-typed component prop — was
 * reading the raw map, so the two surfaces disagreed with the router in both
 * directions at once:
 *
 *  - `/blog` was UNOFFERABLE. The blog's list template is published under
 *    `blog-list-template` and serves `/blog`, so no screen link on aglyn.com
 *    could point at the site's own blog index.
 *  - Every template screen was offered at a path that 404s, and an author who
 *    picked one got a dead anchor that looks exactly like a live one.
 *
 * So the map every linking surface reads is derived here, from the same two
 * facts the router uses, and the picker can no longer offer a path the router
 * would refuse. A raw map with neither source given comes back unchanged; an
 * absent map with no overrides stays absent, because `undefined` means
 * "nothing resolves yet" to {@link ScreenLinkContext} and `{}` would mean
 * "resolved: nowhere".
 */
export function linkableScreenRoutes(
  screens: Record<ScreenUid, string> | null | undefined,
  sources: LinkableScreenRouteSources = {},
): Record<ScreenUid, string> | undefined {
  const { routedElsewhere, unrouted } = sources
  const overrides = Object.entries(routedElsewhere ?? {})
  if (!screens && !overrides.length) return undefined
  const next: Record<ScreenUid, string> = { ...(screens ?? {}) }
  for (const id of unrouted ?? []) delete next[id]
  for (const [id, path] of overrides) {
    // A collection slug (`blog`) arrives in the map's own format already, but
    // the same fact is spelled `/blog` in half the places it is read from, and
    // a stored `/blog` would resolve to `//blog` — an absolute URL to the host
    // `blog`, i.e. off the site entirely.
    const normalized =
      typeof path === 'string' && path !== SCREEN_ROOT_PATH
        ? path.replace(/^\/+|\/+$/g, '')
        : path
    if (!normalized) continue
    next[id] = normalized
  }
  return next
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

/**
 * `kind` of a designed ERROR screen (AGL-2092): the screen a host assigns to
 * one of `errorScreens`' four status slots, rendered on paths that did not
 * match — and so, like an entry template, at no address of its own.
 *
 * Zach's decision on 2026-08-18 was that these must not spend the plan's screen
 * allowance, for the reason AGL-1173 excluded an entry template: the governing
 * question is whether the screen occupies a URL of its own, and a 404 body does
 * not. (A collection's LIST template does — `/{collectionSlug}` renders that
 * exact screen — which is why AGL-1387 left it counting.)
 *
 * ## This value does NOT get `kind: 'template'`'s trust
 *
 * `billableScreenIds` short-circuits on `SCREEN_KIND_TEMPLATE` BEFORE it
 * consults the routing map, because a template is routed on purpose. An error
 * screen is not, so it deliberately falls through to the ordinary rule and
 * **the routing map outranks this field**: a screen still published at an
 * address of its own counts, whatever it says about itself. That is the whole
 * migration story for the error screens that already exist — see
 * {@link ERROR_SCREEN_MAX_PER_HOST}.
 *
 * Stamped only by /api/hosts/screens, as part of binding the screen to a slot,
 * and frozen against the client by the same rule that has frozen `kind` since
 * AGL-1383. Nothing about that is new for this value; what IS new is that the
 * stamp is BOUNDED, because unlike a template there is no natural limit on how
 * many screens somebody would like to declare as error pages.
 */
export const SCREEN_KIND_ERROR = 'error'

/**
 * How many screens one host may hold with `kind: 'error'` (AGL-2092).
 *
 * An exclusion the metered party can ask for is a free-screen generator unless
 * something bounds it, and the four bindings in `HostErrorScreens` are the
 * bound: at most one exempt screen per error slot. It is `.length` of the slot
 * list rather than a literal `4` so the two can never disagree.
 *
 * Checked in TWO places, and the second is the one that makes the number true
 * (AGL-2093). At the moment of the STAMP, against the post-state — the
 * AGL-1390 shape, which produces the refusal worth reading because it can name
 * the four slots. And inside `billableScreenIds` itself, where a live error
 * screen past this bound is counted as an ordinary page: the stamp is not the
 * only writer, and a crafted import bundle carrying `kind: 'error'` on all 200
 * of its screens passed no bound at all until the rule owned one. An exclusion
 * enforced only at the write paths somebody remembered is the sentence this arc
 * has now repeated six times.
 *
 * The tempting alternative is to enforce "bound to a slot" as an
 * invariant, promoting a screen back to a page whenever its slot is cleared;
 * that is AGL-1390's refuse-the-clear bug wearing a different hat, because
 * promotion raises the count and a host at its cap could then never unassign an
 * error screen. So clearing a slot is always allowed and leaves the screen an
 * error screen — unbilled, unrouted, and one deliberate click from being a page
 * again — and what is bounded is how many of them can exist at once.
 */
export const ERROR_SCREEN_MAX_PER_HOST = HOST_ERROR_SCREEN_SLOTS.length

/** The two self-describing fields {@link screenClaimsToBeAPage} reads. */
export interface ScreenPageClaim {
  kind?: string
  deletedAt?: unknown
}

/**
 * Whether a screen document claims to be a page of the site at all (AGL-1383).
 *
 * Four things say it is not: `deletedAt` (soft-deleted — delete stamps the
 * field rather than removing the doc), `kind: 'email'` (an Emails-page
 * document, which has no URL and is rendered only by the campaign sender,
 * straight off the doc), `kind: 'template'` (a collection entry template,
 * which composes `/{collection}/{entry}` and has no address of its own —
 * AGL-1400) and `kind: 'error'` (a screen assigned to one of the host's four
 * error slots, rendered on paths that matched nothing — AGL-2092). All four
 * are also the exclusions `countBillableScreens` subtracts before enforcing
 * `screensPerHost`, and since AGL-1400 they are the WHOLE of that subtraction:
 * the count reads no other collection.
 *
 * Adding the fourth needed no edit to `billableScreenIds` and no edit to
 * `nonPageScreenIds`, which is the property AGL-1439 wrote them for: the
 * routing-map override applies to a new non-page `kind` by default, and the
 * flat infrastructure cap is the complement, so there is no second list to
 * remember. Only `kind: 'template'` is named anywhere else, because only it
 * opts OUT of the routing-map override.
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
 * `kind: 'error'` is in the client-can-still-reach group for counting purposes
 * even though no client writes it either: an error screen that is ALSO
 * published at an address is a page somebody is using as a page, so the map
 * outranks the stamp and it counts. Serving is the other way round — see
 * `getScreen`, which returns error screens rather than 404ing them, because
 * refusing would break the customer's own designed error page without closing
 * anything (they are already paying for it if it is routed).
 *
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
    screen.kind !== SCREEN_KIND_TEMPLATE &&
    screen.kind !== SCREEN_KIND_ERROR
  )
}

/**
 * One screen, reduced to the two things {@link billableScreenIds} asks about.
 *
 * Rows rather than a query (AGL-1390) because the enforcement points ask about
 * a state that does not exist yet: a promotion is checked against the count it
 * WOULD leave behind. A function that does its own reads can only answer for
 * the present. `readScreenSources` in /api/hosts/resources is the reader.
 */
export interface BillableScreenSource {
  id: string
  kind?: unknown
  deletedAt?: unknown
}

/**
 * A host's `screens` routing map (screen id → route path) as
 * `publishScreenRoute` writes it. Only membership is read, never the path.
 */
export type ScreenRoutingMap = Record<string, unknown> | null | undefined

/**
 * WHICH screens spend the plan's screen allowance (AGL-1173).
 *
 * The ids rather than the count, because an enforcement point that cannot name
 * the screen it is refusing over is a refusal the person reading it cannot act
 * on.
 *
 * A plain `screens.count()` charged for three things the subscriber never
 * chose to author, and the screens list — which filters them out — then
 * disagreed with the server about how much of the plan was used:
 *
 *  - **Soft-deleted screens.** Delete stamps `deletedAt` rather than
 *    removing the doc, so deleting a screen never freed a slot. On the free
 *    plan (5 screens) that was a dead end with no way out from the UI.
 *  - **Email screens** (`kind: 'email'`), which live on the Emails page and
 *    were already excluded from the list count but not from enforcement.
 *  - **A collection's ENTRY template** — one screen serving every entry at no
 *    URL of its own. Adding a blog cost two of the free plan's five screens
 *    before the first page existed.
 *
 * ## Why it lives HERE, next to the predicate (AGL-2093)
 *
 * It was in /api/hosts/resources, and the console's Screens page — which runs
 * the same rule as a precheck before it lets somebody add a page — could not
 * import it from there (that module reaches `@aglyn/aglyn/server`, which pulls
 * `node:stream` in through the API adapter). So the page restated it, and the
 * restatement drifted: it never learned the error-screen bound below, and on a
 * host holding five `kind: 'error'` screens the console offered room the API
 * then refused. A precheck that warns on a different number than the API
 * enforces is worse than no precheck at all, and a rule that has to be
 * restated to be reused will be restated wrongly eventually. One function, two
 * callers.
 *
 * ## ONE document answers it now (AGL-1400)
 *
 * The third exclusion used to be a JOIN: the count read the `collections`
 * collection and subtracted whatever screen ids the template pointers named.
 * That shape produced four issues in one arc, because the other side of the
 * join is editable and each new way to edit it was a new bypass — AGL-1173
 * created the exclusion, AGL-1383 froze the two fields the screen itself
 * carried, AGL-1387 found the list template was a page after all, and AGL-1390
 * found the pointer could be toggled to mint permanent slots and had to move
 * the write server-side and evaluate the cap against the post-state.
 *
 * Since AGL-1400 an entry template says so on its own document
 * (`kind: 'template'`), stamped by /api/hosts/screens and frozen in the rules
 * exactly as `kind: 'email'` is. So this reads the `screens` collection and
 * nothing else: the pointer is a pointer again, freely writable, and it excuses
 * nothing. `screenClaimsToBeAPage` is the whole rule, which is the property
 * that keeps the count and the serve path (`getScreen`) from ever disagreeing.
 *
 * What did NOT change is what anybody pays. A collection's LIST template stays
 * a page — `/{collectionSlug}` renders that exact screen (AGL-1387) — so it is
 * never stamped and still counts, and an entry template stays excluded
 * (AGL-1173's charge is not reinstated).
 *
 * ## The routing map outranks the document, and ONLY ADDS (AGL-1383, AGL-1445)
 *
 * `deletedAt` and `kind: 'email'` are ordinary client-writable fields on the
 * screen's OWN document, and the party they are subtracted on behalf of is the
 * party being metered. `updateDoc(screenRef, {kind: 'email'})` — one write, no
 * route change — used to take a live page off a Free plan's five and leave it
 * serving, because nothing else read either field. So for those two the
 * document's account of itself is consulted only for screens the routing map
 * does not route: **a routed screen counts, whatever it says about itself**.
 *
 * The converse is NOT true and must not become true, which is AGL-1445's
 * settlement. An unrouted screen with no slug — a draft, or an orphan left
 * behind by an unpublish — serves nothing, and it still counts:
 *
 *  - `screensPerHost` is a CREATE-TIME gate. /api/hosts/resources counts and
 *    refuses; `report-usage` re-measures monthly but RECORDS rather than
 *    enforces. The create is the only door.
 *  - A screen is born unrouted, and publishing is a separate later act — a
 *    client `updateDoc` on the host's `screens` map (`publishScreenRoute`),
 *    gated on `canPublishHostContent` and on nothing else.
 *
 * So subtracting unrouted screens would not make the count fairer, it would
 * make every create free — the new document is unrouted by construction — and
 * leave the publishes that follow ungated. A Free site would hold unlimited
 * pages. AGL-1445's option 2 (server-stamping a non-page `kind` on orphans by
 * a sweep) lands in the same place unless the promotion BACK passes a gate,
 * and for an orphan the promotion is the publish. `kind: 'template'` can be
 * trusted precisely because its promotion is `convertScreenKind`, checked
 * exactly like a create; there is no equivalent door in front of the routing
 * map. The price is one slot until somebody deletes the orphan, which is one
 * click and which the Screens page lists like any other row —
 * `unrouted-screen-counts.spec.ts` pins it at the enforcement point.
 *
 * `kind: 'template'` is deliberately outside the map's override, and it is the
 * one value that can be. A template is routed ON PURPOSE — publishing is how
 * the compose pipeline picks it up, and AGL-1267 drops it from routing when the
 * request arrives — so the map cannot be the arbiter for it. What makes
 * trusting it safe is that no client writes it: the demotion that sets it
 * always succeeds (it lowers the count) and the promotion that clears it is
 * checked exactly like a create (it raises it), so there is no toggle to run a
 * loop through.
 */
export function billableScreenIds(
  screens: ReadonlyArray<BillableScreenSource>,
  routingMap?: ScreenRoutingMap,
): Set<string> {
  const routed = new Set(Object.keys(routingMap ?? {}))
  const exemptErrors = exemptErrorScreenIds(screens)
  const billable = new Set<string>()
  for (const screen of screens) {
    if (screen.kind === SCREEN_KIND_TEMPLATE) continue
    const claimsToBeAPage = screenClaimsToBeAPage({
      kind: screen.kind as string,
      deletedAt: screen.deletedAt,
    })
    // A `kind: 'error'` screen OVER the slot bound is a page again (AGL-2093).
    const exemptionSpent =
      screen.kind === SCREEN_KIND_ERROR &&
      screen.deletedAt == null &&
      !exemptErrors.has(screen.id)
    if (routed.has(screen.id) || claimsToBeAPage || exemptionSpent) {
      billable.add(screen.id)
    }
  }
  return billable
}

/**
 * The live `kind: 'error'` screens whose billing exemption actually HOLDS —
 * at most {@link ERROR_SCREEN_MAX_PER_HOST} of them (AGL-2093).
 *
 * ## Why the bound lives here and not at one endpoint
 *
 * AGL-2092 introduced the exemption and bounded it at four — one per
 * `HostErrorScreens` slot — by checking the post-state at the moment
 * /api/hosts/screens STAMPS the kind. That made the claim true of the assign
 * route and false end to end, because the stamp is not the only writer:
 * `SITE_EXPORT_FIELDS.screens` carries `kind`, so a hand-edited bundle could
 * declare `kind: 'error'` on all 200 of its screens and /api/hosts/import
 * excluded every one of them from `screensPerHost` — never passing the bound,
 * never binding a slot. N unbilled screens, one file.
 *
 * That is the arc's fifth repetition of one sentence (AGL-1173, AGL-1383,
 * AGL-1387, AGL-1390, AGL-1400): *an exclusion enforced at a write path is
 * enforced only at the write paths somebody remembered.* So the bound moves
 * into the rule the enforcement points SHARE. However a screen came to say
 * `kind: 'error'` — assign, import, or the next writer — a host gets four
 * unbilled ones and the rest spend the plan's allowance exactly as pages do.
 *
 * ## Which four
 *
 * The lowest ids, sorted. The choice is arbitrary and the DETERMINISM is not:
 * every enforcement point models a post-state by re-running this over a
 * different row set, and a rule that picked "the first four encountered" would
 * hand two callers different answers for the same host. The SIZE of the exempt
 * set never depends on the order — it is `min(live errors, 4)` — so only which
 * ids a refusal message names can move, never whether one is refused.
 *
 * Tombstones are excluded for `nonPageScreenIds`' reason: a cap counting
 * soft-deleted rows is AGL-1173's bug one cap over, where deleting an error
 * screen never frees its slot.
 *
 * The stamp-time bound in /api/hosts/screens is deliberately KEPT. It is the
 * better refusal — it names the four slots and arrives before the write — and
 * this is the backstop under it, so no writer can mint a fifth unbilled error
 * screen even by a path that never consults it.
 */
export function exemptErrorScreenIds(
  screens: ReadonlyArray<BillableScreenSource>,
): Set<string> {
  const live: Array<string> = []
  for (const screen of screens) {
    if (screen.kind !== SCREEN_KIND_ERROR) continue
    if (screen.deletedAt != null) continue
    live.push(screen.id)
  }
  if (live.length <= ERROR_SCREEN_MAX_PER_HOST) return new Set(live)
  return new Set(live.sort().slice(0, ERROR_SCREEN_MAX_PER_HOST))
}

/**
 * The screens the flat platform cap bounds (AGL-1399, AGL-1439): LIVE documents
 * that are not billable pages — the exact complement of {@link billableScreenIds}.
 *
 * ## Why the complement, and not `kind === 'email' || kind === 'template'`
 *
 * Both issues are one sentence — *a `kind` value that excludes a document from
 * billing, declarable by the metered party* — and a cap that enumerated the two
 * values would be correct until the third arrived, which is how this arc has
 * already gone four times (AGL-1173, AGL-1383, AGL-1387, AGL-1390). Written as
 * the complement, a new non-page `kind` is bounded by the act of adding it to
 * `screenClaimsToBeAPage`: there is no second list to remember.
 *
 * Two properties fall out of taking the complement rather than negating the
 * predicate directly:
 *
 *  - **A soft-deleted screen is in NEITHER set.** Delete stamps `deletedAt`
 *    rather than removing the doc, and a cap that counted tombstones would be
 *    the AGL-1173 bug one cap over — deleting an email document would never free
 *    a slot, and a host at the cap could never author another.
 *  - **A ROUTED email document counts once, against the plan.** The routing map
 *    outranks the document (AGL-1383), so such a screen is a page somebody is
 *    already paying for; charging it to the infrastructure cap as well would be
 *    counting one document twice. The two sets partition the live screens.
 *
 * Taking the complement is also what makes AGL-2093's bound arrive here for
 * free: an error screen past `ERROR_SCREEN_MAX_PER_HOST` becomes billable
 * above, so it leaves this set in the same act. The partition holds — every
 * live screen is in exactly one of the two — and the fifth error screen is
 * bounded by the PLAN rather than by the flat 5,000, which is the stronger of
 * the two numbers on every finite tier.
 */
export function nonPageScreenIds(
  screens: ReadonlyArray<BillableScreenSource>,
  routingMap?: ScreenRoutingMap,
): Set<string> {
  const billable = billableScreenIds(screens, routingMap)
  const nonPage = new Set<string>()
  for (const screen of screens) {
    if (screen.deletedAt != null) continue
    if (!billable.has(screen.id)) nonPage.add(screen.id)
  }
  return nonPage
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
