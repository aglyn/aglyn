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
  checkDatasetQuota,
  checkEntitlement,
  createResourceUid,
  defaultScopeForNewResource,
  visibleToHost,
} from '@aglyn/aglyn/server'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  listingArtifactType,
  resolveInstalledDatasetSchema,
} from '../model/marketplace'
import { canActAsPublisher } from './publisher-profile'
import { recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'

/**
 * Installs a marketplace dataset schema into an org (AGL-657).
 *
 * Creates a NEW, EMPTY dataset from the published model — installing never
 * merges into an existing dataset, because a schema change on a dataset that
 * already holds rows would silently reinterpret live data. Re-installing makes
 * another dataset rather than replacing one, for the same reason.
 *
 * Accepts either `orgId` or a `hostId` to derive it, so the shared install
 * hook (which is host-oriented) works unchanged.
 */
export const installDatasetSchemaHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  const bodyOrgId = String(req.body?.orgId ?? '')
  if (!listingId || (!hostId && !bodyOrgId)) {
    return res.status(400).json({ error: 'Missing listingId or orgId' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const orgId =
      bodyOrgId || (hostId ? ((await getOrgForHost(hostId))?.orgId ?? '') : '')
    if (!orgId) {
      return res.status(404).json({ error: 'Site has no owning organization' })
    }
    const membership = await resolveOrgPermissions(decoded.uid, { orgId })
    if (membership.orgId !== orgId || !membership.permissions.installPlugins) {
      return res.status(403).json({
        error:
          'Your organization role does not allow installing from the marketplace',
      })
    }
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown organization' })
    }
    const org = orgSnapshot.data() as any
    if (!checkEntitlement(org, 'dataStore')) {
      return res
        .status(403)
        .json({ error: 'Datasets require a Starter plan or higher' })
    }

    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (
      !listing ||
      listing.deletedAt ||
      listingArtifactType(listing) !== 'datasetSchema'
    ) {
      return res.status(404).json({ error: 'Unknown dataset schema' })
    }

    const priceUsd = Number(listing.priceUsd ?? 0)
    const ownsListing = await canActAsPublisher(
      firestore,
      decoded.uid,
      listing.profileId,
    )
    if (priceUsd > 0 && !ownsListing) {
      const purchases = await firestore
        .collection('marketplacePurchases')
        .where('buyerUid', '==', decoded.uid)
        .where('listingId', '==', listingId)
        .limit(1)
        .get()
      if (purchases.empty) {
        return res.status(402).json({ error: 'Purchase required', priceUsd })
      }
    }

    const versionSnapshot = await listingRef
      .collection('versions')
      .doc(String(listing.latestVersion))
      .get()
    const published = versionSnapshot.get('datasetSchema') as any
    if (!published?.order?.length) {
      return res.status(500).json({ error: 'Dataset schema version missing' })
    }

    // Creating a dataset consumes org quota exactly like the console's own
    // create path (AGL-473) — installing must not be a way around it.
    // Deliberately counts EVERY dataset the org owns, not the visible ones
    // (AGL-1046). Scoping decides who can see a dataset, never who pays for
    // it — the org owns all of them. Counting per scope would also make a
    // collaborator's remaining quota disagree with the admin's.
    const datasets = await orgRef.collection('datasets').get()
    const quota = checkDatasetQuota(org, datasets.size)
    if (!quota.allowed) {
      return res.status(403).json({
        error: `Dataset limit reached (${quota.limit}) — see Billing to upgrade.`,
      })
    }

    // Relink reference fields onto this org's datasets by display name; what
    // can't be relinked degrades to text and is reported to the installer.
    // Only datasets visible in the INSTALL's scope are relink candidates
    // (AGL-1046). Matching against every dataset the org owns would let an
    // install into a client site silently bind its reference fields to the
    // agency's internal dataset of the same name — the display-name
    // collision AGL-1039 fixed on the render path, arriving here instead.
    // An org-context install (no host) sees them all, as its installer does.
    const byLabel: Record<string, string> = {}
    for (const entry of datasets.docs) {
      if (hostId && !visibleToHost(entry.get('visibleTo'), hostId)) continue
      const label = String(entry.get('displayName') ?? '').toLowerCase()
      if (label && !byLabel[label]) byLabel[label] = entry.id
    }
    const { schema, degradedFieldIds } = resolveInstalledDatasetSchema(
      published,
      byLabel,
    )

    const datasetId = createResourceUid()
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    // Provenance + base snapshot (AGL-1015). The RELINKED schema, not the
    // published one: relinking rewrites reference fields onto this org's
    // datasets, so a base holding the publisher's ids would report every
    // relinked field as a user edit the moment anything is diffed.
    const provenance = await recordInstallProvenance({
      firestore,
      listingId,
      listing,
      version: listing.latestVersion,
      artifactType: 'datasetSchema',
      content: schema,
    })
    await orgRef
      .collection('datasets')
      .doc(datasetId)
      .create({
        displayName: String(listing.displayName ?? 'Dataset').slice(0, 120),
        ...(listing.description && { description: listing.description }),
        // `fields` is the v1 flat list the older editor still reads; keep it in
        // step with the model so both readers agree (AGL-102).
        fields: schema.order,
        model: schema,
        source: {
          type: 'marketplace' as const,
          listingId,
          version: listing.latestVersion ?? null,
        },
        installedFrom: provenance.installedFrom,
        // Scoped like every other dataset creator (AGL-1046): the org's
        // default, applied to the site the install came from. Stamping it
        // is not optional — a dataset with no `visibleTo` matches no scoped
        // read and would render on no site at all.
        visibleTo: defaultScopeForNewResource({
          defaultResourceScope: org?.defaultResourceScope,
          hostId,
        }),
        createdAt: now,
      })

    // Per-version tally (AGL-1036). Installing a schema always CREATES a new
    // dataset rather than replacing one, so there is never a version to leave.
    await recordVersionMove({
      firestore,
      listingRef,
      artifactType: 'datasetSchema',
      to: listing.latestVersion,
    })
    await listingRef
      .update({
        installCount: firebaseAdmin.firestore.FieldValue.increment(1),
      })
      .catch(() => undefined)

    return res.status(200).json({
      installed: true,
      datasetId,
      fields: schema.order.length,
      degradedFieldIds,
      version: listing.latestVersion ?? null,
      baseStored: provenance.baseStored,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Dataset schema install failed' })
  }
}

export default installDatasetSchemaHandler
