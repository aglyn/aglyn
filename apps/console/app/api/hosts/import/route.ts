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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  decodeStoredNodes,
  effectiveDatasetModel,
  hostScopeToken,
  legacyCollectionKind,
  nameSearchKey,
  newResourceScopeFields,
  NON_PAGE_SCREEN_MAX_PER_HOST,
  resolveOrgEntitlements,
  rewriteBindingTokensDeep,
  screenClaimsToBeAPage,
  validateDocument,
} from '@aglyn/aglyn/server'
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
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
} from '../../_lib/site-export'
import { decodeBundleTimestamps } from '../../_lib/bundle-timestamps'
import {
  billableScreenIds,
  type BillableScreenSource,
  nonPageScreenIds,
} from '../resources/count-billable-screens'

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
  clean['updatedAt'] = firebaseAdmin.firestore.FieldValue.serverTimestamp()
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
}): Promise<Response | null> {
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
  const screensSnapshot = await hostRef
    .collection('screens')
    .select('kind', 'deletedAt')
    .get()

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
  // follows for datasets).
  if (Number.isFinite(limit)) {
    const prior = billableScreenIds([...priorScreens.values()], routingMap as any)
    const next = billableScreenIds([...nextScreens.values()], nextRoutingMap)
    if (next.size > prior.size && next.size > limit) {
      return Response.json({
        error:
          `This backup holds ${bundleScreens.length} screens and this site has ` +
          `${prior.size}, which would put it at ${next.size} of ${limit} ` +
          'screens. Nothing was imported — upgrade in Billing, or restore into ' +
          'a site with room.',
      }, { status: 403 })
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
      return Response.json({
        error:
          `This backup holds ${bundleScreens.length} screens and this site ` +
          `has ${prior.size} email and template screens, which would put it ` +
          `at ${next.size} of ${NON_PAGE_SCREEN_MAX_PER_HOST}. Nothing was ` +
          'imported — delete some, or restore into a site with room.',
      }, { status: 403 })
    }
  }

  return null
}

/**
 * The bundle collections that land in the HOST and carry a numeric plan cap,
 * paired with the quota key `/api/hosts/resources` already enforces them on
 * (AGL-1403).
 *
 * A table rather than five checks because the arithmetic really is the same
 * for all of them: unlike screens these have no exclusion rule, so the state an
 * import would leave is just `|existing ids ∪ bundle ids|`. The mapping is the
 * only thing worth writing down, and writing it down is what makes the gap
 * visible: this file named no quota key at all before AGL-1398, and the check
 * that landed then reads `screensPerHost` off `resolveOrgEntitlements`, so
 * `checkQuota` arrives here for the first time with this table. A cap nothing
 * in the file mentions is a cap nobody reviewing the file can notice is
 * missing.
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
 * * `actions` — no `RESOURCES` entry and no quota key anywhere; all three
 *   creators write the document client-direct.
 * * `collections`/`entries` — uncapped by design; AGL-1387 declined
 *   `collectionsPerHost` and this is not the issue that re-opens it.
 * * `components` — `reusableComponents` is a BOOLEAN entitlement, true on
 *   every plan that can reach here. There is no number to compare against.
 * * `media` — the meter is bytes at upload, and an import copies no bytes.
 */
