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
import { mediaStorageGate } from '../../../../utils/storage-overage'
import {
  checkEntitlement,
  createResourceUid,
  readImageDimensions,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  generateStoredMediaVariants,
  isImpersonationSession,
  quarantinedUploadRefusal,
} from '@aglyn/tenant-data-admin'
import {
  folderStoragePath,
  mediaCdnPathUpdate,
  resolveMediaScope,
} from '../../../../utils/server/media-scope'
import { createHash, randomUUID } from 'crypto'

import {
  isImageUploadType,
  normalizeUploadContentType,
  requiresFileUploadEntitlement,
  signedUploadMaxBytes,
  SIGNED_UPLOAD_TYPES_MESSAGE,
  storageContentHash,
} from '../../../../utils/media-upload-limits'
import {
  isSvgUploadType,
  sanitizeSvgBuffer,
} from '../../../../utils/sanitize-svg'

const SIGNED_URL_TTL_MS = 15 * 60 * 1000

/**
 * How much of the object is enough to read pixel dimensions from (AGL-1476).
 *
 * `readImageDimensions` parses a PNG's IHDR, a GIF's screen descriptor and a
 * JPEG's SOF segment — all header structures. 256 KB is generous for the last
 * of those (a JPEG carrying a large ICC profile or EXIF thumbnail pushes SOF
 * back) and still nothing next to the 15 MB the object may be. A truncated
 * read returns `null`, which the caller already treats as "unknown width" —
 * it degrades to generating every width, never to skipping the asset.
 *
 * The range exists so a FREE org and an already-narrow image never pay for a
 * full download: neither of them is going to produce a variant, and reading
 * three numbers should not cost 15 MB of egress.
 */
const IMAGE_HEADER_PROBE_BYTES = 256 * 1024

