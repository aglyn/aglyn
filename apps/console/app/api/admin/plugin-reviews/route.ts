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
  pluginArtifactPath,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
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
const ACTIONS: Record<string, string> = {
  'start-review': 'in_review',
  list: 'listed',
  verify: 'verified',
  reject: 'rejected',
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
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
      const snapshot = await firestore
        .collection('communityListings')
        .where('type', '==', 'plugin')
        .where('reviewStatus', 'in', ['submitted', 'in_review'])
        .limit(50)
        .get()
      const artifactsBucket = process.env.PLUGIN_ARTIFACTS_BUCKET
      const queue = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const listing = doc.data()
          const version = String(listing.latestVersion ?? '')
          const versionDoc = (
            await doc.ref.collection('pluginVersions').doc(version).get()
          ).data()
          // Verifier re-run (AGL-426) against the stored artifact, when
          // the bucket is reachable — reviewers see fresh findings.
          let verifier: unknown = null
          if (artifactsBucket && versionDoc?.sha256) {
            try {
              const [bytes] = await firebaseAdmin
                .app()
                .storage()
                .bucket(artifactsBucket)
                .file(pluginArtifactPath(doc.id, version, versionDoc.sha256))
                .download()
              verifier = checkPluginBundle(bytes.toString('utf8'))
            } catch {
              verifier = { error: 'artifact unavailable' }
            }
          }
          return {
            listingId: doc.id,
            displayName: listing.displayName ?? doc.id,
            description: listing.description ?? '',
            readme: listing.readme ?? '',
            license: listing.license ?? '',
            categories: listing.categories ?? [],
            homepageUrl: listing.homepageUrl ?? '',
            repositoryUrl: listing.repositoryUrl ?? '',
            profileId: listing.profileId,
            reviewStatus: listing.reviewStatus,
            priceUsd: Number(listing.priceUsd ?? 0),
            version,
            capabilities: versionDoc?.manifest?.capabilities ?? {},
            hostAbi: versionDoc?.manifest?.hostAbi ?? null,
            trust: versionDoc?.trust ?? null,
            verifier,
          }
        }),
      )
      return Response.json({ queue }, { status: 200 })
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }
    const listingId = String(body?.listingId ?? '')
    const action = String(body?.action ?? '')
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
    if (listing.profileId && (action === 'reject' || action === 'list' || action === 'verify')) {
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
              : `"${listing.displayName}" is now ${nextStatus}`,
          body: action === 'reject' ? reason : 'Your plugin passed review.',
          orgId: publisherOrgId,
          link: publisherSlug ? `/${publisherSlug}/community` : '/',
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
