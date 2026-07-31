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
  checkEntitlement,
  checkPluginBundle,
  createResourceUid,
  MAX_PLUGIN_BUNDLE_BYTES,
  type PluginApiHandler,
  pluginArtifactPath,
  PLUGIN_VERIFIER_VERSION,
  validatePluginManifest,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForUser,
  notifyStaff,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  canActAsPublisher,
  resolvePublisherProfile,
} from './publisher-profile'
import {
  attestationLabels,
  missingAttestations,
  missingAttestationSubjects,
  PUBLISHER_ATTESTATION,
} from '@aglyn/aglyn/app-utils/publisher-attestation'
import {
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementRefusal,
  publisherAgreementState,
} from '@aglyn/aglyn/app-utils/publisher-agreement'
import { createHash } from 'crypto'
import {
  COMMUNITY_MAX_PRICE_USD,
  missingPublicListingContent,
  validateListingContent,
} from '../model/community'

// Base64 bundle bodies: a small JS plugin bundle, capped generously.
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024

/**
 * Publishes an executable plugin to the community (AGL-45), per the AGL-43
 * artifact pipeline — relocated from the console app route into the
 * community plugin (AGL-418); URL `/api/community/publish-plugin` is
 * preserved through the dispatcher. Runs server-side so validation
 * (manifest schema, size caps) can't be bypassed: the bundle is
 * content-addressed (sha256) and written IMMUTABLY to the isolated
 * artifacts bucket, and the version entry records the hash the loader
 * verifies before executing. Env-gated on `PLUGIN_ARTIFACTS_BUCKET` —
 * 501 degrades like other platform infra. Requirements: publish
 * permission, community profile, Pro plan; paid listings need completed
 * Stripe Connect onboarding.
 */
