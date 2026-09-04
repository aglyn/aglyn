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
 * Ask the tenant runtime to drop one screen's cached HTML (AGL-1150).
 *
 * Publishing is a CLIENT write — the editor sets `screens/{id}.versionId`
 * directly — so there is no server step to hang this off. The browser cannot
 * call the tenant itself either: that route is secret-authenticated, and a
 * secret in a browser is not a secret. So the chain is
 *
 *     browser  →  here (the user's ID token, membership checked)
 *              →  tenant /api/revalidate (service secret)
 *
 * This route is the only place that holds both facts: who the caller is, and
 * what the tenant's cache key for that screen looks like.
 *
 * BEST EFFORT, ALWAYS. A publish has already succeeded by the time this is
 * called — the pointer is written and the page is live-but-stale. Failing here
 * must never make a successful publish look failed; the old 60-second window
 * is still underneath as the backstop, so the worst outcome is the behaviour
 * we had before.
 */

import {
  COLLECTION_CATEGORIES_MAX,
  COLLECTION_LIST_PAGE_SIZE,
  COLLECTION_SOURCE_MAX,
  collectionCategorySlug,
  collectionListUrl,
  hostCollectionKind,
  hostRoleCanPublish,
  pluginRequestFromWeb,
  screenRoutePathToUrl,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  screenIdsUsingCollectionDeep,
  screenIdsUsingComponentDeep,
  screenIdsUsingFormDeep,
  screenIdsUsingLayoutDeep,
} from '../../../../utils/server/scan-artifact-usage'
import { readUsageCandidates } from '../../../../utils/server/read-usage-candidates'
import { postTenantRevalidate } from '../../../../utils/server/tenant-revalidate'

export const dynamic = 'force-dynamic'


/**
 * May this caller drop cached pages for this site? (AGL-1326)
 *
 * There are TWO populations who can publish here, and this route only knew
 * about one. `hosts/{hostId}.memberRoles` is a PROJECTION of the org roster
 * (`projectHostMemberRoles`), written by the membership APIs so the Firestore
 * rules can authorize host content with the host-doc read they already do. It
 * is a fast path, not the source of truth. The truth lives on
 * `orgs/{orgId}/members/{uid}`, and it covers people the projection can miss:
 * an org owner or admin reaches every site in the workspace BY ROLE — they are
 * frequently never added to an individual site — and a projection that is
 * stale, or was never written for a host created outside the membership APIs,
 * locks the actual owner of the site out of revalidating their own pages.
 *
 * The fallback is `resolveOrgPermissions` with a host in context, the same
 * helper `/api/hosts/members` authorizes against, and the same gate
 * `/api/presence/token` and `/api/edit-access/token` apply for a host-scoped
 * WRITE. Asking it with `hostId` matters: it answers the site-level question
 * (`hostRole`, via `hostRoleFor`) rather than the org-level one, so a site
 * collaborator scoped to two sites cannot bust a third, and it fails CLOSED on
 * a lookup error (AGL-506).
 *
 * Deliberately not a hand-rolled roster read. `hostRoleFor` is the single
 * predicate the rules projection, the org gate and this route have to agree
 * on; a fourth copy of "may this person write this site" is how they drift.
 *
 * The role SET was such a copy, and this docblock argued against it while a
 * local `new Set(['admin', 'editor'])` sat six lines above (AGL-2350). It is
 * `hostRoleCanPublish` now — the same predicate over `HOST_PUBLISH_ROLES`,
 * whose own comment requires the rules' `canPublishHostContent()` to move
 * with it. Identical today, and it stays identical when the set changes: the
 * `author` role (AGL-2334) is exactly the kind of addition a private copy
 * would have silently mis-answered.
 */
async function mayRevalidate(
  decoded: { uid: string; [claim: string]: unknown },
  hostSnapshot: FirebaseFirestore.DocumentSnapshot,
): Promise<boolean> {
  if (decoded['staff']) return true
  const projected = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
  if (hostRoleCanPublish(projected)) return true
  const { hostRole } = await resolveOrgPermissions(decoded.uid, {
    hostId: hostSnapshot.id,
  })
  return hostRoleCanPublish(hostRole)
}

/**
 * The 404 for a `hostId` that resolves to no site — with the one diagnosis
 * worth a query (AGL-1326).
 *
 * `hostId` is a document id, but every console URL addresses a site by its
 * SUBDOMAIN, so "sent what the address bar says" is the caller error this
 * route actually sees, and answering it with "Unknown site" reads as *your
 * site is gone* rather than *wrong identifier* — the ambiguity that cost this
 * issue two conflicting bug reports. When the value names a real site and the
 * caller may edit it, say so and hand back the id they needed.
 *
 * Gated on that authorization for the reason the role branch below answers 404
 * instead of 403: a caller who cannot edit a site should not learn it exists.
 * Someone probing subdomains gets the flat refusal.
 */
async function unknownSiteResponse(
  firestore: FirebaseFirestore.Firestore,
  decoded: { uid: string; [claim: string]: unknown },
  hostId: string,
): Promise<Response> {
  const bySubdomain = await firestore
    .collection('hosts')
    .where('subdomain', '==', hostId)
    .limit(1)
    .get()
  const candidate = bySubdomain.docs[0]
  if (candidate && (await mayRevalidate(decoded, candidate))) {
    return Response.json(
      {
        error:
          `"${hostId}" is a site subdomain, not a site id — ` +
          `send hostId "${candidate.id}"`,
        reason: 'subdomain-not-id',
        hostId: candidate.id,
      },
      { status: 404 },
    )
  }
  return Response.json({ error: 'Unknown site' }, { status: 404 })
}

/**
 * Every live screen that renders inside `layoutId`, however deep (AGL-1150).
 *
 * Layouts NEST — a screen points at a layout, and that layout can point at a
 * parent layout, which `compose-screen-nodes` walks when composing. So the
 * dependents of a published layout are not just the screens bound directly to
 * it: a screen three levels down renders its chrome too, and shows stale
 * chrome for the whole revalidate window if it is missed.
 *
 * The walk itself is `screenIdsUsingLayoutDeep`, kept pure and tested next to
 * `scanLayoutUsage`; this only does the Firestore read it needs.
 */
async function screenIdsUsingLayout(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  layoutId: string,
): Promise<string[]> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  // Read each collection ONCE and walk in memory. The alternative — a query
  // per level — multiplies round trips by the nesting depth on a path that
  // runs while someone waits for a publish to feel instant.
  const [screenDocs, layoutDocs] = await Promise.all([
    hostRef.collection('screens').get(),
    hostRef.collection('layouts').get(),
  ])
  const toCandidate = (doc: FirebaseFirestore.QueryDocumentSnapshot) => ({
    id: doc.id,
    displayName: doc.get('displayName'),
    name: doc.get('name'),
    deletedAt: doc.get('deletedAt'),
    layoutId: doc.get('layoutId'),
    versionId: doc.get('versionId'),
  })
  /**
   * The binding is per-VERSION with a screen fallback (key-present on the
   * live version wins, `null` there means no layout) — the same resolution
   * `composeScreenNodes` runs. Matching only the screen docs would leave a
   * version-bound screen serving stale chrome for the whole revalidate
   * window, so each live version doc is read and its binding, when present,
   * replaces the screen's before the walk.
   */
  const screenCandidates = screenDocs.docs.map(toCandidate)
  const versionRefs = screenCandidates
    .filter((candidate) => candidate.versionId)
    .map((candidate) =>
      hostRef
        .collection('screens')
        .doc(candidate.id)
        .collection('versions')
        .doc(String(candidate.versionId)),
    )
  if (versionRefs.length) {
    const versionSnapshots = await firestore.getAll(...versionRefs)
    const byPath = new Map(
      versionSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]),
    )
    for (const candidate of screenCandidates) {
      if (!candidate.versionId) continue
      const snapshot = byPath.get(
        hostRef
          .collection('screens')
          .doc(candidate.id)
          .collection('versions')
          .doc(String(candidate.versionId)).path,
      )
      const data = snapshot?.exists ? snapshot.data() : undefined
      if (data && 'layoutId' in data) candidate.layoutId = data.layoutId
    }
  }
  return screenIdsUsingLayoutDeep(
    layoutId,
    screenCandidates,
    layoutDocs.docs.map(toCandidate),
  )
}

