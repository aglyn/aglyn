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

// The leaf module, not the server barrel: specs stage that barrel as a
// closed world, and the list keys every create stamps (AGL-3321) are
// nothing they have reason to name.
import { artifactCreateListKeys } from '@aglyn/aglyn/app-utils/artifact-list-keys'
import { PLATFORM_BRAND_NAME, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  AUTHORS_MAX_PER_HOST,
  checkEntitlement,
  checkQuota,
  COLLECTIONS_MAX_PER_HOST,
  decodeStoredNodes,
  encodeStoredNodes,
  hostScopeToken,
  legacyCollectionKind,
  newResourceScopeFields,
  NON_PAGE_SCREEN_MAX_PER_HOST,
  resolveOrgEntitlements,
  rewriteBindingTokensDeep,
  screenClaimsToBeAPage,
} from '@aglyn/aglyn/server'
import {
  listDeclaredSiteBundleSections,
  resolveSiteBundleSections,
  type ResolvedSiteBundleSection,
  type SiteBundleReportRow,
} from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import {
  EXPORT_COLLECTION_LIMITS,
  EXPORTABLE_HOST_FIELDS,
  IMPORTABLE_FIELDS,
  PLUGIN_SITE_EXPORT_COLLECTIONS,
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
  SITE_SETTINGS_FIELDS,
  SITE_THEME_FIELDS,
} from '../../_lib/site-export'
import {
  isSitePackageFile,
  planSitePackageImport,
  readSitePackage,
  resolveSitePackageImport,
  SitePackageDecisionError,
  siteBundleItems,
  siteWritesToBundle,
  type ResolvedSitePackageImport,
  type SitePackageItem,
  type SitePackageKind,
  type SitePackageWrite,
} from '@aglyn/aglyn/data-transfer/site-package'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  THEME_LIBRARY_COLLECTION,
  THEME_LIBRARY_MAX_CUSTOM,
} from '@aglyn/aglyn/app-utils/theme-library'
import { getTenantEmail, TENANT_EMAIL_COLLECTION } from '@aglyn/shared-util-email/tenant-email-catalog'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { isSitePath } from '../../_lib/external-destination'
import {
  consoleSitePackageKinds,
  readableNodes,
  readSiteAsPackage,
  sectionPackageHooks,
  siteItemProjection,
  sitePackageContract,
  sitePackageOf,
  siteVersionHash,
} from '../../_lib/site-package-read'
import {
  PACKAGE_IMPORT_SNAPSHOTS,
  PACKAGE_IMPORT_WRITTEN_PATHS,
  PACKAGE_IMPORTS_COLLECTION,
  PACKAGE_UNDO_WINDOW_MS,
  packageImportRef,
  packageLedgerExpiry,
  packageImportUndoable,
  readLedgerPieces,
  writeLedgerPieces,
  type PackageImportRecord,
  type PackageImportSnapshot,
} from '../../_lib/site-package-ledger'
import {
  ENTRY_PUBLISH_SORT_FIELD,
  entryPublishSortStamp,
} from '@aglyn/aglyn/app-utils/collection-entry-date'
import {
  contentAuthorQueryFields,
  entryTitleSearchFields,
} from '@aglyn/aglyn/app-utils/content-query-fields'
import { activitySearchTokens } from '@aglyn/aglyn/app-utils/activity-search'
import { withMatchableConditions } from '@aglyn/aglyn/app-utils/reusable-prop-values'
import { decodeBundleTimestamps, encodeBundleTimestamps } from '../../_lib/bundle-timestamps'
import {
  billableScreenIds,
  type BillableScreenSource,
  nonPageScreenIds,
} from '../resources/count-billable-screens'
import { revalidateEntireHost } from '../../../../utils/server/tenant-revalidate'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The document to store, built from a bundle item by ALLOW-list (AGL-1382).
 *
 * This was a deny-list: six structural keys destructured away and everything
 * else stored, with `merge: false`, from a file the user uploaded. The route
 * already did the right thing one block down — host settings are copied
 * through `EXPORTABLE_HOST_FIELDS` — so a single file held both disciplines
 * and the subcollection half was the one that failed open.
 *
 * The permitted sets live in `_lib/site-export` beside the rest of the bundle
 * contract, so a field cannot be exportable but not importable without the
 * round-trip spec noticing.
 *
 * An unknown collection THROWS rather than defaulting to an empty list: the
 * fail-closed default would be silent total data loss for that collection,
 * and every caller here passes a literal.
 */
function cleanDoc(
  collection: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const permitted = IMPORTABLE_FIELDS[collection]
  if (!permitted) {
    throw new Error(`No import allow-list declared for '${collection}'`)
  }
  const allowed = new Set(permitted)
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    // Only `undefined` is absence — Firestore rejects it outright. A literal
    // `null` is a real stored state (a workflow's cleared `trigger`), so it
    // has to survive the filter.
    if (allowed.has(key) && value !== undefined) clean[key] = value
  }
  // A component's or layout version's declared properties (AGL-2893): a
  // condition rule whose pattern no page can match is not restored.
  if (clean['props'] !== undefined) {
    clean['props'] = withMatchableConditions(clean['props'])
  }
  // A restore is a create (`merge: false` replaces the document), so a
  // screen, layout or component lands with the keys its list queries by
  // (AGL-835, AGL-3321) — re-derived, because a bundle may predate them or
  // carry keys for a name it no longer holds. Nothing for other collections.
  Object.assign(clean, artifactCreateListKeys(collection, clean))
  clean['updatedAt'] = firebaseAdmin.firestore.FieldValue.serverTimestamp()
  /*
   * `createdAt` TOO, and this one closes a trap rather than tidying a pair
   * (AGL-3196).
   *
   * No allow-list carries `createdAt`, and the write below is `merge: false`,
   * so every document a bundle restored arrived with an `updatedAt` and no
   * `createdAt` at all. For a version that is not cosmetic: five version
   * histories in the console read `limit(N)` with NO `orderBy` and sort in the
   * browser, and `table-footer-consistency` records why — `orderBy('createdAt')`
   * would DROP a restored version rather than mis-order it, because Firestore
   * omits a document that is missing the field it is ordering by. So the
   * cheapest correct read was blocked by a field nobody was writing.
   *
   * The restore time is the honest value: this copy of the document came into
   * existence in this workspace now. It cannot clobber an older one, because
   * `merge: false` is already replacing the whole document.
   */
  clean['createdAt'] = firebaseAdmin.firestore.FieldValue.serverTimestamp()
  return clean
}

/**
 * Refuse a bundle that would put the host over `screensPerHost` — the third
 * enforcement point for that cap, and the only one that is a BULK create
 * (AGL-1398).
 *
 * `/api/hosts/resources` gates the cap on the way to creating ONE screen, and
 * AGL-1390 added `/api/hosts/collections` for the writes that free a slot. This
 * route creates screens too — `importVersioned('screens')`, by id, additive —
 * and never called `checkQuota` at all. Not a laundering loop needing a
 * reversal and not a mis-count: import a bundle and the screens exist.
 * `EXPORT_COLLECTION_LIMITS.screens` is 200 against a Pro cap of 100, so the
 * bundle format alone holds twice the plan of the cheapest tier that can use
 * the feature.
 *
 * ## The whole bundle, or none of it
 *
 * A bulk create faces a choice a single create does not, and it is the one this
 * had to make deliberately: refuse the bundle up front, or import up to the cap
 * and report what was dropped. It refuses up front, before the first write.
 *
 * The route commits in chunks of 400, so it is NOT atomic once it starts — and
 * the host patch, which carries the bundle's ROUTING MAP, is the first thing
 * batched. An import that stopped at the 101st screen would leave a site whose
 * restored map advertises 200 pages of which 100 exist, with layouts,
 * collections and entries referencing the missing half. For a RESTORE feature
 * that is worse than either extreme, because the site was working before the
 * import. Which screens survived would be bundle order, and nothing would say
 * so. Refusing is recoverable in one click — upgrade, or restore elsewhere; a
 * half-written site is not.
 *
 * So the only place the decision can be made atomically is before the first
 * write, and getting it there costs two projected reads.
 *
 * ## Atomic against a CONCURRENT import, too (AGL-2370)
 *
 * "Before the first write" is not the same sentence as "serialized against
 * another request", and this route had only the first. The gate counted with a
 * plain `.get()`, awaited a second gate's reads, and only then committed — so
 * two imports of `k` screens each into a host holding `prior` both computed
 * `next = prior + k <= limit`, both passed, and both landed at `prior + 2k`.
 * AGL-2231 and AGL-2369 are the same defect at the two single-screen doors.
 *
 * AGL-2370 filed this as unfixable by transaction, and that premise does not
 * survive arithmetic. It rests on the note above — "the route commits in
 * chunks of 400, so it is NOT atomic once it starts" — which is true of the
 * WHOLE bundle and irrelevant to the cap. `screensPerHost` is a statement
 * about ONE collection, and the leg that writes it is bounded by the bundle
 * format: `EXPORT_COLLECTION_LIMITS.screens` is 200, each screen carries at
 * most one version, and the host patch is one document — 401 writes against
 * Firestore's 500-write transaction ceiling, asserted in
 * `import-screen-cap-is-atomic.spec.ts` so raising the export limit fails the
 * build rather than the commit.
 *
 * So the SCREENS leg (host patch, screen documents, their versions) moves into
 * one transaction that re-runs this check through `tx.get`, and the rest of the
 * bundle keeps its chunked batches. `tx.get` on the projected query takes a
 * pessimistic lock on every screen the count read, so the loser of a race
 * retries, re-reads the higher count and is refused. Nothing about the other
 * collections needed to become atomic, because none of them is what the cap
 * counts.
 *
 * Two properties of the existing order made that a rearrangement rather than a
 * rewrite: screens are already written FIRST, and the host patch — which
 * carries the routing map the count is evaluated against — is already batched
 * beside them. The partial-failure surface is therefore unchanged; what changes
 * is that the first commit is now conditional on the read it was authorized by.
 *
 * The refusal is returned as DATA and rendered by the caller. A transaction
 * body can run several times, and allocating a `Response` per attempt reads as
 * if the transaction were a place effects happen.
 *
 * ## The post state, not the verb (AGL-1390)
 *
 * What is refused is the RAISE, never the state of being over. An org can be
 * over its cap by legitimate means — a downgrade, an import that predates this
 * — and a backup is the one file nobody may be locked out of on the day they
 * need it. A bundle is keyed by id, so restoring a site into ITSELF replaces
 * rather than adds and leaves the count exactly where it was: that restore is
 * allowed at the cap and above it. A check written as
 * `existing + bundle.length > limit` would have refused every restore of a site
 * anywhere near full, which is every restore that matters.
 *
 * The post state is modelled through `cleanDoc` rather than by reading the
 * bundle's fields directly, so it cannot drift from the allow-list that decides
 * what is actually stored. Two consequences of `merge: false` then fall out for
 * free: an imported screen holds only what the bundle gave it, and because
 * `deletedAt` is not importable, a screen the bundle carries comes BACK from a
 * soft delete and counts again.
 *
 * ## Which makes this the issue's option 3, without trusting the file
 *
 * "Refuse a fresh copy into a different host, allow a restore into the source
 * host" is what the arithmetic already does, because the ids ARE the
 * provenance. The bundle also carries a `sourceHostId`, and it is precisely the
 * wrong thing to gate on: an unsigned string in a file the metered party
 * uploads, so `sourceHostId === hostId` is "a gated field is an entitlement
 * input" for the third time (AGL-1354, AGL-1383) — one edit and the cap is
 * gone. The ids cannot be forged in the direction that pays. Taking the allow
 * path requires the bundle's screens to be on the host already, which is to say
 * bought already; renaming them to ids the target holds overwrites those screens
 * instead of adding any.
 *
 * The restore that is allowed OVER the cap is not unobserved either: AGL-1390
 * shipped the reconciliation half — `screensOverCapHostIds` on the monthly
 * rollup and a `screens` check in the usage-alerts cron — so an over-cap host
 * is reported rather than silently tolerated. Detection is the companion to
 * this refusal, which is why the refusal only has to cover the case where
 * something is being provisioned rather than given back.
 *
 * ## And the flat cap the plan does not price (AGL-1439)
 *
 * A bundle may carry `kind: 'template'` — legitimately, because a site with a
 * blog has entry templates and dropping the field would restore a site's emails
 * as live billable pages (AGL-1383). Since AGL-1400 that value also excludes a
 * screen from `billableScreenIds`, so the check above sees nothing when a
 * hand-edited bundle declares it on all 200 of its screens. The second leg below
 * counts those documents against `NON_PAGE_SCREEN_MAX_PER_HOST` — the same flat
 * platform cap `/api/hosts/resources` applies to the create path (AGL-1399) —
 * and it is a COUNT, never a refusal of the kind: refusing `kind: 'template'`
 * would break the restore that matters, which is the failure AGL-1382 exists to
 * prevent.
 *
 * Both legs read the same projected snapshot, and the second is skipped
 * entirely when the bundle carries no non-page screen, because then it cannot
 * raise anything.
 *
 * Nothing is re-priced. `billableScreenIds` decides which screens spend the
 * allowance, exactly as it does at the other two enforcement points — AGL-1173,
 * AGL-1383, AGL-1387 and AGL-1390 each declined to change what counts, and this
 * is not the issue that gets to either. The flat cap has no `OrgEntitlements`
 * key and appears in no price list.
 */