const CAPPED_HOST_COLLECTIONS = [
  { collection: 'workflows', quotaKey: 'workflowsPerHost', label: 'workflows' },
  { collection: 'functions', quotaKey: 'functionsPerHost', label: 'functions' },
  { collection: 'variables', quotaKey: 'variablesPerHost', label: 'variables' },
  {
    collection: 'layouts',
    quotaKey: 'sharedLayoutsPerHost',
    label: 'shared layouts',
  },
  { collection: 'services', quotaKey: 'servicesPerHost', label: 'services' },
] as const

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
 * This route creates eleven other document classes and checked the quota of
 * none of them. Against Pro, the cheapest plan that can import: `workflows` 100
 * against 25, `functions` 100 against 50, `datasets` 50 against 15 included,
 * and `variables` 100 against 100 — where the caps merely TIE, so it crosses on
 * whatever the site already holds and no check that reads the file alone can
 * see it.
 *
 * ## Datasets lead, because they are the only leg that leaks revenue
 *
 * The others under-meter. Datasets are SOLD — `extraDatasetMonthlyUsd`, org
 * addons on top of the plan's included count — and the import writes them
 * straight to `orgs/{orgId}/datasets/…`, past `/api/orgs/datasets`. There are
 * three create paths for a dataset and this was the only one calling nothing:
 * the console's own route and the marketplace's `installDatasetSchema` both
 * call `checkDatasetQuota`, and the installer's comment already says why —
 * "installing must not be a way around it". A 50-dataset bundle lands a Pro org
 * at its 50-dataset HARD MAXIMUM, unpaid, in one button press.
 *
 * So datasets are checked first and their refusal is the one a bundle
 * busting several caps reports: a restore blocked four times running is worse
 * than one blocked once, and the arithmetic worth naming is the one with a
 * price on it.
 *
 * `checkDatasetQuota` decides, not `checkQuota(org, 'datasetsPerOrg')`. An org
 * that has PAID for extra datasets is entitled to them, and comparing against
 * the plan's included number would refuse a customer their own backup after
 * taking their money for the room to hold it. The escape the refusal names
 * comes from the same helper: addons while `upgradeRequired` is false,
 * upgrading once the addon runway is gone.
 *
 * ## Restore vs copy, when the resource is not host-scoped
 *
 * AGL-1398 identified a restore by document-id COLLISION rather than by the
 * bundle's `sourceHostId`, which is an unsigned string in a file the metered
 * party uploads. The collision argument transfers, but the sentence a collision
 * proves changes with the scope of the METER, and datasets are the case where
 * that matters:
 *
 * * host-scoped rows above — a collision means this SITE already holds the
 *   document, exactly as for screens;
 * * datasets — a collision means this WORKSPACE already holds the dataset.
 *
 * The org boundary is the right one here, and not a weaker version of the host
 * one, because the meter is per-org. Restoring a bundle into a SIBLING host of
 * the same workspace rewrites the same dataset documents the org is already
 * paying for — all it changes is `visibleTo`, from one host scope to another —
 * so it provisions nothing and raises nothing. A copy into a different
 * workspace collides on nothing and provisions all of them, and is refused when
 * it lands that workspace over. An id-collision test keyed on the HOST would
 * have refused the first of those, which is half of what the feature is for.
 *
 * The forgery direction is unchanged: to reach the allow path the bundle's
 * datasets must already be in the workspace, which is to say already bought,
 * and renaming them to ids the workspace holds OVERWRITES those datasets
 * instead of adding any.
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
  /** The owning org's `datasets` collection, or null for a host with no org. */
  datasetsRef: FirebaseFirestore.CollectionReference | null
  org: unknown
  bundleItems: (name: string) => Array<Record<string, any>>
}): Promise<Response | null> {
  // Datasets lead. One refusal covers the bundle, and when several caps are
  // crossed at once the one worth naming is the one with a price on it.
  return (await datasetCapRefusal(options)) ?? (await hostCapRefusal(options))
}

/** The org-scoped leg (`orgs/{orgId}/datasets`), addon-aware. */
async function datasetCapRefusal(options: {
  datasetsRef: FirebaseFirestore.CollectionReference | null
  org: unknown
  bundleItems: (name: string) => Array<Record<string, any>>
}): Promise<Response | null> {
  const { datasetsRef, org, bundleItems } = options
  // `importDatasets` returns early without an org id, so a host with no owning
  // org writes none and can raise nothing.
  const bundleDatasets = bundleDocIds(bundleItems('datasets'))
  if (!datasetsRef || !bundleDatasets.size) return null
  if (!Number.isFinite(checkDatasetQuota(org as any, 0).limit)) return null

  const existing = await existingDocIds(datasetsRef)
  const next = new Set([...existing, ...bundleDatasets]).size
  // `allowed` asks "may I add one more to N", so the post state N is checked as
  // `N - 1` — the idiom `/api/orgs/datasets` uses for its own bulk path
  // (`import-records`).
  const quota = checkDatasetQuota(org as any, next - 1)
  if (next <= existing.size || quota.allowed) return null

  return Response.json({
    error:
      `This backup holds ${bundleDatasets.size} datasets and this workspace ` +
      `has ${existing.size}, which would put it at ${next} of ${quota.limit} ` +
      'datasets. Nothing was imported — ' +
      (quota.upgradeRequired
        ? 'upgrade in Billing.'
        : `add extra datasets for $${quota.addonPriceUsd}/mo each, or ` +
          'upgrade in Billing.'),
  }, { status: 403 })
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
  return null
}