/**
 * Every live screen whose output contains `componentId` (AGL-1161).
 *
 * Unlike the layout walk, which matches a `layoutId` POINTER on small docs,
 * this searches node trees — so it has to load the published version body of
 * every screen and layout on the site. That is the cost the issue flagged, and
 * why the caller fires this without awaiting: nobody is staring at one URL
 * waiting for a component publish the way they are for a screen publish.
 *
 * The walk itself is `screenIdsUsingComponentDeep`, kept pure and tested; this
 * only does the Firestore read it needs, through the same reader
 * `/api/hosts/where-used` uses so there is one node-decode implementation.
 */
async function screenIdsUsingComponent(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  componentId: string,
): Promise<{ screenIds: string[]; truncated: boolean }> {
  const sources = await readPlacementSources(firestore, hostId)
  return {
    screenIds: screenIdsUsingComponentDeep(componentId, sources.candidates),
    truncated: sources.truncated,
  }
}

/**
 * Every screen, layout and component of a site, with their node trees — what
 * both tree-searching scans walk.
 *
 * Each collection ONCE, in memory: a query per level would multiply round
 * trips by the nesting depth of the graph. Shared by the component and form
 * scans so the two read the same corpus under the same bound, and a change to
 * one cannot quietly narrow the other.
 */
