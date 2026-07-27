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
  checkPluginBundle,
  isStoredVerdictCurrent,
  PLUGIN_HOST_ABI_VERSION,
  PLUGIN_VERIFIER_VERSION,
  pluginArtifactPath,
  pluginRequestFromWeb,
  type StoredBundleVerdict,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { buildRoute, Route } from '@aglyn/aglyn/server'
import {
  outstandingChecklistItems,
  PLUGIN_REVIEW_CHECKLIST,
} from '../../../../constants/plugin-review-checklist'
import { FieldValue } from 'firebase-admin/firestore'
import { notifyOrgAdmins } from '@aglyn/tenant-data-admin'

/**
 * Marketplace review queue (AGL-432) — Strapi Market's two-phase review
 * as staff tooling. GET returns plugin listings awaiting review
 * (submitted/in_review) with the static-verifier verdict re-run against
 * the stored artifact (the same AGL-426 checks the publish API enforced —
 * re-run here so a reviewer sees them without trusting the publish-time
 * result). POST moves a listing through the lifecycle:
 *
 *   start-review → in_review        list → listed (publicly browsable)
 *   verify → verified (✅ badge)     reject → rejected (+ reason,
 *                                    notification to the publisher)
 *
 * Realm trust stays a SEPARATE, super-staff grant (sign-plugin route) —
 * listing/verifying here never signs anything. Every action lands in
 * adminAudit.
 */
/** Every id the checklist route will accept (AGL-963). */
const REQUIRED_OR_OPTIONAL = new Set(
  PLUGIN_REVIEW_CHECKLIST.map((item) => item.id),
)

const ACTIONS: Record<string, string> = {
  'start-review': 'in_review',
  list: 'listed',
  verify: 'verified',
  reject: 'rejected',
  // Moves BACK down the ladder (AGL-965). Review used to be a one-way
  // ratchet: the only retreats were `reject`, which reads as a verdict on
  // the whole listing and notifies the publisher as such, and takedown,
  // which is the kill switch and stops the plugin in every workspace that
  // already installed it. Neither expresses "pull it from the marketplace
  // while we look again, without breaking the sites already using it".
  delist: 'in_review',
  unverify: 'listed',
}

/**
 * One listing in full, for the detail page (AGL-959). The index deals in
 * rows; everything a reviewer needs to actually decide — manifest,
 * capabilities, ABI, verifier findings, per-version trust, takedown state —
 * is assembled here rather than smeared across the list payload.
 */
