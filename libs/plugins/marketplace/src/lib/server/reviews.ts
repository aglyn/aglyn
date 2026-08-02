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
import { firebaseAdmin, isImpersonationSession } from '@aglyn/tenant-data-admin'
import { canActAsPublisher } from './publisher-profile'

const MAX_COMMENT_LENGTH = 2000
/** Orgs scanned when looking for an install pin. */
const MAX_ORGS_CHECKED = 25

/**
 * Whether the author has actually used this listing (AGL-655).
 *
 * An install pin lives at `orgs/{orgId}/installs/{listingId}` (org-wide) or
 * `hosts/{hostId}/installs/{listingId}` (one site), and **it is one or the
 * other** — `install-plugin` reassigns its target ref to the org path for an
 * org-scoped install rather than writing both.
 *
 * This used to read the org pin alone, on the stated reasoning that "a host
 * pin implies the org installed it somewhere, and the org mirror is what the
 * install routes write" (AGL-1006). There is no org mirror, so a per-site
 * install left nothing to find and the workspace was refused a rating — and
 * it refused exactly the careful installers, the ones who scoped a plugin to
 * one site before rolling it out. Ratings drive marketplace ranking, so that
 * skewed the sample toward org-wide installers.
 *
 * Host pins are found through the org doc's own `hosts` map (written by
 * `registerOrgHost`), then read in ONE batched `getAll` alongside the org
 * pin. Two round trips per org, bounded and index-free — deliberately not a
 * collection-group query on `installs`, which would need a new index and
 * would match every tenant's pins for a listing, unbounded, to answer a
 * question about one org.
 */
const MAX_HOSTS_CHECKED = 50

// Exported for the AGL-1006 regression test: it takes its firestore, so the
// rule "a host pin counts" is checkable without standing up the whole
// handler (auth, transactions, aggregate writes).
export async function isVerifiedInstaller(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  listingId: string,
): Promise<{ verified: boolean; orgId?: string }> {
  const memberships = await firestore
    .collection('users')
    .doc(uid)
    .collection('orgs')
    .limit(MAX_ORGS_CHECKED)
    .get()
  for (const membership of memberships.docs) {
    const orgId = membership.id
    const orgRef = firestore.collection('orgs').doc(orgId)
    const org = await orgRef.get()
    const hostIds = Object.keys(
      (org.get('hosts') as Record<string, unknown> | undefined) ?? {},
    ).slice(0, MAX_HOSTS_CHECKED)
    const refs = [
      orgRef.collection('installs').doc(listingId),
      ...hostIds.map((hostId) =>
        firestore
          .collection('hosts')
          .doc(hostId)
          .collection('installs')
          .doc(listingId),
      ),
    ]
    const pins = await firestore.getAll(...refs)
    if (pins.some((pin) => pin.exists)) return { verified: true, orgId }
  }
  return { verified: false }
}

/**
 * Ratings and comments on a marketplace listing (AGL-655).
 *
 * One review per account, keyed by uid, so re-submitting edits rather than
 * stacking. Two rules shape everything else:
 *
 * - **Rating requires a verified email AND having installed it (AGL-865).**
 *   A star rating is the signal that drives ranking, so it is reserved for
 *   accounts that verified their email and actually used the thing.
 *   Commenting stays open to any signed-in account — questions before
 *   installing are useful, and a comment moves no numbers.
 * - **The publisher cannot review their own listing.** Org-scoped, so a
 *   second account in the same org does not slip through.
 *
 * Aggregates are adjusted in the same transaction as the review, and are
 * frozen from client writes in rules. Kept as a running `ratingSum` +
 * `ratingCount` so a submission costs one read, not a scan of every review.
 */
