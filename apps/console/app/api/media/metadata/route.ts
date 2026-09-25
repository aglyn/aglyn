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
  bytesReader,
  EmbeddedWriteError,
  inspectUploadBytes,
  pluginRequestFromWeb,
  readMediaEmbeddedMetadata,
  writeMediaEmbeddedMetadata,
} from '@aglyn/aglyn/server'
import {
  embeddedFieldLabel,
  sanitizeEmbeddedPatch,
} from '@aglyn/aglyn/app-utils/media-embedded-fields'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  quarantinedUploadRefusal,
} from '@aglyn/tenant-data-admin'
import {
  mediaObjectPath,
  resolveMediaScope,
  scopeAllows,
} from '../../../../utils/server/media-scope'
import {
  embeddedMetadataIsCurrent,
  storageObjectReader,
} from '../../../../utils/server/media-embedded'
import {
  removeAssetDeliveryCopies,
  scheduleMediaDeliveryCopies,
} from '../../../../utils/server/media-delivery-copies'
import { createHash, randomUUID } from 'crypto'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The largest file an edit will pull into the function and write back —
 * the biggest ceiling of any writable family (a `.pptx`). Everything the
 * DAM accepted in a writable format is under it.
 */
const EMBEDDED_WRITE_MAX_BYTES = 50 * 1024 * 1024