async function listingDetail(
  firestore: FirebaseFirestore.Firestore,
  listingId: string,
): Promise<Response> {
  const listingRef = firestore.collection('communityListings').doc(listingId)
  const snapshot = await listingRef.get()
  const listing = snapshot.data()
  if (!listing) {
    return Response.json({ error: 'Unknown listing' }, { status: 404 })
  }

  const versionsSnapshot = await listingRef
    .collection('pluginVersions')
    .orderBy('publishedAt', 'desc')
    .limit(25)
    .get()
  const versions = versionsSnapshot.docs.map((doc) => {
    const publishedAt = doc.get('publishedAt')
    return {
      version: String(doc.get('version') ?? doc.id),
      trust: doc.get('trust') ?? null,
      sha256: String(doc.get('sha256') ?? ''),
      hostAbi: Number(doc.get('manifest.hostAbi')) || null,
      capabilities: doc.get('manifest.capabilities') ?? {},
      publishedAt: publishedAt?.toDate?.()?.toISOString() ?? null,
      signed: Boolean(doc.get('signature')),
      // Server-side only — used to decide whether the verdict below needs
      // recomputing; stripped before the payload goes out.
      verification: doc.get('verification') ?? null,
      reviewChecklist: doc.get('reviewChecklist') ?? null,
    }
  })

  // Publisher is an ORG since AGL-652 — show the name, not the raw id.
  const publisherId = String(listing.profileId ?? '')
  const publisher = publisherId
    ? await firestore.collection('orgs').doc(publisherId).get()
    : null

  // Kill switch, so the page can say whether the plugin is actually stopped
  // rather than only de-listed (AGL-948).
  const revocation = (
    await firestore.collection('revocations').doc(listingId).get()
  ).data()

  // The verifier verdict for the version under review (AGL-426), served
  // from the version doc when it is current (AGL-962).
  //
  // `checkPluginBundle` is pure and the artifact is immutable and
  // content-addressed, so a verdict pinned to {sha256, verifierVersion} is
  // exactly as trustworthy as re-running it — and re-running meant
  // downloading up to a megabyte from Storage on EVERY page view. A stored
  // verdict from an older checker, or for different bytes, is ignored.
  const reviewVersion = String(listing.latestVersion ?? '')
  const artifactsBucket = process.env.PLUGIN_ARTIFACTS_BUCKET
  const reviewEntry = versions.find((entry) => entry.version === reviewVersion)
  const reviewSha = reviewEntry?.sha256
  const stored = reviewEntry?.verification as StoredBundleVerdict | undefined
  const storedIsCurrent = isStoredVerdictCurrent(stored, reviewSha ?? '')

  let verifier: unknown = storedIsCurrent
    ? { ok: stored?.ok, problems: stored?.problems ?? [] }
    : null
  let verifierCached = storedIsCurrent
  if (!storedIsCurrent && artifactsBucket && reviewSha) {
    try {
      const [bytes] = await firebaseAdmin
        .app()
        .storage()
        .bucket(artifactsBucket)
        .file(pluginArtifactPath(listingId, reviewVersion, reviewSha))
        .download()
      const result = checkPluginBundle(bytes.toString('utf8'))
      verifier = result
      // Write it back so this sha is verified at most once platform-wide —
      // covers every listing published before the verdict was persisted at
      // publish time, and any version whose checker has since moved on.
      // Best effort: a failed write costs the next reader a re-run, nothing
      // more, so it must never fail the page.
      await listingRef
        .collection('pluginVersions')
        .doc(reviewVersion)
        .set(
          {
            verification: {
              ok: result.ok,
              problems: result.problems,
              sha256: reviewSha,
              verifierVersion: PLUGIN_VERIFIER_VERSION,
              checkedAt: FieldValue.serverTimestamp(),
            },
          },
          { merge: true },
        )
        .catch(() => undefined)
    } catch {
      verifier = { error: 'artifact unavailable' }
      verifierCached = false
    }
  }

  return Response.json(
    {
      listingId,
      displayName: listing.displayName ?? listingId,
      description: listing.description ?? '',
      readme: listing.readme ?? '',
      license: listing.license ?? '',
      categories: listing.categories ?? [],
      homepageUrl: listing.homepageUrl ?? '',
      repositoryUrl: listing.repositoryUrl ?? '',
      publisherId,
      publisherName: publisher?.get('name') ?? publisherId,
      publisherSlug: publisher?.get('slug') ?? null,
      reviewStatus: listing.reviewStatus ?? 'submitted',
      rejectionReason: listing.rejectionReason ?? '',
      priceUsd: Number(listing.priceUsd ?? 0),
      latestVersion: reviewVersion,
      activeInstalls: Number(listing.activeInstalls ?? 0),
      hidden: Boolean(listing.hiddenAt),
      hiddenReason: String(listing.hiddenReason ?? ''),
      revoked: Boolean(revocation),
      revokedVersions: revocation?.versions ?? null,
      unpublished: Boolean(listing.deletedAt),
      platformHostAbi: PLUGIN_HOST_ABI_VERSION,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      versions: versions.map(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ verification, reviewChecklist, ...entry }) => entry,
      ),
      // Review checklist for the version under review (AGL-963). Ticks made
      // against different bytes do not count, so a republish starts clean.
      checklist: Object.fromEntries(
        Object.entries(
          (reviewEntry?.reviewChecklist ?? {}) as Record<
            string,
            { by?: string; sha256?: string }
          >,
        )
          .filter(([, entry]) => entry?.sha256 === reviewSha)
          .map(([id, entry]) => [id, { by: entry.by ?? null }]),
      ),
      checklistOutstanding: outstandingChecklistItems(
        reviewEntry?.reviewChecklist as never,
        reviewSha ?? '',
      ),
      verifier,
      verifierCached,
      verifierVersion: PLUGIN_VERIFIER_VERSION,
    },
    { status: 200 },
  )
}

