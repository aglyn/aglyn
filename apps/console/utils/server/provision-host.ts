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
  ACCOUNTS_PLUGIN_ID,
  checkQuota,
  createResourceUid,
  suggestSubdomains,
} from '@aglyn/aglyn/server'
import { artifactCreateListKeys } from '@aglyn/aglyn/app-utils/artifact-list-keys'
import {
  buildDefaultHomeScreen,
  buildDefaultSiteLayout,
  DEFAULT_SITE_THEME,
  defaultSiteSeo,
} from '@aglyn/aglyn/app-utils/default-site'
import { encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import {
  firebaseAdmin,
  registerOrgHost,
} from '@aglyn/tenant-data-admin'

/**
 * The two steps that actually provision a site, shared by the console's
 * `POST /api/hosts/create` and `POST /v1/sites` (AGL-2465).
 *
 * Extracted rather than copied for the reason AGL-2463 gave when `createMedia`
 * reused the console ingress helpers: a second implementation of a create-time
 * quota is a second place for the quota to be wrong, and this particular quota
 * has already been got wrong once (AGL-2063 — a `count()` followed by an
 * unconditional `set()` on a fresh id, which N concurrent POSTs all pass).
 *
 * Deliberately TWO functions rather than one `provisionHost`, so the console
 * route keeps its exact refusal ORDER. It interleaves the lockdown verdict and
 * the rate limiter between the uniqueness check and the quota claim, and that
 * order is load-bearing: 401/403/423 win, so a refused request never burns a
 * rate-limit token. Folding both steps into one call would move the 409 below
 * the limiter and quietly change which refusals cost a token.
 */

export interface SubdomainConflict {
  /** Alternatives that are themselves free — `name-2`, `name-<year>`, … */
  suggestions: string[]
}

/**
 * Is this subdomain already taken, and if so what is free instead?
 *
 * `*.aglyn.app` is ONE global namespace shared by every customer, so this is a
 * platform-wide uniqueness question and cannot be scoped to the org.
 *
 * ⚠️ This read is OUTSIDE any transaction and therefore ADVISORY. It exists to
 * produce the friendly `suggestions` payload and to refuse early; it cannot
 * decide uniqueness, because two callers can both pass it while the name is
 * genuinely free and then both write. The binding check is the re-read inside
 * `claimHostForOrg`'s transaction (AGL-2465). Do not "simplify" by treating
 * this result as authoritative.
 */
export async function findSubdomainConflict(
  firestore: FirebaseFirestore.Firestore,
  subdomain: string,
): Promise<SubdomainConflict | null> {
  const taken = await firestore
    .collection('hosts')
    .where('subdomain', '==', subdomain)
    .limit(1)
    .get()
  if (taken.empty) return null
  const suggestions: string[] = []
  for (const candidate of suggestSubdomains(subdomain)) {
    const candidateTaken = await firestore
      .collection('hosts')
      .where('subdomain', '==', candidate)
      .limit(1)
      .get()
    if (candidateTaken.empty) suggestions.push(candidate)
  }
  return { suggestions }
}

export interface ClaimHostInput {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  displayName: string
  subdomain: string
  /**
   * The org document, if the caller has already read it. Only used as the
   * fallback for the quota check; the transaction re-reads the org itself,
   * because a stale copy is exactly what makes a create-time quota racy.
   */
  org?: FirebaseFirestore.DocumentData | undefined
}

/**
 * Deliberately one interface with optional fields rather than a discriminated
 * union on `allowed`. `strictNullChecks` is off repo-wide, and a `true | false`
 * discriminant does not narrow reliably for consumers in other files under
 * that setting — the union shape compiled here and failed at the call site.
 * `hostId` is set exactly when `allowed`, `limit` exactly when not.
 */
export interface ClaimHostResult {
  allowed: boolean
  /** The id of the site created. Present only when `allowed`. */
  hostId?: string
  /** The `hostLimit` that refused it. Present only when not `allowed`. */
  limit?: number
  /**
   * The subdomain was taken by a concurrent writer between the caller's
   * advisory pre-check and this transaction's commit (AGL-2465). Present only
   * when not `allowed`, and mutually exclusive with `limit` — callers branch
   * on it to answer 409 rather than the quota's 403.
   *
   * Checked with `result.conflict === true` at the call sites rather than for
   * truthiness: `strictNullChecks` is off repo-wide, so an absent field and an
   * explicit `false` are equally falsy and a quota refusal must not be able to
   * drift into the collision branch by accident.
   */
  conflict?: boolean
}

/**
 * The site a new site is created as (AGL-3497, after AGL-3408): its home
 * page — the screen and its first version, plus the path its routing entry
 * claims — the shared header and footer layout that page renders inside, and
 * the theme and SEO the host document starts with.
 *
 * Written inside the create transaction rather than after it, so no site ever
 * exists without them — a follow-up write that failed would hand the customer
 * the same 404 AGL-3408 removed, or a home page with no header, under a
 * success toast.
 *
 * The same shape every other create door writes: list keys (`deletedAt: null`
 * among them, AGL-3321) from `artifactCreateListKeys`, and nodes msgpack at
 * rest as `/api/hosts/versions` stores them. `slug` and `publishedAt` are what
 * `publishScreenRoute` stamps, so the console lists the page as Published
 * rather than as a draft that happens to be served. A layout has no publish
 * stamp: its `versionId` IS the published pointer.
 */
export function defaultSiteWrites(siteName: string): {
  screenId: string
  versionId: string
  path: string
  screen: Record<string, unknown>
  version: Record<string, unknown>
  layoutId: string
  layoutVersionId: string
  layout: Record<string, unknown>
  layoutVersion: Record<string, unknown>
  host: { theme: unknown; seo: Record<string, unknown> }
} {
  const now = () => firebaseAdmin.firestore.FieldValue.serverTimestamp()
  const definition = buildDefaultHomeScreen(siteName)
  const screenId = createResourceUid()
  const versionId = createResourceUid()
  const layoutId = createResourceUid()
  const layoutVersionId = createResourceUid()
  const packed = encodeStoredNodes(definition.nodes)
  const fields = {
    displayName: definition.displayName,
    slug: definition.slug,
    versionId,
  }
  const layoutDefinition = buildDefaultSiteLayout(screenId)
  const layoutPacked = encodeStoredNodes(layoutDefinition.nodes)
  const layoutFields = {
    displayName: layoutDefinition.displayName,
    versionId: layoutVersionId,
  }
  return {
    screenId,
    versionId,
    path: definition.slug,
    screen: {
      ...fields,
      ...artifactCreateListKeys('screens', fields),
      layoutId,
      ...(definition.seo ? { seo: definition.seo } : {}),
      publishedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    },
    version: {
      screenId,
      displayName: 'Initial version',
      nodes: packed ? Buffer.from(packed) : definition.nodes,
      createdAt: now(),
      updatedAt: now(),
    },
    layoutId,
    layoutVersionId,
    layout: {
      ...layoutFields,
      ...artifactCreateListKeys('layouts', layoutFields),
      description: layoutDefinition.description,
      createdAt: now(),
      updatedAt: now(),
    },
    layoutVersion: {
      layoutId,
      displayName: 'Initial version',
      nodes: layoutPacked ? Buffer.from(layoutPacked) : layoutDefinition.nodes,
      createdAt: now(),
      updatedAt: now(),
    },
    host: { theme: DEFAULT_SITE_THEME, seo: defaultSiteSeo(siteName) },
  }
}

/**
 * Counts, claims and creates, in one transaction (AGL-2063).
 *
 * The count is the LARGER of the `orgs/{id}.hosts` directory map and a
 * pre-read aggregation, and each is here for a different reason:
 *
 * - the aggregation is authoritative for HISTORY — an org whose sites predate
 *   the directory map would otherwise read as zero and get a free extra site;
 * - the map is authoritative for CONCURRENCY, because it is written inside
 *   this same transaction, so the loser of a race re-reads it on retry, sees
 *   the winner's id and is refused. The aggregation, read before the
 *   transaction opened, can never do that.
 *
 * Returns the `hostId` it minted. Callers that need replay-safety record that
 * id in their idempotency claim, so a retry replays the original id rather
 * than provisioning a second site (AGL-2465).
 */
export async function claimHostForOrg(
  input: ClaimHostInput,
): Promise<ClaimHostResult> {
  const { firestore, orgId, displayName, subdomain, org } = input
  const hostId = createResourceUid()
  const preCount = (
    await firestore.collection('hosts').where('orgId', '==', orgId).count().get()
  ).data().count
  const orgRef = firestore.collection('orgs').doc(orgId)
  const hostRef = firestore.collection('hosts').doc(hostId)
  const home = defaultSiteWrites(displayName)
  // Annotated rather than inferred. The body has three exits and an inferred
  // union of object literals does not narrow reliably with `strictNullChecks`
  // off — the same reason `ClaimHostResult` is one interface with optional
  // fields rather than a discriminated union.
  const claim: ClaimHostResult = await firestore.runTransaction(async (
    tx,
  ): Promise<ClaimHostResult> => {
    // Uniqueness, re-read INSIDE the transaction (AGL-2465, the AGL-1848
    // shape). The caller's `findSubdomainConflict` runs outside any
    // transaction, so two concurrent creates both passed it and both wrote a
    // host on the same subdomain — and since every resolution path is
    // `where('subdomain','==',…).limit(1)`, which of the two answers the
    // address is then undefined. `hosts/rename` already claims uniqueness this
    // way; this is that shape ported to create, and it is what actually
    // decides the question. An idempotency key cannot substitute: it dedupes
    // one attempt retried, not two different attempts racing.
    //
    // Reads must precede writes in a Firestore transaction, so this sits above
    // the org read and the sets below.
    //
    // `limit(2)` + an id comparison mirrors rename: a create's `hostId` is
    // freshly minted so no row can carry it, but matching rename's predicate
    // keeps the two uniqueness claims one shape rather than two.
    const taken = await tx.get(
      firestore.collection('hosts').where('subdomain', '==', subdomain).limit(2),
    )
    if (taken.docs.some((host) => host.id !== hostId)) {
      return { allowed: false, conflict: true }
    }
    const fresh = await tx.get(orgRef)
    const directory = fresh.get('hosts')
    const mapped =
      directory && typeof directory === 'object'
        ? Object.values(directory as Record<string, unknown>).filter(Boolean)
            .length
        : 0
    const quota = checkQuota(
      (fresh.data() ?? org) as never,
      'hostLimit',
      Math.max(preCount, mapped),
    )
    if (!quota.allowed) return { allowed: false, limit: quota.limit }
    tx.set(hostRef, {
      displayName,
      subdomain,
      orgId,
      // Born routed (AGL-3408): the home page written below answers `/` from
      // the site's first request, where an empty map answered with the 404.
      screens: { [home.screenId]: home.path },
      // Which screen is the platform's placeholder rather than the owner's
      // page. A starter applied later may take `/` from it, and the
      // `first_publish` dimension does not count it — never any other screen.
      // Cleared the moment a starter takes the root, or the owner publishes
      // this page themselves (AGL-3478).
      defaultHomeScreenId: home.screenId,
      // Born themed and described (AGL-3497): the site's own theme, so the
      // theme library files it as "Site theme", and the site-wide title,
      // description and sharing image a search result or a shared link shows.
      theme: home.host.theme,
      seo: home.host.seo,
      /*
       * A new site starts with User Accounts ON. The catalog still marks
       * `accounts` default-off per site, so a host doc with no opt-in list —
       * every site created before this line — keeps serving no member pages;
       * what changes is only what a site is BORN with, written as the same
       * opt-in its Admin → Plugins switch writes, so switching it off there
       * is the ordinary edit.
       *
       * Named, not `DEFAULT_OFF_PER_SITE_PLUGIN_IDS`: a capability later
       * marked default-off is marked so because it must not be on until
       * somebody asks, and spreading the set here would ask on their behalf.
       */
      enabledPlugins: [ACCOUNTS_PLUGIN_ID],
      // Stored `false`, never left out: the staff Sites list filters
      // Suspended by equality on it, and a query cannot find a document by a
      // field it lacks. The console's `suspended-flag.ts` names its other writers.
      suspended: false,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    const homeRef = hostRef.collection('screens').doc(home.screenId)
    tx.set(homeRef, home.screen)
    tx.set(homeRef.collection('versions').doc(home.versionId), home.version)
    const layoutRef = hostRef.collection('layouts').doc(home.layoutId)
    tx.set(layoutRef, home.layout)
    tx.set(
      layoutRef.collection('versions').doc(home.layoutVersionId),
      { ...home.layoutVersion, hostId },
    )
    // The claim itself. `set(…, { merge: true })` deep-merges the map, so this
    // adds one key without disturbing the org's other fields — and it is what
    // makes a concurrent create see this site on its retry. `registerOrgHost`
    // writes the same key again, idempotently.
    tx.set(
      orgRef,
      {
        hosts: { [hostId]: true },
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return { allowed: true, limit: quota.limit }
  })
  if (!claim.allowed) {
    // Distinct refusals, deliberately not folded: a collision is a 409 the
    // caller fixes by choosing another name, a quota is a 403 they fix by
    // upgrading. `conflict` carries no `limit` and the quota branch carries no
    // `conflict`, so neither can be mistaken for the other.
    if (claim.conflict === true) return { allowed: false, conflict: true }
    return { allowed: false, limit: claim.limit }
  }
  // Org directory + hostIndex mirror + memberRoles projection (AGL-233).
  await registerOrgHost(orgId, hostId, subdomain)

  /*
   * NO SENDING DOMAIN IS CLAIMED HERE, AND THE SITE CAN SEND ANYWAY.
   *
   * A new site's transactional mail leaves on the shared pool from its first
   * request — that is the floor `resolveSendingIdentity` guarantees, and it
   * needs no provisioning, no DNS and no vendor call. So creation has nothing
   * to wait for and nothing to claim.
   *
   * A DEDICATED subdomain used to be claimed right here, which made the
   * platform's domain count grow with signups filtered by plan rather than
   * with anybody's decision: a slot in the provider's account-wide allowance,
   * three records in our own zone and a permanent place in the re-verification
   * sweep, spent on every paying site whether or not it wanted an
   * Aglyn-branded sending name. It is now requested from the sending domains
   * card, by somebody who chose it.
   */

  return { allowed: true, hostId }
}
