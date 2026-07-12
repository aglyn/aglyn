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
  validatePluginManifest,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForUser } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { createHash } from 'crypto'
import {
  COMMUNITY_MAX_PRICE_USD,
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
    if (listing.profileId !== decoded.uid && decoded['staff'] !== true) {
      return res.status(403).json({ error: 'Not your listing' })
    }
    const description = req.body?.description
    await listingRef.set(
      {
        ...verdict.content,
        ...(typeof description === 'string'
          ? { description: description.slice(0, 500) }
          : {}),
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
    const membership = await resolveOrgPermissions(decoded.uid)
    if (!membership.permissions.publishToCommunity) {
      return res.status(403).json({
        error:
          'Your organization role does not allow publishing to the community',
      })
    }
    const firestore = firebaseAdmin.app().firestore()

    // Plan gate rides the caller's org doc (AGL-238).
    const tenant = (await getOrgForUser(decoded.uid))?.org ?? {}
    if (tenant['plan'] && !checkEntitlement(tenant, 'marketplaceSelling')) {
      return res
        .status(403)
        .json({ error: 'Publishing to the community requires a Pro plan' })
    }

    // Publish rate limit (AGL-437): a runaway or abusive publisher can't
    // flood the artifacts bucket/review queue — 20 publishes per UTC day.
    const dayKey = new Date().toISOString().slice(0, 10)
    const limiterRef = firestore
      .collection('profiles')
      .doc(decoded.uid)
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

    const profileSnapshot = await firestore
      .collection('profiles')
      .doc(decoded.uid)
      .get()
    if (!profileSnapshot.exists || !profileSnapshot.get('handle')) {
      return res.status(412).json({
        error:
          'Create your community profile first (Manage → Community profile)',
      })
    }
    if (priceUsd > 0 && !profileSnapshot.get('stripeChargesEnabled')) {
      return res.status(412).json({
        error: 'Set up payouts first (Manage → Community profile) to sell',
      })
    }

    const bundle = Buffer.from(bundleBase64, 'base64')
    if (!bundle.length || bundle.length > MAX_BUNDLE_BYTES) {
      return res.status(413).json({ error: 'Bundle is empty or too large' })
    }
    // Static verification (AGL-426): the same checks as the local
    // `verify-plugin-bundle.mjs`, so a bundle that passes there publishes
    // here. Entry exports, self-containment, forbidden APIs, size.
    const verification = checkPluginBundle(bundle.toString('utf8'), {
      maxBytes: MAX_PLUGIN_BUNDLE_BYTES,
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
      .where('profileId', '==', decoded.uid)
      .where('pluginId', '==', manifest.id)
      .limit(1)
      .get()
    const listingRef = existing.empty
      ? firestore.collection('communityListings').doc(createResourceUid())
      : existing.docs[0].ref

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
        profileId: decoded.uid,
        pluginId: manifest.id,
        displayName: displayName.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(category.trim() && { category: category.trim() }),
        priceUsd,
        ...contentVerdict.content,
        latestVersion: manifest.version,
        deletedAt: null,
        // Review queue (AGL-432): first publish enters as 'submitted';
        // version bumps keep whatever status staff granted.
        ...(existing.empty && { createdAt: now, reviewStatus: 'submitted' }),
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
        publishedAt: now,
      })

    return res
      .status(200)
      .json({ listingId: listingRef.id, version: manifest.version, sha256 })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Publish failed' })
  }
}