/**
 * Whole-site restore/import (AGL-163): writes an export bundle into the
 * target host — additive-by-id (docs keep their export ids, so the
 * routing map, screen links, and layout references keep resolving; a
 * restore into the source host is an exact overwrite). Host identity
 * (subdomain/admins/tenant/domain) never changes; PII collections aren't
 * in bundles by design. Pro+ (`siteExport` flag), host-admin only.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  let bundle = body?.bundle
  if (!hostId || typeof bundle !== 'object' || bundle === null) {
    return Response.json({ error: 'Missing hostId or bundle' }, { status: 400 })
  }
  if (
    bundle.format !== SITE_EXPORT_FORMAT ||
    Number(bundle.version) > SITE_EXPORT_VERSION
  ) {
    return Response.json({
      error: 'Not an Aglyn site export (or a newer format than this build)',
    }, { status: 422 })
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
    // datasets and media restore into the org, not the host (AGL-1046).
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
     * Once, on the whole bundle, and here rather than inside `cleanDoc`: the
     * cap checks below model the post-import state through the same documents,
     * and a check reading a different shape from the write is how the two drift.
     * The decoder accepts the tagged form the export now emits AND the legacy
     * `_seconds` envelope, because fixing the export cannot reach a bundle
     * already on a customer's disk.
     */
    bundle = decodeBundleTimestamps(bundle)

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

    // Before the first write, because a half-restored site is worse than a
    // refused one (AGL-1398).
    const overCap = await screenCapRefusal({
      hostRef,
      routingMap: hostSnapshot.get('screens'),
      bundleRoutingMap: bundle.host?.screens,
      org: owningOrg?.org,
      bundleScreens: bundleItems('screens'),
    })
    if (overCap) return overCap

    // And every OTHER numeric cap this route creates against (AGL-1403) —
    // datasets first, because they are the one sold as an addon.
    const overResourceCap = await resourceCapRefusal({
      hostRef,
      datasetsRef: orgId
        ? firestore.collection('orgs').doc(orgId).collection('datasets')
        : null,
      org: owningOrg?.org,
      bundleItems,
    })
    if (overResourceCap) return overResourceCap

    let written = 0
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
      written += 1
      if ((batched += 1) >= 400) await commit()
    }

    // Host settings — exportable fields only.
    const hostPatch: Record<string, unknown> = {}
    for (const field of EXPORTABLE_HOST_FIELDS) {
      if (bundle.host?.[field] !== undefined) {
        hostPatch[field] = bundle.host[field]
      }
    }
    if (Object.keys(hostPatch).length) {
      batch.set(hostRef, hostPatch, { merge: true })
      batched += 1
    }

    const importPlain = async (name: string) => {
      for (const item of bundleItems(name)) {
        if (!item?.$id) continue
        await write(
          hostRef.collection(name).doc(String(item.$id)),
          cleanDoc(name, item),
        )
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

    // Screens/layouts restore the doc plus its published version.
    const importVersioned = async (name: 'screens' | 'layouts') => {
      for (const item of bundleItems(name)) {
        if (!item?.$id) continue
        const docRef = hostRef.collection(name).doc(String(item.$id))
        const cleaned = cleanDoc(name, item)
        // Re-derive the name-search key on restore (AGL-835) — bundles may
        // predate the field, and only screens are queried by name.
        if (name === 'screens' && typeof cleaned['displayName'] === 'string') {
          cleaned['nameLower'] = nameSearchKey(cleaned['displayName'] as string)
        }
        await write(docRef, cleaned)
        if (item.version?.$id) {
          const version = cleanDoc('versions', item.version)
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
           * It lands as a PLAIN MAP rather than being re-encoded to `Bytes`:
           * both forms are live and every reader handles both, so old and new
           * bundles converge on one restored shape instead of two, and the
           * besigner re-compresses on the next save anyway.
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
            const decoded = decodeStoredNodes(version[key]) ?? version[key]
            version[key] = rewriteBindingTokensDeep(
              decoded,
              bundleVariables,
              bundleFunctions,
            ).value
          }
          await write(
            docRef.collection('versions').doc(String(item.version.$id)),
            version,
          )
        }
      }
    }

    const importCollections = async () => {
      for (const item of bundleItems('collections')) {
        if (!item?.$id) continue
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
          await write(
            docRef.collection('entries').doc(String(entry.$id)),
            cleanDoc('entries', entry),
          )
        }
      }
    }

    // Non-conforming rows are imported AND reported (AGL-182) — data is
    // never silently dropped; the report tells the owner what to fix.
    const dataReport: Array<{
      datasetId: string
      recordId: string
      errors: Record<string, string>
    }> = []
    /**
     * Datasets and media restore into the OWNING ORG (AGL-237), scoped to
     * the importing site (AGL-1046). They used to be written to
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
    const orgScopedRef = (
      name: 'datasets' | 'media' | 'mediaFolders',
      id: string,
    ) =>
      firestore.collection('orgs').doc(orgId as string).collection(name).doc(id)
    // Through the AGL-1478 gate since AGL-1484. A restore CREATES documents
    // in three scoped collections — `datasets`, `media`, `mediaFolders` —
    // and it was the one dataset creator missing from
    // `scoped-create-coverage.spec.ts` entirely, because it is spelled as a
    // restore rather than as a create.
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
        const cleaned = cleanDoc(name, item)
        if (pointer in cleaned) {
          cleaned[pointer] = resolvedFolderPointer(cleaned[pointer], resolvable)
        }
        await write(hostRef.collection(name).doc(String(item.$id)), cleaned)
      }
    }

    const importDatasets = async () => {
      if (!orgId) return
      for (const item of bundleItems('datasets')) {
        if (!item?.$id) continue
        const docRef = orgScopedRef('datasets', String(item.$id))
        await write(docRef, { ...cleanDoc('datasets', item), ...importedScope })
        // v1 exports (no model) validate through the derived text model,
        // same as the live migration — everything passes, by design.
        const model = effectiveDatasetModel(item)
        const records: any[] = Array.isArray(item.records) ? item.records : []
        for (const record of records.slice(0, 1000)) {
          if (!record?.$id) continue
          const errors = validateDocument(model, record.values ?? {})
          if (Object.keys(errors).length) {
            dataReport.push({
              datasetId: String(item.$id),
              recordId: String(record.$id),
              errors,
            })
          }
          await write(
            docRef.collection('records').doc(String(record.$id)),
            cleanDoc('records', record),
          )
        }
      }
    }

    await importVersioned('screens')
    await importVersioned('layouts')
    await importPlain('components')
    await importPlain('variables')
    await importPlain('functions')
    await importPlain('workflows')
    await importPlain('actions')
    await importPlain('services')
    // Folders before assets: the tree has to exist before anything points into
    // it, and both reads resolve against the same id set (AGL-1392).
    await importMediaFolders()
    await importOrgPlain('media')
    // The site's own library, same rule one scope over (AGL-1392).
    await importHostLibrary('mediaFolders')
    await importHostLibrary('media')
    await importCollections()
    await importDatasets()
    await commit()

    await hostRef
      .collection('activity')
      .add({
        actorId: decoded.uid,
        actorEmail: decoded.email ?? null,
        action: `Restored site from export (${written} documents)`,
        target: { type: 'host', id: hostId },
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json({
      written,
      // Truncated so pathological bundles can't balloon the response.
      dataReport: dataReport.slice(0, 100),
      dataReportTotal: dataReport.length,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Import failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
