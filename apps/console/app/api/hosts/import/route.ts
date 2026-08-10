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
  checkEntitlement,
  decodeStoredNodes,
  effectiveDatasetModel,
  hostScopeToken,
  legacyCollectionKind,
  nameSearchKey,
  resolveOrgEntitlements,
  rewriteBindingTokensDeep,
  validateDocument,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  EXPORT_COLLECTION_LIMITS,
  EXPORTABLE_HOST_FIELDS,
  IMPORTABLE_FIELDS,
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
} from '../../_lib/site-export'
import {
  billableScreenIds,
  type BillableScreenSource,
} from '../resources/count-billable-screens'
import {
  COLLECTION_TEMPLATE_SCREEN_FIELDS,
  type CollectionTemplateSource,
} from '../../../../constants/collection-templates'

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
 * Nothing is re-priced. `billableScreenIds` decides which screens spend the
 * allowance, exactly as it does at the other two enforcement points — AGL-1173,
 * AGL-1383, AGL-1387 and AGL-1390 each declined to change what counts, and this
 * is not the issue that gets to either.
 */
async function screenCapRefusal(options: {
  hostRef: FirebaseFirestore.DocumentReference
  /** The host's current `screens` routing map. */
  routingMap: unknown
  /** The map the bundle's host settings carry, merged over it below. */
  bundleRoutingMap: unknown
  org: unknown
  bundleScreens: Array<Record<string, any>>
  bundleCollections: Array<Record<string, any>>
}): Promise<Response | null> {
  const { hostRef, routingMap, bundleRoutingMap, org } = options
  const limit = resolveOrgEntitlements(org as any).screensPerHost
  // Unlimited plans skip the two reads outright — most orgs entitled to
  // `siteExport` are on one, and a cap that cannot be exceeded needs no count.
  if (!Number.isFinite(limit)) return null

  const [screensSnapshot, collectionsSnapshot] = await Promise.all([
    hostRef.collection('screens').select('kind', 'deletedAt').get(),
    hostRef
      .collection('collections')
      .select('slug', 'kind', ...COLLECTION_TEMPLATE_SCREEN_FIELDS)
      .get(),
  ])

  const priorScreens = new Map<string, BillableScreenSource>(
    screensSnapshot.docs.map((screen) => [
      screen.id,
      { id: screen.id, kind: screen.get('kind'), deletedAt: screen.get('deletedAt') },
    ]),
  )
  const priorCollections = new Map<string, CollectionTemplateSource>(
    collectionsSnapshot.docs.map((row) => [
      row.id,
      {
        slug: row.get('slug'),
        kind: row.get('kind'),
        listScreenId: row.get('listScreenId'),
        entryScreenId: row.get('entryScreenId'),
        templateScreenId: row.get('templateScreenId'),
      },
    ]),
  )

  // The state the import WOULD leave: the bundle's documents keyed by their
  // export ids, so a document the host already has is replaced and not added.
  const nextScreens = new Map(priorScreens)
  let bundleScreenCount = 0
  for (const item of options.bundleScreens) {
    if (!item?.$id) continue
    const id = String(item.$id)
    const stored = cleanDoc('screens', item)
    nextScreens.set(id, {
      id,
      kind: stored['kind'],
      deletedAt: stored['deletedAt'],
    })
    bundleScreenCount += 1
  }
  const nextCollections = new Map(priorCollections)
  for (const item of options.bundleCollections) {
    if (!item?.$id) continue
    const stored = cleanDoc('collections', item)
    nextCollections.set(String(item.$id), {
      slug: stored['slug'],
      // What `importCollections` stores, inferred for bundles that predate the
      // discriminator (AGL-979) — a catalog collection excuses no list template.
      kind: legacyCollectionKind(stored),
      listScreenId: stored['listScreenId'],
      entryScreenId: stored['entryScreenId'],
      templateScreenId: stored['templateScreenId'],
    })
  }

  const prior = billableScreenIds(
    [...priorScreens.values()],
    [...priorCollections.values()],
    routingMap as any,
  )
  const next = billableScreenIds(
    [...nextScreens.values()],
    [...nextCollections.values()],
    // The host patch is written with `merge: true`, which deep-merges a map
    // field, so the restored routing map is the union rather than the bundle's.
    {
      ...((routingMap as Record<string, unknown>) ?? {}),
      ...(bundleRoutingMap && typeof bundleRoutingMap === 'object'
        ? (bundleRoutingMap as Record<string, unknown>)
        : {}),
    },
  )
  if (next.size <= prior.size || next.size <= limit) return null

  return Response.json({
    error:
      `This backup holds ${bundleScreenCount} screens and this site has ` +
      `${prior.size}, which would put it at ${next.size} of ${limit} ` +
      'screens. Nothing was imported — upgrade in Billing, or restore into a ' +
      'site with room.',
  }, { status: 403 })
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
  const bundle = body?.bundle
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
    if (!checkEntitlement(owningOrg?.org as any, 'siteExport')) {
      return Response.json({ error: 'Site restore requires a Pro plan' }, { status: 403 })
    }

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
      bundleCollections: bundleItems('collections'),
    })
    if (overCap) return overCap

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
    const orgScopedRef = (name: 'datasets' | 'media', id: string) =>
      firestore.collection('orgs').doc(orgId as string).collection(name).doc(id)
    const importedScope = { visibleTo: [hostScopeToken(hostId)] }

    const importOrgPlain = async (name: 'media') => {
      if (!orgId) return
      for (const item of bundleItems(name)) {
        if (!item?.$id) continue
        await write(orgScopedRef(name, String(item.$id)), {
          ...cleanDoc(name, item),
          ...importedScope,
        })
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
    await importOrgPlain('media')
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