/**
 * Large uploads via signed URLs (AGL-167, extended by AGL-1317): the
 * base64-JSON direct route hits Vercel's 4.5MB request-body platform cap
 * at ~3.3MB of raw file, so large video — and now PDFs and brand-kit
 * zips — go direct-to-storage. POST mints a v4 signed PUT URL after the
 * same auth/entitlement/quota checks as /api/media/upload (declared size
 * is provisional); PATCH finalizes — verifies the object's REAL size and
 * type against the per-type cap (deleting it on violation, so a lying
 * client gains nothing), attaches the download token, and writes the
 * Firestore doc + byte counter. Zips are stored as plain objects, never
 * extracted.
 *
 * **This route working is not the same as the upload working.** The leg that
 * carries the bytes runs in the browser, cross-origin, and is gated by a
 * thing no code in this repo executes: the bucket's CORS configuration. With
 * none, the mint below still returns a perfectly good 200 and the `PUT` never
 * happens — which is how AGL-1317 was closed while every large upload was
 * broken (AGL-1408). The policy is `cloud/storage-cors.json`; how it is
 * applied, and which origins it does and does not cover, is
 * `docs/STORAGE_MANUAL_CONFIG.md`.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'PATCH') {
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
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)

    // Quota/entitlements ride the owning org's doc (AGL-238).
    const org = scope.billing
    const counterRef = scope.scopeRef.collection('counters').doc('media')

    if (method === 'POST') {
      const contentType = normalizeUploadContentType(
        String(body?.contentType ?? ''),
        String(body?.fileName ?? ''),
      )
      const sizeBytes = Number(body?.sizeBytes ?? 0)
      // One allowlist (AGL-1465): resolves a ceiling for every accepted
      // type — images included, which is AGL-1454's fix — and `undefined`
      // for exactly the types this route must refuse.
      const maxBytes = signedUploadMaxBytes(contentType)
      if (!maxBytes) {
        return Response.json({
          error: SIGNED_UPLOAD_TYPES_MESSAGE,
        }, { status: 415 })
      }
      if (
        !Number.isFinite(sizeBytes) ||
        sizeBytes <= 0 ||
        sizeBytes > maxBytes
      ) {
        return Response.json({
          error: `File is empty or too large (${Math.round(
            maxBytes / 1024 / 1024,
          )}MB max)`,
        }, { status: 413 })
      }
      // Video, PDF, ZIP and documents all ride the videoMedia entitlement
      // (AGL-162's "video & file uploads" tier gate). Images do NOT — they
      // are on every plan, and since AGL-1454 gave them a ceiling they can
      // reach this route, so the gate can no longer be unconditional.
      if (
        requiresFileUploadEntitlement(contentType) &&
        !checkEntitlement(org as any, 'videoMedia')
      ) {
        return Response.json({ error: 'Video and file uploads require a Pro plan' }, { status: 403 })
      }
      {
        // Storage quota applies to every org; a plan-less org resolves as
        // `free` (250 MB cap), not unmetered. Soft cap past the allowance for
        // metered plans (AGL-1886) — see `utils/storage-overage.ts`.
        const counterSnapshot = await counterRef.get()
        const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
        const usedMb = (usedBytes + sizeBytes) / (1024 * 1024)
        const gate = mediaStorageGate({ org: org as any, usedMb })
        if (!gate.allowed) {
          return Response.json(
            {
              error: gate.error ?? `Storage limit reached (${gate.limitMb} MB)`,
              code: gate.code,
              projectedOverageUsd: gate.projectedOverageUsd,
              ceilingUsd: gate.ceilingUsd,
            },
            { status: gate.status },
          )
        }
      }

      // Real folders: the signed URL is path-bound, so the destination
      // folder is decided here (the finalize PATCH re-derives it).
      const folderId =
        typeof body?.folderId === 'string' && body.folderId
          ? String(body.folderId).slice(0, 64)
          : null
      const folderPath = await folderStoragePath(scope.scopeRef, folderId)
      const mediaId = createResourceUid()
      const file = bucket.file(
        `${scope.base}/media/` +
          (folderPath ? `${folderPath}/` : '') +
          mediaId,
      )
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + SIGNED_URL_TTL_MS,
        contentType,
      })
      return Response.json({ mediaId, uploadUrl, contentType }, { status: 200 })
    }

    // PATCH — finalize after the client's direct PUT.
    const mediaId = String(body?.mediaId ?? '')
    const fileName = String(body?.fileName ?? 'upload').slice(0, 200)
    const folderId =
      typeof body?.folderId === 'string' && body.folderId
        ? String(body.folderId).slice(0, 64)
        : null
    if (!mediaId) return Response.json({ error: 'Missing mediaId' }, { status: 400 })
    const folderPath = await folderStoragePath(scope.scopeRef, folderId)
    const objectPath =
      `${scope.base}/media/` + (folderPath ? `${folderPath}/` : '') + mediaId
    const file = bucket.file(objectPath)
    const [exists] = await file.exists()
    if (!exists) {
      return Response.json({ error: 'Upload not found — retry' }, { status: 409 })
    }
    const [metadata] = await file.getMetadata()
    const declaredBytes = Number(metadata.size ?? 0)
    const contentType = String(metadata.contentType ?? '')
    const maxBytes = signedUploadMaxBytes(contentType)
    if (!maxBytes || declaredBytes > maxBytes) {
      await file.delete().catch(() => undefined)
      return Response.json({ error: 'Uploaded object rejected' }, { status: 415 })
    }

    /**
     * SVG sanitization (AGL-1474), the awkward half.
     *
     * On this route the bytes NEVER pass through the server on the way in —
     * the browser PUTs them straight to GCS with a signed URL — so finalize
     * is the first moment anything of ours can look at them, and it is
     * therefore where the strip has to happen. AGL-1454 made this reachable
     * for images at all (before it, every image took the base64 route), so
     * an SVG over 3 MB arrives here and nowhere else.
     *
     * Only SVG is ever downloaded: the 200 MB videos this route exists for
     * are never pulled back into the function. The re-save changes the
     * object's size and md5, so both are re-read rather than reused.
     */
    let actualBytes = declaredBytes
    let contentHash = storageContentHash(metadata.md5Hash)
    /**
     * The strong quarantine digest (AGL-1614), written only when the server
     * actually held the bytes — which on THIS route is the SVG branch below
     * and nowhere else.
     *
     * It stays absent for everything else deliberately rather than being
     * faked from `md5Hash`: GCS computes md5 and crc32c, not sha256, and
     * hashing a 200 MB video properly would mean downloading it back into
     * the function — which is the exact cost this route exists to avoid. A
     * client-computed sha256 is not an option either: the quarantine key is
     * a security control, and a value the uploader chooses is one a
     * re-uploader can choose to miss with. So the cross-route gap in the
     * strong hash is a stated limit, not an oversight, and quarantine
     * degrades to `contentHash` and then to the per-asset key exactly as it
     * did before.
     */
    let contentSha256: string | undefined
    let svgRemoved: string[] = []
    if (isSvgUploadType(contentType)) {
      const [raw] = await file.download()
      const sanitized = sanitizeSvgBuffer(raw)
      // The bytes are in hand either way here, so hash the ones that will
      // actually be served. An SVG is also the likeliest malware quarantine
      // target on this route, which is what makes the branch worth it.
      contentSha256 = createHash('sha256')
        .update(new Uint8Array(sanitized.changed ? sanitized.buffer : raw))
        .digest('hex')
      if (sanitized.changed) {
        await file.save(sanitized.buffer, { contentType })
        const [rewritten] = await file.getMetadata()
        actualBytes = Number(rewritten.size ?? sanitized.buffer.length)
        contentHash = storageContentHash(rewritten.md5Hash)
        svgRemoved = sanitized.removed
      }
    }
    /**
     * Asset quarantine at INGESTION (AGL-1613) — and the chokepoint where
     * the coverage has to be stated rather than implied.
     *
     * **What this catches.** Every object whose `contentHash` GCS gave us,
     * plus the full `contentSha256` on the SVG branch above, where the
     * server genuinely held the bytes. That is the whole population of
     * signed uploads that carry any digest at all.
     *
     * **What it does not, and cannot.** The mint (`POST`) leg is not gated:
     * it hands out a signed URL before any byte exists, so there is nothing
     * to look up. And `contentHash` here is a truncation of GCS's md5 while
     * the direct route's is a truncation of sha256, so the same file
     * re-uploaded through the OTHER route does not present the same key —
     * quarantine bites within an ingestion path, not across them (AGL-1614
     * argues why that is unfixable without downloading 200 MB videos back
     * into the function). A composite object, which GCS gives no md5 for,
     * carries no digest at all and cannot be matched here; the CDN's
     * per-asset fallback key is what still covers it at delivery.
     *
     * The object is already in the bucket by the time we can ask, so a
     * refusal DELETES it — exactly as the quota branch below does, and for
     * the same reason: an object with no media document is billed to nobody
     * and readable by nobody, and leaving it would grow the bucket forever.
     * This runs before the counter, before the document and before variant
     * generation, so a refused finalize moves no billing input and mints no
     * derived artifacts.
     */
    {
      const refusal = await quarantinedUploadRefusal({
        contentSha256,
        contentHash,
      })
      if (refusal) {
        await file.delete().catch(() => undefined)
        return refusal
      }
    }
    {
      // Storage quota applies to every org; a plan-less org resolves as
      // `free` (250 MB cap), not unmetered. Same gate as the POST above
      // (AGL-1886) — the two must not disagree about whether these bytes fit,
      // or a customer signs a URL they are then refused at finalize.
      const counterSnapshot = await counterRef.get()
      const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
      const usedMb = (usedBytes + actualBytes) / (1024 * 1024)
      const gate = mediaStorageGate({ org: org as any, usedMb })
      if (!gate.allowed) {
        await file.delete().catch(() => undefined)
        return Response.json(
          {
            error: gate.error ?? `Storage limit reached (${gate.limitMb} MB)`,
            code: gate.code,
            projectedOverageUsd: gate.projectedOverageUsd,
            ceilingUsd: gate.ceilingUsd,
          },
          { status: gate.status },
        )
      }
    }

    /**
     * The four fields the bytes were carrying, and nobody collected (AGL-1476).
     *
     * `variants`, `width`, `height` and `uploadedBy` are all written by
     * `/api/media/upload` and were all ABSENT here — not empty, absent — for
     * one reason: on this route the bytes go browser→GCS and the function only
     * ever saw a path. That was harmless while everything reaching finalize was
     * video, PDF or ZIP, none of which has variants or readable dimensions.
     * AGL-1465 gave images a signed-path ceiling, so since 2026-08-13 every
     * image between 3 MB and 15 MB lands here — which inverted the feature:
     * the assets that most need a 320px WebP became the only ones that got
     * none. Measured that day, same library, image against image so the ROUTE
     * is the only variable: a 6,606,921 B PNG through here answered `?w=320`
     * with 6,606,921 B of `image/png`; a 2,168,376 B PNG through the base64
     * route answered it with 31,566 B of `image/webp`.
     *
     * ## Why the bytes are fetched here rather than by a job
     *
     * The three options are AGL-1476's. Raising the threshold loses on
     * arithmetic — Vercel caps the body at 4.5 MB and base64 inflates by 4/3,
     * so ~3.3 MB is the ceiling and the threshold is already 3 MB. A deferred
     * job loses on something less obvious: **it does not avoid the download.**
     * The bytes are in storage either way, so a job must fetch exactly the same
     * object into exactly the same kind of function; all it moves is WHEN. And
     * the beat that exists is `pluginJobsBeat`, which POSTs the TENANT app
     * (`cloud/functions/src/index.ts`) — a different deployment, whose
     * `next.config.js` names `sharp` nowhere, so it would mean re-solving
     * AGL-1471 in a second runtime that no probe has ever answered `ok` for.
     * It would also need a `variantsPending` marker and a collectionGroup
     * index, because Firestore cannot query for a missing field. That is a
     * production index, a second document write and an unproven encoder, to
     * relocate a download that stays the same size.
     *
     * So: fetched here, and bounded. Not a new property of this handler —
     * finalize has downloaded the whole object on this path since AGL-1474,
     * unbounded, for every SVG. What is new is that the fetch is the LAST
     * thing attempted rather than the first: widths are decided from the
     * header, so a video is never pulled back and a free org never pays for
     * bytes its plan cannot serve.
     */
    const isImage = isImageUploadType(contentType)
    // The header only — see `IMAGE_HEADER_PROBE_BYTES`. Never for an SVG: it
    // has no raster header, and its bytes are already in hand above.
    let dimensions: { width: number; height: number } | null = null
    if (isImage && !isSvgUploadType(contentType)) {
      const [header] = await file.download({
        start: 0,
        end: IMAGE_HEADER_PROBE_BYTES - 1,
      })
      dimensions = readImageDimensions(new Uint8Array(header))
    }
    // The SAME boolean that decides `cdnPath` below, which is what AGL-1468
    // relied on to rule the entitlement out as a cause. A free workspace serves
    // raw storage URLs, so WebP it can never reference would be bytes nobody
    // reads — but dimensions and the uploader are not CDN features and land
    // regardless.
    const cdnAllowed = checkEntitlement(org as never, 'mediaCdn')
    // Variants remain an optimization and still never fail the upload
    // (AGL-1468) — and a failure is still WRITTEN DOWN, on the document and on
    // the counter, because three weeks of silent breakage cost 174 assets.
    //
    // No eligibility pre-check here on purpose: `generateStoredMediaVariants`
    // decides the widths BEFORE it calls `readSource`, so a video, an SVG or a
    // source already narrower than 320px returns `{ variants: [] }` having
    // touched storage exactly zero times. Restating that rule at the call site
    // is how the two copies AGL-1468 collapsed came to disagree in the first
    // place.
    const { variants, error: variantsError } = cdnAllowed
      ? await generateStoredMediaVariants({
          contentType,
          sizeBytes: actualBytes,
          sourceWidth: dimensions?.width,
          objectPath,
          readSource: async () => (await file.download())[0],
          saveVariant: (path, webp) =>
            bucket.file(path).save(webp, {
              contentType: 'image/webp',
              metadata: {
                cacheControl: 'public, max-age=31536000, immutable',
              },
            }),
        })
      : { variants: [] as number[], error: undefined }

    const token = randomUUID()
    await file.setMetadata({
      metadata: { firebaseStorageDownloadTokens: token },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}` +
      `?alt=media&token=${token}`
    await scope.scopeRef.collection('media').doc(mediaId).set({
      fileName,
      contentType,
      sizeBytes: actualBytes,
      url,
      storagePath: objectPath,
      folderId,
      // AGL-1476 — the four fields that only `/api/media/upload` used to
      // write. `dimensions` spreads to nothing when the header was
      // unreadable, exactly as on that route: best-effort metadata, never a
      // gate. `variants` is written unconditionally, so a document or a video
      // finalizes with `[]` — the same shape it gets through the base64 route,
      // and the reason `[]` on a `.pptx` is a design statement rather than a
      // symptom.
      ...(dimensions ?? {}),
      uploadedBy: decoded.uid,
      variants,
      // Only when something actually went wrong (AGL-1468). An asset with
      // nothing to generate — an SVG, a video, a source already narrower than
      // 320px — is the common case and must not carry a fault marker, or the
      // marker stops meaning anything.
      ...(variantsError ? { variantsError } : {}),
      // GCS already hashed these bytes; `getMetadata()` above handed it to
      // us free. Without it `serveMediaCdn` sets NO ETag, so an edge
      // revalidation re-streams the whole object instead of taking a 304 —
      // on the one route that carries 200 MB videos. Spread so a missing
      // md5 (composite objects) writes no field at all rather than a null.
      // Re-read after a sanitizing re-save (AGL-1474), or the ETag and the
      // immutable URL would both pin bytes that are no longer in the bucket.
      ...(contentHash ? { contentHash } : {}),
      // AGL-1614, and spread for the same reason: absent means "the server
      // never held these bytes", which every quarantine consumer already
      // handles by falling back. A null here would read as a hash.
      ...(contentSha256 ? { contentSha256 } : {}),
      // AGL-1474 — absent on every clean asset. See `/api/media/upload`.
      ...(svgRemoved.length ? { svgSanitized: svgRemoved } : {}),
      // Org-wide by default, same as the direct upload route (AGL-1043) —
      // the scoped reads need the field present on every asset.
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
      // Stable mediaId-keyed CDN URL (AGL-829), same rule as the direct
      // route — parity matters now that PDFs/zips can land here (AGL-1317).
      cdnPath: mediaCdnPathUpdate({
        billing: org,
        cdnScope: scope.cdnScope,
        mediaId,
        isPrivate: false,
      }),
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    await counterRef.set(
      {
        bytes: firebaseAdmin.firestore.FieldValue.increment(actualBytes),
        count: firebaseAdmin.firestore.FieldValue.increment(1),
        // Rides the write that was already happening, so the visibility costs
        // zero extra Firestore operations (AGL-1468). Variant BYTES stay out
        // of `bytes` by standing policy — derived artifacts the platform can
        // regenerate are not billed to the host.
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
    return Response.json({ error: 'Signed upload failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
/**
 * Finalize now fetches up to 15 MB back and runs three `sharp` encodes over it
 * (AGL-1476), on a handler that previously did metadata work and one SVG
 * download.
 *
 * Declared rather than left at the account default because of what that
 * default just cost elsewhere: `move-assets` declared none, was cut off
 * mid-loop by the platform, and returned a gateway timeout the client could
 * only render as a bare "Move failed" — see `utils/server/media-move.ts`. The
 * same shape here would abandon a finalize between the object landing in the
 * bucket and the Firestore document existing, which is an orphaned upload
 * rather than a slow one.
 *
 * Headroom, not a licence for unbounded work: the generation itself is bounded
 * by `MEDIA_VARIANT_SOURCE_MAX_BYTES`, and a pathological source (a
 * decompression bomb that is small on disk and enormous in pixels) is refused
 * by `sharp`'s own `limitInputPixels` and lands in the `variantsError` path
 * like any other failure.
 */
export const maxDuration = 60
export { handler as POST, handler as PATCH }
