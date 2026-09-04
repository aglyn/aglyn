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

import { createResourceUid, isPluginRevoked } from '@aglyn/aglyn/server'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import type { PluginRevocation } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  emailStarterRefusal,
  inspectEmailStarter,
  isPrivateListing,
  listingArtifactType,
  resolveEmailStarterAssurance,
} from '../model'
import { canActAsPublisher } from './publisher-profile'
import { requirePurchase } from './purchase-entitlement'
import { recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'

/**
 * Installs a marketplace email starter as a new email on a site.
 *
 * ## The install is a COPY, and that is the versioning answer
 *
 * The published tree is written into a screen document of the tenant's own —
 * `hosts/{h}/screens/{newId}` with `kind: 'email'`, plus its first version —
 * in exactly the shape `createEmailScreen` writes, so it appears in the site's
 * Email templates list beside every email they designed themselves and opens
 * in the same besigner. From that write on, nothing reads the listing again.
 *
 * That is deliberate, and it is the property a live reference could not have:
 * a publisher pushing version 4 must not rewrite the email a tenant is
 * mailing from this afternoon. A newer version surfaces as an offer — the
 * shared `resolveUpdateState` comparison every other artifact type uses — and
 * is taken through `update-artifact`, which three-way-merges against the base
 * snapshot recorded here so the tenant's own edits survive it.
 *
 * The one thing a copy does NOT sever is a `media:` reference, which still
 * resolves against the publisher's media. Reported by the inspection rather
 * than refused: our own CDN serves it, so no third party learns who opened the
 * mail, but the bytes behind it can still change.
 *
 * ## Three refusals that are not in the other install routes
 *
 * **The kill switch, at install.** Every other copied artifact treats
 * `revocations` as a plugin concern. An installed email is mailed from the
 * shared sending domain, so a stopped version must not be handed out — and,
 * separately, must stop being sent by tenants who already have it, which is
 * `emailStarterSendBlock` on the send path.
 *
 * **A rejected version, for everybody including its publisher.** Review is not
 * a precondition for installing an email starter — they are auto-listed like
 * every other copied artifact — so most versions are honestly `unreviewed` and
 * install fine. A verdict of `rejected` is different: somebody looked and said
 * no, and the publisher's own site is on the same sending domain as everyone
 * else's.
 *
 * **The policy, re-run over the listing's own bytes.** The publish route
 * already refused a violating design. Re-running it here is not belt and
 * braces about that route — it is the gate for content that never went through
 * it: a version published before this policy existed, a document written by a
 * staff tool, an import. A tracking pixel is only refused if the refusal sits
 * where the content is HANDED OVER, which is the lesson `install-email-template`
 * records about takedown.
 */
export const installEmailStarterHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  if (!listingId || !hostId) {
    return res.status(400).json({ error: 'Missing listingId or hostId' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.installPlugins) {
      return res.status(403).json({
        error:
          'Your organization role does not allow installing from the marketplace',
      })
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin or editor' })
    }

    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (
      !listing ||
      listing.deletedAt ||
      listing.hiddenAt ||
      listingArtifactType(listing) !== 'emailStarter'
    ) {
      return res.status(404).json({ error: 'Unknown email starter' })
    }

    const ownsListing = await canActAsPublisher(
      firestore,
      decoded.uid,
      listing.profileId,
    )
    if (isPrivateListing(listing) && !ownsListing) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    const priceUsd = Number(listing.priceUsd ?? 0)
    const unpaid = await requirePurchase({
      firestore,
      buyerUid: decoded.uid,
      buyerOrgId: membership.orgId ?? '',
      listingId,
      priceUsd,
      ownsListing,
    })
    if (unpaid) return res.status(402).json(unpaid)

    const version = listing.latestVersion
    const revocation = (
      await firestore.collection('revocations').doc(listingId).get()
    ).data() as PluginRevocation | undefined
    if (isPluginRevoked(revocation, String(version ?? ''))) {
      return res
        .status(409)
        .json({ error: 'This email design has been stopped by Aglyn' })
    }

    const versionSnapshot = await listingRef
      .collection('versions')
      .doc(String(version))
      .get()
    if (!versionSnapshot.exists) {
      return res.status(500).json({ error: 'Email starter version missing' })
    }
    /**
     * The assurance of THIS version, from THIS version's document.
     *
     * Read here rather than off the listing, and stamped rather than
     * recomputed later, because the listing's own review fields answer a
     * different question. `reviewStatus: 'verified'` is a claim about the
     * publisher; `latestVersionReviewState` describes whatever is newest. A
     * reader that consulted either would report version 7 as reviewed on the
     * strength of version 3, which is how "reviewed" stops meaning anything.
     */
    const assurance = resolveEmailStarterAssurance({
      reviewState: versionSnapshot.get('reviewState'),
    })
    if (assurance === 'rejected') {
      return res.status(409).json({
        error: 'This email design was turned down in review and cannot be installed',
      })
    }

    const inspection = inspectEmailStarter(versionSnapshot.get('nodes'), {
      hostId,
    })
    const violation = emailStarterRefusal(inspection)
    if (violation) {
      return res
        .status(422)
        .json({ error: violation, violations: inspection.violations })
    }
    const nodes = inspection.nodes
    if (!nodes || !Object.keys(nodes).length) {
      return res.status(500).json({ error: 'Email starter version missing' })
    }

    const subject = String(versionSnapshot.get('subject') ?? '')
    const preheader = String(versionSnapshot.get('preheader') ?? '')
    const rootId = versionSnapshot.get('rootId') ?? null
    const provenance = await recordInstallProvenance({
      firestore,
      listingId,
      listing,
      version,
      artifactType: 'emailStarter',
      content: { rootId, nodes, subject, preheader },
    })
    const installedFrom = { ...provenance.installedFrom, assurance }

    const screenId = createResourceUid()
    const versionId = createResourceUid()
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    const displayName = String(listing.displayName ?? 'Installed email').slice(
      0,
      120,
    )
    const batch = firestore.batch()
    const screenRef = hostRef.collection('screens').doc(screenId)
    /**
     * The same document shape `createEmailScreen` writes, so the Email
     * templates list, the screen besigner and the campaign composer all find
     * it without knowing it came from anywhere.
     *
     * NOT routed, and `kind: 'email'`, which is what keeps it out of
     * `countBillableScreens` — an installed email spends the same allowance a
     * hand-made one does, which is none.
     *
     * `nodes` is written as a plain map here, exactly as the first version
     * from `/api/hosts/versions` is. The besigner's converter compresses on
     * the first save, and `decodeStoredNodes` is what every reader on this
     * path already goes through, so both forms are handled from the start.
     */
    batch.set(screenRef, {
      displayName,
      kind: 'email',
      versionId,
      ...(subject && { emailSubject: subject }),
      ...(preheader && { emailPreheader: preheader }),
      installedFrom,
      createdAt: now,
      updatedAt: now,
    })
    batch.set(screenRef.collection('versions').doc(versionId), {
      screenId,
      ...(rootId ? { rootId } : {}),
      nodes,
      // Stamped on the VERSION as well as the screen, because the version is
      // what the send path renders and the send path is where the kill switch
      // has to bite. A stamp only on the parent would be one document away
      // from the bytes it describes.
      installedFrom,
      createdAt: now,
      updatedAt: now,
    })
    await batch.commit()

    await recordVersionMove({
      firestore,
      listingRef,
      artifactType: 'emailStarter',
      to: version,
    })
    await listingRef
      .update({
        installCount: firebaseAdmin.firestore.FieldValue.increment(1),
      })
      .catch(() => undefined)

    return res.status(200).json({
      installed: true,
      screenId,
      versionId,
      version: version ?? null,
      assurance,
      linkHosts: inspection.linkHosts,
      foreignMediaScopes: inspection.foreignMediaScopes,
      baseStored: provenance.baseStored,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Email starter install failed' })
  }
}

export default installEmailStarterHandler
