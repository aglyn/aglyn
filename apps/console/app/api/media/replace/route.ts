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
  mediaStorageGate,
  scopeBillsStorageOverage,
} from '../../../../utils/storage-overage'
import { resolveOrgMediaBand } from '../../../../utils/server/media-storage-band'
import {
  checkEntitlement,
  inspectUploadBytes,
  pluginRequestFromWeb,
  readImageDimensions,
  UPLOAD_INSPECTION_HEAD_BYTES,
  UPLOAD_INSPECTION_TAIL_BYTES,
  uploadInspectionNeedsTail,
} from '@aglyn/aglyn/server'
import {
  isSvgUploadType,
  sanitizeSvgBuffer,
} from '@aglyn/aglyn/app-utils/sanitize-svg'
import {
  mediaPosterObjectPath,
  mediaRenditionObjectPath,
  MEDIA_POSTER_OBJECT_SUFFIX,
  parseMediaRenditions,
} from '@aglyn/aglyn/app-utils/media-ref'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  generateMediaVariants,
  generateStoredMediaVariants,
  isImpersonationSession,
  MEDIA_STRONG_DIGEST_MAX_BYTES,
  quarantinedUploadRefusal,
  storedObjectSha256,
} from '@aglyn/tenant-data-admin'
import {
  mediaObjectPath,
  resolveMediaScope,
  scopeAllows,
  mediaCdnPathUpdate,
} from '../../../../utils/server/media-scope'
import {
  directUploadMaxBytes,
  isAllowedUploadType,
  isImageUploadType,
  MEDIA_UPLOAD_KIND_LABELS,
  mediaUploadKind,
  normalizeUploadContentType,
  requiresFileUploadEntitlement,
  signedUploadMaxBytes,
  storageContentHash,
  UPLOAD_TYPES_MESSAGE,
} from '../../../../utils/media-upload-limits'
import { videoUploadFields } from '../../../../utils/server/media-video-fields'
import { createHash, randomUUID } from 'crypto'

const SIGNED_URL_TTL_MS = 15 * 60 * 1000

/**
 * Where a signed replace lands before it is allowed near the master.
 *
 * The bytes arrive browser→GCS, so the first moment anything of ours can look
 * at them is after they exist in the bucket — and the object this route is
 * replacing is ALREADY being served under a `cdnPath` embedded in published
 * pages. Signing a URL for the master itself would therefore publish
 * un-inspected bytes the instant the PUT completed, and a finalize that then
 * refused them (quarantine, structure, quota) would have destroyed the
 * original to do it.
 *
 * So the PUT is bound to a sibling object and the master is only touched once
 * every gate has passed, immediately before the document write. A refused
 * finalize deletes the staged object and leaves the asset, its variants and
 * the billing counter exactly as they were — the same promise the base64
 * branch has always made.
 */
const REPLACE_STAGING_SUFFIX = '__incoming'

/** Enough of an image to read its pixel header from. See `/upload-url`. */
const IMAGE_HEADER_PROBE_BYTES = 256 * 1024

