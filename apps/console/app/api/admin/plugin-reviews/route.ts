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
import {
  buildRoute,
  compareArtifactVersions,
  Route,
} from '@aglyn/aglyn/server'
import {
  outstandingChecklistItems,
  PLUGIN_REVIEW_CHECKLIST,
} from '../../../../constants/plugin-review-checklist'
import { attestationsForBytes } from '@aglyn/aglyn/app-utils/publisher-attestation'
import { FieldValue } from 'firebase-admin/firestore'
import { listOrgMembers, notifyOrgAdmins } from '@aglyn/tenant-data-admin'
import { sendEmail } from '@aglyn/shared-util-email'

/**
 * Emails a publisher's owners and admins about a review outcome (AGL-972).
 *
 * In-app notifications alone assume the publisher is sitting in the console
 * — but review is asynchronous by nature: a submission can wait days, and
 * the publisher has no reason to keep checking. Best effort, and never
 * allowed to fail the verdict that triggered it.
 */
async function emailPublisher(
  orgId: string,
  subject: string,
  text: string,
): Promise<void> {
  try {
    const members = await listOrgMembers(orgId)
    const uids = members
      .filter((member) => member.role === 'owner' || member.role === 'admin')
      .map((member) => member.$id)
    if (!uids.length) return
    const users = await firebaseAdmin
      .app()
      .auth()
      .getUsers(uids.map((uid) => ({ uid })))
    const recipients = users.users
      .map((user) => user.email)
      .filter((email): email is string => Boolean(email))
    await Promise.all(
      recipients.map((to) =>
        sendEmail({ to, subject, text, context: 'plugin review update' }),
      ),
    )
  } catch (error) {
    console.error('publisher review email failed', error)
  }
}

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
  requestedVersion?: string,
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
      // Per-version installs (AGL-1036). "How many workspaces would a revoke
      // actually hit" is a per-version question, and the listing total shown
      // elsewhere on this page answers a different one.
      installCount: Number(doc.get('installCount') ?? 0),
      activeInstalls: Number(doc.get('activeInstalls') ?? 0),
      signed: Boolean(doc.get('signature')),
      // The repo as declared for THESE bytes (AGL-1076); absent on versions
      // published before it was collected.
      repositoryUrl: String(doc.get('repositoryUrl') ?? ''),
      reviewState: String(doc.get('reviewState') ?? 'pending'),
      grandfathered: Boolean(doc.get('grandfathered')),
      // Server-side only — used to decide whether the verdict below needs
      // recomputing; stripped before the payload goes out.
      verification: doc.get('verification') ?? null,
      reviewChecklist: doc.get('reviewChecklist') ?? null,
      publisherAttestation: doc.get('publisherAttestation') ?? null,
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
  // Which version this page is reviewing (AGL-966). Defaults to the oldest
  // version still awaiting a verdict — that is the work — falling back to
  // the latest when everything is decided. A reviewer can pin any version
  // explicitly; the checklist and verifier verdict follow the selection,
  // because both are statements about specific bytes.
  const pendingFirst = [...versions]
    .reverse()
    .find((entry) => entry.reviewState !== 'approved')
  const reviewVersion =
    (requestedVersion &&
      versions.find((entry) => entry.version === requestedVersion)?.version) ||
    pendingFirst?.version ||
    String(listing.latestVersion ?? '')
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

  // Who attested, by name (AGL-969). "A named publisher said this on a date"
  // is the half that makes a false attestation actionable, and a raw uid
  // names nobody. Best effort — a deleted account must not blank the page.
  const attestationEntries = Object.values(
    (reviewEntry?.publisherAttestation ?? {}) as Record<
      string,
      { by?: string; at?: { toDate?: () => Date }; sha256?: string }
    >,
  ).filter((entry) => entry?.sha256 === reviewSha)
  const attesterUid = attestationEntries.find((entry) => entry.by)?.by
  const attestedAt =
    attestationEntries.find((entry) => entry.at)?.at?.toDate?.()?.toISOString() ??
    null
  let attestedBy: string | null = attesterUid ?? null
  if (attesterUid) {
    try {
      const user = await firebaseAdmin.app().auth().getUser(attesterUid)
      attestedBy = user.email ?? user.displayName ?? attesterUid
    } catch {
      // Account gone — the uid still identifies the statement.
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
      // Prefer what the version under review declared (AGL-1076). The
      // listing carries whatever the most recent publish said, and a repo
      // can move between versions — the link a reviewer opens should be the
      // one attested against the bytes in front of them. Falls back to the
      // listing for versions published before this was collected.
      repositoryUrl: reviewEntry?.repositoryUrl || listing.repositoryUrl || '',
      publisherId,
      publisherName: publisher?.get('name') ?? publisherId,
      publisherSlug: publisher?.get('slug') ?? null,
      reviewStatus: listing.reviewStatus ?? 'submitted',
      rejectionReason: listing.rejectionReason ?? '',
      priceUsd: Number(listing.priceUsd ?? 0),
      latestVersion: String(listing.latestVersion ?? ''),
      // The version the checklist, verifier verdict and approve/reject
      // actions on this payload refer to.
      reviewVersion,
      activeInstalls: Number(listing.activeInstalls ?? 0),
      hidden: Boolean(listing.hiddenAt),
      hiddenReason: String(listing.hiddenReason ?? ''),
      revoked: Boolean(revocation),
      revokedVersions: revocation?.versions ?? null,
      unpublished: Boolean(listing.deletedAt),
      private: listing.visibility === 'private',
      platformHostAbi: PLUGIN_HOST_ABI_VERSION,
      // Where the bundle bytes actually live (AGL-990). Staff-only payload,
      // and a bucket NAME is not a credential — reaching the object still
      // needs a Google account with access. Without it the page cannot build
      // a Cloud console link, and this bucket does not appear in the Firebase
      // console at all, so a reviewer has no way to find it by hand.
      artifactsBucket: artifactsBucket ?? null,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      versions: versions.map(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ verification, reviewChecklist, publisherAttestation, ...entry }) =>
          entry,
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
      // What the publisher stated about THESE bytes (AGL-969). Not a review
      // input — a reviewer still checks everything themselves — but it says
      // what was claimed, so a discrepancy is a documented false statement
      // rather than a difference of opinion. Attestations recorded against
      // other bytes are dropped, exactly like staff ticks.
      attestation: attestationsForBytes(
        reviewEntry?.publisherAttestation as never,
        reviewSha ?? '',
      ),
      attestedBy,
      attestedAt,
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
      if (detailId) {
        return listingDetail(firestore, detailId, String(query['version'] ?? ''))
      }

      // Every plugin listing, bucketed by whether its newest bytes are
      // waiting on a reviewer (AGL-966). The queue used to ask only for
      // `reviewStatus in ['submitted','in_review']`, which meant an UPDATE
      // to an already-listed plugin appeared nowhere: the listing kept its
      // status, so nobody was ever shown the new version. Reading each
      // listing's latest version doc costs one read per listing and needs
      // no new composite index.
      const snapshot = await firestore
        .collection('communityListings')
        .where('type', '==', 'plugin')
        .limit(100)
        .get()
      // Rows only (AGL-961). This used to DOWNLOAD every queued bundle to
      // re-run the verifier, so the index paid a Storage round trip per
      // submission before it could paint. The verifier now runs on the
      // detail page, for the one listing being read.
      const rows = await Promise.all(
        snapshot.docs
          .filter((doc) => !doc.get('deletedAt'))
          .map(async (doc) => {
            const listing = doc.data()
            const version = String(listing.latestVersion ?? '')
            const latest = version
              ? await doc.ref.collection('pluginVersions').doc(version).get()
              : null
            return {
              listingId: doc.id,
              displayName: listing.displayName ?? doc.id,
              description: listing.description ?? '',
              license: listing.license ?? '',
              categories: listing.categories ?? [],
              profileId: listing.profileId,
              reviewStatus: listing.reviewStatus ?? 'submitted',
              priceUsd: Number(listing.priceUsd ?? 0),
              version,
              hidden: Boolean(listing.hiddenAt),
              private: listing.visibility === 'private',
              latestReviewState: String(latest?.get('reviewState') ?? 'pending'),
              grandfathered: Boolean(latest?.get('grandfathered')),
            }
          }),
      )
      // Awaiting review = the newest bytes have no approval, whatever the
      // listing says. That is what puts an update in front of staff.
      const queue = rows.filter((row) => row.latestReviewState !== 'approved')
      // Listed/verified plugins with per-version trust (AGL-885): once a
      // listing leaves the queue the Grant/Revoke realm-trust actions used
      // to leave with it — revoking a live plugin's trust required a
      // hand-crafted API call. This block keeps every listed plugin's
      // version trust state administrable.
      const listedSnapshot = {
        docs: snapshot.docs.filter((doc) =>
          ['listed', 'verified'].includes(String(doc.get('reviewStatus') ?? '')),
        ),
      }
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
            reviewState: String(versionDoc.get('reviewState') ?? 'pending'),
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
            private: listing.visibility === 'private',
            pendingVersions: versions.filter(
              (entry) => entry.reviewState !== 'approved',
            ).length,
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
      // Audited (AGL-971): a checklist tick is the record that a human
      // looked, so it needs the same trail as the verdict it unlocks —
      // including WHICH bytes were looked at.
      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        action: `plugins.review.checklist.${checked ? 'check' : 'uncheck'}`,
        target: `communityListings/${listingId}/pluginVersions/${version}`,
        after: {
          itemId,
          checked,
          sha256: String(versionSnapshot.get('sha256') ?? ''),
        },
        at: FieldValue.serverTimestamp(),
      })
      return Response.json({ ok: true, itemId, checked }, { status: 200 })
    }

    // Per-version verdicts (AGL-966). Approval is a statement about bytes,
    // so it lives on the version doc and installs resolve the newest
    // approved one. Listing-level list/verify still exist, but they can no
    // longer ship code past review on their own.
    if (action === 'approve-version' || action === 'reject-version') {
      const version = String(body?.version ?? '')
      const listingRef = firestore.collection('communityListings').doc(listingId)
      const versionRef = listingRef.collection('pluginVersions').doc(version)
      const versionSnapshot = await versionRef.get()
      if (!versionSnapshot.exists) {
        return Response.json({ error: 'Unknown version' }, { status: 404 })
      }
      const sha256 = String(versionSnapshot.get('sha256') ?? '')
      const approving = action === 'approve-version'
      if (approving) {
        const outstanding = outstandingChecklistItems(
          versionSnapshot.get('reviewChecklist'),
          sha256,
        )
        if (outstanding.length) {
          return Response.json(
            {
              error: `Review checklist incomplete — ${outstanding.length} required item(s) outstanding for these bytes`,
              outstanding,
            },
            { status: 409 },
          )
        }
      }
      const reason = String(body?.reason ?? '').slice(0, 500)
      if (!approving && !reason.trim()) {
        return Response.json(
          { error: 'Rejecting a version needs a reason' },
          { status: 400 },
        )
      }
      await versionRef.set(
        {
          reviewState: approving ? 'approved' : 'rejected',
          reviewedBy: decoded.uid,
          reviewedAt: FieldValue.serverTimestamp(),
          // Records WHICH bytes were approved, so a later republish under
          // the same version string can never inherit this verdict.
          reviewedSha256: sha256,
          grandfathered: FieldValue.delete(),
          ...(approving ? {} : { reviewRejectionReason: reason }),
        },
        { merge: true },
      )

      // A plugin with its first approved version becomes browsable. Later
      // approvals never change listing status — that is the point: an
      // update is reviewed without disturbing what customers already have.
      const listing = (await listingRef.get()).data() ?? {}
      if (
        approving &&
        !['listed', 'verified'].includes(String(listing.reviewStatus ?? ''))
      ) {
        await listingRef.set(
          { reviewStatus: 'listed', updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        )
      }

      // Denormalise the newest approved version onto the listing (AGL-1016).
      // `pluginVersions` is server-only, so a console showing "update
      // available" has nothing else to read — and reading `latestVersion`
      // instead would advertise a version the install route refuses, leaking
      // AGL-966's guarantee back out through a badge.
      //
      // Only ever moves forward: approving an older version after a newer one
      // is a real sequence (a reviewer working through a backlog) and must not
      // walk the offer backwards.
      if (approving) {
        const previous = listing.latestApprovedVersion
        if (
          previous == null ||
          (compareArtifactVersions(String(previous), version) ?? 0) < 0
        ) {
          await listingRef.set(
            {
              latestApprovedVersion: version,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
        }
      }

      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        action: `plugins.review.version.${approving ? 'approve' : 'reject'}`,
        target: `communityListings/${listingId}/pluginVersions/${version}`,
        after: { sha256, ...(reason ? { reason } : {}) },
        at: FieldValue.serverTimestamp(),
      })

      if (listing.profileId) {
        await notifyOrgAdmins(String(listing.profileId), {
          type: 'community.review',
          title: approving
            ? `"${listing.displayName}" v${version} approved`
            : `"${listing.displayName}" v${version} was not approved`,
          body: approving
            ? 'It is now the version new installs receive.'
            : reason,
          orgId: String(listing.profileId),
          link: '/',
        }).catch(() => undefined)
        await emailPublisher(
          String(listing.profileId),
          approving
            ? `${listing.displayName} v${version} passed review`
            : `${listing.displayName} v${version} was not approved`,
          approving
            ? `Your plugin version ${version} has been approved and is now ` +
              'the version new installs receive. Existing installs stay on ' +
              'the version they pinned until their site owners upgrade.'
            : `Your plugin version ${version} was not approved.\n\n` +
              `Reason: ${reason}\n\nPublishing a new version puts it back ` +
              'in the review queue. The previously approved version, if any, ' +
              'keeps installing in the meantime.',
        )
      }

      return Response.json(
        { ok: true, version, reviewState: approving ? 'approved' : 'rejected' },
        { status: 200 },
      )
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
        await emailPublisher(
          publisherOrgId,
          action === 'reject'
            ? `${listing.displayName} was rejected`
            : action === 'delist'
              ? `${listing.displayName} was removed from the marketplace`
              : `${listing.displayName} is now ${nextStatus}`,
          action === 'reject' || action === 'delist'
            ? reason ||
              'It has been removed from the marketplace while we take ' +
                'another look. Existing installs keep working.'
            : 'Your plugin passed review and is live in the marketplace.',
        )
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