async function screenCapRefusal(options: {
  hostRef: FirebaseFirestore.DocumentReference
  /** The host's current `screens` routing map. */
  routingMap: unknown
  /** The map the bundle's host settings carry, merged over it below. */
  bundleRoutingMap: unknown
  org: unknown
  bundleScreens: Array<Record<string, any>>
  /**
   * How to execute the projected screens scan (AGL-2370).
   *
   * `readScreenSources` takes the identical parameter for the identical
   * reason: the call site passes `(query) => tx.get(query)` so the count is
   * the TRANSACTION's read and the pessimistic lock it takes covers every
   * screen the cap is counted from. Defaulting to a plain `.get()` is what
   * the un-transacted callers (there are none left in this file) would use.
   */
  read?: (query: {
    get(): Promise<{ docs: Array<{ id: string; get(field: string): unknown }> }>
  }) => Promise<{ docs: Array<{ id: string; get(field: string): unknown }> }>
}): Promise<{ status: 403; error: string } | null> {
  const { hostRef, routingMap, bundleRoutingMap, org } = options
  const limit = resolveOrgEntitlements(org as any).screensPerHost

  // The bundle's screens as they would be STORED, modelled through `cleanDoc`
  // so the check cannot drift from the allow-list that decides what lands.
  const bundleScreens: Array<BillableScreenSource> = []
  for (const item of options.bundleScreens) {
    if (!item?.$id) continue
    const stored = cleanDoc('screens', item)
    bundleScreens.push({
      id: String(item.$id),
      kind: stored['kind'],
      deletedAt: stored['deletedAt'],
    })
  }
  // Whether the bundle can raise the FLAT non-page cap at all (AGL-1439). A
  // bundle carrying only pages cannot: an imported page overwrites a template
  // rather than adding one, and the routing-map union only ever moves screens
  // the other way, into the billable set.
  const bundleCarriesNonPage = bundleScreens.some(
    (screen) =>
      !screenClaimsToBeAPage({
        kind: screen.kind as string,
        deletedAt: screen.deletedAt,
      }),
  )
  // Unlimited plans skip the read outright — most orgs entitled to
  // `siteExport` are on one, and a cap that cannot be exceeded needs no count.
  // The flat cap does not vary by plan, so an unlimited org still pays the read
  // when the bundle carries something that cap counts.
  if (!Number.isFinite(limit) && !bundleCarriesNonPage) return null

  // ONE read since AGL-1400, and still one now that two caps read it: a screen
  // says on its own document whether it is a page, so the bundle's collections
  // no longer decide anything here either — an entry template arrives already
  // marked `kind: 'template'`, which is what the exporter wrote and what the
  // live site reads.
  const read = options.read ?? ((query) => query.get())
  const screensSnapshot = await read(
    hostRef.collection('screens').select('kind', 'deletedAt') as any,
  )

  const priorScreens = new Map<string, BillableScreenSource>(
    screensSnapshot.docs.map((screen) => [
      screen.id,
      { id: screen.id, kind: screen.get('kind'), deletedAt: screen.get('deletedAt') },
    ]),
  )

  // The state the import WOULD leave: the bundle's documents keyed by their
  // export ids, so a document the host already has is replaced and not added.
  const nextScreens = new Map(priorScreens)
  for (const screen of bundleScreens) nextScreens.set(screen.id, screen)

  // The host patch is written with `merge: true`, which deep-merges a map
  // field, so the restored routing map is the union rather than the bundle's.
  const nextRoutingMap = {
    ...((routingMap as Record<string, unknown>) ?? {}),
    ...(bundleRoutingMap && typeof bundleRoutingMap === 'object'
      ? (bundleRoutingMap as Record<string, unknown>)
      : {}),
  }

  // The plan's allowance first: when two caps are crossed at once, the one
  // worth naming is the one with a price on it (the rule `resourceCapRefusal`
  // follows for a plugin's sections).
  if (Number.isFinite(limit)) {
    const prior = billableScreenIds([...priorScreens.values()], routingMap as any)
    const next = billableScreenIds([...nextScreens.values()], nextRoutingMap)
    if (next.size > prior.size && next.size > limit) {
      return {
        status: 403,
        error:
          `This backup holds ${bundleScreens.length} pages and this site has ` +
          `${prior.size}, which would put it at ${next.size} of ${limit} ` +
          'pages. Nothing was imported — upgrade in Billing, or restore into ' +
          'a site with room.',
      }
    }
  }

  // Then the flat platform cap on the screens no plan counts (AGL-1439). The
  // bundle's `kind` is deliberately IMPORTABLE — dropping it would restore a
  // site's emails as live billable pages (AGL-1383) and refusing it would break
  // restoring any site with a blog, which is the failure AGL-1382 exists to
  // prevent. So the count is capped and the kind is not: a restore carrying
  // entry templates lands, and only the bundle that would push a host past
  // 5,000 non-page documents is refused.
  if (bundleCarriesNonPage) {
    const prior = nonPageScreenIds([...priorScreens.values()], routingMap as any)
    const next = nonPageScreenIds([...nextScreens.values()], nextRoutingMap)
    if (next.size > prior.size && next.size > NON_PAGE_SCREEN_MAX_PER_HOST) {
      return {
        status: 403,
        error:
          `This backup holds ${bundleScreens.length} pages and this site ` +
          `has ${prior.size} email designs and template pages, which would put it ` +
          `at ${next.size} of ${NON_PAGE_SCREEN_MAX_PER_HOST}. Nothing was ` +
          'imported — delete some, or restore into a site with room.',
      }
    }
  }

  return null
}

/**
 * The bundle collections that land in the HOST and carry a numeric plan cap,
 * paired with the quota key `/api/hosts/resources` already enforces them on
 * (AGL-1403).
 *
 * A table rather than a check per collection because the arithmetic really is the same
 * for all of them: unlike screens these have no exclusion rule, so the state an
 * import would leave is just `|existing ids ∪ bundle ids|`. The mapping is the
 * only thing worth writing down, and writing it down is what makes the gap
 * visible: this file named no quota key at all before AGL-1398, and the check
 * that landed then reads `screensPerHost` off `resolveOrgEntitlements`, so
 * `checkQuota` arrives here for the first time with this table. A cap nothing
 * in the file mentions is a cap nobody reviewing the file can notice is
 * missing.
 *
 * The platform's own row is `layouts`. The rest are the collections plugins
 * declare for the bundle whose `resource` names a plan counter — a site's
 * workflows, functions, variables and services — read from the declaration
 * rather than written here, so the counter a restore is met against is the
 * one the create route meets the same kind against, by construction.
 *
 * `layouts` and `services` are UNLIMITED on every plan that can reach this
 * route, so today they refuse nothing and cost no read. They are in the table
 * anyway: the table is the mapping between a bundle collection and its cap, not
 * a judgement about the current price list, and a row that is dead today is how
 * the next tier stays covered without anyone remembering this file.
 *
 * Deliberately absent, and none of them a judgement call:
 *
 * * `screens` — a different rule (`billableScreenIds`, with three exclusions)
 *   and its own check above (AGL-1398).
 * * a declared collection counted by a FLAT cap — the table below.
 * * `collections`/`entries` — uncapped by design; AGL-1387 declined
 *   `collectionsPerHost` and this is not the issue that re-opens it.
 * * `components` — `componentsPerHost` is unlimited on every plan that can
 *   reach here (Free's 1 is the only finite allowance, AGL-3615), so there is
 *   no number to compare against.
 * * `media` — the meter is bytes at upload, and an import copies no bytes.
 */
const CAPPED_HOST_COLLECTIONS: ReadonlyArray<{
  collection: string
  quotaKey: string
  label: string
}> = [
  {
    collection: 'layouts',
    quotaKey: 'sharedLayoutsPerHost',
    label: 'shared layouts',
  },
  ...PLUGIN_SITE_EXPORT_COLLECTIONS.flatMap((declared) =>
    'quotaKey' in declared.count
      ? [
          {
            collection: declared.collection,
            quotaKey: declared.count.quotaKey,
            label: declared.label,
          },
        ]
      : [],
  ),
]

