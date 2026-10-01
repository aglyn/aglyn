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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { isPrivateListing, listingArtifactType } from '../model/marketplace'
import { artifactTypeOwnerOrRefusal, marketplaceInstallStamp } from './artifact-owner'
import { canActAsPublisher } from './publisher-profile'
import { requirePurchase } from './purchase-entitlement'
import { recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'
import { isPublisherSecurityLocked } from './sale-risk'

/**
 * Installs a marketplace dataset schema into an org (AGL-657).
 *
 * The install makes a NEW, EMPTY dataset from the published model, and a
 * dataset is the data plugin's (AGL-3080). So this door keeps what is the
 * marketplace's (who may install, the listing and its gates, the purchase,
 * the provenance stamp and the tally) and asks the plugin that keeps the
 * `datasetSchema` type for the rest: whether the org's plan holds datasets,
 * whether the version can land and within what quota, and the write itself
 * (`plugin-manager/plugin-artifact-types`). It never reads the datasets
 * collection.
 *
 * Accepts either `orgId` or a `hostId` to derive it, so the shared install
 * hook (which is host-oriented) works unchanged. The site is ONLY that: a way
 * to find the org. It never reaches the owner, so it is never the site the
 * dataset is shared with (AGL-2891).
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
    // The plugin that keeps the copies, asked before anything is read or
    // written: with none, the install refuses whole.
    const owned = await artifactTypeOwnerOrRefusal('datasetSchema')
    if (owned.ok === false) return res.status(owned.status).json({ error: owned.error })
    const { owner } = owned
    const inadmissible = await owner.admits({ orgId, org })
    if (inadmissible) {
      return res.status(inadmissible.status).json({ error: inadmissible.error })
    }

    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (
      !listing ||
      listing.deletedAt ||
      // Staff takedown blocks new installs on EVERY artifact type
      // (AGL-2290). AGL-948 extended takedown past plugins in the browse
      // predicate and in `resolveMarketplacePluginVersion`, but the gate that
      // decides whether content is HANDED OVER was only ever added to
      // `install-plugin.ts`. So a component, theme, template, layout, email
      // template or dataset schema that staff had taken down stayed
      // installable by anyone holding its listing id — which makes takedown a
      // suggestion for six of the seven artifact types.
      //
      // No owner exemption, matching `install-plugin.ts`: a takedown is a
      // moderation decision about the artifact, not about who is asking.
      listing.hiddenAt ||
      // A publisher under a SECURITY lock hands nothing over (AGL-3365).
      (await isPublisherSecurityLocked(firestore, listing.profileId)) ||
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
    // Private listings install ONLY for the owning org (AGL-2290).
    //
    // `install-plugin.ts` has carried this since AGL-968; the other six never
    // did, so a private component, theme, template, layout, email template or
    // dataset schema was installable by anyone who knew its listing id. Browse
    // hides them and the detail page 404s, but neither is a control — the
    // route is.
    if (isPrivateListing(listing) && !ownsListing) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    // A FULLY refunded purchase stops entitling (AGL-1546), and until
    // AGL-1699 only the component route knew that: this one asked whether a
    // purchase doc EXISTED, so buy/install/refund kept the artifact. The
    // predicate lives in one place now so the next route cannot miss it.
    const unpaid = await requirePurchase({
      firestore,
      buyerUid: decoded.uid,
      // THE ORG THE LICENCE HAS TO COVER (AGL-2331). `membership.orgId` is
      // resolved server-side from the caller's own membership by the
      // permission gate above — never a request-body field — so this is the
      // workspace the install actually lands in, and the only one a purchase
      // can entitle here.
      buyerOrgId: membership.orgId ?? '',
      listingId,
      priceUsd,
      ownsListing,
    })
    if (unpaid) return res.status(402).json(unpaid)

    const versionSnapshot = await listingRef
      .collection('versions')
      .doc(String(listing.latestVersion))
      .get()
    // The owner checks the version can land here (its quota, its relinking)
    // and writes nothing yet.
    const prepared = await owner.prepare({
      orgId,
      org,
      listing: {
        listingId,
        displayName: listing.displayName,
        description: listing.description,
        version: listing.latestVersion,
      },
      published: versionSnapshot.get('datasetSchema'),
    })
    if (prepared.ok === false) {
      return res.status(prepared.status).json({ error: prepared.error })
    }
    // Provenance + base snapshot (AGL-1015), of the content AS PREPARED for
    // this org rather than as published: a base holding the publisher's
    // reference ids would report every relinked field as a user edit the
    // moment anything is diffed.
    const provenance = await recordInstallProvenance({
      firestore,
      listingId,
      listing,
      version: listing.latestVersion,
      artifactType: 'datasetSchema',
      content: prepared.content,
    })
    const installed = await prepared.commit(
      marketplaceInstallStamp({
        installedFrom: provenance.installedFrom,
        listingId,
        version: listing.latestVersion,
      }),
    )
    if (installed.ok === false) {
      return res.status(installed.status).json({ error: installed.error })
    }

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
      // What the owner landed: the new dataset's id, its field count, and the
      // reference fields it could not relink.
      ...installed.report,
      version: listing.latestVersion ?? null,
      baseStored: provenance.baseStored,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Dataset schema install failed' })
  }
}

export default installDatasetSchemaHandler
