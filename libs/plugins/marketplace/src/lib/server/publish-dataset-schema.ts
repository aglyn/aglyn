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

import { checkEntitlement, createResourceUid } from '@aglyn/aglyn/server'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { marketplacePriceRefusal, sanitizeDatasetSchema } from '../model'
import { resolvePublisherProfile } from './publisher-profile'
import { publishPreconditionRefusal } from './publish-preconditions'

/**
 * Publishes an org dataset's SCHEMA to the marketplace (AGL-657).
 *
 * Unlike every other publish route this one takes an `orgId` rather than a
 * `hostId`: datasets live at `orgs/{orgId}/datasets/{id}` and are org-shared
 * (AGL-237), so there is no source site to derive the org from. The role gate
 * goes through `resolveOrgPermissions` directly for the same reason.
 *
 * Records NEVER travel — `sanitizeDatasetSchema` reads the model and this
 * handler never touches the `records` subcollection. A dataset's rows are the
 * org's customer data; only the shape is publishable.
 */
export const publishDatasetSchemaHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const orgId = String(req.body?.orgId ?? '')
  const datasetId = String(req.body?.datasetId ?? '')
  const displayName = String(req.body?.displayName ?? '').slice(0, 80)
  const description = String(req.body?.description ?? '').slice(0, 500)
  const category = String(req.body?.category ?? '').slice(0, 40)
  const priceUsd = Math.round(Number(req.body?.priceUsd ?? 0)) || 0
  // The price floor and ceiling, from ONE validator (AGL-2343): a paid listing
  // under `MARKETPLACE_MIN_PRICE_USD` loses money on every sale, because
  // marketplace checkout is a destination charge whose Stripe fee is debited
  // from the platform's balance. Also enforced in `publishPreconditionRefusal`
  // below, so a door that drops this line is still covered.
  const priceRefusal = marketplacePriceRefusal(priceUsd)
  if (priceRefusal) {
    return res.status(400).json({ error: priceRefusal })
  }
  if (!orgId || !datasetId || !displayName.trim()) {
    return res
      .status(400)
      .json({ error: 'Missing orgId, datasetId, or displayName' })
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgPermissions(decoded.uid, { orgId })
    if (membership.orgId !== orgId || !membership.permissions.publishToMarketplace) {
      return res.status(403).json({
        error:
          'Your organization role does not allow publishing to the marketplace',
      })
    }
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown organization' })
    }
    if (!checkEntitlement(orgSnapshot.data() as any, 'marketplaceSelling')) {
      return res
        .status(403)
        .json({ error: 'Publishing to the marketplace requires a Pro plan' })
    }

    const publisher = await resolvePublisherProfile(firestore, orgId)
    // Profile, payouts AND the publisher agreement, in one gate
    // (AGL-2282) — see `publishPreconditionRefusal`.
    const refusal = publishPreconditionRefusal(publisher, {
      priceUsd,
      sells: 'schemas',
    })
    if (refusal) return res.status(refusal.status).json(refusal.body)

    const datasetSnapshot = await orgRef
      .collection('datasets')
      .doc(datasetId)
      .get()
    const dataset = datasetSnapshot.data() as any
    if (!datasetSnapshot.exists || dataset?.deletedAt) {
      return res.status(404).json({ error: 'Unknown dataset' })
    }
    // v1 datasets carry a flat `fields: string[]` with no model; publish the
    // derived shape so unmigrated datasets are publishable too (AGL-102 shim,
    // inlined rather than importing core's deriveModelFromFields to keep the
    // sanitizer's input one plain shape).
    const model = dataset?.model?.fields
      ? dataset.model
      : {
          fields: Object.fromEntries(
            (Array.isArray(dataset?.fields) ? dataset.fields : []).map(
              (name: unknown) => [String(name), { name: String(name), type: 'text' }],
            ),
          ),
          order: (Array.isArray(dataset?.fields) ? dataset.fields : []).map(String),
        }

    const sanitized = sanitizeDatasetSchema(model)
    if (sanitized.ok === false) {
      return res.status(422).json({ error: sanitized.error })
    }

    // Reference fields name a dataset id that means nothing outside this org,
    // so resolve each target's display name now — the installer relinks by
    // that label (see resolveInstalledDatasetSchema).
    const referenced = new Set(
      Object.values(sanitized.schema.fields)
        .map((field) => field.reference?.datasetId)
        .filter((id): id is string => Boolean(id)),
    )
    if (referenced.size) {
      const labels = new Map<string, string>()
      await Promise.all(
        [...referenced].map(async (id) => {
          const snapshot = await orgRef.collection('datasets').doc(id).get()
          const label = snapshot.get('displayName')
          if (label) labels.set(id, String(label))
        }),
      )
      for (const field of Object.values(sanitized.schema.fields)) {
        const target = field.reference?.datasetId
        if (target && labels.has(target)) {
          field.reference = {
            ...field.reference,
            datasetLabel: labels.get(target),
          }
        }
      }
    }

    // One listing per source dataset: re-publish bumps latestVersion.
    const existing = await firestore
      .collection('marketplaceListings')
      .where('profileId', '==', publisher.orgId)
      .where('sourceDatasetId', '==', datasetId)
      .limit(1)
      .get()
    const listingRef = existing.empty
      ? firestore.collection('marketplaceListings').doc(createResourceUid())
      : existing.docs[0].ref
    const version = existing.empty
      ? 1
      : Number(existing.docs[0].get('latestVersion') ?? 0) + 1
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()

    await listingRef.set(
      {
        profileId: publisher.orgId,
        artifactType: 'datasetSchema',
        sourceDatasetId: datasetId,
        displayName: displayName.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(category.trim() && { category: category.trim() }),
        priceUsd,
        latestVersion: version,
        fieldCount: sanitized.schema.order.length,
        deletedAt: null,
        ...(existing.empty && { createdAt: now }),
        updatedAt: now,
        versionHistory: firebaseAdmin.firestore.FieldValue.arrayUnion({
          version,
          publishedAt: firebaseAdmin.firestore.Timestamp.now(),
        }),
      },
      { merge: true },
    )
    await listingRef
      .collection('versions')
      .doc(String(version))
      .set({ datasetSchema: sanitized.schema, publishedAt: now })

    return res.status(200).json({ listingId: listingRef.id, version })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Publish failed' })
  }
}

export default publishDatasetSchemaHandler
