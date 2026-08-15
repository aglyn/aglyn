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
  REVOKED_VERSION_REVIEW_STATE,
  revocationWithdrawsReviewedClaim,
  shouldStripVerifiedOnTakedown,
  VERIFIED_STRIPPED_STATUS,
} from '../../../../constants/plugin-review-status'
import {
  checkPluginBundle,
  isPluginRevoked,
  isStoredVerdictCurrent,
  nextRevocationState,
  PLUGIN_HOST_ABI_VERSION,
  PLUGIN_VERIFIER_VERSION,
  pluginArtifactPath,
  pluginRequestFromWeb,
  type PluginRevocation,
  type StoredBundleVerdict,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  findUserByUidAcrossPools,
  firebaseAdmin,
  isImpersonationSession,
  updateExisting,
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
import {
  pluginRejectionCategory,
  rejectionHeadline,
  rejectionInputError,
} from '../../../../constants/plugin-rejection-categories'
import { attestationsForBytes } from '@aglyn/aglyn/app-utils/publisher-attestation'
import { VERIFICATION_DECLINE_COOLDOWN_DAYS } from '@aglyn/aglyn/app-utils/marketplace-verification'
import {
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementState,
} from '@aglyn/aglyn/app-utils/publisher-agreement'
import { FieldValue } from 'firebase-admin/firestore'
import {
  listOrgMembers,
  meterPlatformEmail,
  notifyOrgAdmins,
} from '@aglyn/tenant-data-admin'
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
    const results = await Promise.all(
      recipients.map((to) =>
        sendEmail({ to, subject, text, context: 'plugin review update' }),
      ),
    )
    // Cost meter (AGL-1438). Platform-scoped: marketplace review is Aglyn's
    // own workflow talking to a publisher, not mail the publisher's org sent.
    await meterPlatformEmail(results.filter((result) => result.sent).length)
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
  const listingRef = firestore.collection('marketplaceListings').doc(listingId)
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

  // Which terms this publisher is actually under (AGL-1077). A reviewer
  // weighing a takedown, a delist, or a revocation is deciding what we are
  // entitled to do — and that is answered by the agreement the ORG accepted,
  // not by the per-version attestation beside it.
  const publisherProfile = publisherId
    ? await firestore.collection('publisherProfiles').doc(publisherId).get()
    : null
  const acceptance = publisherProfile?.get('publisherAgreement') as
    | { version?: string; acceptedBy?: string; acceptedAt?: { toDate?: () => Date } }
    | undefined

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
    ? {
        ok: stored?.ok,
        problems: stored?.problems ?? [],
        // The per-check summary rides along in the stored verdict (AGL-1087)
        // so the page can show what was checked without re-downloading a
        // megabyte of artifact on every view.
        checks: stored?.checks ?? [],
      }
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
      // The manifest for THESE bytes, so an undeclared network call is a
      // finding rather than a warning (AGL-964). Read from the version doc,
      // never from the listing — capabilities change between versions.
      const result = checkPluginBundle(bytes.toString('utf8'), {
        declaredNetwork: Array.isArray(reviewEntry?.capabilities?.network)
          ? reviewEntry.capabilities.network.map((origin: unknown) =>
              String(origin),
            )
          : [],
      })
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
              checks: result.checks,
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
      // Across pools (AGL-1122): an SSO attester is invisible to project-level
      // `getUser`, so this fell through to the catch and the review page named
      // the attester by raw uid — indistinguishable from "account deleted".
      const found = await findUserByUidAcrossPools(attesterUid)
      if (found) {
        attestedBy =
          found.record.email ?? found.record.displayName ?? attesterUid
      }
    } catch {
      // Account gone — the uid still identifies the statement.
    }
  }

  return Response.json(
    {
      listingId,
      displayName: listing.displayName ?? listingId,
      description: listing.description ?? '',
      // The publisher's ask, so the page can offer Decline beside Verify
      // (AGL-1217). Serialized: `decidedAt`/`requestedAt` are Timestamps and
      // this payload crosses JSON.
      verificationRequest: listing.verificationRequest
        ? {
            state: String(listing.verificationRequest.state ?? ''),
            requestedAt:
              listing.verificationRequest.requestedAt?.toDate?.()?.toISOString() ??
              null,
            declineReason: listing.verificationRequest.declineReason ?? null,
          }
        : null,
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
      rejectionCategory: listing.rejectionCategory ?? '',
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
        ({ verification, reviewChecklist, publisherAttestation, ...entry }) => ({
          ...entry,
          // Per-version kill-switch state (AGL-1085), read through the same
          // helper the loaders use so the page cannot disagree with the
          // runtime about whether these bytes are stopped.
          revoked: isPluginRevoked(
            revocation as PluginRevocation | undefined,
            entry.version,
          ),
        }),
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
      // The publisher agreement this ORG is under (AGL-1077). `current` is
      // computed here rather than shipped as a boolean so the page can say
      // "on an older version" — which is a different thing from never
      // having accepted, and matters differently to a takedown decision.
      publisherAgreement: {
        version: acceptance?.version ?? null,
        acceptedAt: acceptance?.acceptedAt?.toDate?.()?.toISOString() ?? null,
        required: PUBLISHER_AGREEMENT_VERSION,
        state: publisherAgreementState(acceptance),
      },
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
        .collection('marketplaceListings')
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
              // The publisher's standing ask for the badge (AGL-1217).
              verificationRequest: listing.verificationRequest ?? null,
            }
          }),
      )
      // Awaiting review = the newest bytes have no approval, whatever the
      // listing says. That is what puts an update in front of staff.
      const queue = rows.filter((row) => row.latestReviewState !== 'approved')
      // A THIRD bucket, deliberately not folded into `queue` (AGL-1217).
      // `queue` means "these bytes have not been read"; a verification request
      // means "this publisher asked us to vouch for who they are". They are
      // different questions with different work attached, and a listing can
      // sit in both at once — an update pending review from a publisher who
      // has also asked for the badge. Merging them would hide one behind the
      // other and make the count meaningless.
      const verificationRequests = rows.filter(
        (row) => row.verificationRequest?.state === 'pending',
      )
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
      return Response.json(
        { queue, listed, publishers, verificationRequests },
        { status: 200 },
      )
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
            .collection('marketplaceListings')
            .doc(listingId)
            .collection('reviews')
            .doc(reviewUid)
        : firestore.collection('marketplaceListings').doc(listingId)
      const targetSnapshot = await target.get()
      if (!targetSnapshot.exists) {
        return Response.json({ error: 'Unknown target' }, { status: 404 })
      }
      // A takedown strips the Verified badge (AGL-1121, decided 2026-08-03).
      //
      // Verified is OUR claim that a human vouched for this publisher. Taking
      // the listing down is us saying the opposite out loud, so the two cannot
      // both stand — a badge surviving a takedown would still be asserting the
      // vouch on the listing page the moment it was restored.
      //
      // Demoted to `listed`, not to `rejected` or `submitted`: the takedown
      // itself is what makes it non-browsable (`hiddenAt`), and rewriting the
      // review verdict would destroy the record of a review that did happen.
      //
      // Restoring deliberately does NOT put the badge back. Re-granting is
      // `verify`, which re-checks the review checklist server-side; an automatic
      // regrant would hand back the badge without anyone re-forming the opinion
      // behind it. Losing it to a takedown is meant to cost a re-review.
      const stripVerified = shouldStripVerifiedOnTakedown({
        action,
        reviewStatus: targetSnapshot.get('reviewStatus'),
        isListingTarget: !reviewUid,
      })
      await target.set(
        reviewUid
          ? { hidden: action === 'hide' }
          : action === 'hide'
            ? {
                hiddenAt: FieldValue.serverTimestamp(),
                hiddenBy: decoded.uid,
                hiddenReason: hideReason,
                ...(stripVerified
                  ? { reviewStatus: VERIFIED_STRIPPED_STATUS }
                  : {}),
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
        const current = (await revocationRef.get()).data() as
          | PluginRevocation
          | undefined
        // Both transitions go through the shared helper (AGL-1085) so a
        // takedown and a per-version review revocation can coexist. Restoring
        // used to DELETE the doc whenever it was takedown-owned, which also
        // un-revoked any version a reviewer had stopped for an unrelated
        // reason — `reviewVersions` is what survives the round trip.
        const next = nextRevocationState(current, {
          type: action === 'hide' ? 'takedown' : 'restore',
        })
        if (next) {
          await revocationRef.set(
            {
              ...next,
              ...(action === 'hide' ? { reason: hideReason } : {}),
              revokedBy: decoded.uid,
              revokedAt: FieldValue.serverTimestamp(),
              // A restore drops takedown ownership; the field has to go, not
              // merely be overwritten, or the next restore re-deletes.
              ...(action === 'hide' ? {} : { source: FieldValue.delete() }),
            },
            { merge: true },
          )
        } else if (current) {
          await revocationRef.delete()
        }
      }

      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        action: `plugins.takedown.${action}`,
        target: reviewUid
          ? `marketplaceListings/${listingId}/reviews/${reviewUid}`
          : `marketplaceListings/${listingId}`,
        after: {
          hidden: action === 'hide',
          ...(hideReason ? { reason: hideReason } : {}),
          ...(isPlugin ? { revoked: action === 'hide' } : {}),
          // Recorded because it is a side effect of the takedown rather than
          // something the reviewer asked for, and because getting it back is a
          // re-review rather than an undo.
          ...(stripVerified ? { unverified: true } : {}),
        },
        at: FieldValue.serverTimestamp(),
      })

      return Response.json(
        {
          ok: true,
          hidden: action === 'hide',
          revoked: isPlugin && action === 'hide',
          // The caller shows this — a badge silently disappearing would be
          // worse than one that never existed.
          unverified: stripVerified,
        },
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
        .collection('marketplaceListings')
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
        target: `marketplaceListings/${listingId}/pluginVersions/${version}`,
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
      const listingRef = firestore.collection('marketplaceListings').doc(listingId)
      const versionRef = listingRef.collection('pluginVersions').doc(version)
      const versionSnapshot = await versionRef.get()
      if (!versionSnapshot.exists) {
        return Response.json({ error: 'Unknown version' }, { status: 404 })
      }
      // The LISTING has to exist too, and the check belongs up here rather
      // than beside the writes that need it (AGL-1766). A version outliving
      // its listing is not hypothetical — Firestore deletes are not
      // recursive, so `pluginVersions` survives whatever removed the parent.
      //
      // The read below used to be `(await listingRef.get()).data() ?? {}`,
      // and that default was not a convenience: it is what made the two
      // mirrors fire. Both of their conditions are TRUE on `{}` —
      // `!['listed','verified'].includes('')` and `previous == null` — so an
      // absent listing was resurrected as `{ reviewStatus: 'listed' }`, i.e.
      // browsable in the marketplace, from a merge-set. (The third mirror,
      // `latestVersionReviewState`, compares `String(latestVersion ?? '')`
      // against a non-empty `version` and is false on `{}` — it could not
      // fire. The pattern is not uniform even inside one block, which is
      // exactly why AGL-1763 could not express this as a lint rule.)
      //
      // Read BEFORE the verdict write, not after it. Refusing must not
      // discard work that already happened (AGL-1760); refusing here happens
      // before anything has, so the reviewer simply retries against a
      // listing that exists. `?? {}` is gone with it — kept, it would have
      // traded a resurrection for an `update()` rejection served as a 500.
      const listingSnapshot = await listingRef.get()
      if (!listingSnapshot.exists) {
        return Response.json({ error: 'Unknown listing' }, { status: 404 })
      }
      const listing = listingSnapshot.data()
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
      // Structured rejection (AGL-977). The category is what makes rejections
      // comparable across reviewers and queryable afterwards; the comment is
      // what makes one actionable. Requiring only free text gave neither.
      const category = String(body?.category ?? '')
      if (!approving) {
        const invalid = rejectionInputError(category, reason)
        if (invalid) return Response.json({ error: invalid }, { status: 400 })
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
          ...(approving
            ? {
                // Clear a previous rejection's fields on approval, or a
                // version that was rejected and then approved keeps
                // explaining why it was turned down.
                reviewRejectionReason: FieldValue.delete(),
                reviewRejectionCategory: FieldValue.delete(),
              }
            : {
                reviewRejectionReason: reason,
                reviewRejectionCategory: category,
              }),
        },
        { merge: true },
      )

      // A plugin with its first approved version becomes browsable. Later
      // approvals never change listing status — that is the point: an
      // update is reviewed without disturbing what customers already have.
      //
      // The three mirrors below write through `updateExisting` as the second
      // line for the window the check above cannot close — a listing deleted
      // mid-handler. Every payload here is FLAT with no delete sentinel, so
      // the switch is semantically identical to the merge-set it replaces;
      // the `false` return needs no branch, because a listing that is gone by
      // now wants nothing mirrored onto it.

      // Mirror this verdict onto the listing for the marketplace (AGL-1121),
      // but ONLY when it is the newest version. Approving an old version
      // must not let the listing claim its newest bytes were reviewed —
      // which is the exact shape of the bug this mirror exists to fix.
      if (String(listing.latestVersion ?? '') === version) {
        await updateExisting(listingRef, {
          latestVersionReviewState: approving ? 'approved' : 'rejected',
        })
      }
      if (
        approving &&
        !['listed', 'verified'].includes(String(listing.reviewStatus ?? ''))
      ) {
        await updateExisting(listingRef, {
          reviewStatus: 'listed',
          updatedAt: FieldValue.serverTimestamp(),
        })
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
          await updateExisting(listingRef, {
            latestApprovedVersion: version,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }

      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        action: `plugins.review.version.${approving ? 'approve' : 'reject'}`,
        target: `marketplaceListings/${listingId}/pluginVersions/${version}`,
        after: {
          sha256,
          ...(reason ? { reason } : {}),
          // Both, not one (AGL-971 + AGL-977): the category is what an audit
          // can be counted by, the comment is what makes a single row make
          // sense to a human reading it later.
          ...(category ? { category } : {}),
        },
        at: FieldValue.serverTimestamp(),
      })

      // Pins sitting on these exact bytes right now (AGL-1085). Rejecting a
      // version does NOT stop it — the runtime resolves a pin by
      // {version, sha256} and only asks whether it is revoked — so both
      // sides have to be told, and the reviewer needs the number before
      // deciding whether to reach for the kill switch.
      const liveInstalls = Number(versionSnapshot.get('activeInstalls') ?? 0)
      const stranded = !approving && liveInstalls > 0

      if (listing.profileId) {
        await notifyOrgAdmins(String(listing.profileId), {
          type: 'marketplace.review',
          title: approving
            ? `"${listing.displayName}" v${version} approved`
            : `"${listing.displayName}" v${version} was not approved`,
          body: approving
            ? 'It is now the version new installs receive.'
            : stranded
              ? `${reason}\n\nThis version is still installed on ` +
                `${liveInstalls} site${liveInstalls === 1 ? '' : 's'}. ` +
                'Rejecting it does not remove it — uninstall or roll back.'
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
              'keeps installing in the meantime.' +
              (stranded
                ? `\n\nNote: v${version} is still installed on ` +
                  `${liveInstalls} site${liveInstalls === 1 ? '' : 's'}. ` +
                  'A rejection stops new installs, it does not remove an ' +
                  'existing one — uninstall it or roll back to an approved ' +
                  'version.'
                : ''),
        )
      }

      return Response.json(
        {
          ok: true,
          version,
          reviewState: approving ? 'approved' : 'rejected',
          // Lets the reviewer's confirmation say what it actually did, and
          // offer the kill switch when the bytes are live somewhere.
          liveInstalls,
          stranded,
        },
        { status: 200 },
      )
    }

    // Per-version kill switch (AGL-1085). Until now a reviewer's only way to
    // stop live bytes was a listing-wide takedown, which also revokes the
    // approved version customers are happily running and hides the listing.
    // Rejection deliberately stays a verdict rather than a kill: most
    // rejections are a thin README, and an unannounced site outage is worse
    // than the gap. This is the deliberate, adjacent action.
    //
    // This does NOT strip the Verified badge, unlike a takedown (AGL-1121).
    // The two claims are scoped differently and the split is the whole point:
    // Verified says a human vouched for the PUBLISHER and survives version
    // bumps, while the separate "Reviewed" chip speaks for THESE bytes and is
    // re-earned per version. Stripping the publisher claim for one bad release
    // would punish an honest mistake, and is not reversible without a full
    // re-review. A takedown is the action that contradicts the publisher claim,
    // and that one does strip it.
    //
    // That reasoning only holds because the BYTES claim is withdrawn instead —
    // which it now is, below. It was not before, and the gap is what made
    // keeping the badge unsafe rather than merely debatable.
    if (action === 'revoke-version' || action === 'unrevoke-version') {
      const version = String(body?.version ?? '')
      if (!listingId || !version) {
        return Response.json(
          { error: 'Listing and version required' },
          { status: 400 },
        )
      }
      const listingRef = firestore.collection('marketplaceListings').doc(listingId)
      const listing = (await listingRef.get()).data() ?? {}
      const revocationRef = firestore.collection('revocations').doc(listingId)
      const current = (await revocationRef.get()).data() as
        | PluginRevocation
        | undefined
      const revoking = action === 'revoke-version'
      const next = nextRevocationState(current, {
        type: revoking ? 'revoke-version' : 'unrevoke-version',
        version,
      })
      if (next) {
        await revocationRef.set(
          {
            ...next,
            reason: String(body?.reason ?? current?.reason ?? '').slice(0, 500),
            revokedBy: decoded.uid,
            revokedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      } else {
        await revocationRef.delete()
      }

      // Withdraw the "Reviewed" chip when the bytes we just killed are the ones
      // customers are being offered (AGL-1121).
      //
      // This was ASSUMED to happen already and did not. `latestVersionReviewState`
      // is written only by approve/reject and on publish, so a version approved
      // and later revoked kept `'approved'` — and since a per-version revocation
      // deliberately does NOT hide the listing (that is the whole difference from
      // a takedown), the marketplace went on showing "A human at Aglyn read these
      // exact bytes" about bytes we had just stopped from executing. Revocation
      // is not surfaced anywhere else in the browse or listing UI either, so
      // nothing contradicted it.
      //
      // `revoked` rather than `rejected`: it was not turned down in review, it
      // was killed afterwards, and the audit trail should not blur those. Both
      // consumers test against `'approved'`, so this correctly drops the chip and
      // raises the caution alert.
      //
      // Only when it is the LATEST version, because that is what both consumers
      // describe. Revoking an old version says nothing about what is on offer.
      const isLatest = revocationWithdrawsReviewedClaim({
        revokedVersion: version,
        latestVersion: String(listing['latestVersion'] ?? ''),
      })
      if (isLatest) {
        const versionSnapshot = await listingRef
          .collection('pluginVersions')
          .doc(version)
          .get()
        await listingRef.set(
          {
            latestVersionReviewState: revoking
              ? REVOKED_VERSION_REVIEW_STATE
              : // Restoring returns it to whatever the version's own verdict
                // says, rather than assuming `approved` — un-revoking a version
                // that was never approved must not promote it.
                String(versionSnapshot.get('reviewState') ?? 'pending'),
          },
          { merge: true },
        )
      }

      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        action: `plugins.revocation.${revoking ? 'revoke' : 'restore'}`,
        target: `marketplaceListings/${listingId}/pluginVersions/${version}`,
        after: {
          versions: next?.versions ?? null,
          ...(isLatest ? { latestVersionReviewStateChanged: true } : {}),
        },
        at: FieldValue.serverTimestamp(),
      })

      if (listing.profileId) {
        await notifyOrgAdmins(String(listing.profileId), {
          type: 'marketplace.review',
          title: revoking
            ? `"${listing.displayName}" v${version} was stopped`
            : `"${listing.displayName}" v${version} was allowed to run again`,
          body: revoking
            ? 'It has been disabled on every site running it. Sites showing ' +
              'this plugin now render a placeholder.'
            : 'Sites running it are no longer blocked.',
          orgId: String(listing.profileId),
          link: '/',
        }).catch(() => undefined)
      }

      return Response.json(
        { ok: true, version, revoked: revoking },
        { status: 200 },
      )
    }

    // Declining a verification request (AGL-1217). Handled before the ACTIONS
    // lookup because it deliberately has NO `reviewStatus` to move to: the
    // listing stays exactly as live as it was. Refusing a badge is not a
    // verdict on the code, and routing it through the status ladder would
    // make it one.
    if (action === 'decline-verification') {
      const declineReason = String(body?.reason ?? '').trim().slice(0, 500)
      if (!listingId) {
        return Response.json({ error: 'Unknown action' }, { status: 400 })
      }
      // Required, unlike most fields here. The publisher is notified of this
      // and then has to wait out a cooldown before asking again; "no, and we
      // will not say why, try in a month" is not a usable answer.
      if (!declineReason) {
        return Response.json(
          { error: 'A reason is required — the publisher is told it' },
          { status: 400 },
        )
      }
      const listingRef = firestore
        .collection('marketplaceListings')
        .doc(listingId)
      const listing = (await listingRef.get()).data()
      if (!listing) {
        return Response.json({ error: 'Unknown listing' }, { status: 404 })
      }
      if (listing.verificationRequest?.state !== 'pending') {
        return Response.json(
          { error: 'No verification request is waiting' },
          { status: 409 },
        )
      }
      await listingRef.set(
        {
          verificationRequest: {
            ...listing.verificationRequest,
            state: 'declined',
            decidedAt: FieldValue.serverTimestamp(),
            decidedBy: decoded.uid,
            declineReason,
          },
        },
        { merge: true },
      )
      const publisherOrgId = String(listing.profileId ?? '')
      if (publisherOrgId) {
        await notifyOrgAdmins(publisherOrgId, {
          type: 'marketplace.review',
          title: `Verification declined for "${listing.displayName}"`,
          // Says plainly that nothing about the listing changed. Without it a
          // publisher reads "declined" as a takedown of the plugin itself.
          body:
            `${declineReason}\n\nYour plugin is unaffected and stays listed. ` +
            `You can request verification again in ` +
            `${VERIFICATION_DECLINE_COOLDOWN_DAYS} days.`,
          orgId: publisherOrgId,
          link: '/',
        }).catch(() => undefined)
      }
      return Response.json({ ok: true, state: 'declined' }, { status: 200 })
    }

    const nextStatus = ACTIONS[action]
    if (!listingId || !nextStatus) {
      return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
    const reason = String(body?.reason ?? '').slice(0, 500)
    const category = String(body?.category ?? '')
    if (action === 'reject') {
      const invalid = rejectionInputError(category, reason)
      if (invalid) return Response.json({ error: invalid }, { status: 400 })
    }

    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
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
        // Granting the badge answers any request that was waiting (AGL-1217).
        // Left alone it would sit `pending` forever, so the staff queue would
        // keep offering a decision on a listing that already has the badge,
        // and the publisher's button would stay disabled as "already pending"
        // with nothing to wait for.
        //
        // Only when something is actually waiting: a `verify` on a listing
        // nobody asked about must not invent a request that was never made.
        ...(action === 'verify' &&
        listing.verificationRequest?.state === 'pending'
          ? {
              verificationRequest: {
                ...listing.verificationRequest,
                state: 'granted',
                decidedAt: FieldValue.serverTimestamp(),
                decidedBy: decoded.uid,
              },
            }
          : {}),
        ...(action === 'reject'
          ? { rejectionReason: reason, rejectionCategory: category }
          : {
              rejectionReason: FieldValue.delete(),
              rejectionCategory: FieldValue.delete(),
            }),
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
          type: 'marketplace.review',
          title:
            action === 'reject'
              ? `"${listing.displayName}" was rejected`
              : action === 'delist'
                ? `"${listing.displayName}" is back in review`
                : `"${listing.displayName}" is now ${nextStatus}`,
          body:
            action === 'reject'
              ? // Category, then what to do about it, then the reviewer's own
                // words (AGL-977). The publisher's first question is "what do
                // I fix" — a bare comment answered that only as well as the
                // reviewer happened to write it.
                [
                  pluginRejectionCategory(category)?.label,
                  pluginRejectionCategory(category)?.guidance,
                  reason,
                ]
                  .filter(Boolean)
                  .join('\n\n')
              : action === 'delist'
                ? reason ||
                  'It has been removed from the marketplace while we take ' +
                    'another look. Existing installs keep working.'
                : 'Your plugin passed review.',
          orgId: publisherOrgId,
          link: publisherSlug
            ? buildRoute(Route.ORG_MARKETPLACE, {
                orgSlug: publisherSlug,
              })
            : '/',
        }).catch(() => undefined)
        await emailPublisher(
          publisherOrgId,
          action === 'reject'
            ? `${listing.displayName} was rejected — ${rejectionHeadline(
                category,
                reason,
              )}`
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
      target: `marketplaceListings/${listingId}`,
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