async function readPlacementSources(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
) {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [screens, layouts, components] = await Promise.all([
    readUsageCandidates(hostRef, 'screens', { withNodes: true, limit: SCAN_LIMIT }),
    readUsageCandidates(hostRef, 'layouts', { withNodes: true, limit: SCAN_LIMIT }),
    readUsageCandidates(hostRef, 'components', {
      withNodes: true,
      limit: SCAN_LIMIT,
    }),
  ])
  return {
    candidates: {
      screens: screens.candidates,
      layouts: layouts.candidates,
      components: components.candidates,
    },
    truncated: screens.truncated || layouts.truncated || components.truncated,
  }
}

/**
 * Every live screen whose output places the form `formId`.
 *
 * The same read the component scan makes, because it answers the same shape of
 * question: a placement is found by searching node trees, so the published
 * body of every screen and layout has to be in hand. Sharing the read means a
 * form publish and a component publish cannot disagree about which pages
 * exist.
 */
async function screenIdsUsingForm(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  formId: string,
): Promise<{ screenIds: string[]; truncated: boolean }> {
  const sources = await readPlacementSources(firestore, hostId)
  return {
    screenIds: screenIdsUsingFormDeep(formId, sources.candidates),
    truncated: sources.truncated,
  }
}

/**
 * What an entry change makes stale, for one content collection.
 *
 * A content entry is not published through a version pointer, so nothing here
 * looks like the publish paths above: the write is a client Firestore write,
 * and the page that renders it is reached by ADDRESS rather than by a screen
 * document. `/blog`, `/blog/page/2`, `/blog/category/guides` and
 * `/blog/my-post` are served by the catch-all's collection fallback, which may
 * have no screen of its own at all, so a routing-map lookup finds nothing to
 * drop and the site keeps serving the old post.
 *
 * Two halves, therefore, and both are needed:
 *
 * - the collection's own ADDRESSES, derived here from its slug;
 * - the SCREENS that render the collection somewhere else — a rail on the
 *   home page, category pills in a layout — which are found by searching node
 *   trees, exactly as a form's placements are.
 *
 * Refuses anything that is not a CONTENT collection. Commerce shares
 * `hosts/{hostId}/collections`, and a product collection's pages are routed by
 * the store's templates rather than by these shapes, so building content
 * addresses from one would drop paths that belong to nothing.
 */
