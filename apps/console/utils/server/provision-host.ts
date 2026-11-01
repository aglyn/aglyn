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
  hostStarterChoice,
  readHostStarterChoice,
  siteStyleOf,
  type HostStarterChoice,
  type HostStarterStart,
} from '@aglyn/aglyn/app-utils/site-styles'
import { planSiteStarterTheme } from '@aglyn/aglyn/app-utils/site-starter-theme'
import type { SiteStyleLook } from '@aglyn/aglyn/plugin-manager/plugin-site-style-looks'
import { listServerThemePresets } from '@aglyn/aglyn/plugin-manager/plugin-theme-presets'
import {
  firebaseAdmin,
  registerOrgHost,
} from '@aglyn/tenant-data-admin'
import {
  queueSiteStarterWrites,
  siteStarterWrites,
  type SiteStarterInstall,
} from '@aglyn/tenant-data-admin/server/provision-starter'

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

/** The per-site plugin opt-ins a new site is born with (see the host write in `claimHostForOrg`). */
export const NEW_SITE_ENABLED_PLUGINS: readonly string[] = [ACCOUNTS_PLUGIN_ID]

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
  /**
   * Whether the site is born with the starter — its published Home page and
   * the header and footer layout it renders inside (AGL-3497). `true` when
   * absent. The console passes `false` when the site's creator will be
   * offered the guided AI start (AGL-3594, `guidedStartOffered`): that site
   * is born with no page, and gets the starter only when the person leaves the
   * guided start for it, through `provisionStarterSite`. The theme and the
   * site-wide SEO are written either way — a site with a theme and a
   * description is no less blank, and the guided start keeps both.
   *
   * A starter picked from the marketplace (AGL-4049) is passed as itself:
   * the site is born with that starter's pages, layout and theme instead of
   * the default site, in the same transaction.
   */
  starter?: boolean | SiteStarterInstall
  /**
   * Born in preview (AGL-4086): only the site's team, and Aglyn staff, see
   * it until someone makes it public from Admin → Error pages. The create
   * flow's "Start in preview" choice; on for a site brought in from somewhere
   * else, off for every other start, unless the person chose otherwise.
   */
  preview?: boolean
  /**
   * The style the person chose (AGL-4049): its id, recorded on the site, and
   * its look (`core.site-style-looks`), which a site born with the default
   * starter wears instead of the default theme. `theme: null` when no plugin
   * answers for the style: the site keeps the default theme, and the choice
   * is still recorded.
   */
  style?: SiteStyleInstall
  /**
   * An AI starter the site is created for (AGL-4049 phase 4): the listing
   * whose answers filled in the AI start's questions. The site is born as a
   * guided start's is (`starter: false`) — the start builds its pages — and
   * records the starter in `starterChoice` with `mode: 'ai'`, so leaving the
   * start gives it that starter's own pages (`provisionStarterSite`).
   */
  aiStarter?: SiteStarterInstall['listing']
  /**
   * How the site was started, recorded in `starterChoice`: `starter` for the
   * starter site (the default when the site is born with it), `ai` for the
   * AI start (the default for a site born without it), `import` for a site
   * brought in from somewhere else, `api` for the public API.
   */
  start?: HostStarterStart
}

/** A chosen style as the create writes it: its id, and the look it starts the site in. */
export interface SiteStyleInstall {
  id: string
  theme: SiteStyleLook | null
}

/**
 * The host theme fields a style's look writes on a new site: the built-in
 * picked through the theme library, with the look's brand and fonts as the
 * override over it, planned against the empty host as a starter's built-in
 * theme is (`planSiteStarterTheme`). `null` for a style with no look, which
 * keeps the default theme.
 */