export const reviewsHandler: PluginApiHandler = async (req, res) => {
  const method = req.method === 'DELETE' ? 'DELETE' : 'POST'
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (!listing || listing.deletedAt) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    const reviewRef = listingRef.collection('reviews').doc(decoded.uid)

    if (method === 'DELETE') {
      await firestore.runTransaction(async (tx) => {
        const [existing, listingNow] = await Promise.all([
          tx.get(reviewRef),
          tx.get(listingRef),
        ])
        if (!existing.exists) return
        const previousRating = Number(existing.get('rating') ?? 0) || 0
        const hadComment = !!existing.get('comment')
        tx.delete(reviewRef)
        tx.update(
          listingRef,
          nextAggregates(
            listingNow,
            -previousRating,
            previousRating ? -1 : 0,
            hadComment ? -1 : 0,
          ),
        )
      })
      return res.status(200).json({ ok: true, removed: true })
    }

    // Publishing org cannot review itself, however many accounts it has.
    if (await canActAsPublisher(firestore, decoded.uid, listing.profileId)) {
      return res.status(403).json({
        error: 'You cannot review your organization’s own listing',
      })
    }

    const rawRating = req.body?.rating
    const rating =
      rawRating == null || rawRating === ''
        ? 0
        : Math.min(5, Math.max(1, Math.round(Number(rawRating) || 0)))
    const comment = String(req.body?.comment ?? '')
      .trim()
      .slice(0, MAX_COMMENT_LENGTH)
    if (!rating && !comment) {
      return res.status(400).json({ error: 'Add a rating or a comment' })
    }

    // A star rating drives ranking, so it is reserved for accounts that both
    // verified their email (AGL-865/479) AND actually installed the thing.
    // Commenting stays open to any signed-in account — the checks below only
    // guard `rating`, never `comment`. Impersonation sessions are exempt from
    // the email gate the same way every other AGL-479 chokepoint is.
    if (rating && !decoded.email_verified && !isImpersonationSession(decoded)) {
      return res.status(403).json({
        error: 'Verify your email to rate — you can still leave a comment',
        reason: 'email-unverified',
      })
    }
    const installer = await isVerifiedInstaller(firestore, decoded.uid, listingId)
    if (rating && !installer.verified) {
      return res.status(403).json({
        error:
          'Only organizations that have installed this can rate it — you ' +
          'can still leave a comment',
      })
    }

    const now = Date.now()
    await firestore.runTransaction(async (tx) => {
      const [existing, listingNow] = await Promise.all([
        tx.get(reviewRef),
        tx.get(listingRef),
      ])
      const previousRating = Number(existing.get('rating') ?? 0) || 0
      const hadComment = existing.exists && !!existing.get('comment')
      tx.set(
        reviewRef,
        {
          uid: decoded.uid,
          displayName: String(decoded.name ?? 'Someone').slice(0, 80),
          ...(rating ? { rating } : { rating: null }),
          ...(comment ? { comment } : { comment: null }),
          verifiedInstaller: installer.verified,
          ...(installer.orgId ? { orgId: installer.orgId } : {}),
          // Preserved across edits: a moderator's decision must not be
          // undone by the author simply resubmitting.
          hidden: existing.get('hidden') ?? false,
          ...(existing.exists ? {} : { createdAtMs: now }),
          updatedAtMs: now,
        },
        { merge: true },
      )
      tx.update(
        listingRef,
        nextAggregates(
          listingNow,
          rating - previousRating,
          (rating ? 1 : 0) - (previousRating ? 1 : 0),
          (comment ? 1 : 0) - (hadComment ? 1 : 0),
        ),
      )
    })

    return res.status(200).json({
      ok: true,
      rating: rating || null,
      verifiedInstaller: installer.verified,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Review failed' })
  }
}

/**
 * Absolute aggregate values after a change.
 *
 * Written as numbers rather than `FieldValue.increment` because
 * `ratingAverage` has to be stored — browse sorts on it, and a transaction
 * cannot divide two pending increments. Reading the listing inside the
 * transaction makes the read-modify-write atomic, so concurrent reviews
 * cannot interleave and lose a vote.
 */
function nextAggregates(
  current: FirebaseFirestore.DocumentSnapshot,
  ratingSumDelta: number,
  ratingCountDelta: number,
  commentCountDelta: number,
): Record<string, unknown> {
  const ratingSum = Math.max(0, Number(current.get('ratingSum') ?? 0) + ratingSumDelta)
  const ratingCount = Math.max(
    0,
    Number(current.get('ratingCount') ?? 0) + ratingCountDelta,
  )
  const commentCount = Math.max(
    0,
    Number(current.get('commentCount') ?? 0) + commentCountDelta,
  )
  return {
    ratingSum,
    ratingCount,
    commentCount,
    // One decimal — enough for "4.2", and avoids a long float in the UI.
    ratingAverage: ratingCount
      ? Math.round((ratingSum / ratingCount) * 10) / 10
      : 0,
    updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  }
}

export default reviewsHandler
