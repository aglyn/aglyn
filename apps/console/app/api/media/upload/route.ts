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
  defaultScopeForNewResource,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  checkEntitlement,
  checkQuota,
  createResourceUid,
  readImageDimensions,
} from '@aglyn/aglyn/server'
import {
  deleteMediaWithTombstone,
  emailUnverifiedResponse,
  firebaseAdmin,
  generateMediaVariants,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { createHash, randomUUID } from 'crypto'
import {
  folderStoragePath,
  mediaObjectPath,
  resolveMediaScope,
  mediaCdnPathUpdate,
} from '../../../../utils/server/media-scope'

import {
  directUploadMaxBytes,
  isAllowedUploadType,
  isImageUploadType,
  normalizeUploadContentType,
  requiresFileUploadEntitlement,
  UPLOAD_TYPES_MESSAGE,
} from '../../../../utils/media-upload-limits'
import {
  isSvgUploadType,
  sanitizeSvgBuffer,
} from '../../../../utils/sanitize-svg'

// Base64 JSON payloads (AGL-162 caps). NOTE (AGL-1317): on Vercel the
// platform rejects request bodies over 4.5MB with a 413 before this
// handler runs, so the direct path's real ceiling is ~3.3MB of raw file —
// the client sends anything larger through /api/media/upload-url.

/**
 * Authenticated media upload/delete (AGL-85): Storage rules deny client
 * writes entirely, so every mutation passes this route's checks — Firebase
 * ID token, host or org membership (org DAM parity), allowed content
 * types, and the server-enforced storage quota. Files land under the
 * scope's media prefix inside their REAL folder path
 * (`{base}/media/{folder…}/{mediaId}`) with a download-token URL; the
 * Firestore metadata mirror and bytes counter are written here too.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
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
    // hands the 423 refusal back as `error.response`. This is an INGRESS
    // route, so it also passes the UPLOADS feature gate (AGL-1510).
    const { scope, error } = await resolveMediaScope(body, query, decoded.uid, {
      staff: decoded['staff'] === true,
      feature: 'uploads',
    })
    if (!scope) {
      return (
        error?.response ??
        Response.json({ error: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
      )
    }
    const scopeRef = scope.scopeRef
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)

    if (method === 'DELETE') {
      const mediaId = String(body?.mediaId ?? '')
      if (!mediaId) return Response.json({ error: 'Missing mediaId' }, { status: 400 })
      const mediaSnapshot = await scopeRef
        .collection('media')
        .doc(mediaId)
        .get()
      const objectPath = mediaObjectPath(mediaSnapshot, scope.base)
      // Reversible now (AGL-1467). This branch used to `mediaRef.delete()` and
      // decrement the counters inline, which destroyed the only thing that
      // could address the bytes GCS keeps for seven days — the id, the file
      // name, the folder, the tags, the alt text, the scope tokens, `cdnPath`
      // and `variants` all went with the document, and `File.restore()` needs
      // a generation number nobody had captured. `deleteMediaWithTombstone`
      // reads the generations FIRST, then commits the tombstone, the document
      // delete and both counter decrements together. Object and variant
      // deletes still happen, and are still best-effort.
      const result = await deleteMediaWithTombstone({
        scopeRef,
        bucket,
        mediaId,
        objectPath,
        uid: decoded.uid,
      })
      // `deleted: true` unconditionally, as before: an already-absent document
      // is a delete that has already happened, and reporting it as a failure
      // makes a retry look broken. `restorable` is what the snackbar keys its
      // Undo action on — absent when there is nothing to restore.
      return Response.json(
        { deleted: true, restorable: Boolean(result.tombstone) },
        { status: 200 },
      )
    }

    const fileName = String(body?.fileName ?? 'upload').slice(0, 200)
    const contentType = normalizeUploadContentType(
      String(body?.contentType ?? ''),
      String(body?.fileName ?? ''),
    )
    const data = String(body?.data ?? '')
    // Destination folder (AGL-172): uploads land in the library's open
    // folder. Id only — existence is the client's concern; a stale id
    // just files the asset at root in the UI.
    const folderId =
      typeof body?.folderId === 'string' && body.folderId
        ? String(body.folderId).slice(0, 64)
        : null
    // Media-type allowlist (AGL-162): images for everyone; video, PDF, ZIP
    // and documents by tier (videoMedia flag; dark-launch workspaces
    // uncapped as usual). This route no longer keeps its own copy of the
    // list (AGL-1465) — `UPLOAD_TYPES` is the single source the library's
    // `accept`, the client pre-check and both routes all derive from, so a
    // drop the UI accepted can no longer 415 here.
    //
    // Zips (AGL-1317, brand kits) and documents (AGL-1465) are stored as
    // plain objects — never extracted, parsed or rendered. Macro-enabled
    // Office formats (.docm/.xlsm/.pptm) are deliberately NOT on the list.
    const isImage = isImageUploadType(contentType)
    if (!isAllowedUploadType(contentType)) {
      return Response.json({ error: UPLOAD_TYPES_MESSAGE }, { status: 415 })
    }
    const uploaded = Buffer.from(data, 'base64')
    // SVG sanitization (AGL-1474). An SVG is a document: `image/*` accepts it,
    // it is stored under the type the client declared, and the CDN serves it
    // inline from this origin — so an embedded `<script>` ran on
    // `app.aglyn.com` for anyone with editor rights. The CDN's own CSP is the
    // containment; stripping the payload here is what keeps the stored
    // artifact clean. A clean SVG comes back as the identical buffer, so the
    // hash, the size and the counter are untouched for every honest upload.
    const svg = isSvgUploadType(contentType) ? sanitizeSvgBuffer(uploaded) : null
    const buffer = svg ? svg.buffer : uploaded
    // Non-undefined for every allowed type, which the gate above established.
    const maxBytes = directUploadMaxBytes(contentType) as number
    // Measured on what was SENT: sanitizing only ever shrinks, and an
    // oversized upload must be refused for its real weight.
    if (!uploaded.length || uploaded.length > maxBytes) {
      return Response.json({
        error: `File is empty or too large (${Math.round(maxBytes / 1024 / 1024)}MB max)`,
      }, { status: 413 })
    }

    // Server-side quota: counter bytes + this file against the plan limit
    // (no enforcement until the org has an explicit plan — AGL-38 gate).
    const counterSnapshot = await scopeRef
      .collection('counters')
      .doc('media')
      .get()
    const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
    // Quota/entitlements ride the owning org's doc (AGL-238).
    const org = scope.billing
    // Everything that is not an image rides `videoMedia` — AGL-162's
    // "video & file uploads" gate, which documents join (AGL-1465).
    if (
      requiresFileUploadEntitlement(contentType) &&
      !checkEntitlement(org, 'videoMedia')
    ) {
      return Response.json({
        error: 'Video and file uploads require a Pro plan',
      }, { status: 403 })
    }
    {
      // Storage quota applies to every org; a plan-less org resolves as
      // `free` (250 MB cap), not unmetered.
      const usedMb = (usedBytes + buffer.length) / (1024 * 1024)
      // usedMb includes the incoming file; ceil-1 allows exactly up to the
      // integer MB cap and no further (AGL-471 off-by-one).
      const quota = checkQuota(org, 'storagePerHostMb', Math.ceil(usedMb) - 1)
      if (!quota.allowed) {
        return Response.json({
          error: `Storage limit reached (${quota.limit} MB)`,
        }, { status: 403 })
      }
    }

    const mediaId = createResourceUid()
    const token = randomUUID()
    // Real folders (org DAM work): the object lives INSIDE its folder's
    // Storage prefix, so the bucket tree mirrors the library tree.
    const folderPath = await folderStoragePath(scopeRef, folderId)
    const objectPath =
      `${scope.base}/media/` + (folderPath ? `${folderPath}/` : '') + mediaId
    const file = bucket.file(objectPath)
    await file.save(buffer, {
      contentType,
      metadata: {
        // Immutable is safe: the CDN path embeds the content hash, and
        // raw download URLs embed the token — both change with content.
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}` +
      `?alt=media&token=${token}`

    // Auto-captured metadata (AGL-173): image dimensions from the file
    // header (best-effort, never a gate) and the uploader's uid.
    const dimensions = isImage
      ? readImageDimensions(new Uint8Array(buffer))
      : null

    // CDN delivery (AGL-175): content-hashed immutable path plus WebP
    // variants for images. Variant bytes are deliberately EXCLUDED from
    // the storage counter — they're derived artifacts the platform can
    // regenerate, so hosts aren't billed for them.
    const contentHash = createHash('sha256')
      .update(new Uint8Array(buffer))
      .digest('hex')
      .slice(0, 16)
    // Paid gate (AGL-175 pricing): free workspaces serve raw storage URLs.
    // A plan-less org resolves as `free` (no CDN); overrides can still grant
    // it. `mediaCdn` is a Starter+ entitlement.
    // A private asset (AGL-1051) gets NO `cdnPath` — the field is what the
    // pickers and page nodes reference, so withholding it is what keeps a
    // private asset out of published content in the first place. Its bytes
    // are reachable only through a signed URL minted per view.
    const isPrivateUpload = body?.['private'] === true
    const cdnAllowed = checkEntitlement(org, 'mediaCdn') && !isPrivateUpload
    // Variants are still an optimization — this never fails the upload for
    // them. What changed (AGL-1468) is that a failure is now WRITTEN DOWN.
    // The previous shape reported into a serverless log with about an hour of
    // retention, so a three-week total outage left 174 assets with empty
    // `variants` and no evidence of why. `variantsError` on the document and
    // `variantFailures` on the counter make the next one a query.
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

    await scopeRef.collection('media').doc(mediaId).set({
      fileName,
      contentType,
      sizeBytes: buffer.length,
      url,
      storagePath: objectPath,
      folderId,
      ...(dimensions ?? {}),
      uploadedBy: decoded.uid,
      contentHash,
      variants,
      // Only when something actually went wrong. An asset with nothing to
      // generate — an SVG, or a source already narrower than 320px — is the
      // common case and must not carry a fault marker, or the marker stops
      // meaning anything.
      ...(variantsError ? { variantsError } : {}),
      // Written down, not merely logged (AGL-1474). An SVG that arrived
      // carrying script is the one upload anybody will want to find later,
      // and a serverless log keeps it for about an hour — same reasoning as
      // `variantsError` above. Absent on every clean asset.
      ...(svg?.changed ? { svgSanitized: svg.removed } : {}),
      // Org-wide by default — today's behavior (AGL-1043). Stamping it on
      // every new asset is what makes the scoped reads work at all:
      // `array-contains-any` matches nothing on a doc lacking the field.
      // Flipping this default to the uploading site is AGL-1048's
      // `defaultResourceScope` decision, not this route's.
      ...(scope.collection === 'orgs'
        ? {
            visibleTo: defaultScopeForNewResource({
              defaultResourceScope: (scope.billing as {
                defaultResourceScope?: 'org' | 'host'
              }).defaultResourceScope,
              hostId: String(body?.['forHostId'] ?? '') || null,
            }),
          }
        : {}),
      // Stable, mediaId-keyed CDN URL (AGL-829): no content hash, so it
      // survives replace and folder moves — references never break. The
      // path/no-path rule is shared with replace and set-private.
      cdnPath: mediaCdnPathUpdate({
        billing: org,
        cdnScope: scope.cdnScope,
        mediaId,
        isPrivate: isPrivateUpload,
      }),
      ...(isPrivateUpload ? { private: true } : {}),
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    await scopeRef
      .collection('counters')
      .doc('media')
      .set(
        {
          bytes: firebaseAdmin.firestore.FieldValue.increment(buffer.length),
          count: firebaseAdmin.firestore.FieldValue.increment(1),
          // Rides the write that was already happening, so the visibility
          // costs zero extra Firestore operations. A monotonic count next to
          // `count` is the cheapest possible answer to "is this broken for
          // everyone, or was that one asset unlucky?"
          ...(variantsError
            ? {
                variantFailures:
                  firebaseAdmin.firestore.FieldValue.increment(1),
              }
            : {}),
        },
        { merge: true },
      )

    return Response.json({ mediaId, url }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST, handler as DELETE }