async function collectionRevalidation(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  collectionId: string,
  entrySlugs: string[],
): Promise<{ paths: string[]; screenIds: string[]; truncated: boolean }> {
  const empty = { paths: [], screenIds: [], truncated: false }
  const collectionSnapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('collections')
    .doc(collectionId)
    .get()
  if (!collectionSnapshot.exists) return empty
  const data = collectionSnapshot.data() ?? {}
  if (hostCollectionKind(data) !== 'content') return empty
  if (data['deletedAt']) return empty
  const collectionSlug = String(data['slug'] ?? '').trim()
  if (!collectionSlug || collectionSlug.includes('/')) return empty

  /**
   * Ordered by how much each address matters, because the tenant's path cap
   * takes the FIRST `MAX_PATHS` it is handed. A site whose collection is
   * rendered on more pages than the cap admits therefore loses its deepest
   * category listings rather than the post that was just edited.
   */
  const paths: string[] = []
  const add = (path: string) => {
    if (path && !paths.includes(path)) paths.push(path)
  }

  // The entry's own address first — the one page whose author is watching.
  // Both slugs when a save renamed it: the new address has never been
  // rendered, and the OLD one is a cached page that now belongs to nothing.
  for (const entrySlug of entrySlugs) add(`/${collectionSlug}/${entrySlug}`)
  add(collectionListUrl({ collectionSlug }))

  /**
   * Every page of the unfiltered listing.
   *
   * The whole range rather than a count-derived one. `listLiveEntries` bounds
   * the live set at `COLLECTION_SOURCE_MAX`, and the routed listing pages it
   * at `COLLECTION_LIST_PAGE_SIZE`, so the range is a constant the runtime
   * already enforces — and dropping a page that does not exist is a cache-key
   * delete against a key nothing holds, which costs nothing. Asking Firestore
   * for the exact page count would trade that for a read on every save and
   * still be wrong the moment publishing an entry adds a page.
   */
  const listPages = Math.ceil(COLLECTION_SOURCE_MAX / COLLECTION_LIST_PAGE_SIZE)
  for (let page = 2; page <= listPages; page += 1) {
    add(collectionListUrl({ collectionSlug, page }))
  }

  /**
   * Page one of every category listing.
   *
   * Every category rather than the changed entry's, because an entry can move
   * between two in one save and a delete leaves no entry to ask — so the set
   * that is certainly right is the collection's own, and it is bounded by
   * `COLLECTION_CATEGORIES_MAX`. Page one only: the same range applied to each
   * category is `COLLECTION_CATEGORIES_MAX` times as many paths as the
   * unfiltered listing, which would push the cap over on the categories alone
   * and take the dependent screens with it. Deeper category pages catch up on
   * their own ISR window.
   */
  const categories = Array.isArray(data['categories']) ? data['categories'] : []
  for (const category of categories.slice(0, COLLECTION_CATEGORIES_MAX)) {
    const name = String((category as { name?: unknown })?.name ?? '').trim()
    if (!name) continue
    const categorySlug = collectionCategorySlug(name)
    if (!categorySlug) continue
    add(collectionListUrl({ collectionSlug, categorySlug }))
  }

  const sources = await readPlacementSources(firestore, hostId)
  return {
    paths,
    screenIds: screenIdsUsingCollectionDeep(collectionSlug, sources.candidates),
    truncated: sources.truncated,
  }
}

