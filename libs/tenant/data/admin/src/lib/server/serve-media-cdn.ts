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

import type { NextApiRequest, NextApiResponse } from 'next'
import { firebaseAdmin } from './firebase-admin'

/** Variant widths generated at upload (AGL-175). */
export const MEDIA_CDN_VARIANT_WIDTHS = [320, 640, 1280] as const

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/

/**
 * CDN media delivery (AGL-175 / AGL-829). Two URL shapes resolve the same
 * asset by `mediaId`, so delivery never depends on the object's storage
 * location (folder moves don't change the URL):
 *
 * - **Stable** `/api/media/cdn/[scope]/[mediaId]` — always serves the
 *   asset's CURRENT bytes, so it survives a **replace** too. Revalidated
 *   with an ETag (the content hash) + `stale-while-revalidate`, so a
 *   replaced asset propagates without ever breaking references. This is
 *   the URL the console hands out.
 * - **Immutable** `/api/media/cdn/[scope]/[mediaId]/[contentHash]` —
 *   year-long `immutable` cache; the hash must match the current content,
 *   so it can never serve stale bytes (older embeds keep working until the
 *   asset is replaced, then that exact URL 404s by design).
 *
 * `?w=[width]` selects a generated WebP variant. The same handler mounts in
 * both the tenant and console apps; raw storage URLs already embedded in
 * screens keep working unchanged.
 */
export async function serveMediaCdn(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    res.status(405).end()
    return
  }
  const path = Array.isArray(req.query['path']) ? req.query['path'] : []
  const [scopeSegment, mediaId, hash] = path.map((value) =>
    String(value ?? ''),
  )
  // Org DAM assets serve under `org:{orgId}` (host ids otherwise).
  const isOrg = scopeSegment.startsWith('org:')
  const scopeId = isOrg ? scopeSegment.slice('org:'.length) : scopeSegment
  // 3 segments = the immutable content-hashed URL; 2 = the stable URL.
  const hashed = path.length === 3
  if (
    (path.length !== 2 && path.length !== 3) ||
    !SEGMENT.test(scopeId) ||
    !SEGMENT.test(mediaId) ||
    (hashed && !SEGMENT.test(hash))
  ) {
    res.status(400).json({ error: 'Bad media path' })
    return
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collection(isOrg ? 'orgs' : 'hosts')
      .doc(scopeId)
      .collection('media')
      .doc(mediaId)
      .get()
    const currentHash = String(snapshot.get('contentHash') ?? '')
    if (!snapshot.exists || snapshot.get('deletedAt')) {
      res.setHeader('Cache-Control', 'public, max-age=60')
      res.status(404).json({ error: 'Not found' })
      return
    }
    // The immutable form must pin the current content; a stale hash 404s so
    // the edge never keeps serving replaced bytes under that URL.
    if (hashed && currentHash !== hash) {
      res.setHeader('Cache-Control', 'public, max-age=60')
      res.status(404).json({ error: 'Not found' })
      return
    }

    const width = Number(req.query['w'] ?? 0)
    const variants: number[] = snapshot.get('variants') ?? []
    const useVariant = Boolean(width) && variants.includes(width)

    // Stable URL: revalidate against an ETag so a replaced asset is picked
    // up (a conditional GET returns 304 while the content is unchanged).
    const etag = currentHash
      ? `"${currentHash}${useVariant ? `-w${width}` : ''}"`
      : null
    if (!hashed) {
      res.setHeader(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400',
      )
      if (etag) res.setHeader('ETag', etag)
      if (etag && req.headers['if-none-match'] === etag) {
        res.status(304).end()
        return
      }
    }

    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'])
    // Real folders: the doc records its object path; legacy assets fall
    // back to the flat layout.
    const basePath =
      (snapshot.get('storagePath') as string | undefined) ||
      `${isOrg ? 'orgs' : 'hosts'}/${scopeId}/media/${mediaId}`
    const objectPath = useVariant ? `${basePath}__w${width}.webp` : basePath
    const file = bucket.file(objectPath)
    const [metadata] = await file.getMetadata().catch(() => [null as any])
    if (!metadata) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    res.setHeader(
      'Content-Type',
      useVariant
        ? 'image/webp'
        : String(
            metadata.contentType ??
              snapshot.get('contentType') ??
              'application/octet-stream',
          ),
    )
    if (metadata.size) res.setHeader('Content-Length', String(metadata.size))
    if (hashed) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }

    // Delivery volume (AGL-176): per-asset serves/bytes on the AGL-82
    // analytics day-doc, fire-and-forget. Only cache MISSES reach this
    // code — edge-cached responses aren't counted, so these are origin
    // serves, not user-facing totals (billing accuracy is AGL-41's job).
    // Hot-doc note: a single day-doc caps at ~1 write/sec sustained;
    // acceptable at current traffic, shard or sample if an asset gets hot.
    const day = new Date().toISOString().slice(0, 10)
    void firestore
      .collection(isOrg ? 'orgs' : 'hosts')
      .doc(scopeId)
      .collection('analytics')
      .doc(day)
      .set(
        {
          media: {
            [mediaId]: {
              serves: firebaseAdmin.firestore.FieldValue.increment(1),
              bytes: firebaseAdmin.firestore.FieldValue.increment(
                Number(metadata.size ?? 0),
              ),
            },
          },
        },
        { merge: true },
      )
      .catch(() => undefined)
    if (req.method === 'HEAD') {
      res.status(200).end()
      return
    }
    await new Promise<void>((resolve, reject) => {
      file
        .createReadStream()
        .on('error', reject)
        .on('end', resolve)
        .pipe(res)
    })
  } catch (error) {
    console.error('serveMediaCdn failed', scopeSegment, mediaId, error)
    if (!res.headersSent) res.status(500).json({ error: 'Delivery failed' })
    else res.end()
  }
}