/**
 * The bundle collections bounded by a FLAT PLATFORM cap rather than a plan
 * dimension (AGL-2266).
 *
 * A separate table from `CAPPED_HOST_COLLECTIONS` because the number comes
 * from a constant rather than from `OrgEntitlements`, and mixing them would
 * make the quota table look like it prices things it does not. The
 * arithmetic is otherwise identical, so the loop below is shared.
 *
 * ## Why this route needs them at all
 *
 * The declared collections counted by a flat cap — a site's interactions and
 * actions, by `ACTIONS_MAX_PER_HOST` — come from their `resource`, resolved by
 * name the way the create route resolves it; a name core does not hold is
 * `null`, and a bundle carrying that collection is refused rather than
 * restored uncapped.
 *
 * AGL-2266 moved `actions` and `entries` creation server-side and gave
 * `collections` a ceiling, which closes the CLIENT door. This route is the
 * other one: it writes with the Admin SDK, so the rules do not govern it, and
 * `EXPORT_COLLECTION_LIMITS` lets one bundle carry 100 actions and 20
 * collections. Bounded per bundle, unbounded per BUTTON PRESS — import the
 * same bundle six times under six fresh id sets and the flat cap the console
 * now enforces has been walked around entirely. That is the create-time
 * laundering shape this arc keeps producing, and a cap enforced at one of two
 * writers is a cap.
 *
 * `entries` is deliberately NOT here, and the reason is a read bill rather
 * than a judgement — see the note at the end of this table's use below.
 */
const FLAT_CAPPED_HOST_COLLECTIONS: ReadonlyArray<{
  collection: string
  max: number | null
  label: string
}> = [
  ...PLUGIN_SITE_EXPORT_COLLECTIONS.flatMap((declared) =>
    'max' in declared.count
      ? [
          {
            collection: declared.collection,
            max: declared.count.max,
            label: declared.label,
          },
        ]
      : [],
  ),
  // Custom content authors (AGL-2486). Same arithmetic and the same reason:
  // `AUTHORS_MAX_PER_HOST` is enforced on /api/hosts/resources, which closes
  // the CLIENT door, and this route writes with the Admin SDK. A bundle can
  // carry 100 authors and be imported repeatedly under fresh id sets.
  { collection: 'authors', max: AUTHORS_MAX_PER_HOST, label: 'authors' },
  {
    collection: 'collections',
    max: COLLECTIONS_MAX_PER_HOST,
    label: 'collections',
  },
]

/** The ids a collection already holds. A field mask with no fields projects to
 * the document id alone, so this is the cheapest form of the read. */
async function existingDocIds(
  ref: FirebaseFirestore.CollectionReference,
): Promise<Set<string>> {
  const snapshot = await ref.select().get()
  return new Set(snapshot.docs.map((doc) => doc.id))
}

/**
 * The ids a bundle collection would WRITE — distinct, because two items sharing
 * an id are one document at `merge: false`, and because the count named in the
 * refusal has to be the number of things that would exist.
 */
function bundleDocIds(items: Array<Record<string, any>>): Set<string> {
  const bundleIds = new Set<string>()
  for (const item of items) {
    if (item?.$id) bundleIds.add(String(item.$id))
  }
  return bundleIds
}

/**
 * Refuse a bundle that would put the org or the host over any of the OTHER
 * numeric caps (AGL-1403) — the ones AGL-1398 left standing when it closed the
 * screens leg.
 *
 * This route creates many other document classes and once checked the quota
 * of none of them. Against Pro, the cheapest plan that can import: `workflows`
 * 100 against 25, `functions` 100 against 50, and `variables` 100 against
 * 100 — where the caps merely TIE, so it crosses on whatever the site already
 * holds and no check that reads the file alone can see it.
 *
 * ## A plugin's sections lead
 *
 * A section a plugin answers for (`plugin-site-bundle`) is asked first, and
 * its sentence is the one a bundle busting several caps reports. Its count is
 * the ORGANIZATION's, and the one sold as add-ons on top of the plan — a
 * workspace's datasets — so it is the leg that leaks revenue rather than
 * under-meters; a restore blocked four times running is worse than one
 * blocked once, and the arithmetic worth naming is the one with a price on
 * it. How a section counts, and what an id collision proves at its scope, is
 * the plugin's to say.
 *
 * ## Before the first write, and for the whole bundle
 *
 * AGL-1398's decision, extended rather than re-argued: the route commits in
 * chunks of 400 and batches the restored routing map first, so there is no
 * point after the first write where a refusal leaves a coherent site. A partial
 * import that dropped only the datasets would leave every restored page bound
 * to data that is not there. Enforced by assertion — every refusal test in
 * `import-resource-caps.spec.ts` asserts the writes are empty.
 *
 * The reads are bounded by the same rule: a collection the bundle does not
 * carry cannot raise anything, and a cap that cannot be exceeded needs no
 * count, so neither costs a read.
 *
 * Nothing is re-priced. Every number here comes from the helper that already
 * owns it at the other enforcement point — AGL-1383, AGL-1387, AGL-1390 and
 * AGL-1398 each declined to change what counts, and this is not the issue that
 * gets to either.
 */
async function resourceCapRefusal(options: {
  hostRef: FirebaseFirestore.DocumentReference
  hostId: string
  orgId: string | null
  org: unknown
  sections: readonly ResolvedSiteBundleSection[]
  sectionItems: (section: ResolvedSiteBundleSection) => Array<Record<string, any>>
  bundleItems: (name: string) => Array<Record<string, any>>
}): Promise<Response | null> {
  const { hostId, orgId, org, sections, sectionItems } = options
  for (const one of sections) {
    const refusal = await one.section.refusal?.({
      hostId,
      orgId,
      org,
      limit: one.limit,
      items: sectionItems(one),
    })
    if (refusal) return Response.json({ error: refusal }, { status: 403 })
  }
  return hostCapRefusal(options)
}

/** The host-scoped legs, one row of `CAPPED_HOST_COLLECTIONS` at a time. */
async function hostCapRefusal(options: {
  hostRef: FirebaseFirestore.DocumentReference
  org: unknown
  bundleItems: (name: string) => Array<Record<string, any>>
}): Promise<Response | null> {
  const { hostRef, org, bundleItems } = options
  for (const capped of CAPPED_HOST_COLLECTIONS) {
    const bundleIds = bundleDocIds(bundleItems(capped.collection))
    if (!bundleIds.size) continue
    const limit = checkQuota(org as any, capped.quotaKey as any, 0).limit
    if (!Number.isFinite(limit)) continue

    const existing = await existingDocIds(hostRef.collection(capped.collection))
    const next = new Set([...existing, ...bundleIds]).size
    if (next <= existing.size) continue
    if (checkQuota(org as any, capped.quotaKey as any, next - 1).allowed) continue

    return Response.json({
      error:
        `This backup holds ${bundleIds.size} ${capped.label} and this site ` +
        `has ${existing.size}, which would put it at ${next} of ${limit} ` +
        `${capped.label}. Nothing was imported — upgrade in Billing, or ` +
        'restore into a site with room.',
    }, { status: 403 })
  }

  /**
   * Then the flat platform caps (AGL-2266), same arithmetic, different source
   * for the number — and reported AFTER the priced ones for the reason the
   * dataset leg runs first: when two caps are crossed at once, the one worth
   * naming is the one the customer can pay to raise.
   *
   * The id UNION rather than a sum, exactly as above: a bundle is keyed by id,
   * so restoring a site into itself replaces rather than adds and leaves the
   * count where it was. A `existing + bundle.length > max` test would refuse
   * every restore of a site near its ceiling, which is every restore that
   * matters.
   *
   * ## The read is paid only when it could refuse
   *
   * `count()` is one read; `existingDocIds` is one per document. So the cheap
   * question is asked first — could this bundle possibly cross the cap, taking
   * every id as new? — and the id scan happens only when the answer is yes.
   * For every real restore that is one read per collection instead of five
   * hundred.
   */
  for (const capped of FLAT_CAPPED_HOST_COLLECTIONS) {
    const bundleIds = bundleDocIds(bundleItems(capped.collection))
    if (!bundleIds.size) continue
    const max = capped.max
    if (max == null) {
      throw new Error(
        `hosts/import: "${capped.collection}" names a platform cap core does not hold`,
      )
    }
    const ref = hostRef.collection(capped.collection)
    const held = (await ref.count().get()).data().count
    if (held + bundleIds.size <= max) continue

    const existing = await existingDocIds(ref)
    const next = new Set([...existing, ...bundleIds]).size
    if (next <= existing.size || next <= max) continue

    return Response.json({
      error:
        `This backup holds ${bundleIds.size} ${capped.label} and this site ` +
        `has ${existing.size}, which would put it at ${next} of ` +
        `${max}. Nothing was imported — delete some, or restore into ` +
        'a site with room.',
    }, { status: 403 })
  }

  /**
   * The theme library's custom themes (AGL-3533), against
   * `THEME_LIBRARY_MAX_CUSTOM` — the bound the library itself keeps, because
   * a client reads the whole library on every visit to the theme page. Only
   * `custom` entries count: the default's stash, a preset's and an installed
   * theme's are one each by construction. The same union of ids, so a site
   * restoring its own library raises nothing.
   */
  const customThemes = bundleItems(THEME_LIBRARY_COLLECTION).filter(
    (item) => item?.kind === 'custom',
  )
  if (customThemes.length) {
    const held = await hostRef
      .collection(THEME_LIBRARY_COLLECTION)
      .where('kind', '==', 'custom')
      .select()
      .get()
    const existing = new Set(held.docs.map((doc) => doc.id))
    const next = new Set([...existing, ...bundleDocIds(customThemes)]).size
    if (next > existing.size && next > THEME_LIBRARY_MAX_CUSTOM) {
      return Response.json({
        error:
          `This backup holds ${customThemes.length} saved themes and this site ` +
          `has ${existing.size}, which would put it at ${next} of ` +
          `${THEME_LIBRARY_MAX_CUSTOM}. Nothing was imported — delete some, or ` +
          'restore into a site with room.',
      }, { status: 403 })
    }
  }

  /**
   * `entries` is the one collection this leg does NOT bound, and the blocker
   * is a read bill rather than a decision.
   *
   * `ENTRIES_MAX_PER_COLLECTION` is 10,000 and the id-union rule needs the
   * ids, so the honest check costs up to 10,000 reads per bundle collection
   * and 200,000 for a full 20-collection bundle — on every import, to defend a
   * ceiling a bundle capped at 200 entries per collection needs fifty presses
   * to reach. The cheap `count()` pre-test above does not rescue it either: a
   * site AT the ceiling restoring its own backup would fail the pre-test every
   * time and pay the full scan anyway, which is precisely the customer who
   * must never be locked out of their own file.
   *
   * What bounds it instead is the pair the client path enforces:
   * `COLLECTIONS_MAX_PER_HOST` is checked above, so a bundle cannot multiply
   * the number of entry stores, and a site is left able to over-fill the
   * collections it already has by repeated import — a Pro-and-above,
   * admin-only, manual action against a store that is already bounded by the
   * collection count. Recorded on AGL-2266 rather than left implicit.
   */
  return null
}