/**
 * How many documents per collection the component scan will read (AGL-1161).
 *
 * Far above the 200 `/api/hosts/where-used` uses, because the two are asked
 * different questions. That endpoint is advisory — a partial "what would I
 * break" is still useful. This one decides which caches get dropped, so a
 * prefix scan reports a successful publish and leaves real pages serving the
 * old component for the full revalidate window.
 *
 * Still bounded, because unbounded is its own failure: a site with tens of
 * thousands of screens would hold the request open reading version bodies.
 * When the bound bites we SAY so rather than quietly returning a short list —
 * the same choice `4b1120649` made for the tenant route's path cap.
 */
const SCAN_LIMIT = 2000

// The tenant domain and the request timeout moved into `postTenantRevalidate`
// (AGL-2462) when `/v1` gained a publish endpoint — one copy of the call, so
// the two callers cannot disagree about it.

export async function POST(request: Request): Promise<Response> {
  const { body: payload, headers: rawHeaders } = await pluginRequestFromWeb(request)
  // The same narrowing every other Bearer route here uses —
  // `pluginRequestFromWeb` types header values as `string | string[]`.
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = app.firestore()

    const hostId = String((payload as { hostId?: unknown })?.hostId ?? '')
    const screenId = String((payload as { screenId?: unknown })?.screenId ?? '')
    // Publishing a LAYOUT changes every screen rendered inside it (AGL-1150).
    // The caller names what it published; working out which URLs that affects
    // is this route's job, because it is the only side holding both the
    // layout→screen graph and the tenant's cache keys.
    const layoutId = String((payload as { layoutId?: unknown })?.layoutId ?? '')
    // Publishing a COMPONENT changes every screen that renders it, directly,
    // nested inside another component, or through a layout (AGL-1161).
    const componentId = String(
      (payload as { componentId?: unknown })?.componentId ?? '',
    )
    // A REDIRECT RULE changed. Rule edits are client Firestore writes with no
    // publish step, and the rules list sits behind the hour-long
    // `tenant-data:{hostId}` backstop — so without this announcement a new
    // rule waits out the TTL while the manager UI promises ~30 seconds. The
    // caller names the rule's source path; this drops that path's cached HTML
    // and busts the host tag so the next render reads fresh rules. For a
    // prefix or regex rule the literal source is only the best single path —
    // other matching pages catch up on their own ISR window.
    const redirectPath = String(
      (payload as { redirectPath?: unknown })?.redirectPath ?? '',
    )
    /**
     * Addresses named OUTRIGHT by the caller (AGL-2573).
     *
     * Every id above is resolved to URLs through the host's `screens` map,
     * which only works while the map still points at the page. It does not
     * for the two changes that need this most: an UNPUBLISH removes the entry
     * before anything is announced, and a RENAME leaves the old address
     * pointing nowhere. Resolving a `screenId` in either case finds nothing
     * and answers `not-routed` — a success, over a page that is still cached
     * and still being served.
     *
     * So the surface that changed the map, which read the old addresses
     * before overwriting them, sends them. Validated exactly like
     * `redirectPath`, because it is the same kind of value: a site-absolute
     * URL path, trusted no further than one.
     */
    const namedPaths = Array.isArray((payload as { paths?: unknown })?.paths)
      ? ((payload as { paths: unknown[] }).paths
          .map((path) => String(path ?? '').trim())
          .filter((path) => path.startsWith('/') && !path.includes('..'))
          // The tenant's own `MAX_PATHS`; more would be dropped there anyway.
          .slice(0, 250) as string[])
      : []
    // Publishing a FORM changes every page that PLACES it, because a placed
    // form renders the entity's published design rather than the fields the
    // page holds. Before that graft existed a form publish changed nothing a
    // visitor could see, so nothing announced it; now it changes the form on
    // every page at once, and the only alternative to this is waiting out the
    // hour-long `tenant-data:{hostId}` backstop while the besigner says the
    // live sites already serve the new design.
    const formId = String((payload as { formId?: unknown })?.formId ?? '')
    // A content ENTRY changed. Entries have no version pointer and no publish
    // step — saving one is a client Firestore write — and the pages that
    // render them are addressed by slug rather than served by a screen
    // document, so neither of the two things every other branch here relies on
    // exists. The caller names the COLLECTION, because that is what decides
    // which addresses and which screens are affected; `entrySlugs` names the
    // one entry's own address, and carries the previous slug too when a save
    // renamed it, since the page cached at the old address now belongs to
    // nothing.
    const collectionId = String(
      (payload as { collectionId?: unknown })?.collectionId ?? '',
    )
    const entrySlugs = Array.isArray(
      (payload as { entrySlugs?: unknown })?.entrySlugs,
    )
      ? ((payload as { entrySlugs: unknown[] }).entrySlugs
          .map((slug) => String(slug ?? '').trim())
          // A slug is ONE path segment. Anything carrying a separator would
          // name a different page than the entry it claims to be.
          .filter((slug) => slug && !slug.includes('/') && !slug.includes('..'))
          .slice(0, 2) as string[])
      : []
    if (
      !hostId ||
      (!screenId &&
        !layoutId &&
        !componentId &&
        !formId &&
        !collectionId &&
        !redirectPath &&
        !namedPaths.length)
    ) {
      return Response.json(
        {
          error:
            'Missing hostId, and one of screenId, layoutId, componentId, formId, collectionId, redirectPath or paths',
        },
        { status: 400 },
      )
    }
    if (redirectPath && !redirectPath.startsWith('/')) {
      return Response.json(
        { error: 'redirectPath must be a site path like /old-page' },
        { status: 400 },
      )
    }

    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) {
      return unknownSiteResponse(firestore, decoded, hostId)
    }

    // Re-checked here rather than trusted from the client. The Admin SDK
    // bypasses rules, so this route has to re-derive the same membership the
    // rules would have enforced — the standing pattern for every Admin-SDK
    // path in this app. See `mayRevalidate`: the host `memberRoles` projection
    // is one of the two ways in, never the only one (AGL-1326).
    if (!(await mayRevalidate(decoded, hostSnapshot))) {
      // 404 rather than 403: a caller who cannot edit this site should not
      // learn that it exists.
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }

    // Lockdown verdict (AGL-1506): host doc in hand; the owning org's doc
    // is fetched for the org scope (an org lock never stamps host docs, so
    // host-only would miss it). The LOCKDOWN flow's own cache eviction
    // goes through the tenant's /api/revalidate with the service secret,
    // never through here, so this cannot 423 the eviction that makes a
    // lock stick. Staff bypass is the un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    const subdomain = String(hostSnapshot.get('subdomain') ?? '')
    if (!subdomain) {
      return Response.json({ error: 'Site has no subdomain' }, { status: 409 })
    }

    // The routing map is `screenId → path`, and a screen not in it is not
    // routable — nothing to invalidate, which is a success, not an error.
    const screens = (hostSnapshot.get('screens') ?? {}) as Record<string, string>

    let scanTruncated = false
    let affectedScreenIds: string[]
    /**
     * Addresses to drop that no screen document names.
     *
     * A redirect rule's source and a content collection's listings are both
     * URLs the routing map has never heard of — the first because a rule is
     * not a screen, the second because the catch-all's collection fallback
     * serves `/blog/my-post` whether or not a template screen exists. They are
     * carried beside the screen fan-out rather than instead of it: a
     * collection has both.
     */
    let extraPaths: string[] = []
    if (redirectPath) {
      // The rule's source is already a URL path; no screen graph to walk.
      affectedScreenIds = []
      extraPaths = [redirectPath]
    } else if (collectionId) {
      const scan = await collectionRevalidation(
        firestore,
        hostId,
        collectionId,
        entrySlugs,
      )
      affectedScreenIds = scan.screenIds
      extraPaths = scan.paths
      scanTruncated = scan.truncated
    } else if (componentId) {
      const scan = await screenIdsUsingComponent(firestore, hostId, componentId)
      affectedScreenIds = scan.screenIds
      scanTruncated = scan.truncated
    } else if (formId) {
      const scan = await screenIdsUsingForm(firestore, hostId, formId)
      affectedScreenIds = scan.screenIds
      scanTruncated = scan.truncated
    } else if (layoutId) {
      affectedScreenIds = await screenIdsUsingLayout(firestore, hostId, layoutId)
    } else {
      affectedScreenIds = [screenId]
    }

    // Already URL-shaped where they were derived from a slug or a rule;
    // routing-map values need the leading-slash conversion. The derived ones
    // lead, because the tenant's cap takes the first paths it is handed and
    // they are the addresses the change is about.
    const routePaths = [
      // Caller-named addresses lead for the same reason derived ones do: the
      // tenant takes the first paths it is handed, and an address the routing
      // map can no longer resolve is one nothing else in this list will name.
      ...namedPaths,
      ...extraPaths,
      ...affectedScreenIds
        .map((id) => screens[id])
        .filter((path): path is string => Boolean(path))
        .map((path) => screenRoutePathToUrl(path)),
    ].filter((path, index, all) => all.indexOf(path) === index)

    if (scanTruncated) {
      // Say it, in the log and in the response. A publish that scanned a
      // prefix of the site and reported success is the failure this whole
      // arc exists to remove — it looks identical to a complete drop, and
      // the pages it missed sit stale for the full window with nothing
      // anywhere recording that they were skipped.
      console.warn(
        JSON.stringify({
          tag: 'AGL-1161:component-scan-truncated',
          hostId,
          ...(componentId ? { componentId } : {}),
          ...(formId ? { formId } : {}),
          ...(collectionId ? { collectionId } : {}),
          limit: SCAN_LIMIT,
        }),
      )
    }

    if (!routePaths.length) {
      // A layout no live screen renders inside, an unused component, an
      // unrouted screen, or a collection that is gone or is the store's.
      // Nothing to invalidate is a success, not an error.
      return Response.json(
        { revalidated: [], reason: 'not-routed', truncated: scanTruncated },
        { status: 200 },
      )
    }

    // The tenant call itself lives in `postTenantRevalidate` (AGL-2462), so
    // this route and `POST /v1/sites/{siteId}/publish` cannot come to disagree
    // about the request they send — above all about `hostId`, which is what
    // busts `tenant-data:{hostId}` (AGL-1302). Without it a dropped page
    // regenerates from the same cached routing map and version pointers the
    // publish just replaced. It never throws: the publish already succeeded.
    const result = await postTenantRevalidate({
      subdomain,
      hostId,
      paths: routePaths,
      // A site with a domain attached caches its pages under a SECOND key
      // (`cname--acme.com`), and that is the one visitors read — see
      // `postTenantRevalidate`. Without this a publish dropped only the
      // subdomain's copy.
      cname: String(hostSnapshot.get('cname') ?? '') || undefined,
    })
    if (result.reason !== 'ok') {
      return Response.json(
        { revalidated: [], reason: result.reason },
        { status: 200 },
      )
    }
    return Response.json(
      {
        revalidated: result.revalidated,
        reason: 'ok',
        // Carried through so a caller can tell a complete drop from one that
        // only covered part of the site.
        truncated: scanTruncated,
        // The tenant route caps paths too, and says when it drops some
        // (AGL-1161). Pass that on rather than absorbing it here.
        ...(result.pathsDropped ? { pathsDropped: result.pathsDropped } : {}),
      },
      { status: 200 },
    )
  } catch (error) {
    // Never a 5xx to the editor. The publish already succeeded.
    console.error('[screens/revalidate] failed', error)
    return Response.json({ revalidated: [], reason: 'error' }, { status: 200 })
  }
}