const updateListingContent: PluginApiHandler = async (req, res) => {
  const listingId = String(req.body?.listingId ?? '')
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const verdict = validateListingContent(req.body ?? {})
  if (!verdict.ok) return res.status(400).json({ error: verdict.error })
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const listingRef = firebaseAdmin
      .app()
      .firestore()
      .collection('communityListings')
      .doc(listingId)
    const listing = (await listingRef.get()).data()
    if (!listing || listing.deletedAt) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    // Org-owned listings (AGL-652): a uid never equals an org id, so the
    // old identity comparison would lock publishers out of their own listing.
    const isPublisher = await canActAsPublisher(
      firebaseAdmin.app().firestore(),
      decoded.uid,
      listing.profileId,
    )
    if (!isPublisher && decoded['staff'] !== true) {
      return res.status(403).json({ error: 'Not your listing' })
    }
    // Name and description are the whole first impression of a listing in
    // browse, and until AGL-793 they were the only listing-content fields with
    // no edit path — a typo in either could only be corrected by publishing a
    // fake new version, which signals "there's an update" to every installer.
    // Same caps the publish routes apply. An empty name is ignored rather than
    // accepted: a nameless listing is unrecognisable in the catalogue.
    const description = req.body?.description
    const displayName = req.body?.displayName
    const nextName =
      typeof displayName === 'string' ? displayName.trim().slice(0, 80) : ''
    await listingRef.set(
      {
        ...verdict.content,
        ...(typeof description === 'string'
          ? { description: description.slice(0, 500) }
          : {}),
        ...(nextName ? { displayName: nextName } : {}),
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Listing update failed' })
  }
}

/**
 * Flip a listing between private and public (AGL-968/994).
 *
 * Deliberately NOT a re-review. Per-version `reviewState` and the listing's
 * `reviewStatus` are left exactly as they are: approval is a statement about
 * specific bytes (AGL-966), and who may install them was never part of that
 * statement. Sending an already-approved bundle back through the queue
 * because its audience widened would only teach publishers to start public.
 *
 * Going public does require what a public listing needs — see
 * {@link missingPublicListingContent}. Going private is unconditional: it
 * only ever removes reach.
 */
const setListingVisibility: PluginApiHandler = async (req, res) => {
  const listingId = String(req.body?.listingId ?? '')
  const visibility = req.body?.visibility === 'private' ? 'private' : 'public'
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const listingRef = firestore.collection('communityListings').doc(listingId)
    const listing = (await listingRef.get()).data()
    if (!listing || listing.deletedAt) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    const isPublisher = await canActAsPublisher(
      firestore,
      decoded.uid,
      listing.profileId,
    )
    if (!isPublisher && decoded['staff'] !== true) {
      return res.status(403).json({ error: 'Not your listing' })
    }
    if (visibility === 'public') {
      const missing = missingPublicListingContent(listing)
      if (missing.length) {
        return res.status(400).json({
          error:
            'A marketplace listing needs ' +
            missing.join(', ') +
            '. Add them in Edit, then publish it.',
          missing,
        })
      }
    }
    await listingRef.set(
      {
        visibility,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return res.status(200).json({ ok: true, visibility })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Visibility change failed' })
  }
}

export const publishPluginHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  // Content-only listing edits (AGL-430): publishers refresh the docs the
  // detail page renders (readme/screenshots/links/…) without shipping a
  // new bundle. Publisher-or-staff, validated exactly like publish.
  if (req.body?.action === 'update-listing') {
    return updateListingContent(req, res)
  }
  // Private ⇄ public (AGL-968/994), without shipping a new bundle.
  if (req.body?.action === 'set-visibility') {
    return setListingVisibility(req, res)
  }
  const body = req.body ?? {}
  const headers = req.headers as Partial<Record<string, string>>
  const displayName = String(body?.displayName ?? '').slice(0, 80)
  const description = String(body?.description ?? '').slice(0, 500)
  const category = String(body?.category ?? '').slice(0, 40)
  const changelog = String(body?.changelog ?? '').slice(0, 1000)
  const priceUsd = Math.round(Number(body?.priceUsd ?? 0)) || 0
  const bundleBase64 = String(body?.bundle ?? '')
  // Listing content (AGL-430): optional publisher docs for the detail page.
  const contentVerdict = validateListingContent(body ?? {})
  if (!contentVerdict.ok) {
    return res.status(400).json({ error: contentVerdict.error })
  }
  if (priceUsd < 0 || priceUsd > COMMUNITY_MAX_PRICE_USD) {
    return res
      .status(400)
      .json({ error: `Price must be 0–${COMMUNITY_MAX_PRICE_USD} USD` })
  }
  if (!displayName.trim() || !bundleBase64) {
    return res.status(400).json({ error: 'Missing displayName or bundle' })
  }

  const validation = validatePluginManifest(body?.manifest)
  if (validation.ok === false) {
    return res.status(422).json({ error: validation.error })
  }
  const manifest = validation.manifest

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    // Act on the org the client is in (AGL-868), not a guessed first-org — a
    // member can belong to several, and the plugin publishes under one of them.
    const requestedOrgId = String(body?.orgId ?? '').trim() || undefined
    const membership = await resolveOrgPermissions(decoded.uid, {
      orgId: requestedOrgId,
    })
    if (!membership.permissions.publishToCommunity) {
      return res.status(403).json({
        error:
          'Your organization role does not allow publishing to the community',
      })
    }
    const firestore = firebaseAdmin.app().firestore()

    // Plan gate rides the acting org's doc (AGL-238/868).
    const orgForUser = await getOrgForUser(
      decoded.uid,
      membership.orgId ?? requestedOrgId,
    )
    const org = orgForUser?.org ?? {}
    if (!checkEntitlement(org, 'marketplaceSelling')) {
      return res
        .status(403)
        .json({ error: 'Publishing to the community requires a Pro plan' })
    }

    // Publish rate limit (AGL-437): a runaway or abusive publisher can't
    // flood the artifacts bucket/review queue — 20 publishes per UTC day.
    // Scoped to the publishing ORG (AGL-652): per-user it would multiply by
    // headcount, letting a big team flood the queue 20 publishes at a time.
    const dayKey = new Date().toISOString().slice(0, 10)
    if (!orgForUser?.orgId) {
      return res.status(409).json({ error: 'No publishing organization' })
    }
    const limiterRef = firestore
      .collection('publisherProfiles')
      .doc(orgForUser.orgId)
      .collection('meta')
      .doc('publishWindow')
    const allowed = await firestore.runTransaction(async (transaction) => {
      const window = (await transaction.get(limiterRef)).data() ?? {}
      const count = window.dayKey === dayKey ? Number(window.count ?? 0) : 0
      if (count >= 20) return false
      transaction.set(limiterRef, { dayKey, count: count + 1 })
      return true
    })
    if (!allowed) {
      return res
        .status(429)
        .json({ error: 'Daily publish limit reached — try again tomorrow' })
    }

    const publisher = await resolvePublisherProfile(firestore, orgForUser.orgId)
    if (!publisher) {
      return res.status(412).json({
        error:
          'Set up your publisher profile first — Marketplace → Profile.',
      })
    }
    if (priceUsd > 0 && !publisher.stripeChargesEnabled) {
      return res.status(412).json({
        error: 'Set up payouts first — Marketplace → Payouts — to sell.',
      })
    }

    // The publisher agreement (AGL-1077). A precondition on the ORG, checked
    // here beside the profile and payout preconditions it belongs with —
    // deliberately NOT the 428 the attestation uses. "You did not confirm
    // the checklist for this bundle" and "your organization has never agreed
    // to our terms" are different problems, fixed in different places, and a
    // shared status code would send a publisher back to the checklist to
    // tick something that is already ticked.
    //
    // An acceptance of an older version does not count: whoever publishes
    // next reads the changed agreement and accepts it, or does not publish.
    const agreementState = publisherAgreementState(publisher.agreement)
    if (agreementState !== 'current') {
      return res.status(412).json({
        error: publisherAgreementRefusal(agreementState),
        agreement: {
          required: PUBLISHER_AGREEMENT_VERSION,
          accepted: publisher.agreement?.version ?? null,
          state: agreementState,
        },
      })
    }

    const bundle = Buffer.from(bundleBase64, 'base64')
    if (!bundle.length || bundle.length > MAX_BUNDLE_BYTES) {
      return res.status(413).json({ error: 'Bundle is empty or too large' })
    }
    // Static verification (AGL-426): the same checks as the local
    // `verify-plugin-bundle.mjs`, so a bundle that passes there publishes
    // here. Entry exports, self-containment, forbidden APIs, size.
    //
    // The manifest goes in too (AGL-964): the checker diffs the bundle's
    // network calls against the origins declared here, and a call to an
    // origin the manifest omits is refused at publish rather than silently
    // blocked by the CSP at runtime, where the publisher would meet it as a
    // mystery in production.
    const verification = checkPluginBundle(bundle.toString('utf8'), {
      maxBytes: MAX_PLUGIN_BUNDLE_BYTES,
      declaredNetwork: manifest.capabilities?.network ?? [],
    })
    if (!verification.ok) {
      return res.status(422).json({
        error: 'Bundle failed verification',
        problems: verification.problems,
      })
    }
    const sha256 = createHash('sha256')
      .update(new Uint8Array(bundle))
      .digest('hex')

    // Isolated artifacts bucket (AGL-43 §3). Without it configured we
    // refuse rather than store executable code in the app bucket.
    const artifactsBucket = process.env.PLUGIN_ARTIFACTS_BUCKET
    if (!artifactsBucket) {
      return res.status(501).json({
        error:
          'Plugin publishing is not configured (missing ' +
          'PLUGIN_ARTIFACTS_BUCKET).',
      })
    }

    // One listing per publisher+plugin id: re-publishing bumps the version.
    const existing = await firestore
      .collection('communityListings')
      .where('profileId', '==', publisher.orgId)
      .where('pluginId', '==', manifest.id)
      .limit(1)
      .get()
    const listingRef = existing.empty
      ? firestore.collection('communityListings').doc(createResourceUid())
      : existing.docs[0].ref

    // Pre-submission attestation (AGL-969). Blocks the publish rather than
    // warning, because the whole point is that these answers exist BEFORE a
    // reviewer spends time on the bundle.
    //
    // Whether this is an update is decided here, from whether a listing
    // already exists — never from a client flag, which would make "this is
    // my first version" a way to skip the changelog item.
    const ticked = (
      Array.isArray(body?.attestation)
        ? body.attestation.map((id: unknown) => String(id))
        : []
    ).filter((id: string) =>
      PUBLISHER_ATTESTATION.some((item) => item.id === id),
    )
    const isUpdate = !existing.empty
    const missing = missingAttestations(ticked, isUpdate)
    if (missing.length) {
      return res.status(428).json({
        error:
          'Confirm the pre-submission checklist before publishing: ' +
          attestationLabels(missing).join('; '),
        missingAttestations: missing,
      })
    }

    // An attestation needs something to be about (AGL-1076). `repository`
    // was confirmable in a form with no repository field, so listings
    // reached review carrying a signed claim that a URL we never collected
    // was public and matched — and the reviewer's first link went nowhere.
    //
    // Checked against the SUBMISSION, not the listing doc: a first publish
    // has no listing, and on an update the tick is a statement about what
    // this publish declares. `contentVerdict.content` is the normalized
    // value about to be stored, so the gate and the write cannot disagree.
    const missingSubjects = missingAttestationSubjects(
      contentVerdict.content as Record<string, unknown>,
      isUpdate,
    )
    if (missingSubjects.length) {
      return res.status(428).json({
        error:
          'These are confirmed above but not filled in: ' +
          missingSubjects.map((subject) => subject.label).join('; '),
        missingAttestationSubjects: missingSubjects.map(
          (subject) => subject.field,
        ),
      })
    }

    // Immutable content-addressed write — a new build is a new object, so a
    // consumer's pinned version can never be overwritten underneath it.
    const objectPath = pluginArtifactPath(
      listingRef.id,
      manifest.version,
      sha256,
    )
    const bucket = firebaseAdmin.app().storage().bucket(artifactsBucket)
    const file = bucket.file(objectPath)
    const [alreadyStored] = await file.exists()
    if (!alreadyStored) {
      await file.save(bundle, {
        contentType: 'application/javascript',
        metadata: {
          cacheControl: 'public, max-age=31536000, immutable',
        },
      })
    }

    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    await listingRef.set(
      {
        type: 'plugin',
        artifactType: 'plugin',
        profileId: publisher.orgId,
        pluginId: manifest.id,
        displayName: displayName.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(category.trim() && { category: category.trim() }),
        priceUsd,
        ...contentVerdict.content,
        latestVersion: manifest.version,
        // Mirror of `pluginVersions/{latestVersion}.reviewState`, for the
        // marketplace (AGL-1121). Browse reads listings directly and cannot
        // afford a version subdoc read per card, so the newest bytes' verdict
        // has to live here to be shown at all.
        //
        // Reset to 'pending' on EVERY publish, including a bump on a listing
        // that staff already verified. That is the whole point: the listing's
        // `reviewStatus` deliberately survives a version bump, so before this
        // the marketplace badged brand-new, unreviewed bytes as reviewed.
        latestVersionReviewState: 'pending',
        deletedAt: null,
        // Review queue (AGL-432): first publish enters as 'submitted';
        // version bumps keep whatever status staff granted — which is safe
        // now that installs resolve the newest APPROVED version rather than
        // `latestVersion` (AGL-966). A listed plugin stays listed on its
        // reviewed bytes while the new version waits in the queue.
        ...(existing.empty && { createdAt: now, reviewStatus: 'submitted' }),
        // Private plugins never reach the marketplace but take the same
        // review path (AGL-968). Only settable on first publish; changing
        // visibility later is a separate, deliberate action.
        ...(existing.empty && {
          visibility: req.body?.visibility === 'private' ? 'private' : 'public',
        }),
        updatedAt: now,
      },
      { merge: true },
    )
    // Version snapshots are server-only; the loader reads sha256 + manifest
    // to verify integrity and stamp CSP before executing.
    await listingRef
      .collection('pluginVersions')
      .doc(manifest.version)
      .set({
        version: manifest.version,
        sha256,
        objectPath,
        manifest,
        ...(changelog.trim() && { changelog: changelog.trim() }),
        // The repository as declared FOR THESE BYTES (AGL-1076). The listing
        // carries whatever the latest publish said, and a publisher may move
        // or rename a repo between versions — a reviewer looking at v1.0.2
        // needs the link that was attested against v1.0.2's sha256, which is
        // the same reasoning that pins the attestation itself.
        ...(contentVerdict.content?.repositoryUrl && {
          repositoryUrl: contentVerdict.content.repositoryUrl,
        }),
        publishedAt: now,
        // What the publisher stated about these bytes (AGL-969). Same shape
        // as the staff `reviewChecklist` and pinned to the same sha256, so
        // a republish under this version string re-asks rather than
        // inheriting an attestation made about code that has since changed.
        //
        // `by` is the uid that submitted, not the org: takedown and removal
        // are defensible because a named person said this on a date, and an
        // org id names nobody.
        publisherAttestation: Object.fromEntries(
          ticked.map((id: string) => [id, { by: decoded.uid, at: now, sha256 }]),
        ),
        // Every version starts UNREVIEWED (AGL-966). This doc is written
        // with .set() and no merge, so a republish of the same version
        // string also resets it — new bytes, new review, by construction.
        reviewState: 'pending',
        // Keep the verdict we just computed (AGL-962). The bundle is
        // immutable and content-addressed, so this result holds for as long
        // as the checker does — the review page reads it instead of
        // re-downloading a megabyte per view. `verifierVersion` is what
        // makes that safe: bump PLUGIN_VERIFIER_VERSION and every stored
        // verdict is recomputed on next read.
        verification: {
          ok: verification.ok,
          problems: verification.problems,
          sha256,
          verifierVersion: PLUGIN_VERIFIER_VERSION,
          checkedAt: now,
        },
      })

    // Tell staff a version is waiting (AGL-970). Nothing announced a
    // submission before this: reviewers had to notice a new row by
    // visiting the queue, and an UPDATE to an already-listed plugin
    // produced no row at all. Persistent per-user notifications, so it
    // survives a refresh and stays until someone acts on it.
    await notifyStaff({
      type: 'community.review',
      title: `${displayName.trim()} v${manifest.version} needs review`,
      body: existing.empty
        ? 'A new plugin was submitted to the marketplace.'
        : 'A new version was published. The previously approved version ' +
          'keeps installing until this one is reviewed.',
      link: `/admin/plugin-reviews/${listingRef.id}`,
    }).catch(() => undefined)

    return res
      .status(200)
      .json({ listingId: listingRef.id, version: manifest.version, sha256 })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Publish failed' })
  }
}