async function handler(request: Request): Promise<Response> {
  const { method, body, query, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
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
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()

    if (method === 'GET') {
      const detailId = String(query['listingId'] ?? '')
      if (detailId) return listingDetail(firestore, detailId)

      const snapshot = await firestore
        .collection('communityListings')
        .where('type', '==', 'plugin')
        .where('reviewStatus', 'in', ['submitted', 'in_review'])
        .limit(50)
        .get()
      // Rows only (AGL-961). This used to DOWNLOAD every queued bundle to
      // re-run the verifier, so the index paid a Storage round trip per
      // submission before it could paint. The verifier now runs on the
      // detail page, for the one listing being read.
      const queue = snapshot.docs.map((doc) => {
        const listing = doc.data()
        return {
          listingId: doc.id,
          displayName: listing.displayName ?? doc.id,
          description: listing.description ?? '',
          license: listing.license ?? '',
          categories: listing.categories ?? [],
          profileId: listing.profileId,
          reviewStatus: listing.reviewStatus,
          priceUsd: Number(listing.priceUsd ?? 0),
          version: String(listing.latestVersion ?? ''),
          hidden: Boolean(listing.hiddenAt),
        }
      })
      // Listed/verified plugins with per-version trust (AGL-885): once a
      // listing leaves the queue the Grant/Revoke realm-trust actions used
      // to leave with it — revoking a live plugin's trust required a
      // hand-crafted API call. This block keeps every listed plugin's
      // version trust state administrable.
      const listedSnapshot = await firestore
        .collection('communityListings')
        .where('type', '==', 'plugin')
        .where('reviewStatus', 'in', ['listed', 'verified'])
        .limit(50)
        .get()
      const listed = await Promise.all(
        listedSnapshot.docs.map(async (doc) => {
          const listing = doc.data()
          const versionsSnapshot = await doc.ref
            .collection('pluginVersions')
            .orderBy('publishedAt', 'desc')
            .limit(10)
            .get()
          const versions = versionsSnapshot.docs.map((versionDoc) => ({
            version: String(versionDoc.get('version') ?? versionDoc.id),
            trust: versionDoc.get('trust') ?? null,
          }))
          return {
            listingId: doc.id,
            displayName: listing.displayName ?? doc.id,
            reviewStatus: listing.reviewStatus,
            profileId: listing.profileId,
            latestVersion: String(listing.latestVersion ?? ''),
            // Takedown state (AGL-952), so a row shows the current verdict
            // rather than sending a reviewer into the detail page to find
            // out whether the plugin is stopped.
            hidden: Boolean(listing.hiddenAt),
            hiddenReason: String(listing.hiddenReason ?? ''),
            // Summarised for the row; the per-version controls live on the
            // detail page (AGL-960).
            realmVersions: versions.filter((entry) => entry.trust === 'realm')
              .length,
            versionCount: versions.length,
            versions,
          }
        }),
      )

      // Publisher names for scanning (AGL-961) — a listing id tells a
      // reviewer nothing. One batched read for both sections.
      const publisherIds = [
        ...new Set(
          [...queue, ...listed]
            .map((entry) => String(entry.profileId ?? ''))
            .filter(Boolean),
        ),
      ]
      const publishers: Record<string, string> = {}
      if (publisherIds.length) {
        const docs = await firestore.getAll(
          ...publisherIds.map((id) => firestore.collection('orgs').doc(id)),
        )
        for (const doc of docs) {
          if (doc.exists) publishers[doc.id] = String(doc.get('name') ?? doc.id)
        }
      }
      return Response.json({ queue, listed, publishers }, { status: 200 })
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }
    const listingId = String(body?.listingId ?? '')
    const action = String(body?.action ?? '')

    // Takedown (AGL-658) is separate from the review verdict: it applies to
    // EVERY artifact type, not just plugins, and it must not overwrite a
    // plugin's `reviewStatus` — a hidden plugin that later gets un-hidden
    // should return to the verdict it had, not to square one.
    if (action === 'hide' || action === 'unhide') {
      if (!listingId) {
        return Response.json({ error: 'Missing listingId' }, { status: 400 })
      }
      const hideReason = String(body?.reason ?? '').slice(0, 500)
      if (action === 'hide' && !hideReason.trim()) {
        return Response.json({ error: 'Hiding needs a reason' }, { status: 400 })
      }
      const reviewUid = String(body?.reviewUid ?? '')
      const target = reviewUid
        ? firestore
            .collection('communityListings')
            .doc(listingId)
            .collection('reviews')
            .doc(reviewUid)
        : firestore.collection('communityListings').doc(listingId)
      const targetSnapshot = await target.get()
      if (!targetSnapshot.exists) {
        return Response.json({ error: 'Unknown target' }, { status: 404 })
      }
      await target.set(
        reviewUid
          ? { hidden: action === 'hide' }
          : action === 'hide'
            ? {
                hiddenAt: FieldValue.serverTimestamp(),
                hiddenBy: decoded.uid,
                hiddenReason: hideReason,
              }
            : {
                hiddenAt: FieldValue.delete(),
                hiddenBy: FieldValue.delete(),
                hiddenReason: FieldValue.delete(),
              },
        { merge: true },
      )

      // Takedown means takedown (AGL-948). Hiding a PLUGIN listing also
      // writes the kill switch, so one staff action has one outcome
      // instead of leaving the bundle executing in every workspace that
      // already installed it. The realm join blocks on `hiddenAt` too, but
      // the revocation is what the client-side loaders and the public
      // listing-versions endpoint already understand — belt and braces on
      // the one action where a gap means running attacker code.
      const isPlugin =
        !reviewUid &&
        (targetSnapshot.get('artifactType') === 'plugin' ||
          targetSnapshot.get('type') === 'plugin')
      if (isPlugin) {
        const revocationRef = firestore.collection('revocations').doc(listingId)
        if (action === 'hide') {
          await revocationRef.set(
            {
              versions: 'all',
              reason: hideReason,
              revokedBy: decoded.uid,
              revokedAt: FieldValue.serverTimestamp(),
              // Marks this revocation as takedown-owned, so un-hiding can
              // clear it without also clearing a revocation staff wrote by
              // hand for a different reason.
              source: 'takedown',
            },
            { merge: true },
          )
        } else if ((await revocationRef.get()).get('source') === 'takedown') {
          await revocationRef.delete()
        }
      }

      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        action: `plugins.takedown.${action}`,
        target: reviewUid
          ? `communityListings/${listingId}/reviews/${reviewUid}`
          : `communityListings/${listingId}`,
        after: {
          hidden: action === 'hide',
          ...(hideReason ? { reason: hideReason } : {}),
          ...(isPlugin ? { revoked: action === 'hide' } : {}),
        },
        at: FieldValue.serverTimestamp(),
      })

      return Response.json(
        { ok: true, hidden: action === 'hide', revoked: isPlugin && action === 'hide' },
        { status: 200 },
      )
    }

    // Review checklist (AGL-963). Ticks are per {version, sha256} and carry
    // who + when, so "verified" is a recorded act rather than a click.
    if (action === 'checklist') {
      const version = String(body?.version ?? '')
      const itemId = String(body?.itemId ?? '')
      const checked = body?.checked !== false
      if (!listingId || !version || !REQUIRED_OR_OPTIONAL.has(itemId)) {
        return Response.json({ error: 'Unknown checklist item' }, { status: 400 })
      }
      const versionRef = firestore
        .collection('communityListings')
        .doc(listingId)
        .collection('pluginVersions')
        .doc(version)
      const versionSnapshot = await versionRef.get()
      if (!versionSnapshot.exists) {
        return Response.json({ error: 'Unknown version' }, { status: 404 })
      }
      await versionRef.set(
        {
          reviewChecklist: {
            [itemId]: checked
              ? {
                  by: decoded.uid,
                  at: FieldValue.serverTimestamp(),
                  // Pins the tick to the bytes it was made against.
                  sha256: String(versionSnapshot.get('sha256') ?? ''),
                }
              : FieldValue.delete(),
          },
        },
        { merge: true },
      )
      return Response.json({ ok: true, itemId, checked }, { status: 200 })
    }

    const nextStatus = ACTIONS[action]
    if (!listingId || !nextStatus) {
      return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
    const reason = String(body?.reason ?? '').slice(0, 500)
    if (action === 'reject' && !reason.trim()) {
      return Response.json({ error: 'Rejection needs a reason' }, { status: 400 })
    }

    const listingRef = firestore.collection('communityListings').doc(listingId)
    const listing = (await listingRef.get()).data()
    if (!listing) return Response.json({ error: 'Unknown listing' }, { status: 404 })

    // Both gates that expose a plugin to customers require a completed
    // checklist (AGL-963).
    //
    // `list` matters MORE than `verify`, which is easy to get backwards:
    // listing is what makes `isListingBrowsable` true, so it is the moment
    // executable third-party code becomes installable by every workspace.
    // `verify` only adds the badge on top. Gating the badge while leaving
    // listing open would put the ceremony on the weaker action.
    //
    // `start-review` and `reject` stay ungated on purpose: a reviewer must
    // be able to throw something out without first ticking eight boxes
    // about a bundle they have already decided against.
    if (action === 'verify' || action === 'list') {
      const version = String(listing.latestVersion ?? '')
      const versionSnapshot = await listingRef
        .collection('pluginVersions')
        .doc(version)
        .get()
      const outstanding = outstandingChecklistItems(
        versionSnapshot.get('reviewChecklist'),
        String(versionSnapshot.get('sha256') ?? ''),
      )
      if (outstanding.length) {
        return Response.json(
          {
            error: `Review checklist incomplete — ${outstanding.length} required item(s) outstanding`,
            outstanding,
          },
          { status: 409 },
        )
      }
    }

    await listingRef.set(
      {
        reviewStatus: nextStatus,
        reviewedBy: decoded.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        ...(action === 'reject'
          ? { rejectionReason: reason }
          : { rejectionReason: FieldValue.delete() }),
      },
      { merge: true },
    )

    // Tell the publisher their listing moved (rejections especially).
    if (
      listing.profileId &&
      ['reject', 'list', 'verify', 'delist'].includes(action)
    ) {
      // Publishers are ORGS now (AGL-652), so `profileId` is an org id —
      // writing to users/{profileId}/notifications silently dropped every
      // verdict into a user document nobody reads. Notify the org's managers.
      const publisherOrgId = String(listing.profileId ?? '')
      const publisherSlug = publisherOrgId
        ? ((
            await firestore.collection('orgs').doc(publisherOrgId).get()
          ).get('slug') as string | undefined)
        : undefined
      if (publisherOrgId) {
        await notifyOrgAdmins(publisherOrgId, {
          type: 'community.review',
          title:
            action === 'reject'
              ? `"${listing.displayName}" was rejected`
              : action === 'delist'
                ? `"${listing.displayName}" is back in review`
                : `"${listing.displayName}" is now ${nextStatus}`,
          body:
            action === 'reject'
              ? reason
              : action === 'delist'
                ? reason ||
                  'It has been removed from the marketplace while we take ' +
                    'another look. Existing installs keep working.'
                : 'Your plugin passed review.',
          orgId: publisherOrgId,
          link: publisherSlug
            ? buildRoute(Route.MANAGE_COMMUNITY_PROFILE, {
                orgSlug: publisherSlug,
              })
            : '/',
        }).catch(() => undefined)
      }
    }

    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      action: `plugins.review.${action}`,
      target: `communityListings/${listingId}`,
      after: { reviewStatus: nextStatus, ...(reason ? { reason } : {}) },
      at: FieldValue.serverTimestamp(),
    })

    return Response.json({ ok: true, reviewStatus: nextStatus }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Review action failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