/**
 * Replaces an asset's bytes in place (AGL-184): same mediaId, new content.
 *
 * ## What it is for
 *
 * The DAM's central promise is that a reference is to an ASSET, not to a
 * copy of its bytes — so correcting a file is one upload rather than a hunt
 * for every screen, layout and content entry that embeds it. That promise is
 * only true if there is a way to change the bytes, which is this route.
 *
 * ## Every family, not only images (AGL-2732)
 *
 * It was `image/`-gated at three layers — this route's 415, the card's
 * overflow item and the drawer's button — which made replace invisible for
 * exactly the assets whose re-issue is most expensive: a published PDF, a
 * re-cut film, a spreadsheet. All three are lifted together, because lifting
 * one leaves the feature broken in whichever layer was not tested.
 *
 * What stays gated is the FAMILY: image↔image, video↔video, document↔
 * document (see `mediaUploadKind`). Crossing one keeps the id and the URL
 * while changing what the URL is — an `<img>` that now points at a PDF is a
 * broken page rather than an updated one — so a cross-family swap is a new
 * asset and is refused as such. Image TRANSFORMS (crop/rotate/resize) remain
 * image-only for the obvious reason and are not part of this route.
 *
 * ## The two ways bytes get here
 *
 * - `POST` carries them as base64 in the JSON body. Vercel rejects a body
 *   over 4.5 MB before this handler runs, so that branch tops out at ~3.3 MB
 *   of real file whatever the per-type ceiling says.
 * - `PUT` mints a v4 signed URL for {@link REPLACE_STAGING_SUFFIX} and
 *   `PATCH` finalizes it. This is what makes replacing a 7 MB PDF or a
 *   200 MB film possible at all; the client routes on size exactly as it
 *   does for a first upload (`SIGNED_UPLOAD_THRESHOLD_BYTES`).
 *
 * Both paths run the same gates: family, allowlist, per-type ceiling,
 * `videoMedia` entitlement for everything that is not an image, structural
 * inspection, SVG sanitization, BOTH quarantine questions, and the storage
 * band measured against the byte DELTA.
 *
 * ## Propagation, which is the point (AGL-2732)
 *
 * Keeping `cdnPath` is necessary and not sufficient: a stale DERIVED artifact
 * under a fresh master is a live page serving the old file. So a replace
 * drops every artifact of the previous bytes and rebuilds what the new ones
 * earn — the `__w{n}.webp` variants, the `__poster` still and its widths, and
 * the `videoRenditions` array with its objects. A rendition is the dangerous
 * one: `?r=720p` would otherwise answer with a transcode of the film that was
 * just replaced, under the URL of the film that replaced it.
 *
 * `contentHash` changes with the bytes, which is what makes the pinned
 * `/{scope}/{mediaId}/{hash}` form self-heal — it 302s to the stable URL
 * (AGL-2685) — and what re-validates every edge entry.
 *
 * CDN-URL behavior (AGL-829): the stable, mediaId-keyed `cdnPath` does NOT
 * change on replace, so every reference that uses it keeps resolving and
 * simply serves the new bytes. Only the legacy raw `url` (with its token)
 * rotates.
 *
 * Concurrent-edit safety: an optional `expectedUpdatedAtMs` precondition
 * rejects a stale replace (409).
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const mediaId = String(body?.mediaId ?? '')
  if (!mediaId) {
    return Response.json({ error: 'Missing mediaId' }, { status: 400 })
  }
  const data = String(body?.data ?? '')
  if (method === 'POST' && !data) {
    return Response.json({ error: 'Missing mediaId or data' }, { status: 400 })
  }
  const expectedUpdatedAtMs = body?.expectedUpdatedAtMs
    ? Number(body.expectedUpdatedAtMs)
    : undefined

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

    // Quota/entitlements ride the owning org's doc (AGL-238).
    const org = scope.billing
    const previousType = String(mediaSnapshot.get('contentType') ?? '')
    const fileName =
      String(body?.fileName ?? '') ||
      String(mediaSnapshot.get('fileName') ?? '') ||
      'upload'
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'])
    const objectPath = mediaObjectPath(mediaSnapshot, scope.base)

    if (method === 'PUT') {
      // Mint only. The bytes do not exist yet, so this leg can ask every
      // question except the ones about them — which is the same split
      // `/api/media/upload-url` makes, and the same reason its POST is not a
      // quarantine chokepoint.
      const contentType = normalizeUploadContentType(
        String(body?.contentType ?? ''),
        String(body?.fileName ?? ''),
      )
      const refusal = replacementRefusal({ contentType, previousType, org })
      if (refusal) return refusal
      const sizeBytes = Number(body?.sizeBytes ?? 0)
      const maxBytes = signedUploadMaxBytes(contentType) as number
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
        return Response.json(
          {
            error: `File is empty or too large (${Math.round(
              maxBytes / 1024 / 1024,
            )}MB max)`,
          },
          { status: 413 },
        )
      }
      // The same band the finalize below measures, at the same delta
      // (AGL-1886's rule for the sibling route): the two must not disagree
      // about whether these bytes fit, or a customer signs a URL, waits out a
      // 200 MB upload, and is refused at the end of it.
      {
        const band = await resolveOrgMediaBand({
          firestore: scope.scopeRef.firestore,
          orgId: scope.orgId,
          org: org as any,
          currentHostId: scope.collection === 'hosts' ? scope.scopeId : null,
        })
        const projected =
          band.usedBytes -
          Number(mediaSnapshot.get('sizeBytes') ?? 0) +
          sizeBytes
        const gate = mediaStorageGate({
          org: org as any,
          usedMb: projected / (1024 * 1024),
          allowanceMb: band.allowanceMb,
          billsOverage: scopeBillsStorageOverage(scope.collection),
        })
        if (!gate.allowed) {
          return Response.json(
            {
              error: gate.error ?? `Storage limit reached (${gate.limitMb} MB)`,
              code: gate.code,
              projectedOverageUsd: gate.projectedOverageUsd,
              monthlyCapUsd: gate.monthlyCapUsd,
            },
            { status: gate.status },
          )
        }
      }
      const [uploadUrl] = await bucket
        .file(`${objectPath}${REPLACE_STAGING_SUFFIX}`)
        .getSignedUrl({
          version: 'v4',
          action: 'write',
          expires: Date.now() + SIGNED_URL_TTL_MS,
          contentType,
        })
      return Response.json({ mediaId, uploadUrl, contentType }, { status: 200 })
    }

    /**
     * From here the bytes are real, and the two branches differ only in where
     * they are: in this request's body, or in a staged object beside the
     * master. Everything after that — the gates, the derived artifacts, the
     * document — is one path, because two copies of a replace is how one of
     * them ends up serving a stale rendition.
     */
    const staged =
      method === 'PATCH'
        ? bucket.file(`${objectPath}${REPLACE_STAGING_SUFFIX}`)
        : null
    /** Drops the staged object however this request ends. */
    const discardStaged = async () => {
      await staged?.delete().catch(() => undefined)
    }

    let contentType: string
    let buffer: Buffer | null = null
    let uploadedBytes = 0
    let contentHash: string | undefined
    let contentSha256: string | undefined
    let svgRemoved: string[] | null = null

    if (staged) {
      const [exists] = await staged.exists()
      if (!exists) {
        return Response.json({ error: 'Upload not found — retry' }, { status: 409 })
      }
      const [metadata] = await staged.getMetadata()
      uploadedBytes = Number(metadata.size ?? 0)
      contentType = String(metadata.contentType ?? '')
      const refusal = replacementRefusal({ contentType, previousType, org })
      if (refusal) {
        await discardStaged()
        return refusal
      }
      const maxBytes = signedUploadMaxBytes(contentType) as number
      if (!uploadedBytes || uploadedBytes > maxBytes) {
        await discardStaged()
        return Response.json(
          {
            error: `File is empty or too large (${Math.round(
              maxBytes / 1024 / 1024,
            )}MB max)`,
          },
          { status: 413 },
        )
      }
      contentHash = storageContentHash(metadata.md5Hash)
      /**
       * STRUCTURAL inspection on the leg that never sees a byte (AGL-1475),
       * through two ranged GETs rather than a download — the head always,
       * the tail only for the document archives whose macro entries live
       * there. Identical to `/api/media/upload-url`'s finalize, and for the
       * identical reason: pulling a 200 MB film back into the function to
       * sniff four bytes would cost more than the feature.
       *
       * Fails OPEN on a ranged-read error, matching that route and the
       * lockdown core: an unreachable Storage object is an outage, not a
       * detection.
       */
      const headEnd = Math.min(uploadedBytes, UPLOAD_INSPECTION_HEAD_BYTES) - 1
      let head: Buffer | null = null
      let tail: Buffer | null = null
      try {
        if (headEnd >= 0) {
          const [chunk] = await staged.download({ start: 0, end: headEnd })
          head = chunk
        }
        if (
          head &&
          uploadInspectionNeedsTail(contentType) &&
          uploadedBytes > UPLOAD_INSPECTION_HEAD_BYTES
        ) {
          const start = Math.max(0, uploadedBytes - UPLOAD_INSPECTION_TAIL_BYTES)
          const [chunk] = await staged.download({ start, end: uploadedBytes - 1 })
          tail = chunk
        }
      } catch {
        head = null
      }
      if (head) {
        const refused = inspectUploadBytes({ bytes: head, tail, contentType, fileName })
        if (refused) {
          await discardStaged()
          return Response.json(
            { error: refused.message, code: refused.code },
            { status: 415, headers: { 'cache-control': 'no-store' } },
          )
        }
      }
      // SVG sanitization (AGL-1474) — the bytes are in the bucket, so this is
      // the first place they can be stripped. Only an SVG is ever downloaded
      // whole; the films this branch exists for stay where they are.
      if (isSvgUploadType(contentType)) {
        const [raw] = await staged.download()
        const sanitized = sanitizeSvgBuffer(raw)
        contentSha256 = createHash('sha256')
          .update(new Uint8Array(sanitized.changed ? sanitized.buffer : raw))
          .digest('hex')
        if (sanitized.changed) {
          await staged.save(sanitized.buffer, { contentType })
          const [rewritten] = await staged.getMetadata()
          uploadedBytes = Number(rewritten.size ?? sanitized.buffer.length)
          contentHash = storageContentHash(rewritten.md5Hash)
          svgRemoved = sanitized.removed
        }
      }
      if (!contentSha256) {
        // Streamed, never `download()`ed (AGL-1629): the strong quarantine key
        // for everything up to the ceiling, and absent above it — which every
        // consumer already handles by falling back to `contentHash`.
        const digest = await storedObjectSha256({
          file: staged as never,
          sizeBytes: uploadedBytes,
          maxBytes: MEDIA_STRONG_DIGEST_MAX_BYTES,
        })
        contentSha256 = digest.sha256
      }
    } else {
      // Canonicalized before anything reads it, so the stored type, the SVG
      // sanitizer's check and the CDN's active-document check all see one
      // spelling of a format. The file NAME is read for its extension only —
      // a browser reports an empty type for `.zip` and `.md` — and never
      // renames the asset, whose display name is metadata by design.
      contentType = normalizeUploadContentType(
        String(body?.contentType ?? ''),
        String(body?.fileName ?? ''),
      )
      const refusal = replacementRefusal({ contentType, previousType, org })
      if (refusal) return refusal

      const uploaded = Buffer.from(data, 'base64')
      /**
       * STRUCTURAL inspection (AGL-1475), and this route is the one where
       * skipping it would hurt most.
       *
       * Replace swaps the bytes behind a `cdnPath` that is ALREADY embedded in
       * published pages and that this route deliberately does not change. So an
       * asset that was uploaded as a genuine PNG, reviewed, and linked from a
       * live site can have an executable put behind it afterwards, at a URL
       * every visitor already trusts. Whatever the upload route refuses, this
       * one has to refuse too, or the control is a door with a window next to
       * it.
       *
       * Structure only — not an antivirus scan. See `upload-inspection.ts`.
       */
      {
        const refused = inspectUploadBytes({
          bytes: uploaded,
          contentType,
          fileName,
        })
        if (refused) {
          return Response.json(
            { error: refused.message, code: refused.code },
            { status: 415 },
          )
        }
      }
      // SVG sanitization (AGL-1474). Replace is the same ingress as upload,
      // which makes it the LATER door onto the same vector: an asset approved
      // as a PNG can have its bytes swapped for a scripted SVG afterwards,
      // under a `cdnPath` that is already embedded in published pages and that
      // replace deliberately does not change. Same treatment, same place in
      // the flow — before anything is written.
      const svg = isSvgUploadType(contentType) ? sanitizeSvgBuffer(uploaded) : null
      buffer = svg ? svg.buffer : uploaded
      svgRemoved = svg?.changed ? svg.removed : null
      // Measured on what was SENT: sanitizing only ever shrinks, and an
      // oversized replace must be refused for its real weight.
      const maxBytes = directUploadMaxBytes(contentType) as number
      if (!uploaded.length || uploaded.length > maxBytes) {
        return Response.json({
          error: `File is empty or too large (${Math.round(maxBytes / 1024 / 1024)}MB max)`,
        }, { status: 413 })
      }
      uploadedBytes = buffer.length

      // Same pair as the upload route, same reasoning (AGL-1614): the
      // truncated `contentHash` stays the ETag and the immutable URL segment,
      // and the full-width `contentSha256` is the quarantine key. Computed
      // before the Storage write (AGL-1613) because it is a gate now.
      contentSha256 = createHash('sha256')
        .update(new Uint8Array(buffer))
        .digest('hex')
      contentHash = contentSha256.slice(0, 16)
    }

    // Asset quarantine at INGESTION (AGL-1613), and this route needs BOTH
    // questions asked.
    //
    // 1. Are the INCOMING bytes quarantined? Replace is the second door onto
    //    the same collection, and a takedown that only the upload route
    //    honoured would be trivially walked around by uploading anything and
    //    then replacing its bytes with the disabled file.
    // 2. Is the TARGET asset quarantined? Its per-asset fallback key and its
    //    existing digests both keep biting at the CDN after a replace, so
    //    allowing the swap would produce a "successful" replace whose result
    //    still 410s — the precise confusing outcome AGL-1613 exists to end.
    //    Refusing says so instead.
    //
    // Two calls because they are two different key sets; the second is free —
    // the deny list is one already-cached document. Both run before the
    // previous variants are deleted, before the master is touched, and before
    // the counter delta, so a refused replace leaves the existing asset and
    // the billing input exactly as they were.
    {
      const refusal =
        (await quarantinedUploadRefusal({ contentSha256, contentHash })) ??
        (await quarantinedUploadRefusal({
          contentSha256: mediaSnapshot.get('contentSha256'),
          contentHash: mediaSnapshot.get('contentHash'),
          scopeSegment: scope.cdnScope,
          mediaId,
        }))
      if (refusal) {
        await discardStaged()
        return refusal
      }
    }

    const previousBytes = Number(mediaSnapshot.get('sizeBytes') ?? 0)
    {
      // Storage quota applies to every org; a plan-less org resolves as
      // `free` (250 MB cap), not unmetered.
      // ONE org-wide band across every media scope (AGL-2075). The counter
      // used to be read per scope and checked against `storagePerHostMb`,
      // which handed the org library a second full band of its own — a free
      // org's real ceiling was 250 MB + 250 MB against a published 250 MB.
      // The pool is what `meteredIncludedAllowance` and the usage alert
      // already measure, so ingress now refuses at the band the invoice bills
      // past.
      const band = await resolveOrgMediaBand({
        firestore: scope.scopeRef.firestore,
        orgId: scope.orgId,
        org: org as any,
        currentHostId: scope.collection === 'hosts' ? scope.scopeId : null,
      })
      // Quota against the NEW total (swap the old bytes for the new).
      const projected = band.usedBytes - previousBytes + uploadedBytes
      const usedMb = projected / (1024 * 1024)
      const gate = mediaStorageGate({
        org: org as any,
        usedMb,
        allowanceMb: band.allowanceMb,
        billsOverage: scopeBillsStorageOverage(scope.collection),
      })
      if (!gate.allowed) {
        await discardStaged()
        return Response.json(
          {
            error: gate.error ?? `Storage limit reached (${gate.limitMb} MB)`,
            code: gate.code,
            projectedOverageUsd: gate.projectedOverageUsd,
            monthlyCapUsd: gate.monthlyCapUsd,
          },
          { status: gate.status },
        )
      }
    }

    /**
     * Drop every artifact of the PREVIOUS bytes (AGL-2732).
     *
     * The variants were always dropped here. The poster and the renditions
     * were not, because nothing that was not an image could reach this route
     * — and they are the two that turn a successful replace into a live page
     * serving the old file: `?poster=1` would answer with a still of the
     * film that was just replaced, and `?r=720p` with a whole transcode of
     * it, both under the new asset's own URL.
     *
     * Best-effort, exactly as the variant deletes have always been: a
     * derived object that fails to delete is storage to reclaim, and the
     * document below stops pointing at all of them regardless.
     */
    const previousVariants: number[] = mediaSnapshot.get('variants') ?? []
    const previousPoster = mediaSnapshot.get('poster')
    const previousPosterWidths: number[] = previousPoster?.variants ?? []
    const previousRenditions = parseMediaRenditions(
      mediaSnapshot.get('videoRenditions'),
    )
    const drop = (path: string) =>
      bucket.file(path).delete().catch(() => undefined)
    await Promise.all([
      ...previousVariants.map((width) => drop(`${objectPath}__w${width}.webp`)),
      ...(previousPoster ? [drop(mediaPosterObjectPath(objectPath))] : []),
      ...previousPosterWidths.map((width) =>
        drop(`${objectPath}${MEDIA_POSTER_OBJECT_SUFFIX}__w${width}.webp`),
      ),
      ...previousRenditions.map((rendition) =>
        drop(mediaRenditionObjectPath(objectPath, rendition)),
      ),
    ])

    const token = randomUUID()
    const file = bucket.file(objectPath)
    if (staged) {
      // Server-side within the bucket: the bytes never travel through this
      // function, which is the whole reason the signed leg exists. The master
      // changes HERE and not a moment earlier — every refusal above returned
      // with the asset intact.
      await staged.move(file)
      await file.setMetadata({
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      })
    } else {
      await file.save(buffer as Buffer, {
        contentType,
        metadata: {
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: { firebaseStorageDownloadTokens: token },
        },
      })
    }
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}` +
      `?alt=media&token=${token}`

    // Pixel dimensions are an IMAGE fact (AGL-173). A video carries its frame
    // size inside `video` and a document has none at all, so the top-level
    // pair is cleared for both rather than left describing the picture this
    // asset used to be.
    const isImage = isImageUploadType(contentType)
    let dimensions: { width: number; height: number } | null = null
    if (isImage) {
      if (buffer) {
        dimensions = readImageDimensions(new Uint8Array(buffer))
      } else if (staged && !isSvgUploadType(contentType)) {
        // The header only — see `IMAGE_HEADER_PROBE_BYTES`. A truncated read
        // returns null, which degrades to "generate every width".
        const [header] = await file.download({
          start: 0,
          end: IMAGE_HEADER_PROBE_BYTES - 1,
        })
        dimensions = readImageDimensions(new Uint8Array(header))
      }
    }
    // Replacing the bytes of a PRIVATE asset must not hand it a `cdnPath`
    // (AGL-1051) — that would quietly publish it, and the `: delete()`
    // branch below means the field is actively removed if one lingers.
    const cdnAllowed =
      checkEntitlement(org, 'mediaCdn') && mediaSnapshot.get('private') !== true
    const saveDerived = (path: string, bytes: Buffer) =>
      bucket.file(path).save(bytes, {
        contentType: 'image/webp',
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
      })
    // Same shape as upload, same reason (AGL-1468): the previous `catch` here
    // only reached a serverless log, which is why the regeneration half of
    // this bug was as invisible as the upload half.
    //
    // Neither generator needs an eligibility pre-check — both decide their
    // widths before they touch the source, so a PDF, a film or an SVG comes
    // back `{ variants: [] }` having read nothing. Restating that rule at the
    // call site is how two copies of it came to disagree in the first place.
    const { variants, error: variantsError } = !cdnAllowed
      ? { variants: [] as number[], error: undefined }
      : buffer
        ? await generateMediaVariants({
            buffer,
            contentType,
            sourceWidth: dimensions?.width,
            objectPath,
            saveVariant: saveDerived,
          })
        : await generateStoredMediaVariants({
            contentType,
            sizeBytes: uploadedBytes,
            sourceWidth: dimensions?.width,
            objectPath,
            readSource: async () => (await file.download())[0],
            saveVariant: saveDerived,
          })

    /**
     * The video half, on the route that changes a film (AGL-2742/AGL-2732).
     *
     * The poster and the metadata come from the uploader's BROWSER on every
     * path that ingests video, because the missing capability server-side is
     * a decoder and not a download — see `media-video-fields.ts`. Replace is
     * no different, and it is the path where a missing poster is worst: the
     * old one was just deleted above, so an asset whose new bytes arrive
     * without a probe correctly ends up with no poster rather than the
     * previous film's first frame.
     */
    const videoFields = await videoUploadFields({
      contentType,
      video: body?.['video'],
      poster: body?.['poster'],
      probeReason: body?.['posterError'],
      objectPath,
      cdnAllowed,
      saveVariant: saveDerived,
    })
    const remove = firebaseAdmin.firestore.FieldValue.delete()
    /**
     * A merge write, so every field the NEW bytes do not earn has to be
     * actively cleared rather than simply not set — the asset is the same
     * document it was a moment ago, and anything left behind describes a file
     * that is no longer in the bucket.
     *
     * `videoRenditions` is cleared unconditionally and has no regeneration
     * branch on purpose: renditions are produced out of band by
     * `tools/scripts/generate-video-renditions.mjs`, so the honest state
     * immediately after a replace is "none yet". Leaving the array would
     * point `?r=` at transcodes of the previous film.
     */
    await mediaRef.set(
      {
        contentType,
        sizeBytes: uploadedBytes,
        url,
        // Clear stale dimensions if the new header didn't parse — or if the
        // new bytes are not a picture at all.
        width: dimensions?.width ?? remove,
        height: dimensions?.height ?? remove,
        ...(contentHash ? { contentHash } : { contentHash: remove }),
        ...(contentSha256 ? { contentSha256 } : { contentSha256: remove }),
        variants,
        // A merge write, so this has to CLEAR on success rather than simply
        // not be set: an asset whose first upload failed and whose replace
        // succeeded would otherwise keep a fault marker for bytes that are
        // fine, and the population query would over-report forever.
        variantsError: variantsError ?? remove,
        // AGL-1474, and a merge write, so it must CLEAR on a clean replace —
        // otherwise the marker outlives the bytes that earned it and the
        // "which assets arrived carrying script" query over-reports forever.
        svgSanitized: svgRemoved ?? remove,
        // AGL-2742. The same three fields both upload routes write, and here
        // each one either lands or is removed — a film replaced by a film
        // whose probe failed must not keep the previous film's duration.
        video: videoFields['video'] ?? remove,
        poster: videoFields['poster'] ?? remove,
        posterError: videoFields['posterError'] ?? remove,
        videoRenditions: remove,
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
            uploadedBytes - previousBytes,
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

/**
 * May these bytes stand in for that asset's? (AGL-2732)
 *
 * Three questions in the order that gives the clearest refusal: is the type
 * one media ingress accepts at all, does it belong to the same family as the
 * asset it would replace, and does the plan cover it.
 *
 * The family test is skipped when the existing document records no usable
 * type. That is a legacy asset rather than a cross-family swap, and refusing
 * one would make it permanently un-replaceable — the failure this issue is
 * about, arrived at from the other side.
 */
function replacementRefusal(options: {
  contentType: string
  previousType: string
  org: unknown
}): Response | null {
  const { contentType, previousType, org } = options
  if (!isAllowedUploadType(contentType)) {
    return Response.json({ error: UPLOAD_TYPES_MESSAGE }, { status: 415 })
  }
  const kind = mediaUploadKind(contentType)
  const previousKind = mediaUploadKind(
    normalizeUploadContentType(previousType, ''),
  )
  if (kind && previousKind && kind !== previousKind) {
    return Response.json(
      {
        error:
          `This file is ${MEDIA_UPLOAD_KIND_LABELS[kind]} and the asset is ` +
          `${MEDIA_UPLOAD_KIND_LABELS[previousKind]}. Replacing keeps the ` +
          'same link on every page that uses it, so the new file has to be ' +
          'the same kind — upload it as a new file instead.',
      },
      { status: 415 },
    )
  }
  // Everything that is not an image rides `videoMedia` — AGL-162's "video &
  // file uploads" tier gate, which documents join (AGL-1465). The upload
  // routes have always enforced it; this one did not need to while it was
  // image-only, and does now.
  if (
    requiresFileUploadEntitlement(contentType) &&
    !checkEntitlement(org as never, 'videoMedia')
  ) {
    return Response.json(
      { error: 'Video and file uploads require a Pro plan' },
      { status: 403 },
    )
  }
  return null
}

export const dynamic = 'force-dynamic'
/**
 * The finalize leg fetches an image header back, runs `sharp` over the object
 * and re-encodes a poster, on a handler that used to do one in-process save.
 * Declared for the reason `/api/media/upload-url` declares it: being cut off
 * mid-flight here would leave the master swapped and the document describing
 * the file it replaced.
 */
export const maxDuration = 60
export { handler as POST, handler as PUT, handler as PATCH }
