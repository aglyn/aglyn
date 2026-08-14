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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  checkEntitlement,
  checkQuota,
  readImageDimensions,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  generateMediaVariants,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  mediaObjectPath,
  resolveMediaScope,
  scopeAllows,
  mediaCdnPathUpdate,
} from '../../../../utils/server/media-scope'
import {
  isSvgUploadType,
  sanitizeSvgBuffer,
} from '../../../../utils/sanitize-svg'
import { createHash, randomUUID } from 'crypto'

// Base64 JSON payloads encode ~34MB for a 25MB source.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

/**
 * Replaces an image asset's bytes in place (AGL-184): same mediaId, new
 * content. Images only (transforms + replace target images; video/PDF
 * replacement is out of scope). Regenerates the AGL-175 content hash, CDN
 * variants, and AGL-173 dimensions; the storage object is overwritten with
 * a fresh download token so the raw `url` changes with the content.
 *
 * CDN-URL behavior (AGL-829): the stable, mediaId-keyed `cdnPath`
 * (`/api/media/cdn/{scope}/{mediaId}` — no content hash) does NOT change on
 * replace, so every reference that uses it keeps resolving and simply
 * serves the new bytes (the CDN route revalidates via the content-hash
 * ETag). Only the legacy raw `url` (with its token) rotates.
 *
 * Concurrent-edit safety: an optional `expectedUpdatedAtMs` precondition
 * rejects a stale replace (409). Storage quota + type + size mirror
 * `/api/media/upload`.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const mediaId = String(body?.mediaId ?? '')
  const contentType = String(body?.contentType ?? '')
  const data = String(body?.data ?? '')
  const expectedUpdatedAtMs = body?.expectedUpdatedAtMs
    ? Number(body.expectedUpdatedAtMs)
    : undefined
  if (!mediaId || !data) {
    return Response.json({ error: 'Missing mediaId or data' }, { status: 400 })
  }
  if (!contentType.startsWith('image/')) {
    return Response.json({ error: 'Only images can be replaced' }, { status: 415 })
  }

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
    // lockdown-423: via apps/console/utils/server/media-scope.ts — the scope
    // resolver runs the verdict on the org/host docs it already reads and
    // hands the 423 refusal back as `error.response`.
    const { scope, error } = await resolveMediaScope(body, query, decoded.uid, {
      staff: decoded['staff'] === true,
    })
    if (!scope) {
      return (
        error?.response ??
        Response.json({ error: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
      )
    }

    const mediaRef = scope.scopeRef.collection('media').doc(mediaId)
    const mediaSnapshot = await mediaRef.get()
    if (
      !mediaSnapshot.exists ||
      mediaSnapshot.get('deletedAt') ||
      // Replacing an asset you cannot see would swap the bytes behind
      // another site's image (AGL-1043).
      !scopeAllows(scope, mediaSnapshot.get('visibleTo'))
    ) {
      return Response.json({ error: 'Unknown media' }, { status: 404 })
    }
    // Concurrent-edit guard: the client passes the doc's updatedAt it saw.
    if (expectedUpdatedAtMs != null) {
      const currentMs =
        Number(mediaSnapshot.get('updatedAt')?.toMillis?.() ?? 0) ||
        Number(mediaSnapshot.get('createdAt')?.toMillis?.() ?? 0)
      if (currentMs && currentMs > expectedUpdatedAtMs) {
        return Response.json({ error: 'This asset was changed elsewhere — reload first' }, { status: 409 })
      }
    }

    const uploaded = Buffer.from(data, 'base64')
    // SVG sanitization (AGL-1474). Replace is the same `image/*` gate as
    // upload, which makes it the LATER door onto the same vector: an asset
    // approved as a PNG can have its bytes swapped for a scripted SVG
    // afterwards, under a `cdnPath` that is already embedded in published
    // pages and that replace deliberately does not change. Same treatment,
    // same place in the flow — before anything is written.
    const svg = isSvgUploadType(contentType) ? sanitizeSvgBuffer(uploaded) : null
    const buffer = svg ? svg.buffer : uploaded
    if (!uploaded.length || uploaded.length > MAX_IMAGE_BYTES) {
      return Response.json({
        error: `Image is empty or too large (${MAX_IMAGE_BYTES / 1024 / 1024}MB max)`,
      }, { status: 413 })
    }

    const previousBytes = Number(mediaSnapshot.get('sizeBytes') ?? 0)
    // Quota rides the owning org's doc (AGL-238).
    const org = scope.billing
    {
      // Storage quota applies to every org; a plan-less org resolves as
      // `free` (250 MB cap), not unmetered.
      const counterSnapshot = await scope.scopeRef
        .collection('counters')
        .doc('media')
        .get()
      const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
      // Quota against the NEW total (swap the old bytes for the new).
      const projected = usedBytes - previousBytes + buffer.length
      const usedMb = projected / (1024 * 1024)
      // usedMb includes the replacement bytes; ceil-1 allows exactly up to
      // the integer MB cap and no further (AGL-471 off-by-one).
      const quota = checkQuota(
        org as any,
        'storagePerHostMb',
        Math.ceil(usedMb) - 1,
      )
      if (!quota.allowed) {
        return Response.json({ error: `Storage limit reached (${quota.limit} MB)` }, { status: 403 })
      }
    }

    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'])

    const objectPath = mediaObjectPath(mediaSnapshot, scope.base)
    // Drop the previous CDN variants — they belong to the old content.
    const previousVariants: number[] = mediaSnapshot.get('variants') ?? []
    await Promise.all(
      previousVariants.map((width) =>
        bucket
          .file(`${objectPath}__w${width}.webp`)
          .delete()
          .catch(() => undefined),
      ),
    )

    const token = randomUUID()
    const file = bucket.file(objectPath)
    await file.save(buffer, {
      contentType,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}` +
      `?alt=media&token=${token}`

    const dimensions = readImageDimensions(new Uint8Array(buffer))
    const contentHash = createHash('sha256')
      .update(new Uint8Array(buffer))
      .digest('hex')
      .slice(0, 16)
    // Replacing the bytes of a PRIVATE asset must not hand it a `cdnPath`
    // (AGL-1051) — that would quietly publish it, and the `: delete()`
    // branch below means the field is actively removed if one lingers.
    const cdnAllowed =
      checkEntitlement(org, 'mediaCdn') && mediaSnapshot.get('private') !== true
    // Same shape as upload, same reason (AGL-1468): the previous `catch` here
    // only reached a serverless log, which is why the regeneration half of
    // this bug was as invisible as the upload half.
    const { variants, error: variantsError } = cdnAllowed
      ? await generateMediaVariants({
          buffer,
          contentType,
          sourceWidth: dimensions?.width,
          objectPath,
          saveVariant: (path, webp) =>
            bucket.file(path).save(webp, {
              contentType: 'image/webp',
              metadata: {
                cacheControl: 'public, max-age=31536000, immutable',
              },
            }),
        })
      : { variants: [] as number[], error: undefined }

    await mediaRef.set(
      {
        contentType,
        sizeBytes: buffer.length,
        url,
        // Clear stale dimensions if the new header didn't parse.
        width: dimensions?.width ?? firebaseAdmin.firestore.FieldValue.delete(),
        height:
          dimensions?.height ?? firebaseAdmin.firestore.FieldValue.delete(),
        contentHash,
        variants,
        // A merge write, so this has to CLEAR on success rather than simply
        // not be set: an asset whose first upload failed and whose replace
        // succeeded would otherwise keep a fault marker for bytes that are
        // fine, and the population query would over-report forever.
        variantsError:
          variantsError ?? firebaseAdmin.firestore.FieldValue.delete(),
        // AGL-1474, and a merge write, so it must CLEAR on a clean replace —
        // otherwise the marker outlives the bytes that earned it and the
        // "which assets arrived carrying script" query over-reports forever.
        svgSanitized: svg?.changed
          ? svg.removed
          : firebaseAdmin.firestore.FieldValue.delete(),
        // Stable, mediaId-keyed CDN URL (AGL-829): unchanged by replace, so
        // the entry keeps resolving to the new bytes automatically — unless
        // the plan or the private flag says there should be no path at all,
        // which is the one rule shared with upload and set-private.
        cdnPath: mediaCdnPathUpdate({
          billing: org,
          cdnScope: scope.cdnScope,
          mediaId,
          isPrivate: mediaSnapshot.get('private') === true,
        }),
        replacedBy: decoded.uid,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    // Adjust the storage counter by the byte delta (count unchanged).
    await scope.scopeRef
      .collection('counters')
      .doc('media')
      .set(
        {
          bytes: firebaseAdmin.firestore.FieldValue.increment(
            buffer.length - previousBytes,
          ),
          // Same counter the upload route bumps — one number for the scope,
          // whichever route produced the failure.
          ...(variantsError
            ? {
                variantFailures:
                  firebaseAdmin.firestore.FieldValue.increment(1),
              }
            : {}),
        },
        { merge: true },
      )

    return Response.json({ replaced: true, url, contentHash }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Replace failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