/**
 * The metadata a file carries INSIDE its bytes (AGL-3331): EXIF, IPTC and
 * XMP on a photo, a PDF's document info, an Office file's properties, a
 * video's tags.
 *
 * ## `read` {mediaId}
 *
 * Answers with the asset's `embeddedMetadata`, reading the stored object
 * when the document has no record yet or holds one for bytes it no longer
 * has. That is the backfill: every asset uploaded before this existed, or
 * through a path that does not read at ingress, is read the first time
 * anybody opens its Details drawer, and stored so the second time costs a
 * document read. Filling that record is a cache write — it never touches
 * `updatedAt`, because replace's concurrency guard compares against it and
 * merely LOOKING at a file must not make the next replace a 409.
 *
 * ## `write` {mediaId, patch, expectedSha256}
 *
 * Writes an edit INTO the file and swaps the bytes in place — same id, same
 * `cdnPath`, every page that uses the asset serving the edited file. What
 * changes is only what a metadata edit changes: the bytes, their digests,
 * their size and the raw URL's token. The WebP variants stay, because not a
 * pixel moved and they never carried metadata (sharp strips it); the
 * provider's delivery copies go, because their keys carry the old hash.
 *
 * `expectedSha256` is the digest the drawer was showing. A file replaced or
 * edited elsewhere since answers 409 rather than having an edit written over
 * bytes nobody here has seen — the same promise replace makes with its
 * `expectedUpdatedAtMs`, keyed on the one value that names the bytes. The
 * Storage write carries a generation precondition for the race between the
 * two reads.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const action = String(body?.action ?? '')
  if (action !== 'read' && action !== 'write') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }
  const mediaId = String(body?.mediaId ?? '')
  if (!mediaId) {
    return Response.json({ error: 'Missing mediaId' }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    // lockdown-423: via apps/console/utils/server/media-scope.ts — the scope
    // resolver runs the verdict on the org/host docs it already reads and
    // hands the 423 refusal back as `error.response`. Both actions are
    // writes as far as a lock is concerned (`read` stores what it read), and
    // `write` puts new bytes behind a published URL, so it also passes the
    // UPLOADS feature gate exactly as replace does.
    const { scope, error } = await resolveMediaScope(body, query, decoded.uid, {
      staff: decoded['staff'] === true,
      ...(action === 'write' ? { feature: 'uploads' as const } : {}),
    })
    if (!scope) {
      return (
        error?.response ??
        Response.json(
          { error: error?.message ?? 'Bad request' },
          { status: error?.status ?? 400 },
        )
      )
    }

    const mediaRef = scope.scopeRef.collection('media').doc(mediaId)
    const snapshot = await mediaRef.get()
    if (
      !snapshot.exists ||
      snapshot.get('deletedAt') ||
      // Reading or editing an asset you cannot see would expose or change
      // another site's file (AGL-1043).
      !scopeAllows(scope, snapshot.get('visibleTo'))
    ) {
      return Response.json({ error: 'Unknown media' }, { status: 404 })
    }
    const contentType = String(snapshot.get('contentType') ?? '')
    const storedSha256 = snapshot.get('contentSha256') as string | undefined
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'])
    const file = bucket.file(mediaObjectPath(snapshot, scope.base))

    if (action === 'read') {
      const stored = snapshot.get('embeddedMetadata')
      if (embeddedMetadataIsCurrent(stored, storedSha256)) {
        return Response.json({ embeddedMetadata: stored }, { status: 200 })
      }
      const [exists] = await file.exists()
      if (!exists) {
        return Response.json({ embeddedMetadata: null }, { status: 200 })
      }
      const [objectMetadata] = await file.getMetadata()
      const embeddedMetadata = await readMediaEmbeddedMetadata({
        contentType,
        reader: storageObjectReader(file, Number(objectMetadata.size ?? 0)),
        ...(storedSha256 ? { contentSha256: storedSha256 } : {}),
      })
      // Stored even when a record existed, so a stale one is replaced; left
      // alone when the format has no reader, which the drawer never asks
      // about twice (it gates on the content type).
      if (embeddedMetadata) {
        await mediaRef.update({ embeddedMetadata })
      }
      return Response.json({ embeddedMetadata }, { status: 200 })
    }

    // ---- write ------------------------------------------------------------
    const expectedSha256 = String(body?.expectedSha256 ?? '')
    if (storedSha256 && expectedSha256 && storedSha256 !== expectedSha256) {
      return Response.json(
        { error: 'This file was changed elsewhere — reopen it first' },
        { status: 409 },
      )
    }
    // A disabled asset stays exactly as staff left it (AGL-1613): its keys
    // keep biting at the CDN, so a "successful" edit would still 410.
    {
      const refusal = await quarantinedUploadRefusal({
        contentSha256: storedSha256,
        contentHash: snapshot.get('contentHash'),
        scopeSegment: scope.cdnScope,
        mediaId,
      })
      if (refusal) return refusal
    }
    const [exists] = await file.exists()
    if (!exists) {
      return Response.json({ error: 'Unknown media' }, { status: 404 })
    }
    const [objectMetadata] = await file.getMetadata()
    const previousBytes = Number(objectMetadata.size ?? 0)
    if (!previousBytes || previousBytes > EMBEDDED_WRITE_MAX_BYTES) {
      return Response.json(
        { error: 'This file is too large to edit its details here' },
        { status: 413 },
      )
    }
    const [original] = await file.download()
    const current = await readMediaEmbeddedMetadata({
      contentType,
      reader: bytesReader(new Uint8Array(original)),
    })
    if (!current) {
      return Response.json(
        { error: 'Details inside this kind of file cannot be changed here' },
        { status: 422 },
      )
    }
    const checked = sanitizeEmbeddedPatch(current.format, body?.patch)
    if ('error' in checked) {
      return Response.json({ error: checked.error }, { status: 422 })
    }
    // An "other" field is only ever edited where the file already has it;
    // the writers refuse the rest, and this says so by name first.
    for (const key of Object.keys(checked.patch)) {
      if (key.includes('|') && !current.fields.some((field) => field.key === key)) {
        return Response.json(
          { error: `${embeddedFieldLabel(key, current.format)} is not in this file` },
          { status: 422 },
        )
      }
    }

    let edited: Uint8Array
    try {
      edited = writeMediaEmbeddedMetadata({
        contentType,
        bytes: new Uint8Array(original),
        patch: checked.patch,
      })
    } catch (writeError) {
      if (writeError instanceof EmbeddedWriteError) {
        return Response.json({ error: writeError.message }, { status: 422 })
      }
      throw writeError
    }
    const buffer = Buffer.from(edited.buffer, edited.byteOffset, edited.byteLength)
    if (buffer.equals(original)) {
      return Response.json(
        {
          embeddedMetadata: { ...current, ...(storedSha256 ? { contentSha256: storedSha256 } : {}) },
          unchanged: true,
        },
        { status: 200 },
      )
    }
    // The edited file must read back as the same kind of file with the
    // edit in it, and pass the same structural inspection an upload does,
    // before it goes anywhere near the URL pages already embed.
    const contentSha256 = createHash('sha256')
      .update(new Uint8Array(buffer))
      .digest('hex')
    const after = await readMediaEmbeddedMetadata({
      contentType,
      reader: bytesReader(edited),
      contentSha256,
    })
    if (!after || after.format !== current.format) {
      console.error('embedded metadata write did not read back', {
        mediaId,
        format: current.format,
      })
      return Response.json(
        { error: 'The edit could not be verified, so the file was left as it was' },
        { status: 500 },
      )
    }
    {
      const refused = inspectUploadBytes({
        bytes: new Uint8Array(buffer),
        contentType,
        fileName: String(snapshot.get('fileName') ?? 'file'),
      })
      if (refused) {
        console.error('edited file failed inspection', { mediaId, code: refused.code })
        return Response.json(
          { error: 'The edit could not be verified, so the file was left as it was' },
          { status: 500 },
        )
      }
    }

    // The byte delta is a few hundred bytes of text, but it is still bytes,
    // and the band is measured the way every ingress measures it.
    const delta = buffer.length - previousBytes
    if (delta > 0) {
      const band = await resolveOrgMediaBand({
        firestore: scope.scopeRef.firestore,
        orgId: scope.orgId,
        org: scope.billing as any,
        currentHostId: scope.collection === 'hosts' ? scope.scopeId : null,
      })
      const gate = mediaStorageGate({
        org: scope.billing as any,
        usedMb: (band.usedBytes + delta) / (1024 * 1024),
        allowanceMb: band.allowanceMb,
        billsOverage: scopeBillsStorageOverage(scope.collection),
      })
      if (!gate.allowed) {
        return Response.json(
          {
            error: gate.error ?? `Storage limit reached (${gate.limitMb} MB)`,
            code: gate.code,
          },
          { status: gate.status },
        )
      }
    }

    // Everything on the object but its token carries over — including the
    // AGL-822 custom pairs mirrored onto it — and the token rotates so the
    // legacy raw URL, served `immutable`, is a new URL for new bytes.
    const token = randomUUID()
    const carried = { ...((objectMetadata.metadata ?? {}) as Record<string, unknown>) }
    delete carried['firebaseStorageDownloadTokens']
    await file.save(buffer, {
      contentType,
      metadata: {
        cacheControl:
          objectMetadata.cacheControl ?? 'public, max-age=31536000, immutable',
        ...(objectMetadata.contentDisposition
          ? { contentDisposition: objectMetadata.contentDisposition }
          : {}),
        metadata: { ...carried, firebaseStorageDownloadTokens: token },
      },
      preconditionOpts: { ifGenerationMatch: Number(objectMetadata.generation) },
      resumable: false,
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(file.name)}` +
      `?alt=media&token=${token}`
    const contentHash = contentSha256.slice(0, 16)
    const remove = firebaseAdmin.firestore.FieldValue.delete()
    await mediaRef.update({
      sizeBytes: buffer.length,
      url,
      contentHash,
      contentSha256,
      embeddedMetadata: after,
      // The provider's copies were made from the previous bytes (AGL-2824).
      ...(snapshot.get('deliveryCopies') !== undefined
        ? { deliveryCopies: remove }
        : {}),
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    if (delta) {
      await scope.scopeRef
        .collection('counters')
        .doc('media')
        .set(
          { bytes: firebaseAdmin.firestore.FieldValue.increment(delta) },
          { merge: true },
        )
    }
    await removeAssetDeliveryCopies({
      collection: scope.collection,
      scopeId: scope.scopeId,
      mediaId,
    })
    scheduleMediaDeliveryCopies({ scope, mediaId, contentType })

    return Response.json(
      {
        embeddedMetadata: after,
        contentSha256,
        contentHash,
        sizeBytes: buffer.length,
        url,
      },
      { status: 200 },
    )
  } catch (error: any) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    // Lost the generation race: somebody replaced the file between the
    // download and the save. Nothing was written.
    if (Number(error?.code) === 412) {
      return Response.json(
        { error: 'This file was changed elsewhere — reopen it first' },
        { status: 409 },
      )
    }
    console.error('media metadata operation failed', error)
    return Response.json({ error: 'Metadata operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
/**
 * A write downloads the file, rewrites its metadata and uploads it again —
 * up to 50 MB each way for a presentation. Declared for the reason replace
 * declares it: being cut off between the save and the document write would
 * leave the bytes edited and the document describing the previous ones.
 */
export const maxDuration = 60
export { handler as POST }