export function siteStyleThemeFields(style: SiteStyleInstall | null | undefined): Record<string, unknown> | null {
  if (!style?.theme) return null
  return planSiteStarterTheme({
    theme: style.theme,
    presets: listServerThemePresets(),
    listing: { listingId: '', version: '', displayName: siteStyleOf(style.id)?.name ?? 'Style' },
    newId: createResourceUid,
  }).host
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
  /** What the site was created with (AGL-4049), as written. Present only when `allowed`. */
  starterChoice?: HostStarterChoice
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

/** The starter's documents: its Home page and first version, its layout and first version. */
function queueStarterPages(
  tx: FirebaseFirestore.Transaction,
  hostRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  home: ReturnType<typeof defaultSiteWrites>,
): void {
  const homeRef = hostRef.collection('screens').doc(home.screenId)
  tx.set(homeRef, home.screen)
  tx.set(homeRef.collection('versions').doc(home.versionId), home.version)
  const layoutRef = hostRef.collection('layouts').doc(home.layoutId)
  tx.set(layoutRef, home.layout)
  tx.set(
    layoutRef.collection('versions').doc(home.layoutVersionId),
    { ...home.layoutVersion, hostId },
  )
}

export interface ProvisionStarterResult {
  /** No site has this id. */
  missing?: boolean
  /** The starter was written now: its published Home page answers `/`. */
  provisioned: boolean
  /** The Home page written, when `provisioned`. */
  screenId?: string
}

/**
 * Gives a site the starter it was born without (AGL-3594): the published
 * Home page at `/`, named `defaultHomeScreenId` as a placeholder the owner's
 * own home page replaces, and the header and footer layout it renders inside.
 * What leaving the guided start for "a blank site" means, and what a guided
 * start that did not work out falls back to.
 *
 * Idempotent and transactional, and it never takes anything from a site:
 * a site that already routes a page, already names a placeholder, or holds
 * any page or layout document at all — a draft the guided start wrote, a
 * page somebody made — is left exactly as it is and answers `provisioned:
 * false`. Two calls racing commit at most one starter, because each reads the
 * same documents the other would write.
 *
 * `starter` is the AI starter the site was created for (AGL-4049 phase 4),
 * resolved by the caller: the site gets THAT starter's own pages, layout and
 * theme (`siteStarterWrites`) in place of the default site, under the same
 * rules — written only to a site with nothing on it, once. A `style` beside
 * it is recorded and lends no look: the starter brings its own.
 */
export async function provisionStarterSite(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  options: { style?: SiteStyleInstall | null; starter?: SiteStarterInstall | null } = {},
): Promise<ProvisionStarterResult> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  // Planned before the transaction: it reads no document, and a retry of the
  // transaction writes the same fields.
  const install = options.starter ? siteStarterWrites(options.starter) : null
  const styled = install ? null : siteStyleThemeFields(options.style)
  return firestore.runTransaction(async (tx): Promise<ProvisionStarterResult> => {
    const [host, screens, layouts] = await Promise.all([
      tx.get(hostRef),
      tx.get(hostRef.collection('screens').limit(1)),
      tx.get(hostRef.collection('layouts').limit(1)),
    ])
    if (!host.exists) return { missing: true, provisioned: false }
    const routing = host.get('screens')
    const routed =
      routing && typeof routing === 'object' && Object.keys(routing as object).length > 0
    if (routed || host.get('defaultHomeScreenId') || !screens.empty || !layouts.empty) {
      return { provisioned: false }
    }
    const displayName = String(host.get('displayName') ?? '') || 'My site'
    // A style chosen for it (AGL-4049) is recorded beside how the site was
    // started; a site created before the record existed starts one here.
    const choice = options.style
      ? {
          starterChoice: {
            ...(readHostStarterChoice(host.get('starterChoice')) ?? hostStarterChoice({ start: 'starter' })),
            kind: options.style.id,
          },
        }
      : {}
    if (install) {
      // The AI starter's own site (AGL-4049 phase 4): every page it routes,
      // its Home named as the placeholder, its theme over the one the site
      // was born with.
      tx.update(hostRef, {
        ...Object.fromEntries(Object.entries(install.routing).map(([id, slug]) => [`screens.${id}`, slug])),
        ...(install.homeScreenId ? { defaultHomeScreenId: install.homeScreenId } : {}),
        starterProvisionedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        ...install.host,
        ...(host.get('seo') ? {} : { seo: defaultSiteSeo(displayName) }),
        ...choice,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      queueSiteStarterWrites(tx, hostRef, hostId, install)
      return { provisioned: true, ...(install.homeScreenId ? { screenId: install.homeScreenId } : {}) }
    }
    const home = defaultSiteWrites(displayName)
    tx.update(hostRef, {
      [`screens.${home.screenId}`]: home.path,
      defaultHomeScreenId: home.screenId,
      // The site has chosen: the guided start is not offered again.
      starterProvisionedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      // A style the person chose (AGL-4049) is the look the starter wears,
      // in place of the theme the site was born with; without one, a site
      // born before its theme or listing existed gets them too, and one that
      // has its own keeps it.
      ...(styled ?? (host.get('theme') ? {} : { theme: home.host.theme })),
      ...(host.get('seo') ? {} : { seo: home.host.seo }),
      ...choice,
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    queueStarterPages(tx, hostRef, hostId, home)
    return { provisioned: true, screenId: home.screenId }
  })
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
  const starter = input.starter !== false
  const hostId = createResourceUid()
  const install =
    input.starter && typeof input.starter === 'object'
      ? siteStarterWrites(input.starter)
      : null
  const preCount = (
    await firestore.collection('hosts').where('orgId', '==', orgId).count().get()
  ).data().count
  const orgRef = firestore.collection('orgs').doc(orgId)
  const hostRef = firestore.collection('hosts').doc(hostId)
  // The default site's documents, or none for a site born from a picked
  // starter, whose own replace them.
  const home = install ? null : defaultSiteWrites(displayName)
  // The chosen style's look (AGL-4049), for a site born with the default
  // starter: a picked starter brings its own theme, and a site born for the
  // AI start gets its look from the start.
  const styled = !install && starter ? siteStyleThemeFields(input.style) : null
  // What the site was created with (AGL-4049), on the host itself.
  const picked = input.starter && typeof input.starter === 'object' ? input.starter : null
  // An AI starter is recorded the same way, the site born without its pages.
  const ai = !picked && input.aiStarter ? input.aiStarter : null
  const starterChoice: HostStarterChoice = hostStarterChoice({
    listingId: picked ? picked.listing.listingId : (ai?.listingId ?? null),
    version: picked ? String(picked.listing.version) : ai ? String(ai.version) : null,
    kind:
      input.style?.id ??
      (picked ? (picked.listing.kind ?? picked.payload.facets?.kind ?? null) : (ai?.kind ?? null)),
    mode: picked ? picked.payload.mode : ai ? 'ai' : 'base',
    start: input.start ?? (starter ? 'starter' : 'ai'),
  })
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
      // Born in preview (AGL-4086) only when asked: a site is public by
      // default, and the field is absent rather than false on every other.
      ...(input.preview === true ? { preview: true } : {}),
      // Born routed (AGL-3408): the home page written below answers `/` from
      // the site's first request, where an empty map answered with the 404.
      // A site born for the guided start (AGL-3594) has no page yet, and the
      // tenant answers its `/` with a holding page until it does.
      // A picked starter routes every page it publishes (AGL-4049).
      screens: install
        ? install.routing
        : starter
          ? { [home.screenId]: home.path }
          : {},
      // Which screen is the platform's placeholder rather than the owner's
      // page. A starter applied later may take `/` from it, and the
      // `first_publish` dimension does not count it — never any other screen.
      // Cleared the moment a starter takes the root, or the owner publishes
      // this page themselves (AGL-3478).
      // A picked starter's Home is the placeholder in the same sense.
      ...(install
        ? install.homeScreenId
          ? { defaultHomeScreenId: install.homeScreenId }
          : {}
        : starter
          ? { defaultHomeScreenId: home.screenId }
          : {}),
      // Born themed and described (AGL-3497): the site's own theme, so the
      // theme library files it as "Site theme", and the site-wide title,
      // description and sharing image a search result or a shared link shows.
      // A picked starter's theme is planned against this empty host
      // (`planSiteStarterTheme`): the built-in or full theme it names, its
      // brand and fonts as the override, and the library entry it files.
      // A chosen style's look is the same plan for a built-in theme, over the
      // default starter's pages (AGL-4049).
      ...(install ? install.host : (styled ?? { theme: home.host.theme })),
      seo: install ? defaultSiteSeo(displayName) : home.host.seo,
      // What it was created with (AGL-4049): server-owned, in this same write.
      starterChoice,
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
      enabledPlugins: [...NEW_SITE_ENABLED_PLUGINS],
      // Stored `false`, never left out: the staff Sites list filters
      // Suspended by equality on it, and a query cannot find a document by a
      // field it lacks. The console's `suspended-flag.ts` names its other writers.
      suspended: false,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    if (install) queueSiteStarterWrites(tx, hostRef, hostId, install)
    else if (starter) queueStarterPages(tx, hostRef, hostId, home)
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
  // The site EXISTS from here on, so a failure past this line must say so:
  // see `registerClaimedHost`.
  await registerClaimedHost(orgId, hostId, subdomain)

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

  return { allowed: true, hostId, starterChoice }
}

/**
 * A create whose claim committed and whose registration did not (AGL-3734).
 *
 * The claim transaction writes the host doc and takes the subdomain. The
 * registration after it (`registerOrgHost`: org directory, `hostIndex` mirror,
 * memberRoles projection) is separate writes, so it can fail on its own. When
 * it did on 2026-10-08 (an emoji name's lone-surrogate search token, AGL-3689),
 * the caller got a bare 500 for a site that existed. Their retry hit 409 on
 * their OWN subdomain, and the next name hit the Free site limit, which that
 * half-made site was already using. This error carries the `hostId` so the
 * route can report which site and tell the caller that trying again finishes
 * it (see {@link resumeUnfinishedCreate}).
 */
export class HostRegistrationIncompleteError extends Error {
  readonly hostId: string
  override readonly cause: unknown

  constructor(hostId: string, cause: unknown) {
    super(
      `site ${hostId} was claimed but not registered: ` +
        (cause instanceof Error ? cause.message : String(cause)),
    )
    this.name = 'HostRegistrationIncompleteError'
    this.hostId = hostId
    this.cause = cause
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.name}: ${this.message}\n${cause.stack}`
    }
  }
}

/**
 * Firestore failures that a second attempt can succeed past: contention
 * (`ABORTED`, which the admin SDK has already retried inside a transaction),
 * an unreachable backend, a deadline, or a quota burst. The admin SDK reports
 * gRPC codes as numbers. The string forms are kept for anything that
 * normalises them.
 */
const TRANSIENT_FIRESTORE_CODES = new Set<unknown>([
  4, // DEADLINE_EXCEEDED
  8, // RESOURCE_EXHAUSTED
  10, // ABORTED
  14, // UNAVAILABLE
  'deadline-exceeded',
  'resource-exhausted',
  'aborted',
  'unavailable',
])

export function isTransientFirestoreError(error: unknown): boolean {
  try {
    return TRANSIENT_FIRESTORE_CODES.has((error as { code?: unknown } | null)?.code)
  } catch {
    return false
  }
}

/**
 * `registerOrgHost` for a site whose claim has committed. Retried once on a
 * transient failure; every write in it is idempotent (merge sets and
 * projection syncs). Anything still failing becomes a
 * {@link HostRegistrationIncompleteError}, so it is never mistaken for a
 * create that made nothing.
 */
async function registerClaimedHost(
  orgId: string,
  hostId: string,
  subdomain: string,
): Promise<void> {
  try {
    await registerOrgHost(orgId, hostId, subdomain)
    return
  } catch (first) {
    if (!isTransientFirestoreError(first)) {
      throw new HostRegistrationIncompleteError(hostId, first)
    }
  }
  try {
    await registerOrgHost(orgId, hostId, subdomain)
  } catch (second) {
    throw new HostRegistrationIncompleteError(hostId, second)
  }
}

/** How long a half-made site stays resumable by a retry of its create. */
export const UNFINISHED_CREATE_WINDOW_MS = 60 * 60 * 1000

/**
 * Finish a create that claimed its subdomain and never registered (AGL-3734).
 *
 * Called by `POST /api/hosts/create` when the subdomain is taken. It answers
 * with the site only when ALL of these hold, and otherwise with `null`, which
 * leaves the ordinary 409:
 *
 * - the site holding the subdomain belongs to the caller's org, which the
 *   route has already proven the caller may create sites in;
 * - it has no `hostIndex` row, which `registerOrgHost` writes and every
 *   finished site has;
 * - it was created within {@link UNFINISHED_CREATE_WINDOW_MS}, so an old site
 *   is never handed back as though this request had made it.
 *
 * The registration is the same idempotent `registerOrgHost` the create would
 * have run, so a retry finishes exactly the work that was left undone.
 */
export async function resumeUnfinishedCreate(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  subdomain: string,
  now: number = Date.now(),
): Promise<{
  hostId: string
  displayName: string
  guidedStart: boolean
  starterChoice: HostStarterChoice | null
} | null> {
  const taken = await firestore
    .collection('hosts')
    .where('subdomain', '==', subdomain)
    .limit(1)
    .get()
  const host = taken.docs[0]
  if (!host || host.get('orgId') !== orgId) return null
  const createdAt = host.get('createdAt') as
    | { toMillis?: () => number }
    | undefined
  const createdMs = createdAt?.toMillis?.()
  if (typeof createdMs !== 'number' || now - createdMs > UNFINISHED_CREATE_WINDOW_MS) {
    return null
  }
  const index = await firestore.collection('hostIndex').doc(host.id).get()
  if (index.exists) return null
  await registerClaimedHost(orgId, host.id, subdomain)
  const screens = host.get('screens') as Record<string, unknown> | undefined
  return {
    hostId: host.id,
    displayName: String(host.get('displayName') ?? ''),
    // Born without the starter means it was born for the guided start
    // (AGL-3594): an empty route map is exactly that.
    guidedStart: !screens || Object.keys(screens).length === 0,
    // What the claim recorded it was created with (AGL-4049).
    starterChoice: readHostStarterChoice(host.get('starterChoice')),
  }
}