/** What the route does with a request: show the plan, compare items, apply it, or undo an import. */
const IMPORT_ACTIONS = ['plan', 'compare', 'apply', 'undoPlan', 'undo'] as const

/**
 * How many items one `compare` answers. An item is compared when the person
 * opens it, so a handful is plenty, and a page's design is the largest thing
 * a package holds.
 */
const COMPARE_MAX_ITEMS = 10
type ImportAction = (typeof IMPORT_ACTIONS)[number]

/**
 * How long after an import a document it wrote still counts as the import's
 * own write rather than an edit made since: the server stamp lands a moment
 * after the clock that dated the import.
 */
const UNDO_EDIT_GRACE_MS = 5_000

/** The milliseconds of a date in the wire form a file and a snapshot hold, or `null`. */
function wireMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const seconds = record['seconds'] ?? record['_seconds']
  return typeof seconds === 'number' ? seconds * 1000 : null
}

/**
 * Site package import (AGL-163, AGL-3533): reads a package — an
 * `aglyn-package` v2 file, or a v1 `aglyn-site-export` backup converted in
 * memory — and compares each item with what the site holds before writing
 * anything. Host identity (subdomain/admins/tenant/domain) never changes;
 * personal data is never in a package. Pro+ (`siteExport` flag), host-admin
 * only.
 *
 * Body: `{ hostId, action?, package | bundle, mode?, decisions?,
 * dependencyChoices?, mergeChoices?, keys?, importId?, otherwise? }`.
 *
 * - `plan` writes nothing. Each item is matched by id, then slug, then name,
 *   within its kind, and is `new`, `identical` (same content hash),
 *   `differs` or `missingDependency`, with the decision proposed and the
 *   decisions it may take; the plan says too whether the import would cross
 *   a plan cap, counting only what it would add.
 * - `compare` writes nothing either: for each of `keys` (at most
 *   {@link COMPARE_MAX_ITEMS}), the file's item and the site item it was
 *   matched to, each as an import would write it (`siteItemProjection`) —
 *   what the import screen diffs and renders side by side (AGL-3534).
 * - `apply` writes. `mode: 'decide'` (the default with an `action`) takes the
 *   person's `decisions` by item key — create, replace (a page, layout or
 *   email as a NEW version), keep both (a new id and slug, every reference to
 *   it rewritten), skip, merge (settings and theme, key by key) — and the
 *   proposed one for the rest, plus a choice per missing dependency:
 *   `import` it from the package, `{ mapTo }` an item the site holds, `drop`
 *   the reference, or `keep` it as it is; and, for a merged item,
 *   `mergeChoices[key][field]` — `site` or `package` — key by key.
 *   `mode: 'restore'` — and a request
 *   with no `action` at all, the backup's own restore — writes every item
 *   under its own id, as a v1 restore did. Either way the content each
 *   replaced item had is kept first, for undo.
 * - `undoPlan` and `undo` take an `importId`, for seven days: an item edited
 *   since the import is a conflict, reverted only when `decisions[key]` (or
 *   `otherwise`) says `revert`.
 *
 * Why its own routes rather than the transfer job engine's: a package is a
 * site's items, not rows of a file, and its writes are this route's — the
 * allow-lists, the atomic screens leg, the plugin sections, the whole-host
 * revalidation. An apply is one request, so there is no chunk cursor to
 * lease; two imports are serialized where it matters by the screens
 * transaction (AGL-2370), as before. The ledger, the undo window, the audit
 * rows and the activity entry are the engine's guarantees, kept here.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  const action = (body?.action === undefined ? 'apply' : String(body.action)) as ImportAction
  if (!IMPORT_ACTIONS.includes(action)) {
    return Response.json({ error: `Unknown action; one of ${IMPORT_ACTIONS.join(', ')}` }, { status: 400 })
  }
  const undoing = action === 'undoPlan' || action === 'undo'
  const file = body?.package ?? body?.bundle
  const importId = typeof body?.importId === 'string' ? body.importId : ''
  if (!hostId || (undoing ? !importId : typeof file !== 'object' || file === null)) {
    return Response.json(
      { error: undoing ? 'Missing hostId or importId' : 'Missing hostId or package' },
      { status: 400 },
    )
  }
  // THE DEPLOYMENT BRAND IS RIGHT HERE, and stays (AGL-2352). Two reasons,
  // either sufficient. The sentence names a FILE FORMAT — `bundle.format` is
  // the literal `'aglyn-site-export'`, a property of the software that wrote
  // the bundle, not of the org importing it; an agency's own product name in
  // front of "site export" would describe a format that does not exist. And
  // this refusal is emitted BEFORE the Authorization header below is even
  // read, so there is no org to resolve a brand from — the format check
  // deliberately rejects a malformed bundle without authenticating it.
  let format: 1 | 2 = 2
  if (!undoing) {
    if (file.format === SITE_EXPORT_FORMAT && Number(file.version) <= SITE_EXPORT_VERSION) {
      format = 1
    } else if (!isSitePackageFile(file)) {
      return Response.json({
        error: `Not a ${PLATFORM_BRAND_NAME} site package or backup (or a newer format than this build)`,
      }, { status: 422 })
    }
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }
    // Plan gate rides the owning org's doc (AGL-238). The org id is kept —
    // media and a plugin's organization data restore into the org, not the
    // host (AGL-1046).
    const owningOrg = await getOrgForHost(hostId)
    const orgId = owningOrg?.orgId

    // Lockdown verdict (AGL-1506): platform/org/host/user scopes with the
    // docs already in hand; distinct 423 body; staff bypass is the
    // un-panic invariant. Before the cap checks as well as the writes — a
    // locked workspace gets the 423, not a quota refusal.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: owningOrg?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    if (!checkEntitlement(owningOrg?.org as any, 'siteExport')) {
      return Response.json({ error: 'Site restore requires a Pro plan' }, { status: 403 })
    }

    /**
     * The sections plugins answer for themselves, resolved before any count
     * or write: a section declared and not registered THROWS here, and the
     * restore fails before it starts rather than skipping the section.
     */
    const bundleSections = await resolveSiteBundleSections()
    const kinds = consoleSitePackageKinds()
    const sectionHooks = sectionPackageHooks(bundleSections)
    const readContext = {
      firestore,
      hostRef,
      hostId,
      orgId,
      hostData: hostSnapshot.data() ?? {},
      sections: bundleSections,
    }

    /**
     * A bundle's documents are written by the writers below; a site
     * package's items reach them as that same shape, so there is one write
     * path whatever the file was. `capped` is an import's: the pre-checks,
     * then the screens leg in one transaction. An undo writes back what the
     * site held before, which raises no count, so it takes the batches alone.
     * `beforeWrites` runs once the pre-checks pass — where an import files
     * its undo snapshot, so a refused import writes nothing at all.
     */
    const writeBundle = async (
      bundle: any,
      options: { capped: boolean; beforeWrites?: () => Promise<void> },
    ): Promise<
      | { ok: false; refusal: Response }
      | {
          ok: true
          written: number
          dataReport: SiteBundleReportRow[]
          /** Every document path written, by `<bundle key>/<id>`. */
          paths: Map<string, Set<string>>
        }
    > => {
      /**
       * The bundle's per-collection caps, applied in ONE place. The screen-cap
       * check below has to count what will actually be WRITTEN, and a separate
       * `.slice()` at each import site is a second answer waiting to drift from
       * the first — which is exactly what the export/import media limit did
       * before AGL-1382 gave it one home.
       */
      const bundleItems = (name: string): Array<Record<string, any>> => {
        const items: any[] = Array.isArray(bundle[name]) ? bundle[name] : []
        return items.slice(0, EXPORT_COLLECTION_LIMITS[name] ?? 100)
      }

      /** Each section's items, capped at its declared limit in the same one place. */
      const sectionItems = (one: ResolvedSiteBundleSection): Array<Record<string, any>> => {
        const items: any[] = Array.isArray(bundle[one.key]) ? bundle[one.key] : []
        return items.slice(0, one.limit)
      }

      if (options.capped) {
        /**
         * Before the first write, because a half-restored site is worse than a
         * refused one (AGL-1398).
         *
         * This is the FAST FAIL and the message, not the authority (AGL-2370). The
         * same check runs again inside the screens transaction below, where the
         * count is `tx.get`'s and a concurrent import cannot slip between the read
         * and the commit. Keeping this one costs a projected scan on a rare,
         * admin-only, Pro-gated operation and buys two things a
         * transaction-only shape loses: a bundle that busts the SCREEN cap is
         * refused naming the screen cap rather than whichever of the five resource
         * caps `resourceCapRefusal` happens to reach first, and neither gate's
         * reads are paid for a bundle the other has already doomed.
         *
         * A stale answer here can only be over-strict, never over-permissive: the
         * transaction re-derives the verdict from its own locked read, so the
         * failure mode of this check being wrong is a refusal the customer can
         * retry, not a screen nobody paid for.
         */
        const overCap = await screenCapRefusal({
          hostRef,
          routingMap: hostSnapshot.get('screens'),
          bundleRoutingMap: bundle.host?.screens,
          org: owningOrg?.org,
          bundleScreens: bundleItems('screens'),
        })
        if (overCap) {
          return { ok: false, refusal: Response.json({ error: overCap.error }, { status: overCap.status }) }
        }

        // And every OTHER numeric cap this route creates against (AGL-1403) —
        // a plugin's sections first, because theirs are the counts sold as
        // add-ons.
        const overResourceCap = await resourceCapRefusal({
          hostRef,
          hostId,
          orgId: orgId ?? null,
          org: owningOrg?.org,
          sections: bundleSections,
          sectionItems,
          bundleItems,
        })
        if (overResourceCap) return { ok: false, refusal: overResourceCap }
      }
      await options.beforeWrites?.()

      let written = 0
      /** Documents the screens transaction committed, folded into `written`
       * after it succeeds rather than during an attempt (AGL-2370). */
      let screenWrites = 0
      /** The item whose documents are being written, by `<bundle key>/<id>`. */
      let writing: string | null = null
      const paths = new Map<string, Set<string>>()
      const track = (key: string | null, path: string) => {
        if (!key) return
        if (!paths.has(key)) paths.set(key, new Set())
        ;(paths.get(key) as Set<string>).add(path)
      }
      // Firestore batches cap at 500 writes; chunk conservatively.
      let batch = firestore.batch()
      let batched = 0
      const commit = async () => {
        if (batched > 0) await batch.commit()
        batch = firestore.batch()
        batched = 0
      }
      const write = async (
        ref: FirebaseFirestore.DocumentReference,
        data: Record<string, unknown>,
      ) => {
        batch.set(ref, data, { merge: false })
        track(writing, ref.path)
        written += 1
        if ((batched += 1) >= 400) await commit()
      }

      // Host settings — exportable fields only. Written by the SCREENS
      // transaction below rather than queued here (AGL-2370): the patch carries
      // the routing map the cap is counted against, so the two have to land
      // together or the count the commit was authorized by is not the count the
      // site ends up with. It stays the first document written either way.
      const hostPatch: Record<string, unknown> = {}
      for (const field of EXPORTABLE_HOST_FIELDS) {
        if (bundle.host?.[field] !== undefined) {
          hostPatch[field] = bundle.host[field]
        }
      }
      // What an undo clears: a field the site did not hold before the import.
      for (const field of bundle.hostDeletes ?? []) {
        if ((EXPORTABLE_HOST_FIELDS as readonly string[]).includes(field)) {
          hostPatch[field] = firebaseAdmin.firestore.FieldValue.delete()
        }
      }
      for (const screenId of bundle.routeDeletes ?? []) {
        hostPatch['screens'] = {
          ...((hostPatch['screens'] as Record<string, unknown>) ?? {}),
          [screenId]: firebaseAdmin.firestore.FieldValue.delete(),
        }
      }

      /**
       * `nodes` in the form the platform stores it: msgpack (AGL-1151).
       *
       * Applied to every document a restore writes, because a restore must land
       * a site in the shape the product writes — not in whichever shape the
       * bundle happens to hold. A bundle carries the DECODED tree by design
       * (see the export route: a backup nobody can read is most of the way to
       * no backup), so without this a restored component or template is a plain
       * map at roughly 1.4x the bytes, sitting against the same 1 MiB ceiling
       * as everything else, until somebody happens to open and re-save it.
       *
       * `elements` is deliberately left alone. It is the legacy alias that only
       * exists on documents written before compression, several readers take it
       * raw, and `screenVersionConverter` migrates it to `nodes` on the next
       * read anyway.
       */
      const storedNodes = (data: Record<string, unknown>) => {
        if (data['nodes'] === undefined) return data
        const packed = encodeStoredNodes(data['nodes'])
        return packed ? { ...data, nodes: Buffer.from(packed) } : data
      }

      /**
       * A declared collection's off-site destination is approved by the admin
       * importing it (AGL-3533): the approver a file names is provenance it
       * cannot supply, and the serve path refuses an off-site destination
       * with no approver at all.
       */
      const approvals = new Map(
        PLUGIN_SITE_EXPORT_COLLECTIONS.flatMap((declared) =>
          declared.externalDestination ? [[declared.collection, declared.externalDestination]] : [],
        ),
      )
      const importPlain = async (name: string) => {
        const approval = approvals.get(name)
        for (const item of bundleItems(name)) {
          if (!item?.$id) continue
          writing = `${name}/${item.$id}`
          const cleaned = cleanDoc(name, item)
          if (approval && !isSitePath(cleaned[approval.field])) {
            cleaned[approval.approvedByField] = decoded.uid
          }
          await write(hostRef.collection(name).doc(String(item.$id)), storedNodes(cleaned))
        }
      }

      // Legacy binding tokens in imported nodes normalize to id form
      // (AGL-188): bundle docs keep their export ids, so the bundle's own
      // variables/functions provide the name → id mapping.
      const tokenLookup = (name: 'variables' | 'functions') => {
        const map: Record<string, { name?: string; $id?: string }> = {}
        const items: any[] = Array.isArray(bundle[name]) ? bundle[name] : []
        for (const item of items) {
          if (item?.$id && item?.name) {
            map[String(item.name)] = { name: item.name, $id: String(item.$id) }
            map[String(item.$id)] = { name: item.name, $id: String(item.$id) }
          }
        }
        return map
      }
      const bundleVariables = tokenLookup('variables')
      const bundleFunctions = tokenLookup('functions')

      /**
       * Screens, layouts and the site's emails restore the doc plus its
       * published version.
       *
       * `writeDoc` is a parameter because the collections no longer commit the
       * same way (AGL-2370): layouts and emails ride the chunked batch, screens
       * are written by the transaction that owns `screensPerHost`. One function
       * either way — a second copy of the version decode, the legacy `elements`
       * alias and the AGL-835 name key is exactly the drift `cleanDoc` exists to
       * prevent, one level up.
       */
      const importVersioned = async (
        name: string,
        versionFields: string,
        writeDoc: (
          ref: FirebaseFirestore.DocumentReference,
          data: Record<string, unknown>,
        ) => Promise<void> | void = write,
      ) => {
        for (const item of bundleItems(name)) {
          if (!item?.$id) continue
          writing = `${name}/${item.$id}`
          const docRef = hostRef.collection(name).doc(String(item.$id))
          // `cleanDoc` re-derives the list keys (AGL-835, AGL-3321).
          const cleaned = cleanDoc(name, item)
          await writeDoc(docRef, cleaned)
          if (item.version?.$id) {
            const version = cleanDoc(versionFields, item.version)
            /**
             * Decode a bundle that predates the export fix (AGL-1391).
             *
             * The export now decodes `nodes` on the way out, but that cannot
             * reach a file already sitting on a customer's disk — and the only
             * day anyone opens a year-old backup is the day they need it, so
             * "restored blank" is the worst failure this feature has. A bundle
             * exported before the fix carries `{"type":"Buffer","data":[…]}`,
             * which `decodeStoredNodes` now recognises as a third storage form.
             *
             * The decode is what makes old and new bundles converge on one
             * shape; `storedNodes` below then writes that shape the way every
             * other writer does, so a restored version is compressed from the
             * moment it lands rather than on whatever day somebody re-saves it.
             *
             * It also has to happen BEFORE the rewrite below. Over an opaque
             * envelope `rewriteBindingTokensDeep` finds no `{{` strings and
             * reports `changed: false`, so legacy binding tokens in every
             * besigner-saved page were silently never normalized on restore.
             */
            for (const key of ['nodes', 'elements']) {
              // Only a key the bundle HAS. Assigning `nodes` unconditionally
              // wrote an explicit `undefined` for a version carrying just the
              // legacy `elements` alias, and the Admin SDK rejects that outright
              // — it is configured without `ignoreUndefinedProperties`. The
              // rewrite now covers `elements` too, which is where a legacy
              // document's tree, and so its legacy tokens, actually live.
              if (version[key] === undefined) continue
              const decodedNodes = decodeStoredNodes(version[key]) ?? version[key]
              version[key] = rewriteBindingTokensDeep(
                decodedNodes,
                bundleVariables,
                bundleFunctions,
              ).value
            }
            await writeDoc(
              docRef.collection('versions').doc(String(item.version.$id)),
              storedNodes(version),
            )
          }
        }
      }

      const importCollections = async () => {
        for (const item of bundleItems('collections')) {
          if (!item?.$id) continue
          writing = `collections/${item.$id}`
          const docRef = hostRef.collection('collections').doc(String(item.$id))
          const cleaned = cleanDoc('collections', item)
          // `collections` holds both content and catalog documents (AGL-954).
          // A bundle exported before that discriminator existed carries no
          // `kind`, so this is the one place that still infers it from shape
          // (AGL-979) — everywhere else reads `kind` and does not guess. An
          // explicit `kind` in the bundle is preserved.
          await write(docRef, {
            ...cleaned,
            kind: legacyCollectionKind(cleaned),
          })
          const entries: any[] = Array.isArray(item.entries) ? item.entries : []
          for (const entry of entries.slice(0, 200)) {
            if (!entry?.$id) continue
            const cleanedEntry = cleanDoc('entries', entry)
            // The console's Published sort key is DERIVED, never carried in a
            // bundle (AGL-3323): it is recomputed from the restored `status`,
            // `publishedAt` and `publishAt`, and left off an undated draft so
            // it lists after every dated entry.
            const publishSortAt = entryPublishSortStamp(cleanedEntry as any)
            await write(
              docRef.collection('entries').doc(String(entry.$id)),
              {
                ...cleanedEntry,
                // The entries table's search words (AGL-3321), derived from
                // the restored title for the same reason: a bundle's copy is
                // whatever the export or its editor made of it.
                ...entryTitleSearchFields(cleanedEntry['title']),
                ...(publishSortAt
                  ? { [ENTRY_PUBLISH_SORT_FIELD]: publishSortAt }
                  : {}),
              },
            )
          }
        }
      }

      /**
       * Authors through the `authors` allow-list, like any plain collection, and
       * then the fields the Authors table queries (AGL-3321) — derived from the
       * restored name and type, never carried: an older bundle spells `type`
       * as a string and holds no search keys at all.
       */
      const importAuthors = async () => {
        for (const item of bundleItems('authors')) {
          if (!item?.$id) continue
          writing = `authors/${item.$id}`
          const cleaned = cleanDoc('authors', item)
          await write(hostRef.collection('authors').doc(String(item.$id)), {
            ...cleaned,
            ...contentAuthorQueryFields(cleaned),
          })
        }
      }

      /**
       * Media restores into the OWNING ORG (AGL-237), scoped to the importing
       * site (AGL-1046). It used to be written to
       * `hosts/{hostId}/…`, the path AGL-1050 proved nothing reads any more,
       * so a restore appeared to succeed and the data was never seen again.
       *
       * The scope is deliberately `['host:{hostId}]` and not whatever the
       * bundle carried. A bundle is portable: it can be restored into a
       * different site, or a different org entirely, and honouring an
       * embedded `['org']` there would publish one org's data across another
       * agency's whole client roster on a restore. Narrow is recoverable in
       * one click on the sharing control; wide is a leak. The export side
       * strips `visibleTo` for the same reason.
       */
      const orgScopedRef = (name: 'media' | 'mediaFolders', id: string) =>
        firestore.collection('orgs').doc(orgId as string).collection(name).doc(id)
      // Through the AGL-1478 gate since AGL-1484. A restore CREATES documents
      // in two scoped collections here — `media`, `mediaFolders` — and was
      // missing from `scoped-create-coverage.spec.ts` entirely, because it is
      // spelled as a restore rather than as a create.
      const importedScope = newResourceScopeFields([hostScopeToken(hostId)])

      /**
       * The folder ids a restored `parentId`/`folderId` may legitimately name
       * (AGL-1392): the ones this bundle brings, plus the ones the target org
       * already holds.
       *
       * Both sides are needed, and each covers a case the other gets wrong:
       *
       * * The BUNDLE's own ids are what makes a restore into a fresh org work at
       *   all — nothing is there yet, so only the bundle can vouch for a folder.
       * * The TARGET org's existing ids are what stops a restore into the source
       *   org from breaking something that was fine. Folders are scoped, so a
       *   folder belonging to a sibling host is not in this host's export while
       *   being very much present in the org; nulling a parent that points at it
       *   would reparent a live folder tree to root on a routine restore.
       *
       * One id-only read (`.select()` with no fields), and only when the bundle
       * actually carries something that could dangle.
       */
      let resolvableFolders: Set<string> | null = null
      const resolvableFolderIds = async (): Promise<Set<string>> => {
        if (resolvableFolders) return resolvableFolders
        const bundled = bundleDocIds(bundleItems('mediaFolders'))
        const existing =
          orgId && (bundled.size || bundleItems('media').length)
            ? await existingDocIds(
                firestore.collection('orgs').doc(orgId).collection('mediaFolders'),
              )
            : new Set<string>()
        resolvableFolders = new Set([...bundled, ...existing])
        return resolvableFolders
      }

      /**
       * The same question for the SITE's own library (AGL-1392, second pass):
       * the host folder ids a restored `parentId`/`folderId` may name — this
       * bundle's `hostMediaFolders`, plus the ones the target site already
       * holds.
       *
       * A SECOND set rather than a union with the org one, and the separation is
       * the assertion: the two libraries are distinct id spaces, and an asset in
       * the site library filed under an org folder id is exactly as invisible as
       * one filed under an id nobody holds. Resolving against a merged set would
       * accept that pointer and hide the asset, which is the failure this guard
       * exists to prevent — one library over.
       */
      let resolvableHostFolders: Set<string> | null = null
      const resolvableHostFolderIds = async (): Promise<Set<string>> => {
        if (resolvableHostFolders) return resolvableHostFolders
        const bundled = bundleDocIds(bundleItems('hostMediaFolders'))
        const existing =
          bundled.size || bundleItems('hostMedia').length
            ? await existingDocIds(hostRef.collection('mediaFolders'))
            : new Set<string>()
        resolvableHostFolders = new Set([...bundled, ...existing])
        return resolvableHostFolders
      }

      /**
       * Null a pointer that names a folder which will not exist.
       *
       * Absence stays absence and an explicit `null` stays `null` — only a STRING
       * naming a missing folder is rewritten, because a dangling pointer is worse
       * than no pointer in both places it appears. A folder whose parent is
       * missing is unreachable in the DAM tree, and an ASSET whose folder is
       * missing is filtered out of the root view (which excludes anything with a
       * truthy `folderId`) as well as every folder view — so it is hidden, not
       * misfiled. Root is recoverable by dragging; invisible is not.
       */
      const resolvedFolderPointer = (
        value: unknown,
        resolvable: Set<string>,
      ): unknown =>
        typeof value === 'string' && !resolvable.has(value) ? null : value

      /**
       * `orgs/{orgId}/mediaFolders` — in NO list before AGL-1392, while
       * `media.folderId` was restorable. Written before the assets so the tree
       * exists by the time anything points into it.
       */
      const importMediaFolders = async () => {
        if (!orgId) return
        const resolvable = await resolvableFolderIds()
        for (const item of bundleItems('mediaFolders')) {
          if (!item?.$id) continue
          writing = `mediaFolders/${item.$id}`
          const cleaned = cleanDoc('mediaFolders', item)
          if ('parentId' in cleaned) {
            cleaned['parentId'] = resolvedFolderPointer(
              cleaned['parentId'],
              resolvable,
            )
          }
          await write(orgScopedRef('mediaFolders', String(item.$id)), {
            ...cleaned,
            ...importedScope,
          })
        }
      }

      const importOrgPlain = async (name: 'media') => {
        if (!orgId) return
        const resolvable = await resolvableFolderIds()
        for (const item of bundleItems(name)) {
          if (!item?.$id) continue
          writing = `${name}/${item.$id}`
          const cleaned = cleanDoc(name, item)
          if ('folderId' in cleaned) {
            cleaned['folderId'] = resolvedFolderPointer(
              cleaned['folderId'],
              resolvable,
            )
          }
          await write(orgScopedRef(name, String(item.$id)), {
            ...cleaned,
            ...importedScope,
          })
        }
      }

      /**
       * The SITE's own library, restored into the SITE (AGL-1392, second pass).
       *
       * `hosts/{hostId}/media` and `hosts/{hostId}/mediaFolders` — the scope the
       * console's media library addresses whenever it is opened for a site
       * rather than for the workspace, and the canonical folder path AGL-171
       * defined. Neither reached a bundle before this pass, so a restore could
       * not re-parent what it never carried.
       *
       * Two things are deliberately NOT shared with the org pair:
       *
       * * The DESTINATION. These documents go back to the host, never to
       *   `orgs/{orgId}/…`. A site library is private; promoting it into the
       *   shared org DAM on a restore would expose one client's files to every
       *   member of every other client site — a wider scope than the customer
       *   ever chose, and the leak `importedScope` exists to prevent.
       * * The SCOPE FIELD. No `visibleTo` is written at all. A host library's
       *   documents carry none — `scopedToHost` refuses to filter a host ref for
       *   exactly that reason — so stamping one would invent a field the live
       *   write paths never produce, and `merge: false` would make the restored
       *   document differ from every one beside it.
       *
       * Cleaned through the `media`/`mediaFolders` allow-lists: the same document
       * in a different library, so it cannot acquire a second permitted set.
       */
      const importHostLibrary = async (name: 'media' | 'mediaFolders') => {
        const bundleKey = name === 'media' ? 'hostMedia' : 'hostMediaFolders'
        const pointer = name === 'media' ? 'folderId' : 'parentId'
        const resolvable = await resolvableHostFolderIds()
        for (const item of bundleItems(bundleKey)) {
          if (!item?.$id) continue
          writing = `${bundleKey}/${item.$id}`
          const cleaned = cleanDoc(name, item)
          if (pointer in cleaned) {
            cleaned[pointer] = resolvedFolderPointer(cleaned[pointer], resolvable)
          }
          await write(hostRef.collection(name).doc(String(item.$id)), cleaned)
        }
      }

      /**
       * The sections plugins answer for, each through the restore's own writer
       * and stamps, so its documents ride these batches and this total. A
       * section restores what it can and REPORTS what does not conform
       * (AGL-182) — data is never silently dropped; the report tells the owner
       * what to fix. One item at a time, so each document written is filed
       * under the item that wrote it, which is what an undo deletes.
       */
      const dataReport: SiteBundleReportRow[] = []
      /**
       * A section's document, by its full path — and only inside the trees
       * this restore owns: the importing site's, and its organization's. A
       * section writes nothing anywhere else, whatever its bundle says.
       */
      const sectionDocument = (path: string): FirebaseFirestore.DocumentReference =>
        ownedDocument(firestore, hostId, orgId, path)
      const importSections = async () => {
        for (const one of bundleSections) {
          for (const item of sectionItems(one)) {
            if (!item?.$id) continue
            writing = `${one.key}/${item.$id}`
            const rows = await one.section.import({
              hostId,
              orgId: orgId ?? null,
              org: owningOrg?.org,
              limit: one.limit,
              items: [item],
              write: (documentPath, data) => write(sectionDocument(documentPath), data),
              stamps: () => ({
                updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              }),
              // The console's server plugin loader, imported here rather than at
              // module scope because importing it builds the plugin manifest.
              loadPluginSurfaces: async () => {
                const { serverPluginLoader } = await import(
                  '../../../../utils/server-plugin-loader'
                )
                await serverPluginLoader.ensureAll(['consoleApi'])
              },
            })
            dataReport.push(...rows)
          }
        }
      }

      if (options.capped) {
        /**
         * The screens leg, in ONE transaction (AGL-2370).
         *
         * The host patch goes in with it because the routing map it carries is an
         * INPUT to the count, and the screen versions because a screen without the
         * version it points at is a broken page. `written` is accumulated inside
         * the attempt and folded in only on success: a transaction body can run
         * several times, and a counter incremented per attempt would report a
         * retried import as having written the screens twice — and so are the
         * paths each attempt wrote.
         */
        let screenPaths: Array<[string | null, string]> = []
        const screenRefusal = await firestore.runTransaction(async (tx) => {
          // ALL READS BEFORE ANY WRITE, which Firestore requires. The HOST is
          // re-read here rather than taken from the caller's earlier snapshot, for
          // the reason AGL-2369 gives at the other door: the routing map is an
          // INPUT to the count, a concurrent import's host patch changes it, and a
          // gate reading a pre-race value is only accidentally serialized.
          const currentHost = await tx.get(hostRef)
          const refusal = await screenCapRefusal({
            hostRef,
            routingMap: currentHost.get('screens'),
            bundleRoutingMap: bundle.host?.screens,
            org: owningOrg?.org,
            bundleScreens: bundleItems('screens'),
            read: (query) => tx.get(query as any) as any,
          })
          if (refusal) return refusal
          if (Object.keys(hostPatch).length) {
            tx.set(hostRef, hostPatch, { merge: true })
          }
          let attemptWrites = 0
          const attemptPaths: Array<[string | null, string]> = []
          await importVersioned('screens', 'versions', (ref, data) => {
            tx.set(ref, data, { merge: false })
            attemptPaths.push([writing, ref.path])
            attemptWrites += 1
          })
          screenWrites = attemptWrites
          screenPaths = attemptPaths
          return null
        })
        if (screenRefusal) {
          return {
            ok: false,
            refusal: Response.json(
              { error: screenRefusal.error },
              { status: screenRefusal.status },
            ),
          }
        }
        written += screenWrites
        for (const [key, path] of screenPaths) track(key, path)
      } else {
        if (Object.keys(hostPatch).length) {
          batch.set(hostRef, hostPatch, { merge: true })
          batched += 1
        }
        await importVersioned('screens', 'versions')
      }

      await importVersioned('layouts', 'versions')
      await importVersioned(TENANT_EMAIL_COLLECTION, 'emailTemplateVersions')
      await importPlain('components')
      await importPlain(THEME_LIBRARY_COLLECTION)
      // The collections plugins declare for the bundle, each through the
      // field list its declaration names (folded into `IMPORTABLE_FIELDS`).
      for (const declared of PLUGIN_SITE_EXPORT_COLLECTIONS) {
        await importPlain(declared.collection)
      }
      await importAuthors()
      // Folders before assets: the tree has to exist before anything points into
      // it, and both reads resolve against the same id set (AGL-1392).
      await importMediaFolders()
      await importOrgPlain('media')
      // The site's own library, same rule one scope over (AGL-1392).
      await importHostLibrary('mediaFolders')
      await importHostLibrary('media')
      await importCollections()
      // A plugin's sections last: what they restore may point at what the
      // platform restored above, never the other way round.
      await importSections()
      writing = null
      await commit()
      return { ok: true, written, dataReport, paths }
    }

    /** One activity entry per import or undo (AGL-3321's search words included). */
    const logActivity = (text: string) =>
      hostRef
        .collection('activity')
        .add({
          actorId: decoded.uid,
          actorEmail: decoded.email ?? null,
          action: text,
          target: { type: 'host', id: hostId },
          // What the log's search box finds the entry by (AGL-3321).
          searchTokens: activitySearchTokens({ actorEmail: decoded.email }),
          createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)

    if (undoing) {
      return await undoImport({
        action,
        importId,
        body,
        firestore,
        hostRef,
        hostId,
        orgId: orgId ?? null,
        uid: decoded.uid,
        email: decoded.email ?? null,
        kinds,
        readContext,
        writeBundle,
        logActivity,
      })
    }

    /**
     * The file's items. A v1 backup is converted in memory — every backup ever
     * downloaded restores — with each array capped where the restore always
     * capped it. A v2 package names its kinds; an item of a kind this site
     * does not read (a plugin it lacks) is set aside and named, and the rest
     * import.
     */
    let items: SitePackageItem[]
    let unknownKinds: string[] = []
    if (format === 1) {
      items = siteBundleItems(file, sitePackageContract(), [...kinds.values()])
    } else {
      const read = readSitePackage(file, kinds)
      if (read.ok === false) {
        return Response.json({ error: 'The package cannot be read', problems: read.problems }, { status: 422 })
      }
      items = read.items
      unknownKinds = read.unknownKinds
      const overLimit = sitePackageOverLimit(items, kinds)
      if (overLimit.length) {
        return Response.json({ error: 'The package carries more than one import writes', problems: overLimit }, { status: 422 })
      }
    }
    // A site email is filed under the key of an email the platform sends; a
    // key it does not send is a document no screen would ever read.
    const notSent = items.filter((item) => item.kind === 'emailTemplate' && !getTenantEmail(item.id))
    items = items.filter((item) => !notSent.includes(item))

    const site = await readSiteAsPackage(readContext, kinds)
    const incoming = await sitePackageOf(items, {
      kinds,
      sections: sectionHooks,
      alsoKnown: site.items,
    })
    const plan = planSitePackageImport(incoming, site.existing, kinds)
    if (action === 'compare') {
      const keys: string[] = Array.isArray(body?.keys) ? body.keys.map(String) : []
      if (!keys.length || keys.length > COMPARE_MAX_ITEMS) {
        return Response.json({ error: `Compare between 1 and ${COMPARE_MAX_ITEMS} items at a time` }, { status: 400 })
      }
      const compared = keys.flatMap((key) => {
        const planned = plan.items.find((one) => one.key === key)
        if (!planned) return []
        const kind = kinds.get(planned.kind)
        const matched = planned.existing
          ? site.existing.find((one) => one.kind === planned.kind && one.id === planned.existing?.id)
          : undefined
        return [{
          key,
          kind: planned.kind,
          id: planned.id,
          incoming: siteItemProjection({ kind: planned.kind, id: planned.id, content: incoming.items[key] ?? {} }, kind),
          existing: matched
            ? { id: matched.id, content: siteItemProjection({ kind: matched.kind, id: matched.id, content: matched.content }, kind) }
            : null,
        }]
      })
      return Response.json({ items: compared })
    }
    // A request with no action is a backup restored the way it always was.
    const mode = body?.mode === 'restore' || body?.action === undefined ? 'restore' : 'decide'
    let resolved: ResolvedSitePackageImport
    try {
      resolved = resolveSitePackageImport({
        incoming,
        plan,
        mode,
        decisions: body?.decisions ?? {},
        dependencyChoices: body?.dependencyChoices ?? {},
        mergeChoices: body?.mergeChoices ?? {},
        existing: site.existing,
        newId: createResourceUid,
        kinds,
        sections: sectionHooks,
      })
    } catch (error) {
      if (error instanceof SitePackageDecisionError) {
        return Response.json({ error: 'Some decisions cannot be applied', problems: error.problems }, { status: 400 })
      }
      throw error
    }
    const writes = await withNewVersions(resolved.writes, {
      hostRef,
      kinds,
      existing: site.existing,
    })
    const shaped = siteWritesToBundle(writes, kinds)
    /**
     * Dates come back as real `Timestamp`s before ANYTHING reads a field out of
     * the bundle (AGL-1392).
     *
     * A bundle carries dates as JSON, and `JSON.stringify` on an Admin
     * `Timestamp` emits its private `{_seconds, _nanoseconds}` — so a restore
     * used to write plain MAPS holding the right numbers in the wrong type.
     * `publishSchedule.publishAt <= now` is a range query and Firestore orders
     * by type before value, so a restored site kept every pending schedule and
     * fired none of them.
     *
     * Once, on the whole bundle the writes became, and before the cap checks:
     * they model the post-import state through the same documents, and a
     * check reading a different shape from the write is how the two drift.
     * The decoder accepts the tagged form the export now emits AND the legacy
     * `_seconds` envelope, because fixing the export cannot reach a bundle
     * already on a customer's disk.
     */
    const bundle: any = decodeBundleTimestamps({ ...shaped.bundle, host: shaped.hostPatch })

    const summary = {
      format,
      mode,
      warnings: resolved.warnings.slice(0, 200),
      warningsTotal: resolved.warnings.length,
      skipped: resolved.skipped.length,
      unknownKinds,
      notSent: notSent.map((item) => item.id),
    }

    if (action === 'plan') {
      /**
       * The plan writes nothing, and it says whether the import its proposed
       * decisions make would cross a cap — counted the way the apply counts
       * it, so only what the import ADDS is met against the plan. The apply
       * checks again, against the decisions actually made.
       */
      const screens = await screenCapRefusal({
        hostRef,
        routingMap: hostSnapshot.get('screens'),
        bundleRoutingMap: bundle.host?.screens,
        org: owningOrg?.org,
        bundleScreens: Array.isArray(bundle.screens) ? bundle.screens : [],
      })
      const resources = screens
        ? null
        : await resourceCapRefusal({
            hostRef,
            hostId,
            orgId: orgId ?? null,
            org: owningOrg?.org,
            sections: bundleSections,
            sectionItems: (one) => (Array.isArray(bundle[one.key]) ? bundle[one.key].slice(0, one.limit) : []),
            bundleItems: (name) =>
              Array.isArray(bundle[name]) ? bundle[name].slice(0, EXPORT_COLLECTION_LIMITS[name] ?? 100) : [],
          })
      const capRefusal = screens?.error ?? (resources ? String((await resources.json())?.error ?? '') : null)
      return Response.json({ ...summary, plan, capRefusal })
    }

    // The import's record, and the content of everything it replaces or
    // merges into, filed before the first write — after the cap checks, so a
    // refused import files nothing.
    const recordId = createResourceUid()
    const recordRef = packageImportRef(hostRef, recordId)
    const recordItems = writes.map((one) => ({
      key: one.key,
      kind: one.kind,
      targetId: one.targetId,
      decision: one.decision,
      ...(plan.items.find((item) => item.key === one.key)?.name
        ? { name: plan.items.find((item) => item.key === one.key)?.name }
        : {}),
    }))
    const counts: Record<string, number> = { skip: resolved.skipped.length }
    for (const one of writes) counts[one.decision] = (counts[one.decision] ?? 0) + 1
    const fileSource = format === 2 && typeof file?.manifest?.source === 'string' ? file.manifest.source : null
    let filed = false
    const result = await writeBundle(bundle, {
      capped: true,
      beforeWrites: async () => {
        filed = true
        const snapshots: Record<string, PackageImportSnapshot> = {}
        for (const one of writes) {
          if (!one.existingKey) continue
          const before = site.existing.find((item) => `${item.kind}/${item.id}` === one.existingKey)
          if (before) snapshots[one.existingKey] = { kind: before.kind, id: before.id, content: before.content }
        }
        const snapshotPieces = await writeLedgerPieces(firestore, recordRef, PACKAGE_IMPORT_SNAPSHOTS, snapshots)
        const record: PackageImportRecord = {
          status: 'applying',
          actorUid: decoded.uid,
          actorEmail: decoded.email ?? null,
          format,
          mode,
          source: fileSource,
          startedAtMs: Date.now(),
          items: recordItems,
          counts,
          snapshotPieces,
        }
        const opening = firestore.batch()
        opening.set(recordRef, {
          ...record,
          expiresAt: packageLedgerExpiry(record.startedAtMs),
          createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
        await opening.commit()
      },
    })
    if (result.ok === false) {
      // A refusal before the record was filed wrote nothing at all. The loser
      // of a race passed the pre-checks and filed its record; it is closed as
      // refused, with nothing written beneath it.
      if (!filed) return result.refusal
      const closing = firestore.batch()
      closing.set(recordRef, {
        status: 'refused',
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      await closing.commit().catch(() => undefined)
      return result.refusal
    }
    const { written, dataReport } = result

    // Each item's written paths, by item key, for undo to delete.
    const byBundleKey = new Map(
      writes.map((one) => [`${kinds.get(one.kind)?.bundleKey ?? one.kind}/${one.targetId}`, one.key]),
    )
    const writtenPaths: Record<string, string[]> = {}
    for (const [bundleKey, set] of result.paths) {
      const key = byBundleKey.get(bundleKey)
      if (key) writtenPaths[key] = [...set]
    }
    const writtenPieces = await writeLedgerPieces(firestore, recordRef, PACKAGE_IMPORT_WRITTEN_PATHS, writtenPaths)
    const appliedAtMs = Date.now()
    const closing = firestore.batch()
    closing.set(recordRef, {
      status: 'applied',
      appliedAtMs,
      expiresAtMs: appliedAtMs + PACKAGE_UNDO_WINDOW_MS,
      expiresAt: packageLedgerExpiry(appliedAtMs),
      writtenPieces,
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    await closing.commit()

    /**
     * A RESTORE REPLACES THE SITE, so every cached page of it is now wrong
     * (AGL-2573).
     *
     * The whole-host drop rather than a path list, for the reason
     * `revalidateEntireHost` exists: this route rewrites the routing map, the
     * screen documents, their versions, the layouts, the components and the
     * collections in one go, so "which pages changed" has no answer shorter
     * than "all of them". Without it a restored site served its previous
     * pages until each one's window lapsed — the worst version of this bug,
     * because the operator is watching for the old site to disappear and it
     * does not.
     *
     * Awaited, unlike the editor's fire-and-forget announcements: an import
     * is a deliberate, already-slow administrative action whose whole point
     * is that the site now reads differently, so it is worth the bounded 8s
     * to have it done before the response says the restore finished. Best
     * effort still — `revalidateEntireHost` never throws.
     */
    await revalidateEntireHost(firestore, hostId)

    await logActivity(
      mode === 'restore'
        ? `Restored site from export (${written} documents)`
        : `Imported a site package (${writes.length} items, ${written} documents)`,
    )
    await addAdminAudit(firestore, {
      actorUid: decoded.uid,
      actorEmail: decoded.email ?? null,
      action: 'site.package.apply',
      target: `hosts/${hostId}/${PACKAGE_IMPORTS_COLLECTION}/${recordId}`,
      before: null,
      after: { format, mode, counts },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => undefined)

    return Response.json({
      ...summary,
      importId: recordId,
      written,
      counts,
      // Truncated so pathological bundles can't balloon the response.
      dataReport: dataReport.slice(0, 100),
      dataReportTotal: dataReport.length,
    }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Import failed' }, { status: 500 })
  }
}

/**
 * A document by its full path — and only inside the trees an import owns:
 * the importing site's, and its organization's. Neither a section nor an
 * undo touches anything else, whatever a file or a ledger says.
 */
function ownedDocument(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  orgId: string | null | undefined,
  path: string,
): FirebaseFirestore.DocumentReference {
  const segments = path.split('/')
  const inside =
    (segments[0] === 'hosts' && segments[1] === hostId) ||
    (Boolean(orgId) && segments[0] === 'orgs' && segments[1] === orgId)
  if (!inside || segments.length % 2 || segments.length < 4 || segments.some((segment) => !segment)) {
    throw new Error(`hosts/import: a section may not write "${path}"`)
  }
  let ref: any = firestore
  for (let at = 0; at < segments.length; at += 2) {
    ref = ref.collection(segments[at]).doc(segments[at + 1])
  }
  return ref
}

/** The most items of each kind a package import writes, by the restore's caps. */
function sitePackageOverLimit(
  items: readonly SitePackageItem[],
  kinds: ReadonlyMap<string, SitePackageKind>,
): string[] {
  const perKey = new Map<string, number>()
  for (const item of items) {
    const key = kinds.get(item.kind)?.bundleKey ?? item.kind
    perKey.set(key, (perKey.get(key) ?? 0) + 1)
  }
  const sectionLimits = new Map(listDeclaredSiteBundleSections().map((one) => [one.key, one.limit]))
  const problems: string[] = []
  for (const [key, count] of perKey) {
    if (key === 'host') continue
    const limit = EXPORT_COLLECTION_LIMITS[key] ?? sectionLimits.get(key) ?? 100
    if (count > limit) problems.push(`The package carries ${count} ${key}; one import writes at most ${limit}.`)
  }
  return problems
}

/**
 * Replacing a page, a layout or a site email writes the incoming design as
 * a NEW version (AGL-3533): the version the site published stays in its
 * history, and the item points at the new one. A version id the site already
 * holds with the same design is written again as it is; a version id it holds
 * with a different design gets a new id, so no version the site has is ever
 * overwritten.
 */
async function withNewVersions(
  writes: readonly SitePackageWrite[],
  context: {
    hostRef: FirebaseFirestore.DocumentReference
    kinds: ReadonlyMap<string, SitePackageKind>
    existing: ReadonlyArray<{ kind: string; id: string; content: Record<string, any> }>
  },
): Promise<SitePackageWrite[]> {
  return Promise.all(
    writes.map(async (one) => {
      const kind = context.kinds.get(one.kind)
      const version = one.content['version'] as Record<string, any> | undefined
      if (one.decision !== 'replace' || !kind?.versioned || !version?.['$id']) return one
      const versionId = String(version['$id'])
      const before = context.existing.find((item) => `${item.kind}/${item.id}` === one.existingKey)
      let current: Record<string, any> | null = null
      if (before?.content?.['version']?.['$id'] === versionId) {
        current = before.content['version']
      } else {
        const snapshot = await context.hostRef
          .collection(kind.bundleKey)
          .doc(one.targetId)
          .collection('versions')
          .doc(versionId)
          .get()
        if (snapshot.exists) {
          const data = snapshot.data() ?? {}
          current = encodeBundleTimestamps({ $id: versionId, ...data, ...readableNodes(data) })
        }
      }
      if (!current) return one
      if ((await siteVersionHash(kind.bundleKey, current)) === (await siteVersionHash(kind.bundleKey, version))) {
        return one
      }
      const fresh = createResourceUid()
      return {
        ...one,
        content: { ...one.content, versionId: fresh, version: { ...version, $id: fresh } },
      }
    }),
  )
}

/** What undoing one item does. */
type UndoStep = 'restore' | 'delete'

/**
 * Undoes an import (AGL-3533): `undoPlan` says what it would do, writing
 * nothing; `undo` does it. An item the import replaced or merged into is
 * written back as it was, through the restore's own writers; an item it
 * created is deleted, with everything it wrote beneath it. An item edited
 * since the import — a document of it updated after the import finished —
 * is a conflict, left as it is unless the person says `revert`.
 */
async function undoImport(input: {
  action: 'undoPlan' | 'undo'
  importId: string
  body: any
  firestore: FirebaseFirestore.Firestore
  hostRef: FirebaseFirestore.DocumentReference
  hostId: string
  orgId: string | null
  uid: string
  email: string | null
  kinds: ReadonlyMap<string, SitePackageKind>
  readContext: Parameters<typeof readSiteAsPackage>[0]
  writeBundle: (
    bundle: any,
    options: { capped: boolean },
  ) => Promise<{ ok: false; refusal: Response } | { ok: true; written: number; paths: Map<string, Set<string>> }>
  logActivity: (text: string) => Promise<unknown>
}): Promise<Response> {
  const { firestore, hostRef, hostId, kinds } = input
  const recordRef = packageImportRef(hostRef, input.importId)
  const snapshot = await recordRef.get()
  if (!snapshot.exists) return Response.json({ error: 'No such import on this site' }, { status: 404 })
  const record = snapshot.data() as PackageImportRecord
  const now = Date.now()
  if (!packageImportUndoable(record, now)) {
    return Response.json(
      { error: record.status === 'undone' ? 'This import has been undone' : 'This import can no longer be undone' },
      { status: 409 },
    )
  }
  const appliedAtMs = record.appliedAtMs as number
  const snapshots = await readLedgerPieces<Record<string, PackageImportSnapshot>>(
    recordRef,
    PACKAGE_IMPORT_SNAPSHOTS,
    record.snapshotPieces,
  )
  const writtenPaths = await readLedgerPieces<Record<string, string[]>>(
    recordRef,
    PACKAGE_IMPORT_WRITTEN_PATHS,
    record.writtenPieces ?? 1,
  )
  const site = await readSiteAsPackage(input.readContext, kinds)
  const current = new Map(site.existing.map((item) => [`${item.kind}/${item.id}`, item]))
  const undone = new Set(record.undoneItems ?? [])
  const steps = record.items.filter((item) => !undone.has(item.key)).map((item) => {
    const targetKey = `${item.kind}/${item.targetId}`
    const previous = snapshots[targetKey] ?? null
    const now = current.get(targetKey)
    const updatedAt = wireMillis(now?.content?.['updatedAt'])
    const editedSince = updatedAt !== null && updatedAt > appliedAtMs + UNDO_EDIT_GRACE_MS
    const step: UndoStep = previous ? 'restore' : 'delete'
    return { item, targetKey, previous, step, conflict: editedSince }
  })
  const summary = {
    restore: steps.filter((one) => one.step === 'restore').length,
    delete: steps.filter((one) => one.step === 'delete').length,
    conflict: steps.filter((one) => one.conflict).length,
  }
  const conflicts = steps
    .filter((one) => one.conflict)
    .map((one) => ({ key: one.item.key, kind: one.item.kind, targetId: one.item.targetId, name: one.item.name, step: one.step }))
  if (input.action === 'undoPlan') {
    return Response.json({ importId: input.importId, counts: summary, conflicts })
  }

  const decisions: Record<string, string> = input.body?.decisions ?? {}
  const otherwise = input.body?.otherwise === 'revert' ? 'revert' : 'keep'
  const reverting = steps.filter((one) => !one.conflict || (decisions[one.item.key] ?? otherwise) === 'revert')

  // Back as they were, through the restore's own writers.
  const restores: SitePackageWrite[] = reverting
    .filter((one) => one.previous)
    .map((one) => ({
      key: one.targetKey,
      kind: one.item.kind,
      sourceId: one.item.targetId,
      targetId: one.item.targetId,
      decision: 'replace',
      content: (one.previous as PackageImportSnapshot).content,
    }))
  const shaped = siteWritesToBundle(restores, kinds)
  const hostDeletes: string[] = []
  const routeDeletes: string[] = []
  for (const one of reverting) {
    const kind = kinds.get(one.item.kind)
    if (kind?.singletonId) {
      const fields = kind.kind === 'theme' ? SITE_THEME_FIELDS : SITE_SETTINGS_FIELDS
      const before = one.previous?.content ?? {}
      for (const field of fields) if (before[field] === undefined) hostDeletes.push(field)
    } else if (kind?.bundleKey === 'screens' && typeof one.previous?.content?.['route'] !== 'string') {
      routeDeletes.push(one.item.targetId)
    }
  }
  const bundle = decodeBundleTimestamps({
    ...shaped.bundle,
    host: shaped.hostPatch,
    hostDeletes,
    routeDeletes,
  })
  const result = await input.writeBundle(bundle, { capped: false })
  if (result.ok === false) return result.refusal

  // Then everything the import wrote that the undo did not write back.
  const rewritten = new Set<string>()
  for (const set of result.paths.values()) for (const path of set) rewritten.add(path)
  const deletes = reverting.flatMap((one) => (writtenPaths[one.item.key] ?? []).filter((path) => !rewritten.has(path)))
  for (let at = 0; at < deletes.length; at += 400) {
    const batch = firestore.batch()
    for (const path of deletes.slice(at, at + 400)) batch.delete(ownedDocument(firestore, hostId, input.orgId, path))
    await batch.commit()
  }

  const kept = steps.length - reverting.length
  const closing = firestore.batch()
  closing.set(recordRef, {
    status: kept ? 'applied' : 'undone',
    undoneAtMs: now,
    undoneItems: [...undone, ...reverting.map((one) => one.item.key)],
    updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  await closing.commit()

  await revalidateEntireHost(firestore, hostId)
  await input.logActivity(`Undid a site package import (${reverting.length} items)`)
  await addAdminAudit(firestore, {
    actorUid: input.uid,
    actorEmail: input.email,
    action: 'site.package.undo',
    target: `hosts/${hostId}/${PACKAGE_IMPORTS_COLLECTION}/${input.importId}`,
    before: null,
    after: { reverted: reverting.length, kept, deleted: deletes.length },
    at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => undefined)

  return Response.json({
    importId: input.importId,
    reverted: reverting.length,
    kept,
    restoredDocuments: result.written,
    deletedDocuments: deletes.length,
  })
}

export const dynamic = 'force-dynamic'
export { handler as POST }
